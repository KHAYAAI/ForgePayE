# First launch: the credit bureau alone?

**Recommendation: yes — launch the agent credit bureau first, on a deliberately narrow money path,
and hold the multi-tenant custody product and the merchant payment gateway back.** This is an
engineering and risk view. Every legal statement below is a question for counsel, not a conclusion;
I am not a lawyer and regulation here changes.

## Why the bureau is the right first product

| | Bureau alone | Custody / merchant gateway |
|---|---|---|
| Whose money moves | The company's own: it **receives payment for its own service** and **pays its own data furnishers** | Customers' funds, held and moved on their instructions |
| Key that matters | One hot wallet for payouts, plus deposit addresses | Customers' threshold keys (MPC nodes, seal keys, backups, resharing) |
| Failure mode | Lose a bounded float; refund/chase a payout | Lose other people's money; an incident is a regulatory event |
| Code that must be right | Gateway: deposits, settlement, payout signer, treasury caps | All of that, plus the threshold stack and its operations |
| Independent review needed | Gateway + signer + treasury + bureau billing | The above **and** the MPC signer, custody governance, DR |

The bureau's receive-then-pay shape is commerce, not custody: customers pay *for reports*, furnishers
are paid *their share*. The threshold-custody work (and the key-share backup built alongside this memo)
is **not on the bureau's critical path** — the bureau's payout key is a single hot wallet held by the
operator (`payout-signer.ts`), not an MPC key. Launching the bureau first means the largest and
least-proven body of work, custody, is not exposed to real money yet.

## Things that could make "no payments licence" false — ask counsel

1. **Do furnishers hold balances with us?** Accrued amounts owed, paid out later, can start to look
   like holding value for others. Keep payouts frequent, from the company's own funds, with no
   "wallet" a furnisher can leave money in.
2. **Is anyone other than the company paying through the gateway on behalf of someone else?** Merchant
   acceptance and payouts to third parties are the activity regimes target. Keep the first launch to the
   company's own receipts.
3. **Crypto-asset rules.** South Africa treats crypto assets as financial products and licenses
   providers of services in them (FSCA); the FIC's accountable-institution/travel-rule regime may
   apply to what we do with stablecoins; exchange-control rules apply to rand-denominated flows and
   cross-border payments. Whether *receiving stablecoins for services and paying suppliers in them* is
   in scope is exactly the question to put in writing.
4. **The word "credit bureau".** In South Africa credit bureaus are registered under the National
   Credit Act and process consumer credit information. A bureau that scores **software agents** may
   be outside that, but if any record touches a natural person (an agent's owner, a director, a
   dispute filed by a person) personal-information law applies, and the name itself may attract
   questions. Counsel should rule on the product's scope and on what it may be called.
5. **Customers abroad.** Sanctions screening exists in the bureau; the rest (tax, VAT on crypto
   receipts, licensing elsewhere) depends on where customers are.

None of these is a reason not to launch the bureau; each is a reason to get written advice first.

## What must be true before the bureau takes real money

Engineering (status as of this commit):

| Item | Status |
|---|---|
| Gateway deposits, settlement, payouts, sweeper, treasury, alerts, leader lock | Built, unit/e2e tested against a local chain and real Postgres |
| ZARP/OUSD addresses and behaviour on Base | **Unverified.** `docs/ASSET_FIRST_CONTACT.md` is the procedure. OUSD rebasing status unknown |
| Live USD/ZAR feed | Built; sources not called from here. Start with the operator-set rate and the feed in `check` mode |
| Payout key in KMS/Vault, not a file | Supported; **never run against real AWS KMS** (the sandbox cannot authenticate) |
| Production infra (Helm/Terraform/CI) | Written; **not applied to any account**. A first real deploy will find problems |
| Alert destinations configured and tested (`POST /alerts/test`) | To do |
| Load/soak, chaos | Not done |
| **Independent security review of the gateway, signer, treasury, bureau billing** | **Not started. Hard gate.** Package in `docs/security-review/` |
| Counsel's written view (list above) | Not started. Hard gate |
| Operational: on-call, runbooks exercised, incident contact, key-holder procedures | Not started |

## Defects the review-package author found (not yet fixed) that block a bureau launch

The package in `docs/security-review/` (see `04-known-limitations.md`) was written by reading the code at commit `da11f54`, and
reproduced four defects with throw-away tests. These are **open** and sit directly on the bureau's money path; none should ship:

| Id | Problem | Where |
|---|---|---|
| F-70 | Three concurrent confirms of a $10 top-up credited $30 (reproduced) | bureau `billing.ts` |
| F-50 | `/payouts` has no admin/ownership check: any merchant key can create, approve and submit payouts | gateway `routes/payouts.ts` |
| F-51 | A merchant key can pre-create the bureau's payout idempotency key with its own address; the bureau accepts it | bureau `furnisher-payouts.ts` |
| F-55 | `NODE_ENV` defaults to development: unset, any API key is admin and a fixed dev encryption key is used | gateway `config.ts` |
| F-52/F-53 | Sweep destination read from the DB row at send time; recovery rule bypassed by passing a contract address | gateway `sweeper.ts` |
| F-54 | Rate limit keyed on a spoofable `X-Forwarded-For` | gateway, bureau |
| F-40 | Console routes call the bureau/treasury with admin credentials and no session check | console |
| F-56 | `tx.wait()` has no timeout: one stuck transaction stalls all payouts | payout signer |

Others (F-01..F-08, F-20..F-24: unauthenticated signer API, share destruction, policy bypasses, quorum not cryptographic) are
custody-side and gate the **custody** launch, not the bureau. Some of these overlap items built in this change; the package was written
before it and says so. I have not triaged or fixed any of them here.

## A conservative first-launch configuration

- `PAYOUT_AUTO_SUBMIT=false`: a person submits each payout until the dust tests and the review are done.
- Low payout ceiling and daily cap; treasury caps that keep the hot wallet small; cold-storage sweep on.
- One asset first (USDC, the best-understood), then ZARP, then OUSD — each after its own first-contact run.
- Operator-set rand rate with the feed observing, not writing, until it has agreed with the manual rate for weeks.
- No third-party merchants, no customer custody workspaces, no `custody` product enabled in the console.
- Alerts routed to a human who is actually awake; test them weekly.

## Commissioning the independent review

I can prepare the package (scope, threat model, the invariants the code claims, a build/test
guide); I cannot hire the firm. What the user needs to do:

1. Choose scope A (gateway + signer + treasury + bureau billing — the bureau launch) and, separately and
   later, scope B (threshold signer, custody governance, DR — the custody launch).
2. Ask 3 firms with smart-contract/wallet *and* applied-cryptography experience for quotes; ask each for
   named reviewers, past reports and a retest window.
3. Freeze a commit, give them the package, agree that findings are fixed and re-reviewed before launch.
4. Budget weeks, not days, and expect findings. The review is a gate, not a stamp.

## Decision requested

Approve bureau-first with the configuration above; engage counsel on the five questions; engage a
review firm for scope A. Custody and the merchant gateway stay off until scope B is reviewed and the
restore drill has been run with real officers.
