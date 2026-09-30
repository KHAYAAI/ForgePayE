package mpc

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// MigrateSealKey moves a node from one seal-key provider to another: it makes a
// new key with `to`, re-encrypts every sealed file under it, and only then
// retires the old key. It is safe to interrupt and run again — files already
// under the new key are skipped, and the old key is kept until the last file is
// done. Run it with the node stopped.
func MigrateSealKey(ctx context.Context, dataDir, nodeID string, from, to SealKeyProvider) (migrated int, err error) {
	if to.Name() == ProviderEnv {
		return 0, errors.New("cannot migrate to the env provider: the key would have to be generated outside the node")
	}
	oldKey, err := from.Load(ctx, dataDir, nodeID, false)
	if err != nil {
		return 0, fmt.Errorf("loading the current seal key: %w", err)
	}
	staging := filepath.Join(dataDir, ".seal-next")
	var newKey []byte
	if exists(staging) {
		newKey, err = to.Load(ctx, staging, nodeID, false)
	} else {
		if err = os.MkdirAll(staging, 0o700); err == nil {
			newKey, err = to.Load(ctx, staging, nodeID, true)
		}
	}
	if err != nil {
		return 0, fmt.Errorf("creating the new seal key: %w", err)
	}

	files, err := sealedFiles(dataDir, nodeID)
	if err != nil {
		return 0, err
	}
	for _, f := range files {
		raw, err := os.ReadFile(f.Path)
		if err != nil {
			return migrated, err
		}
		if _, err := Open(newKey, raw, f.AAD); err == nil {
			continue // done on an earlier, interrupted run
		}
		plain, err := Open(oldKey, raw, f.AAD)
		if err != nil {
			return migrated, fmt.Errorf("%s does not open with the current seal key: %w", f.Path, err)
		}
		sealed, err := Seal(newKey, plain, f.AAD)
		if err != nil {
			return migrated, err
		}
		tmp := f.Path + ".migrating"
		if err := os.WriteFile(tmp, sealed, 0o600); err != nil {
			return migrated, err
		}
		if err := os.Rename(tmp, f.Path); err != nil {
			return migrated, err
		}
		migrated++
	}

	// Everything is under the new key: install it, then remove the old one.
	for _, name := range []string{"seal.key", wrappedKeyFile} {
		src := filepath.Join(staging, name)
		if exists(src) {
			if err := os.Rename(src, filepath.Join(dataDir, name)); err != nil {
				return migrated, err
			}
		}
	}
	switch to.Name() {
	case ProviderVault, ProviderAWSKMS:
		if from.Name() == ProviderFile {
			// Destroy rather than unlink where possible: the whole point was to
			// stop this key sitting on disk.
			shred(filepath.Join(dataDir, "seal.key"))
		}
	case ProviderFile:
		_ = os.Remove(filepath.Join(dataDir, wrappedKeyFile))
	}
	_ = os.RemoveAll(staging)
	return migrated, nil
}

func shred(path string) {
	if fi, err := os.Stat(path); err == nil {
		if f, err := os.OpenFile(path, os.O_WRONLY, 0); err == nil {
			_, _ = f.Write(make([]byte, fi.Size()))
			_ = f.Sync()
			f.Close()
		}
	}
	_ = os.Remove(path)
}
