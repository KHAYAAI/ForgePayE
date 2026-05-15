/**
 * BIP32 HD wallet address derivation for crypto-gateway.
 *
 * Derives a unique deposit address per invoice without storing private keys in
 * the DB. The private key for any address can always be recovered offline with:
 *   seed + coin derivation path + key_index stored on the invoice row.
 *
 * Derivation paths:
 *   BTC  m/84'/0'/0'/0/{index}   P2WPKH native segwit  (bc1q…)
 *   ETH  m/44'/60'/0'/0/{index}  EOA                   (0x…)
 *   LTC  m/84'/2'/0'/0/{index}   P2WPKH-LTC            (ltc1q…)
 *   XMR  Monero subaddress via daemon RPC               (4…)
 *
 * HD_WALLET_SEED: 32–64 byte hex string. REQUIRED in production.
 *   Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
 *   Store in: Kubernetes Secret / AWS Secrets Manager / Vault.
 *
 * NOTE: only public-key derivation is strictly required for address generation.
 *   A future hardening pass can replace this with xpub-only derivation so the
 *   seed never enters the gateway process at all.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';

const bip32 = BIP32Factory(ecc);

// Litecoin mainnet network params
const LTC_NETWORK: bitcoin.Network = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32:     'ltc',
  bip32:      { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif:        0xb0,
};

let _rootSeed: Buffer | null = null;

function getRootSeed(): Buffer {
  if (_rootSeed) return _rootSeed;
  const raw = process.env['HD_WALLET_SEED'] ?? '';
  if (!raw) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('HD_WALLET_SEED is required in production');
    }
    console.warn(
      '[hdwallet] HD_WALLET_SEED not set — using insecure deterministic dev seed. ' +
      'This seed controls real addresses if accidentally pointed at mainnet. ' +
      'Set HD_WALLET_SEED before handling real funds.',
    );
    _rootSeed = Buffer.alloc(32, 0xdf);   // dev-only: all 0xdf bytes, no real funds
  } else {
    const buf = Buffer.from(raw, 'hex');
    if (buf.length < 16) throw new Error('HD_WALLET_SEED must be at least 32 hex chars');
    _rootSeed = buf;
  }
  return _rootSeed;
}

export function deriveBtcAddress(index: number): string {
  const root = bip32.fromSeed(getRootSeed(), bitcoin.networks.bitcoin);
  const child = root.derivePath(`m/84'/0'/0'/0/${index}`);
  const { address } = bitcoin.payments.p2wpkh({
    pubkey:  Buffer.from(child.publicKey),
    network: bitcoin.networks.bitcoin,
  });
  if (!address) throw new Error(`BTC address derivation failed at index ${index}`);
  return address;
}

export function deriveLtcAddress(index: number): string {
  const root  = bip32.fromSeed(getRootSeed(), LTC_NETWORK);
  const child = root.derivePath(`m/84'/2'/0'/0/${index}`);
  const { address } = bitcoin.payments.p2wpkh({
    pubkey:  Buffer.from(child.publicKey),
    network: LTC_NETWORK,
  });
  if (!address) throw new Error(`LTC address derivation failed at index ${index}`);
  return address;
}

export async function deriveEthAddress(index: number): Promise<string> {
  const { HDNodeWallet } = await import('ethers');
  const seedHex = getRootSeed().toString('hex').padEnd(64, '0').slice(0, 64);
  const root    = HDNodeWallet.fromSeed(`0x${seedHex}`);
  const child   = root.derivePath(`m/44'/60'/0'/0/${index}`);
  return child.address;   // EIP-55 checksummed
}

export async function deriveXmrAddress(index: number): Promise<string> {
  const rpcUrl = process.env['XMR_RPC_URL'] ?? '';
  if (!rpcUrl) {
    throw new Error(
      'XMR_RPC_URL is required for XMR payments. ' +
      'Point it to a Monero daemon with wallet RPC enabled (--rpc-bind-port 18082).',
    );
  }
  const res = await fetch(`${rpcUrl}/json_rpc`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id:      '0',
      method:  'create_address',
      params:  { account_index: 0, count: 1, label: `invoice-${index}` },
    }),
  });
  if (!res.ok) throw new Error(`Monero RPC HTTP error: ${res.status}`);
  const json = await res.json() as {
    result?: { addresses: string[] };
    error?:  { message: string };
  };
  if (json.error) throw new Error(`Monero RPC: ${json.error.message}`);
  const addr = json.result?.addresses?.[0];
  if (!addr) throw new Error('Monero RPC returned no address');
  return addr;
}

/** Atomically claim the next derivation index for a coin. */
export async function nextKeyIndex(
  db: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ used_index: number }> }> },
  coin: string,
): Promise<number> {
  const result = await db.query(
    `UPDATE crypto_hd_counters
        SET next_index = next_index + 1
      WHERE coin = $1
  RETURNING next_index - 1 AS used_index`,
    [coin],
  );
  if (result.rows.length === 0) throw new Error(`No HD counter row for coin ${coin}`);
  return result.rows[0].used_index;
}
