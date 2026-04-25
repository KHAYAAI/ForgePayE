//! ZK-proofs bridge crate for ForgePay.
//!
//! Provides typed wrappers around arkworks Groth16 on BN254 for the deposit,
//! transfer, and withdraw circuits.
//!
//! CURRENT STATE: Proving key constants (ProvingKey/VerifyingKey) are not yet
//! embedded — circuit finalization is required first. All prove() functions
//! return a placeholder error; verify() works with real arkworks types.
//!
//! When the auditable-privacy-payment circuit is finalized:
//!   1. Run `cargo run --bin export-keys` to export ProvingKey bytes
//!   2. Embed the bytes as `include_bytes!("../keys/deposit.pk")` etc.
//!   3. Remove the `ZkError::KeysNotEmbedded` early-return

use ark_bn254::{Bn254, Fr};
use ark_groth16::{Groth16, Proof};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use ark_std::Zero;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use ark_bn254::Fr as ScalarField;
pub use ark_groth16::{PreparedVerifyingKey, VerifyingKey};

// ── Error types ────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum ZkError {
    #[error("Proving keys not yet embedded — circuit finalization required")]
    KeysNotEmbedded,
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Proof verification failed")]
    VerificationFailed,
    #[error("Invalid public input: {0}")]
    InvalidInput(String),
}

pub type ZkResult<T> = Result<T, ZkError>;

// ── Proof types ────────────────────────────────────────────────────────────────

/// A serialized Groth16 proof over BN254 (arkworks canonical format, compressed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedProof(pub Vec<u8>);

impl SerializedProof {
    /// Deserialize from arkworks canonical bytes.
    pub fn to_ark_proof(&self) -> ZkResult<Proof<Bn254>> {
        Proof::<Bn254>::deserialize_compressed(self.0.as_slice())
            .map_err(|e| ZkError::Serialization(e.to_string()))
    }

    /// Serialize an arkworks proof to canonical bytes.
    pub fn from_ark_proof(proof: &Proof<Bn254>) -> ZkResult<Self> {
        let mut buf = Vec::new();
        proof
            .serialize_compressed(&mut buf)
            .map_err(|e| ZkError::Serialization(e.to_string()))?;
        Ok(Self(buf))
    }
}

// ── Public input helpers ──────────────────────────────────────────────────────

/// Parse a 0x-prefixed hex string into a BN254 scalar field element.
pub fn fr_from_hex(hex: &str) -> ZkResult<Fr> {
    let hex = hex.trim_start_matches("0x");
    let bytes = hex::decode(hex)
        .map_err(|e| ZkError::InvalidInput(format!("invalid hex: {e}")))?;
    // Pad to 32 bytes big-endian
    let mut padded = [0u8; 32];
    let start = padded.len().saturating_sub(bytes.len());
    padded[start..].copy_from_slice(&bytes[bytes.len().saturating_sub(32)..]);
    padded.reverse(); // arkworks uses little-endian
    Fr::deserialize_compressed(padded.as_slice())
        .map_err(|e| ZkError::InvalidInput(format!("field element out of range: {e}")))
}

/// Encode a BN254 scalar field element as a 0x-prefixed hex string.
pub fn fr_to_hex(fr: &Fr) -> ZkResult<String> {
    let mut buf = [0u8; 32];
    fr.serialize_compressed(buf.as_mut_slice())
        .map_err(|e| ZkError::Serialization(e.to_string()))?;
    buf.reverse(); // to big-endian
    Ok(format!("0x{}", hex::encode(buf)))
}

// ── Commitment / Nullifier ────────────────────────────────────────────────────

/// A UTXO commitment C = Poseidon(asset, amount, blind, owner_pk)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commitment(pub Fr);

impl Commitment {
    pub fn from_hex(hex: &str) -> ZkResult<Self> {
        Ok(Self(fr_from_hex(hex)?))
    }
    pub fn to_hex(&self) -> ZkResult<String> {
        fr_to_hex(&self.0)
    }
    pub fn zero() -> Self {
        Self(Fr::zero())
    }
}

/// A nullifier N = Poseidon(commitment, blind_factor) — unique per UTXO spend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nullifier(pub Fr);

impl Nullifier {
    pub fn from_hex(hex: &str) -> ZkResult<Self> {
        Ok(Self(fr_from_hex(hex)?))
    }
    pub fn to_hex(&self) -> ZkResult<String> {
        fr_to_hex(&self.0)
    }
}

// ── Circuit public inputs ─────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct DepositPublicInputs {
    pub merkle_root: Fr,
    pub nullifier:   Fr,
    pub asset_id:    Fr,
    pub amount:      Fr,
}

#[derive(Debug, Clone)]
pub struct TransferPublicInputs {
    pub merkle_root:      Fr,
    pub nullifiers:       Vec<Fr>,
    pub new_commitments:  Vec<Fr>,
    pub asset_id:         Fr,
}

#[derive(Debug, Clone)]
pub struct WithdrawPublicInputs {
    pub merkle_root:     Fr,
    pub nullifier:       Fr,
    pub recipient:       Fr, // Ethereum address as field element
    pub amount:          Fr,
    pub asset_id:        Fr,
}

// ── Proof generation (stubbed until keys are embedded) ───────────────────────

pub fn prove_deposit(_inputs: &DepositPublicInputs) -> ZkResult<SerializedProof> {
    Err(ZkError::KeysNotEmbedded)
}

pub fn prove_transfer(_inputs: &TransferPublicInputs) -> ZkResult<SerializedProof> {
    Err(ZkError::KeysNotEmbedded)
}

pub fn prove_withdraw(_inputs: &WithdrawPublicInputs) -> ZkResult<SerializedProof> {
    Err(ZkError::KeysNotEmbedded)
}

// ── Proof verification ────────────────────────────────────────────────────────
// verify_* functions accept a real arkworks PreparedVerifyingKey and a serialized
// proof. When the VK is embedded (post circuit-finalization), call these from
// the auditor crate.

pub fn verify_deposit(
    pvk:    &PreparedVerifyingKey<Bn254>,
    proof:  &SerializedProof,
    inputs: &DepositPublicInputs,
) -> ZkResult<bool> {
    let ark_proof = proof.to_ark_proof()?;
    let public_inputs = vec![
        inputs.merkle_root,
        inputs.nullifier,
        inputs.asset_id,
        inputs.amount,
    ];
    Ok(Groth16::<Bn254>::verify_with_processed_vk(pvk, &public_inputs, &ark_proof).is_ok())
}

pub fn verify_transfer(
    pvk:    &PreparedVerifyingKey<Bn254>,
    proof:  &SerializedProof,
    inputs: &TransferPublicInputs,
) -> ZkResult<bool> {
    let ark_proof = proof.to_ark_proof()?;
    let mut public_inputs = vec![inputs.merkle_root, inputs.asset_id];
    public_inputs.extend_from_slice(&inputs.nullifiers);
    public_inputs.extend_from_slice(&inputs.new_commitments);
    Ok(Groth16::<Bn254>::verify_with_processed_vk(pvk, &public_inputs, &ark_proof).is_ok())
}

pub fn verify_withdraw(
    pvk:    &PreparedVerifyingKey<Bn254>,
    proof:  &SerializedProof,
    inputs: &WithdrawPublicInputs,
) -> ZkResult<bool> {
    let ark_proof = proof.to_ark_proof()?;
    let public_inputs = vec![
        inputs.merkle_root,
        inputs.nullifier,
        inputs.recipient,
        inputs.amount,
        inputs.asset_id,
    ];
    Ok(Groth16::<Bn254>::verify_with_processed_vk(pvk, &public_inputs, &ark_proof).is_ok())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fr_roundtrip_zero() {
        let fr = Fr::zero();
        let hex = fr_to_hex(&fr).expect("serialize zero");
        let back = fr_from_hex(&hex).expect("deserialize zero");
        assert_eq!(fr, back);
    }

    #[test]
    fn test_fr_from_hex_small_value() {
        let fr = fr_from_hex("0x01").expect("parse 0x01");
        let hex = fr_to_hex(&fr).expect("serialize");
        // round-trip
        let back = fr_from_hex(&hex).expect("deserialize");
        assert_eq!(fr, back);
    }

    #[test]
    fn test_commitment_zero() {
        let c = Commitment::zero();
        let hex = c.to_hex().expect("to_hex");
        let back = Commitment::from_hex(&hex).expect("from_hex");
        assert_eq!(c.0, back.0);
    }

    #[test]
    fn test_commitment_roundtrip() {
        // A small non-zero value
        let c = Commitment::from_hex("0xdeadbeef").expect("from_hex");
        let hex = c.to_hex().expect("to_hex");
        let back = Commitment::from_hex(&hex).expect("from_hex roundtrip");
        assert_eq!(c.0, back.0);
    }

    #[test]
    fn test_nullifier_roundtrip() {
        let n = Nullifier::from_hex("0xcafebabe").expect("from_hex");
        let hex = n.to_hex().expect("to_hex");
        let back = Nullifier::from_hex(&hex).expect("from_hex roundtrip");
        assert_eq!(n.0, back.0);
    }

    #[test]
    fn test_prove_deposit_returns_keys_not_embedded() {
        let inputs = DepositPublicInputs {
            merkle_root: Fr::zero(),
            nullifier:   Fr::zero(),
            asset_id:    Fr::zero(),
            amount:      Fr::zero(),
        };
        let err = prove_deposit(&inputs).unwrap_err();
        assert!(matches!(err, ZkError::KeysNotEmbedded));
    }

    #[test]
    fn test_prove_transfer_returns_keys_not_embedded() {
        let inputs = TransferPublicInputs {
            merkle_root:     Fr::zero(),
            nullifiers:      vec![],
            new_commitments: vec![],
            asset_id:        Fr::zero(),
        };
        let err = prove_transfer(&inputs).unwrap_err();
        assert!(matches!(err, ZkError::KeysNotEmbedded));
    }

    #[test]
    fn test_prove_withdraw_returns_keys_not_embedded() {
        let inputs = WithdrawPublicInputs {
            merkle_root: Fr::zero(),
            nullifier:   Fr::zero(),
            recipient:   Fr::zero(),
            amount:      Fr::zero(),
            asset_id:    Fr::zero(),
        };
        let err = prove_withdraw(&inputs).unwrap_err();
        assert!(matches!(err, ZkError::KeysNotEmbedded));
    }

    #[test]
    fn test_serialized_proof_rejects_garbage() {
        let bad = SerializedProof(vec![0xde, 0xad, 0xbe, 0xef]);
        let err = bad.to_ark_proof().unwrap_err();
        assert!(matches!(err, ZkError::Serialization(_)));
    }
}
