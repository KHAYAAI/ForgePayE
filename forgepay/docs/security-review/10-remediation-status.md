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

## Custody-side findings (second round)

Same caveat: fixed and tested by their author, not independently verified.

| Id | Finding | Status | What changed | How it was checked |
|---|---|---|---|---|
| F-01 | Signer coordinator API unauthenticated | Fixed (floor) | Every route but `/health` needs `MPC_SIGNER_AUTH_TOKEN` (>= 32 chars); production refuses to start without it. Gateway and temporal-worker send it to the signer URL only | Go test (all routes 401 without/with a wrong credential), jest test that the token never goes to another host. **Mutual TLS between gateway and signer is still not built; the token travels in cleartext unless the network is trusted** |
| F-02 | Shared legacy key always loaded | Fixed | With `MPC_REQUIRED=true` the legacy key is never read, created or used; production requires `MPC_REQUIRED=true`; `/address` answers 404 | Built and vetted; **no dedicated test** (main package start-up is not unit tested) |
| F-03 | One signed `retire(leaving)` destroys a share | Fixed | A leaving node destroys its share only if it recorded having contributed to the reshare that produced that epoch | Real-node integration test (`TestLeavingRetireNeedsProofAndHalfCommitsAreResumed`) |
| F-04 | Re-using a session id refunded the daily budget | Fixed | A session id can be reserved once, ever; replay is refused | unit test |
| F-05 | Negative value accepted, refunds budget | Fixed | Rejected in the parser and in the policy | unit test (parser); policy guard present |
| F-06 | ERC-20 amounts invisible to node limits | Fixed (opt-in) | New node policy `maxTokenUnits`, `dailyTokenUnits`, `requireTokenCaps` per token contract. **Default is unchanged: a node with no token caps still does not limit token amounts** | unit test |
| F-07 | Half-committed reshare has no recovery | Fixed | `ResumeCommit` (also run at the start of every reshare) finishes the commit after a fresh probe verifies | Real-node integration test using a simulated lost commit |
| F-08 | A lying node can block key lookup | **Accepted** | If only one honest node and one liar answer, no quorum can be established, by design. A liar cannot make a wrong answer *win* | none |
| F-14 | Production does not require a node policy | Fixed | A production node refuses to start with no rule at all | built; no dedicated test (production start-up also needs TLS and a valid cluster) |
| F-15 | Example KMS policy would not allow the node | Fixed | Added `deploy/aws/kms-policy-mpc-node.example.json` | JSON validated; **never run against real KMS** |
| F-20 | Actor is an unauthenticated header | Partly fixed | The console signs each custody request (actor, method, path, body hash, timestamp, one-time nonce) with `CUSTODY_ACTOR_SECRET`; the gateway verifies. A leaked admin key alone can no longer cast a vote. **Whoever holds the admin key AND the actor secret, or controls the console, can still vote as anyone.** Per-signer cryptographic proof (WebAuthn / per-signer keys) is not built. Replay cache is per process | jest + cross-check that the console and gateway formats agree |
| F-21 | API keys issued without quorum; sign below 10 ETH unapproved | Fixed | Only an active signer can issue/revoke a key; API-key-initiated transfers auto-sign only up to a workspace ceiling (`policies.apiKeyAutoSignMaxWei`), **default zero in production** | jest |
| F-22 | Policy blind to calldata | Fixed | The recipient in a standard token call goes through the policy too; any call with data needs a human quorum | jest |
| F-23 | Double-sign on retry | Fixed | `executeSigning` returns the stored signature for a request id instead of signing again | jest |
| F-24 | Votes not bound to the payload | Fixed | Proposal payloads are sealed with an HMAC (`CUSTODY_PROPOSAL_SECRET`) and verified before execution; production refuses to run without it | jest. Existing unsealed proposals are refused once a secret is set |
| F-35 | Public demo credential seeded | Fixed | Moved to `init-dev-seed.sql` (compose only); production boot refuses if the database holds that credential | jest |
| F-41 | SSO login as a user of another tenant | Fixed | Refused when the email belongs to a different tenant | vitest |
| F-42 | Session token emailed | Fixed by removal | The verification email is no longer sent (it carried the session JWT and linked to a page that does not exist). **There is no email verification now** | read |
| F-43 | Weak login controls | Partly fixed | Login and MFA attempts are throttled (per process); TOTP seeds are encrypted at rest; the API key is no longer returned at login. **Per-user API keys are still stored in plaintext; throttling is not shared across replicas** | vitest |

## Third round (hardening of the partial fixes, and one finding from reconciliation)

| Item | Status | What changed | How it was checked |
|---|---|---|---|
| Signer API had a token only | Improved | Optional mutual TLS on the signer's own API (`MPC_SIGNER_TLS_*`): only a certificate named `gateway` from the operators' CA may connect; the gateway presents it (`MPC_SIGNER_CLIENT_*`). **Optional, not enforced in production, and not wired into the Helm chart** | Go test with a real CA: gateway cert accepted, a signing node's cert (valid CA, wrong name) refused, no cert fails the handshake. The gateway side is typechecked only |
| Sweep recovery destination editable in the database | Fixed | Recovery rows carry an HMAC over id, deposit, asset, source and destination, keyed from the gateway wallet key (not in the database); a mismatch fails the row | unit test. Rows planned before this change have no seal and fail closed |
| Per-user API keys in plaintext | Fixed | Stored as `sha256:<hex>`; shown once; legacy plaintext keys upgraded on first use and by a schema statement | vitest |
| Sweep crash recovery trusted any mined transaction | **New finding, fixed** | Found by the new reconciliation run against real data: a `sending` sweep was closed as done on any successful receipt. It now requires a transfer of its own units to its own destination | real-chain e2e: a foreign transaction no longer closes a sweep |
| Throttling per process | Fixed (needs Redis) | Console login/MFA limiter and the gateway's rate limit use a shared Redis when `REDIS_URL` is set; they fall back to per-process counters (with a log line) if Redis is absent or down. The gateway's limiter fails open when Redis is down | Tests against a real Redis with several simulated replicas (counted exactly under concurrency), and the fallback |
| Per-signer cryptographic approval | Built (CLI; no WebAuthn) | Each signer holds an Ed25519 key; a vote counts only with their signature over the exact proposal, checked on arrival and again when the quorum is counted; enrolment needs proof of possession; key replacement needs a quorum; on by default in production | unit tests; integration test on a real Postgres with the real schema (forged rows, wrong keys, cross-decision signatures, edited payloads all fail) |
| Signer mTLS optional / not in the chart | Fixed | Production refuses to start the signer, the gateway or the temporal-worker without it; the chart wires cert-manager or existing Secrets for both certificates; probes switched to TCP | Go tests (real CA), jest, `helm lint` and a render check of all four deployments. **Never run on a cluster** |
| Nodes on separate hosts | Tooling built, deployment not done | Nodes report where they run; `mpc-node topology` / `GET /mpc/topology` fail on a shared host, seal key or infrastructure, a domain mismatch, a quorum in one domain, file/env seal keys; the node chart requires `node.infraId` in production and injects the Kubernetes node name | unit tests, and a test that three real nodes in one process are reported as sharing a host. **No real multi-host deployment exists; a node can misreport itself** |
| Restore drill with real officers | Tooling built, ceremony not done | Passphrase-protected shares, per-officer share check, a drill that writes a sealed audit record, a written ceremony | tests of the whole flow with protected shares. **No real officer has done it** |

## Not fixed (and not claimed fixed)

- A browser/hardware-token (WebAuthn) signing flow; F-08 (accepted).
- Console data is platform-wide, not partitioned per tenant (fine for one operator; not for multi-tenant).
- Items in `04` section 3 (documentation that contradicts the code), the logged RPC URL, Swagger without auth.
- Base images for the bureau, gateway and console were moved from Node 18/20 to 22 (both older lines are past end of life); **the images themselves have not been built** (no Docker daemon was available), so this is untested beyond the code building under Node 22 locally.

## Added since the review's commit (also unreviewed)

Key-share backup/restore, gateway leader lock, alert routing, live rand feed, asset probes and the balance-at-confirmation check
(commit `db92bfd`), and the fixes above. Reviewers should be told these are new and untested by anyone but their author.
