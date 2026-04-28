//! Auditor Service for Privacy-Preserving MoR
//!
//! ARCH: The Auditor is a trusted entity that can decrypt shielded transactions
//! without revealing plaintext to the public ledger or merchants.
//!
//! Encryption scheme: X25519 ECDH + SHA-256 KDF + AES-256-GCM
//! - Client encrypts memo to auditor's X25519 public key
//! - Auditor decrypts using their X25519 secret key
//! - Merchant and public never see plaintext amount
//!
//! NOTE: X25519 is used as a production-grade stand-in for BabyJubjub ECDH.
//! When auditable-privacy-payment ships BabyJubjub ECDH, swap the key types
//! while keeping the AES-GCM layer identical.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};
use zeroize::Zeroize;

// ── Error Types ────────────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum AuditorError {
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),

    #[error("Invalid memo format: {0}")]
    InvalidMemo(String),

    #[error("Proof verification failed: {0}")]
    ProofVerificationFailed(String),

    #[error("Key error: {0}")]
    KeyError(String),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Hex decode error: {0}")]
    HexError(#[from] hex::FromHexError),

    #[error("Auditor not initialized")]
    NotInitialized,

    #[error("Freezing operation failed: {0}")]
    FreezingFailed(String),
}

pub type Result<T> = std::result::Result<T, AuditorError>;

// ── Keypair Management ─────────────────────────────────────────────────────

/// Auditor keypair — X25519 for ECDH key agreement.
///
/// Production note: The secret key is held in memory only and zeroized on drop.
/// In production, load from hardware security module (HSM) via Vault.
#[derive(Clone)]
pub struct AuditorKeypair {
    /// X25519 public key bytes (32 bytes), hex-encoded. Safe to share.
    pub public_key: String,

    /// X25519 secret key bytes (32 bytes), hex-encoded. NEVER share.
    secret_key: String,
}

impl Drop for AuditorKeypair {
    fn drop(&mut self) {
        self.secret_key.zeroize();
    }
}

impl std::fmt::Debug for AuditorKeypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuditorKeypair")
            .field("public_key", &self.public_key)
            .field("secret_key", &"[REDACTED]")
            .finish()
    }
}

impl AuditorKeypair {
    /// Derive an X25519 keypair deterministically from a seed.
    ///
    /// The seed is hashed with SHA-256 to produce the secret key scalar.
    /// When auditable-privacy-payment ships BabyJubjub, replace the
    /// StaticSecret construction but keep the SHA-256 seed expansion.
    pub fn from_seed(seed_hex: &str) -> Result<Self> {
        let seed_bytes = hex::decode(seed_hex)?;
        if seed_bytes.len() < 32 {
            return Err(AuditorError::KeyError(
                "seed must be at least 32 bytes (64 hex chars)".to_string(),
            ));
        }

        // SHA-256 of seed → deterministic 32-byte secret key
        let mut hasher = Sha256::new();
        hasher.update(&seed_bytes);
        let sk_bytes: [u8; 32] = hasher.finalize().into();

        let secret = StaticSecret::from(sk_bytes);
        let public = PublicKey::from(&secret);

        Ok(AuditorKeypair {
            public_key: hex::encode(public.as_bytes()),
            secret_key: hex::encode(secret.to_bytes()),
        })
    }

    /// Generate a random X25519 keypair using OS entropy.
    pub fn generate() -> Result<Self> {
        let mut rng = rand::thread_rng();
        let mut sk_bytes = [0u8; 32];
        rng.fill_bytes(&mut sk_bytes);

        let secret = StaticSecret::from(sk_bytes);
        let public = PublicKey::from(&secret);

        Ok(AuditorKeypair {
            public_key: hex::encode(public.as_bytes()),
            secret_key: hex::encode(secret.to_bytes()),
        })
    }

    /// Get the public key as hex string (safe to share with clients).
    pub fn public_key(&self) -> &str {
        &self.public_key
    }
}

// ── Shielded Transaction Data ──────────────────────────────────────────────

/// Decrypted shielded transaction — what the auditor sees after decryption.
///
/// The auditor uses this to compute taxes on the actual amount, generate
/// audit trail, and optionally freeze fraudulent UTXOs.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShieldedTxData {
    /// Asset ID (0 = USDC, 1 = USDT)
    pub asset: u64,

    /// Amount in smallest unit (e.g., 1_000_000 = $1.00 USDC)
    pub amount: u128,

    /// Owner's public key (hex)
    pub owner_pk: String,

    /// Nullifier — unique per UTXO + spender, prevents double-spend
    pub nullifier: String,

    /// Commitment — hidden in Merkle tree on-chain
    pub commitment: String,

    /// Unix timestamp of the transaction
    pub timestamp: u64,

    /// Merchant ID if known (may be omitted for extra privacy)
    pub merchant_id: Option<String>,
}

impl ShieldedTxData {
    pub fn new(asset: u64, amount: u128, owner_pk: String) -> Self {
        ShieldedTxData {
            asset,
            amount,
            owner_pk,
            nullifier: format!("NULLIFIER_{}", amount),
            commitment: format!("COMMITMENT_{}", amount),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            merchant_id: None,
        }
    }
}

// ── Encrypted Memo ─────────────────────────────────────────────────────────

/// Wire format for an encrypted transaction memo.
///
/// Layout (all hex-encoded in JSON):
/// - `ephemeral_pk`: 32-byte X25519 ephemeral public key
/// - `nonce`: 12-byte AES-GCM nonce (random per message)
/// - `ciphertext`: AES-256-GCM ciphertext (same length as plaintext)
/// - `auth_tag`: 16-byte GCM authentication tag
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EncryptedMemo {
    pub ephemeral_pk: String,
    pub nonce: String,
    pub ciphertext: String,
    pub auth_tag: String,
}

impl EncryptedMemo {
    /// Encrypt a plaintext blob to an auditor's X25519 public key.
    ///
    /// ECDH flow:
    /// 1. Generate ephemeral X25519 keypair
    /// 2. ECDH(ephemeral_sk, auditor_pk) → 32-byte shared secret
    /// 3. symmetric_key = SHA-256(shared_secret)
    /// 4. AES-256-GCM encrypt with random 12-byte nonce
    /// 5. Output ephemeral_pk + nonce + ciphertext + auth_tag
    pub fn encrypt(plaintext: &[u8], auditor_pk_hex: &str) -> Result<Self> {
        // 1. Parse auditor public key
        let pk_bytes = hex::decode(auditor_pk_hex)
            .map_err(|e| AuditorError::KeyError(format!("invalid auditor public key: {e}")))?;
        if pk_bytes.len() != 32 {
            return Err(AuditorError::KeyError(
                "auditor public key must be 32 bytes".to_string(),
            ));
        }
        let pk_array: [u8; 32] = pk_bytes.try_into().unwrap();
        let auditor_pk = PublicKey::from(pk_array);

        // 2. Generate ephemeral keypair
        let ephemeral_secret = EphemeralSecret::random_from_rng(rand::thread_rng());
        let ephemeral_pk = PublicKey::from(&ephemeral_secret);

        // 3. ECDH → shared secret
        let shared = ephemeral_secret.diffie_hellman(&auditor_pk);

        // 4. SHA-256 KDF
        let mut hasher = Sha256::new();
        hasher.update(shared.as_bytes());
        let symmetric_key: [u8; 32] = hasher.finalize().into();

        // 5. AES-256-GCM encrypt
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&symmetric_key));
        let nonce = Nonce::from_slice(&nonce_bytes);
        let mut ciphertext_with_tag = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| AuditorError::DecryptionFailed(format!("AES-GCM encrypt: {e}")))?;

        // aes-gcm appends 16-byte auth tag at end
        let tag_start = ciphertext_with_tag.len() - 16;
        let auth_tag = ciphertext_with_tag.split_off(tag_start);

        Ok(EncryptedMemo {
            ephemeral_pk: hex::encode(ephemeral_pk.as_bytes()),
            nonce: hex::encode(nonce_bytes),
            ciphertext: hex::encode(&ciphertext_with_tag),
            auth_tag: hex::encode(&auth_tag),
        })
    }

    /// Serialize to JSON bytes for wire transmission.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(self).map_err(AuditorError::SerializationError)
    }

    /// Deserialize from JSON bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        serde_json::from_slice(bytes).map_err(AuditorError::SerializationError)
    }
}

// ── Auditor Client ──────────────────────────────────────────────────────────

/// Auditor client — holds the X25519 secret key and provides decryption.
///
/// Used by MoR Layer (Python) via FFI bindings. In production, the secret key
/// is loaded from Vault/HSM and never leaves the auditor service boundary.
///
/// The frozen_nullifiers set is maintained in-memory and shared across threads.
/// In production, this should be backed by a database table and synced with
/// the on-chain NullifierRegistry contract.
pub struct AuditorClient {
    keypair: AuditorKeypair,
    frozen_nullifiers: Arc<Mutex<HashSet<String>>>,
}

impl Clone for AuditorClient {
    fn clone(&self) -> Self {
        AuditorClient {
            keypair: self.keypair.clone(),
            frozen_nullifiers: Arc::clone(&self.frozen_nullifiers),
        }
    }
}

impl AuditorClient {
    pub fn new(keypair: AuditorKeypair) -> Self {
        AuditorClient {
            keypair,
            frozen_nullifiers: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn from_seed(seed_hex: &str) -> Result<Self> {
        let keypair = AuditorKeypair::from_seed(seed_hex)?;
        Ok(AuditorClient {
            keypair,
            frozen_nullifiers: Arc::new(Mutex::new(HashSet::new())),
        })
    }

    /// Auditor's X25519 public key — share this with clients for encryption.
    pub fn public_key(&self) -> &str {
        self.keypair.public_key()
    }

    /// Decrypt a shielded transaction memo using ECDH + AES-256-GCM.
    ///
    /// Decryption flow:
    /// 1. Parse ephemeral_pk from memo
    /// 2. ECDH(auditor_sk, ephemeral_pk) → shared secret
    /// 3. symmetric_key = SHA-256(shared_secret)
    /// 4. AES-256-GCM decrypt ciphertext
    /// 5. Deserialize JSON → ShieldedTxData
    pub fn decrypt_shielded_tx(&self, memo: &EncryptedMemo) -> Result<ShieldedTxData> {
        tracing::debug!(ephemeral_pk = %memo.ephemeral_pk, "decrypting shielded transaction");

        // 1. Parse ephemeral public key
        let eph_bytes = hex::decode(&memo.ephemeral_pk)
            .map_err(|e| AuditorError::InvalidMemo(format!("ephemeral_pk: {e}")))?;
        if eph_bytes.len() != 32 {
            return Err(AuditorError::InvalidMemo(
                "ephemeral_pk must be 32 bytes".to_string(),
            ));
        }
        let eph_array: [u8; 32] = eph_bytes.try_into().unwrap();
        let ephemeral_pk = PublicKey::from(eph_array);

        // 2. Load auditor secret key
        let sk_bytes_vec = hex::decode(&self.keypair.secret_key)
            .map_err(|e| AuditorError::KeyError(format!("secret_key decode: {e}")))?;
        if sk_bytes_vec.len() != 32 {
            return Err(AuditorError::KeyError(
                "secret key must be 32 bytes".to_string(),
            ));
        }
        let sk_array: [u8; 32] = sk_bytes_vec.try_into().unwrap();
        let static_secret = StaticSecret::from(sk_array);

        // 3. ECDH
        let shared = static_secret.diffie_hellman(&ephemeral_pk);

        // 4. SHA-256 KDF
        let mut hasher = Sha256::new();
        hasher.update(shared.as_bytes());
        let symmetric_key: [u8; 32] = hasher.finalize().into();

        // 5. Reconstruct ciphertext + auth_tag for aes-gcm
        let mut ciphertext_bytes = hex::decode(&memo.ciphertext)
            .map_err(|e| AuditorError::InvalidMemo(format!("ciphertext: {e}")))?;
        let auth_tag_bytes = hex::decode(&memo.auth_tag)
            .map_err(|e| AuditorError::InvalidMemo(format!("auth_tag: {e}")))?;
        ciphertext_bytes.extend_from_slice(&auth_tag_bytes);

        let nonce_bytes = hex::decode(&memo.nonce)
            .map_err(|e| AuditorError::InvalidMemo(format!("nonce: {e}")))?;
        if nonce_bytes.len() != 12 {
            return Err(AuditorError::InvalidMemo("nonce must be 12 bytes".to_string()));
        }

        // 6. AES-256-GCM decrypt
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&symmetric_key));
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plaintext = cipher
            .decrypt(nonce, ciphertext_bytes.as_slice())
            .map_err(|_| AuditorError::DecryptionFailed(
                "AES-GCM authentication failed — memo tampered or wrong key".to_string(),
            ))?;

        // 7. Deserialize
        serde_json::from_slice(&plaintext).map_err(AuditorError::SerializationError)
    }

    /// Verify a Groth16 audit proof.
    ///
    /// Validates proof structure: must be 128 bytes (compressed arkworks format)
    /// or 256 bytes (ABI-encoded format).
    ///
    /// TODO: Implement real Groth16 verification when auditable-privacy-payment
    /// is integrated. Currently accepts any structurally valid proof.
    pub fn verify_audit_proof(&self, proof_bytes: &[u8]) -> Result<bool> {
        match proof_bytes.len() {
            128 | 256 => {
                tracing::info!(
                    "verify_audit_proof: proof length {} bytes (structurally valid)",
                    proof_bytes.len()
                );
                Ok(true)
            }
            len => {
                tracing::warn!(
                    "verify_audit_proof: invalid proof length {} (expected 128 or 256)",
                    len
                );
                Err(AuditorError::ProofVerificationFailed(
                    format!("proof length {len} is invalid"),
                ))
            }
        }
    }

    /// Check if a nullifier is in the compliance freeze set.
    ///
    /// Checks the in-memory HashSet first (fast path).
    /// TODO: Also query the on-chain NullifierRegistry contract for distributed freeze state.
    pub fn is_nullifier_frozen(&self, nullifier: &str) -> Result<bool> {
        let frozen = self.frozen_nullifiers.lock().map_err(|e| {
            AuditorError::FreezingFailed(format!("mutex lock: {e}"))
        })?;
        let normalized = nullifier.to_lowercase().trim().to_string();
        Ok(frozen.contains(&normalized))
    }

    /// Freeze a nullifier for compliance (sanctions, fraud, court order).
    ///
    /// Adds to the in-memory HashSet and logs the action.
    /// TODO: Also INSERT into frozen_nullifiers table and call
    /// NullifierRegistry.freezeNullifier() on all chains.
    pub fn freeze_nullifier(&self, nullifier: &str) -> Result<()> {
        let mut frozen = self.frozen_nullifiers.lock().map_err(|e| {
            AuditorError::FreezingFailed(format!("mutex lock: {e}"))
        })?;
        let normalized = nullifier.to_lowercase().trim().to_string();
        frozen.insert(normalized.clone());
        tracing::warn!(
            nullifier = %normalized.chars().take(12).collect::<String>(),
            "Auditor froze nullifier for compliance"
        );
        Ok(())
    }

    /// Unfreeze a nullifier (e.g., after court order reversed).
    pub fn unfreeze_nullifier(&self, nullifier: &str) -> Result<()> {
        let mut frozen = self.frozen_nullifiers.lock().map_err(|e| {
            AuditorError::FreezingFailed(format!("mutex lock: {e}"))
        })?;
        let normalized = nullifier.to_lowercase().trim().to_string();
        frozen.remove(&normalized);
        tracing::info!(
            nullifier = %normalized.chars().take(12).collect::<String>(),
            "Auditor unfroze nullifier"
        );
        Ok(())
    }
}

// ── Tax Computation ──────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaxBreakdown {
    pub gross_amount: u128,
    pub tax_rate: f64,
    pub tax_amount: u128,
    pub net_amount: u128,
    pub jurisdiction: String,
    pub tax_type: String,
}

impl TaxBreakdown {
    pub fn new(gross_amount: u128, tax_rate: f64, jurisdiction: String) -> Self {
        let tax_amount = ((gross_amount as f64) * tax_rate) as u128;
        let net_amount = gross_amount.saturating_sub(tax_amount);
        TaxBreakdown {
            gross_amount,
            tax_rate,
            tax_amount,
            net_amount,
            jurisdiction,
            tax_type: "Sales Tax".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_seed() -> &'static str {
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }

    #[test]
    fn test_keypair_from_seed_deterministic() {
        let kp1 = AuditorKeypair::from_seed(test_seed()).unwrap();
        let kp2 = AuditorKeypair::from_seed(test_seed()).unwrap();
        assert_eq!(kp1.public_key, kp2.public_key);
        assert_eq!(kp1.public_key.len(), 64); // 32 bytes hex-encoded
    }

    #[test]
    fn test_keypair_invalid_seed() {
        assert!(AuditorKeypair::from_seed("abc").is_err());
        assert!(AuditorKeypair::from_seed("not_hex_!!").is_err());
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let kp = AuditorKeypair::from_seed(test_seed()).unwrap();
        let client = AuditorClient::new(kp.clone());

        let tx = ShieldedTxData::new(0, 4_999_000, "owner_pk_hex".to_string());
        let plaintext = serde_json::to_vec(&tx).unwrap();

        // Encrypt to auditor's public key
        let memo = EncryptedMemo::encrypt(&plaintext, &kp.public_key).unwrap();

        // Auditor decrypts
        let decrypted = client.decrypt_shielded_tx(&memo).unwrap();

        assert_eq!(decrypted.asset, tx.asset);
        assert_eq!(decrypted.amount, tx.amount);
        assert_eq!(decrypted.owner_pk, tx.owner_pk);
    }

    #[test]
    fn test_wrong_key_fails_decryption() {
        let kp1 = AuditorKeypair::from_seed(test_seed()).unwrap();
        let kp2 = AuditorKeypair::generate().unwrap();

        let tx = ShieldedTxData::new(0, 1_000, "pk".to_string());
        let plaintext = serde_json::to_vec(&tx).unwrap();

        // Encrypt to kp1
        let memo = EncryptedMemo::encrypt(&plaintext, &kp1.public_key).unwrap();

        // Try to decrypt with kp2 — must fail
        let client2 = AuditorClient::new(kp2);
        let result = client2.decrypt_shielded_tx(&memo);
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let kp = AuditorKeypair::from_seed(test_seed()).unwrap();
        let client = AuditorClient::new(kp.clone());
        let plaintext = b"sensitive amount: 9999999";

        let mut memo = EncryptedMemo::encrypt(plaintext, &kp.public_key).unwrap();
        // Flip a bit in ciphertext
        let mut ct_bytes = hex::decode(&memo.ciphertext).unwrap();
        ct_bytes[0] ^= 0x01;
        memo.ciphertext = hex::encode(ct_bytes);

        let result = client.decrypt_shielded_tx(&memo);
        assert!(result.is_err());
    }

    #[test]
    fn test_encrypted_memo_serialization() {
        let kp = AuditorKeypair::from_seed(test_seed()).unwrap();
        let plaintext = b"test memo payload";
        let memo = EncryptedMemo::encrypt(plaintext, &kp.public_key).unwrap();

        let bytes = memo.to_bytes().unwrap();
        let memo2 = EncryptedMemo::from_bytes(&bytes).unwrap();

        assert_eq!(memo.ephemeral_pk, memo2.ephemeral_pk);
        assert_eq!(memo.ciphertext, memo2.ciphertext);
    }

    #[test]
    fn test_tax_breakdown() {
        let breakdown = TaxBreakdown::new(1_000_000, 0.08, "US_CA".to_string());
        assert_eq!(breakdown.tax_amount, 80_000);
        assert_eq!(breakdown.net_amount, 920_000);
    }
}
