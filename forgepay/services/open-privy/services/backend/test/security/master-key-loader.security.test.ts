import { extractKey, loadMasterKey } from '../../src/common/encryption/master-key.loader';

/**
 * The master key may arrive from Secrets Manager either as the raw base64 key
 * or wrapped in a JSON object. It must be extracted correctly and never
 * silently mangled.
 */
describe('master-key loader', () => {
  const OLD = process.env.ENCRYPTION_MASTER_KEY;
  const OLD_ARN = process.env.ENCRYPTION_MASTER_KEY_SECRET_ARN;

  afterEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = OLD;
    if (OLD_ARN === undefined) delete process.env.ENCRYPTION_MASTER_KEY_SECRET_ARN;
    else process.env.ENCRYPTION_MASTER_KEY_SECRET_ARN = OLD_ARN;
  });

  describe('extractKey', () => {
    it('returns a raw (non-JSON) secret unchanged', () => {
      const raw = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      expect(extractKey(raw)).toBe(raw);
    });

    it('unwraps a JSON secret with ENCRYPTION_MASTER_KEY', () => {
      const key = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
      expect(extractKey(JSON.stringify({ ENCRYPTION_MASTER_KEY: key }))).toBe(key);
    });

    it('falls back to the whole string for unrelated JSON', () => {
      const s = JSON.stringify({ other: 'value' });
      expect(extractKey(s)).toBe(s);
    });
  });

  describe('loadMasterKey (env path)', () => {
    it('returns the env key when no secret ARN is set', async () => {
      delete process.env.ENCRYPTION_MASTER_KEY_SECRET_ARN;
      process.env.ENCRYPTION_MASTER_KEY = 'env-provided-key';
      await expect(loadMasterKey()).resolves.toBe('env-provided-key');
    });

    it('throws when neither ARN nor env key is set', async () => {
      delete process.env.ENCRYPTION_MASTER_KEY_SECRET_ARN;
      delete process.env.ENCRYPTION_MASTER_KEY;
      await expect(loadMasterKey()).rejects.toThrow('No master key configured');
    });
  });
});
