"""
Auditor Module for Privacy-Preserving MoR

ARCH: Implements ECDH (X25519) + SHA-256 KDF + AES-256-GCM decryption,
matching the Rust auditor crate wire format exactly.

Privacy guarantee: Only the auditor (holding the X25519 secret key) can
decrypt transaction memos. Merchants and the public ledger never see
plaintext amounts.

Note: X25519 is used as a production-grade stand-in for BabyJubjub ECDH.
When auditable-privacy-payment ships BabyJubjub, swap X25519PrivateKey for
the BabyJubjub equivalent while keeping AES-GCM layer identical.
"""

import asyncio
import concurrent.futures
import hashlib
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Optional

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PublicFormat,
    PrivateFormat,
    NoEncryption,
)

logger = logging.getLogger(__name__)


@dataclass
class ShieldedTxData:
    """Decrypted shielded transaction — what the auditor sees."""

    asset: int          # 0=USDC, 1=USDT
    amount: int         # Smallest unit (e.g., 1_000_000 = $1.00 USDC)
    owner_pk: str       # Owner public key (hex)
    nullifier: str      # Unique per UTXO + spender — prevents double-spend
    commitment: str     # Merkle tree leaf hash
    timestamp: int      # Unix seconds
    merchant_id: Optional[str] = None


@dataclass
class TaxBreakdown:
    """Tax calculation result from decrypted amount."""

    gross_amount: int
    tax_rate: float
    tax_amount: int
    net_amount: int
    jurisdiction: str
    tax_type: str


class AuditorClient:
    """
    Auditor service — decrypts shielded transaction memos using X25519 ECDH + AES-256-GCM.

    The secret key is held in memory only, loaded from Vault at startup.
    Never serialize or log the secret key.
    """

    def __init__(self, public_key_hex: str, secret_key_hex: str):
        """Internal constructor. Use from_seed() or generate() instead."""
        if len(public_key_hex) != 64:
            raise ValueError("public_key_hex must be 64 hex chars (32 bytes)")
        if len(secret_key_hex) != 64:
            raise ValueError("secret_key_hex must be 64 hex chars (32 bytes)")
        self._public_key_hex = public_key_hex
        self._secret_key_hex = secret_key_hex
        # In-memory frozen nullifier set.  For production this backs onto a
        # Redis cache which in turn mirrors the on-chain NullifierRegistry state.
        self._frozen_nullifiers: set[str] = set()

    @classmethod
    def from_seed(cls, seed_hex: str) -> "AuditorClient":
        """
        Derive a deterministic X25519 keypair from a hex seed.

        The seed is hashed with SHA-256 to produce the 32-byte secret key scalar,
        matching the Rust implementation exactly.

        Args:
            seed_hex: At least 64 hex characters (32 bytes)
        """
        seed_bytes = bytes.fromhex(seed_hex)
        if len(seed_bytes) < 32:
            raise ValueError("seed must be at least 32 bytes (64 hex chars)")

        # SHA-256(seed) → deterministic 32-byte private key
        sk_bytes = hashlib.sha256(seed_bytes).digest()
        private_key = X25519PrivateKey.from_private_bytes(sk_bytes)
        public_key = private_key.public_key()

        pk_hex = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
        sk_hex = private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption()).hex()

        return cls(public_key_hex=pk_hex, secret_key_hex=sk_hex)

    @classmethod
    def generate(cls) -> "AuditorClient":
        """Generate a random X25519 keypair using OS entropy."""
        private_key = X25519PrivateKey.generate()
        public_key = private_key.public_key()

        pk_hex = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
        sk_hex = private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption()).hex()

        return cls(public_key_hex=pk_hex, secret_key_hex=sk_hex)

    @property
    def public_key(self) -> str:
        """Auditor's X25519 public key hex — share this with clients for encryption."""
        return self._public_key_hex

    def decrypt_shielded_tx(self, memo_bytes: bytes) -> ShieldedTxData:
        """
        Decrypt an encrypted transaction memo using ECDH + AES-256-GCM.

        Wire format (JSON, hex-encoded fields):
        {
            "ephemeral_pk": "<32 bytes hex>",
            "nonce":        "<12 bytes hex>",
            "ciphertext":   "<N bytes hex>",
            "auth_tag":     "<16 bytes hex>"
        }

        Decryption flow:
        1. Parse ephemeral_pk from memo JSON
        2. ECDH(auditor_sk, ephemeral_pk) → 32-byte shared secret
        3. symmetric_key = SHA-256(shared_secret)
        4. AES-256-GCM decrypt(ciphertext + auth_tag, nonce, symmetric_key)
        5. JSON deserialize plaintext → ShieldedTxData

        Raises:
            ValueError: Tampered ciphertext, wrong key, or malformed memo
        """
        logger.debug("Decrypting shielded transaction (%d bytes)", len(memo_bytes))

        try:
            memo = json.loads(memo_bytes)
        except json.JSONDecodeError as e:
            raise ValueError(f"Memo is not valid JSON: {e}") from e

        # 1. Parse ephemeral public key
        try:
            eph_bytes = bytes.fromhex(memo["ephemeral_pk"])
            if len(eph_bytes) != 32:
                raise ValueError("ephemeral_pk must be 32 bytes")
            ephemeral_pk = X25519PublicKey.from_public_bytes(eph_bytes)
        except (KeyError, ValueError) as e:
            raise ValueError(f"Invalid ephemeral_pk in memo: {e}") from e

        # 2. Load auditor secret key and perform ECDH
        sk_bytes = bytes.fromhex(self._secret_key_hex)
        private_key = X25519PrivateKey.from_private_bytes(sk_bytes)
        shared_secret = private_key.exchange(ephemeral_pk)

        # 3. SHA-256 KDF (matches Rust: sha2::Sha256::digest(shared_secret))
        symmetric_key = hashlib.sha256(shared_secret).digest()

        # 4. AES-256-GCM decrypt — reconstruct ciphertext || auth_tag
        try:
            nonce = bytes.fromhex(memo["nonce"])
            ciphertext = bytes.fromhex(memo["ciphertext"])
            auth_tag = bytes.fromhex(memo["auth_tag"])
        except (KeyError, ValueError) as e:
            raise ValueError(f"Malformed memo fields: {e}") from e

        if len(nonce) != 12:
            raise ValueError("nonce must be 12 bytes")

        full_ciphertext = ciphertext + auth_tag  # aes-gcm format: ct || tag

        aesgcm = AESGCM(symmetric_key)
        try:
            plaintext = aesgcm.decrypt(nonce, full_ciphertext, None)
        except Exception as e:
            raise ValueError(
                "AES-GCM authentication failed — memo tampered or wrong key"
            ) from e

        # 5. Deserialize JSON plaintext
        try:
            data = json.loads(plaintext)
            return ShieldedTxData(
                asset=data["asset"],
                amount=data["amount"],
                owner_pk=data["owner_pk"],
                nullifier=data["nullifier"],
                commitment=data["commitment"],
                timestamp=data["timestamp"],
                merchant_id=data.get("merchant_id"),
            )
        except (json.JSONDecodeError, KeyError) as e:
            raise ValueError(f"Decrypted payload is not valid ShieldedTxData: {e}") from e

    @staticmethod
    def encrypt_memo(plaintext: dict, auditor_pk_hex: str) -> bytes:
        """
        Encrypt a transaction memo to an auditor's X25519 public key.

        Used by clients (browser SDK) to encrypt before sending to MoR.
        This is the encryption counterpart to decrypt_shielded_tx().

        Args:
            plaintext: Dict matching ShieldedTxData fields
            auditor_pk_hex: Auditor's 32-byte X25519 public key (hex)

        Returns:
            JSON bytes of EncryptedMemo wire format
        """
        pk_bytes = bytes.fromhex(auditor_pk_hex)
        if len(pk_bytes) != 32:
            raise ValueError("auditor_pk_hex must be 32 bytes")
        auditor_pk = X25519PublicKey.from_public_bytes(pk_bytes)

        # Generate ephemeral keypair
        ephemeral_sk = X25519PrivateKey.generate()
        ephemeral_pk = ephemeral_sk.public_key()
        shared_secret = ephemeral_sk.exchange(auditor_pk)

        # SHA-256 KDF
        symmetric_key = hashlib.sha256(shared_secret).digest()

        # AES-256-GCM encrypt
        nonce = secrets.token_bytes(12)
        aesgcm = AESGCM(symmetric_key)
        payload = json.dumps(plaintext).encode()
        ciphertext_with_tag = aesgcm.encrypt(nonce, payload, None)

        # Split ciphertext and auth tag (last 16 bytes)
        ciphertext = ciphertext_with_tag[:-16]
        auth_tag = ciphertext_with_tag[-16:]

        memo = {
            "ephemeral_pk": ephemeral_pk.public_bytes(Encoding.Raw, PublicFormat.Raw).hex(),
            "nonce": nonce.hex(),
            "ciphertext": ciphertext.hex(),
            "auth_tag": auth_tag.hex(),
        }
        return json.dumps(memo).encode()

    def verify_audit_proof(self, proof_bytes: bytes) -> bool:
        """
        Verify a Groth16 audit circuit proof.

        Structural validation: a valid Groth16 proof over BN254 is
        2 G1 points (32 bytes each compressed) + 1 G2 point (64 bytes compressed)
        = 128 bytes total in compressed arkworks format.
        OR it could be the ABI-encoded format:
        (uint256[2], uint256[2][2], uint256[2]) = 256 bytes.
        Accept either format for compatibility.

        TODO: Call Groth16Verifier.verifyProof() once VK is set and contracts deployed.
        """
        if len(proof_bytes) not in (128, 256):
            logger.warning(
                "Invalid proof length %d (expected 128 or 256 bytes)", len(proof_bytes)
            )
            return False
        # In stub mode (before circuit finalization), accept any structurally valid proof.
        # TODO: Call Groth16Verifier.verifyProof() once VK is set and contracts deployed.
        logger.info("Audit proof structurally valid (%d bytes)", len(proof_bytes))
        return True

    def is_nullifier_frozen(self, nullifier_hex: str) -> bool:
        """
        Check if a nullifier is in the compliance freeze set.

        Checks the in-memory set first (fast path).  For production this would
        also query the NullifierRegistry contract on-chain via Web3.
        """
        normalized = nullifier_hex.lower().strip()
        if normalized in self._frozen_nullifiers:
            return True
        # TODO: Also query NullifierRegistry contract via Web3 when chain config available.
        return False

    def freeze_nullifier(self, nullifier_hex: str, reason: str = "auditor freeze") -> None:
        """
        Freeze a nullifier for compliance (sanctions, fraud, court order).

        Adds to the in-memory set and emits a warning log.
        TODO: Also INSERT into frozen_nullifiers table and call
        NullifierRegistry.freezeNullifier() on all EVM chains.
        """
        normalized = nullifier_hex.lower().strip()
        self._frozen_nullifiers.add(normalized)
        logger.warning(
            "Auditor froze nullifier %s: %s", normalized[:12], reason
        )

    def unfreeze_nullifier(self, nullifier_hex: str) -> None:
        """
        Remove a nullifier from the compliance freeze set.

        TODO: Also remove from frozen_nullifiers table and call
        NullifierRegistry.unfreezeNullifier() on all EVM chains.
        """
        self._frozen_nullifiers.discard(nullifier_hex.lower().strip())

    def rotate_keys(self, new_seed: str) -> "AuditorClient":
        """
        Rotate auditor keys (recommended annually).

        Old keys are kept as read-only archives for decrypting historical memos.
        TODO: Archive old public key in DB before rotating.
        """
        logger.info("Rotating auditor keys")
        return AuditorClient.from_seed(new_seed)

    def __repr__(self) -> str:
        return f"AuditorClient(pk={self._public_key_hex[:16]}...)"


async def compute_tax_on_shielded(
    client: AuditorClient, memo_bytes: bytes, jurisdiction: str
) -> TaxBreakdown:
    """
    Decrypt a shielded transaction memo and compute applicable tax.

    Main integration point between the auditor and MoR checkout endpoint.
    Uses the production TaxCalculator (Avalara/TaxJar fallback to internal rules).

    Args:
        client: AuditorClient with decryption key
        memo_bytes: Encrypted memo (JSON wire format from EncryptedMemo.encrypt())
        jurisdiction: Tax jurisdiction string (e.g., "US_CA", "EU_DE")

    Returns:
        TaxBreakdown with gross/tax/net amounts

    Note: This function is async to support async TaxCalculator.calculate().
    """
    tx_data = client.decrypt_shielded_tx(memo_bytes)
    logger.info(
        "Decrypted shielded tx: asset=%d amount=%d jurisdiction=%s",
        tx_data.asset, tx_data.amount, jurisdiction,
    )

    # Parse jurisdiction string into country/state components
    # E.g., "US_CA" → country="US", state="CA"; "EU_DE" → country="DE"
    jurisdiction_parts = jurisdiction.split("_", 1)
    country = jurisdiction_parts[0]
    state = jurisdiction_parts[1] if len(jurisdiction_parts) > 1 else None

    # Use real TaxCalculator to compute tax on decrypted amount
    from src.tax.calculator import TaxCalculator
    calculator = TaxCalculator()

    # Amount is in smallest unit (cents for USDC/USDT)
    amount_cents = int(tx_data.amount)
    tax_result = await calculator.calculate(amount_cents, country, state)

    # If no tax applies, return zero breakdown
    if tax_result is None:
        return TaxBreakdown(
            gross_amount=tx_data.amount,
            tax_rate=0.0,
            tax_amount=0,
            net_amount=tx_data.amount,
            jurisdiction=jurisdiction,
            tax_type="No Tax",
        )

    # Otherwise, use the computed tax breakdown
    return TaxBreakdown(
        gross_amount=tx_data.amount,
        tax_rate=float(tax_result.rate),
        tax_amount=tax_result.amount_cents,
        net_amount=tx_data.amount - tax_result.amount_cents,
        jurisdiction=jurisdiction,
        tax_type=tax_result.tax_type,
    )
