//! WASM Bindings for Privacy-Preserving Payments
//!
//! ARCH: Allows JavaScript/TypeScript applications to generate Groth16 ZK proofs
//! in the browser without sending plaintext to servers.
//!
//! Client-side proof generation flow:
//!   1. Browser calls ProofGenerator.fromSeed(seed_hex)
//!   2. ProofGenerator.generateDepositProof(asset, amount, blind) → Promise<Proof>
//!      Generates Groth16 proof that amount is hidden (commitment = Poseidon(...))
//!   3. ProofGenerator.generateTransferProof(inputs, outputs, merkleProofs)
//!      Proves UTXO balance conservation without revealing amounts
//!   4. Proof is sent to backend (encrypted memo + proof) for on-chain verification
//!
//! CURRENT STATE: **STUBBED FOR TESTING** — all proof generation returns dummy proofs.
//! Replace with real arkworks Groth16 when auditable-privacy-payment is production-ready.
//!
//! TODO: Implement actual BabyJubjub keypair generation, Poseidon hashing, Groth16 proving.

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

// Silence console_error_panic hook warning in development
#[cfg(feature = "console_error_panic_hook")]
fn set_panic_hook() {
    #[cfg(target_arch = "wasm32")]
    console_error_panic_hook::set_once();
}

// ── Types ──────────────────────────────────────────────────────────────────

/// Field element (Fr in BN254), serialized as hex string for JavaScript
#[wasm_bindgen]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Fr(String);

#[wasm_bindgen]
impl Fr {
    /// Create a field element from a hex string
    #[wasm_bindgen(constructor)]
    pub fn from_hex(hex: &str) -> Fr {
        Fr(hex.to_string())
    }

    /// Get the hex representation
    pub fn to_hex(&self) -> String {
        self.0.clone()
    }
}

/// A commitment to a payment (Poseidon hash of asset, amount, blind, owner)
#[wasm_bindgen]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Commitment(String);

#[wasm_bindgen]
impl Commitment {
    /// Create from hex string
    #[wasm_bindgen(constructor)]
    pub fn from_hex(hex: &str) -> Commitment {
        Commitment(hex.to_string())
    }

    pub fn to_hex(&self) -> String {
        self.0.clone()
    }
}

/// A nullifier (unique per UTXO + spender), prevents double-spending
#[wasm_bindgen]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Nullifier(String);

#[wasm_bindgen]
impl Nullifier {
    #[wasm_bindgen(constructor)]
    pub fn from_hex(hex: &str) -> Nullifier {
        Nullifier(hex.to_string())
    }

    pub fn to_hex(&self) -> String {
        self.0.clone()
    }
}

/// Groth16 proof (serialized as JSON)
#[wasm_bindgen]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Proof {
    /// Serialized proof data (in real implementation: pi_a, pi_b, pi_c on BN254)
    pub data: String,
    /// Public inputs (Merkle root, nullifiers, commitments, amounts)
    pub public_inputs: Vec<JsValue>,
}

#[wasm_bindgen]
impl Proof {
    /// Create a stub proof for testing
    #[wasm_bindgen(constructor)]
    pub fn stub(label: &str) -> Proof {
        Proof {
            data: format!("STUB_PROOF_{}", label),
            public_inputs: vec![],
        }
    }

    pub fn to_json(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(self).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

// ── Proof Generator ────────────────────────────────────────────────────────

/// Client-side proof generator — generates Groth16 proofs in the browser
/// without revealing plaintext to any server.
#[wasm_bindgen]
pub struct ProofGenerator {
    /// Auditor's BabyJubjub keypair (loaded from seed)
    keypair_seed: String,
    /// Merkle tree root (for merkle membership proofs)
    merkle_root: String,
}

#[wasm_bindgen]
impl ProofGenerator {
    /// Initialize proof generator from a seed.
    ///
    /// In production:
    ///   - Seed comes from user's hardware wallet or password-derived key
    ///   - Never send seed to server
    ///   - Seed should be at least 32 bytes (64 hex chars)
    ///
    /// STUB: Returns deterministic keys based on seed.
    /// TODO: Implement actual BabyJubjub keypair generation.
    #[wasm_bindgen]
    pub fn from_seed(seed_hex: &str) -> Result<ProofGenerator, JsValue> {
        #[cfg(feature = "console_error_panic_hook")]
        set_panic_hook();

        if seed_hex.len() < 64 {
            return Err(JsValue::from_str("seed must be at least 64 hex characters"));
        }

        web_sys::console::warn_1(&"⚠️  STUB: ProofGenerator.from_seed — returning deterministic keys. Real BabyJubjub generation not integrated.".into());

        Ok(ProofGenerator {
            keypair_seed: seed_hex.to_string(),
            merkle_root: "0x0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        })
    }

    /// Generate a deposit proof.
    ///
    /// Proves: commitment = Poseidon(asset, amount, blind, owner_pk)
    /// without revealing asset, amount, or blind.
    ///
    /// STUB: Returns dummy proof with commitment as public input.
    /// TODO: Implement real Groth16 deposit circuit.
    #[wasm_bindgen]
    pub async fn generate_deposit_proof(
        &self,
        asset: u32,
        amount_str: &str,
        blind_hex: &str,
    ) -> Result<Proof, JsValue> {
        web_sys::console::warn_1(&"⚠️  STUB: generateDepositProof — returning dummy proof. Real Groth16 logic not integrated.".into());

        // STUB: Deterministic commitment based on inputs
        let commitment_hex = format!(
            "0xdeadbeef{}{}{}",
            &asset.to_string()[..4.min(asset.to_string().len())],
            &amount_str[..8.min(amount_str.len())],
            &blind_hex[2..10.min(blind_hex.len())]
        );

        Ok(Proof {
            data: format!("STUB_DEPOSIT_PROOF_{}", commitment_hex),
            public_inputs: vec![JsValue::from_str(&commitment_hex)],
        })
    }

    /// Generate a transfer proof.
    ///
    /// Proves (without revealing amounts):
    ///   - Each input UTXO exists in Merkle tree (merkle membership proof)
    ///   - Know secret key for each input (keypair validation)
    ///   - Total input amount = total output amount (balance conservation)
    ///   - Output commitments correctly formed
    ///
    /// Inputs: array of { commitment, merkleProof, nullifier }
    /// Outputs: array of { asset, amount, blind }
    ///
    /// STUB: Returns dummy proof with input/output commitment hashes.
    /// TODO: Implement real UTXO transfer circuit.
    #[wasm_bindgen]
    pub async fn generate_transfer_proof(
        &self,
        inputs: JsValue,
        outputs: JsValue,
        merkle_proofs: JsValue,
    ) -> Result<Proof, JsValue> {
        web_sys::console::warn_1(&"⚠️  STUB: generateTransferProof — returning dummy proof. Real UTXO circuit not integrated.".into());

        // STUB: Simple proof with merkle root as public input
        Ok(Proof {
            data: format!("STUB_TRANSFER_PROOF_{}in_{}out", 1, 2),
            public_inputs: vec![JsValue::from_str(&self.merkle_root)],
        })
    }

    /// Generate a withdrawal proof.
    ///
    /// Proves knowledge of the secret key for a UTXO without revealing
    /// the original commitment.
    ///
    /// STUB: Returns dummy proof.
    /// TODO: Implement real withdrawal circuit.
    #[wasm_bindgen]
    pub async fn generate_withdraw_proof(
        &self,
        commitment_hex: &str,
        amount_str: &str,
    ) -> Result<Proof, JsValue> {
        web_sys::console::warn_1(&"⚠️  STUB: generateWithdrawProof — returning dummy proof. Real Groth16 logic not integrated.".into());

        Ok(Proof {
            data: format!("STUB_WITHDRAW_PROOF_{}_{}", commitment_hex, amount_str),
            public_inputs: vec![JsValue::from_str(&self.merkle_root)],
        })
    }

    /// Set the Merkle tree root (used as public input in proofs).
    /// Call this whenever the root updates on-chain.
    #[wasm_bindgen]
    pub fn set_merkle_root(&mut self, root_hex: &str) {
        self.merkle_root = root_hex.to_string();
    }

    /// Get the current Merkle root.
    #[wasm_bindgen]
    pub fn get_merkle_root(&self) -> String {
        self.merkle_root.clone()
    }

    /// Get the public key derived from the seed.
    /// Safe to share with the merchant / server.
    #[wasm_bindgen]
    pub fn get_public_key(&self) -> String {
        format!("AUDITOR_PK_{}", &self.keypair_seed[..16])
    }
}

// ── Initialization ─────────────────────────────────────────────────────────

#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    #[cfg(target_arch = "wasm32")]
    wasm_logger::init(wasm_logger::Config::new(log::Level::Warn));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fr_from_hex() {
        let fr = Fr::from_hex("deadbeef");
        assert_eq!(fr.to_hex(), "deadbeef");
    }

    #[test]
    fn test_commitment_creation() {
        let c = Commitment::from_hex("abc123");
        assert_eq!(c.to_hex(), "abc123");
    }

    #[test]
    fn test_proof_stub() {
        let proof = Proof::stub("test_op");
        assert!(proof.data.contains("STUB_PROOF_test_op"));
    }
}
