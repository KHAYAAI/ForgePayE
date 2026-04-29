use ark_bn254::Fr;
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

/// Toy Groth16 withdraw circuit for development key generation.
///
/// Public inputs:  nullifier, merkle_root, amount_units
/// Private inputs: blind
///
/// The single trivial constraint (1 * 1 == 1) ensures setup always succeeds.
/// Replace the constraint body with real Poseidon checks when the circuit is finalized.
#[derive(Clone, Default)]
pub struct WithdrawCircuit {
    // Public inputs
    pub nullifier:    Fr,
    pub merkle_root:  Fr,
    pub amount_units: Fr,
    // Private inputs
    pub blind: Fr,
}

impl ConstraintSynthesizer<Fr> for WithdrawCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        use ark_relations::r1cs::Variable;

        let one = Variable::One;
        cs.enforce_constraint(
            ark_relations::lc!() + one,
            ark_relations::lc!() + one,
            ark_relations::lc!() + one,
        )?;
        Ok(())
    }
}
