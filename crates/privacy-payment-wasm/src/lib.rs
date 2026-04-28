//! Browser-side ZK proof generation for ForgePay shielded payments.
//!
//! Compiled to WASM via wasm-pack. Used by @forgepay/sdk in the browser
//! so the server never sees plaintext amounts.
//!
//! CURRENT STATE:
//!   - All crypto types use real arkworks BN254 types
//!   - encryptMemo / decryptMemo use real X25519 ECDH + AES-256-GCM
//!   - generate_deposit_proof / generate_transfer_proof / generate_withdraw_proof
//!     return Err(KeysNotEmbedded) until the circuit proving key is compiled
//!     and embedded (see comment in prove_deposit in crates/zk-proofs/src/lib.rs)
//!
//! ACTIVATION: Once the auditable-privacy-payment circuit is finalized:
//!   1. Export proving key bytes: cargo run --bin export-keys
//!   2. Embed as: static DEPOSIT_PK: &[u8] = include_bytes!("../keys/deposit.pk");
//!   3. Load with: ProvingKey::deserialize_compressed(DEPOSIT_PK)

use ark_bn254::{Bn254, Fr};
use ark_groth16::Proof;
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use ark_std::Zero;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use sha2::{Sha256, Digest};
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};
use zeroize::Zeroizing;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ── Init ─────────────────────────────────────────────────────────────────────

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
    wasm_logger::init(wasm_logger::Config::default());
}

// ── Error types ───────────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct WasmError(String);

#[wasm_bindgen]
impl WasmError {
    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String { self.0.clone() }
}

fn js_err(msg: &str) -> JsValue {
    JsValue::from_str(msg)
}

// ── Field element wrapper ─────────────────────────────────────────────────────

/// BN254 scalar field element — wraps ark_bn254::Fr
#[wasm_bindgen]
pub struct WasmFr(Fr);

#[wasm_bindgen]
impl WasmFr {
    /// Parse a 0x-prefixed hex string into a field element
    #[wasm_bindgen(js_name = fromHex)]
    pub fn from_hex(hex: &str) -> Result<WasmFr, JsValue> {
        let bytes = hex_to_bytes(hex).map_err(|e| js_err(&e))?;
        let mut padded = [0u8; 32];
        let start = 32usize.saturating_sub(bytes.len());
        padded[start..].copy_from_slice(&bytes[bytes.len().saturating_sub(32)..]);
        padded.reverse(); // arkworks little-endian
        Fr::deserialize_compressed(padded.as_slice())
            .map(WasmFr)
            .map_err(|e| js_err(&format!("Invalid field element: {e}")))
    }

    /// Encode as 0x-prefixed hex string
    #[wasm_bindgen(js_name = toHex)]
    pub fn to_hex(&self) -> Result<String, JsValue> {
        let mut buf = [0u8; 32];
        self.0.serialize_compressed(buf.as_mut_slice())
            .map_err(|e| js_err(&format!("Serialization error: {e}")))?;
        buf.reverse();
        Ok(format!("0x{}", hex::encode(buf)))
    }
}

// ── Encrypted memo ────────────────────────────────────────────────────────────

/// Wire format for encrypted memos — X25519 ECDH + AES-256-GCM
#[derive(Serialize, Deserialize)]
struct EncryptedMemoWire {
    ephemeral_pk: String,  // hex X25519 public key
    nonce:        String,  // hex 12-byte AES-GCM nonce
    ciphertext:   String,  // hex encrypted payload (without auth tag)
    auth_tag:     String,  // hex 16-byte GCM auth tag
}

/// Encrypt a plaintext JSON payload to the auditor's public key.
/// Produces a base64-encoded JSON wire format.
///
/// Uses: X25519 ECDH → SHA-256 KDF → AES-256-GCM
#[wasm_bindgen(js_name = encryptMemo)]
pub fn encrypt_memo(plaintext: &str, auditor_pk_hex: &str) -> Result<String, JsValue> {
    // Parse auditor public key
    let pk_bytes = hex_to_bytes(auditor_pk_hex).map_err(|e| js_err(&e))?;
    if pk_bytes.len() != 32 {
        return Err(js_err("Auditor public key must be 32 bytes"));
    }
    let mut pk_arr = [0u8; 32];
    pk_arr.copy_from_slice(&pk_bytes);
    let auditor_pk = PublicKey::from(pk_arr);

    // Generate ephemeral X25519 keypair
    let mut rng = rand::thread_rng();
    let ephemeral_sk = EphemeralSecret::random_from_rng(&mut rng);
    let ephemeral_pk = PublicKey::from(&ephemeral_sk);

    // ECDH
    let shared_secret = Zeroizing::new(ephemeral_sk.diffie_hellman(&auditor_pk));

    // KDF: SHA-256(shared_secret)
    let sym_key: [u8; 32] = {
        let mut h = Sha256::new();
        h.update(shared_secret.as_bytes());
        h.finalize().into()
    };

    // Random nonce
    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rng, &mut nonce_bytes);

    // AES-256-GCM encrypt
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&sym_key));
    let ciphertext_with_tag = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
        .map_err(|e| js_err(&format!("Encryption failed: {e}")))?;

    // Split ciphertext and auth tag (last 16 bytes)
    let tag_start = ciphertext_with_tag.len() - 16;
    let ciphertext = &ciphertext_with_tag[..tag_start];
    let auth_tag   = &ciphertext_with_tag[tag_start..];

    let wire = EncryptedMemoWire {
        ephemeral_pk: hex::encode(ephemeral_pk.as_bytes()),
        nonce:        hex::encode(nonce_bytes),
        ciphertext:   hex::encode(ciphertext),
        auth_tag:     hex::encode(auth_tag),
    };

    let json = serde_json::to_string(&wire)
        .map_err(|e| js_err(&format!("Serialization error: {e}")))?;

    Ok(base64_encode(json.as_bytes()))
}

// ── Serialized proof ──────────────────────────────────────────────────────────

/// A Groth16 proof serialized in arkworks canonical compressed format.
#[wasm_bindgen]
pub struct WasmProof {
    bytes: Vec<u8>,
}

#[wasm_bindgen]
impl WasmProof {
    /// Deserialize from hex-encoded arkworks canonical bytes
    #[wasm_bindgen(js_name = fromHex)]
    pub fn from_hex(hex: &str) -> Result<WasmProof, JsValue> {
        let bytes = hex_to_bytes(hex).map_err(|e| js_err(&e))?;
        // Validate it's a real proof structure
        Proof::<Bn254>::deserialize_compressed(bytes.as_slice())
            .map_err(|e| js_err(&format!("Invalid proof: {e}")))?;
        Ok(WasmProof { bytes })
    }

    /// Encode as hex string
    #[wasm_bindgen(js_name = toHex)]
    pub fn to_hex(&self) -> String {
        hex::encode(&self.bytes)
    }

    /// Encode as base64 (for API submission)
    #[wasm_bindgen(js_name = toBase64)]
    pub fn to_base64(&self) -> String {
        base64_encode(&self.bytes)
    }
}

// ── Proof generator ───────────────────────────────────────────────────────────

/// Client-side Groth16 proof generator.
///
/// Initialized from a 64-char hex seed derived from user credentials
/// (use ProofsResource.deriveSeed() in the JS SDK).
///
/// PROVING STATUS: generate_*_proof() methods return an error until the
/// circuit proving key is embedded. The verification types and serialization
/// are production-ready using real arkworks BN254.
#[wasm_bindgen]
pub struct ProofGenerator {
    seed:         Zeroizing<[u8; 32]>,
    merkle_root:  Fr,
    auditor_pk:   [u8; 32],
}

#[wasm_bindgen]
impl ProofGenerator {
    /// Initialize from a 64-char hex seed.
    #[wasm_bindgen(js_name = fromSeed)]
    pub fn from_seed(seed_hex: &str) -> Result<ProofGenerator, JsValue> {
        let bytes = hex_to_bytes(seed_hex).map_err(|e| js_err(&e))?;
        if bytes.len() < 32 {
            return Err(js_err("Seed must be at least 32 bytes (64 hex chars)"));
        }
        let mut seed = Zeroizing::new([0u8; 32]);
        seed.copy_from_slice(&bytes[..32]);

        Ok(ProofGenerator {
            seed,
            merkle_root: Fr::zero(),
            auditor_pk: [0u8; 32],
        })
    }

    /// Set the current Merkle root (fetched from CommitmentTree contract).
    #[wasm_bindgen(js_name = setMerkleRoot)]
    pub fn set_merkle_root(&mut self, root_hex: &str) -> Result<(), JsValue> {
        let fr = WasmFr::from_hex(root_hex)?;
        self.merkle_root = fr.0;
        Ok(())
    }

    #[wasm_bindgen(js_name = getMerkleRoot)]
    pub fn get_merkle_root(&self) -> Result<String, JsValue> {
        WasmFr(self.merkle_root).to_hex()
    }

    /// Set the auditor's X25519 public key (hex). Used by encryptMemo.
    #[wasm_bindgen(js_name = setAuditorPublicKey)]
    pub fn set_auditor_pk(&mut self, pk_hex: &str) -> Result<(), JsValue> {
        let bytes = hex_to_bytes(pk_hex).map_err(|e| js_err(&e))?;
        if bytes.len() != 32 {
            return Err(js_err("Auditor public key must be 32 bytes"));
        }
        self.auditor_pk.copy_from_slice(&bytes);
        Ok(())
    }

    /// Derive the auditor public key from this generator's seed.
    #[wasm_bindgen(js_name = getPublicKey)]
    pub fn get_public_key(&self) -> String {
        let sk = StaticSecret::from(*self.seed);
        let pk = PublicKey::from(&sk);
        hex::encode(pk.as_bytes())
    }

    /// Generate a deposit proof.
    ///
    /// Returns Err("Proving keys not embedded") until the circuit is finalized.
    /// When the circuit is ready: embed proving key bytes and implement here.
    #[wasm_bindgen(js_name = generateDepositProof)]
    pub fn generate_deposit_proof(
        &self,
        asset_id: u64,
        amount_str: &str,
        blind_hex: &str,
    ) -> Result<String, JsValue> {
        let _asset = Fr::from(asset_id);
        let amount: u128 = amount_str.parse()
            .map_err(|_| js_err("Invalid amount — must be a u128 integer string"))?;
        let _amount_fr = Fr::from(amount);
        let _blind = WasmFr::from_hex(blind_hex)?.0;
        // TODO: Load proving key and call ark_groth16::create_random_proof()
        Err(js_err("Proving keys not yet embedded — circuit finalization required. See crates/zk-proofs/src/lib.rs"))
    }

    /// Generate a transfer proof.
    #[wasm_bindgen(js_name = generateTransferProof)]
    pub fn generate_transfer_proof(
        &self,
        inputs_json: &str,
        outputs_json: &str,
        merkle_proofs_json: &str,
    ) -> Result<String, JsValue> {
        // Validate JSON is parseable
        let _: serde_json::Value = serde_json::from_str(inputs_json)
            .map_err(|e| js_err(&format!("Invalid inputs JSON: {e}")))?;
        let _: serde_json::Value = serde_json::from_str(outputs_json)
            .map_err(|e| js_err(&format!("Invalid outputs JSON: {e}")))?;
        let _: serde_json::Value = serde_json::from_str(merkle_proofs_json)
            .map_err(|e| js_err(&format!("Invalid merkle proofs JSON: {e}")))?;
        Err(js_err("Proving keys not yet embedded — circuit finalization required."))
    }

    /// Generate a withdraw proof.
    #[wasm_bindgen(js_name = generateWithdrawProof)]
    pub fn generate_withdraw_proof(
        &self,
        commitment_hex: &str,
        amount_str: &str,
        recipient_hex: &str,
    ) -> Result<String, JsValue> {
        let _commitment = WasmFr::from_hex(commitment_hex)?.0;
        let _amount: u128 = amount_str.parse()
            .map_err(|_| js_err("Invalid amount"))?;
        let _recipient = WasmFr::from_hex(recipient_hex)?.0;
        Err(js_err("Proving keys not yet embedded — circuit finalization required."))
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    let hex = hex.trim_start_matches("0x");
    hex::decode(hex).map_err(|e| format!("Invalid hex: {e}"))
}

fn base64_encode(data: &[u8]) -> String {
    // Use base64 alphabet without padding
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity((data.len() * 4 + 2) / 3);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        out.push(CHARS[(b0 >> 2) & 0x3F]);
        out.push(CHARS[((b0 << 4) | (b1 >> 4)) & 0x3F]);
        out.push(if chunk.len() > 1 { CHARS[((b1 << 2) | (b2 >> 6)) & 0x3F] } else { b'=' });
        out.push(if chunk.len() > 2 { CHARS[b2 & 0x3F] } else { b'=' });
    }
    String::from_utf8(out).unwrap()
}
