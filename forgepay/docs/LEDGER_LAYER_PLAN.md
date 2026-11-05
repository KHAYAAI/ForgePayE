# Ledger layer under the Revenue Ontology (planned)

**Decided 5 November 2026: we will do this.** Not on the critical path for the bureau's first launch (wave 1); it starts after wave 1 is
proven in staging, except step 1, which is small and worth doing before any real data exists.

## Why

FORGE has an **event log**, not an **accounting ledger**. The Revenue Ontology (`unified-router`, table `forgepay_events`) records *what
happened* across products as canonical events with a JSON payload. It has no accounts, no balances and no double-entry rule, and nothing proves the
log was never altered. Every product that moves money (gateway, custody, treasury, bureau billing) would otherwise keep its own balances and
its own idea of what is correct. A credit record that can be shown to be unaltered and tied to balanced money movements is worth more.

[Formance Ledger](https://github.com/formancehq/ledger) (v3) is the reference design: postings between accounts, every transaction must
balance, overdrafts refused unless forced, each batch hash-chained to the last, and a `store check` that replays the log and reports any hash,
sequence or balance mismatch.

They solve different problems and fit together:

| | Formance Ledger v3 | FORGE Revenue Ontology (today) |
|---|---|---|
| Records | Postings: amount, asset, source account, destination account | Canonical events (`payment.succeeded`, `custody.signature.confirmed`, ...) with a JSON payload |
| Core job | Keep balances correct | One shared history across products |
| Balances | Per account and asset | None (`revenue_events` has `amount_usd_cents` and a product tag, no accounts) |
| Double-entry | Enforced; unbalanced batches rejected | Not a concept |
| Rules language | Numscript (splits, overdraft rules) | None |
| Storage | Own store (Pebble) replicated over Raft | Postgres `forgepay_events`; Redis for de-duplication |
| Integrity | Hash-chained batches; replay checker | HMAC-signed incoming webhooks (5-minute replay window), unique `source_event_id`, `ON CONFLICT DO NOTHING` |
| Idempotency | Hashed idempotency keys detect conflicting retries | Redis key (7-day TTL) plus a unique constraint |

## What was verified in the FORGE code (5 November)

- **"Append-only" is by convention only.** No trigger, rule or revoked privilege in the `unified-router` migrations stops an `UPDATE` or
  `DELETE` on `forgepay_events`. Documents saying history "cannot be edited" are true only because the code never edits it.
- **No hash chain.** Nothing can prove the log is unaltered. immudb is vendored, but only in the custody stack (`services/openfireblocks`); it
  is **not** connected to the event log.
- **No balance layer.** Products compute balances separately.
- **The credit bureau does not read this log today.** It scores from its own store (reported history) and its on-chain indexer. Linking a
  score line to a ledger entry is therefore future work, not a change to an existing flow.
- Migration `002` notes that `revenue_events` was never created before and some modules were not yet mounted.

## Licence gate (blocks reusing Formance code)

The current `formancehq/ledger` repository (cloned 5 November 2026, commit `685e786`) has **no licence file** and its README states no licence.
With no licence, the default is all rights reserved: **do not copy, vendor or run its code as part of a paid service** until Formance confirms
the terms in writing. Reusing **ideas** (hash chain, double-entry check, replay checker) needs no licence. The ForgePayE repository is a
Hyperswitch fork and its own licence terms apply to anything added here.

## Plan

1. **Enforce append-only in the database (small; before real data).** A migration that rejects `UPDATE`/`DELETE` on `forgepay_events` with a
   trigger, and an application role with `INSERT`/`SELECT` only. Until then, describe it as "never edited by the application", not "cannot be edited".
2. **Hash-chain the event log.** Each event stores the hash of the previous one (per stream), signed with the platform's Ed25519 key; a
   `verify` command replays the chain and reports any break. Publish periodic checkpoints (a signed head hash) so a lender can check a
   report against a known state.
3. **Add a balance ledger for money.** Either run Formance (if its licence allows) or build a minimal double-entry ledger in Postgres:
   accounts, postings, balances per asset, transactions rejected unless they balance, overdraft refused unless explicitly allowed.
   Gateway deposits, sweeps and payouts, custody transfers, and bureau billing each post a balanced transaction.
4. **Link the two.** Each money-moving ontology event carries the ledger transaction id; reconciliation checks that every such event has a
   balanced entry and every entry has its event.
5. **Feed the bureau from it.** Score lines that rest on money movements cite the event and ledger entry, so a report can show where each
   line came from.

Decision points before step 3: Formance's licence answer; whether to run a separate ledger service (more to operate) or keep it in Postgres
(less to operate, less proven).

## Status

| Step | State |
|---|---|
| Comparison and verification | Done (5 Nov 2026), from documentation and migration files; neither system was run |
| 1. Database-enforced append-only | Not started |
| 2. Hash chain and verifier | Not started |
| 3. Balance ledger | Not started; blocked on the licence answer if Formance code is to be used |
| 4. Link events to ledger entries | Not started |
| 5. Bureau cites ledger entries | Not started |
