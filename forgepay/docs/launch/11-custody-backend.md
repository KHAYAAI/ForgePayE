# Custody as the platform's backend: payouts through FORGE custody

**15 October 2026.** The custody backend is `KHAYAAI/openfireblocks`, branch `claude/platform-explanation-h0st5y`, pinned at commit
`5b6ab125…` in `config/base/pinned-upstreams.yaml` (`forge-custody-backend-target`). It is **not vendored** here: the tree under
`services/openfireblocks` is an older, smaller copy that CI still builds images from. Licence of the new repo: Elastic License 2.0.

## What changed in the bureau's money path

The stablecoin gateway used to pay furnishers from a **hot wallet whose private key sits in this service** (`PAYOUT_SIGNER_KEY_FILE`).
It can now instead ask custody to pay:

```
payout approved ─► stablecoin-gateway ─► POST /agent/transfers (custody api-gateway, Bearer ofb_agent_…)
                                           │  token registry → policy engine → Travel Rule → 2-of-3 threshold signature → broadcast
                                           ▼
                       transaction hash ◄── GET /agent/transfers/:id?chainId=…  (until confirmed)
```

The gateway then holds **no signing key**. Custody holds three key shares in separate parties; any two sign. The gateway holds only an
*agent key*, which can pay, and only pay, within limits a custody admin set (tokens, optional recipients, per-payment and 24-hour
limits in rand, an expiry, a revoke button).

Code: `stablecoin-gateway/src/lib/custody-payout-signer.ts`. Off by default; the hot-key path is unchanged when `PAYOUT_SIGNER_MODE` is unset.

## Rules the code keeps

| Rule | Why |
|---|---|
| Off unless `PAYOUT_SIGNER_ENABLED=true` **and** `PAYOUT_SIGNER_MODE=custody`, exactly | A switch that decides whether money can move gets no truthiness games. An unrecognised mode refuses to start. |
| Refuses to start beside a hot key (`PAYOUT_SIGNER_PRIVATE_KEY` / `_KEY_FILE`); the Helm chart refuses the same | The point of this mode is to hold no key. |
| The payout id is the idempotency key | Asking again returns the same payment. It can never pay twice. |
| An ambiguous answer (timeout, 5xx, 409) is resolved by asking custody what it recorded for that id | A lost reply must neither pay twice nor mark a paid payout unpaid. |
| "Unpaid" is reported only when custody says it has no record, or recorded a refusal or release | |
| A payment still in flight after the wait **fails loudly with "do not re-issue"** | There is no transaction hash yet to hang a pending state on. See limits below. |
| The success reply must match the request (recipient, amount, request id) and say it broadcast | The hash is recorded first, then a mismatch is refused with "investigate". |
| Our own ceilings are re-checked when money moves: chain, absolute maximum, rolling 24h (`PAYOUT_SIGNER_DAILY_MAX_USD`) | Two independent limits, held by two parties: custody's on the key, ours in the gateway. |
| Unknown to custody is "pending" when reconciling, never "failed" | A guess must not invite a second payment. |
| The agent key is never logged or echoed; read from a mounted file by preference | |

## Turning it on (staging first, Sepolia)

1. **Custody side (a custody admin):** issue an agent key for the gateway's key id: `POST /organisations/{customerId}/agents` with
   `allowedTokens: ["USDC"]`, `allowedRecipients` (see limits), `perTransferLimitZar`, `dailyLimitZar`, `expiresInDays`. The key is shown once.
   Register the test token on the testnet chain and make sure the custody api-gateway has an RPC endpoint for it (`EVM_RPC_<chainId>`).
2. **Store the key** in Secrets Manager, mounted as a Kubernetes Secret. Never in the repo, chat or a ticket.
3. **Helm values:** `payout.signerEnabled: true`, `payout.mode: custody`, `payout.custody.apiUrl`, `payout.custody.agentKeySecret.name`;
   in `config`: `PAYOUT_SIGNER_CHAIN` (e.g. `base-sepolia`) and `PAYOUT_SIGNER_DAILY_MAX_USD`. Example: `infra/helm/stablecoin-gateway/ci/custody-values.yaml`.
4. **Run the read-only check:** `npm run preflight:custody`. It pays nothing. It confirms custody accepts the key, when it expires, that the key
   may pay the token on this chain, that custody can broadcast there, and how much of our own ceiling is spent.
5. **Run the contract test** against that deployment (testnet only): see the header of `__tests__/custody-contract.test.ts`.
6. Start with a payout of a few cents. Watch it confirm. Then raise the limits deliberately.

## What is verified and what is not

**Verified (locally):** 41 unit tests of the broadcaster, including a safety-critical set that was confirmed to fail when each rule above
is deliberately broken (random idempotency key, ambiguity treated as failure, recipient check removed, hot key allowed beside custody, hash
recorded late, unknown payment reconciled as failed). The full gateway suite passes (217 passed, 8 skipped).

**Not verified, and why it matters:**
- **No test has run against real custody.** The unit tests use a stand-in written from custody's controller *source*
  (`__tests__/helpers/custody-standin.ts`). That proves this code follows the contract as read, not that the running service behaves that way.
  The contract test exists to close that gap; it needs a custody deployment, which this session could not run (no Docker daemon, small machine).
- **The Helm change was not rendered locally** (no `helm` binary). CI's chart job renders it, including a check that custody mode refuses a hot key.
- **No testnet payment has been made through this path.**

## Known limits and decisions for you

- **Rand-only limits.** Custody values every payment in rand and limits the key in rand. Our payouts are in USD; the key's limits must be set with an FX
  margin, and our own USD ceiling stays the tighter control.
- **Recipient list is fixed when the key is issued.** A new furnisher payout address needs a new key (or an unrestricted recipient list, which weakens the control).
  Decide which. A dynamic approach is a change in custody, not here.
- **In-flight without a hash.** If custody is still signing when our wait ends, the payout is failed with "do not re-issue; check custody for request id <id>".
  The seam's pending state needs a transaction hash, and there is none yet. Extending `submitPayout` to hold a hash-less pending state is a possible follow-up.
- **A request in transit.** If our request is delayed in the network and custody receives it *after* we looked and found no record, it would still pay. The
  payout id keeps it single, but the payout will already be marked failed. Rare; reconcile any "failed" payout against custody before re-issuing.
- **Balance is not visible to the agent key.** `canCover` checks the key and token, not the wallet balance; a shortfall shows as a refusal when the payment is tried.
- **Existing hot-key behaviour noted, not changed:** `submitPayout` marks the payout `submitted` before calling the broadcaster, and `spentLast24hUsd`
  sums `submitted` payouts, so the hot-key signer's daily-ceiling check counts the current payout twice (headroom is effectively halved for the last
  payout of the day). The custody signer mirrors this for consistency; it errs on the safe side. Worth fixing in both together.

## Custody's own status (from its documents, not re-verified here)

Ready for supervised testnet or capped pilots; not for banks or uncapped funds. Its agent routes and MCP server have not been through a pentest round.
Signing parties still run on one host, with no HSM; the cryptographic audit, SOC 2 and live TRISA are pending. Its own timeline puts SOC 2 Type I
around January–February 2027 and Type II around April–May 2027. Treat the bureau's custody-backed payouts as **testnet or capped** until those close.

## Next

1. Run steps 1–5 above on custody staging and make one cent-sized Sepolia payment.
2. Mode 2 from custody spend history: custody records every payment *and refusal* per agent, which would give the success-rate and budget-compliance
   factors a real measurement. Needs the operator's consent and a look at what an admin route exposes.
3. Refresh or replace the vendored custody tree so CI builds the same code this integrates with.
