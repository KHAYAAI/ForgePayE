# Launch runbook — FORGE Credit Bureau

Everything between "the code is written" and "a customer is paying", in order,
written for someone doing this for the first time.

Seven steps. Two of them can genuinely stop you — Step 1 (legal) and Step 3
(testnet), and neither is the one people expect. Mainnet deployment is Step 4
and is among the most mechanical.

Do not skip ahead. Each step assumes the previous one actually worked, and
several of the later ones are irreversible.

---

## Overview

| # | Step | Blocking? | Who |
|---|------|-----------|-----|
| 1 | Decide whether the NCA applies | **Can stop the launch** | Lawyer / NCR |
| 2 | Get every required service running | No, but tedious | You |
| 3 | Rehearse the whole money path on testnet | **Can stop the launch** | You |
| 4 | Mainnet contracts + admin handover | Irreversible | You |
| 5 | Turn on the mainnet signer | Irreversible | You |
| 6 | Record real vendor costs | No | You |
| 7 | First customer | No | Sales |

---

## Step 1 — Does the National Credit Act apply to you?

**Do this before writing another line of code.** If the answer is "yes, you
must register", that is months of lead time, and finding out after launch is
far worse than finding out now.

### Why this is a real question

Your licensing documentation covers four regulators — FSCA, SARB, FIC, POPIA —
plus crypto and tax. It says nothing about the National Credit Regulator. The
only mentions of "credit bureau" anywhere in it are incidental.

### The fact that probably decides it

It is in your own code:

```ts
// services/agent-credit-bureau/src/types.ts
operatorEntityType: 'individual' | 'llc' | 'corp' | 'dao';
operatorLegalName?: string;   // "a person's or a business's"
```

Every agent profile is bound to an operator, and `'individual'` means **a
natural person**. So the bureau can hold credit-performance data attached to a
named human being. "It is only about software agents" is not the whole picture,
and that gap is exactly where a regulator would look.

### What to do

1. **Write one page of plain facts.** What data you hold, about whom, who you
   sell it to, what they do with it. State explicitly that operators may be
   natural persons. Describe the system; do not characterise the law.
2. **Take it to an attorney who does NCA work** — not a general commercial
   lawyer. Ask three specific questions:
   - Does agent repayment history tied to a natural-person operator constitute
     *consumer credit information*?
   - Does selling it to lenders make us a *credit bureau* requiring NCR
     registration?
   - If yes, can we avoid that by restricting operators to juristic persons
     only?
3. **Ask the NCR in writing.** Regulators answer scope questions, and a written
   answer is worth having.
4. **Decide before you have customers.**

### The cheap escape hatch, if you want it

If the answer turns on natural persons, dropping `'individual'` from that union
is a small change — a type, a validation, and a policy that operators must be
registered entities. It is a product decision, but a far cheaper one than
registration, and it is only cheap *before* you have signed anyone.

**Do not proceed past this step until you have an answer.**

---

## Step 2 — Get every required service running

### 2.1 What actually has to run

Not all 26 services. For the bureau to work you need:

| Service | Why | Optional? |
|---|---|---|
| PostgreSQL | Everything persists here | **Required** |
| `agent-credit-bureau` | The product | **Required** |
| `compliance-monitor` | Sanctions screening | **Required in production** |
| `stablecoin-gateway` | Payouts and x402 top-ups | Required to pay furnishers |
| `agent-identity` | DID resolution | Recommended |
| Redis | Caching | Optional |

**`compliance-monitor` is not optional in production.** The sanctions screen
fails closed: without `COMPLIANCE_MONITOR_URL` reachable, every lender report
is declined. The product returns nothing but declines. This is deliberate —
there is no safe "pass anyway" reading of a missing sanctions check — but it
means you cannot launch without it.

### 2.2 Expect boot failures, and treat them as the system working

Thirteen services now set `NODE_ENV=production` in their images. That makes
their fail-closed guards apply, which means **a service will refuse to start if
a required secret is missing**. It will name the variable.

That is not a regression. Before this, those containers started happily with a
webhook secret of the literal string `dev-secret`. Work through the failures
one at a time; each one is a real piece of missing configuration.

### 2.3 Secrets you must set

For the bureau, at minimum:

```bash
NODE_ENV=production
DATABASE_URL=postgres://...            # or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME
BUREAU_ADMIN_API_KEY=<long random>     # not the dev default
CONSENT_SIGNING_SECRET=<long random>
COMPLIANCE_MONITOR_URL=http://compliance-monitor:8000
STABLECOIN_GATEWAY_URL=http://stablecoin-gateway:8020
```

Generate the secrets properly:

```bash
openssl rand -hex 32
```

### 2.4 Prove it

```bash
curl -s https://<your-bureau>/healthz
curl -s https://<your-bureau>/v1/plans          # public, no auth
```

**Expect:** the four plans, priced $0 / $1,000 / $4,000 / $12,000.

---

## Step 3 — Rehearse the entire money path on testnet

**This is the step people skip and should not.**

Three things in this system have never executed once: the signer has never sent
a transaction, the bureau-to-gateway settlement path has never run end to end,
and no report has ever been pulled outside a test.

Full instructions: **[`TESTNET_DRESS_REHEARSAL.md`](./TESTNET_DRESS_REHEARSAL.md)**

In summary you will: start Postgres → create a throwaway wallet → fund it from
faucets → deploy contracts to Base Sepolia → pull a real report → **send an
actual USDC payment** → prove a repeat settlement pays nothing → restart and
confirm the ledger survives.

### The single most important check

Run the settlement twice. **No second transaction may appear on the block
explorer.** The idempotency key is per furnisher per period and enforced by a
unique database index, not by application code remembering to look.

If a second transfer does appear: **stop, do not go near mainnet, and report
it.** Everything else in this runbook is recoverable. Paying a furnisher twice
from a hot wallet is not.

**Do not proceed to Step 4 until every box in that runbook is ticked.**

---

## Step 4 — Mainnet contracts and the admin handover

Irreversible from here. Read each sub-step fully before running it.

### 4.1 Create the multisig first

Before deploying anything, create a **Safe** (safe.global) on Base mainnet with
at least 2-of-3 signers on separate devices held by separate people.

A 1-of-1 "multisig" is an EOA with extra steps and defeats the entire point of
Step 4.3.

### 4.2 Deploy the contracts

```bash
cd forgepay/on-chain
forge build

export BASE_MAINNET_RPC_URL=https://mainnet.base.org
export SETTLEMENT_PRIVATE_KEY=<mainnet deployer key>

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $BASE_MAINNET_RPC_URL --broadcast --verify
```

Record all five addresses.

### 4.3 Hand admin to the multisig — in two phases

Right now a single private key on one machine can pause, re-role or reconfigure
every contract. That is fine on testnet and not fine once anything has value.

**Phase 1 — grant admin to the multisig, keeping the deployer's:**

```bash
export ADMIN_MULTISIG_ADDRESS=<your Safe>
export FORGE_REGISTRY_ADDRESS=... FORGE_VALIDATOR_ADDRESS=... \
       FORGE_ENFORCER_ADDRESS=... FORGE_CORE_ADDRESS=... \
       FORGE_CROSSCHAIN_ADDRESS=...

forge script script/TransferAdmin.s.sol:TransferAdmin \
  --rpc-url $BASE_MAINNET_RPC_URL --broadcast
```

**Verify:**

```bash
export DEPLOYER_ADDRESS=<the EOA that deployed>
EXPECT_PHASE=1 forge script script/VerifyAdmin.s.sol:VerifyAdmin \
  --rpc-url $BASE_MAINNET_RPC_URL
```

**Expect:** `STATE: Phase 1 complete. Multisig administers all 5.`

**Now prove the Safe can actually sign.** From the Safe UI, grant a role on one
contract and then revoke it. Do not skip this and do not take it on faith.

> If the Safe cannot sign and you run Phase 2 anyway, `DEFAULT_ADMIN_ROLE` ends
> up with **no holder and no recovery path**. The contracts can never be
> re-roled, reconfigured or paused by anyone, ever. Not a bug to fix later — an
> unrecoverable loss of control.

**Phase 2 — renounce the deployer's admin:**

```bash
RENOUNCE_DEPLOYER=true forge script script/TransferAdmin.s.sol:TransferAdmin \
  --rpc-url $BASE_MAINNET_RPC_URL --broadcast
```

**Verify:**

```bash
EXPECT_PHASE=2 forge script script/VerifyAdmin.s.sol:VerifyAdmin \
  --rpc-url $BASE_MAINNET_RPC_URL
```

**Expect:** `STATE: Phase 2 complete. The multisig is the sole administrator.`

### 4.4 Point the bureau at mainnet

```bash
CHAIN_RPC_URL=https://mainnet.base.org
CHAIN_ID=8453                          # explicitly — see below
FORGE_REGISTRY_ADDRESS=...             # the five mainnet addresses
```

**`CHAIN_ID` defaults to 84532 (Base Sepolia).** A rollout that sets the RPC and
addresses but forgets `CHAIN_ID` keeps settling Mode 2 scores to a testnet and
keeps reporting them as settled, with a transaction hash a lender cannot tell
apart from a mainnet one. The service now refuses to start in production
without it — that refusal is protecting you.

---

## Step 5 — Turn on the mainnet signer

### 5.1 Create the hot wallet properly

A **new** wallet, used for nothing else. The key goes into a secret manager and
is mounted as a file — never `.env`, never your shell history.

```bash
PAYOUT_SIGNER_ENABLED=true
PAYOUT_SIGNER_CHAIN=base
PAYOUT_SIGNER_RPC_URL=https://mainnet.base.org
PAYOUT_SIGNER_KEY_FILE=/var/run/secrets/payout-signer-key
PAYOUT_SIGNER_DAILY_MAX_USD=100        # start small
```

`PAYOUT_SIGNER_ENABLED` must be exactly `true`. `1`, `yes` and `TRUE` all mean
**off**, deliberately.

### 5.2 Fund it with the minimum

Enough USDC for roughly one settlement period, plus a little ETH for gas. A hot
wallet is bounded by its balance as much as by its limits — do not park a
treasury in it.

### 5.3 Raise the cap slowly

Keep `PAYOUT_SIGNER_DAILY_MAX_USD` at $100 through the first real settlement.
Raise it only after you have watched a period settle correctly. That cap is
what bounds a bug that loops, which per-payout limits cannot.

---

## Step 6 — Record what a pull actually costs

Until you do this, you do not know whether the $2.00 volume band makes money —
and that is the band your largest customers land in.

### 6.1 Collect the first invoices

You need three numbers, and they only exist on real bills:

- what your sanctions vendor charges per screening call
- what your RPC provider charges per read
- your fully-loaded compute cost per hour

### 6.2 Record them

```bash
curl -s -X PUT https://<bureau>/v1/admin/pull-costs/unit-prices \
  -H "X-API-Key: $BUREAU_ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"sanctions_screen_usd":0.35,"chain_read_usd":0.0001,"compute_hour_usd":0.12}'
```

### 6.3 Read the answer

```bash
curl -s https://<bureau>/v1/admin/pull-costs -H "X-API-Key: $BUREAU_ADMIN_API_KEY"
```

**Expect:** a `bands` array with `marginPerPullUsd` and `profitable` per band.

Until all three prices are set, cost is reported as absent rather than
estimated. That is deliberate: a fabricated cost per pull is worse than none,
because it would be used to sign a pricing decision.

If the $2.00 band comes back `profitable: false`, you have found something
important before a customer did. Change the band, not the measurement.

> These are held in memory. Re-apply after a restart, or set the matching
> `COST_*` environment variables so they survive one.

---

## Step 7 — First customer

### 7.1 Register them

```bash
curl -s -X POST https://<bureau>/v1/contributors \
  -H "X-API-Key: $BUREAU_ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"name":"Acme Lending","type":"cefi_lender","permissions":["pull_scores"]}'
```

**The API key is returned exactly once and never stored in recoverable form.**
Only its SHA-256 hash is kept. Give it to the customer over something secure
and do not lose it — a lost key means issuing a new one.

### 7.2 Put them on a plan

```bash
curl -s -X PUT https://<bureau>/v1/subscriptions/acme_lending \
  -H "X-API-Key: $BUREAU_ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"planId":"institutional"}'
```

Admin-only: plan assignment follows a signed commercial agreement, and is not
something a customer does to itself.

> A requestor with **no** subscription is not blocked — they are billed
> pay-as-you-go at the $2.80 list price against their prepaid balance. Only the
> `observer` plan forbids hard pulls outright. These are different things and
> the difference is billable.

### 7.3 Fund their account

Either they top up via x402, or you credit them for an invoice:

```bash
curl -s -X POST https://<bureau>/v1/billing/acme_lending/credit \
  -H "X-API-Key: $BUREAU_ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"amountUsd": 4000}'
```

### 7.4 Watch the first real pull

Check that it was charged, that an inquiry was recorded, and that a furnisher
was credited:

```bash
curl -s "https://<bureau>/v1/settlements/preview?period=$(date -u +%Y-%m)" \
  -H "X-API-Key: $BUREAU_ADMIN_API_KEY"
```

---

## The one thing to remember

Steps 1 and 3 are where launches actually die — a regulatory question nobody
asked, and a money path nobody watched work end to end. Steps 4 and 5 are
irreversible but well-defined. Step 6 tells you whether the business works.

Mainnet deployment is Step 4 of 7, and it is among the easiest.
