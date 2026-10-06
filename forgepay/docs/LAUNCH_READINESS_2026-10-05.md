# FORGE launch readiness — 5 October 2026

How this was checked: every service was typechecked and its test suite run;
the bureau, treasury and unified-router were started locally (with Postgres 16
and Redis) and the console's own client code (`apps/platform/lib/forge-services.ts`)
was called against them; the console was production-built; the website's
links and checkout calls were traced; CI runs on this branch were read through
the GitHub API. Problems found along the way were fixed and pushed (commits
`de7426f5` to `f9ea918a`); what could not be fixed is listed as open.

## Verdict

| Product | Launch | Why |
|---|---|---|
| Credit Bureau | **Closest. Not yet.** | Code, tests and console wiring are ready. Open: ZA sanctions list URL, confirm the security scan now passes, AWS and domain setup, external sign-offs. |
| Custody | Later | Engineering is deep and tested; needs separate hosts, a real officer drill and an independent review. |
| Wallet | No (testnet) | Key scheme rebuilt today (per-key KMS); KMS key and legacy-wallet sweep still to do. |
| Payments | No | Path now works end to end in code; needs licensing, an acquirer, real Hyperswitch/Kill Bill deployment, settlement payouts. |
| Treasury, yield, tokenised assets | No | Faked data paths removed; real execution (settlement rail, yield withdrawals, Ondo) not built. |
| Agent stack | No | Escrow now durable; credit lines and liquidity moves are bookkeeping. |
| Compliance monitor | Internal only | Fails closed on every list; ZA/UK list formats unconfirmed; goAML drafts only. |
| Console | Yes, for the bureau | Builds, wired, scoped per workspace. Needs production env configured. |
| Website | Yes, as a waitlist site | Claims corrected; checkout closed by default. |

## Is the frontend connected to the backend?

The console talks to five services. Every call was checked against the
service's routes, and the bureau, treasury and router calls were run live.

| Console call | Service route | Status |
|---|---|---|
| Bureau stats, agents, dual scores, disputes, detail, verify, register | `agent-credit-bureau /v1/...` | **Works** (live): scoped to the workspace; another workspace gets "not found" |
| Dispute resolution | `PUT /v1/disputes/:id` | Works; operator workspace only |
| Treasury summary, approve | `enterprise-treasury /v1/cash-position, /v1/rules, /v1/rules/approvals, /v1/netting/flows` | **Works** (live). Page read the wrong field names for netting and approvals; **fixed** |
| Merchant summary, product catalog | `unified-router /v1/merchant/summary, /v1/products/catalog` | **Works** (live) |
| Events feed, webhook endpoints | `unified-router /events/...` | **Was broken (401 on every call); fixed.** Also closed an auth bypass on that route |
| Custody console and actions | `openfireblocks api-gateway /admin/customers/:id/custody/...` | Routes match (static check; gateway not started) |
| Wallet list, create, balance, history, recovery | `open-privy /wallet/..., /transactions/history, /recovery/...` | Routes match (static check; not started) |
| Service health | each service's health path | Works; now needs sign-in |

Website: the only backend calls are on `checkout/` (`/v1/pricing`,
`/v1/checkout/sessions`, `/confirm`), which match unified-router. The payments
page sent visitors into that live checkout although payments are not open;
those buttons now go to the waitlist and the checkout stays closed unless
`window.FORGE_CHECKOUT_OPEN = true`.

Products with no console page at all: tokenised assets (rwa-registry), yield,
credit lines, negotiation, liquidity manager, institutional reporting,
compliance (goAML exports), billing, and the operations step for recording an
executed bank settlement. None is launching, but an operator UI for settlement
execution and goAML export is needed before treasury or reporting go live.

## Is the frontend up to date?

It was not; these were fixed today:

- Treasury page: wrong field names (every netting and approval row was blank),
  claims of yield sweeps and an "agent credit flow" that do not exist; now
  shows balance age and refresh errors.
- Payments pages: a 2.2% + R0.20 take rate matching no tier, "the platform is
  free", a "tier routing contract enforced on every payment" for routing code
  that was retired, connector scoring and a dispute feed that do not exist.
- Merchant treasury: "sanctions screening on every settlement" (not connected).
- Wallet: did not say testnet-only.
- Landing page: Payments R15,000/mo and Treasury R40,000/mo with features that
  do not exist; now "After licensing".
- Bureau scores: Mode 2 shown from Mode 1 (fixed earlier), "FICO" wording.

Still stale: the console has no pages for the products listed above.

## Build, tests and CI per service

All counts from runs today. "PG" means run against Postgres 16.

| Service | Typecheck | Tests | Notes |
|---|---|---|---|
| agent-credit-bureau | ok | 398 pass, 6 skipped | |
| unified-router | ok, lint ok | 100 | lint was never runnable (no eslint); fixed |
| enterprise-treasury | ok | 66 | |
| bank-connectivity | ok | 21 (PG) | 10 need a database |
| rwa-registry | ok | 76 (PG) | 6 broken tests fixed |
| accounts-service | ok | 20 | |
| agent-identity | ok | 83, 17 skipped | |
| agent-credit-lines | ok | 29 | |
| agent-decision-framework | ok | 42 | |
| agent-liquidity-manager | ok | 70 | |
| agent-negotiation | ok | 49; 53 (PG) | |
| bank-whitelabel | ok | 14 | |
| chain-sync | ok | 9 | |
| crypto-gateway | ok | 40 | |
| stablecoin-gateway | ok | 176, 2 skipped | nightly e2e (ganache) failing in CI |
| institutional-reporting | ok | 36 | |
| yield-engine | ok | 35, 14 skipped | |
| billing-engine | n/a | 11 config + 10 plugin | plus live Kill Bill 0.24.10 run |
| open-privy backend | ok | 41, 1 skipped | workspace-root typecheck fails (mobile app) |
| custody api-gateway | ok | 120, 5 skipped | |
| custody Go services | build ok | all pass | mpc-signer's threshold-signing package takes ~21 minutes; an earlier "failure" was a timeout |
| mor-layer | ruff ok, mypy ok locally | 107 (PG + Redis) | mypy fails in CI (log not readable here) |
| compliance-monitor | n/a | 154 | |
| console (apps/platform) | ok | 15, 3 skipped | **production build failed** without secrets at build time; fixed |
| sdk-python | ruff, mypy ok | 27 | could not be imported (syntax error); fixed |
| sdk-js | **fails** | 74 / 75 | imports a nonexistent wasm package; build configs missing |

CI on this branch, after today's fixes: Docker Build & Push green; Smoke green;
ForgePay CI still failing on mor-layer mypy and sdk-js; bureau/custody images
failing on a Trivy CRITICAL scan (findings not readable from this session);
Deploy Platform and console image were failing on the build-secret problem,
fixed in `f9ea918a`.

## Open items, in launch order (bureau first)

1. **Set `ZA_TFS_URL`** (FIC Targeted Financial Sanctions list) and confirm its
   CSV columns; until then production screening refuses to clear anyone,
   including the bureau's.
2. **Confirm the security scan passes.** The bureau's four high-severity
   dependency findings were fixed (`npm audit` reports 0). Custody and
   stablecoin images still need their findings read in GitHub's Security tab.
3. **Done: new agents start at the bottom.** Mode 1 is capped by reported
   repayment history: 300 (DEEP_SUBPRIME) with none, rising to the full range
   at 12 on-time payments; defaults and 90-day-late payments never build history.
4. **Configure production env** for the console and bureau:
   `FORGE_OPERATOR_TENANT_ID`, `BUREAU_ADMIN_API_KEY`, `JWT_SECRET`,
   `INTERNAL_WEBHOOK_SECRET`, `FORGE_LAUNCHED_PRODUCTS`.
5. Fix mor-layer mypy in CI and the JS SDK (missing package, missing build configs).
6. **Add myforgepay.com on AWS** (the single domain across the repo now):
   hosted zone, `*.myforgepay.com` certificate (us-east-1 for CloudFront),
   CloudFront aliases, and mailboxes for the addresses in the code.
   `docs.myforgepay.com` (14 links) has no site behind it yet.
7. External: counsel on POPIA / credit-bureau status, FIC registration, an
   independent review, licences and an acquirer for payments.

## Update, 6 October 2026: bureau launch items

| Item | Result |
|---|---|
| 1. South African sanctions list | **Working from a recorded copy; download address unconfirmed.** A full copy of the FIC list file was supplied (XML dataset, 1,002 entries) and is bundled at `services/compliance-monitor/src/data/za_tfs_snapshot.xml`. The monitor reads that layout and loads a `file://` source; the copy's age counts from `ZA_TFS_SNAPSHOT_AT` (not from when it was loaded), so it goes stale on schedule, and screening refuses once it is older than `ZA_TFS_MAX_AGE_HOURS` (set to 720, a limit the owner accepted for this list only). Verified: loads 1,002 entries and matches known names. **Risk:** a copy up to 30 days old can miss a new UN designation. The download address supplied (`https://tfs.fic.gov.za/Pages/TFSListDownload?fileType=xml`) could not be fetched from the build environment; once it is confirmed, switch `ZA_TFS_URL` to it and the list refreshes on its own. The snapshot date is the upload time, an assumption: the file itself does not say when the FIC generated it. |
| 2. Production settings | **Tooling done, values not set.** `infra/launch/bureau/` holds a template (no secrets), `generate-secrets.sh` (writes the four secrets outside the repo, mode 0600, never prints them) and `preflight.mjs` (checks an env file; refuses placeholders, short or shared secrets, `CORS_ORIGIN=*`, a missing ZA list, and any launched product other than the bureau). The real values must be created and stored in AWS Secrets Manager by the owner. |
| 3. myforgepay.com on AWS | With the owner. |
| 4. Security scan on the bureau image | **Cause found and fixed, passing in CI not yet seen.** The scan failed on HIGH and MEDIUM findings in the npm bundled with the Node base image, because the scan action ignores its severity setting for SARIF output. The workflow now sets `limit-severities-for-sarif`, and the bureau's runtime stage removes npm, which it never runs. An equivalent image built locally scans clean at every severity (0 findings). Custody and stablecoin images were not changed. |
| 5. Staging run and Base Sepolia test | **Partly done.** Run locally in production mode against Postgres and Redis: boots only with the required settings (refuses without the admin key), a new agent registers at 300 / DEEP_SUBPRIME with THIN_FILE cited, state survives a restart, calls without a key are refused with 401, and sanctions screening reports not clear when the compliance monitor is unreachable. **Not done:** the real compliance monitor with live lists, any Base Sepolia transaction (the RPC and faucets are unreachable from here, and a funded test key is needed), and the console in production mode against this bureau. |
| 6. External sign-offs | With outside parties. |

### Image scans, later on 6 October

Seven of the eight images passed the CRITICAL gate in CI on `74335fe9` (bureau, api-gateway, policy-service, temporal-worker, mpc-signer, mpc-node, stablecoin-gateway). The console failed: its Dockerfile copied the build stage's full `node_modules` over the production install, so the test runner and its CRITICAL findings shipped in the image. The Dockerfile now installs production dependencies only, drops npm, and starts Next directly; a `.dockerignore` was added; nodemailer went 6.9 to 10.0.15 (HIGH findings; mail send checked with a JSON transport). An equivalent image built locally has no CRITICAL findings. **Still open, not blocking:** two HIGH findings in the postcss copy bundled inside Next (fix needs Next 16), and CI has not yet been seen passing on these console changes.

