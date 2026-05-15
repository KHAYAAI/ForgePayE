//! Integration tests for the ZK proof module.
//!
//! Tests the MiMC-based circuits end-to-end: constraint generation,
//! satisfaction checks, and the native hash helpers.

use ark_bn254::Fr;
use ark_ff::UniformRand;
use ark_relations::r1cs::{ConstraintSystem, ConstraintSynthesizer};
use ark_std::test_rng;

use zk_proofs::circuits::deposit::DepositCircuit;
use zk_proofs::circuits::transfer::TransferCircuit;
use zk_proofs::circuits::withdraw::WithdrawCircuit;
use zk_proofs::mimc::{commitment, mimc_hash, nullifier, round_constants, MIMC_ROUNDS};
use zk_proofs::{Commitment, Nullifier, ZkError, fr_from_hex, fr_to_hex};

// ── MiMC native hash ─────────────────────────────────────────────────────────

#[test]
fn test_mimc_round_constants_count() {
    let constants = round_constants();
    assert_eq!(constants.len(), MIMC_ROUNDS);
}

#[test]
fn test_mimc_hash_deterministic() {
    let mut rng = test_rng();
    let a = Fr::rand(&mut rng);
    let b = Fr::rand(&mut rng);
    assert_eq!(mimc_hash(a, b), mimc_hash(a, b));
}

#[test]
fn test_mimc_hash_different_inputs_differ() {
    let mut rng = test_rng();
    let a = Fr::rand(&mut rng);
    let b = Fr::rand(&mut rng);
    let c = Fr::rand(&mut rng);
    assert_ne!(mimc_hash(a, b), mimc_hash(a, c));
}

#[test]
fn test_commitment_helper() {
    let mut rng = test_rng();
    let amount = Fr::rand(&mut rng);
    let blind  = Fr::rand(&mut rng);
    // commitment(a, b) == mimc_hash(a, b)
    assert_eq!(commitment(amount, blind), mimc_hash(amount, blind));
}

#[test]
fn test_nullifier_helper() {
    let mut rng = test_rng();
    let secret = Fr::rand(&mut rng);
    let leaf   = Fr::rand(&mut rng);
    assert_eq!(nullifier(secret, leaf), mimc_hash(secret, leaf));
}

// ── Deposit circuit ───────────────────────────────────────────────────────────

#[test]
fn test_deposit_circuit_satisfied_with_valid_inputs() {
    let mut rng = test_rng();
    let amount = Fr::rand(&mut rng);
    let blind  = Fr::rand(&mut rng);
    let asset  = Fr::rand(&mut rng);
    let circuit = DepositCircuit::new(amount, blind, asset);

    let cs = ConstraintSystem::<Fr>::new_ref();
    circuit.generate_constraints(cs.clone()).unwrap();
    assert!(cs.is_satisfied().unwrap());
    // 220 constraints from MiMC + auxiliary from FpVar allocation/equality
    assert!(cs.num_constraints() > 200);
}

#[test]
fn test_deposit_circuit_unsatisfied_with_wrong_commitment() {
    let mut rng = test_rng();
    let amount  = Fr::rand(&mut rng);
    let blind   = Fr::rand(&mut rng);
    let asset   = Fr::rand(&mut rng);
    let mut circuit = DepositCircuit::new(amount, blind, asset);
    circuit.commitment = Fr::rand(&mut rng); // tamper

    let cs = ConstraintSystem::<Fr>::new_ref();
    circuit.generate_constraints(cs.clone()).unwrap();
    assert!(!cs.is_satisfied().unwrap());
}

// ── Transfer circuit ──────────────────────────────────────────────────────────

#[test]
fn test_transfer_circuit_satisfied_with_valid_inputs() {
    let mut rng = test_rng();
    let secret = Fr::rand(&mut rng);
    let leaf   = Fr::rand(&mut rng);
    let circuit = TransferCircuit::new(secret, leaf);

    let cs = ConstraintSystem::<Fr>::new_ref();
    circuit.generate_constraints(cs.clone()).unwrap();
    assert!(cs.is_satisfied().unwrap());
    // Three MiMC calls = 660+ constraints
    assert!(cs.num_constraints() > 600);
}

// ── Withdraw circuit ──────────────────────────────────────────────────────────

#[test]
fn test_withdraw_circuit_satisfied_with_valid_inputs() {
    let mut rng = test_rng();
    let secret = Fr::rand(&mut rng);
    let leaf   = Fr::rand(&mut rng);
    let amount = Fr::from(1_000_000u64);
    let circuit = WithdrawCircuit::new(secret, leaf, amount);

    let cs = ConstraintSystem::<Fr>::new_ref();
    circuit.generate_constraints(cs.clone()).unwrap();
    assert!(cs.is_satisfied().unwrap());
}

// ── lib.rs public API ─────────────────────────────────────────────────────────

#[test]
fn test_fr_roundtrip_zero() {
    let fr  = Fr::from(0u64);
    let hex = fr_to_hex(&fr).unwrap();
    let back = fr_from_hex(&hex).unwrap();
    assert_eq!(fr, back);
}

#[test]
fn test_fr_from_hex_small_value() {
    let fr   = fr_from_hex("0x01").unwrap();
    let hex  = fr_to_hex(&fr).unwrap();
    let back = fr_from_hex(&hex).unwrap();
    assert_eq!(fr, back);
}

#[test]
fn test_commitment_hex_roundtrip() {
    let c    = Commitment::from_hex("0xdeadbeef").unwrap();
    let hex  = c.to_hex().unwrap();
    let back = Commitment::from_hex(&hex).unwrap();
    assert_eq!(c.0, back.0);
}

#[test]
fn test_nullifier_hex_roundtrip() {
    let n    = Nullifier::from_hex("0xcafebabe").unwrap();
    let hex  = n.to_hex().unwrap();
    let back = Nullifier::from_hex(&hex).unwrap();
    assert_eq!(n.0, back.0);
}

#[test]
fn test_prove_deposit_without_embed_keys_returns_error() {
    use zk_proofs::{DepositPublicInputs, prove_deposit};
    let inputs = DepositPublicInputs {
        merkle_root: Fr::from(0u64),
        nullifier:   Fr::from(0u64),
        asset_id:    Fr::from(0u64),
        amount:      Fr::from(0u64),
    };
    let err = prove_deposit(&inputs).unwrap_err();
    assert!(matches!(err, ZkError::KeysNotEmbedded));
}

#[test]
fn test_serialized_proof_rejects_garbage() {
    use zk_proofs::SerializedProof;
    let bad = SerializedProof(vec![0xde, 0xad, 0xbe, 0xef]);
    let err = bad.to_ark_proof().unwrap_err();
    assert!(matches!(err, ZkError::Serialization(_)));
}
