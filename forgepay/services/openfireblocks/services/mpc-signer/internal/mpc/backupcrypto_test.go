package mpc

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func combos(n, k int) [][]int {
	var out [][]int
	var rec func(start int, cur []int)
	rec = func(start int, cur []int) {
		if len(cur) == k {
			out = append(out, append([]int(nil), cur...))
			return
		}
		for i := start; i < n; i++ {
			rec(i+1, append(cur, i))
		}
	}
	rec(0, nil)
	return out
}

func TestShamirEverySubsetReconstructs(t *testing.T) {
	secret := make([]byte, 32)
	rand.Read(secret)
	shares, err := SplitSecret(secret, 3, 5)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range combos(5, 3) {
		sub := []Share{shares[c[0]], shares[c[1]], shares[c[2]]}
		got, err := CombineShares(sub)
		if err != nil || !bytes.Equal(got, secret) {
			t.Fatalf("subset %v failed: %v", c, err)
		}
	}
	for _, c := range combos(5, 2) {
		if got, err := CombineShares([]Share{shares[c[0]], shares[c[1]]}); err == nil {
			t.Fatalf("2 shares combined into %x", got)
		}
	}
}

func TestShamirRejectsBadInput(t *testing.T) {
	secret := bytes.Repeat([]byte{7}, 32)
	a, _ := SplitSecret(secret, 2, 3)
	b, _ := SplitSecret(secret, 2, 3) // a different split of the same secret
	if _, err := CombineShares([]Share{a[0], a[0]}); err == nil {
		t.Fatal("duplicate share accepted")
	}
	if _, err := CombineShares([]Share{a[0], b[1]}); err == nil {
		t.Fatal("shares from different splits accepted")
	}
	// Tampered data must not silently produce a wrong secret.
	bad := a[1]
	bad.Data = append([]byte(nil), bad.Data...)
	bad.Data[0] ^= 1
	if got, err := CombineShares([]Share{a[0], bad}); err == nil {
		t.Fatalf("tampered share accepted, gave %x", got)
	}
	if _, err := SplitSecret(secret, 1, 3); err == nil {
		t.Fatal("k=1 accepted")
	}
	if _, err := SplitSecret(secret, 4, 3); err == nil {
		t.Fatal("k>n accepted")
	}
}

func TestShareTextRoundTrip(t *testing.T) {
	shares, _ := SplitSecret(bytes.Repeat([]byte{9}, 32), 2, 3)
	for _, s := range shares {
		p, err := ParseShare(s.Encode())
		if err != nil || p.X != s.X || !bytes.Equal(p.Data, s.Data) {
			t.Fatalf("round trip failed: %v", err)
		}
	}
	if _, err := ParseShare("fpshare1.2.3.1.zz.!!!"); err == nil {
		t.Fatal("garbage parsed")
	}
}

func TestBackupEncryptDecrypt(t *testing.T) {
	k1, _ := NewRecoveryKey()
	k2, _ := NewRecoveryKey()
	other, _ := NewRecoveryKey()
	pub1, _ := ParseRecipient(k1.Recipient())
	pub2, _ := ParseRecipient(k2.Recipient())
	plain := []byte(`{"secret":"share material"}`)
	data, err := EncryptBackup(plain, "node1", map[string]int{"ws-a": 2}, time.Now(), []*ecdh.PublicKey{pub1, pub2})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("share material")) {
		t.Fatal("plaintext visible in backup")
	}
	for _, k := range []*RecoveryKey{k1, k2} {
		got, env, err := DecryptBackup(data, k)
		if err != nil || !bytes.Equal(got, plain) || env.Node != "node1" || env.Epochs["ws-a"] != 2 {
			t.Fatalf("decrypt failed: %v", err)
		}
	}
	if _, _, err := DecryptBackup(data, other); err == nil {
		t.Fatal("a key that was not a recipient decrypted the backup")
	}
	// The header is bound as AAD: changing the node or epoch must break decryption.
	var env map[string]any
	json.Unmarshal(data, &env)
	env["node"] = "node2"
	forged, _ := json.Marshal(env)
	if _, _, err := DecryptBackup(forged, k1); err == nil {
		t.Fatal("forged node name accepted")
	}
	env["node"] = "node1"
	env["epochs"] = map[string]int{"ws-a": 0}
	forged, _ = json.Marshal(env)
	if _, _, err := DecryptBackup(forged, k1); err == nil {
		t.Fatal("forged epoch accepted (would let an old backup pass for a new one)")
	}
	// Flip a ciphertext byte.
	env["epochs"] = map[string]int{"ws-a": 2}
	ct := env["ciphertext"].(string)
	if ct[0] == 'A' {
		ct = "B" + ct[1:]
	} else {
		ct = "A" + ct[1:]
	}
	env["ciphertext"] = ct
	tampered, _ := json.Marshal(env)
	if _, _, err := DecryptBackup(tampered, k1); err == nil {
		t.Fatal("tampered ciphertext accepted")
	}
}

func TestRecoveryKeyRebuiltFromShamirShares(t *testing.T) {
	k, _ := NewRecoveryKey()
	shares, _ := SplitSecret(k.Secret(), 3, 5)
	secret, err := CombineShares([]Share{shares[4], shares[1], shares[2]})
	if err != nil {
		t.Fatal(err)
	}
	k2, err := RecoveryKeyFromSecret(secret)
	if err != nil || k2.Recipient() != k.Recipient() {
		t.Fatal("rebuilt key is not the same key")
	}
}

func TestPlanRecovery(t *testing.T) {
	mk := func(node string, epoch int) *BackupPayload {
		return &BackupPayload{Node: node, Inventory: []KeyInventory{{KeyID: "ws-a", Epoch: epoch, Address: "0xa", Threshold: 1}}}
	}
	// Two holders of epoch 2: recoverable.
	out := PlanRecovery([]*BackupPayload{mk("node1", 2), mk("node2", 2)})
	if len(out) != 1 || !out[0].Recoverable || out[0].Epoch != 2 {
		t.Fatalf("%+v", out)
	}
	// One at epoch 2, one stale at epoch 0: neither epoch has enough.
	out = PlanRecovery([]*BackupPayload{mk("node1", 2), mk("node2", 0)})
	if out[0].Recoverable {
		t.Fatalf("mixed epochs reported recoverable: %+v", out)
	}
	// Two stale at epoch 0 plus one at 2: epoch 0 is recoverable and the note says so honestly.
	out = PlanRecovery([]*BackupPayload{mk("node1", 0), mk("node2", 0), mk("node3", 2)})
	if !out[0].Recoverable || out[0].Epoch != 0 || !strings.Contains(out[0].Note, "epoch 2") {
		t.Fatalf("%+v", out)
	}
}
