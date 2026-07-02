# FORGE Wallet

**FORGE Wallet is OpenPrivy integrated into the FORGE ecosystem** — the
consumer & agent wallet-as-a-service and identity layer. Email in, wallet
out: no seed phrases, no key management for the user, social recovery through
trusted contacts, and a `did:forge` identity for every user and agent that the
**Agent Credit Bureau** reads to build reputation.

## How it works

**Signup** → the backend generates an Ed25519 keypair, encrypts the private
key with **AES-256-GCM** under a key derived from the user's password
(**scrypt**, per-user salt), derives addresses on **ethereum, polygon, and
solana** through a `ChainAdapter` boundary, and mints `did:forge:user_<uuid>`.
The plaintext private key is never persisted and never returned by any
endpoint.

**Signing** → `POST /api/v1/transactions/create` requires the user's password
in the request body; the key decrypts in-memory for the single signature and
is discarded. Status flow: `created → signed → broadcast → confirmed`
(12 confirmations), with a gas-sponsorship ledger entry (~$0.10/tx) recorded
for billing.

**Recovery** (lost phone, forgotten password) → the user registers up to 3
trusted contacts. Recovery needs **2-of-3** single-use approval tokens
(hash-stored, emailed to contacts in production). On completion the wallets
are **rotated to fresh keypairs** — the dev implementation cannot decrypt the
old key without the lost password. The production path restores the old key
from the HashiCorp Vault backup share referenced by `vault_backup_path`.

**Agents** → `POST /api/v1/agents/wallets` (platform `X-API-Key`,
timing-safe) provisions `did:forge:agent_<uuid>` wallets with a one-time
signing secret. `GET /api/v1/dids/by-address/:address` lets the Agent Credit
Bureau resolve any address to its DID and type.

## Routing tier contract

| Amount | Path |
|---|---|
| < $100K (`LARGE_PAYMENT_THRESHOLD`) | Wallet signs directly |
| ≥ $100K | **409** `{route:"forge-custody"}` — FORGE Payments re-routes through FORGE Custody 4-of-7 threshold signing |

Every confirmed transaction emits `wallet.transaction.confirmed` to the
Revenue Ontology via an HMAC-SHA256-signed webhook to unified-router.

## Security properties

- Passwords: bcrypt, 12 rounds; constant-shape login failures
- JWT: HS256 pinned, 1-hour expiry; production refuses weak/missing secrets
- Keys: AES-256-GCM + scrypt KDF; ciphertext-only at rest; Vault backup path
- Recovery tokens: single-use, hash-stored, expiring
- Auth endpoints: 10 req/min burst limit (brute-force guard)
- Platform agent key: timing-safe comparison

## API summary

| Route | Purpose |
|---|---|
| `POST /api/v1/auth/signup` / `login` | Email/password auth → JWT (1h) |
| `GET /api/v1/wallets` | Active wallets for the user |
| `POST /api/v1/transactions/create` | Sign + broadcast (tier-checked) |
| `GET /api/v1/transactions` | Transaction history |
| `GET /api/v1/gas-sponsorship` | Sponsored-gas ledger |
| `POST /api/v1/agents/wallets` | Provision agent wallet + DID (platform key) |
| `GET /api/v1/dids/by-address/:address` | DID lookup (Agent Credit Bureau) |
| `POST /api/v1/contacts` / `GET` | Trusted contacts (max 3) |
| `POST /api/v1/recovery/initiate` / `approve/:token` / `complete` | 2-of-3 social recovery |
| `GET /api/health`, `GET /metrics` | Health & Prometheus metrics |

## Development

```bash
npm install
npm run dev        # tsx watch, port 3020
npm test           # vitest — fully in-memory
npm run type-check
```

Storage: schema `forge_wallet` (`users`, `wallets`, `encrypted_keys`,
`transactions`, `trusted_contacts`, `recovery_requests`,
`recovery_approvals`, `gas_sponsorship`) with the same in-memory +
best-effort-Postgres pattern as the other ForgePay TypeScript services.

See `.env.example` for configuration. Production boot requires `JWT_SECRET`,
`WEBHOOK_SECRET`, `DATABASE_URL`, and `AGENT_API_KEY`.
