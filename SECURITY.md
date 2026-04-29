# Security Policy

## Scope

This policy covers the ForgePay platform codebase, including:

**In scope:**
- REST API endpoints (crypto-gateway, stablecoin-gateway, mor-layer, unified-router)
- Solidity smart contracts (Groth16Verifier, CommitmentTree, NullifierRegistry, PoseidonHasher)
- WASM proof generation (privacy-payment-wasm crate)
- JavaScript/TypeScript SDK (@forgepay/sdk)
- Dashboard and marketing site (Next.js apps)

**Out of scope:**
- Hyperswitch upstream (report to https://github.com/juspay/hyperswitch/security)
- Kill Bill upstream (report to https://github.com/killbill/killbill/security)
- Third-party payment processor APIs (Stripe, Adyen, etc.)
- Kubernetes/cloud infrastructure (report to your cloud provider)

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues privately via:
- **Email:** security@forgepay.io
- **Subject line:** `[SECURITY] <brief description>`
- **PGP key:** Available at https://forgepay.io/.well-known/security.txt

Include:
1. Description of the vulnerability
2. Steps to reproduce
3. Affected component(s) and version(s)
4. Potential impact assessment
5. (Optional) Suggested fix

## Response Timeline

| Milestone | Target |
|---|---|
| Acknowledgement | 48 hours |
| Initial assessment | 5 business days |
| Fix timeline communicated | 10 business days |
| Fix released | 90 days (critical: 7 days) |
| Public disclosure | 90 days after report |

## Severity Classification

| Severity | Description | Examples |
|---|---|---|
| **Critical** | Direct financial impact, key compromise | Smart contract fund drain, auditor key leak |
| **High** | Authentication bypass, data leakage | JWT forgery, plaintext amount exposure |
| **Medium** | Limited scope impact | Rate limit bypass, XSS in dashboard |
| **Low** | Minimal impact | Info disclosure, minor misconfig |

## Bug Bounty

ForgePay operates a private bug bounty program. Critical and High severity findings are eligible for rewards. Contact security@forgepay.io for details.

## Known Security Properties

### Zero-Knowledge Privacy
- Groth16 proofs are generated client-side (browser WASM); plaintext amounts never reach servers
- Auditor decryption uses X25519 ECDH + SHA-256 KDF + AES-256-GCM
- Nullifier registry prevents double-spending on-chain

### Payment Security
- Cards never touch ForgePay application layer (PCI DSS Level 1 via Hyperswitch vault)
- All webhook payloads are HMAC-SHA256 signed; always verified before processing
- Internal service communication uses signed tokens (`INTERNAL_WEBHOOK_SECRET`)

### Infrastructure
- All secrets loaded from Vault or AWS Secrets Manager at runtime
- Database credentials, JWT secrets, and API keys fail-fast if not set in non-development environments
- Terraform state encrypted at rest in S3 with KMS, locked via DynamoDB
