# FORGE Agent Trust Integrations

Framework plugins that embed FORGE Agent Credit Bureau checks directly into
agent workflows — check the score before an action, enforce the decision,
record the outcome so the next score reflects it.

| Package | Framework | Use case |
|---|---|---|
| `@forge/langgraph` | LangGraph / LangChain | Score-gated tool execution — block tools when the agent's grade is below threshold |
| `@forge/crewai` | CrewAI | Trust-based task delegation — route high-value tasks to higher-graded agents |
| `@forge/n8n` | n8n | No-code nodes: Score Check, Record Outcome, Verify Agent |

All three call the FORGE Agent Credit Bureau REST API
(`agent-credit-bureau`, port 3018) rather than reading on-chain contracts:

- `GET  /v1/agents/:id/score` — **metered at $2.80 per inquiry**, like a traditional bureau pull
- `POST /v1/agents/:id/events` — record outcomes back into the Revenue Ontology-fed history
- `POST /v1/agents/:id/verify` — 8-check verification (VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED / SUSPICIOUS)

Scores are 0–1000 with AAA–D letter grades (see `GET /v1/grade-scale`).

## Provenance

The gate/delegation/node patterns are derived from the CREDITTIME (Qova)
integration packages (`@qova/langgraph`, `@qova/crewai`, `@qova/n8n`) by
Hausor Labs, MIT-licensed, pinned in
`forgepay/config/base/pinned-upstreams.yaml` under `agent-credit-scoring`.
The on-chain client (`@brnmwai/qova-core`, viem, Base/SKALE contracts) was
intentionally replaced with the FORGE bureau HTTP client — FORGE scores are
computed off the unified Revenue Ontology, not chain reads.
