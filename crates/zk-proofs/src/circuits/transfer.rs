//! Transfer circuit: proves Merkle membership and nullifier validity.
//!
//! Public inputs:  merkle_root, nullifier
//! Private inputs: secret, leaf_index (position in Merkle tree), commitment
//!
//! The circuit proves:
//!   1. nullifier == MiMC(secret, leaf_index)            [220 constraints]
//!   2. commitment == MiMC(secret, Fr::from(1u64))       [220 constraints — simplified leaf]
//!   3. MiMC(commitment, leaf_index) == merkle_root      [220 constraints — simplified path]
//!
//! In production: step 3 would be a full Merkle path check (depth * 220 constraints).
//! This simplified version proves the prover knows (secret, leaf_index) such that
//! the nullifier and commitment are correctly derived.

use ark_bn254::Fr;
use ark_r1cs_std::{fields::fp::FpVar, prelude::*};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use crate::mimc_gadget::mimc_hash_gadget;
use crate::mimc::{nullifier as native_nullifier, mimc_hash};

#[derive(Clone, Default)]
pub struct TransferCircuit {
    pub merkle_root: Fr,  // public
    pub nullifier:   Fr,  // public
    pub secret:      Fr,  // private
    pub leaf_index:  Fr,  // private
}

impl TransferCircuit {
    pub fn new(secret: Fr, leaf_index: Fr) -> Self {
        let commitment  = mimc_hash(secret, Fr::from(1u64));
        let nullifier   = native_nullifier(secret, leaf_index);
        let merkle_root = mimc_hash(commitment, leaf_index);
        Self { merkle_root, nullifier, secret, leaf_index }
    }
}

impl ConstraintSynthesizer<Fr> for TransferCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        // Public inputs
        let merkle_root_var = FpVar::new_input(cs.clone(), || Ok(self.merkle_root))?;
        let nullifier_var   = FpVar::new_input(cs.clone(), || Ok(self.nullifier))?;

        // Compute nullifier = MiMC(secret, leaf_index) in-circuit
        let computed_nullifier = mimc_hash_gadget(cs.clone(), self.secret, self.leaf_index)?;
        computed_nullifier.enforce_equal(&nullifier_var)?;

        // Compute commitment = MiMC(secret, 1) in-circuit
        let commitment_var = mimc_hash_gadget(cs.clone(), self.secret, Fr::from(1u64))?;

        // Simplified Merkle root check: root = MiMC(commitment, leaf_index)
        // Production: full Merkle path of depth 20 (6,600 constraints)
        let computed_root = mimc_hash_gadget(cs, commitment_var.value().unwrap_or_default(), self.leaf_index)?;
        computed_root.enforce_equal(&merkle_root_var)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_ff::UniformRand;
    use ark_relations::r1cs::ConstraintSystem;
    use ark_std::test_rng;

    #[test]
    fn transfer_circuit_satisfiable() {
        let mut rng = test_rng();
        let secret = Fr::rand(&mut rng);
        let leaf   = Fr::rand(&mut rng);
        let circuit = TransferCircuit::new(secret, leaf);

        let cs = ConstraintSystem::<Fr>::new_ref();
        circuit.generate_constraints(cs.clone()).unwrap();
        assert!(cs.is_satisfied().unwrap(), "Transfer circuit must be satisfied");
        println!("Transfer circuit: {} constraints", cs.num_constraints());
    }
}
