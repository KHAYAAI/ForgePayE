import { logger } from '../logger';

/**
 * Resolve the encryption master key at boot.
 *
 * Priority:
 *  1. AWS Secrets Manager, when ENCRYPTION_MASTER_KEY_SECRET_ARN is set. This is
 *     the production path — the key never lives in the pod's env/manifest, only
 *     an ARN does, and the pod reads it at startup using its IAM role (IRSA).
 *     The secret value may be either the raw base64 key or a JSON object with an
 *     ENCRYPTION_MASTER_KEY field.
 *  2. The ENCRYPTION_MASTER_KEY env var, for local development / CI.
 *
 * The AWS SDK is imported dynamically so it is only loaded when actually used,
 * keeping local/dev startup light.
 */
export async function loadMasterKey(): Promise<string> {
  const secretArn = process.env.ENCRYPTION_MASTER_KEY_SECRET_ARN;

  if (secretArn) {
    logger.info('Loading encryption master key from AWS Secrets Manager');
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );
    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    const res = await client.send(
      new GetSecretValueCommand({ SecretId: secretArn }),
    );

    if (!res.SecretString) {
      throw new Error('Secrets Manager secret has no string value');
    }

    return extractKey(res.SecretString);
  }

  const envKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!envKey) {
    throw new Error(
      'No master key configured. Set ENCRYPTION_MASTER_KEY_SECRET_ARN ' +
        '(production) or ENCRYPTION_MASTER_KEY (local).',
    );
  }
  return envKey;
}

/** Accept either a raw key string or a JSON blob { ENCRYPTION_MASTER_KEY: ... }. */
export function extractKey(secretString: string): string {
  try {
    const parsed = JSON.parse(secretString);
    if (parsed && typeof parsed.ENCRYPTION_MASTER_KEY === 'string') {
      return parsed.ENCRYPTION_MASTER_KEY;
    }
  } catch {
    // Not JSON — treat the whole string as the key.
  }
  return secretString;
}
