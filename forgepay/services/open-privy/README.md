# OpenPrivy — Custodial Embedded Wallet Platform

Embedded crypto wallets with no seed phrases: users log in with email/social/SSO,
get a wallet, and transact — the platform generates, encrypts, and signs on
their behalf. Multi-chain (Ethereum, Polygon, Solana), gas-sponsored via
ERC-4337 account abstraction.

**Version:** 0.1.0
**Status:** 🟡 Pre-launch — builds, boots, and passes its test suite; **not yet
cleared for real user funds**. See [Launch readiness](#launch-readiness) below
and `PRODUCTION_STATUS.md` for the full, evidence-backed ledger.

This README describes what the code does. It does not claim things that
haven't been verified — where something is unproven, it says so.

## What this actually is

OpenPrivy is **custodial**: the backend holds the only copy of each user's
private key (encrypted) and signs on their behalf. That's the trade-off behind
"no seed phrases" — convenience for the user, custody obligations for the
platform. See [Compliance](#compliance--licensing) before treating this as
launch-ready for real funds.

## Architecture

```
Web (Next.js) / Mobile (Expo)
        │  HTTPS
        ▼
ALB — TLS termination (ACM)
        │
        ▼
EKS — NestJS backend, 3–10 pods (HPA)
   modules: auth · wallet · blockchain · transactions
            · account-abstraction · defi · social-recovery · monitoring
        │
        ├──► RDS PostgreSQL 16 (Multi-AZ, schema via migrations)
        ├──► ElastiCache Redis (global rate limiting)
        ├──► Secrets Manager (DB password, encryption master key — read via IRSA)
        ├──► WorkOS AuthKit (SSO / email / MFA)
        └──► Chain RPC (Alchemy) + Bundler/EntryPoint (Pimlico)
```

**Custody path:** a wallet's private key is generated server-side, encrypted
with AES-256-GCM using a key derived per-user (PBKDF2, 100k iterations) from a
master key held in AWS Secrets Manager. Exactly one function,
`WalletService.getEvmSigner`, ever decrypts a key — after verifying the caller
owns that wallet — and it signs and broadcasts immediately. The plaintext key
never persists and is never returned over the API.

## Tech stack

| Layer | Technology |
|---|---|
| Web | Next.js + React |
| Mobile | Expo (React Native) |
| Backend | NestJS + TypeORM |
| Database | PostgreSQL 16 (RDS Multi-AZ) |
| Cache / rate limiting | Redis (ElastiCache) |
| Auth | WorkOS AuthKit (SSO, email, MFA) — Supabase supported as an optional legacy path |
| Blockchain | ethers.js + Alchemy (EVM), @solana/web3.js |
| Account abstraction | ERC-4337 (EntryPoint v0.7) + Pimlico bundler/paymaster |
| Secrets | AWS Secrets Manager, read via pod IRSA role |
| Monitoring | Prometheus (`/metrics`) |
| Infra | CloudFormation (VPC/EKS, RDS/Redis/Secrets/S3) + Kubernetes + Docker |

## Quick start (local)

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 16 (via `docker-compose up -d`, or your own instance)

### Setup

```bash
git clone https://github.com/khayaai/open-privy.git
cd open-privy

cp .env.example .env
# fill in: ENCRYPTION_MASTER_KEY, JWT_SECRET, DATABASE_URL, and either
# WORKOS_API_KEY/WORKOS_CLIENT_ID or SUPABASE_URL/SUPABASE_KEY (see below)

docker-compose up -d          # Postgres + Redis

cd services/backend
npm install --legacy-peer-deps
npm run migration:run         # applies committed migrations — never `synchronize` outside dev
npm run build
npm run dev                   # http://localhost:3001
```

```bash
cd apps/web
npm install
npm run dev                   # http://localhost:3000
```

Verify: `curl http://localhost:3001/health` → `{"status":"ok",...}`

### Required environment variables

```bash
# Security — REQUIRED, the app refuses to boot without these in production
ENCRYPTION_MASTER_KEY=$(openssl rand -base64 32)   # or ENCRYPTION_MASTER_KEY_SECRET_ARN in prod
JWT_SECRET=$(openssl rand -base64 48)

# Database
DATABASE_URL=postgresql://app:dev-only@localhost:5432/openprivy

# Auth — pick one
WORKOS_API_KEY=sk_test_...
WORKOS_CLIENT_ID=client_...
WORKOS_REDIRECT_URI=http://localhost:3001/auth/workos/callback
# — or —
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGc...

# Blockchain RPC
ETHEREUM_RPC_SEPOLIA=https://sepolia.infura.io/v3/YOUR_KEY
ALCHEMY_API_KEY=your-alchemy-key

# Optional: gas sponsorship
PIMLICO_API_KEY=your-pimlico-key
```

Full list with comments: `.env.example`.

## Project structure

```
openprivy/
├── apps/
│   ├── web/                        # Next.js frontend
│   └── mobile/                     # Expo app
│
├── services/
│   ├── backend/                    # NestJS API
│   │   ├── src/
│   │   │   ├── modules/            # auth, wallet, blockchain, transactions,
│   │   │   │                       # account-abstraction, defi, social-recovery,
│   │   │   │                       # monitoring
│   │   │   ├── common/             # encryption, middleware, logging
│   │   │   ├── config/             # typeorm, jwt, secrets
│   │   │   ├── migrations/         # committed schema migrations
│   │   │   └── data-source.ts      # TypeORM CLI datasource
│   │   └── test/                   # security/, correctness/, integration/, e2e/
│   │
│   └── contracts/                  # SimpleAccount, Factory, Paymaster (ERC-4337)
│
├── aws/                             # CloudFormation: VPC/EKS, RDS/Redis/Secrets/S3
├── k8s/                             # Deployment, HPA, migrate Job, ALB Ingress
├── scripts/                         # db-backup.sh, db-restore.sh, deploy scripts
├── test/load/                       # load test harness + measured results
│
├── docs/
│   ├── AWS_PRODUCTION_DEPLOY.md    # ordered deploy runbook
│   └── DR_RUNBOOK.md               # disaster recovery scenarios & drill checklist
│
├── PRODUCTION_STATUS.md            # source of truth: verified / partial / blocked
└── docker-compose.yml               # local Postgres + Redis
```

## API endpoints

### Auth
```
POST   /auth/signup                 # email/password (Supabase path)
POST   /auth/login
GET    /auth/workos/authorize       # returns the AuthKit hosted-login URL
GET    /auth/workos/callback        # OAuth callback; sets the session cookie
GET    /auth/me
POST   /auth/logout
```

### Wallet
```
POST   /wallet/create                    # generates + encrypts a key, returns no key material
GET    /wallet/get
GET    /wallet/list
GET    /wallet/:walletId/balance
POST   /wallet/:walletId/recovery-email
```

### Transactions
```
POST   /transactions/send                # custodial: decrypt → sign → broadcast
POST   /transactions/request             # client-signing flow: create a signing request
POST   /transactions/:txId/confirm       # broadcast a client-signed tx
GET    /transactions/history
GET    /transactions/:txId
```

### Account abstraction (ERC-4337)
```
POST   /account-abstraction/build-userop
POST   /account-abstraction/send-userop
GET    /account-abstraction/userop-status/:userOpHash
GET    /account-abstraction/paymaster/status
GET    /account-abstraction/paymaster/balance
POST   /account-abstraction/estimate-gas
```

### Blockchain
```
GET    /blockchain/balance/:address
GET    /blockchain/gas-price
GET    /blockchain/tx-history/:address
GET    /blockchain/tx-receipt/:txHash
GET    /blockchain/solana/balance/:address
GET    /blockchain/polygon/balance/:address
GET    /blockchain/supported-chains
```

### Social recovery
```
POST   /recovery/contacts                # add a guardian contact
POST   /recovery/contacts/verify
POST   /recovery/initiate                # requires ≥2 verified guardians (M-of-N)
POST   /recovery/approve
POST   /recovery/complete
GET    /recovery/status
```

### DeFi
```
GET    /defi/swap/quote
POST   /defi/swap/build
GET    /defi/stake/info
POST   /defi/stake/build
```

### Ops
```
GET    /health                       # liveness/readiness
GET    /metrics                      # Prometheus scrape endpoint
GET    /metrics/info                 # human-readable process info
```

## Database schema (current)

**users** — `id` (uuid PK), `email` (unique), `workosUserId` (unique, nullable —
links a WorkOS identity to this account), `username`, `avatarUrl`,
`emailVerified`, `mfaEnabled`, `createdAt`/`updatedAt`

**wallets** — `id` (uuid PK), `userId` (FK), `address` (unique), `chain`
(`ethereum`/`solana`/`polygon`), `publicKey`, `encryptedPrivateKey`
(`iv:authTag:ciphertext`, AES-256-GCM), `recoveryEmail`, `isActive`

**transactions** — `id` (uuid PK), `userId`/`walletId` (FK), `chain`, `txHash`,
`fromAddress`, `toAddress`, `amount`, `status`, `metadata` (jsonb)

**recovery_contacts** / **recovery_guardians** — guardian contacts and their
approval state for M-of-N social recovery

**audit_logs** — `userId`, `eventType`, `metadata`, `timestamp`

Schema is applied via committed TypeORM migrations
(`npm run migration:run`) — production never uses `synchronize`.

## Security

What's implemented and verified:
- Private keys encrypted at rest, **AES-256-GCM** with per-user PBKDF2-derived
  keys (not a single shared key)
- Master key sourced from **AWS Secrets Manager** in production, read via the
  pod's IRSA role — never in a manifest
- **Fail-closed JWT secret** — refuses to boot on a default/dev secret when
  `NODE_ENV=production`
- **Redis-backed rate limiting**, global across replicas, env-tunable limits
- CORS restricted to configured origins; `helmet` security headers
- Schema via reviewed migrations, not runtime `synchronize`

What's explicitly **not** done yet — see [Launch readiness](#launch-readiness):
- No independent security audit
- No live, on-chain-verified ERC-4337 transaction (hash logic is spec-correct
  against EntryPoint v0.7; the on-chain comparison test is written but unrun)
- No master-key rotation tooling (the primitive exists; batch re-encryption
  and a rehearsed drill do not)
- No money-transmitter / VASP licensing review for the custodial model

## Testing

```bash
cd services/backend
npm run test               # unit + correctness + security (35 passing, 1 skipped)
npm run test:security      # encryption, auth, rate-limit tests only
npm run test:correctness   # nonce, UserOp hash, custody round-trip
npm run test:e2e           # requires a running DB
npm run lint
```

Load testing: `test/load/quick-load.sh` (autocannon) and `test/load/staging-load.k6.js`
(k6 ramp). Measured single-instance baseline in `test/load/RESULTS.md`.

## Deployment

### Local
```bash
docker-compose up
```

### AWS (staging/production)
Full ordered runbook: **`docs/AWS_PRODUCTION_DEPLOY.md`**. Summary:

```bash
# 1. Network + cluster
aws cloudformation deploy --template-file aws/cloudformation-vpc-eks.yaml \
  --stack-name openprivy-vpc-eks --capabilities CAPABILITY_IAM

# 2. Databases (RDS + Redis + Secrets + S3), using outputs from step 1
aws cloudformation deploy --template-file aws/cloudformation-databases.yaml \
  --stack-name openprivy-databases --capabilities CAPABILITY_IAM \
  --parameter-overrides VpcId=<id> PrivateSubnet1=<id> PrivateSubnet2=<id>

# 3. Encryption master key
aws secretsmanager create-secret --name openprivy-prod/encryption/master-key \
  --secret-string "$(openssl rand -base64 32)"

# 4. Build & push the image, then apply k8s manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/migrate-job.yaml && kubectl wait --for=condition=complete job/db-migrate -n openprivy
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/ingress.yaml
```

Both CloudFormation templates pass `cfn-lint` with zero errors. The Dockerfile
and CI/CD workflows are written and internally consistent but have not been
executed end-to-end in this development environment (no Docker daemon / AWS
credentials available here) — that's the next real-infrastructure step.

### Disaster recovery
`docs/DR_RUNBOOK.md` — RPO ≤5 min / RTO ≤60 min targets, failure scenarios, and
a quarterly drill checklist. `scripts/db-backup.sh` / `scripts/db-restore.sh`
have been round-trip tested: identical row counts and intact encrypted key
data after a restore into a fresh database.

## Monitoring

```bash
curl http://localhost:3001/health        # liveness/readiness
curl http://localhost:3001/metrics       # Prometheus exposition format
```

Measured local baseline (single instance): ~3,290 req/s on `/health`,
~1,120 req/s on `/auth/me` (full JWT verify + Postgres read). Details and
reproduction steps in `test/load/RESULTS.md`.

## Launch readiness

Six gates stand between this repository and real user funds. None close by
writing more code alone — the full ledger with evidence is in
**`PRODUCTION_STATUS.md`**.

| Gate | Status |
|---|---|
| External security audit (custody, AA, auth) | Not started |
| Live ERC-4337 transaction confirmed on-chain | Test written, unrun — needs an environment with RPC egress, then a `SimpleAccount.sol` nonce fix for EntryPoint v0.7 |
| Load test + DR drill on real AWS infrastructure | Local baseline + backup/restore verified; RDS PITR and Multi-AZ failover need a real account |
| Master-key rotation tooling + rehearsed drill | Rotation primitive exists; batch tooling and drill do not |
| Docker image + CI/CD executed end-to-end | Rewritten, unexecuted in this environment |
| Money-transmitter / VASP licensing review | Not started — custodial key storage may require it depending on jurisdiction |

## Compliance & licensing

**SOC 2** — Type II (what enterprise buyers ask for) is realistically 4–6
months of evidence once controls are in place. Encryption, Secrets Manager,
IRSA least-privilege, and WorkOS's audit-log streaming already feed that
evidence base; formal access reviews, incident-response runbooks, and vendor
management do not exist yet.

**PCI DSS** — only applies if a fiat card on/off-ramp is added. If so, route
through a tokenizing processor and stay in SAQ-A scope; do not handle raw card
data directly.

**Money-transmitter / VASP licensing** — holding user private keys is a
custodial model, and custody of this kind can trigger licensing and BSA/AML/KYC
obligations depending on jurisdiction. This is a legal question for counsel,
independent of SOC 2 or PCI, and should be resolved before public launch.

## Development commands

```bash
npm run dev              # all services (turbo)
npm run build
npm run test
npm run lint
npm run format

cd services/backend && npm run dev     # backend only
cd apps/web && npm run dev             # web only
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Open a Pull Request

Please be respectful and constructive — this is a community project.

## License

No `LICENSE` file is committed yet, despite this repo previously claiming MIT —
that claim wasn't backed by an actual file. Add one (and a `license` field in
`package.json`) before treating this as open source or accepting outside
contributions.

## Further reading

- `PRODUCTION_STATUS.md` — verified / partial / blocked, with evidence for each
- `docs/AWS_PRODUCTION_DEPLOY.md` — ordered AWS deployment runbook
- `docs/DR_RUNBOOK.md` — disaster recovery scenarios and drill checklist
- `test/load/RESULTS.md` — measured load-test baseline
