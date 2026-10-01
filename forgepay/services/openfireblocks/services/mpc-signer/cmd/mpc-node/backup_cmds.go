package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

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

func recoveryKeyFromFiles(csv string) (*mpc.RecoveryKey, error) {
	var shares []mpc.Share
	for _, p := range strings.Split(csv, ",") {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return nil, err
		}
		s, err := mpc.ParseShare(strings.TrimSpace(string(raw)))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", p, err)
		}
		shares = append(shares, s)
	}
	secret, err := mpc.CombineShares(shares)
	if err != nil {
		return nil, err
	}
	return mpc.RecoveryKeyFromSecret(secret)
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
func cmdBackupInspect(args []string) error {
	fs := flag.NewFlagSet("backup-inspect", flag.ExitOnError)
	in := fs.String("in", "", "backup files or directories (comma-separated)")
	shares := fs.String("shares", "", "officer share files (comma-separated)")
	fs.Parse(args)
	if *in == "" || *shares == "" {
		return fmt.Errorf("-in and -shares are required")
	}
	key, err := recoveryKeyFromFiles(*shares)
	if err != nil {
		return fmt.Errorf("the recovery key could not be rebuilt from those shares: %w", err)
	}
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
		p, env, err := mpc.OpenBackupFile(raw, key)
		if err != nil {
			fmt.Printf("FAIL  %s: %v\n", f, err)
			bad++
			continue
		}
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
	key, err := recoveryKeyFromFiles(*shares)
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
