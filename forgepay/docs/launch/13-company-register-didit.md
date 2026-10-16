# Company register for operator verification (Didit)

**16 October 2026.** The bureau's policy is to accept juristic operators only (`JURISTIC_OPERATORS_ONLY`), which only means something if the operator is checked against a
company register. The seam existed (`src/kyb.ts`); this fills it with Didit (`src/kyb-didit.ts`). It is off until a key is configured.

## What was learned from Didit's own tools (sandbox application, nothing billed)

- Search is **free**; select is **billed per company**: South Africa basic (Lite) is **$2.00**, shareholders $5.00, beneficial owners $9.00 (UK and US the same prices).
- **Didit lists South Africa as `validated: false`** (UK and US `true`). I could not tell what that means for coverage. **Test a real South African company before relying on it**
  (`scripts/didit-kyb-smoke.mjs`, below). If coverage is poor, manual entry costs $0.75 but is not a register record and the provider refuses to treat it as verified.
- The account balance was $10.00 with auto-refill off, so spend is capped at that until you top up.
- **The sandbox calls every name an active company** (it echoes the name, with registration number `SANDBOX-0001`). A sandbox key in production would verify every operator.
  The provider detects sandbox answers and refuses them in production (override: `DIDIT_ALLOW_SANDBOX=true`, for non-production only).

## Behaviour

Search first; pay for a select only when exactly one acceptable company is found. A number that belongs to a company with an unrelated name, several name matches, no results, and a
company the search lists as not active all cost nothing. Only `registry_status: active` verifies; any other word (including ones not seen before) leaves the company unverified. A record
that did not come from the register, an unfinished one, or one for another country or number is refused. Every failure (outage, timeout, rejected key, rate limit, odd response, exhausted
budget) reads as `registry_unavailable`, which the policy treats as retryable, never as a verdict on the company. Spend control: at most `DIDIT_KYB_DAILY_MAX_SELECTS` paid lookups per
rolling 24h (default 20, about $40), repeated lookups cached for an hour, concurrent identical lookups share one paid call, and a lost reply still counts because it may have been billed.

## Turning it on

1. **Rotate the key you pasted in chat** (anything pasted into a conversation is exposed). Use a **live** application's key for production, not the sandbox application's.
2. Store it in Secrets Manager and mount it: `DIDIT_API_KEY_FILE`. See `infra/launch/bureau/launch.env.template`.
3. **From a machine that can reach Didit**, run the smoke check: `DIDIT_API_KEY=… node scripts/didit-kyb-smoke.mjs --country ZA --name "<a real SA company>"`. It searches only (free).
   Add `--select` to pay for one lookup and check the record shape. It exits non-zero and says what differs if the paths, the `x-api-key` header or the field names are not what the
   provider expects.
4. Set `JURISTIC_OPERATORS_ONLY=true` only after steps 1–3 and after a few real operators have verified.

## Not verified

The HTTP endpoint paths (`/v3/kyb/search/`, `/v3/kyb/select/`) and the `x-api-key` header are from Didit's public documentation summaries; **this session's network cannot reach Didit**, so
they are unconfirmed until the smoke check passes. The response shapes were observed directly (sandbox). They are each one line in `ENDPOINTS` / `HEADER` if they differ.
