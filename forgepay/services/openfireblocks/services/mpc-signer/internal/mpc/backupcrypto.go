package mpc

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Backups of a node's key shares, encrypted so that only a recovery key can open them.
//
// The recovery key is an X25519 key pair made once, offline. The *public* half is
// configured on every node; the *private* half is split among officers with Shamir
// sharing (shamir.go) and never exists on any node or in any backup location. A node
// encrypts each backup to the public key with a fresh data key, so a stolen backup is
// useless without enough officers, and the node needs no secret to make one.
//
// Several recipients can be listed (for example a current and a successor recovery key
// during an officer change); any one of them opens the backup.
//
// What a backup holds is deliberately only what a replacement node needs: its identity
// key, its current key shares, its policy ledger and its audit log. Pre-parameters are
// regenerated, not backed up.

const backupFormat = "mpc-backup-v1"
const recipientPrefix = "fprec1:"

// RecoveryKey is the offline key pair that opens backups.
type RecoveryKey struct{ priv *ecdh.PrivateKey }

// NewRecoveryKey generates a recovery key pair.
func NewRecoveryKey() (*RecoveryKey, error) {
	k, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return &RecoveryKey{priv: k}, nil
}

// RecoveryKeyFromSecret rebuilds a recovery key from the 32 bytes that were split.
func RecoveryKeyFromSecret(secret []byte) (*RecoveryKey, error) {
	k, err := ecdh.X25519().NewPrivateKey(secret)
	if err != nil {
		return nil, fmt.Errorf("the rebuilt secret is not a recovery key: %w", err)
	}
	return &RecoveryKey{priv: k}, nil
}

// Secret returns the private key bytes, to be split among officers and then discarded.
func (r *RecoveryKey) Secret() []byte { return r.priv.Bytes() }

// Recipient is the public half, as configured on nodes.
func (r *RecoveryKey) Recipient() string {
	return recipientPrefix + hex.EncodeToString(r.priv.PublicKey().Bytes())
}

// ParseRecipient reads a configured recipient public key.
func ParseRecipient(s string) (*ecdh.PublicKey, error) {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, recipientPrefix) {
		return nil, errors.New("a backup recipient looks like fprec1:<64 hex characters>")
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(s, recipientPrefix))
	if err != nil {
		return nil, errors.New("backup recipient is not hex")
	}
	return ecdh.X25519().NewPublicKey(raw)
}

// RecipientFingerprint is a short stable name for a recovery key, for logs and status.
func RecipientFingerprint(pub *ecdh.PublicKey) string {
	h := sha256.Sum256(pub.Bytes())
	return hex.EncodeToString(h[:6])
}

type wrappedRecipient struct {
	Fingerprint  string `json:"fp"`
	EphemeralPub string `json:"epk"`
	Nonce        string `json:"nonce"`
	WrappedDEK   string `json:"wrapped_dek"`
}

// BackupEnvelope is the stored file. Everything in it is public except Ciphertext.
type BackupEnvelope struct {
	Format  string    `json:"format"`
	Node    string    `json:"node"`
	Created time.Time `json:"created"`
	// Epochs lists each backed-up key's epoch. It is not secret (key ids and epochs are not
	// key material) and lets old backups be recognised as superseded without opening them.
	Epochs     map[string]int     `json:"epochs"`
	Recipients []wrappedRecipient `json:"recipients"`
	Nonce      string             `json:"nonce"`
	Ciphertext string             `json:"ciphertext"`
}

// aad binds the header to the ciphertext, so a backup can't be relabelled (another node, another time).
func (e *BackupEnvelope) aad() []byte {
	keys := make([]string, 0, len(e.Epochs))
	for k := range e.Epochs {
		keys = append(keys, fmt.Sprintf("%s=%d", k, e.Epochs[k]))
	}
	sort.Strings(keys)
	var fps []string
	for _, r := range e.Recipients {
		fps = append(fps, r.Fingerprint)
	}
	return []byte(fmt.Sprintf("%s|%s|%s|%s|%s", e.Format, e.Node, e.Created.UTC().Format(time.RFC3339Nano), strings.Join(keys, ","), strings.Join(fps, ",")))
}

func gcmFor(key []byte) (cipher.AEAD, error) {
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(b)
}

// EncryptBackup seals plaintext to every recipient.
func EncryptBackup(plaintext []byte, node string, epochs map[string]int, created time.Time, recipients []*ecdh.PublicKey) ([]byte, error) {
	if len(recipients) == 0 {
		return nil, errors.New("a backup needs at least one recipient")
	}
	env := &BackupEnvelope{Format: backupFormat, Node: node, Created: created.UTC(), Epochs: epochs}
	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return nil, err
	}
	for _, r := range recipients {
		eph, err := ecdh.X25519().GenerateKey(rand.Reader)
		if err != nil {
			return nil, err
		}
		shared, err := eph.ECDH(r)
		if err != nil {
			return nil, err
		}
		kek := hkdf(shared, append(eph.PublicKey().Bytes(), r.Bytes()...), []byte(backupFormat+"|dek"))
		g, err := gcmFor(kek)
		if err != nil {
			return nil, err
		}
		nonce := make([]byte, g.NonceSize())
		if _, err := rand.Read(nonce); err != nil {
			return nil, err
		}
		env.Recipients = append(env.Recipients, wrappedRecipient{
			Fingerprint:  RecipientFingerprint(r),
			EphemeralPub: hex.EncodeToString(eph.PublicKey().Bytes()),
			Nonce:        hex.EncodeToString(nonce),
			WrappedDEK:   hex.EncodeToString(g.Seal(nil, nonce, dek, []byte(node))),
		})
	}
	g, err := gcmFor(dek)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	env.Nonce = hex.EncodeToString(nonce)
	env.Ciphertext = base64.StdEncoding.EncodeToString(g.Seal(nil, nonce, plaintext, env.aad()))
	return json.MarshalIndent(env, "", "  ")
}

// ParseBackup reads the envelope without opening it.
func ParseBackup(data []byte) (*BackupEnvelope, error) {
	var e BackupEnvelope
	if err := json.Unmarshal(data, &e); err != nil {
		return nil, fmt.Errorf("not a backup file: %w", err)
	}
	if e.Format != backupFormat {
		return nil, fmt.Errorf("unsupported backup format %q", e.Format)
	}
	return &e, nil
}

// DecryptBackup opens a backup with the recovery key. It fails if the key isn't a
// recipient, or if anything in the file — header or ciphertext — was altered.
func DecryptBackup(data []byte, key *RecoveryKey) ([]byte, *BackupEnvelope, error) {
	e, err := ParseBackup(data)
	if err != nil {
		return nil, nil, err
	}
	mine := RecipientFingerprint(key.priv.PublicKey())
	for _, r := range e.Recipients {
		if r.Fingerprint != mine {
			continue
		}
		epk, err1 := hex.DecodeString(r.EphemeralPub)
		nonce, err2 := hex.DecodeString(r.Nonce)
		wrapped, err3 := hex.DecodeString(r.WrappedDEK)
		if err1 != nil || err2 != nil || err3 != nil {
			return nil, nil, errors.New("backup recipient entry is malformed")
		}
		ephPub, err := ecdh.X25519().NewPublicKey(epk)
		if err != nil {
			return nil, nil, err
		}
		shared, err := key.priv.ECDH(ephPub)
		if err != nil {
			return nil, nil, err
		}
		kek := hkdf(shared, append(ephPub.Bytes(), key.priv.PublicKey().Bytes()...), []byte(backupFormat+"|dek"))
		g, err := gcmFor(kek)
		if err != nil {
			return nil, nil, err
		}
		dek, err := g.Open(nil, nonce, wrapped, []byte(e.Node))
		if err != nil {
			return nil, nil, errors.New("the backup's data key did not open (wrong recovery key, or the file was altered)")
		}
		gd, err := gcmFor(dek)
		if err != nil {
			return nil, nil, err
		}
		bn, err1 := hex.DecodeString(e.Nonce)
		ct, err2 := base64.StdEncoding.DecodeString(e.Ciphertext)
		if err1 != nil || err2 != nil {
			return nil, nil, errors.New("backup ciphertext is malformed")
		}
		plain, err := gd.Open(nil, bn, ct, e.aad())
		if err != nil {
			return nil, nil, errors.New("the backup failed authentication: it was altered, or its header was changed")
		}
		return plain, e, nil
	}
	return nil, nil, errors.New("this backup was not made for that recovery key")
}
