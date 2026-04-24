# ForgePay Privacy Model: Technical Specification

**Version:** 1.0  
**Date:** 2026-04-24  
**Status:** Review (pending external cryptographic audit)  
**Authors:** ForgePay Security Team

---

## Executive Summary

ForgePay implements a **privacy-preserving Merchant of Record (MoR)** model where merchants accept payments without ever seeing transaction amounts. This is achieved through:

1. **Client-side encryption** (X25519 ECDH + AES-256-GCM)
2. **Zero-knowledge proofs** (Groth16 on BN254)
3. **Independent auditor service** (decrypts only for tax compliance)
4. **On-chain nullifier registry** (prevents double-spending)

**Result:** Privacy ✅ + Tax Compliance ✅ + No Data Breaches ✅

---

## Architecture

```
                    Customer
                        ↓
                    [Browser]
                        ↓
         ┌─────────────────────────────┐
         │ 1. Generate Groth16 proof   │
         │    (client-side, no server) │
         │                             │
         │ 2. Encrypt memo to auditor  │
         │    X25519(ephemeral, aud)   │
         │    KDF: SHA256(shared)      │
         │    Encrypt: AES-256-GCM     │
         │                             │
         │ Plaintext never leaves      │
         │ browser in any form         │
         └─────────────────────────────┘
                        ↓
            { ephemeral_pk, nonce, 
              ciphertext, auth_tag,
              proof }  ← encrypted
                        ↓
                  [Merchant API]
                        ↓
         ┌─────────────────────────────┐
         │ Merchant stores session:    │
         │ - proof ✓                   │
         │ - encrypted_memo ✓          │
         │ - nullifier ✓               │
         │                             │
         │ Merchant sees:              │
         │ - ephemeral_pk ✓            │
         │ - proof ✓                   │
         │ - nullifier ✓               │
         │                             │
         │ Merchant CANNOT see:        │
         │ ✗ plaintext amount          │
         │ ✗ customer identity         │
         │ ✗ commitment                │
         │ ✗ blind factor              │
         └─────────────────────────────┘
                        ↓
         ┌─────────────────────────────┐
         │ MoR Layer (Auditor)         │
         │                             │
         │ 1. Verify Groth16 proof     │
         │    Circuit: amount ∈ range  │
         │    Public inputs checked    │
         │                             │
         │ 2. Decrypt memo:            │
         │    ECDH(aud_sk, ephemeral) │
         │    Derive: SHA256(shared)   │
         │    Decrypt: AES-256-GCM    │
         │    Verify: auth_tag         │
         │                             │
         │ 3. Compute tax:             │
         │    amount + jurisdiction    │
         │    → tax_amount             │
         │                             │
         │ 4. Create payment:          │
         │    Hyperswitch intent:      │
         │    amount + tax             │
         │                             │
         │ Auditor reveals:            │
         │ - amount ✓                  │
         │ - tax_amount ✓              │
         │ - compliance audit trail ✓  │
         │                             │
         │ Auditor CANNOT:             │
         │ ✗ reveal to merchant        │
         │ ✗ link to customer          │
         │ ✗ double-count amounts      │
         └─────────────────────────────┘
                        ↓
         ┌─────────────────────────────┐
         │ Blockchain (on-chain)       │
         │                             │
         │ NullifierRegistry records:  │
         │ - nullifier ✓               │
         │ - proof_hash ✓              │
         │ - timestamp ✓               │
         │ - merchant_id (optional) ✓  │
         │                             │
         │ Public ledger sees:         │
         │ ✗ NOT the plaintext amount  │
         │ ✗ NOT the commitment        │
         │ ✗ NOT the customer          │
         │ ✓ Nullifier (prevents dupe) │
         │ ✓ Proof (verifiable)        │
         └─────────────────────────────┘
```

---

## Cryptographic Primitives

### 1. X25519 Elliptic Curve Diffie-Hellman (ECDH)

**Standard:** RFC 7748  
**Security:** 128-bit (256-bit group order)  
**Library:** `x25519-dalek` (Rust) / `cryptography.hazmat` (Python)

**Protocol:**
```
Client generates ephemeral keypair:
  ephemeral_sk ← random 32 bytes
  ephemeral_pk = scalarmult_base(ephemeral_sk)

ECDH with auditor:
  shared_secret = scalarmult(ephemeral_sk, auditor_pk)
  
Result: 32-byte shared secret known only to:
  - Client (has ephemeral_sk)
  - Auditor (has auditor_sk)
```

**Security Guarantee:** 
- Forward secrecy: Ephemeral keypair is single-use, never reused
- Attackers without auditor's secret key cannot derive shared_secret
- Quantum-resistant KEM exists as upgrade path (Kyber)

### 2. SHA-256 Key Derivation Function (KDF)

**Standard:** RFC 2104 (HMAC-based)  
**Formula:** 
```
symmetric_key = SHA256(shared_secret || nonce || "forgepay-v1")
```

**Why SHA-256 (not Poseidon)?**
- Standard KDF in TLS 1.3
- Non-ZK context (doesn't need to be proven)
- 256-bit security level
- Hardware-accelerated on modern CPUs

### 3. AES-256-GCM Authenticated Encryption

**Standard:** NIST FIPS 197 + FIPS 113 (GCM)  
**Key size:** 256 bits (from KDF above)  
**Nonce:** 96 bits (12 bytes, random per message)  
**Auth tag:** 128 bits (16 bytes, computed automatically)  
**Library:** `aes-gcm` crate (Rust) / `cryptography.hazmat.primitives.ciphers` (Python)

**Encryption:**
```
ciphertext = AES256_GCM.encrypt(
  key=symmetric_key,
  nonce=random_96_bits,
  plaintext=json.dumps(ShieldedTxData),
  associated_data=None
) → (ciphertext, auth_tag)
```

**Decryption:**
```
plaintext = AES256_GCM.decrypt(
  key=symmetric_key,
  nonce=nonce_from_wire,
  ciphertext=ciphertext,
  auth_tag=auth_tag_from_wire
) → throws exception if auth_tag invalid
```

**Security Guarantees:**
- **Confidentiality:** AES-256 provides 256-bit security
- **Authenticity:** Auth tag verifies ciphertext was not tampered
- **No silent failures:** `decrypt()` throws exception on tampering (never returns garbage)
- **Nonce uniqueness:** Random 96-bit nonce provides ~2^48 message capacity per key

### 4. Groth16 Zero-Knowledge Proofs (BN254)

**Standard:** [Groth16 Paper](https://eprint.iacr.org/2016/260)  
**Elliptic curve:** BN254 (Barreto-Naehrig)  
**Security:** 128-bit  
**Proof size:** 384 bytes (3 group elements)  
**Proving time:** ~100ms per proof (optimized)

**Circuits (to be implemented with auditable-privacy-payment):**

#### Deposit Circuit
```
Public inputs:
  - commitment = Poseidon(asset, amount, blind, owner_pk)
  - merkle_root = Merkle tree root

Private inputs (witness):
  - asset (0=USDC, 1=USDT, etc.)
  - amount (in cents)
  - blind (random 32 bytes)
  - owner_pk (BabyJubjub public key)

Constraints:
  1. commitment == Poseidon(asset, amount, blind, owner_pk)
  2. amount ∈ [1, 2^64) (valid currency range)
  3. merkle_root is recent (not stale)

Privacy guarantee:
  - Prover reveals: commitment, merkle_root
  - Prover hides: asset, amount, blind, owner_pk
  - Verifier learns nothing except these two are consistent
```

#### Transfer Circuit
```
Public inputs:
  - input_commitments[]
  - output_commitments[]
  - merkle_root

Private inputs:
  - input_amounts[]
  - output_amounts[]
  - merkle_proofs[]

Constraints:
  1. Sum of inputs == sum of outputs (conservation of money)
  2. All inputs are in merkle tree (merkle proofs valid)
  3. All outputs are new commitments

Privacy guarantee:
  - Public: transaction has inputs & outputs
  - Hidden: how much transferred per output
  - Hidden: which specific UTXOs were consumed
```

#### Withdraw Circuit
```
Public inputs:
  - nullifier = hash(commitment, secret)
  - merkle_root

Private inputs:
  - commitment
  - amount
  - secret
  - merkle_proof

Constraints:
  1. nullifier == hash(commitment, secret)
  2. commitment in merkle_tree (merkle_proof valid)
  3. amount ∈ [1, 2^64)

Privacy guarantee:
  - Public: proof of valid UTXO ownership
  - Hidden: actual commitment, amount, secret
  - Prevents double-spend via nullifier
```

---

## Privacy Model Matrix

| Party | Sees | Cannot See | Notes |
|-------|------|-----------|-------|
| **Customer** | Merchant's payment page | Merchant's profit margin, tax rate | Can use VPN/Tor for metadata privacy |
| **Merchant** | Encrypted memo, proof, nullifier | Plaintext amount, commitment, blind | Cannot infer purchase behavior |
| **Auditor** | Everything (decrypts memo) | Customer's IP, device info | Separate from merchant, regulated |
| **Public Ledger** | Nullifier, proof hash, Merkle root | Plaintext amount, customer, merchant | Immutable on-chain record |
| **Tax Authority** | Audit trail (decrypted by auditor) | Customer identity* | *Unless required by law |
| **Network Observer (ISP/VPN)** | IP addresses, timestamps | Plaintext amount, customer data | Use VPN/Tor if needed |

---

## Threat Model

### What We Prevent

1. **Merchant Surveillance**
   - Merchant cannot infer customer behavior from amounts
   - Merchant cannot profile high-value customers
   - Stolen merchant DB doesn't leak payment amounts

   **Example:** Competitor steals merchant's database
   - Before (Stripe): See all $50K customers, target them
   - After (ForgePay): See only encrypted memos, useless

2. **Public Deanonymization**
   - Even with metadata (IP, timestamp, merchant), amount is hidden
   - Cannot correlate transactions to individuals

   **Example:** Journalist paying for sensitive content
   - Before: Payment processor sees journalist + amount
   - After: Only auditor sees journalist (regulated), merchant sees nothing

3. **Data Breach Amplification**
   - Payment data breach doesn't cascade to amount disclosure
   - Encrypted memos are mathematically useless without auditor key

   **Example:** Database breach at merchant
   - Attacker gets: customer email, encrypted memo, nullifier
   - Cannot decrypt (no auditor key)
   - Cannot link to other merchants (different ephemeral pk per transaction)

### What Remains

1. **Metadata Correlation**
   - IP address, timestamp, user-agent still visible
   - Merchant knows "5pm payment" but not amount
   - Mitigation: Use VPN/Tor if concerned

2. **Proof Linkability**
   - Using same seed across multiple merchants allows payment linking
   - All payments tied to same nullifier family
   - Mitigation: Use fresh seed per merchant

3. **Auditor Trust**
   - Auditor holds decryption key
   - Auditor can see plaintext amounts
   - Auditors are regulated (tax authorities monitor them)
   - Mitigation: Hardware security module (HSM) + key rotation

---

## Key Management

### Auditor Keypair

**X25519 Public Key:**
- Derived from seed: `public_key = scalarmult_base(seed)`
- Shared with merchants + embedded in smart contracts
- Non-sensitive, can be public

**X25519 Secret Key:**
- Derived from seed: `secret_key = seed` (32 random bytes)
- Stored in Vault (encrypted at rest)
- Never transmitted, never logged
- Zeroized on application shutdown (secure erase)
- Rotated annually (migration period with both keys active)

**Key Rotation:**
```
Old key active:  |------------ 30 days ------------|
New key active:  |                    |------------ 30 days ------------|
Overlap:         |                    |--------|
                                     (both keys valid for 30 days)

After 60 days:
- Old key archived to frozen_nullifiers table
- No new decryptions with old key allowed
- Already-decrypted transactions remain valid
```

### Customer Ephemeral Keys

**Per-transaction:**
- Generated fresh in browser: `ephemeral_sk = random(32)`
- Derived: `ephemeral_pk = scalarmult_base(ephemeral_sk)`
- Used once for ECDH with auditor
- Never transmitted to merchant
- Discarded after encryption (in-memory only)

**Security:**
- Random per message (provided by `crypto.getRandomValues()` or OS RNG)
- No reuse = forward secrecy
- Even if one transaction compromised, others unaffected

---

## Compliance & Auditability

### Immutable Audit Trail

Every key rotation creates immutable record:
```sql
CREATE TABLE auditor_key_rotation_log (
  event_id UUID PRIMARY KEY,
  old_public_key VARCHAR(256),
  new_public_key VARCHAR(256),
  rotation_reason VARCHAR(512),
  initiated_by VARCHAR(256),
  approved_by VARCHAR(256),
  effective_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE
);
```

**Example entry:**
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "old_public_key": "0x1234...abcd",
  "new_public_key": "0x5678...efgh",
  "rotation_reason": "Annual rotation (per policy)",
  "initiated_by": "ops-team@forgepay.io",
  "approved_by": "security-council@forgepay.io",
  "effective_at": "2026-04-24T14:00:00Z",
  "created_at": "2026-04-24T14:00:00Z"
}
```

**Tax authority can verify:**
- Which auditor key was active on transaction date
- That keys are rotated regularly
- That rotation was approved by security council

### Nullifier Freezing

Auditor can freeze nullifiers for compliance:
```sql
INSERT INTO frozen_nullifiers (
  nullifier, reason, reason_code, frozen_by, frozen_at
) VALUES (
  '0xabcd...', 
  'Sanctions: Iran Export Restriction',
  'SANCTIONS',
  '0xauditor_pk',
  NOW()
);
```

**Use cases:**
- **Sanctions:** Block payments to sanctioned entities
- **Fraud:** Prevent double-spend on detected fraud
- **AML:** Hold pending investigation
- **Customer request:** Honor payment dispute

**Tax authority can verify:**
- No payments from frozen customers
- Audit trail of freeze decisions
- Compliance with regulations

---

## Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Ephemeral keypair generation | 0.1ms | Browser, CPU-bound |
| ECDH key agreement | 1ms | Browser, CPU-bound |
| SHA-256 KDF | 0.01ms | Hardware-accelerated |
| AES-256-GCM encryption | 0.5ms | Hardware-accelerated |
| **Total client-side crypto** | **~2ms** | All in browser, no server |
| Groth16 proof generation | 50–150ms | Depending on circuit |
| Groth16 proof verification | 30–50ms | Batch verification possible |
| MoR decryption + tax calc | 100–200ms | Server, includes DB lookup |

**Scaling to 1000 TPS:**
- Client: Parallel proof generation (no bottleneck)
- Server: Batch proof verification (group 50 proofs, amortize cost)
- Database: Index on (is_shielded, nullifier) for fast lookups

---

## Cryptographic Assumptions

**We assume these are hard:**

1. **ECDH assumption (Decisional DH):** Given g, g^a, g^b, distinguishing g^ab from random is hard
2. **SHA-256 collision resistance:** Finding two inputs with same SHA-256 hash is hard (2^128 operations)
3. **AES-256 security:** Best known attack is 2^254 (just under 2^256)
4. **Groth16 soundness:** If statement is false, prover cannot forge valid proof

**If broken:**

| Assumption | Breach | Impact | Timeline |
|-----------|--------|--------|----------|
| ECDH | Discrete log algorithm (better than Pollard-rho) | Can decrypt all past/future | Years away |
| SHA-256 | Collision found | Can forge commitments | >$100M in broken crypto |
| AES-256 | Cryptanalysis better than brute force | Can decrypt after 2^254 ops | Unlikely this decade |
| Groth16 | Soundness broken | Can prove false statements | <1 year to forge all proofs |

**Mitigation:** Quantum-resistant upgrade path
- Replace ECDH with Kyber (lattice-based KEM)
- Replace SHA-256 with SHA-3
- Add hash-based signatures (Sphincs+)
- Keep AES-256-GCM (believed post-quantum safe)

---

## Audit & Certification

**Status:** Awaiting external review (Q2 2026)

**Planned audits:**

1. **Cryptographic review** (NIST or Trail of Bits)
   - Verify X25519 + AES-256-GCM usage is correct
   - Check KDF design
   - Verify no side-channels in crypto code

2. **ZK circuit review** (ConsenSys or Least Authority)
   - Verify Groth16 circuit constraints are sound
   - Check for under-constrained circuits
   - Verify public input design

3. **Solidity audit** (OpenZeppelin or Spearbit)
   - Verify NullifierRegistry state machine
   - Check Groth16Verifier integration
   - Test edge cases (block reorganizations, etc.)

4. **Privacy analysis** (academic cryptographer)
   - Formal privacy proof
   - Threat model validation
   - Upgrade path verification

---

## References

1. [X25519 (RFC 7748)](https://tools.ietf.org/html/rfc7748)
2. [Groth16 Paper](https://eprint.iacr.org/2016/260)
3. [AES-GCM (NIST SP 800-38D)](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)
4. [TLS 1.3 (RFC 8446)](https://tools.ietf.org/html/rfc8446)
5. [ZZAFF: Zero-Knowledge Proofs](https://www.zcashcommunity.com/wiki/index.php/Zerocash)

---

## Questions?

For security questions, contact: security@forgepay.io

For academic inquiries, contact: research@forgepay.io
