//! export-keys binary: generates Groth16 proving and verifying keys for all
//! ForgePay ZK circuits and writes them to the privacy-payment-wasm/keys/ directory.
//!
//! Usage:
//!   cargo run --bin export-keys
//!
//! Output:
//!   crates/privacy-payment-wasm/keys/{deposit,transfer,withdraw}.{pk,vk}
//!
//! NOTE: Uses a seeded deterministic RNG — NOT for production. Production keys
//! must use a trusted multi-party ceremony.

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
    let manifest = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest)
        .join("..")
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
        "  {}.{}: {} bytes  sha256={}",
        name, ext, bytes.len(), &hash[..16]
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
    println!("Writing dev keys to: {}", dir.canonicalize().unwrap_or(dir.clone()).display());
    println!("(Seed=42 deterministic — NOT for production)");

    // Deterministic RNG: seed=42 gives reproducible dev keys
    let mut rng = ark_std::rand::rngs::StdRng::seed_from_u64(42);

    // ── Deposit ──────────────────────────────────────────────────────────────
    println!("\n[deposit]");
    {
        let circuit = DepositCircuit::default();
        let pk = Groth16::<Bn254>::generate_random_parameters_with_reduction(circuit, &mut rng)?;
        let vk = pk.vk.clone();

        let mut pk_bytes: Vec<u8> = Vec::new();
        pk.serialize_compressed(&mut pk_bytes)?;
        write_key(&dir, "deposit", "pk", &pk_bytes)?;

        let mut vk_bytes: Vec<u8> = Vec::new();
        vk.serialize_compressed(&mut vk_bytes)?;
        write_key(&dir, "deposit", "vk", &vk_bytes)?;
    }

    // ── Transfer ─────────────────────────────────────────────────────────────
    println!("\n[transfer]");
    {
        let circuit = TransferCircuit::default();
        let pk = Groth16::<Bn254>::generate_random_parameters_with_reduction(circuit, &mut rng)?;
        let vk = pk.vk.clone();

        let mut pk_bytes: Vec<u8> = Vec::new();
        pk.serialize_compressed(&mut pk_bytes)?;
        write_key(&dir, "transfer", "pk", &pk_bytes)?;

        let mut vk_bytes: Vec<u8> = Vec::new();
        vk.serialize_compressed(&mut vk_bytes)?;
        write_key(&dir, "transfer", "vk", &vk_bytes)?;
    }

    // ── Withdraw ─────────────────────────────────────────────────────────────
    println!("\n[withdraw]");
    {
        let circuit = WithdrawCircuit::default();
        let pk = Groth16::<Bn254>::generate_random_parameters_with_reduction(circuit, &mut rng)?;
        let vk = pk.vk.clone();

        let mut pk_bytes: Vec<u8> = Vec::new();
        pk.serialize_compressed(&mut pk_bytes)?;
        write_key(&dir, "withdraw", "pk", &pk_bytes)?;

        let mut vk_bytes: Vec<u8> = Vec::new();
        vk.serialize_compressed(&mut vk_bytes)?;
        write_key(&dir, "withdraw", "vk", &vk_bytes)?;
    }

    println!("\nDone. Run `cargo build --features embed-keys` to embed keys in the crate.");
    Ok(())
}
