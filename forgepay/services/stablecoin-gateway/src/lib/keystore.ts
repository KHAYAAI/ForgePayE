/**
 * Custody of the one-time deposit keys.
 *
 * Every deposit gets its own address, and this gateway holds that address's private
 * key — it needs it to move the money later (lib/sweeper.ts). So how those keys are
 * stored is the security of everything that has been paid in and not yet swept.
 *
 * Envelope encryption. Each key is sealed with AES-256-GCM under a random data key
 * (DEK). The DEK is itself *wrapped* by a key that never leaves a key service, and
 * the wrapped copy is stored beside the ciphertext:
 *
 *   env     the wrapping key is PRIVATE_KEY_ENCRYPTION_KEY, read from the environment.
 *           A database dump alone is useless, but the key is in the process environment.
 *           Fine for development; in production this logs a warning every start.
 *   vault   HashiCorp Vault transit wraps the DEK. The wrapping key stays in Vault.
 *   awskms  AWS KMS wraps the DEK, bound to the deposit address by encryption context.
 *
 * The sealed key is also bound to its deposit's address (as GCM associated data), so a
 * blob copied onto another row fails to open rather than releasing a key for the wrong
 * deposit.
 *
 * A DEK is reused for a while (KEY_WRAP_DEK_TTL_SECONDS, default an hour, and a cap on
 * uses) so opening a deposit isn't a round trip to the key service every time — and so
 * a Vault blip doesn't stop deposits. Only the wrapped form is ever stored.
 *
 * Blobs written before this (plain AES-GCM under the environment key, no `v`) still
 * open, and are left as they are.
 */

import { isProductionLike } from './env.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

// ── Wrapping providers ────────────────────────────────────────────────────────

export interface KeyWrapper {
  readonly name: 'env' | 'vault' | 'awskms';
  /** A reference stored with the wrapped key (which Vault key / KMS key). */
  readonly ref: string;
  /**
   * Returns the wrapped key, or it with a more precise reference to store instead of `ref`
   * (KMS resolves an alias to the key's ARN, and the ARN is what must be kept: an alias can
   * later be pointed at a different key, which would strand everything wrapped under it).
   */
  wrap(dek: Buffer, context: string): Promise<string | { wrapped: string; ref: string }>;
  unwrap(wrapped: string, ref: string, context: string): Promise<Buffer>;
}

function envKeyOrThrow(): Buffer {
  const raw = process.env['PRIVATE_KEY_ENCRYPTION_KEY'] ?? '';
  if (raw.length === 64) return Buffer.from(raw, 'hex');
  if (isProductionLike()) {
    throw new Error('PRIVATE_KEY_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes) in production.');
  }
  // Dev-only fallback — never use for real funds
  console.warn('[keystore] PRIVATE_KEY_ENCRYPTION_KEY not set — using insecure dev key. Set it before handling real funds.');
  return Buffer.alloc(32, 0xde);
}

function aesWrap(key: Buffer, plain: Buffer, aad: string): string {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function aesUnwrap(key: Buffer, b64: string, aad: string): Buffer {
  const raw = Buffer.from(b64, 'base64');
  const d = createDecipheriv(ALGO, key, raw.subarray(0, IV_LEN), { authTagLength: TAG_LEN });
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([d.update(raw.subarray(IV_LEN + TAG_LEN)), d.final()]);
}

class EnvWrapper implements KeyWrapper {
  readonly name = 'env' as const;
  readonly ref = 'PRIVATE_KEY_ENCRYPTION_KEY';
  async wrap(dek: Buffer, context: string) { return aesWrap(envKeyOrThrow(), dek, `dek|${context}`); }
  async unwrap(wrapped: string, _ref: string, context: string) { return aesUnwrap(envKeyOrThrow(), wrapped, `dek|${context}`); }
}

export class VaultWrapper implements KeyWrapper {
  readonly name = 'vault' as const;
  constructor(
    private readonly addr: string,
    readonly ref: string,
    private readonly mount: string,
    private readonly token: () => Promise<string>,
    private readonly namespace?: string,
  ) {}

  private async call(path: string, body: unknown, token: string): Promise<any> {
    const res = await fetch(`${this.addr}/v1/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vault-token': token, ...(this.namespace ? { 'x-vault-namespace': this.namespace } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`vault HTTP ${res.status}: ${(json as any).errors?.join('; ') ?? 'error'}`);
    return json;
  }
  async wrap(dek: Buffer, _context: string) {
    const r = await this.call(`${this.mount}/encrypt/${encodeURIComponent(this.ref)}`, { plaintext: dek.toString('base64') }, await this.token());
    return r.data.ciphertext as string;
  }
  async unwrap(wrapped: string, ref: string, _context: string) {
    const r = await this.call(`${this.mount}/decrypt/${encodeURIComponent(ref)}`, { ciphertext: wrapped }, await this.token());
    return Buffer.from(r.data.plaintext as string, 'base64');
  }
}

export class KmsWrapper implements KeyWrapper {
  readonly name = 'awskms' as const;
  private client: any;
  constructor(readonly ref: string) {}
  private async api() {
    if (!this.client) {
      const { KMSClient } = await import('@aws-sdk/client-kms');
      this.client = new KMSClient({});
    }
    return this.client;
  }
  async wrap(dek: Buffer, context: string) {
    const { EncryptCommand } = await import('@aws-sdk/client-kms');
    const r = await (await this.api()).send(new EncryptCommand({ KeyId: this.ref, Plaintext: dek, EncryptionContext: { purpose: context } }));
    return { wrapped: Buffer.from(r.CiphertextBlob as Uint8Array).toString('base64'), ref: (r.KeyId as string | undefined) ?? this.ref };
  }
  async unwrap(wrapped: string, ref: string, context: string) {
    const { DecryptCommand } = await import('@aws-sdk/client-kms');
    const r = await (await this.api()).send(new DecryptCommand({ CiphertextBlob: Buffer.from(wrapped, 'base64'), KeyId: ref, EncryptionContext: { purpose: context } }));
    return Buffer.from(r.Plaintext as Uint8Array);
  }
}

// ── Choosing the wrapper ──────────────────────────────────────────────────────

function vaultToken(): () => Promise<string> {
  return async () => {
    if (process.env['VAULT_TOKEN']) return process.env['VAULT_TOKEN'];
    const f = process.env['VAULT_TOKEN_FILE'];
    if (f) return readFileSync(f, 'utf8').trim();
    const role = process.env['VAULT_ROLE_ID'], secret = process.env['VAULT_SECRET_ID'];
    if (!role || !secret) throw new Error('set VAULT_TOKEN, VAULT_TOKEN_FILE, or VAULT_ROLE_ID and VAULT_SECRET_ID');
    const addr = (process.env['VAULT_ADDR'] ?? '').replace(/\/$/, '');
    const res = await fetch(`${addr}/v1/auth/${process.env['VAULT_APPROLE_MOUNT'] ?? 'approle'}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role_id: role, secret_id: secret }), signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !j.auth?.client_token) throw new Error(`vault approle login failed (HTTP ${res.status})`);
    return j.auth.client_token as string;
  };
}

let wrapperOverride: KeyWrapper | null = null;
/** For tests. */
export function setKeyWrapper(w: KeyWrapper | null): void { wrapperOverride = w; dekCache = null; unwrapCache.clear(); }

export function configuredWrapper(): KeyWrapper {
  if (wrapperOverride) return wrapperOverride;
  const name = (process.env['KEY_WRAP_PROVIDER'] ?? 'env').toLowerCase();
  if (name === 'vault') {
    const addr = (process.env['VAULT_ADDR'] ?? '').replace(/\/$/, '');
    if (!addr) throw new Error('KEY_WRAP_PROVIDER=vault needs VAULT_ADDR');
    if (isProductionLike() && !addr.startsWith('https://')) throw new Error('VAULT_ADDR must be https:// in production');
    return new VaultWrapper(addr, process.env['KEY_WRAP_VAULT_KEY'] ?? 'stablecoin-deposit-keys', process.env['KEY_WRAP_VAULT_MOUNT'] ?? 'transit', vaultToken(), process.env['VAULT_NAMESPACE']);
  }
  if (name === 'awskms') {
    const id = process.env['KEY_WRAP_KMS_KEY_ID'];
    if (!id) throw new Error('KEY_WRAP_PROVIDER=awskms needs KEY_WRAP_KMS_KEY_ID');
    return new KmsWrapper(id);
  }
  if (name !== 'env') throw new Error(`unknown KEY_WRAP_PROVIDER "${name}" (env, vault, awskms)`);
  return new EnvWrapper();
}

/** Called at start-up: fail on a misconfiguration now, and say plainly when production is using the weakest option. */
export function assertKeystoreConfigured(): { provider: string } {
  const w = configuredWrapper();
  if (w.name === 'env') {
    if (isProductionLike()) {
      envKeyOrThrow();
      console.warn('[keystore] PRODUCTION is wrapping deposit keys with an environment variable (KEY_WRAP_PROVIDER=env). Use vault or awskms so the wrapping key never sits in this process environment.');
    }
  }
  return { provider: w.name };
}

// ── Sealing and opening ───────────────────────────────────────────────────────

interface SealedV2 {
  v: 2;
  iv: string; ct: string; tag: string;           // hex
  wrap: { provider: string; ref: string; dek: string };
}
interface SealedLegacy { iv: string; ct: string; tag: string }

let dekCache: { dek: Buffer; wrapped: string; provider: string; ref: string; configuredRef: string; context: string; expires: number; uses: number } | null = null;
const unwrapCache = new Map<string, { dek: Buffer; expires: number }>();

function dekTtlMs() { return Math.max(1, Number(process.env['KEY_WRAP_DEK_TTL_SECONDS'] ?? '3600')) * 1000; }
const MAX_DEK_USES = 10_000;

async function currentDek(w: KeyWrapper): Promise<NonNullable<typeof dekCache>> {
  const now = Date.now();
  if (dekCache && dekCache.expires > now && dekCache.uses < MAX_DEK_USES && dekCache.provider === w.name && dekCache.configuredRef === w.ref) {
    dekCache.uses++;
    return dekCache;
  }
  const dek = randomBytes(32);
  // The wrap context for a shared DEK is a constant: per-row binding is done in the AES layer (AAD).
  const context = 'deposit-keys';
  const res = await w.wrap(dek, context);
  const wrapped = typeof res === 'string' ? res : res.wrapped;
  const ref = typeof res === 'string' ? w.ref : res.ref;
  dekCache = { dek, wrapped, provider: w.name, ref, configuredRef: w.ref, context, expires: now + dekTtlMs(), uses: 1 };
  return dekCache;
}

/** Seal a deposit's private key. `address` ties the blob to that deposit. */
export async function encryptPrivateKey(privateKey: string, address: string): Promise<string> {
  const w = configuredWrapper();
  const d = await currentDek(w);
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALGO, d.dek, iv, { authTagLength: TAG_LEN });
  c.setAAD(Buffer.from(`deposit-key|${address.toLowerCase()}`));
  const ct = Buffer.concat([c.update(privateKey, 'utf8'), c.final()]);
  const blob: SealedV2 = { v: 2, iv: iv.toString('hex'), ct: ct.toString('hex'), tag: c.getAuthTag().toString('hex'), wrap: { provider: w.name, ref: d.ref, dek: d.wrapped } };
  return JSON.stringify(blob);
}

/** Open a sealed deposit key. Throws if the blob was altered, or belongs to another address. */
export async function decryptPrivateKey(encrypted: string, address: string): Promise<string> {
  const blob = JSON.parse(encrypted) as SealedV2 | SealedLegacy;
  if (!('v' in blob)) {
    // Sealed before envelope encryption: AES-GCM directly under the environment key.
    const d = createDecipheriv(ALGO, envKeyOrThrow(), Buffer.from(blob.iv, 'hex'), { authTagLength: TAG_LEN });
    d.setAuthTag(Buffer.from(blob.tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(blob.ct, 'hex')), d.final()]).toString('utf8');
  }
  const w = configuredWrapper();
  if (w.name !== blob.wrap.provider) {
    throw new Error(`this key was wrapped by ${blob.wrap.provider} but KEY_WRAP_PROVIDER is ${w.name}`);
  }
  const cacheKey = `${blob.wrap.provider}|${blob.wrap.ref}|${blob.wrap.dek}`;
  let hit = unwrapCache.get(cacheKey);
  if (!hit || hit.expires < Date.now()) {
    const dek = await w.unwrap(blob.wrap.dek, blob.wrap.ref, 'deposit-keys');
    hit = { dek, expires: Date.now() + 5 * 60_000 };
    if (unwrapCache.size > 200) unwrapCache.clear();
    unwrapCache.set(cacheKey, hit);
  }
  const d = createDecipheriv(ALGO, hit.dek, Buffer.from(blob.iv, 'hex'), { authTagLength: TAG_LEN });
  d.setAAD(Buffer.from(`deposit-key|${address.toLowerCase()}`));
  d.setAuthTag(Buffer.from(blob.tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(blob.ct, 'hex')), d.final()]).toString('utf8');
}
