# Testnet dress rehearsal

The point of this runbook is to make every part of the money path happen once,
on a network where a mistake costs nothing, before any of it happens on mainnet.

Right now three things in this system have **never executed even once**:

- the signer has never sent a transaction — its tests all cover refusals;
- the settlement path has never run end to end (the bureau half and the
  gateway half were built and tested separately);
- no report has ever been pulled by anyone who wasn't a test.

None of those are bugs. They are simply untested in the only sense that
matters, and testnet is where you find out.

Work through this in order. Each step says what "it worked" looks like, so you
are never guessing.

---

## Before you start

You need:

- Docker (for Postgres), Node 20+, and Foundry (`forge`)
- A throwaway wallet — a **brand new** one, created for this and nothing else
- Testnet ETH and testnet USDC on Base Sepolia (both free, see Step 2)

One rule that matters more than any step below:

> **Never put a private key that holds real money into a terminal, a `.env`
> file you might commit, or a chat window.** The wallet you create in Step 2 is
> disposable. The mainnet one, later, is not, and it should live in a secret
> manager — never in your shell history.

---

## Step 1 — Get the services running locally

### 1.1 Start Postgres

```bash
docker run --name forgepay-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=forgepay -p 5432:5432 -d postgres:16-alpine
```

Check it came up:

```bash
docker exec forgepay-pg pg_isready -U postgres
```

**Expect:** `accepting connections`.

### 1.2 Start the credit bureau

```bash
cd forgepay/services/agent-credit-bureau
cp .env.example .env
npm install
npm run dev
```

**Expect** in the log:

```
[credit-bureau] seeded fresh database with 5 agent profiles
```

That line means migrations ran and the demo agents exist. If you instead see
`hydrated 5 profiles`, the database already had data — also fine.

**If it refuses to start** complaining about a missing variable, that is the
fail-closed behaviour working. Read which variable it names and set it in
`.env`. It will not start half-configured, on purpose.

### 1.3 Prove it answers

```bash
curl -s localhost:3018/v1/agents/agent_prime_001/score \
  -H "X-API-Key: dev-bureau-admin-key" | head -20
```

**Expect:** JSON with a `score` between 0 and 1000, a `tier`, and a `factors`
array. If you get `401`, the API key is wrong. If you get connection refused,
the service isn't running.

---

## Step 2 — Create the testnet wallet and fund it

### 2.1 Create a fresh wallet

```bash
cast wallet new
```

**Expect:** an address (`0x…`) and a private key. Save both somewhere private.
This wallet is disposable — it will only ever hold testnet funds.

### 2.2 Get testnet ETH (for gas)

Go to a Base Sepolia faucet (Coinbase and Alchemy both run one) and request
ETH for your new address. Then check:

```bash
cast balance <YOUR_ADDRESS> --rpc-url https://sepolia.base.org
```

**Expect:** a non-zero number. It is in wei, so expect something long like
`50000000000000000`.

### 2.3 Get testnet USDC (the thing you'll actually pay out)

Circle runs a faucet for testnet USDC on Base Sepolia. Request some to the same
address, then check:

```bash
cast call 0x036CbD53842c5426634e7929541eC2318f3dCF7e \
  "balanceOf(address)(uint256)" <YOUR_ADDRESS> \
  --rpc-url https://sepolia.base.org
```

That address is Base Sepolia USDC — the same one the signer has in its chain
table.

**Expect:** a non-zero number. USDC has 6 decimals, so `10000000` is 10 USDC.

> **Do not continue without both balances.** The signer refuses to broadcast
> with no gas or insufficient USDC, and you would be debugging a refusal that
> is working correctly.

---

## Step 3 — Deploy the contracts to Base Sepolia

```bash
cd forgepay/on-chain
forge build
```

**Expect:** `Compiler run successful`. Every contract and script in this repo
compiles clean as of this writing; if it doesn't, stop and fix that first.

Then deploy:

```bash
export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
export SETTLEMENT_PRIVATE_KEY=<your testnet private key>

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

**Expect:** five contract addresses in the output. Write them down — you need
all five.

**If it fails on gas**, your faucet ETH hasn't landed yet. Wait and retry.

---

## Step 4 — Point the bureau at the chain

Add to `forgepay/services/agent-credit-bureau/.env`:

```bash
CHAIN_RPC_URL=https://sepolia.base.org
CHAIN_ID=84532
SETTLEMENT_PRIVATE_KEY=<your testnet private key>
FORGE_REGISTRY_ADDRESS=<from Step 3>
FORGE_VALIDATOR_ADDRESS=<from Step 3>
FORGE_ENFORCER_ADDRESS=<from Step 3>
FORGE_CORE_ADDRESS=<from Step 3>
FORGE_CROSSCHAIN_ADDRESS=<from Step 3>
```

Set `CHAIN_ID` explicitly even though 84532 is the default. Getting into that
habit now is what stops a mainnet deployment silently settling to testnet
later — the exact failure the preflight in `chain-preflight.ts` exists to
catch.

Restart the bureau, then:

```bash
curl -s localhost:3018/v1/settlement/status -H "X-API-Key: dev-bureau-admin-key"
```

**Expect:** a response showing the chain is configured rather than
`not configured`.

---

## Step 5 — Pull a report (the customer-facing path)

This is the first time the product does its actual job.

### 5.1 Fund the requestor's account

```bash
curl -s -X POST localhost:3018/v1/billing/test_lender/credit \
  -H "X-API-Key: dev-bureau-admin-key" -H "content-type: application/json" \
  -d '{"amountUsd": 100, "reason": "testnet dress rehearsal"}'
```

**Expect:** a balance of 10000 cents.

### 5.2 Get a consent token

A hard pull is refused without one. That is the design, not an obstacle.

```bash
curl -s -X POST localhost:3018/v1/consent \
  -H "X-API-Key: dev-bureau-admin-key" -H "content-type: application/json" \
  -d '{"agentId":"agent_prime_001","requestorId":"test_lender","purpose":"credit_application"}'
```

**Expect:** a `token` field. Copy it.

### 5.3 Pull the report

```bash
curl -s -X POST localhost:3018/v1/lender-reports \
  -H "X-API-Key: dev-bureau-admin-key" -H "content-type: application/json" \
  -d '{"agentId":"agent_prime_001","requestorId":"test_lender",
       "requestorName":"Test Lender","purpose":"credit_application",
       "consentToken":"<TOKEN FROM 5.2>"}'
```

**Expect:** a full report — score, grade, tier, factors, recommended limit.

**If you get a decline mentioning sanctions**, that is the fail-closed screen.
In development it skips; if you set `NODE_ENV=production` locally it will
decline until `COMPLIANCE_MONITOR_URL` points at a running compliance-monitor.
Worth seeing once so you recognise it.

### 5.4 Confirm the furnisher was credited

```bash
curl -s "localhost:3018/v1/settlements/preview?period=$(date -u +%Y-%m)" \
  -H "X-API-Key: dev-bureau-admin-key"
```

**Expect:** at least one line with a non-zero `amountUsd`. That is the
attribution ledger doing its job: your pull generated a debt to whoever
furnished the data behind that score.

---

## Step 6 — The first real payout

Everything so far was rehearsal for this.

### 6.1 Give the furnisher a payout address

A furnisher with no address is reported as blocked rather than paid. Set one —
use your own testnet address so the USDC comes back to you:

```bash
curl -s -X PUT localhost:3018/v1/contributors/fp_internal/payout-destination \
  -H "X-API-Key: dev-bureau-admin-key" -H "content-type: application/json" \
  -d '{"payoutAddress":"<YOUR_TESTNET_ADDRESS>","payoutChain":"base-sepolia"}'
```

**Expect:** the address echoed back, with `previousAddress` of `null`.

This route is admin-only on purpose. A furnisher must not be able to redirect
its own payouts with its own furnishing key — that key exists to submit data,
and letting it move money would turn a stolen ingest credential into a theft of
every future payout.

### 6.2 Start the gateway with the signer ON

```bash
cd forgepay/services/stablecoin-gateway
npm install
```

Set in its environment:

```bash
POSTGRES_PASSWORD=postgres
INTERNAL_WEBHOOK_SECRET=dev-webhook-secret
CORS_ALLOWED_ORIGINS=http://localhost:3000
VALID_API_KEYS=a-long-enough-development-api-key-value

PAYOUT_SIGNER_ENABLED=true
PAYOUT_SIGNER_CHAIN=base-sepolia
PAYOUT_SIGNER_RPC_URL=https://sepolia.base.org
PAYOUT_SIGNER_PRIVATE_KEY=<your testnet private key>
PAYOUT_SIGNER_DAILY_MAX_USD=50
```

Keep the daily cap small. On testnet it costs nothing to hit; on mainnet it is
the control that bounds a mistake, and building the habit here is the point.

```bash
npm run dev
```

**Expect:**

```
[stablecoin-gateway] Outbound payout signer ACTIVE — 0x… on base-sepolia
```

If you instead see `Outbound payouts not signed: …`, the flag is not exactly
the string `true`. `1`, `yes` and `TRUE` all mean *off*, deliberately.

### 6.3 Point the bureau at the gateway

Add to the bureau's `.env` and restart:

```bash
STABLECOIN_GATEWAY_URL=http://localhost:8020
```

### 6.4 Run the settlement

Settlement only pays **closed** periods, so settle last month:

```bash
curl -s -X POST localhost:3018/v1/settlements/run \
  -H "X-API-Key: dev-bureau-admin-key" -H "content-type: application/json" \
  -d '{}'
```

By default this settles the previous period. If you get a `409 PeriodOpen`,
that guard is working — you asked it to settle a month that hasn't ended, which
would strand every entry accrued afterwards.

To actually see a payout this month, the simplest honest approach is to wait
for the period to close, or seed an attribution dated in a previous month.

**Expect on success:** a `settlement_id`, a `total_paid_usd`, and lines each
carrying a `payout_id`.

### 6.5 Watch the money move

```bash
curl -s localhost:8020/payouts/ -H "X-API-Key: <VALID_API_KEYS value>"
```

Find the payout, then submit it:

```bash
curl -s -X POST localhost:8020/payouts/<PAYOUT_ID>/submit \
  -H "X-API-Key: <VALID_API_KEYS value>"
```

**Expect:** status `confirmed` and a real `tx_hash`.

Paste that hash into `sepolia.basescan.org`. **That is the first time this
system has ever moved money.** Confirm the amount and the destination match
what the statement said.

### 6.6 Prove it cannot pay twice

Run the same settlement again:

```bash
curl -s -X POST localhost:3018/v1/settlements/run \
  -H "X-API-Key: dev-bureau-admin-key" -H "content-type: application/json" -d '{}'
```

**Expect:** `total_paid_usd` of 0, or lines marked `deduplicated`. No second
transaction on the block explorer.

This is the single most important check in this runbook. The idempotency key is
per furnisher per period and enforced by a unique index in the database, not by
application logic remembering to look. If a second transfer *does* appear,
stop — do not go anywhere near mainnet — and report it.

---

## Step 7 — Restart proof

Kill the bureau (Ctrl-C) and start it again. Then:

```bash
curl -s "localhost:3018/v1/settlements/preview?period=$(date -u +%Y-%m)" \
  -H "X-API-Key: dev-bureau-admin-key"
```

**Expect:** the same numbers as before the restart, and anything already paid
still marked settled.

This is covered by an automated test, but seeing it yourself is worth five
minutes: it is the difference between owing money reliably and losing the
record of what you owe.

---

## What "done" looks like

You can tick all of these off:

- [ ] A report pulled through the real consent → charge → inquiry path
- [ ] A furnisher debt appearing in the settlement preview
- [ ] A real transaction hash on Base Sepolia, verified on the explorer
- [ ] A repeat settlement paying nothing and creating no second transaction
- [ ] Ledger figures identical after a restart

Only then is mainnet a mechanical repeat of a thing you have already watched
work.

---

## Before you do any of this on mainnet

Three differences, all of which have bitten people:

1. **A mainnet key is not disposable.** It belongs in a secret manager mounted
   as a file (`PAYOUT_SIGNER_KEY_FILE`), never in `.env` and never in your
   shell history.
2. **Set `CHAIN_ID=8453` explicitly.** The default is Base Sepolia, and the
   service will refuse to start in production without it — that refusal is
   protecting you from settling real scores to a testnet.
3. **Keep `PAYOUT_SIGNER_DAILY_MAX_USD` small at first.** Raise it once you
   have watched a week of real settlements, not before.
