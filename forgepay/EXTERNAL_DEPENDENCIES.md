# ForgePay — External Dependencies

Everything the platform needs from outside the codebase to run in production,
where to get it, and how to wire it. Grouped by category. Each row lists the
env var(s) the services read (harvested from every `services/*/.env.example`)
so you can map a credential straight to the service that consumes it.

**Legend — priority to go live:**
🔴 required for MVP · 🟡 required for the feature that uses it · ⚪ optional

---

## 1. AWS platform (provisioned by `infra/terraform`)

These come up when you `terraform apply` — you don't sign up per-service, you
just need an AWS account with quota. See `DEPLOY_AWS.md`.

| Dependency | Priority | What it is / how |
|---|---|---|
| AWS account + IAM | 🔴 | Root account, an IAM admin for Terraform, and a CI deploy role. Console → IAM. Request EC2/EKS quota in your region early (t3.xlarge nodes). |
| EKS | 🔴 | Kubernetes control plane — the `eks` module. `kubernetes_version` default 1.29. |
| RDS PostgreSQL | 🔴 | `rds` module. Every service reads `DATABASE_URL` / `DB_HOST…`. One instance, a database per service (or shared with schemas). |
| ElastiCache Redis | 🔴 | `redis` module. `REDIS_URL`. Rate limiting, caches, queues. |
| S3 | 🔴 | `s3` module — backups/logs/artifacts. |
| ECR | 🔴 | Container registry for service images. `aws ecr create-repository` per service; push in CI. |
| ACM certificate | 🔴 | TLS for CloudFront/ALB. Request in ACM for `*.forgepay.io`; put the ARN in `acm_certificate_arn`. Must be **us-east-1** for CloudFront. |
| Route 53 (or your DNS) | 🔴 | Hosted zone for `forgepay.io`; point records at CloudFront/ALB. |
| CloudFront | 🟡 | `cloudfront` module — CDN/WAF front door. |
| KMS | 🔴 | Encryption keys (RDS, S3, Vault auto-unseal) — created by the modules. |
| Secrets Manager | 🔴 | Store DB password, API keys, webhook secrets. Inject via `TF_VAR_*` and External Secrets Operator / CSI driver into pods. Do **not** hardcode in Helm values (see CLAUDE.md security rules). |
| CloudWatch + SNS | 🟡 | `monitoring` module — logs + alarms to `alert_email`. |

---

## 2. Secrets & key management

| Dependency | Priority | Env / where | How |
|---|---|---|---|
| HashiCorp Vault | 🔴 | `VAULT_ADDR`, `vault_namespace` | Runs in-cluster (Helm). The `vault` TF module gives it a KMS auto-unseal key + IRSA role. All Kubernetes secrets and the PCI card vault route through it. Alternatively use AWS Secrets Manager end-to-end. |
| Self-generated secrets | 🔴 | `JWT_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_WEBHOOK_SECRET`, `CONSOLE_SECRET`, `SIGNER_PRIVATE_KEY`, all `*_WEBHOOK_SECRET` | You generate these (`openssl rand -hex 32`) and store in Vault/Secrets Manager. They are **not** third-party — just don't commit them. `SIGNER_PRIVATE_KEY` is the custody/settlement signer; keep it in Vault/KMS/HSM. |

---

## 3. Blockchain RPC & account-abstraction (crypto-gateway, stablecoin-gateway, forge-wallet, forge-custody, chain-sync, on-chain settlement)

| Dependency | Priority | Env | Where to get it |
|---|---|---|---|
| Alchemy | 🔴 (for crypto) | `ALCHEMY_API_KEY`, `ETH_RPC_URL`, `POLYGON_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL` | alchemy.com → create an app per network, copy the HTTPS RPC URL + key. Infura or QuickNode are drop-in alternatives. |
| Bitcoin / Monero RPC | 🟡 | `BTC_RPC_URL`, `XMR_RPC_URL` | Only if you enable BTC/XMR in crypto-gateway. Run your own node or use GetBlock/NOWNodes. |
| Pimlico | 🟡 | `PIMLICO_API_KEY` | pimlico.io — ERC-4337 bundler + paymaster for gasless agent wallets (forge-wallet / open-privy). Alchemy AA is an alternative. |

---

## 4. Payments & banking (payment-engine/Hyperswitch, bank-connectivity, mor-layer)

| Dependency | Priority | Env | Where / how |
|---|---|---|---|
| Hyperswitch | 🔴 | `HYPERSWITCH_WEBHOOK_SECRET` | The payment router is the vendored Hyperswitch core (this repo). Self-hosted; configure connector credentials in its dashboard. |
| Stripe | 🔴 | (via Hyperswitch connector config) | stripe.com — card acquiring. Add keys in Hyperswitch. |
| Circle | 🟡 | (Hyperswitch / stablecoin-gateway) | circle.com — USDC mint/redeem + payouts. |
| Peach Payments | 🟡 (ZA) | (Hyperswitch connector) | peachpayments.com — primary South African card acquirer. |
| Stitch | 🟡 (ZA) | (bank-connectivity) | stitch.money — South African bank EFT / pay-by-bank. |
| Plaid | 🟡 | `PLAID_CLIENT_ID`, `PLAID_SECRET` | plaid.com — bank account linking/verification (US/EU). dashboard.plaid.com. |

---

## 5. Compliance — KYC / AML / sanctions (compliance-monitor, mor-layer)

| Dependency | Priority | Env | Where / how |
|---|---|---|---|
| Chainalysis | 🔴 (crypto) | `CHAINALYSIS_API_KEY` | chainalysis.com — wallet screening / crypto AML. Sales-led onboarding. |
| Elliptic | ⚪ (alt) | `ELLIPTIC_API_KEY` | elliptic.co — alternative crypto AML. |
| OFAC SDN list | 🔴 | `OFAC_SDN_URL` | Free US Treasury sanctions list (treasury.gov/ofac). Polled/cached by compliance-monitor. |
| EU sanctions list | 🟡 | `EU_SANCTIONS_URL` | Free EU consolidated list. |
| KYC/identity vendor | 🔴 | (compliance-monitor / mor-layer) | Not yet keyed in env — pick one: **Smile ID** (Africa), Sumsub, or Onfido. Needed for merchant + agent-operator onboarding under FSCA/FIC (see SOUTH_AFRICA_LICENSES.md). |

---

## 6. Billing & subscriptions (billing-engine / Kill Bill)

| Dependency | Priority | Env | How |
|---|---|---|---|
| Kill Bill | 🟡 | `KILLBILL_BASE_URL`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET`, `KILLBILL_WEBHOOK_SECRET` | Self-hosted (vendored). Runs as its own service + its own DB. Configure tenant API key/secret on first boot. |

---

## 7. Identity federation & agent identity (agent-identity, unified-router, mobile)

| Dependency | Priority | Env | How |
|---|---|---|---|
| KYAPay | 🟡 | `KYAPAY_BASE_URL`, `KYAPAY_API_KEY`, `KYAPAY_API_SECRET`, `FORGEPAY_ISSUER_URL` | Agent-identity federation / external DID import. Partner-provisioned. |
| Supabase | 🟡 | `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_*` | supabase.com — used by the mobile app + some auth flows. Create a project, copy URL + anon/service keys. Can be dropped if you standardize on the platform's own Postgres auth. |
| World ID | ⚪ | (Qova/agent-credit integrations) | developer.worldcoin.org — optional proof-of-personhood for sybil-resistant agent verification. |

---

## 8. RWA & yield (rwa-registry, yield-engine, agent-liquidity-manager)

| Dependency | Priority | Env | How |
|---|---|---|---|
| Ondo | ⚪ | `ONDO_API_KEY` | ondo.finance — tokenized US treasuries for the RWA/yield products. Only if those products ship. |

---

## 9. Observability & notifications

| Dependency | Priority | Env | How |
|---|---|---|---|
| Sentry | 🟡 | `SENTRY_DSN` | sentry.io — error tracking. Create a project per service or one shared. |
| Prometheus + Grafana | 🟡 | (in-cluster, `observability/`) | Self-hosted via Helm. Every service already exposes `/metrics`. |
| Slack | 🟡 | `SLACK_WEBHOOK_URL` | api.slack.com/messaging/webhooks — ops/CSM/churn alerts. |
| CRM | ⚪ | `CRM_WEBHOOK_URL`, `CRM_API_KEY` | HubSpot/Salesforce — onboarding + churn events. |
| Email (SES/SendGrid) | 🔴 | (platform `lib/email`) | AWS SES (cheapest on AWS; verify your domain + move out of sandbox) or SendGrid. Sends verification + onboarding email from signup. |

---

## Fastest path to a working MVP (minimum external set)

To get the console + payments + bureau live you need only the 🔴 items:

1. **AWS account** (EKS, RDS, Redis, S3, ECR, ACM, Route 53, KMS, Secrets Manager) — one `terraform apply`.
2. **Vault** (in-cluster) + your **self-generated secrets**.
3. **Alchemy** (if crypto rails are on) — one key, a URL per chain.
4. **Hyperswitch + Stripe** (card acquiring) — for live payments.
5. **Chainalysis + OFAC + a KYC vendor** — compliance gate for onboarding.
6. **SES** — transactional email.

Everything else (Circle, Peach, Stitch, Plaid, Pimlico, Kill Bill, KYAPay,
Supabase, Ondo, Sentry, Slack, World ID) turns on the specific feature that
reads it and can follow after first launch.
