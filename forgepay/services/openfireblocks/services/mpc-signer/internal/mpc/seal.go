package mpc

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// Seal encrypts plaintext with AES-256-GCM. `aad` binds the ciphertext to what
// it is (e.g. "key|<keyId>"), so a sealed file can't be swapped for another.
func Seal(key, plaintext []byte, aad string) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, []byte(aad)), nil
}

// Open reverses Seal, failing if the ciphertext or aad was altered.
func Open(key, blob []byte, aad string) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	if len(blob) < gcm.NonceSize() {
		return nil, errors.New("sealed data too short")
	}
	nonce, ct := blob[:gcm.NonceSize()], blob[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, []byte(aad))
	if err != nil {
		return nil, errors.New("sealed data failed authentication (wrong key or tampered)")
	}
	return pt, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("seal key must be 32 bytes, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// LoadSealKey returns the key that seals this node's share and identity at
// rest. Production must supply MPC_NODE_SEAL_KEY (from Vault/KMS, 64 hex
// chars). In development a key file is created beside the data — which
// protects nothing if someone can read the directory, and says so.
func LoadSealKey(dataDir string) ([]byte, error) {
	if v := os.Getenv("MPC_NODE_SEAL_KEY"); v != "" {
		key, err := hex.DecodeString(v)
		if err != nil || len(key) != 32 {
			return nil, errors.New("MPC_NODE_SEAL_KEY must be 64 hex characters (32 bytes)")
		}
		return key, nil
	}
	if os.Getenv("MPC_ENV") == "production" {
		return nil, errors.New("MPC_NODE_SEAL_KEY is required when MPC_ENV=production")
	}
	path := filepath.Join(dataDir, "seal.key")
	if raw, err := os.ReadFile(path); err == nil {
		key, err := hex.DecodeString(string(raw))
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("%s is not a valid seal key", path)
		}
		return key, nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)), 0o600); err != nil {
		return nil, err
	}
	log.Printf("WARNING: no MPC_NODE_SEAL_KEY set; created %s. The share is only as safe as this directory. Set MPC_NODE_SEAL_KEY (from Vault/KMS) outside development.", path)
	return key, nil
}
