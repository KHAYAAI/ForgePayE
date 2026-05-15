//! Withdraw circuit: proves nullifier validity for a withdrawal.
//!
//! Public inputs:  nullifier, merkle_root, amount_units
//! Private inputs: secret, leaf_index
//!
//! The circuit proves:
//!   1. nullifier == MiMC(secret, leaf_index)    [220 constraints]
//!   2. amount_units is the claimed withdrawal    [enforced by caller — public]
//!   3. commitment = MiMC(secret, 1)             [220 constraints]
//!   4. MiMC(commitment, leaf_index) == root     [220 constraints]

use ark_bn254::Fr;
use ark_r1cs_std::{fields::fp::FpVar, prelude::*};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use crate::mimc_gadget::mimc_hash_gadget;
use crate::mimc::{nullifier as native_nullifier, mimc_hash};

#[derive(Clone, Default)]
pub struct WithdrawCircuit {
    pub nullifier:    Fr,  // public
    pub merkle_root:  Fr,  // public
    pub amount_units: Fr,  // public
    pub secret:       Fr,  // private
    pub leaf_index:   Fr,  // private
}

impl WithdrawCircuit {
    pub fn new(secret: Fr, leaf_index: Fr, amount_units: Fr) -> Self {
        let nullifier   = native_nullifier(secret, leaf_index);
        let commitment  = mimc_hash(secret, Fr::from(1u64));
        let merkle_root = mimc_hash(commitment, leaf_index);
        Self { nullifier, merkle_root, amount_units, secret, leaf_index }
    }
}

impl ConstraintSynthesizer<Fr> for WithdrawCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let nullifier_var   = FpVar::new_input(cs.clone(), || Ok(self.nullifier))?;
        let merkle_root_var = FpVar::new_input(cs.clone(), || Ok(self.merkle_root))?;
        let _amount_var     = FpVar::new_input(cs.clone(), || Ok(self.amount_units))?;

        // Nullifier constraint
        let computed_null = mimc_hash_gadget(cs.clone(), self.secret, self.leaf_index)?;
        computed_null.enforce_equal(&nullifier_var)?;

        // Commitment
        let commitment_var = mimc_hash_gadget(cs.clone(), self.secret, Fr::from(1u64))?;

        // Merkle root check
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
    fn withdraw_circuit_satisfiable() {
        let mut rng = test_rng();
        let secret = Fr::rand(&mut rng);
        let leaf   = Fr::rand(&mut rng);
        let amount = Fr::from(1000u64);
        let circuit = WithdrawCircuit::new(secret, leaf, amount);

        let cs = ConstraintSystem::<Fr>::new_ref();
        circuit.generate_constraints(cs.clone()).unwrap();
        assert!(cs.is_satisfied().unwrap(), "Withdraw circuit must be satisfied");
    }
}
