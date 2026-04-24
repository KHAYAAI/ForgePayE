# Shielded Payments — Security Audit Checklist

This document tracks the security review requirements for ForgePay's
Privacy-Preserving Merchant of Record (ZK-proof shielded payment) system.

**Current Status:** Pre-audit. All cryptographic components are STUBBED.
This document defines what must be audited before mainnet launch (Week 20-23 of the integration roadmap).

---

## Scope

The following components require external security review before production launch:

| Component | Location | Risk Level |
|-----------|----------|------------|
| Groth16 circuits | `crates/privacy-payment/` | CRITICAL |
| Solidity Groth16 verifier | `infra/contracts/Groth16Verifier.sol` | CRITICAL |
| NullifierRegistry contract | `infra/contracts/NullifierRegistry.sol` | CRITICAL |
| CommitmentTree contract | `infra/contracts/CommitmentTree.sol` | HIGH |
| Auditor ECDH + AES-GCM | `crates/auditor/src/lib.rs` | CRITICAL |
| Python FFI bindings | `services/mor-layer/src/auditor/` | HIGH |
| SDK encryptMemo | `packages/sdk-js/src/resources/shielded-checkout.ts` | HIGH |
| Chain sync service | `services/chain-sync/src/` | MEDIUM |

---

## 1. Groth16 Circuit Audit (External ZK Firm)

**Requirement:** Engage a ZK-specialized firm (e.g., Trail of Bits, Veridise, or Secure3) to audit the Groth16 circuits.

**Checklist:**
- [ ] Deposit circuit: `commitment = Poseidon(asset, amount, blind, owner_pk)` is binding and hiding
- [ ] Transfer circuit: input UTXO conservation (`Σ inputs = Σ outputs`) holds for all edge cases
- [ ] Withdraw circuit: nullifier `= Poseidon(commitment, secret_key)` is unlinkable across proofs
- [ ] No malleability: proof cannot be modified to produce different public inputs
- [ ] No knowledge extractor: proving key does not leak witness (amount, blind)
- [ ] Trusted setup: Powers of Tau ceremony is either used from Hermez/Zcash or conducted independently
- [ ] Constraint count matches expected circuit complexity (no missing constraints)

**Deliverable:** Audit report with severity ratings and remediation advice.

---

## 2. Solidity Verifier Audit (Smart Contract Firm)

**Requirement:** Audit `Groth16Verifier.sol` and `NullifierRegistry.sol`.

**Checklist:**
- [ ] `verifyProof` correctly implements BN254 pairing check (no shortcuts or bugs in elliptic curve ops)
- [ ] `NullifierRegistry.submitProof`: nullifier extraction from public inputs is correct
- [ ] Reentrancy: no state changes after external calls
- [ ] Access control: `freezeNullifier` is auditor-only; no privilege escalation
- [ ] Integer overflow/underflow: Solidity 0.8.x checked arithmetic
- [ ] Gas limit: `verifyProof` fits within block gas limit on all target chains
- [ ] CommitmentTree: root versioning cannot be manipulated to replay stale proofs
- [ ] Upgrade path: contracts are not upgradeable (intentional) — confirm immutability
- [ ] Deployment script: constructor arguments and ownership transfer are correct

**Deliverable:** Audit report + verified contract addresses on testnet.

---

## 3. Cryptographic Implementation Audit

**Requirement:** Review ECDH + AES-GCM implementation in `crates/auditor/src/lib.rs`.

**Checklist:**
- [ ] ECDH key agreement: uses BabyJubjub curve (correct for BN254 field compatibility)
- [ ] Shared secret derivation: `Poseidon(ECDH_output)` produces correct 32-byte key
- [ ] AES-256-GCM nonce: unique 96-bit nonce per encryption (never reused)
- [ ] Auth tag verification: decryption rejects tampered ciphertext
- [ ] Ephemeral key: fresh ephemeral keypair per encryption (never reused)
- [ ] Key derivation: `deriveSeed(email, password)` uses proper PBKDF2 (10k+ iterations, SHA-256)
- [ ] Side-channel resistance: no timing leaks in comparison operations

**Current state:** All cryptographic operations are STUBBED. When `auditable-privacy-payment` crate is integrated:
1. Replace stub `AuditorKeypair::from_seed()` with real BabyJubjub key derivation
2. Replace stub `decrypt_shielded_tx()` with real ECDH + AES-GCM
3. Replace stub `verify_audit_proof()` with real Groth16 verification

---

## 4. SDK Client-Side Audit

**Requirement:** Review browser-side proof generation in `packages/sdk-js/src/resources/`.

**Checklist:**
- [ ] `deriveSeed`: no password stored in memory after derivation
- [ ] `initProofGenerator`: WASM module loaded from trusted CDN (no supply chain attack)
- [ ] `encryptMemo`: ephemeral key not reused across calls
- [ ] `generateDepositProof`: blind factor is cryptographically random (not timestamp-based)
- [ ] No plaintext amount sent over network at any point
- [ ] Error messages don't leak sensitive data (amount, blind, seed)
- [ ] `isWasmAvailable` fallback: server-side proof generation shows clear warning to user

---

## 5. Auditor Key Management

**Requirement:** HSM integration and key rotation procedure review.

**Checklist:**
- [ ] Auditor secret key stored in HSM (AWS CloudHSM, GCP Cloud HSM, or equivalent)
- [ ] No plaintext secret key in environment variables or config files
- [ ] Key rotation procedure: `AuditorClient.rotate_keys()` tested end-to-end
- [ ] Key backup: HSM key backup procedure documented and tested
- [ ] Access control: only `mor-layer` service can call auditor decrypt endpoint
- [ ] Rate limiting: auditor decrypt endpoint rate-limited to prevent enumeration
- [ ] Audit logging: every decryption call is logged with timestamp, caller, and nullifier

---

## 6. End-to-End Penetration Test

**Requirement:** Full pentest of shielded payment flow before mainnet launch.

**Scope:**
- [ ] Double-spend attack: submit same nullifier twice via race condition
- [ ] Replay attack: reuse valid proof from different Merkle root
- [ ] Frozen nullifier bypass: attempt to spend frozen UTXO
- [ ] Proof malleability: modify proof bytes and check server rejects
- [ ] Memo tampering: flip bits in encrypted_memo and check auditor detects
- [ ] Nullifier enumeration: bruteforce nullifier space (should be infeasible)
- [ ] Side-channel timing: measure response times to detect nullifier presence
- [ ] SSRF via auditor URL: malicious `auditor_service_url` in config

---

## 7. Compliance Review

**Requirement:** Legal and compliance sign-off that the privacy model is consistent with applicable regulations (GDPR, CCPA, FATF Travel Rule).

**Questions to resolve with legal counsel:**
- [ ] Is encrypted amount storage sufficient for AML (anti-money laundering) compliance?
- [ ] Can auditor audit trail satisfy IRS / HMRC data retention requirements?
- [ ] Does FATF Travel Rule apply to shielded stablecoin transfers?
- [ ] GDPR: encrypted_memo contains personal data (amount) — is encryption sufficient for pseudonymization?
- [ ] CCPA: is nullifier a "personal identifier"?

---

## Audit Firms (Shortlist)

| Firm | Specialty | Est. Cost |
|------|-----------|-----------|
| Trail of Bits | ZK circuits + Solidity | $150k–$250k |
| Veridise | ZK formal verification | $100k–$200k |
| OpenZeppelin | Solidity contracts | $80k–$150k |
| Cure53 | Client-side JS/WASM | $50k–$80k |
| Kudelski Security | HSM + key management | $60k–$100k |

**Recommended engagement:** Trail of Bits for circuits + Solidity; Cure53 for SDK.

---

## Timeline

| Milestone | Target Week |
|-----------|-------------|
| Stub code complete (all phases) | Week 18 (now) |
| Engage audit firms | Week 18 |
| Audit kickoff | Week 19 |
| Preliminary findings | Week 21 |
| Remediation | Week 22 |
| Final audit sign-off | Week 23 |
| Testnet beta | Week 20 (parallel) |
| Production launch | Week 24 |

---

## Remediation Process

For each finding:
1. Severity Critical/High: block launch until fixed and re-audited
2. Severity Medium: fix before launch, verify with auditor
3. Severity Low/Informational: fix within 30 days of launch

All findings documented in GitHub Security Advisories (private until patched).
