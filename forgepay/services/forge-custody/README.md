# FORGE Custody

**FORGE Custody is OpenFireblocks integrated into the FORGE ecosystem** — an
institutional-grade digital-asset custody and signing platform. It is the
custody backbone of FORGE: transfers above **$1M** are routed here for policy
evaluation, multi-party approval, and signing.

The intended design: traditional custody fails because one person with the
master key can steal everything, so the private key is split into 7 encrypted
shares and any 4 must cooperate to produce a signature — the full key never
existing anywhere, at rest or in memory.

> ### ⚠️ Threshold signing is not implemented yet
>
> **Neither signing path performs 4-of-7 threshold signing today.** This section
> previously described the target design as though it were shipped; it is not.
>
> | Path | What it actually does |
> |---|---|
> | `DevSigner` (`src/signer.ts`) | Returns `0xdev<hash>` — not a valid signature on any chain. Fabricates `sharesUsed` by slicing holder names. Throws if `NODE_ENV=production`. |
> | `MpcCoordinatorSigner` (`src/signer.ts`) | The production path. Calls `${MPC_COORDINATOR_URL}/sign` — but the coordinator (`openfireblocks/services/mpc-signer`) signs every transaction with **one shared Vault-backed ECDSA key**, and returns a single share contribution. |
>
> A genuine k-of-n threshold ECDSA implementation exists at
> `openfireblocks/services/mpc-signer/tss/tss.go` (bnb-chain/tss-lib, key never
> reconstructed), but it is gated behind `//go:build tss`, has no importers, and
> routes its parties as in-process goroutines with no authenticated transport.
> It proves the cryptography; it is not wired to anything.
>
> Reaching real threshold signing requires per-party process and host isolation
> with authenticated transport, per-share Vault paths, a per-customer DKG
> ceremony, and wiring `tss` into the coordinator's `/sign` handler. Note that
> the security property depends on the parties sitting in **separate failure
> domains** — running all N on one operator's infrastructure yields the
> complexity of MPC with none of its benefit.
>
> **Do not custody real customer assets on this service until that work lands.**
> See `forgepay/PLATFORM_READINESS.md` for the sequencing.

**What is production-grade today:** the policy engine (whitelists, daily limits,
time windows, chain allow-lists, and approval thresholds that correctly
distinguish *blocking* from *requiring approval*), HMAC request signing with
replay protection, and the hash-linked audit log.

## Pipeline

```
POST /api/v1/sign
      │
      ▼
Policy engine ──✗──▶ rejected (reason code)
      │  daily limit · whitelist · time window · chain · sanctions
      ▼
Approval gate (amounts ≥ threshold need N distinct-role approvals, e.g. CFO+CEO)
      │
      ▼
Signing via MPC coordinator  ⚠️ single shared Vault key today, not 4-of-7
      │
      ▼
Broadcast  ⚠️ simulated without BLOCKCHAIN_RPC_URL (refused in production);
           confirmation is assumed, not polled
      │
      ▼
`custody.signature.confirmed` → Revenue Ontology (HMAC-signed webhook)
```

## API

Authentication: every request carries `X-API-Key`, `X-Timestamp` (unix
seconds, ±5 min replay window) and `X-Signature` =
`HMAC-SHA256(rawApiKey, "METHOD\nPATH\nTIMESTAMP\nBODY")`. Comparisons are
timing-safe; API keys are stored as sha256 hashes only.

### Sign a transaction

```
POST /api/v1/sign
{
  "customer_id": "cust_123",
  "key_id": "key_settlement_eth",
  "blockchain": "ethereum",
  "amount_usd": 5000000,
  "transaction": {
    "to": "0xbridge...",
    "data": "0x...",
    "value": "5000000000000000000",
    "gas": "100000",
    "gasPrice": "50000000000"
  },
  "metadata": {
    "forge_payment_id": "pay_xyz",
    "forge_merchant_id": "merch_123"
  }
}
```

Response (policy-clean, no approval needed):

```
{
  "signing_id": "sr_abc123",
  "status": "confirmed",
  "tx_hash": "0x7f3a2b...",
  "confirmation_time": "2026-07-02T14:47:00Z",
  "block_number": 18573482
}
```

Threshold-hit requests return `status: "pending_approval"`; each approver then
calls `POST /api/v1/signing/:id/approve` with `{approver_id, approver_role}`.
Distinct approvers **and** distinct roles are enforced. The final approval
triggers signing automatically.

### Other endpoints

| Route | Purpose |
|---|---|
| `POST /api/v1/workspaces` | Bootstrap a workspace + first API key (internal/operator route) |
| `POST /api/v1/policies` / `GET` | Manage the policy engine rules |
| `POST /api/v1/keys` | Register threshold-key metadata (shares live in Vault — only `vault_path` is stored) |
| `POST /api/v1/ceremonies` | Record a DKG ceremony (participants + Feldman VSS commitment hashes) |
| `GET /api/v1/signing/:id` | Signing request status |
| `GET /api/v1/audit` | Append-only audit trail for the workspace |
| `GET /api/health`, `GET /metrics` | Health & Prometheus metrics |

## Signing status flow

`pending_policy → pending_approval → approved → signing → broadcast →
confirmed` (terminal: `rejected`, `failed`).

## MPC boundary

Signing is delegated to the external coordinator (Go service from the
OpenFireblocks stack), configured via `MPC_COORDINATOR_URL`. **In production
this variable is required — the service refuses to boot without it.**

⚠️ The coordinator does **not** currently run a multi-round MPC ceremony: it
signs with a single shared Vault-backed key and returns one share contribution
(see the warning at the top of this file).

In dev/test a `DevSigner` writes 4 fabricated share-contribution hashes into
`signing_shares` — derived by slicing holder names, not by any cryptography —
and emits a deterministic mock signature that is never valid on a real chain.
Those rows look like a 4-of-7 ceremony in the audit trail but record nothing
that happened; treat `signing_shares` as meaningful only once real threshold
signing lands.

## Storage

Schema `forge_custody` in the shared Postgres: `workspaces`, `api_keys`,
`policies`, `keys`, `ceremonies`, `signing_requests`, `signing_approvals`,
`signing_shares`, and append-only `audit_log` (the code has no UPDATE/DELETE
path for audit rows). The in-memory store is the source of truth for a
running instance with best-effort persistence, matching the other ForgePay
TypeScript services.

## Development

```bash
npm install
npm run dev        # tsx watch, port 3019
npm test           # vitest — runs fully in-memory
npm run type-check
```

## Environment

See `.env.example`. Production boot requires `WEBHOOK_SECRET`,
`MPC_COORDINATOR_URL`, and `DATABASE_URL`.

## Upstream alignment (KHAYAAI/openfireblocks)

FORGE Custody is the FORGE-integrated rename of **OpenFireblocks**. The
upstream repo is a polyglot monorepo; this service implements the FORGE-facing
API and policy surface with clean boundaries where the upstream components
plug in:

| OpenFireblocks component | FORGE Custody boundary |
|---|---|
| `services/api-gateway` (NestJS — auth, tenancy, `/sign`, `/settlements`) | This service's REST API (workspaces = tenants) |
| `services/policy-service` (Go + OPA/Rego, **fail-closed**) | `src/policy.ts` — same rule set; swap in OPA via HTTP when deployed |
| `services/mpc-signer` + `tss/` (Go, Binance TSS-Lib k-of-n) | `MPC_COORDINATOR_URL` adapter (`MpcCoordinatorSigner`) |
| `services/temporal-worker` (durable policy→sign→broadcast→monitor) | `executeSigning()` pipeline — move onto Temporal for production durability |
| immudb cryptographic audit ledger | `audit_log` table (append-only) — mirror into immudb at integration |
| HashiCorp Vault key storage | `vault_path` references (no key material in Postgres) |

**Honest status carried over from upstream:** OpenFireblocks Phase 1 signs
with a **single shared key** — the threshold-ECDSA MPC core is proven in
`services/mpc-signer/tss` (`make test-tss`) but per-customer distributed
ceremonies are Phase 2. Upstream is explicitly **not yet audited for customer
funds**. FORGE launch gate: custody may settle **testnet/pilot volumes only**
until Phase 2 MPC is distributed and an external cryptographic review + pen
test have passed (see upstream `docs/security/audit-checklist.md`).
