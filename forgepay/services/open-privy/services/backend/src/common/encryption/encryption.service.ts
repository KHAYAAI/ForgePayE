import { Injectable, Optional, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import { logger } from '../logger';

/** DI token for the resolved master key material (base64 string). */
export const MASTER_KEY_MATERIAL = 'ENCRYPTION_MASTER_KEY_MATERIAL';

/**
 * Encryption service for sensitive data (private keys).
 *
 * Security model:
 * - Master key stored in AWS Secrets Manager (rotated quarterly)
 * - Per-user key derived from master key + user ID via PBKDF2
 * - AES-256-GCM for authenticated encryption (includes integrity check)
 * - Nonce (IV) randomly generated per encryption
 * - Auth tag prevents tampering
 */
@Injectable()
export class EncryptionService {
  private masterKey: Buffer;
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY_LENGTH = 32; // 256 bits
  private readonly IV_LENGTH = 16; // 128 bits
  private readonly PBKDF2_ITERATIONS = 100000;
  private readonly AUTH_TAG_LENGTH = 16; // 128 bits

  /**
   * @param providedKey Base64 master key, injected by EncryptionModule (which
   * may have resolved it from AWS Secrets Manager). When constructed directly
   * (e.g. in tests) it falls back to the ENCRYPTION_MASTER_KEY env var.
   */
  constructor(
    @Optional() @Inject(MASTER_KEY_MATERIAL) providedKey?: string,
  ) {
    this.initializeMasterKey(providedKey ?? process.env.ENCRYPTION_MASTER_KEY);
  }

  /**
   * Initialize master encryption key. In production this material comes from
   * AWS Secrets Manager (see master-key.loader.ts); locally it may come from an
   * env var. Either way it must be base64 that decodes to exactly 32 bytes.
   */
  private initializeMasterKey(rawKey: string | undefined): void {
    if (!rawKey) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY not set. In production provide it via ' +
        'ENCRYPTION_MASTER_KEY_SECRET_ARN (AWS Secrets Manager). Locally set ' +
        'ENCRYPTION_MASTER_KEY to a base64 32-byte key (openssl rand -base64 32).'
      );
    }

    // Master key should be base64 encoded 32-byte key
    try {
      this.masterKey = Buffer.from(rawKey, 'base64');

      if (this.masterKey.length !== this.KEY_LENGTH) {
        throw new Error(
          `Master key must be exactly ${this.KEY_LENGTH} bytes (${this.KEY_LENGTH * 8} bits). ` +
          `Got ${this.masterKey.length} bytes.`
        );
      }

      logger.info('Encryption master key loaded successfully');
    } catch (error) {
      throw new Error(`Failed to parse ENCRYPTION_MASTER_KEY: ${error.message}`);
    }
  }

  /**
   * Derive a per-user encryption key from master key + user ID.
   *
   * This ensures:
   * - Different users have different encryption keys
   * - Even if one user's key is compromised, other users are safe
   * - Key derivation is deterministic (same user ID → same key)
   * - Computationally expensive (100K iterations) to prevent brute force
   */
  async deriveUserKey(userId: string): Promise<Buffer> {
    try {
      const userSalt = crypto
        .createHash('sha256')
        .update(`openprivy:${userId}`)
        .digest();

      return crypto.pbkdf2Sync(
        this.masterKey,
        userSalt,
        this.PBKDF2_ITERATIONS,
        this.KEY_LENGTH,
        'sha256'
      );
    } catch (error) {
      logger.error(`Failed to derive user key: ${error.message}`);
      throw error;
    }
  }

  /**
   * Encrypt sensitive data (e.g., private keys) with per-user key.
   *
   * Format: iv:authTag:ciphertext
   * - iv: 16 random bytes (hex encoded)
   * - authTag: 16 bytes authentication tag (hex encoded)
   * - ciphertext: encrypted data (hex encoded)
   *
   * @param plaintext Data to encrypt
   * @param userId User ID (used to derive encryption key)
   * @returns Encrypted data (hex encoded)
   */
  async encrypt(plaintext: string, userId: string): Promise<string> {
    try {
      const userKey = await this.deriveUserKey(userId);
      const iv = crypto.randomBytes(this.IV_LENGTH);

      const cipher = crypto.createCipheriv(this.ALGORITHM, userKey, iv);
      let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
      ciphertext += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:ciphertext (all hex encoded)
      const encrypted = `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;

      logger.debug(`Encrypted data for user ${userId}`);
      return encrypted;
    } catch (error) {
      logger.error(`Encryption failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Decrypt data encrypted with encrypt().
   *
   * @param encrypted Encrypted data (format: iv:authTag:ciphertext)
   * @param userId User ID (used to derive encryption key)
   * @returns Decrypted plaintext
   * @throws Error if authentication tag verification fails (tampering detected)
   */
  async decrypt(encrypted: string, userId: string): Promise<string> {
    try {
      const parts = encrypted.split(':');

      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format (expected iv:authTag:ciphertext)');
      }

      const [ivHex, authTagHex, ciphertext] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      if (iv.length !== this.IV_LENGTH) {
        throw new Error(`Invalid IV length: expected ${this.IV_LENGTH}, got ${iv.length}`);
      }

      if (authTag.length !== this.AUTH_TAG_LENGTH) {
        throw new Error(
          `Invalid auth tag length: expected ${this.AUTH_TAG_LENGTH}, got ${authTag.length}`
        );
      }

      const userKey = await this.deriveUserKey(userId);
      const decipher = crypto.createDecipheriv(this.ALGORITHM, userKey, iv);
      decipher.setAuthTag(authTag);

      let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
      plaintext += decipher.final('utf8');

      logger.debug(`Decrypted data for user ${userId}`);
      return plaintext;
    } catch (error) {
      // Auth tag verification failure or other decryption error
      logger.error(`Decryption failed: ${error.message}`);
      throw new Error(`Failed to decrypt data (tampering detected or wrong key): ${error.message}`);
    }
  }

  /**
   * Re-encrypt data with a new master key (for key rotation).
   *
   * @param encrypted Data encrypted with old key
   * @param userId User ID
   * @param oldMasterKey Old master key (to decrypt)
   * @param newMasterKey New master key (to encrypt)
   * @returns Data encrypted with new master key
   */
  async rotateKey(
    encrypted: string,
    userId: string,
    oldMasterKey: Buffer,
    newMasterKey: Buffer
  ): Promise<string> {
    try {
      // Temporarily use old key to decrypt
      const oldKey = this.masterKey;
      this.masterKey = oldMasterKey;
      const plaintext = await this.decrypt(encrypted, userId);

      // Switch to new key and encrypt
      this.masterKey = newMasterKey;
      const reencrypted = await this.encrypt(plaintext, userId);

      this.masterKey = oldKey; // Restore
      return reencrypted;
    } catch (error) {
      logger.error(`Key rotation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate a secure random master key for initialization.
   * Use this to create the initial master key.
   *
   * Store in AWS Secrets Manager:
   * aws secretsmanager create-secret \
   *   --name openprivy/encryption/master-key \
   *   --secret-string="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
   */
  static generateMasterKey(): string {
    return crypto.randomBytes(32).toString('base64');
  }
}
