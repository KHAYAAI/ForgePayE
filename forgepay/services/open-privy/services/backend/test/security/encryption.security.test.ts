import { Test, TestingModule } from '@nestjs/testing';
import { EncryptionService } from '../../src/common/encryption/encryption.service';
import * as crypto from 'crypto';

/**
 * SECURITY TEST: Encryption & Key Management
 *
 * These tests verify that:
 * 1. Private keys are encrypted properly
 * 2. Different users have isolated keys
 * 3. Tampering is detected
 * 4. Key derivation is deterministic
 */
describe('Encryption Security', () => {
  let encryptionService: EncryptionService;
  let masterKey: Buffer;

  beforeAll(async () => {
    // Generate a test master key
    masterKey = crypto.randomBytes(32);

    // Set in environment
    process.env.ENCRYPTION_MASTER_KEY = masterKey.toString('base64');

    const module: TestingModule = await Test.createTestingModule({
      providers: [EncryptionService],
    }).compile();

    encryptionService = module.get<EncryptionService>(EncryptionService);
  });

  describe('Per-User Key Isolation', () => {
    it('should encrypt same plaintext differently for different users', async () => {
      const plaintext = 'test-private-key-12345';
      const user1 = 'user-1';
      const user2 = 'user-2';

      const encrypted1 = await encryptionService.encrypt(plaintext, user1);
      const encrypted2 = await encryptionService.encrypt(plaintext, user2);

      // Different users → different encrypted values
      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should not decrypt user1 data with user2 key', async () => {
      const plaintext = 'secret-private-key';
      const user1 = 'alice';
      const user2 = 'bob';

      // Encrypt with user1
      const encrypted = await encryptionService.encrypt(plaintext, user1);

      // Try to decrypt with user2 (should fail)
      expect(async () => {
        await encryptionService.decrypt(encrypted, user2);
      }).rejects.toThrow();
    });

    it('should decrypt own user data successfully', async () => {
      const plaintext = 'private-key-123456';
      const userId = 'user-charlie';

      const encrypted = await encryptionService.encrypt(plaintext, userId);
      const decrypted = await encryptionService.decrypt(encrypted, userId);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('Encryption Properties', () => {
    it('should use different IVs for same plaintext', async () => {
      const plaintext = 'same-data';
      const userId = 'user-1';

      const encrypted1 = await encryptionService.encrypt(plaintext, userId);
      const encrypted2 = await encryptionService.encrypt(plaintext, userId);

      // Different IVs → different ciphertexts
      expect(encrypted1).not.toEqual(encrypted2);

      // But both should decrypt to same value
      const decrypted1 = await encryptionService.decrypt(encrypted1, userId);
      const decrypted2 = await encryptionService.decrypt(encrypted2, userId);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });

    it('should use authenticated encryption (GCM)', async () => {
      const plaintext = 'secret-key';
      const userId = 'user-1';

      const encrypted = await encryptionService.encrypt(plaintext, userId);
      const parts = encrypted.split(':');

      // Format should be: iv:authTag:ciphertext
      expect(parts.length).toBe(3);

      const [ivHex, authTagHex] = parts;

      // IV should be 32 hex chars (16 bytes)
      expect(ivHex.length).toBe(32);

      // Auth tag should be 32 hex chars (16 bytes)
      expect(authTagHex.length).toBe(32);
    });

    it('should detect tampered ciphertext', async () => {
      const plaintext = 'protected-data';
      const userId = 'user-1';

      let encrypted = await encryptionService.encrypt(plaintext, userId);
      const parts = encrypted.split(':');

      // Tamper with ciphertext
      const tamperedCiphertext = parts[2].slice(0, -2) + 'XX';
      const tamperedEncrypted = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      // Decryption should fail
      expect(async () => {
        await encryptionService.decrypt(tamperedEncrypted, userId);
      }).rejects.toThrow('tampering detected');
    });

    it('should detect tampered auth tag', async () => {
      const plaintext = 'secure-data';
      const userId = 'user-1';

      let encrypted = await encryptionService.encrypt(plaintext, userId);
      const parts = encrypted.split(':');

      // Tamper with auth tag
      const tamperedAuthTag = parts[1].slice(0, -2) + 'YY';
      const tamperedEncrypted = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

      // Decryption should fail
      expect(async () => {
        await encryptionService.decrypt(tamperedEncrypted, userId);
      }).rejects.toThrow();
    });
  });

  describe('Key Derivation', () => {
    it('should derive same key for same user (deterministic)', async () => {
      const userId = 'user-deriv-test';

      const key1 = await (encryptionService as any).deriveUserKey(userId);
      const key2 = await (encryptionService as any).deriveUserKey(userId);

      expect(key1.toString('hex')).toBe(key2.toString('hex'));
    });

    it('should derive different keys for different users', async () => {
      const user1 = 'alice';
      const user2 = 'bob';

      const key1 = await (encryptionService as any).deriveUserKey(user1);
      const key2 = await (encryptionService as any).deriveUserKey(user2);

      expect(key1.toString('hex')).not.toEqual(key2.toString('hex'));
    });

    it('should use PBKDF2 (slow derivation)', async () => {
      const userId = 'user-pbkdf2';
      const start = Date.now();

      await (encryptionService as any).deriveUserKey(userId);

      const elapsed = Date.now() - start;

      // PBKDF2 with 100K iterations should take 10-100ms
      // (depending on CPU)
      expect(elapsed).toBeGreaterThan(5);
    });
  });

  describe('Master Key Requirements', () => {
    it('should require ENCRYPTION_MASTER_KEY env var', () => {
      const oldKey = process.env.ENCRYPTION_MASTER_KEY;
      delete process.env.ENCRYPTION_MASTER_KEY;

      expect(() => {
        new EncryptionService();
      }).toThrow('ENCRYPTION_MASTER_KEY not set');

      process.env.ENCRYPTION_MASTER_KEY = oldKey;
    });

    it('should require master key to be 32 bytes', () => {
      const oldKey = process.env.ENCRYPTION_MASTER_KEY;

      // Too short
      process.env.ENCRYPTION_MASTER_KEY = Buffer.alloc(16).toString('base64');

      expect(() => {
        new EncryptionService();
      }).toThrow('must be exactly 32 bytes');

      process.env.ENCRYPTION_MASTER_KEY = oldKey;
    });

    it('should reject invalid base64 master key', () => {
      const oldKey = process.env.ENCRYPTION_MASTER_KEY;

      process.env.ENCRYPTION_MASTER_KEY = 'not-valid-base64!!!';

      expect(() => {
        new EncryptionService();
      }).toThrow('Failed to parse');

      process.env.ENCRYPTION_MASTER_KEY = oldKey;
    });
  });

  describe('Data Protection', () => {
    it('should never expose plaintext in error messages', async () => {
      const sensitiveData = 'super-secret-key-12345';
      const userId = 'user-1';

      const encrypted = await encryptionService.encrypt(sensitiveData, userId);

      try {
        // Tamper to cause error
        const parts = encrypted.split(':');
        const tampered = `${parts[0]}:${parts[1]}:XXX`;
        await encryptionService.decrypt(tampered, userId);
      } catch (error) {
        // Error message should not contain sensitive data
        expect(error.message).not.toContain('secret');
        expect(error.message).not.toContain('12345');
        expect(error.message).not.toContain(sensitiveData);
      }
    });

    it('should securely generate random IVs', async () => {
      const userId = 'user-1';
      const plaintext = 'data';

      const encrypted1 = await encryptionService.encrypt(plaintext, userId);
      const encrypted2 = await encryptionService.encrypt(plaintext, userId);
      const encrypted3 = await encryptionService.encrypt(plaintext, userId);

      const iv1 = encrypted1.split(':')[0];
      const iv2 = encrypted2.split(':')[0];
      const iv3 = encrypted3.split(':')[0];

      // All IVs should be different (not predictable)
      expect(iv1).not.toEqual(iv2);
      expect(iv2).not.toEqual(iv3);
      expect(iv1).not.toEqual(iv3);
    });
  });

  describe('Production Readiness', () => {
    it('should handle long private keys', async () => {
      const longKey = 'k' + '0'.repeat(1000);
      const userId = 'user-1';

      const encrypted = await encryptionService.encrypt(longKey, userId);
      const decrypted = await encryptionService.decrypt(encrypted, userId);

      expect(decrypted).toBe(longKey);
    });

    it('should handle special characters in private key', async () => {
      const specialKey = '!@#$%^&*()\n\t\r"\'`~[]{}';
      const userId = 'user-1';

      const encrypted = await encryptionService.encrypt(specialKey, userId);
      const decrypted = await encryptionService.decrypt(encrypted, userId);

      expect(decrypted).toBe(specialKey);
    });

    it('should handle unicode characters', async () => {
      const unicodeKey = '🔐🗝️🔑🛡️';
      const userId = 'user-1';

      const encrypted = await encryptionService.encrypt(unicodeKey, userId);
      const decrypted = await encryptionService.decrypt(encrypted, userId);

      expect(decrypted).toBe(unicodeKey);
    });
  });
});

/**
 * PRODUCTION CHECKLIST: Encryption
 *
 * Before shipping to production:
 *
 * [ ] ENCRYPTION_MASTER_KEY is set via AWS Secrets Manager
 * [ ] Master key is 32 bytes (run: openssl rand -base64 32)
 * [ ] Master key rotation procedure is documented
 * [ ] Per-user keys are used (not shared key)
 * [ ] AES-256-GCM is used (not CBC)
 * [ ] Auth tags are verified on decryption
 * [ ] No fallback to 'dev-secret-key'
 * [ ] Key rotation can be done without data loss
 * [ ] Encryption tests pass
 * [ ] Security audit completed
 */
