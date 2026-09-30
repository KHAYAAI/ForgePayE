import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createCipheriv, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { encryptPrivateKey, decryptPrivateKey, setKeyWrapper, configuredWrapper, assertKeystoreConfigured, VaultWrapper } from '../src/lib/keystore.js';

const KEY = '0x' + '11'.repeat(32);
const ADDR = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const env = { ...process.env };
beforeEach(() => { process.env['PRIVATE_KEY_ENCRYPTION_KEY'] = 'ab'.repeat(32); setKeyWrapper(null); });
afterEach(() => { process.env = { ...env }; setKeyWrapper(null); });

describe('deposit key custody — env wrapping', () => {
  it('seals and opens a key, and the ciphertext does not contain it', async () => {
    const sealed = await encryptPrivateKey(KEY, ADDR);
    expect(sealed).not.toContain(KEY.slice(2));
    expect(JSON.parse(sealed)).toMatchObject({ v: 2, wrap: { provider: 'env' } });
    expect(await decryptPrivateKey(sealed, ADDR)).toBe(KEY);
  });

  it('is bound to its address: the blob moved to another deposit does not open', async () => {
    const sealed = await encryptPrivateKey(KEY, ADDR);
    await expect(decryptPrivateKey(sealed, OTHER)).rejects.toThrow();
    expect(await decryptPrivateKey(sealed, ADDR.toUpperCase().replace('0X', '0x'))).toBe(KEY); // case of the address doesn't matter
  });

  it('fails if any part was altered', async () => {
    const b = JSON.parse(await encryptPrivateKey(KEY, ADDR));
    for (const field of ['ct', 'tag', 'iv']) {
      const t = { ...b, [field]: (b[field][0] === 'a' ? 'b' : 'a') + b[field].slice(1) };
      await expect(decryptPrivateKey(JSON.stringify(t), ADDR)).rejects.toThrow();
    }
    const w = { ...b, wrap: { ...b.wrap, dek: Buffer.from('x'.repeat(60)).toString('base64') } };
    await expect(decryptPrivateKey(JSON.stringify(w), ADDR)).rejects.toThrow();
  });

  it('fails with the wrong wrapping key', async () => {
    const sealed = await encryptPrivateKey(KEY, ADDR);
    process.env['PRIVATE_KEY_ENCRYPTION_KEY'] = 'cd'.repeat(32);
    setKeyWrapper(null);
    await expect(decryptPrivateKey(sealed, ADDR)).rejects.toThrow();
  });

  it('still opens a key sealed the old way (plain AES-GCM under the environment key)', async () => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', Buffer.from('ab'.repeat(32), 'hex'), iv, { authTagLength: 16 });
    const ct = Buffer.concat([c.update(KEY, 'utf8'), c.final()]);
    const legacy = JSON.stringify({ iv: iv.toString('hex'), ct: ct.toString('hex'), tag: c.getAuthTag().toString('hex') });
    expect(await decryptPrivateKey(legacy, ADDR)).toBe(KEY);
  });

  it('reuses one wrapped data key across deposits (not a key-service call each), each with its own nonce', async () => {
    let wraps = 0;
    const real = configuredWrapper();
    setKeyWrapper({ name: 'env', ref: real.ref, wrap: async (d, c) => { wraps++; return real.wrap(d, c); }, unwrap: (w, r, c) => real.unwrap(w, r, c) });
    const a = JSON.parse(await encryptPrivateKey(KEY, ADDR));
    const b = JSON.parse(await encryptPrivateKey(KEY, OTHER));
    expect(wraps).toBe(1);
    expect(a.wrap.dek).toBe(b.wrap.dek);
    expect(a.iv).not.toBe(b.iv);
  });

  it('rotates the data key after its lifetime', async () => {
    process.env['KEY_WRAP_DEK_TTL_SECONDS'] = '1';
    let wraps = 0;
    const real = configuredWrapper();
    setKeyWrapper({ name: 'env', ref: real.ref, wrap: async (d, c) => { wraps++; return real.wrap(d, c); }, unwrap: (w, r, c) => real.unwrap(w, r, c) });
    await encryptPrivateKey(KEY, ADDR);
    await new Promise((r) => setTimeout(r, 1100));
    await encryptPrivateKey(KEY, ADDR);
    expect(wraps).toBe(2);
  });

  it('refuses a key sealed by one provider when configured for another', async () => {
    const sealed = JSON.parse(await encryptPrivateKey(KEY, ADDR));
    sealed.wrap.provider = 'vault';
    await expect(decryptPrivateKey(JSON.stringify(sealed), ADDR)).rejects.toThrow(/wrapped by vault/);
  });

  it('production still requires the environment key, and says plainly that env wrapping is the weak option', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['PRIVATE_KEY_ENCRYPTION_KEY'] = '';
    expect(() => assertKeystoreConfigured()).toThrow(/must be set/);
    process.env['PRIVATE_KEY_ENCRYPTION_KEY'] = 'ab'.repeat(32);
    const warnings: string[] = [];
    const orig = console.warn; console.warn = (m: string) => { warnings.push(String(m)); };
    try { expect(assertKeystoreConfigured().provider).toBe('env'); } finally { console.warn = orig; }
    expect(warnings.join(' ')).toMatch(/environment variable/);
  });

  it('rejects unknown providers and incomplete configuration', () => {
    process.env['KEY_WRAP_PROVIDER'] = 'nope';
    expect(() => configuredWrapper()).toThrow(/unknown KEY_WRAP_PROVIDER/);
    process.env['KEY_WRAP_PROVIDER'] = 'vault'; delete process.env['VAULT_ADDR'];
    expect(() => configuredWrapper()).toThrow(/VAULT_ADDR/);
    process.env['VAULT_ADDR'] = 'http://v:8200'; process.env['NODE_ENV'] = 'production';
    expect(() => configuredWrapper()).toThrow(/https/);
    process.env['KEY_WRAP_PROVIDER'] = 'awskms'; delete process.env['KEY_WRAP_KMS_KEY_ID'];
    expect(() => configuredWrapper()).toThrow(/KEY_WRAP_KMS_KEY_ID/);
  });
});

// A stand-in for Vault's transit engine: "encrypts" by tagging with the key name.
function startFakeVault(token: string): Promise<{ server: Server; url: string; calls: string[] }> {
  const calls: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c));
      req.on('end', () => {
        calls.push(req.url ?? '');
        res.setHeader('content-type', 'application/json');
        if (req.headers['x-vault-token'] !== token) { res.statusCode = 403; return res.end(JSON.stringify({ errors: ['permission denied'] })); }
        const parts = (req.url ?? '').split('/'); // '', v1, transit, op, key
        const j = JSON.parse(body || '{}');
        if (parts[3] === 'encrypt') return res.end(JSON.stringify({ data: { ciphertext: `vault:v1:${parts[4]}:${j.plaintext}` } }));
        if (parts[3] === 'decrypt') {
          const [, , key, pt] = String(j.ciphertext).split(':');
          if (key !== parts[4]) { res.statusCode = 400; return res.end(JSON.stringify({ errors: ['wrong key'] })); }
          return res.end(JSON.stringify({ data: { plaintext: pt } }));
        }
        res.statusCode = 404; res.end('{}');
      });
    }).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls }));
  });
}

describe('deposit key custody — Vault transit', () => {
  it('wraps the data key in Vault and opens it again; the key itself never goes to Vault', async () => {
    const v = await startFakeVault('tok');
    try {
      process.env['KEY_WRAP_PROVIDER'] = 'vault'; process.env['VAULT_ADDR'] = v.url; process.env['VAULT_TOKEN'] = 'tok';
      const sealed = await encryptPrivateKey(KEY, ADDR);
      expect(JSON.parse(sealed).wrap).toMatchObject({ provider: 'vault', ref: 'stablecoin-deposit-keys' });
      expect(sealed).not.toContain(KEY.slice(2));
      expect(await decryptPrivateKey(sealed, ADDR)).toBe(KEY);
      await expect(decryptPrivateKey(sealed, OTHER)).rejects.toThrow(); // still bound to the address
      expect(v.calls.some((c) => c.includes('/encrypt/'))).toBe(true);
    } finally { v.server.close(); }
  });

  it('cannot open keys when Vault refuses or is unreachable', async () => {
    const v = await startFakeVault('tok');
    try {
      process.env['KEY_WRAP_PROVIDER'] = 'vault'; process.env['VAULT_ADDR'] = v.url; process.env['VAULT_TOKEN'] = 'tok';
      const sealed = await encryptPrivateKey(KEY, ADDR);
      setKeyWrapper(null); // forget the cached data key
      process.env['VAULT_TOKEN'] = 'wrong';
      await expect(decryptPrivateKey(sealed, ADDR)).rejects.toThrow(/permission denied/);
    } finally { v.server.close(); }
    setKeyWrapper(null);
    process.env['VAULT_ADDR'] = 'http://127.0.0.1:1'; process.env['VAULT_TOKEN'] = 'tok';
    const sealed2 = JSON.stringify({ v: 2, iv: '00', ct: '00', tag: '00', wrap: { provider: 'vault', ref: 'k', dek: 'vault:v1:k:AAAA' } });
    await expect(decryptPrivateKey(sealed2, ADDR)).rejects.toThrow();
  });

  it('VaultWrapper uses the key name and mount it is given', async () => {
    const v = await startFakeVault('t');
    try {
      const w = new VaultWrapper(v.url, 'my-key', 'transit', async () => 't');
      const wrapped = await w.wrap(Buffer.from('dek'), 'x');
      expect(wrapped).toContain('my-key');
      expect((await w.unwrap(wrapped, 'my-key', 'x')).toString()).toBe('dek');
      await expect(w.unwrap(wrapped, 'other-key', 'x')).rejects.toThrow(/wrong key/);
    } finally { v.server.close(); }
  });
});

// A stand-in for AWS KMS's JSON protocol (Encrypt / Decrypt with an encryption context).
function startFakeKms(): Promise<{ server: Server; url: string }> {
  const store = new Map<string, { pt: string; ctx: string }>();
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body || '{}');
        res.setHeader('content-type', 'application/x-amz-json-1.1');
        const target = String(req.headers['x-amz-target']);
        if (target.endsWith('.Encrypt')) {
          const blob = randomBytes(16).toString('base64');
          store.set(blob, { pt: j.Plaintext, ctx: JSON.stringify(j.EncryptionContext) });
          return res.end(JSON.stringify({ CiphertextBlob: blob, KeyId: j.KeyId }));
        }
        if (target.endsWith('.Decrypt')) {
          const e = store.get(j.CiphertextBlob);
          if (!e || e.ctx !== JSON.stringify(j.EncryptionContext)) { res.statusCode = 400; return res.end(JSON.stringify({ __type: 'InvalidCiphertextException', message: 'context mismatch' })); }
          return res.end(JSON.stringify({ Plaintext: e.pt, KeyId: j.KeyId }));
        }
        res.statusCode = 400; res.end('{}');
      });
    }).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

describe('deposit key custody — AWS KMS', () => {
  it('wraps with KMS (against a fake speaking its protocol) and opens again', async () => {
    const k = await startFakeKms();
    try {
      Object.assign(process.env, { KEY_WRAP_PROVIDER: 'awskms', KEY_WRAP_KMS_KEY_ID: 'alias/deposit-keys', AWS_ENDPOINT_URL_KMS: k.url, AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 't', AWS_SECRET_ACCESS_KEY: 't' });
      const sealed = await encryptPrivateKey(KEY, ADDR);
      expect(JSON.parse(sealed).wrap).toMatchObject({ provider: 'awskms', ref: 'alias/deposit-keys' });
      expect(await decryptPrivateKey(sealed, ADDR)).toBe(KEY);
      await expect(decryptPrivateKey(sealed, OTHER)).rejects.toThrow();
    } finally { k.server.close(); }
  });
});
