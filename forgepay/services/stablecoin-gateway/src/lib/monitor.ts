/**
 * EVM on-chain deposit monitor.
 *
 * Polls for incoming USDC/USDT transfers to watched deposit addresses using
 * the ethers.js provider. On mainnet, use a WebSocket provider or a service
 * like Alchemy/Moralis webhooks for lower latency.
 *
 * USDC contract addresses (canonical):
 *   Ethereum: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
 *   Polygon:  0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
 *   Base:     0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   Arbitrum: 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
 *
 * USDT contract addresses (canonical):
 *   Ethereum: 0xdAC17F958D2ee523a2206206994597C13D831ec7
 *   Polygon:  0xc2132D05D31c914a87C6611C10748AEb04B58e8F
 */

import { ethers } from 'ethers';
import { config } from '../config.js';
import type { Pool } from 'pg';
import { forwardToUnifiedRouter } from './events.js';
import { randomUUID } from 'node:crypto';

const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// USDC/USDT have 6 decimal places (not 18 like ETH).
const STABLECOIN_DECIMALS = 6;

const CONTRACTS: Record<string, { usdc: string; usdt: string }> = {
  ethereum: {
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  polygon: {
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  base: {
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdt: '0x', // USDT not deployed on Base yet
  },
  arbitrum: {
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
};

interface DepositRow {
  id:          string;
  merchant_id: string;
  address:     string;
  chain:       string;
  token:       'USDC' | 'USDT';
  amount_units: string;
  payment_id:  string;
}

export async function startChainMonitor(chain: string, db: Pool): Promise<void> {
  const rpcUrl = (config.rpc as Record<string, string>)[chain];
  if (!rpcUrl) {
    console.warn(`No RPC URL configured for chain: ${chain}`);
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contracts = CONTRACTS[chain];
  if (!contracts) return;

  for (const [token, contractAddress] of Object.entries(contracts) as [string, string][]) {
    if (contractAddress === '0x') continue;

    const erc20 = new ethers.Contract(contractAddress, ERC20_TRANSFER_ABI, provider);

    // Listen for Transfer events to any address we're watching.
    erc20.on('Transfer', async (from: string, to: string, value: bigint, eventObj: ethers.EventLog) => {
      // Check if `to` is one of our watched deposit addresses.
      const result = await db.query<DepositRow>(
        `SELECT id, merchant_id, address, chain, token, amount_units, payment_id
           FROM stablecoin_deposits
          WHERE LOWER(address) = LOWER($1)
            AND chain = $2
            AND token = $3
            AND status = 'pending'
          LIMIT 1`,
        [to, chain, token.toUpperCase()],
      );

      if (result.rows.length === 0) return;

      const deposit = result.rows[0];
      const amountFloat = Number(value) / Math.pow(10, STABLECOIN_DECIMALS);
      const txHash = eventObj.transactionHash;

      console.log(`[stablecoin-gateway] Transfer detected: ${amountFloat} ${token} on ${chain} → ${to} (tx: ${txHash})`);

      // Mark deposit as received (awaiting confirmations).
      await db.query(
        `UPDATE stablecoin_deposits
            SET status = 'confirming', received_amount_units = $1, tx_hash = $2, received_at = now()
          WHERE id = $3`,
        [value.toString(), txHash, deposit.id],
      );

      // Emit received event to unified-router immediately.
      await forwardToUnifiedRouter({
        eventId:     randomUUID(),
        type:        'stablecoin.payment.received',
        merchantId:  deposit.merchant_id,
        depositId:   deposit.id,
        chain,
        token:       token.toUpperCase() as 'USDC' | 'USDT',
        amountUnits: value.toString(),
        amountUsd:   amountFloat,
        txHash,
        fromAddress: from,
        toAddress:   to,
        occurredAt:  new Date().toISOString(),
      });

      // Wait for required confirmations, then mark confirmed.
      const required = (config.confirmations as Record<string, number>)[chain] ?? 12;
      try {
        await provider.waitForTransaction(txHash, required);
        await db.query(
          `UPDATE stablecoin_deposits SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
          [deposit.id],
        );
        await forwardToUnifiedRouter({
          eventId:     randomUUID(),
          type:        'stablecoin.payment.confirmed',
          merchantId:  deposit.merchant_id,
          depositId:   deposit.id,
          chain,
          token:       token.toUpperCase() as 'USDC' | 'USDT',
          amountUnits: value.toString(),
          amountUsd:   amountFloat,
          txHash,
          fromAddress: from,
          toAddress:   to,
          confirmedAt: new Date().toISOString(),
          occurredAt:  new Date().toISOString(),
        });
        console.log(`[stablecoin-gateway] Confirmed: deposit ${deposit.id}`);
      } catch (err) {
        console.error(`[stablecoin-gateway] Confirmation wait failed for ${txHash}:`, err);
      }
    });

    console.log(`[stablecoin-gateway] Monitoring ${token} on ${chain} (${contractAddress})`);
  }
}
