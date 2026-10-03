package mpc

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"

	"golang.org/x/crypto/scrypt"
)

// A recovery share on a USB stick is as good as its owner's pocket. Protecting it with a passphrase means a lost or
// stolen stick is not a lost share: the thief needs the passphrase too, and the officer needs both to take part in a
// recovery. The passphrase never touches disk and is not known to anyone else, so no one can rebuild the share without
// its officer.
//
//	fpshare-enc1.<base64(salt ‖ nonce ‖ AES-256-GCM(share text))>
//
// scrypt N=2^15, r=8, p=1 (about 100ms): deliberately slow to guess, still instant for a person.

const protectedPrefix = "fpshare-enc1."

const (
	scryptN   = 1 << 15
	scryptR   = 8
	scryptP   = 1
	saltBytes = 16
)

// IsProtectedShare reports whether text is a passphrase-protected share.
func IsProtectedShare(text string) bool {
	return strings.HasPrefix(strings.TrimSpace(text), protectedPrefix)
}

// ProtectShare encrypts a share's text under a passphrase.
func ProtectShare(shareText, passphrase string) (string, error) {
	if len(passphrase) < 12 {
		return "", errors.New("the passphrase must be at least 12 characters")
	}
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	gcm, err := shareGCM(passphrase, salt)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nil, nonce, []byte(strings.TrimSpace(shareText)), []byte(protectedPrefix))
	return protectedPrefix + base64.RawStdEncoding.EncodeToString(append(append(salt, nonce...), ct...)), nil
}

// UnprotectShare reverses ProtectShare. A wrong passphrase and a damaged file are indistinguishable by design.
func UnprotectShare(text, passphrase string) (string, error) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, protectedPrefix) {
		return "", errors.New("not a protected share")
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(text, protectedPrefix))
	if err != nil || len(raw) < saltBytes+12+16 {
		return "", errors.New("the protected share is damaged")
	}
	salt := raw[:saltBytes]
	gcm, err := shareGCM(passphrase, salt)
	if err != nil {
		return "", err
	}
	nonce, ct := raw[saltBytes:saltBytes+gcm.NonceSize()], raw[saltBytes+gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, []byte(protectedPrefix))
	if err != nil {
		return "", errors.New("wrong passphrase, or the protected share is damaged")
	}
	return string(plain), nil
}

func shareGCM(passphrase string, salt []byte) (cipher.AEAD, error) {
	key, err := scrypt.Key([]byte(passphrase), salt, scryptN, scryptR, scryptP, 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
