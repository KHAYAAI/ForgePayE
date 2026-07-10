# Runbook: Crypto Gateway Incident Response

## Service: crypto-gateway (port 8030)

Accepts BTC/ETH/LTC/XMR via a per-invoice deposit-address model. A chain
monitor watches for the expected amount to arrive and reach confirmation
depth, then emits `crypto.payment.confirmed` to unified-router.

### Symptom: Invoice created but payment never confirms despite funds arriving on-chain

**Cause:** Chain monitor lag, wrong confirmation-depth threshold for the
coin, or (for XMR specifically) the Monero RPC node being unreachable —
Monero's stealth-address model means the monitor depends entirely on the
RPC node's view of incoming transfers; if that node falls behind or
drops, XMR invoices silently never confirm while BTC/ETH/LTC continue
working fine.

**Resolution:**
1. `GET /invoices/{id}` — check `status` and `confirmations` fields
   directly.
2. Compare confirmation count against the block explorer for that coin
   independently (mempool.space for BTC, etherscan for ETH, an LTC/XMR
   equivalent) to rule out "monitor is fine, blockchain itself is just
   slow" (large network congestion happens).
3. For XMR: check the Monero RPC node's own sync status separately from
   this service — a stalled/desynced node is invisible from this
   service's own health checks.
4. If confirmations are genuinely sufficient on-chain but the invoice
   still shows pending: check service logs for the chain-monitor loop —
   it may have crashed or stalled without exiting the process.

### Symptom: HD wallet derives the same address for two different invoices

**Cause:** `nextKeyIndex()` race condition — if two invoice-creation
requests land concurrently and the key-index counter isn't atomically
incremented (e.g. read-then-write instead of an atomic DB increment),
both can read the same index before either writes back the increment.

**Resolution:**
1. This is a **security-critical** bug class if it occurs — two invoices
   sharing a deposit address means a payment to one could be mistaken for
   payment to the other. Treat any confirmed report of this as a P1.
2. Check `src/lib/hdwallet.ts`'s `nextKeyIndex()` implementation uses a
   single atomic DB statement (e.g. `UPDATE ... SET counter = counter + 1
   RETURNING counter`), not a separate read followed by a separate write.
3. If confirmed, immediately audit all invoices created in the affected
   time window for address collisions before any further processing.

### Symptom: `/metrics` unreachable from Prometheus

**Cause:** Same fleet-wide pattern as other services — this app serves
`/metrics` on its single main port (8030), not a separate port. If
Prometheus scrape configs or the Helm ServiceMonitor ever get pointed at
a different port number, scraping silently fails with connection refused
rather than an obvious error.

**Resolution:** Confirm the ServiceMonitor's `endpoints[].port` targets
the `http` named port, not a `metrics` port — this service (like every
other in the fleet) has no second listener.
