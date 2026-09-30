package main

import (
	"context"
	"crypto/ecdsa"
	"fmt"

	"forge-crypto/mpc-signer/internal/ethtx"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

// signer.go holds the actual Ethereum transaction signing logic.
//
// Phase 0: a single shared ECDSA (secp256k1) key signs every transaction.
// This is intentionally simple so we can prove the end-to-end flow
// (request -> sign -> broadcast -> audit). It is NOT production-safe.
//
// Phase 1+: replace the single key with Binance TSS-Lib threshold signing,
// where the private key is never reconstructed and key shares are stored in
// HashiCorp Vault.

// SignedTransaction is the result of signing a SignRequest.
type SignedTransaction struct {
	RawTx     string // 0x-prefixed RLP-encoded signed transaction (ready to broadcast)
	Signature string // 0x-prefixed 65-byte [R || S || V] signature
	Hash      string // 0x-prefixed transaction hash
	From      string // signer address
}

// MPCSigner owns the signing key material.
type MPCSigner struct {
	privKey *ecdsa.PrivateKey
	address common.Address
}

// NewMPCSigner loads the shared signing key.
//
// If MPC_SIGNER_PRIVATE_KEY is set (0x-prefixed or bare hex), it is used so the
// signer address is stable across restarts (needed for nonce management in
// local testing). Otherwise a fresh ephemeral key is generated.
func NewMPCSigner(privKeyHex string) (*MPCSigner, error) {
	var (
		privKey *ecdsa.PrivateKey
		err     error
	)

	if privKeyHex != "" {
		// Accept an optional 0x prefix.
		if len(privKeyHex) >= 2 && privKeyHex[:2] == "0x" {
			privKeyHex = privKeyHex[2:]
		}
		privKey, err = crypto.HexToECDSA(privKeyHex)
		if err != nil {
			return nil, fmt.Errorf("invalid MPC_SIGNER_PRIVATE_KEY: %w", err)
		}
	} else {
		privKey, err = crypto.GenerateKey()
		if err != nil {
			return nil, fmt.Errorf("failed to generate signing key: %w", err)
		}
	}

	addr := crypto.PubkeyToAddress(privKey.PublicKey)
	return &MPCSigner{privKey: privKey, address: addr}, nil
}

// Address returns the signer's Ethereum address.
func (m *MPCSigner) Address() string {
	return m.address.Hex()
}

// SignTransaction builds an Ethereum transaction from the request (legacy or
// EIP-1559 depending on the fee fields) and signs it with the shared key.
func (m *MPCSigner) SignTransaction(ctx context.Context, req *SignRequest) (*SignedTransaction, error) {
	tx, signer, err := ethtx.Build(req)
	if err != nil {
		return nil, err
	}

	signedTx, err := types.SignTx(tx, signer, m.privKey)
	if err != nil {
		return nil, fmt.Errorf("signing failed: %w", err)
	}

	rawTx, err := signedTx.MarshalBinary()
	if err != nil {
		return nil, fmt.Errorf("failed to RLP-encode signed tx: %w", err)
	}

	// Canonical 65-byte [R || S || recovery] signature for the audit trail.
	// Derived by trying both recovery ids and keeping the one that recovers the
	// signer address — correct for legacy (EIP-155 v) and 1559 (yParity) alike.
	sig, err := m.compactSignature(signer.Hash(tx), signedTx)
	if err != nil {
		return nil, err
	}

	return &SignedTransaction{
		RawTx:     hexutil.Encode(rawTx),
		Signature: hexutil.Encode(sig),
		Hash:      signedTx.Hash().Hex(),
		From:      m.address.Hex(),
	}, nil
}

// compactSignature returns the 65-byte [R || S || V] signature where V is the
// 0/1 recovery id, independent of the transaction's encoded V convention.
func (m *MPCSigner) compactSignature(hash common.Hash, signedTx *types.Transaction) ([]byte, error) {
	_, r, s := signedTx.RawSignatureValues()
	sig := make([]byte, 65)
	r.FillBytes(sig[0:32])
	s.FillBytes(sig[32:64])
	for v := byte(0); v <= 1; v++ {
		sig[64] = v
		pub, err := crypto.SigToPub(hash.Bytes(), sig)
		if err != nil {
			continue
		}
		if crypto.PubkeyToAddress(*pub) == m.address {
			return sig, nil
		}
	}
	return nil, fmt.Errorf("failed to derive recovery id for signature")
}
