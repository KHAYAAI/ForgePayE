/**
 * FORGE Wallet key management & chain adapters.
 * ──────────────────────────────────────────────────────────────────────────────
 * - Ed25519 keypairs via node:crypto generateKeyPairSync('ed25519')
 * - Private keys encrypted at rest with AES-256-GCM where the key-encryption
 *   key (KEK) = scrypt(user password, per-user random salt). The plaintext
 *   private key is NEVER persisted and NEVER returned by any endpoint.
 * - Address derivation is a documented deterministic hash of the public key
 *   per chain (dev placeholder). Real chain derivation (secp256k1 keccak for
 *   EVM, base58 Ed25519 for Solana) lives behind the ChainAdapter interface.
 */

import {
  generateKeyPairSync,
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';
import type { Blockchain, BroadcastPayload, ChainAdapter, EncryptedKey } from './types';

// ── KDF / cipher parameters ───────────────────────────────────────────────────

export const KDF_PARAMS = { N: 16384, r: 8, p: 1, keyLen: 32 } as const;
const SALT_BYTES = 16;
const IV_BYTES = 12;

// ── Keypair generation ────────────────────────────────────────────────────────

export interface WalletKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateWalletKeypair(): WalletKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

// ── Password-derived envelope encryption (scrypt → AES-256-GCM) ───────────────

export function deriveKek(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KDF_PARAMS.keyLen, {
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
  });
}

export type KeyEnvelope = Pick<
  EncryptedKey,
  'ciphertextHex' | 'ivHex' | 'authTagHex' | 'saltHex' | 'kdf' | 'kdfParams' | 'cipher'
>;

/** Encrypt a PEM private key under a password-derived KEK. */
export function encryptPrivateKey(privateKeyPem: string, password: string): KeyEnvelope {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = deriveKek(password, salt);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyPem, 'utf8'), cipher.final()]);
  kek.fill(0); // best-effort scrub of key material
  return {
    ciphertextHex: ciphertext.toString('hex'),
    ivHex: iv.toString('hex'),
    authTagHex: cipher.getAuthTag().toString('hex'),
    saltHex: salt.toString('hex'),
    kdf: 'scrypt',
    kdfParams: { ...KDF_PARAMS },
    cipher: 'aes-256-gcm',
  };
}

/**
 * Decrypt a private key envelope. Throws on a wrong password (GCM auth tag
 * verification fails) — callers translate that into 401.
 */
export function decryptPrivateKey(envelope: KeyEnvelope, password: string): string {
  const kek = deriveKek(password, Buffer.from(envelope.saltHex, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(envelope.ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.authTagHex, 'hex'));
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertextHex, 'hex')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } finally {
    kek.fill(0);
  }
}

// ── Hashing / signing ─────────────────────────────────────────────────────────

export function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/** Canonical transaction hash (deterministic JSON of signing-relevant fields). */
export function transactionHash(fields: {
  from_address: string;
  to_address: string;
  amount: number;
  currency: string;
  blockchain: string;
  nonce: string;
}): Buffer {
  const canonical = [
    fields.blockchain,
    fields.from_address,
    fields.to_address,
    fields.amount.toString(),
    fields.currency,
    fields.nonce,
  ].join('|');
  return sha256(canonical);
}

export function signHash(txHash: Buffer, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return edSign(null, txHash, key).toString('hex');
}

export function verifySignature(txHash: Buffer, signatureHex: string, publicKeyPem: string): boolean {
  const key = createPublicKey(publicKeyPem);
  return edVerify(null, txHash, key, Buffer.from(signatureHex, 'hex'));
}

/** HMAC-SHA256 hex signature over a raw body — used for outbound webhooks. */
export function hmacSign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// ── Address derivation (documented deterministic dev placeholder) ─────────────
//
// dev derivation:
//   evm chains  → '0x' + last 40 hex chars of sha256('forge:<chain>:' + spkiDerHex)
//   solana      → base64url(sha256('forge:solana:' + spkiDerHex))[0..43]
//
// These are stable, collision-resistant identifiers suitable for routing and
// ledger accounting in dev/staging. Production adapters replace them with real
// chain derivation behind ChainAdapter.

function publicKeyDerHex(publicKeyPem: string): string {
  return createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }).toString('hex');
}

export function deriveAddress(chain: Blockchain, publicKeyPem: string): string {
  const digest = sha256(`forge:${chain}:${publicKeyDerHex(publicKeyPem)}`);
  if (chain === 'solana') {
    return digest.toString('base64url').slice(0, 44);
  }
  return `0x${digest.toString('hex').slice(-40)}`;
}

// ── Chain adapters ────────────────────────────────────────────────────────────

const BLOCKCHAIN_RPC_URL = () => process.env['BLOCKCHAIN_RPC_URL'] ?? '';

/**
 * Dev adapter: deterministic addresses, Ed25519 signing, simulated (or
 * RPC-forwarded when BLOCKCHAIN_RPC_URL is set) broadcast.
 */
export function makeDevAdapter(chain: Blockchain): ChainAdapter {
  return {
    chain,
    deriveAddress: (publicKeyPem) => deriveAddress(chain, publicKeyPem),
    signTransactionHash: (txHash, privateKeyPem) => signHash(txHash, privateKeyPem),
    async broadcast(payload: BroadcastPayload): Promise<string> {
      const rpcUrl = BLOCKCHAIN_RPC_URL();
      if (rpcUrl) {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_sendRawTransaction',
            params: [payload],
          }),
        });
        if (!res.ok) {
          throw new Error(`RPC broadcast failed with status ${res.status}`);
        }
        const json = (await res.json()) as { result?: string };
        if (json.result) return json.result;
        // RPC accepted but returned no hash — fall through to deterministic hash
      }
      // Simulated broadcast: tx hash = sha256 of the signed payload
      return `0x${sha256(JSON.stringify(payload)).toString('hex')}`;
    },
  };
}

export const CHAIN_ADAPTERS: Record<Blockchain, ChainAdapter> = {
  ethereum: makeDevAdapter('ethereum'),
  polygon: makeDevAdapter('polygon'),
  solana: makeDevAdapter('solana'),
};
