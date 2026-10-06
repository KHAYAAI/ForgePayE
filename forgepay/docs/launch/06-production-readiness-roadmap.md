# Production readiness: what each product needs

**Written 6 October 2026.** For each product that is not launched: where it stands, what "production ready" has to mean for it,
the engineering that gets it there, and what only the owner, a regulator or an outside firm can do. Nothing here is done unless it
says so. Test counts and states come from `LAUNCH_READINESS_2026-10-05.md` and the 3 October audit, and have not all been re-run.

Order of work, and why: **bureau first** (its own file is `00-LAUNCH-STEPS.md`; the beginner's version is `07`), then **console**
(it fronts everything), then **custody** (the money safety layer the others lean on), then **wallet**, then the **money-moving
products** (payments, treasury, agent stack), which also need licences.

## How to read "production ready"

A product is production ready only when all five are true. Passing tests is one of them, not the whole thing.

1. **Runs for real:** deployed on real infrastructure, with real secrets, and exercised end to end (not against fakes).
2. **Money matches:** every balance the product holds or moves reconciles against the chain or the bank, daily, by a named person.
3. **Reviewed:** an independent security review of the money paths, findings fixed and re-checked.
4. **Allowed:** counsel's written view, and any licence or registration it requires, is in hand.
5. **Operated:** someone is on call, alerts have reached a human this week, the runbook has been rehearsed, rollback is understood.

## Console (frontend for everything launched)

**Today:** builds on Next 15, 15 tests pass, wired to the bureau and checked in production mode: each workspace sees only its own
agents, another workspace's agent returns "not found", an unlaunched product returns 403. API keys are hashed. The fixed image has
not run in CI yet.

| Engineering (I can build) | Needs the owner |
|---|---|
| Confirm the image passes CI; fix whatever it reports | Production secrets (`JWT_SECRET`, `INTERNAL_WEBHOOK_SECRET`, bureau admin key) in Secrets Manager |
| Per-workspace partitioning of treasury and ontology views (bureau is done; these are platform-wide per the audit) | Operator workspace id (`FORGE_OPERATOR_TENANT_ID`) |
| Email verification at signup; shared (Redis) request throttling instead of per-process | SMTP provider and the `myforgepay.com` mailboxes |
| Operator screens: record an executed bank settlement, goAML draft export, yield, credit lines, billing | WorkOS account if single sign-on is wanted |
| Upgrade Next to 16 to clear two HIGH findings in the bundled postcss | |

**Production ready when:** CI green on the image, every page a customer can reach is backed by a launched product, a new workspace can
sign up, verify email and enable only launched products, and an independent review has covered the auth and tenant boundaries.

## Custody (threshold signing: no single machine holds a whole key)

**Today (audit):** deep and tested. Signer, nodes, resharing, backup and restore drill, per-signer signed approvals, signer mutual TLS
enforced, officer ceremony tooling, node policy files. The signer's full Go suite passes (the long package takes about 15 minutes).
It has only ever run on one host.

| Engineering (I can build) | Needs the owner or others |
|---|---|
| Soak, chaos and load tests of signing across hosts (the local ones exist) | **Separate hosts and cloud accounts** for the nodes (Terraform modules exist: `mpc-backup-bucket`, `vault`, `kms-keys`); the topology check must pass (`docs/custody-separate-hosts.md`) |
| Fix whatever the first multi-host run exposes | **A real key ceremony** with real officers and hardware (`docs/custody-officer-ceremony.md`) |
| Deployment values for production (`infra/helm/mpc-node`, the Terraform example) and a rehearsed rollback | **Scope B independent review** (threshold signer, governance, disaster recovery); package is in `docs/security-review/` |
| Make console custody pages show only what is connected | Named officers, a quorum policy, a recovery-day drill done by them |
| | Counsel: is holding keys for others a regulated activity for you |

**Production ready when:** nodes run in different accounts and the topology check passes, officers have restored a backup from the real
backup store, scope B findings are fixed and re-checked, and a pilot with named design partners has run without unexplained differences.

## Wallet (per-user wallets, `open-privy`)

**Today:** testnet only (a chain allowlist enforces it). Each wallet's key is now wrapped by its own data key, itself wrapped by KMS;
41 backend tests pass. The in-repo workspace root does not typecheck (the mobile app), and the old key scheme still exists for legacy wallets.

| Engineering (I can build) | Needs the owner or others |
|---|---|
| A migration that sweeps every legacy wallet into the new scheme, with a dry-run mode, verification and rollback | **Create the KMS key** (`kms-keys` module) in AWS and run the key-custody check against it |
| A mainnet chain policy with per-wallet and per-day limits, off by default, behind a flag the owner turns on | **Decision: custodial or not.** If FORGE can move a user's funds it is custody for licensing; counsel decides |
| Recovery flow tests end to end (recovery rows are sealed already) | Independent review of the key scheme |
| Fix the workspace typecheck so CI can guard it | Supabase/WorkOS decisions for the wallet's own sign-in (the console currently provisions users directly) |

**Production ready when:** no wallet uses the old scheme, a restore of a wallet from recovery works for a real test user on testnet and
then for a staff wallet on mainnet with a tiny balance, review findings are closed, and counsel has cleared the custody question.

## Payments (checkout, tax, subscriptions, settlement)

**Today:** the path works end to end in code: checkout through `unified-router` to Hyperswitch, webhook contract (HMAC-SHA512,
snake_case events), Kill Bill subscriptions with a plugin, merchant-of-record and tax in `mor-layer`. Never run against a real acquirer.
Checkout is closed by default on the website.

| Engineering (I can build) | Needs the owner or others |
|---|---|
| A settlement payout ledger: what each merchant is owed, instruction files for the bank, reconciliation against bank statements | **A licence or a partner who has one** (payment facilitator or merchant-of-record model), per counsel |
| End-to-end tests against Hyperswitch's sandbox connector | **An acquirer / PSP agreement** and its test credentials |
| Chargeback and dispute handling screens | **A real deployment** of the Rust payment engine (root of the repo), Postgres, Redis, Kill Bill, with the PCI vault on (never disabled) |
| Fix the JS SDK (missing wasm package, missing build configs) and the `mor-layer` type check in CI | PCI scope assessment and a bank account for settlement |
| Tax rules reviewed per country supported | Insurance, terms, a merchant onboarding process (KYB) |

**Production ready when:** a test merchant takes a real card payment through a live acquirer, is paid out to a real bank account, and
every rand reconciles; webhooks verify HMAC before any processing; the licence position is written down.

## Treasury, yield and tokenised assets

**Today:** the fake data paths are gone. `enterprise-treasury` shows real cash position, netting and approvals, persisted. What does
not exist is execution: moving money to settle, withdrawing from yield positions, buying or redeeming tokenised assets.

| Engineering (I can build) | Needs the owner or others |
|---|---|
| **Settlement execution:** bank instructions through `bank-connectivity`, an operator screen to record each executed settlement, reconciliation | A bank partner with an API, and its onboarding |
| **Yield withdrawal:** integrate one protocol first, signing through custody with limits and human approval; reconcile positions against the chain | **Decision: which protocol, which chain, which limits.** Counsel: is offering yield a regulated activity |
| **Tokenised assets:** subscribe and redeem flows against one issuer, reconcile the registry (`rwa-registry`, `chain-sync`) against balances | An account with the issuer (for example Ondo) including its KYB, and counsel on securities rules |
| All three behind a switch that stays off until the owner turns it on | Treasury policy: who may approve, thresholds, dual control |

**Production ready when:** one settlement, one yield withdrawal and one asset redemption have each been executed with small real
amounts, approved by two people, and reconciled to the chain or the bank statement.

## Agent stack (identity, negotiation and escrow, credit lines, liquidity)

**Today:** escrow in `agent-negotiation` is durable; real prices feed the liquidity manager. Credit lines and liquidity moves are
bookkeeping: no money moves. The screens say so.

| Engineering (I can build) | Needs the owner or others |
|---|---|
| **Credit line funding:** who supplies the money (your balance sheet, a partner lender, a DeFi pool) decides the design; then draws and repayments move USDC through `stablecoin-gateway`, every draw human-approved, repayments detected as deposits | **Decision: who lends.** Counsel: does lending to agents make you a credit provider; terms for borrowers |
| Feed repayments to the bureau automatically so they build the agent's history | A lender or pool to supply capital |
| **Liquidity moves** through custody's policy engine instead of bookkeeping | |
| **Escrow:** a real contract or custodial ledger with reconciliation, dispute resolution tied to the bureau | Review of any contract before it holds funds |

**Production ready when:** a small credit line is drawn and repaid with real USDC, the bureau's file for that agent updates from it,
and balances reconcile.

## Dependencies between products

```
bureau ──> console ──────────────┐
custody ──> wallet ──────────────┤
custody ──> treasury (yield, assets, settlement signing)
bureau + custody + stablecoin-gateway ──> agent credit lines
Hyperswitch + Kill Bill + bank partner ──> payments ──> treasury settlement
```

Custody is the common dependency: do not start money movement on treasury, yield or credit lines until its signing path has run
across separate hosts.

## Decisions I need from you

1. Custodial or non-custodial wallets.
2. Who funds agent credit lines.
3. Which yield protocol and tokenised-asset issuer, if either, comes first.
4. Which payment model (own licence, or a partner's) and which acquirer.
5. Which bank partner for settlement.
6. Which independent review firm, and who the custody officers are.
7. Which AWS region and account structure (see `07`).

## What I can start without those decisions

The console items, wallet migration tooling, the settlement ledger and its reconciliation, SDK and CI fixes, soak tests for custody,
operator screens, and the repayment-to-bureau feed. Each is code and tests; none of them moves money until you switch it on.
