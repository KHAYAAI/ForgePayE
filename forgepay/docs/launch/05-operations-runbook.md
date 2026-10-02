# Operating the bureau launch: on-call, alerts, daily reconciliation

**Written, not rehearsed.** None of this has been run by a person on a real deployment. Rehearse each section once in
staging (a game day) before launch and fix what the rehearsal finds. Names and contacts are blanks for you to fill.

## 1. On-call

| | |
|---|---|
| Primary / secondary | `<name, phone>` / `<name, phone>` (someone must be reachable 24h while money can move) |
| Escalation after 15 min unacknowledged | `<name>` |
| Who may stop outflows | any on-call: set `payout.signerEnabled=false` (Helm) or remove the signer key Secret; no approval needed |
| Who may change limits | two people, in writing (`04-conservative-launch.md`) |
| Incident record | a ticket per incident: time, alert, what was done, money affected, follow-up |

**Rule: when in doubt, stop outflows first, investigate second.** Deposits can keep being received while payouts and sweeps are off.

## 2. Alerts and what to do

All alerts come from `src/lib/watchdog.ts`, `reconcile-runner.ts`, `settlement.ts`. `GET /alerts` shows what is active.

| Alert key | Severity | Means | First actions |
|---|---|---|---|
| `treasury:shortfall` | critical | Approved payouts cannot be funded within caps | `GET /treasury/status`: which asset, how short, why. Fund the operating wallet by hand if intended; never raise a cap without the two-person rule |
| `payouts:waiting` | critical | Approved payouts unsent for 15+ min | Is `PAYOUT_AUTO_SUBMIT=false` (expected: someone must submit)? If auto: check the payout worker log, signer wallet gas and balance, RPC health |
| `payouts:failed` | critical | A payout is `failed` | **Do not retry blindly: a failed payout may have been sent.** Look up the hash on a block explorer first. Re-issue only after confirming nothing landed |
| `sweeps:failed` | warning | A sweep failed; funds sit in a deposit address | Read the error. Common: gas wallet empty, gas above ceiling. Fix, then `POST /sweeps/:id/retry` |
| `fx:stale` | warning → critical | USD/ZAR rate near/past expiry | `PUT /assets/rates/USD-ZAR` with a source after checking two independent sources. ZARP quoting is refused until fresh |
| `fx:feed` | warning | The feed refused to update the rate | Compare `GET /assets/rates/feed/check` with a reference; set by hand if it is the feed that is wrong |
| `assets:unverified` | critical | A token failed its on-chain check | `GET /assets` for which and why. New deposits/payouts in it stop; do not override |
| `deposit:balance:<id>` | critical | Events show a payment the address does not hold | Treat as a possible fee-on-transfer/rebasing token or RPC lag. Wait one pass; if it persists, stop that asset |
| `asset:upgraded:<sym>:<chain>` | critical | A token's proxy implementation changed | Read what the issuer changed before accepting more of that asset |
| `recon:mismatch` | critical | A record does not match the chain | See section 3 |
| `recon:errors` | warning | Reconciliation could not check everything | Usually RPC trouble; re-run; if it persists the check is blind, treat as critical |

**Test the path, not just the code.** After configuring destinations, and then weekly: `POST /alerts/test`. A human must receive it
within five minutes; record who and when. If delivery failed, `GET /alerts` shows `deliveryFailures`: fix before anything else.

## 3. Daily reconciliation (a person, every day money moves)

The gateway runs `reconcile` once a day (`RECONCILE_INTERVAL_HOURS`, window `RECONCILE_WINDOW_HOURS`=72) and on demand:
`POST /reconcile/run`, `GET /reconcile`. It checks, for the last 72 hours, against the chain:
credited-but-unswept deposits still hold at least what was credited; every sweep marked done shows a successful transfer of its
units to the treasury; every payout marked confirmed shows a successful transfer of its units to the payee; and nothing has sat in
flight over an hour. It reports; it never repairs.

**What it does not prove:** that wallet balances in total equal the ledger. So each day also:

1. Run `POST /reconcile/run`; the report must show `clean: true` with non-zero `examined` counts on a day with activity. A clean
   report with nothing examined on a busy day means it is blind.
2. Record, from `GET /treasury/status` and a block explorer: payout wallet, operating wallet, cold address, gas wallet balances
   per asset. Compare with yesterday's figure plus the day's ledger movements (deposits swept in, payouts out, replenishments,
   cold sweeps). Any unexplained difference is an incident.
3. Sign and date the reconciliation log (a spreadsheet is fine). Two signatures when any limit was changed that day.

A `deposit_short`, `sweep_unverified` or `payout_unverified` finding is critical: stop outflows, then find the transaction.
Possible causes: a database edit, a bug, a token that does not behave like a plain ERC-20, a chain reorganisation, or theft.

## 4. Load and capacity (measured on a laptop-class local chain)

`scripts/load-test.cjs`, also run nightly: 107 deposits/s opened at concurrency 30 (p95 ~0.6s); 150 payouts created and approved
(p95 0.25s); 600 reads (p95 41ms); rate limit enforced against forged forwarding headers. **Settlement:** 60 paid deposits
confirmed in 17s, 400 in 44s with an instant local chain. Settlement makes calls per open deposit each pass, so on a real RPC
with real latency (and a rate-limited provider) it will be slower, possibly much slower; measure on staging with your provider
before expecting volume. Not tested: multiple replicas, a real chain, real signer latency, sustained hours, failure injection.

## 5. Game day (do once in staging before launch)

- [ ] Page fires and reaches the on-call within 5 minutes (`POST /alerts/test`, then force a `payouts:failed`)
- [ ] Stop outflows using only this document, in under 5 minutes
- [ ] Kill the leader replica mid-payout; confirm another takes over and nothing is sent twice
- [ ] Restore the Postgres database from backup into a scratch instance with `services/stablecoin-gateway/scripts/db-restore-drill.sh` (counts and checksums must match), then run `reconcile` against it. (The script has only been run against a local dev database, not a managed backup.)
- [ ] Change a payout amount in the database; confirm `payout_unverified` appears
- [ ] Run the dust-test procedure (`03-infrastructure-and-dust-test.md`) end to end once with throwaway funds
