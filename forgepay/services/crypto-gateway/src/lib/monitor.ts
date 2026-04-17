/**
 * Per-coin chain monitors for crypto-gateway.
 *
 * BTC — polls Blockstream Esplora REST API every 30s (no API key required)
 * LTC — polls Litecoinspace Esplora REST API every 30s
 * ETH — polls address balance via JSON-RPC every 30s (ETH_RPC_URL required)
 * XMR — polls Monero daemon get_transfers RPC every 30s (XMR_RPC_URL required)
 *
 * NOTE: For BTC/LTC, custom node RPC is not used here — Esplora is simpler
 *   to operate (no full node required). In production you may prefer a private
 *   Esplora instance (e.g. self-hosted via romanz/electrs) to avoid rate limits
 *   and data leakage to public APIs.
 *
 * NOTE: Confirmation counting uses Esplora's block height delta:
 *   confirmations = tip_height - tx_block_height + 1
 *   For BTC the threshold is config.confirmations.BTC (default 3).
 */

import type { Pool } from 'pg';
import { config } from '../config.js';
import { forwardToUnifiedRouter, type CryptoPaymentEvent } from './events.js';
import { randomUUID } from 'node:crypto';

const POLL_MS = 30_000;

// ── Esplora helpers (BTC + LTC) ────────────────────────────────────────────

interface EsploraTxStatus { confirmed: boolean; block_height?: number }
interface EsploraVout     { scriptpubkey_address?: string; value: number }  // satoshis
interface EsploraTx       { txid: string; status: EsploraTxStatus; vout: EsploraVout[] }

async function esploraFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function pollEsplora(
  coin: 'BTC' | 'LTC',
  baseUrl: string,
  db: Pool,
): Promise<void> {
  const rows = await db.query<{
    id: string; merchant_id: string; address: string;
    amount_crypto: string; amount_usd: number; payment_id: string | null;
  }>(
    `SELECT id, merchant_id, address, amount_crypto, amount_usd, payment_id
       FROM crypto_invoices
      WHERE coin = $1 AND status = 'pending' AND expires_at > now()`,
    [coin],
  );

  const tipHeight = await esploraFetch<number>(`${baseUrl}/blocks/tip/height`) ?? 0;

  for (const inv of rows.rows) {
    const txs = await esploraFetch<EsploraTx[]>(`${baseUrl}/address/${inv.address}/txs`);
    if (!txs || txs.length === 0) continue;

    const tx = txs[0];
    const receivedSats = tx.vout
      .filter((o) => o.scriptpubkey_address === inv.address)
      .reduce((s, o) => s + o.value, 0);
    if (receivedSats === 0) continue;

    const expectedSats = Math.round(parseFloat(inv.amount_crypto) * 1e8);
    const status       = receivedSats >= expectedSats ? 'received' : 'underpaid';

    await db.query(
      `UPDATE crypto_invoices
          SET status = $1, tx_id = $2,
              received_amount_crypto = $3, received_at = now()
        WHERE id = $4 AND status = 'pending'`,
      [status, tx.txid, (receivedSats / 1e8).toFixed(8), inv.id],
    );

    if (status !== 'received') continue;

    // Check confirmation depth
    const blockHeight   = tx.status.block_height ?? 0;
    const confirmations = tipHeight > 0 && blockHeight > 0 ? tipHeight - blockHeight + 1 : 0;
    const required      = config.confirmations[coin] ?? 3;

    if (confirmations >= required) {
      await db.query(
        `UPDATE crypto_invoices SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
        [inv.id],
      );
      await forwardToUnifiedRouter({
        eventId:      randomUUID(),
        type:         'crypto.payment.confirmed',
        merchantId:   inv.merchant_id,
        invoiceId:    inv.id,
        coin,
        amountCrypto: (receivedSats / 1e8).toFixed(8),
        amountUsd:    inv.amount_usd,
        txId:         tx.txid,
        toAddress:    inv.address,
        occurredAt:   new Date().toISOString(),
      } satisfies CryptoPaymentEvent);
    }
  }
}

// ── ETH monitor ────────────────────────────────────────────────────────────

async function pollEth(db: Pool): Promise<void> {
  const rpcUrl = config.nodes.ETH;
  if (!rpcUrl) return;

  const { ethers } = await import('ethers');
  const provider   = new ethers.JsonRpcProvider(rpcUrl);

  const rows = await db.query<{
    id: string; merchant_id: string; address: string;
    amount_crypto: string; amount_usd: number;
  }>(
    `SELECT id, merchant_id, address, amount_crypto, amount_usd
       FROM crypto_invoices
      WHERE coin = 'ETH' AND status = 'pending' AND expires_at > now()`,
  );

  for (const inv of rows.rows) {
    try {
      const balance  = await provider.getBalance(inv.address);
      const expected = ethers.parseEther(inv.amount_crypto);
      if (balance < expected) continue;

      const required = config.confirmations.ETH ?? 12;
      const block    = await provider.getBlockNumber();
      // Simplified: treat any balance >= expected with >N blocks as confirmed.
      // A production impl would scan eth_getTransactionReceipt for exact tx.
      if (block < required) continue;

      await db.query(
        `UPDATE crypto_invoices SET status = 'confirmed', confirmed_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [inv.id],
      );
      await forwardToUnifiedRouter({
        eventId:      randomUUID(),
        type:         'crypto.payment.confirmed',
        merchantId:   inv.merchant_id,
        invoiceId:    inv.id,
        coin:         'ETH',
        amountCrypto: ethers.formatEther(balance),
        amountUsd:    inv.amount_usd,
        toAddress:    inv.address,
        occurredAt:   new Date().toISOString(),
      } satisfies CryptoPaymentEvent);
    } catch (err) {
      console.error(`[crypto-monitor] ETH check failed for invoice ${inv.id}:`, err);
    }
  }
}

// ── XMR monitor ────────────────────────────────────────────────────────────

interface XmrTransfer {
  address:       string;
  txid:          string;
  amount:        number;   // piconero (1 XMR = 1e12 piconero)
  confirmations: number;
}

async function pollXmr(db: Pool): Promise<void> {
  const rpcUrl = config.nodes.XMR;
  if (!rpcUrl) return;

  const rows = await db.query<{
    id: string; merchant_id: string; address: string;
    amount_crypto: string; amount_usd: number;
  }>(
    `SELECT id, merchant_id, address, amount_crypto, amount_usd
       FROM crypto_invoices
      WHERE coin = 'XMR' AND status = 'pending' AND expires_at > now()`,
  );
  if (rows.rows.length === 0) return;

  try {
    const res = await fetch(`${rpcUrl}/json_rpc`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'get_transfers', params: { in: true } }),
      signal: AbortSignal.timeout(8_000),
    });
    const json = await res.json() as { result?: { in?: XmrTransfer[] } };
    const transfers = json.result?.in ?? [];

    for (const inv of rows.rows) {
      const picoExpected = BigInt(Math.round(parseFloat(inv.amount_crypto) * 1e12));
      const match = transfers.find(
        (t) => t.address === inv.address && BigInt(t.amount) >= picoExpected,
      );
      if (!match) continue;

      const required = config.confirmations.XMR ?? 10;
      const status   = match.confirmations >= required ? 'confirmed' : 'received';

      await db.query(
        `UPDATE crypto_invoices
            SET status = $1, tx_id = $2,
                received_amount_crypto = $3, received_at = now()
          WHERE id = $4 AND status = 'pending'`,
        [status, match.txid, (match.amount / 1e12).toFixed(12), inv.id],
      );

      if (status === 'confirmed') {
        await db.query(
          `UPDATE crypto_invoices SET confirmed_at = now() WHERE id = $1`,
          [inv.id],
        );
        await forwardToUnifiedRouter({
          eventId:      randomUUID(),
          type:         'crypto.payment.confirmed',
          merchantId:   inv.merchant_id,
          invoiceId:    inv.id,
          coin:         'XMR',
          amountCrypto: (match.amount / 1e12).toFixed(12),
          amountUsd:    inv.amount_usd,
          txId:         match.txid,
          toAddress:    inv.address,
          occurredAt:   new Date().toISOString(),
        } satisfies CryptoPaymentEvent);
      }
    }
  } catch (err) {
    console.error('[crypto-monitor] XMR poll error:', err);
  }
}

// ── Start all monitors ─────────────────────────────────────────────────────

export function startChainMonitors(db: Pool): void {
  const ESPLORA_BTC = 'https://blockstream.info/api';
  const ESPLORA_LTC = 'https://litecoinspace.org/api';

  setInterval(() => pollEsplora('BTC', ESPLORA_BTC, db).catch(console.error), POLL_MS);
  setInterval(() => pollEsplora('LTC', ESPLORA_LTC, db).catch(console.error), POLL_MS);
  setInterval(() => pollEth(db).catch(console.error), POLL_MS);

  if (config.nodes.XMR) {
    setInterval(() => pollXmr(db).catch(console.error), POLL_MS);
  } else {
    console.warn('[crypto-monitor] XMR_RPC_URL not configured — XMR monitoring disabled');
  }

  console.log('[crypto-monitor] Started monitors for BTC, LTC, ETH' + (config.nodes.XMR ? ', XMR' : ''));
}
