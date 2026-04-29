//! export-keys binary: generates Groth16 proving and verifying keys for all
//! ForgePay ZK circuits and writes them to the privacy-payment-wasm/keys/ directory.
//!
//! Usage:
//!   cargo run --bin export-keys
//!
//! Output:
//!   crates/privacy-payment-wasm/keys/{deposit,transfer,withdraw}.{pk,vk}

use ark_bn254::Bn254;
use ark_groth16::Groth16;
use ark_serialize::CanonicalSerialize;
use ark_std::rand::SeedableRng;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

use zk_proofs::circuits::deposit::DepositCircuit;
use zk_proofs::circuits::transfer::TransferCircuit;
use zk_proofs::circuits::withdraw::WithdrawCircuit;

fn keys_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR = <repo>/crates/zk-proofs at compile time.
    // One level up reaches <repo>/crates/, then privacy-payment-wasm/keys.
    let manifest = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest)
        .join("..") // <repo>/crates/
        .join("privacy-payment-wasm")
        .join("keys")
}

fn write_key(dir: &PathBuf, name: &str, ext: &str, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let path = dir.join(format!("{}.{}", name, ext));
    fs::write(&path, bytes)?;

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let hash = hex::encode(hasher.finalize());

    println!(
        "Generated {}.{}: {} bytes (sha256: {})",
        name,
        ext,
        bytes.len(),
        hash
    );
    Ok(())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("export-keys error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let dir = keys_dir();
    fs::create_dir_all(&dir)?;
    println!("Writing keys to: {}", dir.canonicalize().unwrap_or(dir.clone()).display());

    // Deterministic RNG for reproducible dev keys (NOT for production).
    let mut rng = ark_std::rand::rngs::StdRng::seed_from_u64(42);

    // ── Deposit ──────────────────────────────────────────────────────────────
    {
        let circuit = DepositCircuit::default();
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(circuit, &mut rng)?;

        let mut pk_bytes = Vec::new();
        pk.serialize_compressed(&mut pk_bytes)?;
        write_key(&dir, "deposit", "pk", &pk_bytes)?;

        let mut vk_bytes = Vec::new();
        vk.serialize_compressed(&mut vk_bytes)?;
        write_key(&dir, "deposit", "vk", &vk_bytes)?;
    }

    // ── Transfer ─────────────────────────────────────────────────────────────
    {
        let circuit = TransferCircuit::default();
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(circuit, &mut rng)?;

        let mut pk_bytes = Vec::new();
        pk.serialize_compressed(&mut pk_bytes)?;
        write_key(&dir, "transfer", "pk", &pk_bytes)?;

        let mut vk_bytes = Vec::new();
        vk.serialize_compressed(&mut vk_bytes)?;
        write_key(&dir, "transfer", "vk", &vk_bytes)?;
    }

    // ── Withdraw ─────────────────────────────────────────────────────────────
    {
        let circuit = WithdrawCircuit::default();
        let (pk, vk) = Groth16::<Bn254>::circuit_specific_setup(circuit, &mut rng)?;

        let mut pk_bytes = Vec::new();
        pk.serialize_compressed(&mut pk_bytes)?;
        write_key(&dir, "withdraw", "pk", &pk_bytes)?;

        let mut vk_bytes = Vec::new();
        vk.serialize_compressed(&mut vk_bytes)?;
        write_key(&dir, "withdraw", "vk", &vk_bytes)?;
    }

    println!("Done. Run `cargo build --features embed-keys` to embed keys.");
    Ok(())
}
