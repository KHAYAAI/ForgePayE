# Institution integration guide (microfinance institutions and other lenders)

For an institution that will report repayments to the FORGE Agent Credit Bureau, pull underwriting reports on agents it may lend to, or both.
The machine-readable contract is `GET /v1/openapi.json` (public). This is the human version. Every example below was run against a sandbox.

**What FORGE is here:** a credit bureau for autonomous software agents. It does not lend. You fund and decide; FORGE holds the record and the score.
A new agent has no history, so it **starts at 300 (the lowest tier, DEEP_SUBPRIME)** and earns its range through repayments you report: the score is
capped until the equivalent of 12 on-time payments are on file.

## 1. Getting access

FORGE registers and activates your institution (an operator action), and gives you:
- an **institution id**,
- an **API key** (shown once; store it in your secret manager),
- the **scopes** you need: `ingest_events` (report repayments), `pull_scores` (read scores and pull reports), `read_profile` (read histories, file disputes).

Send the key as `X-API-Key: <key>` or `Authorization: Bearer <key>`. You can issue, rotate and revoke your own keys (section 9).

You get a **sandbox** first: the same API with free inquiries and test data, at its own address. It labels itself with the response header
`X-Forge-Environment: sandbox` and `"environment": "sandbox"` on `/health`. Nothing you send there reaches a real credit file.

## 2. Quick start in the sandbox

```bash
export B=https://<your sandbox address>   K=<your key>   ID=<your institution id>
J='content-type: application/json'

# Register an agent you have lent to
curl -X POST $B/v1/agents/acme_1/profile -H "x-api-key: $K" -H "$J" -d '{
  "agentId":"acme_1","did":"did:forge:agent_acme_1",
  "operatorEntityId":"op_acme","operatorEntityType":"llc",
  "operatorLegalName":"Acme Operations (Pty) Ltd","operatorCountry":"ZA"}'
# -> 201, currentScore 300, tier DEEP_SUBPRIME, factor THIN_FILE

# Report three repayments
curl -X POST $B/v1/contributors/$ID/ingest -H "x-api-key: $K" -H "$J" -d '{
  "agentId":"acme_1","events":[
   {"externalId":"loan-1-pay-1","eventType":"payment_on_time","amount":100,"description":"instalment 1"},
   {"externalId":"loan-1-pay-2","eventType":"payment_on_time","amount":100,"description":"instalment 2"},
   {"externalId":"loan-1-pay-3","eventType":"payment_late_30","amount":100,"description":"instalment 3"}]}'
# -> 201 {"ingestedCount":3,"duplicatesIgnored":0,"creditedToQuota":3,"windowCapped":false,"newScore":446}

# Read the score
curl $B/v1/agents/acme_1/score -H "x-api-key: $K"
```

Then run the conformance script (section 11) to check your whole integration.

## 3. Reporting repayments (furnishing)

`POST /v1/contributors/{your id}/ingest`, up to **500 events** per call.

| Your fact | `eventType` |
|---|---|
| Instalment paid on time | `payment_on_time` |
| Paid up to 30 / 60 / 90 days late | `payment_late_30`, `payment_late_60`, `payment_late_90` |
| Written off or in default | `default` |
| Credit line opened / closed | `credit_opened`, `credit_closed` |

- **`externalId` is yours** and unique to you (for example `loan-1-pay-3`). Resend a batch and anything already received is ignored (`duplicatesIgnored`), so retries after a timeout are safe.
- You may report **only credit you extended yourself.** `creditorId` is set for you; a different value is rejected with 400.
- Weighting: an on-time payment counts 1, 30 days late 0.5, 60 days late 0.25, and 90 days late or a default 0. A default can never leave an agent better placed than one with no history.
- Your **quota** grows with the data you contribute, up to a daily window cap. You can see it at `GET /v1/contributors/{id}/stats`.
- Get the facts right: reporting is what builds (or damages) an agent's record, and the agent's operator can dispute any event.

## 4. Reading a score

`GET /v1/agents/{agentId}/score` returns the score, grade (AAA to D), tier and **weighted factors with named reason codes**, for example `LATE_PAYMENTS`,
`LIMITED_REPAYMENT_HISTORY` (the cap on a young file) and `THIN_FILE`. Same inputs give the same score.

`GET /v1/agents/{agentId}/dual-score` adds **Mode 2**, a score read from on-chain activity. **Mode 2 is null when an agent has no on-chain history and is thin for most agents today;
do not rely on it yet.** Mode 1, the credit file, is the authoritative score.

## 5. Pulling an underwriting report

A report releases the agent's credit data, so it needs **consent**: a single-use token bound to this agent, you as the requestor, and a purpose.

1. **Get consent.** In the **sandbox**, issue it yourself: `POST /v1/sandbox/consent {"agentId":"acme_1"}`. In the **live** service, **the agent's operator authorises you**: they sign in to the
   FORGE console, open *Agent Credit Bureau > Consent*, name your institution id, the agent and the purpose, and hand you the token. It is shown to them once, works once, and only for that agent,
   your institution and that purpose; they can revoke it before you use it (a revoked or used token stays refused, even across a restart). Give the operator your institution id.
2. **Pull the report:**

```bash
curl -X POST $B/v1/lender-reports -H "x-api-key: $K" -H "$J" -d '{
  "agentId":"acme_1","requestorId":"'$ID'","requestorName":"Your Institution",
  "purpose":"credit_application","consentToken":"<token>"}'
```

The response has a `decision` (outcome, grade, recommended limit, confidence, **reason codes** with polarity, weight and a plain-language statement, and whether each is an
adverse-action reason), plus `activity`, `exposure`, `evidence`, a `narrative` and `disclosures`. `GET /v1/lender-reports/schema` is the full reason-code dictionary.

Notes:
- **A brand-new agent will show a decline** citing `THIN_FILE`: with no history it sits at the lowest tier. That is by design. Your own policy decides what to do with it.
- Each pull records a **hard inquiry** and is **charged**: per pull at the list price (see `GET /v1/plans`), or from a subscription's allocation. In the sandbox it is free.
- A consent token works once. Reusing it is refused.

## 6. Disputes

Anyone with `read_profile` can open a dispute on a reported event: `POST /v1/agents/{agentId}/disputes {"eventId":"…","description":"…(10+ characters)"}`.
The bureau investigates and resolves it (upheld, corrected or deleted). The furnisher is taken from the event itself, not named by whoever files.
As a furnisher you should expect disputes on your data and be ready to evidence your records.

## 7. Webhooks

Instead of polling, register an HTTPS endpoint and the bureau pushes signed events to it.

```bash
curl -X POST $B/v1/contributors/$ID/webhooks -H "x-api-key: $K" -H "$J" -d '{"url":"https://hooks.your-institution.example/forge"}'
# -> 201 {"endpoint":{"id":"wh_..."...},"secret":"whsec_..."}   the secret is shown once
curl -X POST $B/v1/contributors/$ID/webhooks/wh_.../test -H "x-api-key: $K"    # sends a webhook.test event
curl $B/v1/contributors/$ID/webhook-deliveries -H "x-api-key: $K"                # outcomes: status, attempts, last HTTP status or error
```

| Event | When |
|---|---|
| `dispute.opened` | A dispute was filed against an event you furnished. Carries your own `externalId` for it, so you can match your records. |
| `dispute.resolved` | The dispute was resolved (upheld, corrected or deleted). `dataChanged` says whether your reported data was corrected or removed. |
| `agent.tier_changed` | An agent you furnished for moved to a different tier (`from`, `to`, `score`). |

**Verify every delivery.** Each is a POST of the JSON event with `X-Forge-Event`, `X-Forge-Delivery`, `X-Forge-Timestamp` and `X-Forge-Signature: v1=<hex>`, where the signature is HMAC-SHA256 of
`<timestamp>.<raw body>` with your secret. Use the **raw** body, reject a timestamp more than five minutes old, and compare in constant time:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(req, rawBody, secret) {
  const ts = req.headers['x-forge-timestamp'];
  const given = req.headers['x-forge-signature'] ?? '';
  if (!Number.isInteger(Number(ts)) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;   // stale or replayed
  const expected = 'v1=' + createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

**Delivery is at least once.** Any 2xx response is success. Anything else, or a timeout (5 seconds), is retried after 30 seconds, 2 minutes, 10 minutes, 1 hour and 6 hours, then the delivery is marked
`failed`. The same event is sent with the same `X-Forge-Delivery` id each time, so **de-duplicate on that id**. A failed delivery can be re-sent: `POST .../webhook-deliveries/{id}/redeliver`.
If five deliveries in a row fail after every retry, the endpoint is disabled (re-enable it with `POST .../webhooks/{id}/enable`). Queued deliveries survive a restart of the bureau.

**Where it may point.** The URL must be `https`, carry no credentials, and resolve only to public addresses (checked when you register and again on every delivery); redirects are not followed.
You can hold up to 5 endpoints, rotate a secret at any time (`POST .../rotate-secret`: the old one stops working at once), and subscribe each to the events it needs. The bureau never waits for your
endpoint before answering the request that caused an event.

## 8. Billing

You pay per inquiry from a **prepaid balance** in a stablecoin (USDC; ZARP and OUSD are on hold). `GET /v1/billing/{your id}/account` shows the balance and pulls remaining;
`POST /v1/billing/{your id}/topup` starts a top-up and `…/topup/{receiptId}/confirm` confirms it once paid. You can read only your own account.
Plans and volume pricing are at `GET /v1/plans`.

## 9. Keys: issue, rotate, revoke

You can hold up to **5 active keys**. To rotate with no downtime: `POST /v1/contributors/{id}/keys` (the new key is shown once), move your systems over, then
`DELETE /v1/contributors/{id}/keys/{oldKeyId}`. Your registration key is `primary`. You cannot revoke your only active key; if a key leaks and it is your last, ask the bureau
operator to revoke it. `GET /v1/contributors/{id}/keys` lists keys with their status and last use, never the key itself. You can set an expiry when you issue one.

## 10. Errors and limits

Errors are `{ "error": "<Name>", "message": "…" }`.

| Status | Meaning |
|---|---|
| 400 | The request failed validation (details included), or breaks a rule such as attributing credit to someone else |
| 401 | Missing, invalid, revoked, expired or suspended key |
| 402 | Insufficient prepaid balance for the pull |
| 403 | Your key lacks the scope, or the resource belongs to another institution, or consent does not verify |
| 404 | No such agent, report or institution |
| 409 | Already exists (an agent id), or a key rule (last key, too many keys) |
| 429 | Rate limit or ingest quota |

**Limits.** Your institution has its own budget: a number of requests per minute (default 600, set by the operator) and, if the operator sets one, a cap on hard pulls per UTC day.
Every authenticated response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds until the minute window resets); going over returns 429 with `Retry-After`.
A refused daily-cap pull returns 429 `DailyPullLimit` before anything is charged and without using up the consent token, so you can retry the same token once the cap is raised or resets at 00:00 UTC.
`GET /v1/contributors/{id}/stats` shows your limits and today's pull count. There is also a flood guard per client address on every request; if many of your systems share one address and you see 429 on unauthenticated calls, tell the operator.
Ask the operator to change your limits; you cannot raise them yourself.

## 11. Check your integration

`scripts/partner-conformance.mjs` (in the bureau service, Node 18 or newer, no packages) runs about 30 checks against **your sandbox**: registration, repayment reporting
and idempotency, validation, scoring, consent and the lender report, disputes and key rotation. It **refuses to run against a live service** because it writes test data.

```bash
node scripts/partner-conformance.mjs --base-url https://<sandbox> --key <your key> --institution-id <your id>
```

Exit code 0 means every check passed. Run it before going live and after any change to your integration.

## 12. Going live

- [ ] The conformance script passes against the sandbox.
- [ ] Your key is in a secret manager, and you have practised a rotation.
- [ ] You report every repayment, including late ones, with stable `externalId`s, and your retries are safe.
- [ ] Your underwriting handles a `decline` for `THIN_FILE`, and reads reason codes rather than only the score.
- [ ] You have a process for disputes on your data, and a webhook endpoint that verifies signatures and de-duplicates on `X-Forge-Delivery`.
- [ ] Your institution is activated on the live service and funded for pulls.

## Not available yet (as of 7 October 2026)

- **Mode 2 data.** On-chain scoring has almost nothing to read for most agents.
- **Zero-knowledge proofs.** Not offered.
- **Company-register verification of operators.** The check exists as a seam; no register provider is connected yet, so an operator's registration is as submitted.
- **Regulatory registration.** The bureau's position under the National Credit Act is with counsel; do not treat this guide as a statement that the bureau is, or is not, registered.

## Onboarding an institution through the console (added 7 October)

An institution no longer needs the operator to call the bureau by hand. In the console (*Agent Credit Bureau > Institution*):

1. **Apply.** A workspace owner or admin gives the institution's name, type, country, contact, intended use and the access it wants
   (`ingest_events`, `pull_scores`, `read_profile`; `manage_disputes` and `admin` are not available to institutions). One live
   application per workspace; a rejected one can be re-submitted.
2. **Decide.** Only the operator workspace (`FORGE_OPERATOR_TENANT_ID`) with `admin:all` sees the queue. Approving registers the
   institution at the bureau, activates it, applies the chosen limits, then retires the one-time registration key, in that order. The
   bureau id is saved first, so a failure part way can be retried without registering a second institution. Rejection needs a reason.
3. **Keys.** After approval the workspace issues and revokes its own API keys (shown once). The last active key cannot be revoked, and a
   workspace can only act on its own institution.

Not yet in the console: webhook endpoints and quota views (the API exists), and KYB verification of the applicant (no provider wired).
Checked by unit tests with a scripted bureau; **not yet run end to end against a live bureau and Postgres.**
