//! MiMC-p/p hash over BN254 scalar field.
//! Round constants derived from SHA-256("MiMC-ForgePay-round-{i}") for transparency.

use ark_bn254::Fr;
use ark_ff::PrimeField;
use sha2::{Digest, Sha256};

pub const MIMC_ROUNDS: usize = 110;

/// Deterministic round constants from "MiMC-ForgePay-round-{i}"
pub fn round_constants() -> Vec<Fr> {
    (0..MIMC_ROUNDS).map(|i| {
        let mut hasher = Sha256::new();
        hasher.update(format!("MiMC-ForgePay-round-{}", i).as_bytes());
        let bytes = hasher.finalize();
        // Take 31 bytes to stay within field modulus
        let mut repr = [0u8; 32];
        repr[1..].copy_from_slice(&bytes[..31]);
        Fr::from_be_bytes_mod_order(&repr)
    }).collect()
}

/// Native MiMC hash of two field elements (Feistel mode)
pub fn mimc_hash(x: Fr, y: Fr) -> Fr {
    let constants = round_constants();
    let mut xl = x;
    let mut xr = y;
    for i in 0..MIMC_ROUNDS {
        let tmp = xl + constants[i];
        let tmp_cubed = tmp * tmp * tmp;
        let new_xl = tmp_cubed + xr;
        xr = xl;
        xl = new_xl;
    }
    xl + xr
}

/// Commitment = MiMC(amount, blinding_factor)
pub fn commitment(amount: Fr, blind: Fr) -> Fr {
    mimc_hash(amount, blind)
}

/// Nullifier = MiMC(secret, leaf_index)
pub fn nullifier(secret: Fr, leaf_index: Fr) -> Fr {
    mimc_hash(secret, leaf_index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ark_ff::UniformRand;
    use ark_std::test_rng;

    #[test]
    fn deterministic() {
        let mut rng = test_rng();
        let a = Fr::rand(&mut rng);
        let b = Fr::rand(&mut rng);
        assert_eq!(mimc_hash(a, b), mimc_hash(a, b));
    }

    #[test]
    fn different_inputs_produce_different_hashes() {
        let mut rng = test_rng();
        let a = Fr::rand(&mut rng);
        let b = Fr::rand(&mut rng);
        let c = Fr::rand(&mut rng);
        assert_ne!(mimc_hash(a, b), mimc_hash(a, c));
    }
}
