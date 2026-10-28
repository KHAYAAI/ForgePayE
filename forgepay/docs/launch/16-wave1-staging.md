# Wave 1 in staging: the bureau launch path

**27 October 2026.** The tracked checklist for deploying the four wave-1 services to **staging** and running them on **Base Sepolia**.
Wave 1 is the credit bureau and what it depends on: **compliance-monitor, stablecoin-gateway, agent-credit-bureau, console**. Later waves (custody, payments)
reuse everything in parts A to C and only repeat part D for each service.

Tick items in this file as they are done, with the date and who did it. Nothing here has been done yet.

## A. What you need besides the AWS account (you)

The account alone is not enough. In order:

| # | Item | Why | Done |
|---|---|---|---|
| A1 | Account secured: MFA on root, no root access keys, budget alerts, an everyday admin login (IAM Identity Center), CloudTrail on | Phase 1 of `15-aws-start-here.md`. Everything later runs under that admin login | [ ] (region given; the other checks not yet reported) |
| A2 | Region chosen: **`eu-north-1` (Stockholm)**, 28 October 2026. VPC `10.40.0.0/16` (`infra/staging/terraform/eu-north-1.tfvars`); the staging values' egress rules match it. The console's ACM certificate must be issued in `eu-north-1` | Fixes the VPC range and where everything is built | [x] 28 Oct |
| A3 | A separate **staging account** under AWS Organizations | Mistakes in staging cannot touch production, and its bill is separate | [ ] |
| A4 | Tools on your computer: AWS CLI v2, Terraform 1.6+, kubectl, Helm 3.15 | To run the plan and reach the cluster | [ ] |
| A5 | `myforgepay.com` DNS in Route 53 (or a `staging.myforgepay.com` zone delegated to it) and an ACM certificate for `console.staging.myforgepay.com` in the cluster's region | The console's public address | [ ] |
| A6 | A **Base Sepolia RPC provider** account (Alchemy, QuickNode, Coinbase CDP or similar) and an API key | The public endpoint is rate-limited; the key goes in a Secret, never in a values file | [ ] |
| A7 | Three **throwaway testnet wallets** (payout, sweep gas, operating), funded from faucets: Base Sepolia ETH, and test USDC from Circle's faucet | The testnet runs. Never reuse these for production | [ ] |
| A8 | An **alert destination**: a Slack incoming webhook, or PagerDuty | Gate 21: a person must receive alerts | [ ] |
| A9 | A **second person** who can approve deploys (GitHub reviewer) | The approval gate is meaningless if you approve your own deploys | [ ] |
| A10 | Rotate the Didit API key that was pasted into chat on 14 October | It must be treated as exposed | [ ] |

Never paste a password, key or wallet secret into chat, a ticket or this repository. Tell me what a screen says, not the secret on it.

## B. Shared foundation (once; you run it, I prepare and review)

| # | Step | How | Done |
|---|---|---|---|
| B1 | Terraform state bucket, lock table, KMS key, roles | `infra/staging/aws-prerequisites.sh <region>` | [ ] |
| B2 | **Plan** staging: VPC, EKS, RDS Postgres 16, ElastiCache Redis, KMS, Secrets Manager | `infra/staging/deploy-staging.sh <region> --dry-run`. We read the plan and its cost together before anything is built | [ ] |
| B3 | Build staging | the same script without `--dry-run`. Costs money every hour; tear down with `teardown-staging.sh` when idle | [ ] |
| B4 | **Cluster add-ons** (not installed by any script yet; I will script this step): AWS Load Balancer Controller (the console's ingress is `alb`), External Secrets Operator or a documented manual way to create the Kubernetes Secrets from Secrets Manager, metrics-server. Later: the Prometheus operator, which the charts' ServiceMonitors need (they are off in the staging values until then) | to be written | [ ] |
| B5 | Databases and users: `stablecoin_gateway`, `bureau`, `compliance_monitor`, `console`, each with its own user and a generated password (hex, no `%`) | on RDS, from a pod or a bastion | [ ] |
| B6 | GitHub: environments `staging` and `production`, each with required reviewers and deployments limited to `main`; their variables; the OIDC provider and one deploy role per account trusting only its environment | `14-deploying-services.md` | [ ] |
| B7 | **Merge this branch to `main`** so images signed by `main` exist (deploys accept only those) and run the images workflow there | your decision; the branch is 0 commits behind `main`, so it is a fast-forward | [ ] |

## C. Wave 1 deploy order

Deploy in this order; each depends on the one before. **Dry run first, every time.**

1. compliance-monitor: its migration Job runs first; then check `GET /health` and that the lists loaded
2. stablecoin-gateway: migrates itself before opening its port
3. agent-credit-bureau
4. console: the only one with a public address

## D. Per-service checklist (repeat for each service)

| Step | compliance-monitor | stablecoin-gateway | agent-credit-bureau | console |
|---|---|---|---|---|
| Signed image from `main` exists (images workflow summary) | [ ] | [ ] | [ ] | [ ] |
| Kubernetes Secret created (keys below) | [ ] | [ ] | [ ] | [ ] |
| `REPLACE-` values filled in `values-staging.yaml` (gateway only) | n/a | [ ] | n/a | n/a |
| Dry-run deploy passes | [ ] | [ ] | [ ] | [ ] |
| Live deploy passes (digest proof included) | [ ] | [ ] | [ ] | [ ] |
| Health check answers | [ ] | [ ] | [ ] | [ ] |
| Service-specific proof (below) | [ ] | [ ] | [ ] | [ ] |
| An alert fires and a person receives it within 5 minutes | [ ] | [ ] | [ ] | [ ] |

### Secrets per service (names only; values go into Secrets Manager, then into the Kubernetes Secret)

Generate each random value separately: `openssl rand -hex 32`. No two secrets may share a value.

| Service | Kubernetes Secret | Keys |
|---|---|---|
| compliance-monitor | `compliance-monitor-secrets` | `DATABASE_URL` (`postgresql+asyncpg://compliance_monitor:<pw>@<rds>:5432/compliance_monitor?ssl=require`), `REDIS_URL` (`rediss://<elasticache>:6379/2`), `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `SERVICE_API_KEY_HASHES` (`<sha256 of the bureau's key>:bureau`) |
| stablecoin-gateway | `forgepay-stablecoin-gateway-secrets` | `POSTGRES_PASSWORD`, `INTERNAL_WEBHOOK_SECRET`, `VALID_API_KEYS`, `BASE_RPC_URL`, `PAYOUT_SIGNER_RPC_URL` (both Base Sepolia) |
| stablecoin-gateway | `sgw-payout-signer-key`, `sgw-sweep-gas-key` (key `key`); `sgw-alerts` (key `webhook-url`) | testnet wallet keys only; the alert webhook |
| agent-credit-bureau | `bureau-agent-credit-bureau-secrets` | `DATABASE_URL` (`postgres://bureau:<pw>@<rds>:5432/bureau?sslmode=no-verify`), `REDIS_URL`, `BUREAU_ADMIN_API_KEY`, `CONSENT_SIGNING_SECRET`, `WEBHOOK_SIGNING_MASTER`, `COMPLIANCE_MONITOR_API_KEY` (the raw key whose hash the monitor holds), `ZA_TFS_URL` and `ZA_TFS_SNAPSHOT_AT` as in `infra/launch/bureau/launch.env.template`. Check with `infra/launch/bureau/preflight.mjs` |
| console | `console-secrets` | `JWT_SECRET`, `DATABASE_URL`, `BUREAU_ADMIN_API_KEY` (same value as the bureau's), `INTERNAL_WEBHOOK_SECRET`, `FORGE_OPERATOR_TENANT_ID`, `REDIS_URL`, `TOTP_ENCRYPTION_KEY` (64 hex); the full table, with notes, is in `14-deploying-services.md` |

### Service-specific proof

- **compliance-monitor:** a known OFAC-listed address is **refused**; with the monitor stopped, the bureau **refuses** rather than proceeds (gate 20).
- **stablecoin-gateway:** on start-up it verifies the USDC contract on Base Sepolia (`GET /assets` shows it verified). Then the testnet run: deposit (exact amount), sweep, a payout approved by someone other than the requester, reconciliation. Twice, a day apart, with no unexplained balance difference (gate 19).
- **agent-credit-bureau:** `preflight.mjs` passes; a sandbox lender pulls a report with consent; a tier change sends a signed webhook.
- **console:** `https://console.staging.myforgepay.com/api/healthz` answers through the load balancer; an operator can sign in and onboard an institution.

## E. Known gaps found while preparing this

Fixed 28 October, before anything was built (each would have stopped the build): the Terraform asked for **Kubernetes 1.29**, past even EKS extended
support (now 1.35, standard support to 27 March 2027); for **Postgres 16.4**, which AWS has deprecated (now "16", AWS's current 16.x); and for
worker nodes without an OS image type (now Amazon Linux 2023, which current Kubernetes versions need). The cluster also now accepts **access
entries**, which the deploy role's cluster access depends on. Checked locally with `terraform fmt`; `terraform validate` runs in CI (the
provider registry is not reachable from where this was prepared).

Still open:

| Gap | Effect | Plan |
|---|---|---|
| Postgres TLS is **encrypted but not verified** in the staging settings (`ssl=require`, `sslmode=no-verify`, `PGSSLMODE=no-verify`) | AWS's Postgres 16 refuses unencrypted connections, so this is needed to connect at all; not checking the certificate is acceptable inside the staging VPC only | Before production: ship the RDS certificate bundle to the pods and verify it |
| The bureau chart has **no public address** (no ingress) | Lenders cannot reach the API from outside, so the sandbox pilot (level 0) cannot start from staging as it stands | Add an ingress to the bureau chart before level 0 |
| No `values-prod.yaml` for compliance-monitor, gateway, bureau | A production deploy would warn and use chart defaults | Write them from the staging files once staging has passed |
| South Africa sanctions list copy expires **5 November 2026** | After that, screening refuses everyone (safe, but blocks) | Replace the file and its date, or switch `ZA_TFS_URL` to the live FIC download once it is proven to load |
| UK sanctions list URL not set | The UK list is not screened | Confirm the current FCDO CSV URL and columns |
| The console image scan failed in CI from 20 October (after the Next 16 upgrade). Cause, found 27 October: Next 16 writes server source maps that embed the WorkOS SDK's source, whose error message and doc example contain placeholder strings shaped like a GitHub token and a Stripe key; the scan's secret check flagged them. Not ForgePay secrets | No signed console image could be produced | **Fixed:** the image no longer ships source maps (Dockerfile). Local scan of the build output is clean and the built console answers `/api/healthz`; CI confirmation on the next images run |
| Cluster add-ons are not installed by any script (B4) | The console ingress and the Secrets would not work on a bare cluster | I write that script next |
