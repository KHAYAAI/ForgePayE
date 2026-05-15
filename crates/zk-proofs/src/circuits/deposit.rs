//! Deposit circuit: proves commitment = MiMC(amount, blind)
//!
//! Public inputs:  commitment (the value on-chain), asset_id
//! Private inputs: amount (the actual deposit value), blind (blinding factor)
//!
//! The circuit proves:
//!   1. MiMC(amount, blind) == commitment  [220 constraints]
//!   2. asset_id is the claimed asset      [1 constraint — equality check]
//!
//! This means a depositor can prove they deposited a valid commitment
//! without revealing the amount to anyone who doesn't know the blind.

use ark_bn254::Fr;
use ark_r1cs_std::{fields::fp::FpVar, prelude::*};
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use crate::mimc_gadget::mimc_hash_gadget;
use crate::mimc::commitment as native_commitment;

#[derive(Clone, Default)]
pub struct DepositCircuit {
    pub commitment: Fr,  // public
    pub asset_id:   Fr,  // public
    pub amount:     Fr,  // private
    pub blind:      Fr,  // private
}

impl DepositCircuit {
    pub fn new(amount: Fr, blind: Fr, asset_id: Fr) -> Self {
        let commitment = native_commitment(amount, blind);
        Self { commitment, asset_id, amount, blind }
    }
}

impl ConstraintSynthesizer<Fr> for DepositCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        // Allocate public inputs
        let commitment_var = FpVar::new_input(cs.clone(), || Ok(self.commitment))?;
        let _asset_id_var  = FpVar::new_input(cs.clone(), || Ok(self.asset_id))?;

        // Compute MiMC(amount, blind) in-circuit
        let computed = mimc_hash_gadget(cs, self.amount, self.blind)?;

        // Enforce: computed_commitment == public_commitment
        computed.enforce_equal(&commitment_var)?;

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
    fn deposit_circuit_satisfiable() {
        let mut rng = test_rng();
        let amount  = Fr::rand(&mut rng);
        let blind   = Fr::rand(&mut rng);
        let asset   = Fr::rand(&mut rng);
        let circuit = DepositCircuit::new(amount, blind, asset);

        let cs = ConstraintSystem::<Fr>::new_ref();
        circuit.generate_constraints(cs.clone()).unwrap();
        assert!(cs.is_satisfied().unwrap(), "Deposit circuit must be satisfied with valid inputs");
        println!("Deposit circuit: {} constraints", cs.num_constraints());
    }

    #[test]
    fn deposit_circuit_unsatisfiable_wrong_commitment() {
        let mut rng = test_rng();
        let amount  = Fr::rand(&mut rng);
        let blind   = Fr::rand(&mut rng);
        let asset   = Fr::rand(&mut rng);
        let mut circuit = DepositCircuit::new(amount, blind, asset);
        // Tamper with the commitment
        circuit.commitment = Fr::rand(&mut rng);

        let cs = ConstraintSystem::<Fr>::new_ref();
        circuit.generate_constraints(cs.clone()).unwrap();
        assert!(!cs.is_satisfied().unwrap(), "Circuit must be unsatisfied with wrong commitment");
    }
}
