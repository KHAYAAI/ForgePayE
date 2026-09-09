/**
 * AES-256-GCM envelope encryption for private keys and sensitive data.
 *
 * PRIVATE_KEY_ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
 * Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Store in: Kubernetes Secret / AWS Secrets Manager — never in source code.
 *
 * Production upgrade path: replace with KMS envelope encryption
 *   1. Call KMS GenerateDataKey to get plaintext + encrypted data key
 *   2. Encrypt the secret with the plaintext data key (AES-GCM)
 *   3. Store ciphertext + encrypted data key in DB
 *   4. On decrypt: KMS Decrypt → recover data key → AES-GCM decrypt
 */
export declare function encryptPrivateKey(secret: string): string;
export declare function decryptPrivateKey(encrypted: string): string;
//# sourceMappingURL=keystore.d.ts.map