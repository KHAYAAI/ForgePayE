package mpc

import (
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// PublicIdentity is the part of a node's identity that goes into the cluster
// file. It contains no secret.
type PublicIdentity struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	X25519Pub string `json:"x25519_pub"`
	Domain    string `json:"domain"`
}

// InitIdentity creates this node's message-encryption keypair (sealed on disk)
// and writes its public half to identity.json. It refuses to run twice: a node
// that silently replaced its identity would be unable to read its own peers'
// history and would invalidate the cluster file.
func InitIdentity(dataDir, id, url, domain string, sealKey []byte) (*PublicIdentity, error) {
	if !ValidID(id) {
		return nil, fmt.Errorf("invalid node id %q", id)
	}
	sealedPath := filepath.Join(dataDir, "identity.sealed")
	if _, err := os.Stat(sealedPath); err == nil {
		return nil, errors.New("this node already has an identity")
	}
	priv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	sealed, err := Seal(sealKey, priv.Bytes(), "identity|"+id)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(sealedPath, sealed, 0o600); err != nil {
		return nil, err
	}
	pub := &PublicIdentity{ID: id, URL: url, X25519Pub: hex.EncodeToString(priv.PublicKey().Bytes()), Domain: domain}
	raw, _ := json.MarshalIndent(pub, "", "  ")
	return pub, os.WriteFile(filepath.Join(dataDir, "identity.json"), raw, 0o644)
}

// LoadIdentity returns the node's private key and the matching public key bytes.
func LoadIdentity(dataDir, id string, sealKey []byte) (*ecdh.PrivateKey, []byte, error) {
	raw, err := os.ReadFile(filepath.Join(dataDir, "identity.sealed"))
	if err != nil {
		return nil, nil, fmt.Errorf("node has no identity (run `mpc-node init`): %w", err)
	}
	plain, err := Open(sealKey, raw, "identity|"+id)
	if err != nil {
		return nil, nil, fmt.Errorf("identity: %w", err)
	}
	priv, err := ecdh.X25519().NewPrivateKey(plain)
	if err != nil {
		return nil, nil, err
	}
	return priv, priv.PublicKey().Bytes(), nil
}

// NewCoordinatorKey generates the ed25519 key the coordinator signs session
// requests with. Only its public half is shared with nodes.
func NewCoordinatorKey(path string) (ed25519.PublicKey, error) {
	if _, err := os.Stat(path); err == nil {
		return nil, errors.New("coordinator key already exists")
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return pub, os.WriteFile(path, []byte(hex.EncodeToString(priv.Seed())), 0o600)
}

func LoadCoordinatorKey(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	seed, err := hex.DecodeString(string(raw))
	if err != nil || len(seed) != ed25519.SeedSize {
		return nil, errors.New("coordinator key file is not a valid seed")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}
