use ark_bn254::Fr;
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

/// Toy Groth16 transfer circuit for development key generation.
///
/// Public inputs:  merkle_root, nullifier
/// Private inputs: amount, blind
///
/// The single trivial constraint (1 * 1 == 1) ensures setup always succeeds.
/// Replace the constraint body with real Poseidon checks when the circuit is finalized.
#[derive(Clone, Default)]
pub struct TransferCircuit {
    // Public inputs
    pub merkle_root: Fr,
    pub nullifier:   Fr,
    // Private inputs
    pub amount: Fr,
    pub blind:  Fr,
}

impl ConstraintSynthesizer<Fr> for TransferCircuit {
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
