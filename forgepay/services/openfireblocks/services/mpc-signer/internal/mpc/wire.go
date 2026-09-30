package mpc

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
)

// PeerMessage is one tss protocol message in transit between two nodes. The
// payload is encrypted and authenticated with a key only those two nodes can
// derive, so the network (and the coordinator, which never sees these) learns
// nothing from it — round-two keygen messages carry secret shares in the clear
// inside tss-lib, so this encryption is what stops an eavesdropper collecting
// them.
type PeerMessage struct {
	Session   string `json:"session"`
	From      string `json:"from"`
	To        string `json:"to"`
	Seq       uint64 `json:"seq"` // per-sender, per-session; lets a receiver drop duplicates
	Broadcast bool   `json:"broadcast"`
	Type      string `json:"type"`
	Nonce     []byte `json:"nonce"`
	Payload   []byte `json:"payload"`
}

func hkdf(secret, salt, info []byte) []byte {
	ext := hmac.New(sha256.New, salt)
	ext.Write(secret)
	prk := ext.Sum(nil)
	exp := hmac.New(sha256.New, prk)
	exp.Write(info)
	exp.Write([]byte{1})
	return exp.Sum(nil)
}

func pairAEAD(priv *ecdh.PrivateKey, peerPub *ecdh.PublicKey, session, from, to string) (cipher.AEAD, error) {
	secret, err := priv.ECDH(peerPub)
	if err != nil {
		return nil, err
	}
	// Direction is part of the key, so a message can't be reflected back at its sender.
	key := hkdf(secret, []byte(session), []byte("mpc-msg|"+from+"|"+to))
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func messageAAD(m *PeerMessage) []byte {
	return []byte(fmt.Sprintf("%s|%s|%s|%d|%t|%s", m.Session, m.From, m.To, m.Seq, m.Broadcast, m.Type))
}

// EncryptMessage fills in Nonce and Payload for m from the plaintext tss wire bytes.
func EncryptMessage(priv *ecdh.PrivateKey, peerPub *ecdh.PublicKey, m *PeerMessage, plaintext []byte) error {
	aead, err := pairAEAD(priv, peerPub, m.Session, m.From, m.To)
	if err != nil {
		return err
	}
	m.Nonce = make([]byte, aead.NonceSize())
	if _, err := rand.Read(m.Nonce); err != nil {
		return err
	}
	m.Payload = aead.Seal(nil, m.Nonce, plaintext, messageAAD(m))
	return nil
}

// DecryptMessage returns the tss wire bytes, or an error if m wasn't produced
// by the node it claims to come from, was altered, or was addressed elsewhere.
func DecryptMessage(priv *ecdh.PrivateKey, peerPub *ecdh.PublicKey, m *PeerMessage) ([]byte, error) {
	aead, err := pairAEAD(priv, peerPub, m.Session, m.From, m.To)
	if err != nil {
		return nil, err
	}
	if len(m.Nonce) != aead.NonceSize() {
		return nil, errors.New("bad nonce")
	}
	pt, err := aead.Open(nil, m.Nonce, m.Payload, messageAAD(m))
	if err != nil {
		return nil, errors.New("peer message failed authentication")
	}
	return pt, nil
}

// SignBody signs raw request bytes with the coordinator's key.
func SignBody(priv ed25519.PrivateKey, body []byte) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(priv, body))
}

// VerifyBody checks a coordinator signature over the exact bytes received.
func VerifyBody(pub ed25519.PublicKey, body []byte, sigB64 string) bool {
	sig, err := base64.StdEncoding.DecodeString(sigB64)
	return err == nil && len(sig) == ed25519.SignatureSize && ed25519.Verify(pub, body, sig)
}

func itoa(n uint64) string { return strconv.FormatUint(n, 10) }
