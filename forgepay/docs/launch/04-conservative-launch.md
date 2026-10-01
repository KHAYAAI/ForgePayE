# Conservative first launch: the controls, and why

These are the settings in `infra/helm/stablecoin-gateway/ci/launch-values.yaml`. They are chosen so the worst plausible mistake
or bug costs a bounded, small amount, and so a human sits in the loop on every outflow. Numbers are starting points to agree with
whoever owns the risk.

| Control | Setting | What it bounds |
|---|---|---|
| Who approves payouts | `PAYOUT_AUTO_APPROVE_MAX_USD=0`, `PAYOUT_AUTO_SUBMIT=false` | Nothing leaves without a person approving (not the requester) and submitting |
| Per-payout ceiling | `PAYOUT_ABSOLUTE_MAX_USD=250` | A single mistake or malicious instruction |
| Wallet cap | `PAYOUT_SIGNER_DAILY_MAX_USD=500` rolling 24h | A bug that submits many "correct" payouts |
| Float | `TREASURY_WARM_MAX_USD=1000`, replenish target 300, daily replenish cap 500 | What a hot-wallet key compromise can lose; the rest goes to cold storage |
| Sweep | min $5, gas ceiling 5 gwei | Spending more on gas than a sweep is worth |
| Assets | `ASSETS_ENABLED=USDC` first | Exposure to an unverified token |
| Rand rate | operator-set, 24h max age, feed OFF | A bad feed pricing ZARP wrongly |
| Replicas | 1 | No concurrency surprises while the leader-lock image is new |
| Rate limit | `TRUST_PROXY_HOPS` set to the real proxy count | Evasion of the limit |
| Scope | no merchants (`MERCHANT_API_KEYS` empty), custody product off in the console | Third-party funds and the unreviewed custody stack |

## Operating rules for the first weeks

- Reconcile the treasury, payout wallet and ledger to the unit every day; investigate any difference the same day.
- Review every alert, including warnings. Test `POST /alerts/test` weekly and after any change to alert credentials.
- Run the feed in check mode and compare with the manual rate weekly; do not turn it on until it has agreed for several weeks.
- Raise a limit only with a written reason and a second person's agreement, one control at a time.
- Rollback: disable the payout signer (`payout.signerEnabled=false`) and sweeps first; deposits can keep being received.

## What this does not make safe

The unfixed items in `docs/security-review/10-remediation-status.md`, the unreviewed code, the unverified tokens and the
unanswered legal questions. The controls limit the damage; they do not remove the need for the review and counsel.
