# Remediation status

Updated after commit `4ffecc0` (branch `claude/forgepay-platform-design-gEkgE`). The rest of this package describes commit
`da11f54`; this page says which of its findings have since been changed, and how it was checked. **A fix is not a
review**: each was made and tested by the same party that found it. Reviewers should treat "fixed" as "claimed fixed, please
attack it".

| Id | Finding | Status | What changed | How it was checked |
|---|---|---|---|---|
| F-70 | Concurrent top-up confirms double-credit | Fixed | `billing.ts` re-reads the receipt after the gateway call, with no `await` before the write | New test fails without the fix (3 credits), passes with it (1) |
| F-50 | Any merchant key can create/approve/submit payouts | Fixed | `/payouts/*` is admin-credential only; requester cannot approve own payout | `__tests__/payout-auth.test.ts` (merchant key refused on every route; self-approval refused) |
| F-51 | Idempotency-key squatting | Fixed | Gateway answers 409 when an `external_id` is re-used with a different payee/amount; bureau refuses to settle against a payout whose address/amount differ | gateway test + `furnisher-payouts.test.ts` |
| F-55 | Unset `NODE_ENV` meant development (any key admin, dev encryption key) | Fixed | `isProductionLike()`: only explicit `development`/`test` is non-production; used everywhere the gateway branched on production | `__tests__/env.test.ts`; sweeper test adjusted |
| F-54 | Rate limit keyed on raw `X-Forwarded-For` | Fixed | Key is `req.ip`; proxies trusted only via `TRUST_PROXY_HOPS` (default 0). Gateway and bureau | rate-limit test (320 requests with forged headers hit 429) |
| F-56 | `tx.wait()` unbounded; any post-send error marks a payout failed | Fixed | Bounded wait (`PAYOUT_SIGNER_WAIT_MS`); a sent-but-unconfirmed payout stays `submitted` with its hash for the worker to settle | test: no `failed` update is issued on timeout |
| F-52 | Sweep destination read from the DB row at send time | Fixed for sweeps | Destination checked against configured treasury at send time. **Recovery** rows (operator-named destination) are not covered: a database writer can still change one | unit test |
| F-53 | "Own token" rule bypassed by contract address | Fixed | Address compared with the registry's address for the deposit's own token | unit test |
| F-40 | Console proxy routes call backends with admin credentials, no session | Fixed for the listed routes | `guardRoute()` requires a session, the `credit-bureau` product, and `manage:billing` for writes | **Typechecked only. The console has no test harness, so this has no automated test.** |

## Not fixed (and not claimed fixed)

- **Custody side, all of it:** F-01 (unauthenticated signer API), F-02, F-03 (share destruction by one signed `retire`), F-04,
  F-05, F-06 (policy bypasses), F-07, F-08, F-14, F-15, F-20-F-24 (quorum is an unauthenticated header; API keys without
  quorum; calldata invisible to policy; double-sign on retry), F-35, F-41-F-43 (SSO cross-tenant login, session token emailed,
  weak login controls). These gate the custody launch, not the bureau launch.
- **F-52 for recovery rows**, noted above.
- **Console data is still platform-wide:** the bureau/treasury/ontology views now need a session and the product, but the data
  behind them is not partitioned per tenant. Fine for a single-operator bureau launch; not for multi-tenant.
- Items in `04` section 3 (documentation that contradicts the code), the logged RPC URL, Swagger without auth, Node 18/20 images.

## Added since the review's commit (also unreviewed)

Key-share backup/restore, gateway leader lock, alert routing, live rand feed, asset probes and the balance-at-confirmation check
(commit `db92bfd`), and the fixes above. Reviewers should be told these are new and untested by anyone but their author.
