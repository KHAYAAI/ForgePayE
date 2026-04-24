# Shielded Stablecoin Gateway

This document describes the **privacy-preserving stablecoin payment layer** built into ForgePay's stablecoin-gateway service. It enables merchants to accept USDC/USDT without ever learning the plaintext transaction amount.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Customer (Browser)                                                   │
│                                                                      │
│  fp.proofs.generateDepositProof({ amountUsd: 49.99 })               │
│    → { proof, commitment, nullifier, blind }                         │
│                                                                      │
│  fp.shieldedCheckout.encryptMemo(memo, auditorPublicKey)             │
│    → encrypted_memo (ECDH + AES-256-GCM)                            │
│                                                                      │
│  POST /shielded-deposits {                                           │
│    merchant_id, encrypted_memo, proof_bytes, nullifier, chain, token │
│  }                                                                   │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────────┐
│ Stablecoin Gateway (this service)                                    │
│                                                                      │
│  1. Check nullifier not already spent (DB lookup)                   │
│  2. Verify Groth16 proof → STUB (TODO: NullifierRegistry.sol)       │
│  3. Forward encrypted_memo to MoR auditor → decrypt amount          │
│  4. Store shielded deposit (NO plaintext amount saved)              │
│  5. Return { id, nullifier, status: 'pending' }                     │
│                                                                      │
│  shielded-monitor.ts (background):                                  │
│    Polls NullifierRegistry for PaymentConfirmed events              │
│    → marks deposit confirmed, forwards webhook to merchant          │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────────┐
│ MoR Auditor (mor-layer service)                                      │
│                                                                      │
│  AuditorClient.decrypt_shielded_tx(encrypted_memo)                  │
│    → { asset, amount, owner_pk, nullifier }                         │
│  compute_tax_on_shielded(client, memo, jurisdiction)                │
│    → TaxBreakdown (amount stays in MoR; never forwarded to merchant) │
└──────────────────────────────────────────────────────────────────────┘
```

## Privacy Model

### What Each Party Sees

| Party | Can See | Cannot See |
|-------|---------|-----------|
| **Customer** | Their own amount, proof, blind factor | Merchant's tax rate, fee breakdown |
| **Merchant** | Deposit ID, nullifier, chain, token, status | Plaintext amount, commitment, blind |
| **MoR / Auditor** | Everything (decrypts memo for tax calculation) | Nothing hidden from auditor |
| **Public Ledger** | Nullifier spent event, Merkle root update | Amount, commitment, owner identity |
| **Tax Authority** | Audit trail (via auditor service export) | Real-time transaction stream |

### Why Merchants Cannot Infer the Amount

The `shielded_deposits` table deliberately has **no `amount_usd` or `amount_units` column**. The encrypted memo is stored but is unreadable without the auditor's ECDH secret key. The only data the merchant sees:

```sql
SELECT id, nullifier, chain, token, status, tx_hash, created_at, confirmed_at
  FROM shielded_deposits WHERE merchant_id = $1;
```

No amount anywhere in the row.

## Threat Model

### What We Prevent

- **Merchant data breach**: A stolen merchant DB contains no payment amounts — only nullifiers and encrypted blobs.
- **Insider threat**: Merchant employees cannot enumerate customer spending from DB or logs.
- **On-chain deanonymization**: The public sees only a nullifier being spent — no amount, no counterparty.
- **Double-spending**: Nullifier uniqueness is enforced at DB level (`UNIQUE` constraint) and will be enforced on-chain via `NullifierRegistry.sol`.

### What Remains Visible

- **Metadata**: IP address, timestamp, merchant ID, and token type are visible. Use VPN/Tor for network privacy.
- **Proof linkage**: The same seed used across multiple merchants creates linkable payment patterns. Use a fresh seed per merchant (see SDK documentation).
- **Auditor**: The auditor (with the ECDH secret key) can decrypt all transaction amounts. The auditor key must be kept in a Hardware Security Module (HSM).

### Auditor Trust Assumptions

- The auditor secret key is stored in an HSM (AWS CloudHSM or similar).
- Keys are rotated annually via `AuditorClient.rotate_keys()`.
- Access to the auditor service requires mTLS client certificates.
- The auditor logs all decryption events for transparency (auditable audit trail).

## API Endpoints

### POST /shielded-deposits

Create a shielded USDC/USDT deposit.

**Request:**
```json
{
  "merchant_id":    "merch_123",
  "encrypted_memo": "<base64 ECDH+AES-GCM encrypted>",
  "proof_bytes":    "<base64 Groth16 deposit proof>",
  "nullifier":      "0xdeadbeef...64-hex-chars",
  "chain":          "base",
  "token":          "USDC",
  "metadata": { "order_id": "order_001" }
}
```

**Response (201):**
```json
{
  "id":          "uuid",
  "chain":       "base",
  "token":       "USDC",
  "nullifier":   "0xdeadbeef...",
  "status":      "pending",
  "expires_at":  "2026-04-25T12:00:00Z",
  "message":     "Shielded deposit created. Amount hidden. Waiting for on-chain confirmation."
}
```

Note: No `amount_usd` in the response — this is intentional.

**Error Responses:**
- `409 NullifierAlreadySpent` — double-spend attempt
- `422 ProofVerificationFailed` — Groth16 proof invalid
- `502 AuditorUnavailable` — auditor service unreachable

### GET /shielded-deposits/:id

Retrieve deposit status by ID.

### GET /shielded-deposits?merchant_id=merch_123

List deposits for a merchant. Returns only: `id, nullifier, chain, token, status, tx_hash, created_at, confirmed_at`. No amounts.

### x402-shielded Micropayments (AI Agents)

For autonomous AI agents that need to pay for API access without revealing amounts:

```
GET /x402/shielded-payment-required?resource=https://api.example.com/data
→ 402 { scheme: "x402-shielded", shielded: { auditor_public_key, contract_address } }

POST /x402/shielded-pay
  { resource_url, merchant_id, encrypted_memo, proof_bytes, nullifier, agent_id? }
→ 201 { receipt_id, nullifier, status: "pending" }

GET /x402/shielded-verify/:receipt_id
→ { valid: true/false, shielded: true }
```

## Webhook Events

| Event | Description |
|-------|-------------|
| `shielded.deposit.created` | Deposit record created and proof verified |
| `shielded.payment.confirmed` | Nullifier spent on-chain (payment irreversible) |
| `shielded.deposit.expired` | Deposit window closed without on-chain confirmation |
| `shielded.nullifier.frozen` | Auditor compliance freeze (sanctions/fraud) |

None of these events include plaintext amounts.

## Integration Status

| Component | Status |
|-----------|--------|
| Route scaffolding | ✅ Complete |
| DB schema | ✅ Complete |
| Event types | ✅ Complete |
| Helm config | ✅ Complete |
| Groth16 proof verification | ⚠️ STUB — integrate `NullifierRegistry.sol` |
| ECDH memo decryption | ⚠️ STUB — integrate `auditable-privacy-payment` |
| On-chain event monitoring | ⚠️ STUB — activate after contract deployment |

To activate shielded payments in production:
1. Deploy `NullifierRegistry.sol` to each chain
2. Set contract addresses in Helm values (or env vars)
3. Set `SHIELDED_ENABLED=true`
4. Deploy auditor service with HSM-backed keys
5. Run the DB migration: `001_add_shielded_deposits.sql`

## See Also

- [SDK Shielded Payments Guide](/packages/sdk-js/docs/SHIELDED_PAYMENTS.md)
- [MoR Auditor Service](/services/mor-layer/src/auditor/__init__.py)
- [On-Chain Contracts](/infra/contracts/)
- [Security Audit](/docs/security/shielded-payments-audit.md)
