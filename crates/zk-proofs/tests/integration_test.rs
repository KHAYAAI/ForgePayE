//! Phase 1 Integration Tests for ZK Proof Module
//!
//! These tests verify that the ZK proof architecture is properly scaffolded and
//! that error handling works correctly. The actual Groth16 logic is stubbed.
//!
//! Status: TESTING MODE — all proofs succeed unconditionally.
//! After auditable-privacy-payment integration, replace stub implementations with real verification.

use zk_proofs::*;

#[test]
fn test_deposit_proof_generation() {
    // Arrange
    let deposit = Deposit {
        asset: 0,        // Asset ID
        amount: 1_000_000,
        commitment: Commitment::from_hex("abc123def456"),
    };

    // Act
    let proof = deposit.generate_proof("owner_secret_key");

    // Assert
    assert!(proof.is_ok());
    let proof = proof.unwrap();
    assert!(proof.data.contains("STUB_DEPOSIT_PROOF"));
    assert_eq!(proof.public_inputs.len(), 1);
    assert_eq!(proof.public_inputs[0], deposit.commitment.0);
}

#[test]
fn test_deposit_proof_verification() {
    // Arrange
    let deposit = Deposit {
        asset: 0,
        amount: 500_000,
        commitment: Commitment::from_hex("ffff0000"),
    };

    let proof = deposit
        .generate_proof("secret")
        .expect("proof generation failed");

    // Act
    let result = deposit.verify_proof(&proof);

    // Assert
    // STUB: Always succeeds in testing mode
    assert!(result.is_ok());

    // TODO: After integration, this should verify the actual Groth16 proof
}

#[test]
fn test_transfer_proof_generation_single_input() {
    // Arrange
    let transfer = Transfer {
        num_inputs: 1,
        num_outputs: 1,
    };

    let merkle_root = Fr::from_hex("abcdef00");
    let inputs = vec![];

    // Act
    let proof = transfer.generate_proof(&merkle_root, &inputs);

    // Assert
    assert!(proof.is_ok());
    let proof = proof.unwrap();
    assert!(proof.data.contains("STUB_TRANSFER_PROOF_1in_1out"));
}

#[test]
fn test_transfer_proof_multiple_inputs_outputs() {
    // Arrange
    let transfer = Transfer {
        num_inputs: 3,
        num_outputs: 2,
    };

    let merkle_root = Fr::from_hex("deadbeef");
    let inputs = vec![];

    // Act
    let proof = transfer.generate_proof(&merkle_root, &inputs);

    // Assert
    assert!(proof.is_ok());
    let proof = proof.unwrap();
    assert!(proof.data.contains("STUB_TRANSFER_PROOF_3in_2out"));

    // TODO: When integrated, verify proof actually checks balance conservation
}

#[test]
fn test_withdraw_proof_generation() {
    // Arrange
    let withdraw = Withdraw {
        amount: 1_000_000,
        asset: 0, // USDC or similar
    };

    let merkle_root = Fr::from_hex("11223344");

    // Act
    let proof = withdraw.generate_proof(&merkle_root);

    // Assert
    assert!(proof.is_ok());
    let proof = proof.unwrap();
    assert!(proof.data.contains("STUB_WITHDRAW_PROOF_0_1000000"));
}

#[test]
fn test_merkle_tree_insertion() {
    // Arrange
    let mut tree = MerkleTree::new();
    let commitment = Commitment::from_hex("0123456789abcdef");

    // Act
    let index = tree.insert(commitment.clone());

    // Assert
    assert!(index.is_ok());
    let index = index.unwrap();
    assert_eq!(index, 0);
    assert_eq!(tree.leaves.len(), 1);
    assert_eq!(tree.leaves[0], commitment);
}

#[test]
fn test_merkle_tree_multiple_insertions() {
    // Arrange
    let mut tree = MerkleTree::new();
    let c1 = Commitment::from_hex("1111");
    let c2 = Commitment::from_hex("2222");
    let c3 = Commitment::from_hex("3333");

    // Act
    let i1 = tree.insert(c1.clone()).unwrap();
    let i2 = tree.insert(c2.clone()).unwrap();
    let i3 = tree.insert(c3.clone()).unwrap();

    // Assert
    assert_eq!(i1, 0);
    assert_eq!(i2, 1);
    assert_eq!(i3, 2);
    assert_eq!(tree.leaves.len(), 3);
}

#[test]
fn test_merkle_proof_generation() {
    // Arrange
    let mut tree = MerkleTree::new();
    let commitment = Commitment::from_hex("aabbccdd");
    let index = tree.insert(commitment.clone()).unwrap();

    // Act
    let proof = tree.prove(index);

    // Assert
    assert!(proof.is_ok());
    let proof = proof.unwrap();
    assert_eq!(proof.leaf_index, index);
    assert_eq!(proof.leaf, commitment.0);
    assert_eq!(proof.root, tree.root);
}

#[test]
fn test_merkle_proof_out_of_bounds() {
    // Arrange
    let tree = MerkleTree::new();

    // Act
    let result = tree.prove(100);

    // Assert
    assert!(result.is_err());
    assert!(matches!(result.unwrap_err(), ZkError::MerkleTreeError(_)));
}

#[test]
fn test_merkle_proof_verification() {
    // Arrange
    let mut tree = MerkleTree::new();
    let commitment = Commitment::from_hex("ddeeffaa");
    let index = tree.insert(commitment).unwrap();
    let proof = tree.prove(index).unwrap();

    // Act
    let result = tree.verify(&proof);

    // Assert
    assert!(result.is_ok());
    let is_valid = result.unwrap();
    // STUB: Always returns true in testing mode
    assert!(is_valid);

    // TODO: After integration, should verify actual Poseidon Merkle tree proof
}

#[test]
fn test_field_element_hex_conversion() {
    // Arrange
    let hex = "deadbeefcafebabe";

    // Act
    let fr = Fr::from_hex(hex);

    // Assert
    assert_eq!(fr.to_hex(), hex);
}

#[test]
fn test_commitment_from_hex() {
    // Arrange
    let hex = "0123456789abcdef";

    // Act
    let commitment = Commitment::from_hex(hex);

    // Assert
    assert_eq!(commitment.0.to_hex(), hex);
}

#[test]
fn test_nullifier_from_hex() {
    // Arrange
    let hex = "fedcba9876543210";

    // Act
    let nullifier = Nullifier::from_hex(hex);

    // Assert
    assert_eq!(nullifier.0.to_hex(), hex);
}

#[test]
fn test_proof_stub_creation() {
    // Act
    let proof = Proof::stub("test_operation");

    // Assert
    assert!(proof.data.contains("STUB_PROOF_test_operation"));
    assert_eq!(proof.public_inputs.len(), 0);
}

#[test]
fn test_error_invalid_input() {
    // Arrange
    let tree = MerkleTree::new();

    // Act
    let result = tree.prove(9999);

    // Assert
    match result {
        Err(ZkError::MerkleTreeError(msg)) => {
            assert!(msg.contains("out of bounds"));
        }
        _ => panic!("Expected MerkleTreeError"),
    }
}

// ── End-to-End Stub Test ───────────────────────────────────────────────────

#[test]
fn test_deposit_transfer_withdraw_flow() {
    // This test simulates the full privacy payment flow:
    // 1. Deposit: Hide amount in commitment
    // 2. Transfer: Spend the commitment privately
    // 3. Withdraw: Redeem to public amount

    // Step 1: Deposit
    let deposit = Deposit {
        asset: 0,
        amount: 100_000_000,
        commitment: Commitment::from_hex("step1_commitment"),
    };

    let deposit_proof = deposit
        .generate_proof("owner_secret")
        .expect("deposit proof failed");

    assert!(deposit.verify_proof(&deposit_proof).is_ok());

    // Step 2: Add to Merkle tree
    let mut tree = MerkleTree::new();
    let _leaf_index = tree
        .insert(deposit.commitment.clone())
        .expect("merkle insert failed");

    let merkle_proof = tree
        .prove(_leaf_index)
        .expect("merkle proof generation failed");

    assert!(tree.verify(&merkle_proof).is_ok());

    // Step 3: Transfer (spend the commitment, create new ones)
    let transfer = Transfer {
        num_inputs: 1,
        num_outputs: 2,
    };

    let transfer_proof = transfer
        .generate_proof(&tree.root, &[])
        .expect("transfer proof failed");

    assert!(transfer.verify_proof(&transfer_proof, &tree.root).is_ok());

    // Step 4: Withdraw (redeem one output to public amount)
    let withdraw = Withdraw {
        amount: 50_000_000,
        asset: 0,
    };

    let withdraw_proof = withdraw
        .generate_proof(&tree.root)
        .expect("withdraw proof failed");

    assert!(withdraw.verify_proof(&withdraw_proof).is_ok());

    // ✅ Full flow succeeded (in stub mode)
    println!("✅ Deposit → Transfer → Withdraw flow completed successfully");

    // TODO: When auditable-privacy-payment is integrated:
    // - Replace stubs with real Groth16 circuit verification
    // - Add actual balance conservation checks
    // - Implement real Poseidon Merkle tree
    // - Verify nullifier uniqueness prevents double-spending
}
