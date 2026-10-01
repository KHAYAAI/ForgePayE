# Real infrastructure and the dust-test procedure

**Nothing here has been run.** Creating cloud resources, funding wallets and moving real tokens are actions that cost money
or are irreversible; they need you (or someone you authorise) to do or approve them. This is the exact order to do them in
and what to check at each step. Stop at the first thing that does not match.

## 0. What you need to provide

| Item | Notes |
|---|---|
| AWS account (and region) for the gateway; a **separate** account for backups if you later run custody | I could not sign in to AWS from the build environment; a first `terraform plan` is the first real test of `infra/terraform` |
| Base RPC provider | An endpoint without the key embedded in the URL, or keep it in a Secret |
| Wallets (generate offline/on a hardware wallet, never in chat or the repo) | **Payout wallet** (hot, holds the float), **sweep gas wallet** (separate, small ETH), **operating wallet**, **cold address** (public address only; the gateway never holds its key) |
| PagerDuty routing key and/or Slack webhook | stored in a Secret, tested with `POST /alerts/test` |
| Container registry and CI secrets | the workflows build nothing for the gateway image yet; add an image build/publish step |
| Domain, TLS, load balancer | set `TRUST_PROXY_HOPS` to the number of proxies in front |

## 1. Stand up the environment (staging first, then production)

1. `terraform -chdir=infra/terraform/examples/threshold-custody plan` against the staging account; read the plan. Only the
   `kms-keys`, `secrets` and `alerts` modules are needed for the bureau; the backup bucket and MPC modules are for custody.
   Apply only after you have read it.
2. Put the secrets in the secret store (not in the chart): `POSTGRES_PASSWORD`, `INTERNAL_WEBHOOK_SECRET`,
   `VALID_API_KEYS` (>= 32 characters each, from `openssl rand -hex 32`), `MERCHANT_API_KEYS` (leave empty), the three wallet
   keys, the alert credentials.
3. Create the KMS key for deposit-key wrapping (`kms-keys` module output `deposit_key_arn`).
4. **Run the KMS check against the real account before trusting it:**
   `KEY_WRAP_PROVIDER=awskms KEY_WRAP_KMS_KEY_ID=<arn> AWS_REGION=<r> npx tsx scripts/verify-key-custody.ts`. It has only ever
   run against a fake KMS. Fix whatever it reports.
5. `helm install` the gateway with `infra/helm/stablecoin-gateway/ci/launch-values.yaml` (placeholders filled in). One replica.
6. Check: `/health`, `GET /assets` (only USDC), `GET /alerts`, `POST /alerts/test` reaches a human, `GET /treasury` shows the
   wallets, logs show `Leader` acquired, `NODE_ENV=production` and no "insecure dev key" warnings.
7. Migrations are not serialised across replicas: roll out one pod first.

## 2. First contact, one asset at a time (USDC, then ZARP, then OUSD)

Do each asset completely before starting the next. Amounts are tiny (a few dollars). Record every transaction hash.

**Before touching an asset** (ZARP, OUSD): read the contract on Basescan and the issuer's docs; write down proxy/admin/owner,
pause/freeze/mint powers, rebasing yes/no, decimals; confirm the address with the issuer. Then add it to `ASSETS_ENABLED` and
check `GET /assets` shows it `available` and read every `findings` entry. A `rebasing` block means stop and decide with the issuer.
For ZARP also set the rand rate by hand (`PUT /assets/rates/USD-ZAR`, with a source) and run `GET /assets/rates/feed/check` to
see what the live sources say (the feed stays off).

**A. Inbound**
1. `POST /x402/pay` for $2 in the asset; note `pay_to` and `amount_units`.
2. From a wallet you control, send exactly that amount to `pay_to`. Watch the deposit go `pending -> confirming -> confirmed`.
3. Verify on a block explorer that the address received exactly `amount_units`. If the credited and held amounts differ, **stop**
   (a `deposit:balance:...` alert fires; this is the fee/rebase check).
4. `POST /sweeps/run` (or wait). Confirm the treasury received exactly what was swept and that the gas drip and its return look right.

**B. Outbound** (needs the payout wallet funded with a few dollars of the asset plus gas)
5. Create a $2 payout with `POST /payouts` using an **admin** credential and a payee address you control.
6. Approve it as a *different* identity than the requester, then submit it (`PAYOUT_AUTO_SUBMIT=false`).
7. Confirm the recipient received exactly the amount, and the payout is `confirmed` with the right hash.

**C. After a day**
8. Re-read the deposit address and treasury balances. Any drift without a transfer means the token rebases: stop that asset.
9. Check `GET /alerts`: no unexpected active alerts; every alert you saw was delivered.

**Exit criteria for an asset:** A and B each done once, balances reconcile to the unit, alerts reached a person, nothing in the
logs you cannot explain. Only then enable the next asset.

## 3. Ready to raise limits?

Not until: scope-A review findings are fixed and re-tested, counsel's written answer is in, the on-call rota has handled a test
page, and a restore-from-backup of the Postgres database has been done at least once (that is separate from the key-share drill).
