package mpc

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// waitBackup waits until a node's newest backup covers the shares on its disk.
func waitBackup(t *testing.T, n *Node) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if st := n.BackupStatus(); st.Covers {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("backup never caught up: %+v", n.BackupStatus())
}

// TestDisasterRecovery is the restore drill as a test: two of three nodes are destroyed along with
// their seal keys, signing stops, and the funds come back from the encrypted backups alone.
func TestDisasterRecovery(t *testing.T) {
	if testing.Short() {
		t.Skip("real key generation takes minutes of CPU; skipped in -short")
	}
	h := newHarnessN(t, 3, 1)
	h.waitForPreParams()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	// Offline recovery key, split 2-of-3 among "officers"; nodes only ever see the public half.
	rk, _ := NewRecoveryKey()
	officerShares, _ := SplitSecret(rk.Secret(), 2, 3)
	pub, _ := ParseRecipient(rk.Recipient())
	sink := DirSink{Dir: t.TempDir()}
	for i, n := range h.nodes {
		if err := n.EnableBackups(BackupConfig{Sink: sink, Recipients: []*ecdh.PublicKey{pub}}); err != nil {
			t.Fatalf("node%d: %v", i+1, err)
		}
	}

	key, err := h.coord.Keygen(ctx, "ws-dr")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range h.nodes {
		waitBackup(t, n)
	}
	verifyOnChainRules(t, h.mustSign(1, key), key.Address)

	// What is on the backup disk must not contain the share in the clear.
	var backupFiles []string
	_ = filepath.Walk(sink.Dir, func(p string, info os.FileInfo, err error) error {
		if err == nil && strings.HasSuffix(p, ".mpcbackup") {
			backupFiles = append(backupFiles, p)
		}
		return nil
	})
	if len(backupFiles) < 3 {
		t.Fatalf("expected a backup for each of 3 nodes, found %v", backupFiles)
	}
	oldSeal2 := h.cfgs[1].SealKey

	// --- disaster: node2 and node3 are gone, with their disks and seal keys.
	h.down[1].Store(true)
	h.down[2].Store(true)
	for _, i := range []int{1, 2} {
		os.RemoveAll(h.cfgs[i].DataDir)
	}
	if _, err := h.coord.Sign(ctx, key.KeyID, key.Address, testTx(2, "1000")); err == nil {
		t.Fatal("signing worked with only one node left")
	} else {
		t.Logf("with 2 of 3 nodes lost, signing is refused: %v", err)
	}

	// --- recovery: officers 1 and 3 come together (any 2 of 3).
	secret, err := CombineShares([]Share{officerShares[0], officerShares[2]})
	if err != nil {
		t.Fatal(err)
	}
	rk2, _ := RecoveryKeyFromSecret(secret)

	// One officer alone cannot read anything.
	if _, err := CombineShares([]Share{officerShares[1]}); err == nil {
		t.Fatal("a single officer share recovered the key")
	}

	var payloads []*BackupPayload
	for _, node := range []string{"node1", "node2", "node3"} {
		names, _ := sink.List(ctx, node+"/")
		if len(names) == 0 {
			t.Fatalf("no backup for %s", node)
		}
		raw, _ := sink.Get(ctx, names[len(names)-1])
		p, _, err := OpenBackupFile(raw, rk2)
		if err != nil {
			t.Fatalf("%s: %v", node, err)
		}
		payloads = append(payloads, p)
	}
	for _, o := range PlanRecovery(payloads) {
		if !o.Recoverable {
			t.Fatalf("drill says %s is not recoverable: %+v", o.KeyID, o)
		}
	}

	for _, i := range []int{1, 2} {
		newSeal := make([]byte, 32) // a replacement host has a different seal key
		rand.Read(newSeal)
		dir := t.TempDir()
		if _, err := RestoreInto(payloads[i], dir, newSeal); err != nil {
			t.Fatal(err)
		}
		if i == 1 {
			if _, err := Open(oldSeal2, mustRead(t, filepath.Join(dir, "keys", "ws-dr.sealed")), keyAAD("ws-dr", 0)); err == nil {
				t.Fatal("the restored share still opens with the old seal key")
			}
		}
		cfg := h.cfgs[i]
		cfg.DataDir, cfg.SealKey = dir, newSeal
		cfg.PolicyFile = filepath.Join(dir, "policy.json")
		_ = os.WriteFile(cfg.PolicyFile, []byte("{}"), 0o600)
		h.cfgs[i] = cfg
		h.startNode(i)
		h.down[i].Store(false)
	}

	signed := h.mustSign(2, key)
	verifyOnChainRules(t, signed, key.Address)
	t.Logf("after restoring node2 and node3 from backups, signing works and the address is unchanged: %s", key.Address)

	// A restore never overwrites existing data.
	if _, err := RestoreInto(payloads[0], h.cfgs[0].DataDir, make([]byte, 32)); err == nil {
		t.Fatal("restored over a live data directory")
	}
}

func mustRead(t *testing.T, p string) []byte {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type failingSink struct{ DirSink }

func (failingSink) Put(context.Context, string, []byte) error { return os.ErrPermission }

func TestBackupFailureIsNotSilent(t *testing.T) {
	h := newHarnessN(t, 3, 1)
	rk, _ := NewRecoveryKey()
	pub, _ := ParseRecipient(rk.Recipient())
	err := h.nodes[0].EnableBackups(BackupConfig{Sink: failingSink{DirSink{Dir: t.TempDir()}}, Recipients: []*ecdh.PublicKey{pub}})
	if err == nil {
		t.Fatal("a node whose backups cannot be stored started anyway")
	}
	if _, err := h.nodes[1].BackupNow(context.Background()); err == nil {
		t.Fatal("BackupNow worked with backups not enabled")
	}
	if st := h.nodes[1].BackupStatus(); st.Enabled {
		t.Fatal("status says enabled")
	}
}

// After a reshare the superseded shares are destroyed on the nodes, and the backups holding them
// must go too: otherwise a stolen old backup plus other old shares would undo the rotation.
func TestReshareDropsSupersededBackups(t *testing.T) {
	if testing.Short() {
		t.Skip("real key generation and resharing take minutes of CPU; skipped in -short")
	}
	h := newHarnessN(t, 3, 1)
	h.waitForPreParams()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	rk, _ := NewRecoveryKey()
	pub, _ := ParseRecipient(rk.Recipient())
	sink := DirSink{Dir: t.TempDir()}
	for i, n := range h.nodes {
		if err := n.EnableBackups(BackupConfig{Sink: sink, Recipients: []*ecdh.PublicKey{pub}}); err != nil {
			t.Fatalf("node%d: %v", i+1, err)
		}
	}
	key, err := h.coord.Keygen(ctx, "ws-p")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range h.nodes {
		waitBackup(t, n)
	}
	epochsIn := func(node string) []int {
		names, _ := sink.List(ctx, node+"/")
		var out []int
		for _, name := range names {
			raw, _ := sink.Get(ctx, name)
			env, err := ParseBackup(raw)
			if err != nil {
				t.Fatal(err)
			}
			out = append(out, env.Epochs["ws-p"])
		}
		return out
	}
	if got := epochsIn("node1"); len(got) == 0 || got[len(got)-1] != 0 {
		t.Fatalf("node1 backups before reshare: %v", got)
	}

	h.waitForPreParams()
	res, err := h.coord.Reshare(ctx, "ws-p", []string{"node1", "node2", "node3"}, 1, func(m string) { t.Log("  ", m) })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.EqualFold(res.Address, key.Address) || res.ToEpoch != 1 {
		t.Fatalf("%+v", res)
	}
	for _, n := range h.nodes {
		waitBackup(t, n)
	}
	for _, node := range []string{"node1", "node2", "node3"} {
		got := epochsIn(node)
		for _, e := range got {
			if e != 1 {
				t.Fatalf("%s still has a backup of a superseded epoch: %v", node, got)
			}
		}
		if len(got) == 0 {
			t.Fatalf("%s has no backup at all", node)
		}
	}
	verifyOnChainRules(t, h.mustSign(1, key), key.Address)
}
