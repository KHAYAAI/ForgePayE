/**
 * ES256 key management for KYAPay token issuance.
 *
 * Key loading priority:
 *   1. KYAPAY_SIGNING_PRIVATE_KEY + KYAPAY_SIGNING_PUBLIC_KEY env vars (production)
 *      Both must be PEM-encoded. Private key must be PKCS#8 format. Public key SPKI.
 *   2. Ephemeral generated key pair (dev / test only — warned loudly in logs).
 *
 * Keys are lazy-loaded and cached for the process lifetime. In production,
 * the private key PEM comes from Vault / AWS Secrets Manager via a K8s secret.
 */

import {
  importPKCS8,
  importSPKI,
  exportJWK,
  generateKeyPair,
  type KeyLike,
} from 'jose';

interface KeySet {
  privateKey: KeyLike;
  publicKey:  KeyLike;
  keyId:      string;
}

let cachedKeySet: KeySet | null = null;

export async function getKeySet(): Promise<KeySet> {
  if (cachedKeySet) return cachedKeySet;

  const keyId   = process.env['KYAPAY_KEY_ID'] ?? 'forgepay-agent-identity-1';
  const privPem = process.env['KYAPAY_SIGNING_PRIVATE_KEY'];
  const pubPem  = process.env['KYAPAY_SIGNING_PUBLIC_KEY'];

  if (privPem && pubPem) {
    // Production path — keys loaded from Vault / Secrets Manager
    const privateKey = await importPKCS8(privPem.replace(/\\n/g, '\n'), 'ES256');
    const publicKey  = await importSPKI(pubPem.replace(/\\n/g, '\n'), 'ES256');
    cachedKeySet = { privateKey, publicKey, keyId };
  } else {
    // Dev/test path — ephemeral key pair (not suitable for production)
    console.warn(
      '[kyapay-keys] KYAPAY_SIGNING_PRIVATE_KEY not set — ' +
      'generating ephemeral ES256 key pair. DO NOT use in production.',
    );
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    cachedKeySet = { privateKey, publicKey, keyId };
  }

  return cachedKeySet;
}

export async function buildJwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const { publicKey, keyId } = await getKeySet();
  const jwk = await exportJWK(publicKey);
  return {
    keys: [{
      ...jwk,
      kid: keyId,
      use: 'sig',
      alg: 'ES256',
    }],
  };
}
