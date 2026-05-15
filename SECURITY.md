# Security Policy — ForgePay

## Reporting a Vulnerability

ForgePay takes security seriously. If you discover a vulnerability, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

**Contact:** security@forgepay.io  
**Response SLA:** We acknowledge within 24 hours. Critical vulnerabilities get a fix within 72 hours.  
**Disclosure timeline:** 90 days after we receive a report, or sooner if a fix is released.

## Scope

### In Scope
- ForgePay REST APIs (`forgepay/services/`)
- Authentication and authorization logic
- Payment processing flows (card, stablecoin, crypto)
- Webhook signature verification
- Zero-knowledge proof verification (`crates/zk-proofs/`)
- Smart contracts (`forgepay/infra/contracts/`)
- SDK security (`forgepay/packages/sdk-js/`, `forgepay/packages/sdk-python/`)
- Agent identity and negotiation (`forgepay/services/agent-identity/`, `forgepay/services/agent-negotiation/`)
- RWA registry (`forgepay/services/rwa-registry/`)

### Out of Scope
- Hyperswitch upstream codebase (`crates/router/`)
- Kill Bill upstream codebase
- Third-party payment processors (Stripe, Adyen, etc.)
- AWS/GCP/Azure cloud infrastructure (report to respective providers)
- Denial of service attacks
- Social engineering attacks targeting ForgePay employees

## Severity Classification

| Level | Examples | Response Time |
|-------|---------|--------------|
| **Critical** | Payment data exposure, authentication bypass, fund theft | 72 hours |
| **High** | Privilege escalation, webhook spoofing, RLS bypass | 7 days |
| **Medium** | Rate limit bypass, information disclosure | 30 days |
| **Low** | Best-practice deviations, low-impact info leaks | 90 days |

## Security Features

- **PCI DSS:** Card data never stored in ForgePay services; all tokenization via Hyperswitch vault
- **Webhook security:** HMAC-SHA256 signature verification on all incoming webhooks
- **API key storage:** Argon2id hashed; never stored in plaintext
- **Secrets management:** HashiCorp Vault or AWS Secrets Manager; never in Helm values or env files
- **Multi-tenancy:** PostgreSQL Row-Level Security; merchant A cannot access merchant B data
- **Rate limiting:** All public endpoints rate-limited (100-300 req/min by service)
- **TLS:** TLS 1.3 on all external APIs; mTLS for service-to-service communication

## Bug Bounty

ForgePay does not currently offer a public bug bounty program. Critical findings may be rewarded at ForgePay's discretion.

## Known Security Assumptions

- Zero-knowledge proof circuits (`crates/zk-proofs/`) are **development/test-only**. The current Groth16 trusted setup uses a seeded RNG and is **NOT production-safe**. A production multi-party computation ceremony is required before mainnet ZK features launch.
- Smart contracts (`forgepay/infra/contracts/`) have not yet undergone external formal verification. Do not deploy to mainnet until a verified audit is complete.
- Agent escrow contracts (`forgepay/services/agent-negotiation/`) are prototype implementations. Formal security review required before handling real funds.
