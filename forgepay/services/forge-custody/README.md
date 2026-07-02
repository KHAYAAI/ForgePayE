# FORGE Custody

**FORGE Custody is OpenFireblocks integrated into the FORGE ecosystem** — an
institutional-grade digital-asset custody and signing platform. It is the
custody backbone of FORGE: every transfer above **$1M** is routed here by
FORGE Payments for policy evaluation, multi-party approval, and **4-of-7
threshold (MPC) signing**.

The core insight: traditional custody fails because one person with the master
key can steal everything. FORGE Custody splits the private key into 7
encrypted shares; **any 4 of the 7** must cooperate to produce a signature.
The full private key never exists anywhere — not at rest, not in memory.

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
4-of-7 threshold signing (MPC coordinator; shares in HashiCorp Vault)
      │
      ▼
Broadcast → 12-block confirmation
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

The actual multi-round MPC ceremony runs in the external coordinator (Go
service from the OpenFireblocks stack), configured via `MPC_COORDINATOR_URL`.
**In production this variable is required — the service refuses to boot
without it.** In dev/test, a `DevSigner` simulates share collection (4 share
contribution hashes recorded in `signing_shares`) and emits a deterministic
mock signature that is never valid on a real chain.

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
