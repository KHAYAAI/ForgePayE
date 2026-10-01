package mpc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// What goes into a backup, how it is put back, and how to tell what a set of backups can recover.

// KeyInventory is the public description of one key share held in a backup.
type KeyInventory struct {
	KeyID        string   `json:"keyId"`
	Epoch        int      `json:"epoch"`
	Address      string   `json:"address"`
	PublicKey    string   `json:"publicKey"`
	Threshold    int      `json:"threshold"`
	Participants []string `json:"participants"`
}

// BackupKey is one share, as plaintext, inside the encrypted payload.
type BackupKey struct {
	File      string `json:"file"`      // the file name it had under keys/ (e.g. "ws-a.e2.sealed")
	Plaintext []byte `json:"plaintext"` // the storedKey JSON, including the share
}

// BackupPayload is the plaintext that is encrypted into a backup. It exists in memory
// while a backup is made or restored, and nowhere on disk unencrypted.
type BackupPayload struct {
	Version        int            `json:"version"`
	Node           string         `json:"node"`
	Created        time.Time      `json:"created"`
	IdentityPublic []byte         `json:"identity_public"` // identity.json: the node's public face (url, domain, public key)
	IdentitySecret []byte         `json:"identity_secret"` // the node's X25519 private key
	Keys           []BackupKey    `json:"keys"`
	Inventory      []KeyInventory `json:"inventory"`
	PolicyLedger   []byte         `json:"policy_ledger,omitempty"`
	AuditLog       []byte         `json:"audit_log,omitempty"`
	Cluster        []byte         `json:"cluster,omitempty"`
}

const maxAuditBackupBytes = 32 << 20

// buildBackupPayload reads this node's state under the key lock, so a backup never captures a
// half-written share. Only the newest active share of each key is included: an older one still
// on disk is superseded, and a backup that kept it would undo the point of a reshare.
func (n *Node) buildBackupPayload(clusterFile string) (*BackupPayload, error) {
	n.keyMu.Lock()
	defer n.keyMu.Unlock()

	p := &BackupPayload{Version: 1, Node: n.cfg.ID, Created: time.Now().UTC(), IdentitySecret: n.priv.Bytes()}
	if raw, err := os.ReadFile(filepath.Join(n.cfg.DataDir, "identity.json")); err == nil {
		p.IdentityPublic = raw
	}

	entries, err := os.ReadDir(filepath.Join(n.cfg.DataDir, "keys"))
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	newest := map[string]keyFile{}
	for _, e := range entries {
		id, epoch, ok := parseKeyFile(e.Name())
		if !ok || strings.HasSuffix(e.Name(), ".pending") {
			continue
		}
		if cur, seen := newest[id]; !seen || epoch > cur.epoch {
			newest[id] = keyFile{path: filepath.Join(n.cfg.DataDir, "keys", e.Name()), epoch: epoch}
		}
	}
	ids := make([]string, 0, len(newest))
	for id := range newest {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		kf := newest[id]
		raw, err := os.ReadFile(kf.path)
		if err != nil {
			return nil, err
		}
		plain, err := Open(n.cfg.SealKey, raw, keyAAD(id, kf.epoch))
		if err != nil {
			return nil, fmt.Errorf("share %s does not open with this node's seal key: %w", filepath.Base(kf.path), err)
		}
		var k storedKey
		if err := json.Unmarshal(plain, &k); err != nil {
			return nil, err
		}
		p.Keys = append(p.Keys, BackupKey{File: filepath.Base(kf.path), Plaintext: plain})
		p.Inventory = append(p.Inventory, KeyInventory{KeyID: k.KeyID, Epoch: k.Epoch, Address: k.Address, PublicKey: k.PublicKey, Threshold: k.Threshold, Participants: k.Participants})
	}
	p.PolicyLedger, _ = os.ReadFile(filepath.Join(n.cfg.DataDir, "policy-ledger.jsonl"))
	if fi, err := os.Stat(filepath.Join(n.cfg.DataDir, "audit.log")); err == nil && fi.Size() <= maxAuditBackupBytes {
		p.AuditLog, _ = os.ReadFile(filepath.Join(n.cfg.DataDir, "audit.log"))
	}
	if clusterFile != "" {
		p.Cluster, _ = os.ReadFile(clusterFile)
	}
	return p, nil
}

// Epochs maps each key in the payload to its epoch.
func (p *BackupPayload) Epochs() map[string]int {
	m := make(map[string]int, len(p.Inventory))
	for _, k := range p.Inventory {
		m[k.KeyID] = k.Epoch
	}
	return m
}

// Verify checks a payload is internally sound: every share parses, belongs to the key and epoch
// it is filed under, reproduces the address it claims, and names this node as a holder.
func (p *BackupPayload) Verify() error {
	if p.Version != 1 {
		return fmt.Errorf("unsupported backup payload version %d", p.Version)
	}
	if len(p.IdentitySecret) != 32 {
		return errors.New("the backup holds no usable node identity key")
	}
	if len(p.Keys) != len(p.Inventory) {
		return errors.New("the backup's inventory does not match its shares")
	}
	for i, bk := range p.Keys {
		id, epoch, ok := parseKeyFile(bk.File)
		if !ok {
			return fmt.Errorf("unrecognised share file name %q", bk.File)
		}
		var k storedKey
		if err := json.Unmarshal(bk.Plaintext, &k); err != nil {
			return fmt.Errorf("share %s is unreadable: %w", bk.File, err)
		}
		if k.KeyID != id || k.Epoch != epoch {
			return fmt.Errorf("share %s describes %s epoch %d, not the key and epoch it is filed under", bk.File, k.KeyID, k.Epoch)
		}
		if k.Save.ECDSAPub == nil || k.Save.Xi == nil {
			return fmt.Errorf("share %s holds no secret share", bk.File)
		}
		if addr, pub := publicKeyHex(&k.Save); !strings.EqualFold(addr, k.Address) || !strings.EqualFold(pub, k.PublicKey) {
			return fmt.Errorf("share %s does not reproduce the address it claims", bk.File)
		}
		if !contains(k.Participants, p.Node) {
			return fmt.Errorf("share %s lists committee %v, which does not include %s", bk.File, k.Participants, p.Node)
		}
		inv := p.Inventory[i]
		if inv.KeyID != k.KeyID || inv.Epoch != k.Epoch || !strings.EqualFold(inv.Address, k.Address) {
			return fmt.Errorf("the inventory entry for %s does not match the share", bk.File)
		}
	}
	return nil
}

// RestoreResult says what a restore did.
type RestoreResult struct {
	Node       string         `json:"node"`
	Keys       []KeyInventory `json:"keys"`
	BackupTime time.Time      `json:"backupTime"`
}

// RestoreInto writes a verified payload into an empty data directory, sealed under sealKey
// (which is the *new* node's seal key — it need not be, and usually isn't, the old one).
//
// The old audit log is kept beside the new one as audit.restored.log rather than continued:
// the restored node starts its own tamper-evident chain, and the old one stays readable for
// whoever has to explain what happened. Pre-parameters are not restored; the node
// regenerates them.
func RestoreInto(p *BackupPayload, destDir string, sealKey []byte) (*RestoreResult, error) {
	if err := p.Verify(); err != nil {
		return nil, fmt.Errorf("refusing to restore: %w", err)
	}
	if entries, err := os.ReadDir(destDir); err == nil {
		for _, e := range entries {
			if e.Name() != "seal.key" { // the new node's seal key may already be there
				return nil, fmt.Errorf("%s is not empty (%s); restore into a fresh directory so nothing is overwritten", destDir, e.Name())
			}
		}
	}
	if err := os.MkdirAll(filepath.Join(destDir, "keys"), 0o700); err != nil {
		return nil, err
	}
	sealedID, err := Seal(sealKey, p.IdentitySecret, "identity|"+p.Node)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(destDir, "identity.sealed"), sealedID, 0o600); err != nil {
		return nil, err
	}
	if len(p.IdentityPublic) > 0 {
		if err := os.WriteFile(filepath.Join(destDir, "identity.json"), p.IdentityPublic, 0o644); err != nil {
			return nil, err
		}
	}
	for _, bk := range p.Keys {
		id, epoch, _ := parseKeyFile(bk.File)
		sealed, err := Seal(sealKey, bk.Plaintext, keyAAD(id, epoch))
		if err != nil {
			return nil, err
		}
		if err := os.WriteFile(filepath.Join(destDir, "keys", bk.File), sealed, 0o600); err != nil {
			return nil, err
		}
	}
	if len(p.PolicyLedger) > 0 {
		_ = os.WriteFile(filepath.Join(destDir, "policy-ledger.jsonl"), p.PolicyLedger, 0o600)
	}
	if len(p.AuditLog) > 0 {
		_ = os.WriteFile(filepath.Join(destDir, "audit.restored.log"), p.AuditLog, 0o600)
	}
	if len(p.Cluster) > 0 {
		_ = os.WriteFile(filepath.Join(destDir, "cluster.restored.json"), p.Cluster, 0o644)
	}
	res := &RestoreResult{Node: p.Node, Keys: p.Inventory, BackupTime: p.Created}
	raw, _ := json.MarshalIndent(res, "", "  ")
	_ = os.WriteFile(filepath.Join(destDir, "restore-report.json"), raw, 0o600)
	return res, nil
}

// OpenBackupFile decrypts a backup with a recovery key and checks it.
func OpenBackupFile(data []byte, key *RecoveryKey) (*BackupPayload, *BackupEnvelope, error) {
	plain, env, err := DecryptBackup(data, key)
	if err != nil {
		return nil, nil, err
	}
	var p BackupPayload
	if err := json.Unmarshal(plain, &p); err != nil {
		return nil, nil, fmt.Errorf("backup payload is unreadable: %w", err)
	}
	if p.Node != env.Node {
		return nil, nil, errors.New("the backup's header and contents name different nodes")
	}
	return &p, env, p.Verify()
}

// ── What can a set of backups recover? ────────────────────────────────────────

// RecoveryOutcome is one key's recoverability from the backups at hand.
type RecoveryOutcome struct {
	KeyID       string   `json:"keyId"`
	Address     string   `json:"address"`
	Epoch       int      `json:"epoch"`
	Threshold   int      `json:"threshold"`
	Needed      int      `json:"needed"`
	Holders     []string `json:"holders"`
	Recoverable bool     `json:"recoverable"`
	Note        string   `json:"note,omitempty"`
}

// PlanRecovery says, for each key, whether the backups at hand hold enough shares *of the same
// epoch* to sign again. Shares of different epochs never combine, so for each key it considers the
// newest epoch with enough holders and reports older/newer leftovers.
func PlanRecovery(payloads []*BackupPayload) []RecoveryOutcome {
	type bucket struct {
		inv     KeyInventory
		holders map[string]bool
	}
	buckets := map[string]*bucket{} // keyId|epoch
	keys := map[string]bool{}
	for _, p := range payloads {
		for _, inv := range p.Inventory {
			k := fmt.Sprintf("%s|%d", inv.KeyID, inv.Epoch)
			b := buckets[k]
			if b == nil {
				b = &bucket{inv: inv, holders: map[string]bool{}}
				buckets[k] = b
			}
			b.holders[p.Node] = true
			keys[inv.KeyID] = true
		}
	}
	var out []RecoveryOutcome
	for keyID := range keys {
		var best *RecoveryOutcome
		var others []string
		for _, b := range buckets {
			if b.inv.KeyID != keyID {
				continue
			}
			holders := make([]string, 0, len(b.holders))
			for h := range b.holders {
				holders = append(holders, h)
			}
			sort.Strings(holders)
			o := RecoveryOutcome{KeyID: keyID, Address: b.inv.Address, Epoch: b.inv.Epoch, Threshold: b.inv.Threshold, Needed: b.inv.Threshold + 1, Holders: holders, Recoverable: len(holders) >= b.inv.Threshold+1}
			if best == nil || (o.Recoverable && !best.Recoverable) || (o.Recoverable == best.Recoverable && o.Epoch > best.Epoch) {
				if best != nil {
					others = append(others, fmt.Sprintf("epoch %d has %d of %d", best.Epoch, len(best.Holders), best.Needed))
				}
				c := o
				best = &c
			} else {
				others = append(others, fmt.Sprintf("epoch %d has %d of %d", o.Epoch, len(o.Holders), o.Needed))
			}
		}
		sort.Strings(others)
		if best != nil {
			switch {
			case !best.Recoverable:
				best.Note = fmt.Sprintf("NOT recoverable: only %d of the %d shares needed are in these backups", len(best.Holders), best.Needed)
			case len(others) > 0:
				best.Note = "recoverable at this epoch; also present: " + strings.Join(others, "; ")
			}
			out = append(out, *best)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].KeyID < out[j].KeyID })
	return out
}

// backupName is the object name for a backup.
func backupName(node string, created time.Time, keys int, ciphertext []byte) string {
	h := sha256.Sum256(ciphertext)
	return fmt.Sprintf("%s/%s-%dkeys-%s.mpcbackup", node, created.UTC().Format("20060102T150405Z"), keys, hex.EncodeToString(h[:4]))
}

func marshalPayload(p *BackupPayload) ([]byte, error) { return json.Marshal(p) }
