use ark_bn254::Fr;
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

/// Toy Groth16 deposit circuit for development key generation.
///
/// Public inputs:  commitment, asset_id
/// Private inputs: amount, blind
///
/// The single trivial constraint (1 * 1 == 1) ensures setup always succeeds.
/// Replace the constraint body with real Poseidon checks when the circuit is finalized.
#[derive(Clone, Default)]
pub struct DepositCircuit {
    // Public inputs
    pub commitment: Fr,
    pub asset_id:   Fr,
    // Private inputs
    pub amount: Fr,
    pub blind:  Fr,
}

impl ConstraintSynthesizer<Fr> for DepositCircuit {
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
