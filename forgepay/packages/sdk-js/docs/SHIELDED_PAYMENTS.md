# Shielded Payments — Privacy-Preserving Checkout

ForgePay SDK enables **privacy-preserving payments** where merchants never see plaintext transaction amounts. This is achieved through client-side Groth16 zero-knowledge proof generation and ECDH + AES-GCM encryption.

## Overview

### The Problem

Traditional payment processors reveal all transaction details to the merchant:
- Merchant sees: amount, customer, currency, timestamp
- Public ledger sees: amount, merchant, timestamp
- This is great for compliance but terrible for privacy

### The Solution

ForgePay's Privacy-Preserving Merchant of Record (MoR) model:
1. **Client** generates ZK proof (browser-side, no network required)
2. **Client** encrypts amount (ECDH + AES-GCM to auditor's public key)
3. **Merchant** sees: encrypted memo + proof (no plaintext)
4. **Auditor** decrypts memo (only entity with secret key) to compute taxes
5. **Public ledger** sees: Groth16 proof verification event (no plaintext)

**Privacy guarantee:** Only the auditor (with decryption key) can see plaintext amounts for tax computation.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser (Client)                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  fp.proofs.generateDepositProof()                              │
│    ↓ Calls WASM (Groth16 proving circuit)                      │
│    → { proof, commitment, amount_cents }                        │
│                                                                 │
│  fp.shieldedCheckout.encryptMemo(memo, auditor_pk)             │
│    ↓ ECDH + AES-256-GCM encryption                             │
│    → encrypted_memo (auditor-only decryptable)                 │
│                                                                 │
│  fp.shieldedCheckout.create({                                  │
│    encrypted_memo,                                              │
│    audit_proof,                                                 │
│    customer_country,  ← for tax computation                     │
│  })                                                              │
│    ↓ HTTP POST to MoR layer                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ MoR Layer (Merchant Backend)                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  POST /v1/checkout/sessions/shielded                           │
│    1. Verify Groth16 proof ✓                                   │
│    2. Decrypt memo via AuditorClient                           │
│       → reveals amount to MoR only, NOT merchant               │
│    3. Compute tax on decrypted amount                          │
│    4. Create Hyperswitch payment intent (amount + tax)         │
│    5. Return checkout session                                  │
│       → NO PLAINTEXT to merchant (encrypted in memo)           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│ Auditor Service                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  When MoR needs to decrypt:                                    │
│    AuditorClient.decrypt_shielded_tx(encrypted_memo)           │
│      ↓ ECDH + AES-GCM decryption (secret key)                 │
│      → { asset, amount, owner_pk, nullifier, ... }            │
│                                                                 │
│  Only auditor can do this (secret key is hardware-protected)   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Usage

### 1. Initialize SDK

```typescript
import { ForgePay } from '@forgepay/sdk';

const fp = new ForgePay({
  apiKey: process.env.FORGEPAY_API_KEY,
  // Optional: endpoint: 'https://api.forgepay.io'
});
```

### 2. Derive ZK Keypair from Password

```typescript
// Derive a seed from user password (never sent to server)
const seed = await fp.proofs.deriveSeed(
  'user@example.com',
  'password123'
);

// Initialize proof generator (loads WASM in browser)
await fp.proofs.initProofGenerator(seed);
```

**Important:** The seed is computed locally and never leaves the browser. It can be cached in localStorage (encrypted) for faster initialization on subsequent payments.

### 3. Generate ZK Proof

```typescript
// Generate deposit proof (hide amount in commitment)
const deposit = await fp.proofs.generateDepositProof({
  asset: 0,              // 0=USDC, 1=USDT
  amountUsd: 49.99,
  blind: 'optional_blind_factor',  // random if omitted
});

console.log(deposit);
// {
//   proof: "base64_encoded_groth16_proof",
//   commitment: "0xdeadbeef...",  // Poseidon(asset, amount, blind, owner_pk)
//   amount: 4999,                 // cents
//   blind: "abc123..."
// }
```

### 4. Create Shielded Checkout

```typescript
// Encrypt the transaction memo
const memo = {
  asset: deposit.asset,
  amount: deposit.amount,
  commitment: deposit.commitment,
  // ... other fields
};

const encryptedMemo = await fp.shieldedCheckout.encryptMemo(
  memo,
  auditorPublicKey  // auditor's BabyJubjub public key
);

// Create checkout session (merchant never sees plaintext)
const session = await fp.shieldedCheckout.create({
  merchant_id: 'merch_123',
  customer_id: 'cus_456',
  encrypted_memo: encryptedMemo,
  audit_proof: deposit.proof,
  currency: 'USD',
  success_url: 'https://example.com/success',
  cancel_url: 'https://example.com/cancel',
  // Tax jurisdiction (decrypted amount + location → tax calculation)
  customer_country: 'US',
  customer_state: 'CA',
});

// Redirect to Hyperswitch hosted checkout
window.location.href = session.client_secret;
```

### 5. Handle Webhook (Server-Side)

```typescript
// Merchant webhook endpoint: POST /webhooks/forgepay
const event = ForgePay.webhooks.constructEvent(
  request.body,
  request.headers['forgepay-signature'],
  process.env.FORGEPAY_WEBHOOK_SECRET
);

if (event.type === 'shielded.payment.confirmed') {
  // Event: chain-sync detected nullifier spent on-chain
  // This proves the payment was actually confirmed (not just claimed)
  console.log(`Payment confirmed: ${event.data.nullifier}`);
  // Update order status, fulfil digital goods, etc.
}
```

## Privacy Model

### What Each Party Can See

| Party | Sees | Cannot See |
|-------|------|-----------|
| **Customer** | - | Proof, merchant's tax rate |
| **Merchant** | Encrypted memo, proof, tax (computed) | Plaintext amount, commitment, blind |
| **Auditor** | Everything (decrypts memo to compute tax) | - |
| **Public Ledger** | Nullifier, proof verification, Merkle root update | Plaintext amount, commitment, owner |
| **Tax Authority** | Audit trail (decrypted by auditor) | - |

### Threat Model

**What we prevent:**
- Merchant surveillance: can't infer customer behavior from amounts
- Public deanonymization: even with metadata, amount is hidden
- Data breach: stolen merchant DB doesn't leak payment amounts

**What remains:**
- Metadata correlation: IP, timestamp, email still visible (use VPN/Tor if needed)
- Proof linkage: if same user pays with different merchants, payments might be linkable (use fresh seed per merchant)

**Auditor trust:** Auditor holds the decryption key. If auditor is compromised, privacy is lost. Mitigations:
- Hardware security module (HSM) for key storage
- Key rotation annually
- Multiple auditors with threshold signatures

## Error Handling

```typescript
try {
  const session = await fp.shieldedCheckout.create({
    merchant_id: 'merch_123',
    encrypted_memo: memo,
    // ...
  });
} catch (err) {
  if (err instanceof fp.errors.InvalidRequestError) {
    // Proof verification failed or memo format invalid
    console.error('Invalid proof:', err.message);
  } else if (err instanceof fp.errors.AuthenticationError) {
    // API key invalid
    console.error('Auth failed:', err.message);
  }
}
```

## Best Practices

### 1. Seed Management

```typescript
// Bad: hardcode password in code
const seed = await fp.proofs.deriveSeed('email', 'hardcoded_password');

// Good: derive from user input or hardware wallet
const seed = await fp.proofs.deriveSeed(
  userEmail,
  userPassword  // obtained from input, never stored
);

// Better: cache in encrypted localStorage
localStorage.setItem('forgepay_seed_encrypted', encrypt(seed, masterKey));
```

### 2. Blind Factor

```typescript
// Bad: use deterministic blind
const proof = await fp.proofs.generateDepositProof({
  amountUsd: 49.99,
  blind: 'my_constant_blind',  // reveals pattern
});

// Good: use random blind (generated if omitted)
const proof = await fp.proofs.generateDepositProof({
  amountUsd: 49.99,
  // SDK generates random blind automatically
});
```

### 3. Idempotency

```typescript
// Always use idempotency key to prevent double charges
const checkout = await fp.shieldedCheckout.create({
  merchant_id: 'merch_123',
  encrypted_memo: memo,
  idempotency_key: `order_${orderId}_${new Date().getTime()}`,
  // ...
});
```

### 4. Handle Root Updates

```typescript
// When Merkle root updates on-chain, update in SDK
// Subscribe to chain-sync events
fp.webhooks.on('chain.merkle_root_updated', async (event) => {
  await fp.proofs.updateMerkleRoot(event.newRoot);
  console.log(`Merkle root updated: ${event.newRoot}`);
});
```

## Testing

### Unit Tests

```typescript
import { describe, it, expect } from 'vitest';
import { ForgePay } from '@forgepay/sdk';

describe('ProofsResource', () => {
  it('generates deposit proof', async () => {
    const fp = new ForgePay({ apiKey: 'test_key' });
    
    const seed = await fp.proofs.deriveSeed('test@example.com', 'password');
    await fp.proofs.initProofGenerator(seed);
    
    const proof = await fp.proofs.generateDepositProof({
      asset: 0,
      amountUsd: 49.99,
    });
    
    expect(proof.commitment).toBeDefined();
    expect(proof.proof).toBeDefined();
    expect(proof.amount).toBe(4999);
  });
});
```

### Integration Tests

```typescript
// Test with testnet contracts
const fp = new ForgePay({
  apiKey: 'test_key',
  endpoint: 'https://testnet.forgepay.io',
});

const session = await fp.shieldedCheckout.create({
  merchant_id: 'test_merch',
  encrypted_memo: '...',
  // ...
});

// Verify session created
expect(session.session_id).toMatch(/^cs_/);
expect(session.status).toBe('pending');
```

## FAQ

### Q: What if WASM is not available (old browser)?

The SDK falls back to server-side proof generation:
```typescript
const available = await fp.proofs.isWasmAvailable();
if (!available) {
  // Fallback: call /proofs/generate endpoint (proof generated on server)
  // WARNING: Server-side proof generation means plaintext sent to server
  const proof = await fp.proofs.generateDepositProof({ ... });
}
```

### Q: Can I reuse the same seed?

Yes, but not recommended. Using the same seed across multiple merchants creates a linkability: all payments are tied to the same nullifier family. Better to use a fresh seed per merchant or per session.

### Q: What happens if the Merkle root changes during proof generation?

The proof is generated against the root at the time of generation. If the root updates before submission, the proof becomes invalid (references stale root). The SDK will reject submission. Regenerate the proof with the new root.

### Q: Is the SDK open-source?

Yes, https://github.com/forgepay/sdk-js. The WASM module sources are in the `auditable-privacy-payment` repository (when integrated).

## See Also

- [API Reference](/docs/api)
- [Architecture](/docs/architecture)
- [Examples](/examples)
