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
- **Recipient list: decided, fixed in production.** See "The recipient list" below. Changing a furnisher's payout address is a deliberate, human step (a new key).
- **In-flight without a hash.** If custody is still signing when our wait ends, the payout is failed with "do not re-issue; check custody for request id <id>".
  The seam's pending state needs a transaction hash, and there is none yet. Extending `submitPayout` to hold a hash-less pending state is a possible follow-up.
- **A request in transit.** If our request is delayed in the network and custody receives it *after* we looked and found no record, it would still pay. The
  payout id keeps it single, but the payout will already be marked failed. Rare; reconcile any "failed" payout against custody before re-issuing.
- **Balance is not visible to the agent key.** `canCover` checks the key and token, not the wallet balance; a shortfall shows as a refusal when the payment is tried.
- **Existing hot-key behaviour noted, not changed:** `submitPayout` marks the payout `submitted` before calling the broadcaster, and `spentLast24hUsd`
  sums `submitted` payouts, so the hot-key signer's daily-ceiling check counts the current payout twice (headroom is effectively halved for the last
  payout of the day). The custody signer mirrors this for consistency; it errs on the safe side. Worth fixing in both together.

## The recipient list (decision, 15 October)

**Fixed list in production; open list only for staging, and only on purpose.** Payouts go to a small, known set of furnisher addresses. With a fixed
list, a stolen agent key cannot pay anyone else, and changing where money goes needs a person (a new key). That friction is the control, not a defect.

How it is enforced:
- The signer **refuses a key with no recipient list** when `NODE_ENV` is production-like, unless `CUSTODY_ALLOW_OPEN_RECIPIENTS=true` is set exactly. The
  preflight reports the same as a failure. Helm passes the variable through `config:`.
- Before asking custody to pay, the signer checks the recipient against the list on the key (`GET /agent/me` returns it). A payout to an address that is not on
  it is refused **without asking**, so custody's record of the agent is not filled with refusals we could have predicted. Those records are part of an agent's
  track record, and the bureau reads them (below).
- To add or change a furnisher address: a custody admin issues a new key whose list includes it (`scripts/issue-custody-agent-key.mjs`), the new key replaces the
  mounted secret, then the old key is revoked.

## Custody staging: what you do, and what is already built

I cannot reach your staging deployment from my sandbox (its network proxy blocks it) and I have no custody admin credential, so these steps are yours. Everything
around them is built.

1. **Get an admin token** (a custody admin user): `POST /v1/auth/login` with email and password; if MFA is on, then `POST /v1/auth/mfa/verify` with the
   challenge token and your code. The result's `accessToken` lasts an hour. Put it in `CUSTODY_ADMIN_TOKEN` in your shell. Never in a file in the repo or in chat.
2. **Issue the agent key** with the script. It writes the key to a file readable only by you and never prints it:
   ```
   CUSTODY_ADMIN_TOKEN=… node scripts/issue-custody-agent-key.mjs \
     --api-url https://<staging> --customer-id <custody customer id> --key-id <custody key id> \
     --recipients <your test recipient address> --per-transfer-zar 50 --daily-zar 200 --expires-days 14 --out ./agent-key
   ```
   Add `--dry-run` first to see exactly what will be sent. Put the file's contents into your secret manager, then delete the file.
3. **Staging needs an RPC for Sepolia on the custody api-gateway** (`EVM_RPC_11155111`) and the test token registered and verified there.
4. **Add two secrets** to the GitHub environment `custody-staging` (Settings > Environments; add yourself as a required reviewer): `CUSTODY_CONTRACT_URL` and
   `CUSTODY_CONTRACT_AGENT_KEY`. Then run the workflow *ForgePay Custody Contract (manual)*. Leave "allow_pay" off for the first run: it checks the API shapes only.
5. **Then the cent-sized payment:** run it again with `allow_pay` on, `chain_id` 11155111, the token symbol, your recipient (must be on the key's list), and an
   amount like 0.01. It pays once, asks again with the same id to prove it does not pay twice, and reads the status back. It refuses any mainnet chain id.
6. **Then the gateway itself:** set the Helm values (`payout.mode: custody`, see `ci/custody-values.yaml`), run `npm run preflight:custody` in the pod, and let a
   test payout through.

## Step 2: custody's record into Mode 2

**What custody exposes today (read from its source):** an admin route, `GET /organisations/{customerId}/agents/{agentId}`, returns the agent and its lifetime
counts: payments, releases, refusals, and refusals grouped by reason. It has no timestamps (so no windows or trends). It sits behind a **user login that expires
hourly** and a role check; there is no machine credential for read access. It does not say which wallet the agent pays from: that sits behind a *customer API key*,
which can also sign payments, so it must not be handed to the bureau. The agent's own history (`GET /agent/transfers`) needs the agent's own key.

**What that rules out:** the bureau pulling from custody. It would need a standing credential, and there would be no proof that a linked custody agent is the same
agent as the bureau's: anyone could link an agent with a spotless record to their own.

**What is built instead: a signed attestation.**
- *Custody side (patch, `docs/launch/custody-patches/0001-agent-attestation.patch`, written and tested in a local clone of the custody repo, not applied there):*
  `GET /organisations/{customerId}/agents/{agentId}/attestation`, admin-only, audited, returns a short-lived (7 days by default, 14 at most) ed25519-signed
  statement: the counts, and the **address of the key the agent pays from**. No amounts, recipients or purposes. Off unless `AGENT_ATTESTATION_KEY_FILE` is set.
  Tested with the custody repo's own jest: its full suite passes (57 suites, 615 tests) and its route-inventory guard check passes (161 routes, all guarded).
- *Bureau side (this repo):* the operator submits the statement to `POST /v1/agents/{id}/custody-attestation`. That act is the consent. The bureau checks the
  signature against custody's published key(s) (`CUSTODY_ATTESTATION_PUBLIC_KEYS`, several allowed so the key can be rotated), that the key address is the wallet
  this bureau agent proved it controls, that the statement is fresh, short-lived and consistent, and, on a later one, that it is **newer and the lifetime counts
  did not go down** (so an old, better record cannot be replayed over a worse one). `DELETE` withdraws consent and **erases** it, from memory and the database.
- *Effect on the score:* it supplies the two Mode 2 inputs public chain data cannot: the success rate (payments that went through, of those attempted) and budget
  compliance (attempts that stayed within the agent's budget; only the two budget refusal reasons count against it). A refusal is not a failed payment. Below 10
  attempts a rate is left **unknown**, never a flattering 100%. An expired statement contributes nothing: unknown is never assumed good. The dual-score response
  says whether a statement was used (`custodySource`) and why not when it was not.
- It only adds to an agent that already has on-chain inputs; it does not create a Mode 2 score where there is no activity to score.

**Turning it on:**
1. Apply the patch to the custody repo (`git am docs/launch/custody-patches/0001-agent-attestation.patch`), generate the signing key and set
   `AGENT_ATTESTATION_KEY_FILE` (instructions in the patch's `docs/agent-attestation.md`).
2. Give the bureau the **public** key out of band: `CUSTODY_ATTESTATION_PUBLIC_KEYS`.
3. The operator asks custody for a statement (`?subject=<bureau agent id>`) and submits it. The console screen for this is not built yet; today it is the API.

**Verified:** 28 bureau tests (signature, every rejection reason, replay and regression rules, the signal math, the admin-only routes, the effect on the dual score,
erasure on withdrawal) and a real-Postgres restart test; eight deliberate breaks of the security rules were each caught. **A compatibility test runs the real output of the
custody issuer through the bureau's verifier**, so the two implementations agree on the format.

**Not verified / open:**
- The patch has not been applied to or deployed in the custody repo, and nothing has run against a live custody. I could not push to that repo and did not try.
- The statement is valid for days, and nothing renews it: an operator must resubmit, or the signals lapse. Automating that (custody pushing statements) is future work.
- The bureau trusts whoever holds custody's signing key. Protect that key like a custody key.
- **POPIA:** this is personal-data processing in a credit context. The consent here is a submission by the operator, recorded with who and when. Whether that is
  sufficient, how long to retain, and what the notice must say are for counsel.
- No console screen yet.

## Custody's own status (from its documents, not re-verified here)

Ready for supervised testnet or capped pilots; not for banks or uncapped funds. Its agent routes and MCP server have not been through a pentest round.
Signing parties still run on one host, with no HSM; the cryptographic audit, SOC 2 and live TRISA are pending. Its own timeline puts SOC 2 Type I
around January–February 2027 and Type II around April–May 2027. Treat the bureau's custody-backed payouts as **testnet or capped** until those close.

## Next

1. Staging: steps 1–6 above (yours, then I can read the results and fix what they show).
2. Apply and review the custody patch in the custody repo; deploy; turn on attestations with one design partner.
3. A console screen for the operator to request and submit an attestation, and to withdraw it.
4. Refresh or replace the vendored custody tree so CI builds the same code this integrates with.
