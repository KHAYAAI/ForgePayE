# Staging on Fly.io, step by step

**24 November 2026.** Staging for wave 1 (compliance monitor, stablecoin gateway, credit bureau, console) runs on **Fly.io** in Stockholm (`arn`).
**Production stays on AWS** (`14-deploying-services.md`, `15-aws-start-here.md`, `16-wave1-staging.md`): nothing there was removed, so if
counsel, the review firm or a partner prefers AWS, production goes there unchanged.

Why Fly.io for staging: it runs the same signed images, has managed Postgres and Redis and a private network, and is far less to set up
than a Kubernetes cluster. What stays the same: the code, the images, the scan and signature checks, deploy by digest, a human approval,
dry run first, and the Base Sepolia testnet plan.

**Never paste a password, token, key or wallet secret into chat, a ticket or this repository.** You type secrets only into your own terminal
(`fly secrets set`) or into GitHub's secret form.

## What runs where

| App (Fly name) | What | Reachable from | Config |
|---|---|---|---|
| `forgepay-stg-compliance` | Sanctions screening | Other apps only (private network) | `infra/fly/compliance-monitor/fly.toml` |
| `forgepay-stg-gateway` | USDC on Base Sepolia | Other apps only | `infra/fly/stablecoin-gateway/fly.toml` |
| `forgepay-stg-bureau` | Credit bureau | Other apps only (a public address comes before the sandbox pilot) | `infra/fly/agent-credit-bureau/fly.toml` |
| `forgepay-stg-console` | Web console | The internet (HTTPS) | `infra/fly/console/fly.toml` |
| `forgepay-stg-db` | Managed Postgres (one cluster, four databases) | Private network | created below |
| Upstash Redis (one per app) | Rate limits, caches | Private network | created below |

Apps talk to each other as `<app>.internal` (for example `http://forgepay-stg-bureau.internal:3018`). App names are global on Fly: if one is
taken, pick another, change `app = ...` in its `fly.toml` **and** every `.internal` address that points at it, and tell me.

## Step 1: account and tool (about 20 minutes)

1. Sign up at fly.io and add a payment card (staging runs a few small always-on machines plus Postgres and Redis; check their pricing page).
2. Install the command-line tool, `flyctl` (fly.io/docs/flyctl/install), then `fly auth login`.
3. Create an organization **only for staging**, so the deploy token can reach nothing else:
   `fly orgs create forgepay-staging`

## Step 2: the four apps

```bash
for a in forgepay-stg-compliance forgepay-stg-gateway forgepay-stg-bureau forgepay-stg-console; do
  fly apps create "$a" --org forgepay-staging
done
```

Do **not** run `fly launch` or allocate IP addresses. The three private apps must have no public address; the deploy workflow checks this
and refuses to deploy otherwise. The console gets its public address on its first deploy.

## Step 3: Postgres and Redis

```bash
fly mpg create --name forgepay-stg-db --org forgepay-staging --region arn --pg-major-version 16
fly mpg list --org forgepay-staging                       # note the cluster id
for d in compliance_monitor stablecoin_gateway bureau console; do fly mpg databases create <cluster-id> --name "$d"; done
for u in compliance_monitor stablecoin_gateway bureau console; do fly mpg users create <cluster-id> --username "$u" --role writer; done

# One Redis per app: Upstash has a single database per instance, and the bureau and gateway use the same rate-limit key names,
# so sharing one would let them count against each other. Note each redis:// URL it prints.
for a in compliance gateway bureau console; do fly redis create --name "forgepay-stg-$a-redis" --org forgepay-staging --region arn --no-replicas; done
```

If `arn` is not offered for Managed Postgres or Redis, choose the nearest European region it offers and tell me. Use a **direct**
connection (not a pooled one) for the gateway: its leader lock needs one.

Connect each app to its own database. `fly mpg attach` stores the connection string as a secret on the app:

```bash
fly mpg attach <cluster-id> -a forgepay-stg-bureau   --database bureau  --username bureau
fly mpg attach <cluster-id> -a forgepay-stg-console  --database console --username console
fly mpg attach <cluster-id> -a forgepay-stg-compliance --database compliance_monitor --username compliance_monitor --variable-name PG_URL
fly mpg attach <cluster-id> -a forgepay-stg-gateway  --database stablecoin_gateway --username stablecoin_gateway --variable-name PG_URL
```

Two apps need the connection in a different shape. Read the connection string in the Fly dashboard (Managed Postgres > your cluster > Connect, for that database and user), then set:
- **compliance monitor:** `DATABASE_URL` = the same URL with the scheme `postgresql+asyncpg://` instead of `postgres://`, and `?ssl=require` in
  place of any `sslmode=...`.
- **gateway:** split it into `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.

## Step 4: secrets (in your terminal)

Generate each random value separately: `openssl rand -hex 32`. No two secrets share a value. Use `--stage` so nothing restarts yet.

```bash
# Shared values, made once (do not echo them anywhere else):
ADMIN=$(openssl rand -hex 32)          # the bureau's admin key, also given to the console
CM_KEY=$(openssl rand -hex 32)         # the bureau's key for the compliance monitor
CM_HASH=$(printf '%s' "$CM_KEY" | sha256sum | cut -d' ' -f1)

fly secrets set --stage -a forgepay-stg-compliance DATABASE_URL='<asyncpg url>' REDIS_URL='<compliance redis url>' \
  JWT_SECRET=$(openssl rand -hex 32) INTERNAL_SERVICE_SECRET=$(openssl rand -hex 32) SERVICE_API_KEY_HASHES="$CM_HASH:bureau"

fly secrets set --stage -a forgepay-stg-bureau REDIS_URL='<bureau redis url>' BUREAU_ADMIN_API_KEY="$ADMIN" \
  CONSENT_SIGNING_SECRET=$(openssl rand -hex 32) WEBHOOK_SIGNING_MASTER=$(openssl rand -hex 32) COMPLIANCE_MONITOR_API_KEY="$CM_KEY"

fly secrets set --stage -a forgepay-stg-console BUREAU_ADMIN_API_KEY="$ADMIN" JWT_SECRET=$(openssl rand -hex 32) \
  INTERNAL_WEBHOOK_SECRET=$(openssl rand -hex 32) TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  FORGE_OPERATOR_TENANT_ID='<your workspace id>' REDIS_URL='<console redis url>'

fly secrets set --stage -a forgepay-stg-gateway POSTGRES_HOST=... POSTGRES_PORT=5432 POSTGRES_DB=stablecoin_gateway \
  POSTGRES_USER=stablecoin_gateway POSTGRES_PASSWORD='...' REDIS_URL='<gateway redis url>' \
  INTERNAL_WEBHOOK_SECRET=$(openssl rand -hex 32) VALID_API_KEYS=$(openssl rand -hex 32) \
  PRIVATE_KEY_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  BASE_RPC_URL='<Base Sepolia RPC URL>' PAYOUT_SIGNER_RPC_URL='<Base Sepolia RPC URL>' \
  PAYOUT_SIGNER_PRIVATE_KEY='<throwaway testnet payout key>' SWEEP_GAS_PRIVATE_KEY='<throwaway testnet gas key>' \
  SWEEP_TREASURY_ADDRESS='<testnet operating wallet ADDRESS>' ALERT_WEBHOOK_URL='<Slack webhook URL>'
unset ADMIN CM_KEY CM_HASH
```

The wallet keys are **throwaway testnet keys** made for staging only (`16-wave1-staging.md`, A7). Never use a key that has held real money.

## Step 5: GitHub (once)

1. Settings > Environments > **New environment** `staging`. Add yourself as required reviewer; limit deployment branches to `main`.
2. Make a deploy token for the staging organization only: `fly tokens create org --org forgepay-staging --name github-staging-deploy --expiry 2160h`
   (90 days). Paste it into the `staging` environment as the secret **`FLY_API_TOKEN`** (Settings > Environments > staging > Add secret). Nowhere else.

## Step 6: images signed from `main`

Deploys accept only images the images workflow signed on `main`. Merge this branch to `main` (a fast-forward); the images workflow then runs
and lists each image as `ghcr.io/khayaai/forgepay-<service>@sha256:...` in its summary.

## Step 7: deploy, in this order

Actions > **Deploy ForgePay service to Fly.io (staging)** > Run workflow (from `main`). For each service: paste its image line, **leave
dry run ticked**, run, approve. A dry run checks the signature, the app, every required secret (names only) and that a private app has no
public address. Then run again with dry run unticked.

1. `compliance-monitor` (its database migration runs first, as a release step)
2. `stablecoin-gateway`
3. `agent-credit-bureau`
4. `console`, then open `https://forgepay-stg-console.fly.dev`

A live run proves every running machine is on the approved digest. **Rollback:** run the workflow again with the previous digest.

## Step 8: check it works

- `fly logs -a <app>` for each app; `fly status -a <app>` shows health checks passing.
- If the bureau or console log a certificate error reaching Postgres, add `sslmode=no-verify` to its `DATABASE_URL` (staging only; see the table below).
- **The South Africa sanctions list copy expired on 5 November 2026.** Until it is replaced, the compliance monitor answers "error" for
  everyone and the bureau refuses to proceed. That is the safe behaviour, but it blocks every pull. Get a fresh copy from the FIC (or a
  confirmed live download address) and I will put it in and update the date.
- Then the proofs in `16-wave1-staging.md` section D: sanctions refuse and fail closed, the testnet deposit, sweep and approved payout (twice,
  a day apart), a sandbox report pull, alerts reaching a person.

## Custom address (optional, later)

`fly certs add console.staging.myforgepay.com -a forgepay-stg-console`, then add the DNS records it prints in Route 53 (in the account where
`myforgepay.com` lives). Until then use `forgepay-stg-console.fly.dev`; also set `NEXT_PUBLIC_APP_URL` and the `CORS_*` values in the
fly.toml files to whichever address you use.

## Staging-only shortcuts (each must change for production)

| Here | Production |
|---|---|
| Deposit keys wrapped with `PRIVATE_KEY_ENCRYPTION_KEY` (`KEY_WRAP_PROVIDER=env`; the gateway warns) | AWS KMS (`awskms`) |
| Wallet keys as Fly secrets (environment variables) | Mounted key files from AWS Secrets Manager |
| Postgres TLS not certificate-checked (`no-verify`, `ssl=require`) | Certificate verified |
| A long-lived Fly deploy token in GitHub | OIDC, no stored credentials |
| One approver | Two people |

## Saving money

The console stops itself when idle. To pause everything: `fly scale count 0 -a <app>` for each app (and `fly scale count 1` to resume).
Postgres and Redis keep charging while they exist.
