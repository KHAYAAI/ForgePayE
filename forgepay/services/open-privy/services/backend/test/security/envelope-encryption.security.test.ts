import * as crypto from 'crypto';
import { EncryptionService } from '../../src/common/encryption/encryption.service';
import { LocalKeyWrapper, resolveKeyWrapper, AwsKmsKeyWrapper, KeyWrapper } from '../../src/common/encryption/key-wrapper';
import { evmChainAllowed } from '../../src/modules/wallet/chain-policy';

/**
 * SECURITY TEST: envelope encryption of wallet keys.
 *
 * Every wallet key used to be encrypted under a key derived from one master
 * key held in this process, so the master key opened every wallet. Each key
 * now gets its own data key, wrapped by KMS (or, in development, a local KEK)
 * with the owner's user id bound in.
 */
describe('Envelope encryption', () => {
  const masterKey = crypto.randomBytes(32).toString('base64');

  /** Records every unwrap, the way KMS would log it. */
  class RecordingWrapper implements KeyWrapper {
    readonly kind = 'local' as const;
    readonly unwraps: Array<Record<string, string>> = [];
    private inner = new LocalKeyWrapper(crypto.randomBytes(32));
    wrap(k: Buffer, c: Record<string, string>) { return this.inner.wrap(k, c); }
    unwrap(w: Buffer, c: Record<string, string>) { this.unwraps.push(c); return this.inner.unwrap(w, c); }
  }

  it('uses a different data key for every encryption, and round-trips', async () => {
    const wrapper = new RecordingWrapper();
    const svc = new EncryptionService(masterKey, wrapper);
    const a = await svc.encrypt('0xprivate', 'user-1');
    const b = await svc.encrypt('0xprivate', 'user-1');
    expect(a.split(':')[1]).not.toEqual(b.split(':')[1]);
    expect(await svc.decrypt(a, 'user-1')).toBe('0xprivate');
    expect(wrapper.unwraps).toEqual([{ purpose: 'wallet-private-key', userId: 'user-1' }]);
  });

  it('the master key alone no longer opens a wallet', async () => {
    const svc = new EncryptionService(masterKey, new LocalKeyWrapper(crypto.randomBytes(32)));
    const enc = await svc.encrypt('0xprivate', 'user-1');
    // Same master key, different key-encryption key (another deployment, or an attacker with only the master key)
    const other = new EncryptionService(masterKey, new LocalKeyWrapper(crypto.randomBytes(32)));
    await expect(other.decrypt(enc, 'user-1')).rejects.toThrow('tampering detected');
  });

  it('a wrapped key cannot be unwrapped for another user', async () => {
    const svc = new EncryptionService(masterKey, new LocalKeyWrapper(crypto.randomBytes(32)));
    const enc = await svc.encrypt('0xprivate', 'user-1');
    await expect(svc.decrypt(enc, 'user-2')).rejects.toThrow('tampering detected');
  });

  it('legacy (master-key-derived) data still decrypts and is identified as legacy', async () => {
    const svc = new EncryptionService(masterKey, new LocalKeyWrapper(crypto.randomBytes(32)));
    const userKey = await svc.deriveUserKey('user-1');
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv('aes-256-gcm', userKey, iv);
    let ct = c.update('0xlegacy', 'utf8', 'hex'); ct += c.final('hex');
    const legacy = `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${ct}`;
    expect(EncryptionService.isLegacy(legacy)).toBe(true);
    expect(await svc.decrypt(legacy, 'user-1')).toBe('0xlegacy');
    expect(EncryptionService.isLegacy(await svc.encrypt('x', 'user-1'))).toBe(false);
  });

  it('production requires KMS unless a local KEK is explicitly allowed', () => {
    const kek = crypto.randomBytes(32);
    expect(() => resolveKeyWrapper(kek, { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/WALLET_KMS_KEY_ID/);
    expect(resolveKeyWrapper(kek, { NODE_ENV: 'production', WALLET_KMS_KEY_ID: 'alias/wallet' } as NodeJS.ProcessEnv)).toBeInstanceOf(AwsKmsKeyWrapper);
    expect(resolveKeyWrapper(kek, { NODE_ENV: 'production', WALLET_ALLOW_LOCAL_KEK: 'true' } as NodeJS.ProcessEnv).kind).toBe('local');
  });
});

describe('Testnet-only signing', () => {
  it('allows Sepolia, Amoy and Base Sepolia; refuses mainnets unless enabled', () => {
    expect(evmChainAllowed(11155111n, {} as NodeJS.ProcessEnv)).toBe(true);
    expect(evmChainAllowed(80002n, {} as NodeJS.ProcessEnv)).toBe(true);
    expect(evmChainAllowed(1n, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(evmChainAllowed(137n, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(evmChainAllowed(137n, { WALLET_MAINNET_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});
