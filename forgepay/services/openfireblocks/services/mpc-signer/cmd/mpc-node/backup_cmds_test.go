package main

import (
	"bytes"
	"crypto/ecdh"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"forge-crypto/mpc-signer/internal/mpc"
)

func TestOfficerCeremonyProtectedSharesAndDrillRecord(t *testing.T) {
	dir := t.TempDir()
	if err := cmdBackupKeygen([]string{"-k", "2", "-n", "3", "-out", dir + "/rec"}); err != nil {
		t.Fatal(err)
	}
	// An officer protects their own share and the plain file goes away.
	t.Setenv("MPC_SHARE_PASSPHRASE", "a long private passphrase")
	if err := cmdBackupShareProtect([]string{"-in", dir + "/rec/officer-1.share", "-out", dir + "/rec/officer-1.share.enc"}); err != nil {
		t.Fatal(err)
	}
	os.Remove(dir + "/rec/officer-1.share")
	if err := cmdBackupShareCheck([]string{"-in", dir + "/rec/officer-1.share.enc"}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(dir + "/rec/officer-1.share.enc")
	if bytes.Contains(raw, []byte("fpshare1")) {
		t.Fatal("the protected share file contains the plain share")
	}

	// A backup made to the recovery key (no key shares in it: this tests the ceremony, not the signer).
	rec, _ := os.ReadFile(dir + "/rec/recipient.txt")
	pub, err := mpc.ParseRecipient(strings.TrimSpace(string(rec)))
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(mpc.BackupPayload{Version: 1, Node: "node1", Created: time.Now().UTC(), IdentitySecret: bytes.Repeat([]byte{1}, 32)})
	data, err := mpc.EncryptBackup(payload, "node1", map[string]int{}, time.Now().UTC(), []*ecdh.PublicKey{pub})
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(dir+"/bk/node1", 0o700)
	os.WriteFile(dir+"/bk/node1/x.mpcbackup", data, 0o600)

	// Two officers (one protected, one plain) rebuild the key and the drill is recorded.
	out := dir + "/drill.json"
	args := []string{"-in", dir + "/bk", "-shares", dir + "/rec/officer-1.share.enc," + dir + "/rec/officer-3.share", "-record", out, "-officers", "Alice, Bob", "-witness", "Carol"}
	_ = cmdBackupInspect(args) // no key shares in this backup, so it cannot "pass"; the record still has to be right
	var r drillRecord
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	if r.Passed || len(r.Officers) != 2 || r.Witness != "Carol" || len(r.SharesUsed) != 2 || len(r.Backups) != 1 || r.Backups[0].SHA256 == "" || r.Seal == "" {
		t.Fatalf("record is wrong: %+v", r)
	}
	// An edit after the fact is detectable.
	seal := r.Seal
	r.Passed = true
	if writeDrillRecord(filepath.Join(dir, "edited.json"), &r) != nil || r.Seal == seal {
		t.Fatal("an edited record kept its seal")
	}

	// One officer is not enough, and that is recorded as a failure too.
	out2 := dir + "/drill2.json"
	if err := cmdBackupInspect([]string{"-in", dir + "/bk", "-shares", dir + "/rec/officer-3.share", "-record", out2}); err == nil {
		t.Fatal("one share rebuilt the key")
	}
	var r2 drillRecord
	b2, _ := os.ReadFile(out2)
	json.Unmarshal(b2, &r2)
	if r2.Passed || r2.Failure == "" {
		t.Fatalf("a failed drill was recorded as passed: %+v", r2)
	}
}
