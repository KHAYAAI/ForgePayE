/**
 * KYAPay JWT verification.
 *
 * KYAPay (IETF Internet-Draft, March 2026) uses ES256-signed JWTs to represent
 * agent identity (KYA), payment authorization (PAY), or both (KYA-PAY).
 *
 * Verification steps:
 *   1. Decode header — must be alg=ES256
 *   2. Decode payload — extract iss, confirm it's a trusted issuer
 *   3. Fetch JWKS from issuer's /.well-known/jwks.json (cached per process)
 *   4. jwtVerify signature + expiry via jose
 *   5. Return typed claims
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

// ── KYAPay claim types ─────────────────────────────────────────────────────────

export interface KYAPayBidClaims {
  kycVerified?:  boolean;
  businessName?: string;
  jurisdiction?: string;
  tier?:         string;
}

export interface KYAPayClaims {
  // Standard JWT
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  jti?: string;

  // KYAPay identity claims (KYA / KYA-PAY tokens)
  bid?: KYAPayBidClaims;

  // KYAPay payment claims (PAY / KYA-PAY tokens)
  value?: string;   // max spend amount, e.g. "50.00"
  cur?:   string;   // ISO 4217 currency, e.g. "USD"
  sps?:   string;   // settlement asset, e.g. "USDC"
  spr?:   string;   // settlement rail/chain, e.g. "polygon"
  rec?:   string;   // recipient (ForgePay merchant ID)

  // ForgePay-extended claims (present only in ForgePay-issued tokens)
  fp_reputation?:       number;
  fp_trust_level?:      string;
  fp_lifetime_volume?:  string;
  fp_success_rate?:     number;
  fp_ofac_cleared?:     boolean;
  fp_defaults?:         number;
  fp_credit_available?: string;
}

// ── JWKS cache (one fetcher per issuer, cached for process lifetime) ───────────

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwksFetcher(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksCache.get(issuer);
  if (existing) return existing;

  const jwksUri = `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
  const fetcher = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(issuer, fetcher);
  return fetcher;
}

// ── Verification ───────────────────────────────────────────────────────────────

export interface KYAPayVerifyOptions {
  trustedIssuers: string[];
  audience?:      string;
}

export async function verifyKYAPayToken(
  jwt: string,
  opts: KYAPayVerifyOptions,
): Promise<KYAPayClaims> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format — expected 3 parts');

  // Pre-decode header and payload to get alg + iss before expensive verify
  const header  = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as { alg?: string };
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as { iss?: string };

  if (header.alg !== 'ES256') {
    throw new Error(`Unsupported algorithm: ${header.alg ?? 'none'}. KYAPay requires ES256.`);
  }

  const issuer = payload.iss;
  if (!issuer) throw new Error('JWT missing iss claim');
  if (!opts.trustedIssuers.includes(issuer)) {
    throw new Error(`Untrusted issuer: ${issuer}`);
  }

  const jwks = getJwksFetcher(issuer);
  const { payload: verified } = await jwtVerify(jwt, jwks, {
    algorithms: ['ES256'],
    ...(opts.audience ? { audience: opts.audience } : {}),
  });

  return verified as unknown as KYAPayClaims;
}

// ── Claim extraction ───────────────────────────────────────────────────────────

export interface AgentContext {
  kyapaySubject:       string;
  kyapayIssuer:        string;
  merchantId:          string;
  spendLimitValue?:    string;
  spendLimitCurrency?: string;
  settlementAsset?:    string;
  settlementChain?:    string;
  kycVerified:         boolean;
  businessName?:       string;
  jurisdiction?:       string;
  jti?:                string;
}

export function extractAgentContext(claims: KYAPayClaims): AgentContext {
  const aud = Array.isArray(claims.aud) ? claims.aud[0]! : claims.aud;
  return {
    kyapaySubject:       claims.sub,
    kyapayIssuer:        claims.iss,
    merchantId:          claims.rec ?? aud,
    spendLimitValue:     claims.value,
    spendLimitCurrency:  claims.cur,
    settlementAsset:     claims.sps,
    settlementChain:     claims.spr,
    kycVerified:         claims.bid?.kycVerified ?? false,
    businessName:        claims.bid?.businessName,
    jurisdiction:        claims.bid?.jurisdiction,
    jti:                 claims.jti,
  };
}
