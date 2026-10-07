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

Send the key as `X-API-Key: <key>` or `Authorization: Bearer <key>`. You can issue, rotate and revoke your own keys (section 8).

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

Then run the conformance script (section 10) to check your whole integration.

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

1. **Get consent.** In the **sandbox**, issue it yourself: `POST /v1/sandbox/consent {"agentId":"acme_1"}`. In the **live** service, the agent's operator authorises each pull; see "Not available yet" below.
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

## 7. Billing

You pay per inquiry from a **prepaid balance** in a stablecoin (USDC; ZARP and OUSD are on hold). `GET /v1/billing/{your id}/account` shows the balance and pulls remaining;
`POST /v1/billing/{your id}/topup` starts a top-up and `…/topup/{receiptId}/confirm` confirms it once paid. You can read only your own account.
Plans and volume pricing are at `GET /v1/plans`.

## 8. Keys: issue, rotate, revoke

You can hold up to **5 active keys**. To rotate with no downtime: `POST /v1/contributors/{id}/keys` (the new key is shown once), move your systems over, then
`DELETE /v1/contributors/{id}/keys/{oldKeyId}`. Your registration key is `primary`. You cannot revoke your only active key; if a key leaks and it is your last, ask the bureau
operator to revoke it. `GET /v1/contributors/{id}/keys` lists keys with their status and last use, never the key itself. You can set an expiry when you issue one.

## 9. Errors and limits

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

Requests are rate-limited per client address (ask for your limit); back off on 429.

## 10. Check your integration

`scripts/partner-conformance.mjs` (in the bureau service, Node 18 or newer, no packages) runs about 30 checks against **your sandbox**: registration, repayment reporting
and idempotency, validation, scoring, consent and the lender report, disputes and key rotation. It **refuses to run against a live service** because it writes test data.

```bash
node scripts/partner-conformance.mjs --base-url https://<sandbox> --key <your key> --institution-id <your id>
```

Exit code 0 means every check passed. Run it before going live and after any change to your integration.

## 11. Going live

- [ ] The conformance script passes against the sandbox.
- [ ] Your key is in a secret manager, and you have practised a rotation.
- [ ] You report every repayment, including late ones, with stable `externalId`s, and your retries are safe.
- [ ] Your underwriting handles a `decline` for `THIN_FILE`, and reads reason codes rather than only the score.
- [ ] You have a process for disputes on your data.
- [ ] Your institution is activated on the live service and funded for pulls.

## Not available yet (as of 7 October 2026)

- **Live consent for operators.** In the live service consent is issued by an operator action; an operator-facing way to authorise a lender from the FORGE console is not built yet.
  Until it is, the bureau issues consent on the operator's instruction.
- **Webhooks.** Nothing pushes events to you (a dispute opened, a score band change). Poll.
- **Mode 2 data.** On-chain scoring has almost nothing to read for most agents.
- **Zero-knowledge proofs.** Not offered.
- **Company-register verification of operators.** The check exists as a seam; no register provider is connected yet, so an operator's registration is as submitted.
- **Regulatory registration.** The bureau's position under the National Credit Act is with counsel; do not treat this guide as a statement that the bureau is, or is not, registered.
