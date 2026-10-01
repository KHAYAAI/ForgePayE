# ForgePay Stablecoin Gateway

Forked from [zpaynow/ZeroPay](https://github.com/zpaynow/ZeroPay) (MIT).

## Role

- Accept **USDC**, **USDT**, **ZARP** (rand) and **OUSD** payments on major chains (Ethereum, Solana, Base, Polygon, Arbitrum)
- Native **x402 protocol** support for AI/agent-to-agent payments
- Low fee: **1.4% + gas** per transaction
- Real-time settlement and on-chain confirmation tracking

## Key Capabilities

| Feature | Details |
|---|---|
| Supported stablecoins | USDC, USDT, EURC |
| Chains | Ethereum, Base, Polygon, Arbitrum, Solana |
| x402 support | HTTP 402 native payment flow for AI agents |
| Settlement | Near-instant (once on-chain confirmed) |
| Webhooks | Real-time confirmation events → unified-router |

## Key Modifications from ZeroPay Upstream

1. All payment events emit to **unified-router** (not directly to merchants)
2. Multi-tenant: wallet addresses are generated per `(merchant_id, chain)` pair using HD wallet derivation
3. KMS-wrapped private keys — never plaintext in config
4. Merchant-facing API normalized to match ForgePay canonical payment API

## Development

```bash
cd forgepay/services/stablecoin-gateway
npm install
npm run dev          # port 8030
```

## Upstream Pin

```yaml
stablecoin-gateway:
  source: https://github.com/zpaynow/ZeroPay
  commit: <pin-on-fork>
```


## Assets, rates and settlement

USDC, USDT, ZARP and OUSD are handled by one registry (`src/lib/assets.ts`). A token's decimals and
symbol are read from its contract at start-up; one that doesn't check out is refused, not guessed
(`GET /assets` shows each token's status and why). Amounts are quoted in USD and converted with exact
integer arithmetic (`src/lib/asset-math.ts`): money in rounds up, money out rounds down.

- **ZARP** is priced at the operator-set USD/ZAR rate (`PUT /assets/rates/USD-ZAR`, admin), kept with its author and
  date and refused when older than `FX_MAX_AGE_HOURS`. The rate is locked on each payment/payout when it is
  created. There is no live market feed; that is the seam for one.
- **x402 and deposits** open a one-time address and an exact asset amount. `lib/settlement.ts` polls each chain's
  transfer logs, counts only *final* blocks into the persisted total (a reorg can't un-credit), accepts partial
  payments cumulatively, ignores other tokens, records payments after expiry in `late_units` (never credited),
  and survives restarts. It replaces the old event monitor, which could never confirm an x402 payment.
- **Payouts** fix asset, units and rate at creation (so a retry of the same `external_id` returns the original),
  judge ceilings and approval in USD, and send exactly the stored units, refusing if the token no longer verifies.
  The bureau *creates* payouts. With a live signer installed, a **payout worker** (`lib/payout-worker.ts`) sends
  approved ones automatically — small ones straight away, large ones after a person approves — and records each
  transaction's hash at the moment it is sent. A payout found mid-flight after a crash is settled by looking that
  hash up on-chain; one with no hash is marked failed for a person to check (it might have gone out, and a retry could
  pay twice). `PAYOUT_AUTO_SUBMIT=false` leaves `POST /payouts/:id/submit` to an operator instead.
- **Sweeping** (`lib/sweeper.ts`, off unless `SWEEP_ENABLED=true`) moves confirmed deposits from their one-time
  addresses to a treasury address. A separate gas wallet drips each address just what its transfer needs (estimated, plus
  a margin), then the address's own key signs the transfer. It is a resumable state machine that records every hash as
  it is sent, never sends twice, defers when gas is above `SWEEP_MAX_GAS_GWEI`, and records failures for a person to
  review (`POST /sweeps/:id/retry`). Late, short and unclaimed funds are never swept automatically; an operator can sweep
  one with `POST /sweeps {deposit_id, reason}`. Tokens of the wrong kind sent to a deposit address stay where they are.
- **Deposit keys** (`lib/keystore.ts`) are envelope-encrypted: each key is sealed with AES-GCM under a data key, the
  data key is wrapped by Vault transit or AWS KMS (`KEY_WRAP_PROVIDER=vault|awskms`; `env` is for development and warns
  in production), and every blob is bound to its deposit's address, so a blob copied onto another row won't open.

- **Treasury tiers** (`lib/treasury.ts`, off unless `TREASURY_MANAGER_ENABLED=true`; needs the live signer). Money moves
  deposit addresses → **operating wallet** (where sweeps land) → **payout wallet** (the hot signer), with surplus going on to a
  fixed **cold address** this service holds no key for. The payout wallet is topped up to a target whenever a token falls below a
  floor; the floor is the larger of a configured minimum and what *approved* payouts already waiting need, so a payout is funded
  for rather than failed. The operating wallet only ever sends to that one payout address, within a daily cap
  (`REPLENISH_DAILY_MAX_USD`), and sends anything above `TREASURY_WARM_MAX_USD` on to cold storage. When it can't cover a need (not
  enough, or the cap is reached) that is a **shortfall**: recorded, shown at `GET /treasury/status`, emitted as an event, and the
  payout simply waits, approved — limits are never raised automatically. Each move is written to `treasury_transfers` before it is
  sent and gets its hash the moment it is, so a crash is reconciled from the chain.
- **Dust**: after a sweep, what is left of the gas drip is sent back to the gas wallet when that recovers more than a fraction of its own cost.
- **Wrong tokens**: `GET /sweeps/strays/:depositId` lists other known tokens sitting in a deposit address and who sent them;
  `POST /sweeps/recover {deposit_id, asset, destination, reason}` returns one — normally to its sender — through the same gas-drip
  state machine. `asset` can be a contract address for a token this gateway doesn't know. It never sweeps a deposit's own token to a
  refund address, and never to the treasury.

`scripts/multi-asset-e2e.cjs` exercises all of it against real token contracts on a local chain
(`E2E_KEY_WRAP=vault` runs it with the keys wrapped by a real Vault).

### Checking the key service for real

Unit tests and the end-to-end run use a real Vault and a stand-in for AWS KMS. Before relying on KMS, run the check against your account:

```
KEY_WRAP_PROVIDER=awskms KEY_WRAP_KMS_KEY_ID=alias/deposit-keys AWS_REGION=... npx tsx scripts/verify-key-custody.ts
```

(and, for the signing nodes' seal keys, `MPC_SEAL_PROVIDER=awskms MPC_KMS_KEY_ID=... mpc-node seal-check -provider awskms`). They wrap and unwrap throwaway
keys, confirm the wrapped form doesn't contain the key, that it won't open for another address/node, that an altered blob is refused, and that
KMS enforces the encryption context. Nothing is left behind. `openfireblocks/deploy/aws/kms-policy.example.json` is a least-privilege IAM policy that
allows only `kms:Encrypt`/`kms:Decrypt` with that encryption context.

**Not covered:** KMS has not been run against a real AWS account from this repo's test environment (no access); use the check above. The
treasury's cold address is an address only: moving money *out* of it is whatever controls it (custody, a hardware wallet). Wrong-token discovery
only finds tokens this gateway knows; for others an operator names the contract.

## Running more than one replica, alerting, the live rand rate, and first contact with real tokens

**Leader election.** The background workers (settlement poller, payout worker, sweeper, treasury, watchdog, rate feed) run on one
replica at a time: a Postgres advisory lock held on a dedicated connection, released automatically if that connection dies, so another
replica takes over within `LEADER_RETRY_MS` (5s). Other replicas still serve HTTP. `LEADER_LOCK_ENABLED=false` disables it (single
instance only). A leader that loses its connection may finish the pass it was in; passes are safe to overlap because payouts are claimed
in the database and reconciled by hash, and sweeps/treasury moves are state machines. (The openfireblocks gateway's poller and key
backfill already use advisory locks.)

**Alerts.** `ALERT_WEBHOOK_URL` (+ `ALERT_WEBHOOK_FORMAT=slack|json`), `ALERT_PAGERDUTY_ROUTING_KEY`, `ALERT_ENV`, `ALERT_REMINDER_MINUTES`.
A watchdog reads state every `WATCHDOG_INTERVAL_MS` (60s) and raises: treasury shortfall (critical), approved payouts unsent for 15 min
(critical), failed payouts (critical), failed sweeps (warning), USD/ZAR rate near/past expiry (warning/critical), an asset failing
verification (critical). Settlement raises a critical alert if a deposit's balance is short of what its events show. Critical goes to
PagerDuty + webhook, warning to the webhook; repeats are suppressed until the reminder interval; each condition sends one "resolved". An
alert that could not be delivered anywhere is retried, not assumed sent. `GET /alerts` shows state and delivery failures;
`POST /alerts/test` sends a test through the real destinations — do it after configuring them.

**Live USD/ZAR.** `FX_FEED_ENABLED=true` polls `FX_FEED_SOURCES` (default `frankfurter,open-er-api,coinbase`) every
`FX_FEED_INTERVAL_MS` (15 min). It stores a rate only if at least `FX_FEED_MIN_SOURCES` (2) answer, they agree within
`FX_FEED_TOLERANCE_PCT` (1%), the median is within `FX_FEED_MIN`–`FX_FEED_MAX` (5–60), and it is within `FX_FEED_MAX_JUMP_PCT` (5%) of the
last rate. Otherwise nothing is stored, the old rate ages, and the existing max-age rule stops ZARP quoting (fails closed) with an alert.
`GET /assets/rates/feed/check` runs the sources once from the deployed gateway without storing. **The provider URLs are their documented
public APIs and have not been called from this repo's build environment.**

**First contact with Base.** See `docs/ASSET_FIRST_CONTACT.md`: what the gateway probes (proxy, paused, rebasing signs, freezing, fee-like
settings), the per-deposit balance check, and the manual dust-test procedure to run before real money.
