# Runbook: Stablecoin Gateway Incident Response

## Service: stablecoin-gateway (port 8020)

Accepts USDC/USDT on Ethereum, Polygon, Base, Arbitrum, and Solana via a
per-deposit-address model, plus the x402 micropayment protocol for AI
agent API access. Also hosts the (feature-flagged) shielded-payments
routes.

### Symptom: Deposit never confirms despite the Transfer event being visible on-chain

**Cause:** Chain monitor (`lib/monitor.ts`) lag, wrong RPC endpoint for
one of the 5 chains, or a confirmation-depth mismatch (Solana's
finality model is different enough from EVM chains' that a shared
"N confirmations" constant across all 5 chains can be wrong for Solana
specifically).

**Resolution:**
1. `GET /deposits/{id}` — check `status`/`confirmations`.
2. Verify the RPC endpoint for that specific chain is healthy
   independently (a single bad RPC provider for e.g. Base shouldn't take
   down monitoring for Ethereum/Polygon/Arbitrum/Solana — if it does,
   the monitor loops aren't properly isolated per chain).

### Symptom: x402 payment-required flow returns `valid: false` for a genuinely-paid receipt

**Cause:** `GET /x402/verify/:receipt_id` checks against
`x402_payments` — a receipt created but not yet confirmed on-chain (or a
receipt ID typo/mismatch from the resource server) both present this way
identically to a genuinely invalid payment. Distinguish before escalating.

**Resolution:**
1. `SELECT * FROM x402_payments WHERE receipt_id = '<id>'` — confirm the
   row exists and check its actual on-chain confirmation status.
2. If the row doesn't exist at all: the resource server likely has a
   receipt-ID mismatch bug on its own side, not this service.

### Symptom: `/shielded-deposits` or `/x402/shielded-pay` returning 404

**This is very likely correct, not a bug.** Shielded payments are
feature-flagged off by default (`SHIELDED_PAYMENTS_ENABLED`) precisely
because the underlying Groth16 proof verifier returns `true`
unconditionally whenever the on-chain `NullifierRegistry` contract isn't
deployed — i.e. accepting *any* proof as valid, including forged ones.
Before ever flipping this flag on in production:

1. Confirm `NullifierRegistry` is genuinely deployed (non-zero address)
   on every one of the 4 configured chains — check
   `assertShieldedPaymentsSafeToBoot()` in `src/lib/proof-verifier.ts`,
   which is supposed to refuse to start in production if this isn't true.
2. If someone reports this flag is on in production, verify that startup
   assertion is actually what let it boot (i.e. the registries really are
   deployed) rather than the assertion itself having been bypassed or
   disabled.

### Symptom: `/metrics` unreachable from Prometheus

Same as every other service in the fleet — served on the single main
port (8020). Confirm the ServiceMonitor targets the `http` named port.
