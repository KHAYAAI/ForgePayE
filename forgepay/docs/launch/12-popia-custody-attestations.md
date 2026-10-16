# Counsel brief: custody attestations and Mode 2 (POPIA)

**15 October 2026.** For a lawyer. Plain facts first, then the questions. Nothing here is legal advice, and the defaults described are
engineering proposals that counsel can change by setting a value, not conclusions about what the law requires.

## What happens, in order

1. An AI agent's operator runs the agent's payments through FORGE custody (a self-hosted or FORGE-run threshold-signing service). Custody
   keeps a record per agent: how many payments went through, how many were abandoned after passing every limit, how many were refused and
   under which reason (for example "over daily budget", "recipient not allowed").
2. The operator, an organisation administrator, asks custody for a **signed statement** of that record. The statement contains counts only: no
   amounts, no recipients, no purposes. It also contains the address of the key the agent pays from, the date, an expiry (7 days unless set otherwise,
   never more than 14), and the identifier of the agent.
3. The operator **chooses to give it to the FORGE credit bureau**. The bureau records who submitted it and when (that is the consent record), checks the
   signature and that the key address is the wallet the agent has already proved it controls, and holds the statement.
4. The bureau uses two figures derived from it (the share of payments that went through, and the share of attempts that stayed within budget) in the
   agent's Mode 2 score. Those scores and their contributing factors appear in reports pulled by lenders, with the consent mechanism the bureau already has for lenders.
5. The operator can **withdraw consent** at any time. The statement is erased from memory and the database. A statement that is not renewed expires after
   its validity and stops counting immediately; it is then erased after a retention period.

## What is stored, for how long, and who can see it

| Item | Where | How long | Who can read it |
|---|---|---|---|
| The signed counts, key address, custody ids, who submitted, when | Bureau database (one row per agent) | Until consent is withdrawn, or the retention period after expiry. **Proposed default: 30 days after expiry** (`CUSTODY_ATTESTATION_RETENTION_DAYS`; 0 erases on expiry) | Bureau administrators and the console on the operator's behalf. Not lenders directly. |
| Two derived figures and the score factors they produce | In the score response and in any lender report generated while the statement was live | As long as those reports are kept (an existing bureau rule, not changed here) | Lenders who pull a report with consent |

## Facts that may matter to the analysis

- **Data subjects.** The "agent" is software, but its operator is a legal person, and some operators may be natural persons. POPIA's definition of personal
  information includes juristic persons, which is unusual. The bureau separately has a policy to accept juristic operators only (`JURISTIC_OPERATORS_ONLY`), not yet
  switched on by default.
- **Minimisation.** Only counts leave custody. No amounts, counterparties or purposes.
- **Control by the operator.** Nothing flows unless the operator submits it. There is no standing feed and the bureau holds no credential for custody.
- **Accuracy.** The statement is signed by custody and bound to the agent's wallet, and a later statement may never lower lifetime counts, so a record cannot be improved by replacing it.
- **Where it sits.** The bureau and custody are both FORGE systems. Region and hosting are not yet decided (`af-south-1` or `eu-west-2`).
- **Not built yet.** A notice shown to the operator at the moment of submission; a console screen (today it is an API call made by FORGE staff or a script).

## Questions

1. **Consent.** Is the operator's act of submitting the statement, recorded with who and when, a valid consent under POPIA (voluntary, specific, informed)? What must the
   notice say at the point of submission, and should it be an explicit acknowledgement rather than an upload?
2. **Retention.** What retention is proportionate for an expired statement? Proposal: 30 days after expiry, so a lender dispute about a score has the underlying evidence;
   alternatively erase on expiry. And for a live statement: is "until expiry or withdrawal" enough?
3. **Withdrawal and reports already issued.** If consent is withdrawn after a lender pulled a report whose score used the statement, what must happen to that report, to the
   lender's copy, and to the bureau's stored copy of it? Today withdrawal affects future scores only.
4. **Disputes.** The bureau has a dispute process for scores. Does holding the underlying statement for disputes justify a longer retention than the figures alone?
5. **Credit regulation.** Does adding payment-behaviour data about an operator's agent to a credit score bring the bureau further into the National Credit Act's bureau regime,
   beyond the open question already put in `02-counsel-brief.md` (question 5)? Does it matter whether the operator is a company or a person?
6. **Notice to lenders.** Must a lender be told that a score uses operator-provided custody data, and which factors? The report already names the source (`custodySource`); is that enough?
7. **Cross-border.** If the bureau or custody runs outside South Africa, what is needed for the transfer?
8. **Information Officer and records.** Does this processing need to be listed in the records of processing and the PAIA manual (drafts exist under `docs/compliance/isms/privacy/` in the custody repo)?
9. **Automatic renewal.** If the operator wants statements renewed automatically instead of resubmitting every week, is a standing consent with a term (for example 12 months, revocable at any time) acceptable, and what must be shown to renew it?

## What counsel's answers change in the product

| Answer | Effect |
|---|---|
| Different retention | One setting: `CUSTODY_ATTESTATION_RETENTION_DAYS` |
| Explicit acknowledgement at submission | A required field and wording on the console screen; the bureau already records `submittedBy` and `consentRef` |
| Erasure of past reports on withdrawal | New work: the report store would need to mark or redact factors derived from a withdrawn statement |
| Standing consent with a term | New work: a consent record with an end date, and custody pushing fresh statements, which the bureau would accept only for agents with live standing consent |
