//! MiMC R1CS gadget — constrains MiMC hash computation.
//!
//! Each round of MiMC adds 2 constraints:
//!   1. tmp_sq = (xl + c) * (xl + c)
//!   2. tmp_cubed = tmp_sq * (xl + c)
//! Total: 2 * 110 = 220 constraints per MiMC call.

use ark_bn254::Fr;
use ark_r1cs_std::{
    fields::fp::FpVar,
    prelude::*,
};
use ark_relations::r1cs::{ConstraintSystemRef, SynthesisError};
use crate::mimc::round_constants;

/// Compute MiMC(xl, xr) in-circuit, returning the output as a constrained FpVar.
pub fn mimc_hash_gadget(
    cs: ConstraintSystemRef<Fr>,
    xl_val: Fr,
    xr_val: Fr,
) -> Result<FpVar<Fr>, SynthesisError> {
    let constants = round_constants();

    let mut xl = FpVar::new_witness(cs.clone(), || Ok(xl_val))?;
    let mut xr = FpVar::new_witness(cs.clone(), || Ok(xr_val))?;

    for i in 0..constants.len() {
        let c = FpVar::constant(constants[i]);
        // tmp = xl + c
        let tmp = &xl + &c;
        // tmp_sq = tmp * tmp   (constraint 1 per round)
        let tmp_sq = &tmp * &tmp;
        // tmp_cubed = tmp_sq * tmp  (constraint 2 per round)
        let tmp_cubed = &tmp_sq * &tmp;
        // new_xl = tmp_cubed + xr
        let new_xl = &tmp_cubed + &xr;
        xr = xl;
        xl = new_xl;
    }

    // output = xl + xr
    Ok(&xl + &xr)
}
