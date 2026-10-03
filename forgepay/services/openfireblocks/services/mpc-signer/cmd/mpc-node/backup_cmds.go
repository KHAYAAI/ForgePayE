package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"forge-crypto/mpc-signer/internal/mpc"
)

// backup-keygen creates the offline recovery key and splits it among officers.
func cmdBackupKeygen(args []string) error {
	fs := flag.NewFlagSet("backup-keygen", flag.ExitOnError)
	k := fs.Int("k", 3, "shares needed to recover")
	n := fs.Int("n", 5, "officers to split between")
	out := fs.String("out", "", "directory to write the recipient and the officer share files to")
	fs.Parse(args)
	if *out == "" {
		return fmt.Errorf("-out is required")
	}
	if err := os.MkdirAll(*out, 0o700); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(*out, "recipient.txt")); err == nil {
		return fmt.Errorf("%s already holds a recovery key; refusing to overwrite it", *out)
	}
	key, err := mpc.NewRecoveryKey()
	if err != nil {
		return err
	}
	shares, err := mpc.SplitSecret(key.Secret(), *k, *n)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(*out, "recipient.txt"), []byte(key.Recipient()+"\n"), 0o644); err != nil {
		return err
	}
	for i, s := range shares {
		if err := os.WriteFile(filepath.Join(*out, fmt.Sprintf("officer-%d.share", i+1)), []byte(s.Encode()+"\n"), 0o600); err != nil {
			return err
		}
	}
	fmt.Printf("recovery public key (give this to every node as MPC_BACKUP_RECIPIENTS):\n  %s\n\n", key.Recipient())
	fmt.Printf("wrote %d officer share files to %s; any %d of them recover the key.\n", *n, *out, *k)
	fmt.Println("NOW: hand each share to a different officer on separate media, then DELETE these files from this machine.")
	fmt.Println("The private key is not stored anywhere else. Lose more than n-k shares and every backup is unreadable.")
	return nil
}

func recoveryKeyFromFiles(csv string) (*mpc.RecoveryKey, []mpc.Share, error) {
	var shares []mpc.Share
	for _, p := range strings.Split(csv, ",") {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return nil, nil, err
		}
		text := strings.TrimSpace(string(raw))
		if mpc.IsProtectedShare(text) {
			pass, err := readPassphrase("passphrase for " + filepath.Base(p) + ": ")
			if err != nil {
				return nil, nil, err
			}
			if text, err = mpc.UnprotectShare(text, pass); err != nil {
				return nil, nil, fmt.Errorf("%s: %w", p, err)
			}
		}
		s, err := mpc.ParseShare(text)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", p, err)
		}
		shares = append(shares, s)
	}
	secret, err := mpc.CombineShares(shares)
	if err != nil {
		return nil, nil, err
	}
	key, err := mpc.RecoveryKeyFromSecret(secret)
	return key, shares, err
}

func backupFiles(in string) ([]string, error) {
	var files []string
	for _, p := range strings.Split(in, ",") {
		p = strings.TrimSpace(p)
		st, err := os.Stat(p)
		if err != nil {
			return nil, err
		}
		if st.IsDir() {
			_ = filepath.Walk(p, func(path string, info os.FileInfo, err error) error {
				if err == nil && !info.IsDir() && strings.HasSuffix(path, ".mpcbackup") {
					files = append(files, path)
				}
				return nil
			})
		} else {
			files = append(files, p)
		}
	}
	sort.Strings(files)
	return files, nil
}

// backup-inspect is the restore drill: it decrypts backups, checks every share and says what could be recovered. It writes nothing.
func cmdBackupInspect(args []string) (err error) {
	fs := flag.NewFlagSet("backup-inspect", flag.ExitOnError)
	in := fs.String("in", "", "backup files or directories (comma-separated)")
	shares := fs.String("shares", "", "officer share files (comma-separated)")
	record := fs.String("record", "", "write a drill record (JSON) here")
	officers := fs.String("officers", "", "names of the officers present (for the record)")
	witness := fs.String("witness", "", "name of the person witnessing (for the record)")
	fs.Parse(args)
	if *in == "" || *shares == "" {
		return fmt.Errorf("-in and -shares are required")
	}
	rec := &drillRecord{Version: 1, At: time.Now().UTC(), Officers: splitNames(*officers), Witness: *witness}
	defer func() {
		if *record == "" {
			return
		}
		rec.Passed = err == nil && rec.KeysRecovered > 0
		if err != nil {
			rec.Failure = err.Error()
		}
		if werr := writeDrillRecord(*record, rec); werr != nil && err == nil {
			err = werr
		}
	}()
	key, used, err := recoveryKeyFromFiles(*shares)
	if err != nil {
		return fmt.Errorf("the recovery key could not be rebuilt from those shares: %w", err)
	}
	for _, sh := range used {
		rec.SharesUsed = append(rec.SharesUsed, fmt.Sprintf("slot %d of %d (recovery-key fingerprint %s)", sh.X, sh.N, sh.FP))
	}
	rec.Recipient = key.Recipient()
	files, err := backupFiles(*in)
	if err != nil {
		return err
	}
	var payloads []*mpc.BackupPayload
	bad := 0
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(raw)
		p, env, err := mpc.OpenBackupFile(raw, key)
		if err != nil {
			fmt.Printf("FAIL  %s: %v\n", f, err)
			rec.Backups = append(rec.Backups, drillBackup{File: filepath.Base(f), SHA256: hex.EncodeToString(sum[:]), Error: err.Error()})
			bad++
			continue
		}
		rec.Backups = append(rec.Backups, drillBackup{File: filepath.Base(f), SHA256: hex.EncodeToString(sum[:]), Node: env.Node, Taken: env.Created, Keys: len(p.Keys)})
		fmt.Printf("ok    %s  node=%s  taken=%s  keys=%d\n", filepath.Base(f), env.Node, env.Created.Format("2006-01-02 15:04Z"), len(p.Keys))
		payloads = append(payloads, p)
	}
	fmt.Println()
	unrecoverable := 0
	for _, o := range mpc.PlanRecovery(payloads) {
		state := "recoverable    "
		if !o.Recoverable {
			state, unrecoverable = "NOT recoverable", unrecoverable+1
		}
		fmt.Printf("%s  %s  %s  epoch %d  %d of %d shares  %s\n", state, o.KeyID, o.Address, o.Epoch, len(o.Holders), o.Needed, o.Note)
		rec.Keys = append(rec.Keys, o)
		if o.Recoverable {
			rec.KeysRecovered++
		}
	}
	if bad > 0 || unrecoverable > 0 {
		return fmt.Errorf("drill failed: %d unreadable backup(s), %d unrecoverable key(s)", bad, unrecoverable)
	}
	if len(payloads) == 0 {
		return fmt.Errorf("drill failed: no backups found")
	}
	total := 0
	for _, p := range payloads {
		total += len(p.Keys)
	}
	if total == 0 {
		fmt.Println("\nthe backups decrypt and the node identities are intact, but they hold NO key shares yet, so this drill proves nothing about recovering funds")
		return nil
	}
	fmt.Println("\ndrill passed: every key in these backups can be recovered")
	return nil
}

// backup-restore rebuilds one node's data directory from one of its backups.
func cmdBackupRestore(args []string) error {
	fs := flag.NewFlagSet("backup-restore", flag.ExitOnError)
	in := fs.String("in", "", "the node's backup file")
	shares := fs.String("shares", "", "officer share files (comma-separated)")
	id := fs.String("id", "", "node id (must match the backup)")
	data := fs.String("data", "", "NEW data directory to restore into")
	fs.Parse(args)
	if *in == "" || *shares == "" || *id == "" || *data == "" {
		return fmt.Errorf("-in, -shares, -id and -data are required")
	}
	key, _, err := recoveryKeyFromFiles(*shares)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	p, _, err := mpc.OpenBackupFile(raw, key)
	if err != nil {
		return err
	}
	if p.Node != *id {
		return fmt.Errorf("that backup is node %q's, not %q's", p.Node, *id)
	}
	// A restored node gets a NEW seal key from whatever provider is configured now.
	if err := os.MkdirAll(*data, 0o700); err != nil {
		return err
	}
	sealKey, provider, err := mpc.LoadSealKey(context.Background(), *data, *id, true)
	if err != nil {
		return err
	}
	res, err := mpc.RestoreInto(p, *data, sealKey)
	if err != nil {
		return err
	}
	fmt.Printf("restored node %s from a backup taken %s, sealed under a new %s seal key\n", res.Node, res.BackupTime.Format("2006-01-02 15:04Z"), provider)
	for _, k := range res.Keys {
		fmt.Printf("  %s  epoch %d  %s\n", k.KeyID, k.Epoch, k.Address)
	}
	fmt.Println("\nnext: start the node, confirm the cluster file still lists its identity, then `mpc-node preflight`.")
	fmt.Println("if the cluster has since resharded, check the epochs above against the live nodes before relying on this node.")
	return nil
}

// readPassphrase asks on the controlling terminal with echo off (so it works even when stdin is piped), taking
// MPC_SHARE_PASSPHRASE only for unattended tests. A passphrase typed here is not stored anywhere.
func readPassphrase(prompt string) (string, error) {
	if v := os.Getenv("MPC_SHARE_PASSPHRASE"); v != "" {
		return v, nil
	}
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return "", fmt.Errorf("no terminal to ask for a passphrase on (set MPC_SHARE_PASSPHRASE for a non-interactive run): %w", err)
	}
	defer tty.Close()
	fmt.Fprint(tty, prompt)
	off := exec.Command("stty", "-echo")
	off.Stdin = tty
	_ = off.Run()
	defer func() {
		on := exec.Command("stty", "echo")
		on.Stdin = tty
		_ = on.Run()
		fmt.Fprintln(tty)
	}()
	line, err := bufio.NewReader(tty).ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

// backup-share-protect: an officer protects their own share under a passphrase only they know, then destroys the plain file.
func cmdBackupShareProtect(args []string) error {
	fs := flag.NewFlagSet("backup-share-protect", flag.ExitOnError)
	in := fs.String("in", "", "the plain officer share file")
	out := fs.String("out", "", "where to write the protected share")
	fs.Parse(args)
	if *in == "" || *out == "" {
		return fmt.Errorf("-in and -out are required")
	}
	raw, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	if _, err := mpc.ParseShare(strings.TrimSpace(string(raw))); err != nil {
		return fmt.Errorf("%s: %w", *in, err)
	}
	p1, err := readPassphrase("choose a passphrase (12+ characters): ")
	if err != nil {
		return err
	}
	p2, err := readPassphrase("type it again: ")
	if err != nil {
		return err
	}
	if p1 != p2 {
		return fmt.Errorf("the two passphrases differ; nothing written")
	}
	prot, err := mpc.ProtectShare(string(raw), p1)
	if err != nil {
		return err
	}
	if _, err := os.Stat(*out); err == nil {
		return fmt.Errorf("%s already exists; refusing to overwrite a share", *out)
	}
	if err := os.WriteFile(*out, []byte(prot+"\n"), 0o600); err != nil {
		return err
	}
	back, err := os.ReadFile(*out)
	if err != nil {
		return err
	}
	if got, err := mpc.UnprotectShare(string(back), p1); err != nil || strings.TrimSpace(got) != strings.TrimSpace(string(raw)) {
		return fmt.Errorf("the protected copy did not read back correctly; keep the plain file")
	}
	fmt.Printf("wrote %s and checked it opens with your passphrase.\nNOW delete %s (and any copy). Remember: the passphrase cannot be recovered; losing it loses this share.\n", *out, *in)
	return nil
}

// backup-share-check: one officer checks their own share is intact, without anyone else present and without rebuilding anything.
func cmdBackupShareCheck(args []string) error {
	fs := flag.NewFlagSet("backup-share-check", flag.ExitOnError)
	in := fs.String("in", "", "an officer share file (plain or protected)")
	fs.Parse(args)
	if *in == "" {
		return fmt.Errorf("-in is required")
	}
	raw, err := os.ReadFile(*in)
	if err != nil {
		return err
	}
	text := strings.TrimSpace(string(raw))
	protected := mpc.IsProtectedShare(text)
	if protected {
		pass, err := readPassphrase("passphrase: ")
		if err != nil {
			return err
		}
		if text, err = mpc.UnprotectShare(text, pass); err != nil {
			return err
		}
	}
	s, err := mpc.ParseShare(text)
	if err != nil {
		return err
	}
	fmt.Printf("share intact: officer slot %d of %d, any %d rebuild the key; recovery-key fingerprint %s; passphrase-protected: %v\n", s.X, s.N, s.K, s.FP, protected)
	fmt.Println("(this proves the file is whole, not that the other officers' shares are: only a drill with enough of them proves that)")
	return nil
}

// ── Drill records ─────────────────────────────────────────────────────────────

type drillBackup struct {
	File   string    `json:"file"`
	SHA256 string    `json:"sha256"`
	Node   string    `json:"node,omitempty"`
	Taken  time.Time `json:"taken,omitempty"`
	Keys   int       `json:"keys"`
	Error  string    `json:"error,omitempty"`
}

// drillRecord is what a restore drill leaves behind for the auditor: what was tested, with which shares, and the
// result. The officer and witness names are as typed by whoever ran it; the record proves what the software saw,
// not that those people were in the room: that is what the witness's signature on the printed record is for.
type drillRecord struct {
	Version       int                   `json:"version"`
	At            time.Time             `json:"at"`
	Officers      []string              `json:"officers"`
	Witness       string                `json:"witness"`
	Recipient     string                `json:"recoveryKey"`
	SharesUsed    []string              `json:"sharesUsed"`
	Backups       []drillBackup         `json:"backups"`
	Keys          []mpc.RecoveryOutcome `json:"keys"`
	KeysRecovered int                   `json:"keysRecovered"`
	Passed        bool                  `json:"passed"`
	Failure       string                `json:"failure,omitempty"`
	Seal          string                `json:"seal"` // SHA-256 of the record without this field: detects edits after the fact
}

func splitNames(s string) []string {
	var out []string
	for _, n := range strings.Split(s, ",") {
		if n = strings.TrimSpace(n); n != "" {
			out = append(out, n)
		}
	}
	return out
}

func writeDrillRecord(path string, r *drillRecord) error {
	r.Seal = ""
	body, _ := json.Marshal(r)
	sum := sha256.Sum256(body)
	r.Seal = hex.EncodeToString(sum[:])
	out, _ := json.MarshalIndent(r, "", "  ")
	if err := os.WriteFile(path, append(out, '\n'), 0o644); err != nil {
		return err
	}
	fmt.Printf("drill record written to %s (passed: %v)\n", path, r.Passed)
	return nil
}
