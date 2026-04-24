# Shielded Payments Security Audit Checklist

**Status:** Pre-audit — not yet reviewed by external firms  
**Target audit window:** Weeks 20–23  
**Required for mainnet:** All items in "BLOCKING" sections must be ✅

---

## ZK Firm Audit (Groth16 Circuits + Cryptographic Primitives)

Engage: Trail of Bits, Least Authority, or ZKProof.org-vetted firm

### BLOCKING: Zero-Knowledge Proof Correctness

- [ ] **Deposit circuit soundness** — Prove: no double-deposit for same UTXO
- [ ] **Transfer circuit completeness** — Prove: valid inputs always generate valid proofs
- [ ] **Withdraw circuit correctness** — Prove: cannot withdraw more than deposited
- [ ] **Nullifier uniqueness** — Prove: nullifier = Poseidon(commitment, sk) is unique per UTXO+spender
- [ ] **Merkle proof verification** — Prove: transfer circuit correctly verifies Merkle membership
- [ ] **Commitment binding** — Prove: commitment = Poseidon(asset, amount, blind, owner_pk) is collision-resistant
- [ ] **Zero-knowledge property** — Prove: verifier learns only (nullifier, merkle_root) — not amount or owner

### BLOCKING: Trusted Setup

- [ ] **Groth16 proving key security** — Confirm no toxic waste retained after ceremony
- [ ] **Powers of Tau ceremony** — Use existing audited ceremony (Hermez, or Zcash Sapling)
- [ ] **Circuit-specific phase 2** — Audit the phase 2 MPC ceremony output
- [ ] **Verification key integrity** — Confirm vk matches circuit exactly

### BLOCKING: Cryptographic Primitives

- [ ] **Poseidon hash parameters** — Confirm BN254-compatible parameters (t=3, RF=8, RP=57)
- [ ] **BabyJubjub key generation** — Confirm rejection sampling is implemented (not modular reduction)
- [ ] **ECDH shared secret derivation** — Confirm Poseidon KDF applied, not raw shared secret
- [ ] **AES-256-GCM nonce reuse** — Confirm random nonce per message (no counter mode)
- [ ] **X25519 key validation** — Confirm low-order point checks on incoming ephemeral keys

### Advisory: Performance

- [ ] Proof generation time in browser (target: < 3 seconds on mid-range device)
- [ ] Proof generation in Node.js (target: < 500ms server-side)
- [ ] WASM binary size (target: < 5 MB compressed)

---

## Solidity Firm Audit (Smart Contracts)

Engage: OpenZeppelin, Consensys Diligence, or Spearbit

### BLOCKING: NullifierRegistry.sol

- [ ] **Reentrancy** — `submitProof` modifies state before external calls (CEI pattern)
- [ ] **Access control** — Only `auditor` address can call `freezeNullifier`
- [ ] **Owner privilege** — `transferOwnership` uses two-step pattern (no single-tx takeover)
- [ ] **Nullifier collision** — `bytes32` key space is sufficient (Poseidon output ≤ BN254 field)
- [ ] **Proof bypass** — Confirm `submitProof` always calls verifier (no skip path)
- [ ] **Gas limit DoS** — No unbounded loops; single nullifier per transaction
- [ ] **Freeze reversion** — Frozen UTXO cannot be accidentally unfrozen by non-auditor

### BLOCKING: CommitmentTree.sol

- [ ] **Root staleness** — `ROOT_HISTORY_SIZE=30` is adequate for proof generation latency
- [ ] **Updater access** — Only authorized updater can call `updateRoot`
- [ ] **Overflow** — `version` counter cannot wrap around in practice
- [ ] **Initial root** — Zero root is correctly handled (no false Merkle membership)
- [ ] **Root forgery** — Updater cannot set arbitrary roots without off-chain verification

### BLOCKING: Groth16Verifier.sol

- [ ] **BN254 pairing math** — Confirm pairing operations are correct (no shortcuts)
- [ ] **Public input encoding** — Confirm public inputs match circuit's output format exactly
- [ ] **Malleability** — Proof cannot be mutated to verify against different public inputs
- [ ] **Stub replacement** — Confirm stub is REPLACED with real verifier before mainnet

### Advisory: Gas Optimization

- [ ] `submitProof` gas estimate (target: < 200k gas)
- [ ] `isSpent` view gas (target: < 5k gas)
- [ ] `updateRoot` gas (target: < 50k gas)

---

## End-to-End Privacy Audit

### BLOCKING

- [ ] **Merchant DB audit** — Confirm no plaintext amounts in checkout_sessions table
- [ ] **MoR layer audit** — Confirm decrypted amount never logged or stored beyond memory
- [ ] **API response audit** — Confirm plaintext amount never returned in API responses
- [ ] **Webhook audit** — Confirm shielded.payment.confirmed webhook contains nullifier only (not amount)
- [ ] **Audit trail** — Confirm audit_timestamp + nullifier stored (for legal hold), not amount
- [ ] **Key management** — Confirm auditor secret key loaded from Vault, never in env vars

### BLOCKING: Python Auditor Decryption

- [ ] **X25519 low-order points** — Confirm `cryptography` library rejects low-order ephemeral keys
- [ ] **GCM tag verification** — Confirm `AESGCM.decrypt` raises on authentication failure
- [ ] **JSON parsing safety** — Confirm no arbitrary code execution on malformed memo
- [ ] **Memory clearing** — Confirm plaintext is not retained in Python objects after tax computation

### Advisory

- [ ] SDK encryptMemo browser test (Chrome, Firefox, Safari)
- [ ] SDK X25519 key format compatibility with Rust (32-byte raw, not DER/PEM)
- [ ] WASM module CSP headers (Content-Security-Policy: wasm-unsafe-eval)

---

## Penetration Test

Engage: Internal red team or external pen testers

- [ ] **Double-spend attempt** — Submit same proof twice; second must revert
- [ ] **Replay attack** — Reuse proof from different transaction; must revert
- [ ] **Proof forgery** — Submit invalid proof bytes; must revert with ProofVerificationFailed
- [ ] **Nullifier stuffing** — Attempt to pre-occupy nullifier space; confirm registry handles
- [ ] **Memo tampering** — Flip bit in ciphertext; AES-GCM must reject
- [ ] **Key confusion** — Encrypt to wrong auditor key; decryption must fail
- [ ] **SQL injection** — Malformed nullifier in checkout request; must be sanitized
- [ ] **Chain reorg** — Simulate chain reorg; chain-sync must detect and reconcile

---

## Audit Deliverables Required Before Mainnet

1. **ZK firm report** — Finding severity classification, risk ratings, recommendations
2. **Solidity firm report** — Same format
3. **Remediation verification** — Both firms confirm all BLOCKING findings fixed
4. **SECURITY_AUDIT_SIGN_OFF.md** — Sign-off file with `SIGNED_OFF: YES` (required by deploy-mainnet.ts)
5. **Proof of trusted setup** — SHA-256 of proving key posted to public URL
6. **Key ceremony transcript** — MPC ceremony log (for transparency)

---

## Timeline

| Week | Activity |
|------|----------|
| 18   | Engage ZK firm + Solidity firm, share code |
| 19   | Audit in progress |
| 20   | Testnet deployment; continue audit |
| 21   | Receive preliminary findings; start remediation |
| 22   | Remediation complete; re-audit of fixed items |
| 23   | Sign-off received; SECURITY_AUDIT_SIGN_OFF.md committed |
| 24   | Mainnet deployment (requires sign-off file) |

---

*Last updated: 2026-04-24*
