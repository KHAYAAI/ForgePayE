import { Injectable, Optional, Inject } from '@nestjs/common';
import * as crypto from 'crypto';
import { logger } from '../logger';
import { KeyWrapper, resolveKeyWrapper } from './key-wrapper';

/** DI token for the resolved master key material (base64 string). */
export const MASTER_KEY_MATERIAL = 'ENCRYPTION_MASTER_KEY_MATERIAL';

/**
 * Encryption service for sensitive data (private keys).
 *
 * Current format (v2, envelope encryption):
 *   v2:<wrapped data key>:<iv>:<auth tag>:<ciphertext>   (base64 / hex)
 * - each encryption uses a fresh random 256-bit data key, zeroed after use;
 * - the data key is wrapped by AWS KMS (WALLET_KMS_KEY_ID) with the user id
 *   as encryption context, so each unwrap is a logged, policy-controlled KMS
 *   call and cannot be redirected to another user;
 * - AES-256-GCM with a random 96-bit IV and the user id as associated data.
 *
 * Legacy format (iv:authTag:ciphertext): a per-user key derived by PBKDF2
 * from one master key held in this process. Anyone holding the master key
 * can derive every user's key, so legacy wallets still decrypt (to sign or to
 * migrate) but are reported by isLegacy() and should be swept to new wallets.
 * Nothing new is written in the legacy format.
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
  private wrapper: KeyWrapper;

  constructor(
    @Optional() @Inject(MASTER_KEY_MATERIAL) providedKey?: string,
    @Optional() @Inject('WALLET_KEY_WRAPPER') wrapper?: KeyWrapper,
  ) {
    this.initializeMasterKey(providedKey ?? process.env.ENCRYPTION_MASTER_KEY);
    // Local fallback KEK (development only) is derived from, not equal to,
    // the master key, so the two uses never share a key.
    const localKek = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('openprivy:local-kek:'), this.masterKey])).digest();
    this.wrapper = wrapper ?? resolveKeyWrapper(localKek);
  }

  /** True for data written in the legacy master-key-derived format. */
  static isLegacy(encrypted: string): boolean {
    return !encrypted.startsWith('v2:');
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
    const dataKey = crypto.randomBytes(this.KEY_LENGTH);
    try {
      const context = { purpose: 'wallet-private-key', userId };
      const wrapped = await this.wrapper.wrap(dataKey, context);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(this.ALGORITHM, dataKey, iv);
      cipher.setAAD(Buffer.from(userId, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return ['v2', wrapped.toString('base64'), iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(':');
    } catch (error) {
      logger.error(`Encryption failed: ${error.message}`);
      throw error;
    } finally {
      dataKey.fill(0);
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
    if (!EncryptionService.isLegacy(encrypted)) return this.decryptV2(encrypted, userId);
    logger.warn(`Decrypting a legacy (master-key-derived) wallet key for user ${userId}; migrate this wallet`);
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

  private async decryptV2(encrypted: string, userId: string): Promise<string> {
    const parts = encrypted.split(':');
    if (parts.length !== 5) throw new Error('Decryption failed (tampering detected or wrong key): invalid v2 format');
    const [, wrappedB64, ivHex, tagHex, ctHex] = parts;
    let dataKey: Buffer;
    try {
      dataKey = await this.wrapper.unwrap(Buffer.from(wrappedB64, 'base64'), { purpose: 'wallet-private-key', userId });
    } catch (error) {
      // Wrong user (context mismatch) or a modified wrapped key.
      throw new Error(`Decryption failed (tampering detected or wrong key): ${error.message}`);
    }
    try {
      const decipher = crypto.createDecipheriv(this.ALGORITHM, dataKey, Buffer.from(ivHex, 'hex'));
      decipher.setAAD(Buffer.from(userId, 'utf8'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
    } catch (error) {
      throw new Error(`Decryption failed (tampering detected or wrong key): ${error.message}`);
    } finally {
      dataKey.fill(0);
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
