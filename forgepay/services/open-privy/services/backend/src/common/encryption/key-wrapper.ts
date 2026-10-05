import * as crypto from 'crypto';

/**
 * Wraps (encrypts) and unwraps a per-wallet data key.
 *
 * Wallet private keys are encrypted with a fresh random data key each; only
 * the wrapped data key is stored. Unwrapping it is the one operation that
 * gives access to a wallet, so it should happen somewhere that logs and can
 * refuse it — AWS KMS — rather than in this process from a key it holds.
 * The context (the wallet owner's user id) is bound into the wrap, so a
 * wrapped key cannot be unwrapped for anyone else.
 */
export interface KeyWrapper {
  readonly kind: 'aws-kms' | 'local';
  wrap(dataKey: Buffer, context: Record<string, string>): Promise<Buffer>;
  unwrap(wrapped: Buffer, context: Record<string, string>): Promise<Buffer>;
}

/**
 * AWS KMS. Every unwrap is a KMS Decrypt call carrying the encryption context,
 * visible in CloudTrail and controllable by key policy (e.g. require the
 * context, alarm on volume). The process never holds the key-encryption key.
 */
export class AwsKmsKeyWrapper implements KeyWrapper {
  readonly kind = 'aws-kms' as const;
  private client: unknown;

  constructor(private readonly keyId: string, private readonly region = process.env.AWS_REGION || 'us-east-1') {}

  private async kms(): Promise<{ client: any; mod: any }> {
    const mod: any = await import('@aws-sdk/client-kms');
    if (!this.client) this.client = new mod.KMSClient({ region: this.region });
    return { client: this.client, mod };
  }

  async wrap(dataKey: Buffer, context: Record<string, string>): Promise<Buffer> {
    const { client, mod } = await this.kms();
    const res = await client.send(new mod.EncryptCommand({ KeyId: this.keyId, Plaintext: dataKey, EncryptionContext: context }));
    if (!res.CiphertextBlob) throw new Error('KMS Encrypt returned no ciphertext');
    return Buffer.from(res.CiphertextBlob);
  }

  async unwrap(wrapped: Buffer, context: Record<string, string>): Promise<Buffer> {
    const { client, mod } = await this.kms();
    const res = await client.send(new mod.DecryptCommand({ KeyId: this.keyId, CiphertextBlob: wrapped, EncryptionContext: context }));
    if (!res.Plaintext) throw new Error('KMS Decrypt returned no plaintext');
    return Buffer.from(res.Plaintext);
  }
}

/**
 * Local AES-256-GCM wrapping with a key-encryption key in this process. For
 * development and tests only: it has the same weakness as the old scheme
 * (whoever has the KEK can open every wallet). Refused in production unless
 * WALLET_ALLOW_LOCAL_KEK=true is set deliberately.
 */
export class LocalKeyWrapper implements KeyWrapper {
  readonly kind = 'local' as const;

  constructor(private readonly kek: Buffer) {
    if (kek.length !== 32) throw new Error('Local KEK must be 32 bytes');
  }

  private static aad(context: Record<string, string>): Buffer {
    return Buffer.from(JSON.stringify(Object.keys(context).sort().map((k) => [k, context[k]])));
  }

  async wrap(dataKey: Buffer, context: Record<string, string>): Promise<Buffer> {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.kek, iv);
    c.setAAD(LocalKeyWrapper.aad(context));
    const ct = Buffer.concat([c.update(dataKey), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  async unwrap(wrapped: Buffer, context: Record<string, string>): Promise<Buffer> {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const ct = wrapped.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', this.kek, iv);
    d.setAAD(LocalKeyWrapper.aad(context));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }
}

/**
 * The wrapper this deployment uses: KMS when WALLET_KMS_KEY_ID is set;
 * otherwise a local KEK, which production refuses unless explicitly allowed.
 */
export function resolveKeyWrapper(localKek: Buffer, env: NodeJS.ProcessEnv = process.env): KeyWrapper {
  if (env.WALLET_KMS_KEY_ID) return new AwsKmsKeyWrapper(env.WALLET_KMS_KEY_ID, env.AWS_REGION);
  if (env.NODE_ENV === 'production' && env.WALLET_ALLOW_LOCAL_KEK !== 'true') {
    throw new Error(
      'WALLET_KMS_KEY_ID is not set. In production wallet data keys must be wrapped by AWS KMS; ' +
      'a local key-encryption key would let whoever holds it open every wallet.',
    );
  }
  return new LocalKeyWrapper(localKek);
}
