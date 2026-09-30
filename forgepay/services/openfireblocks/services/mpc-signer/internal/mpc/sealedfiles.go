package mpc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// sealedFile is one file on a node's disk encrypted under the seal key, with
// the associated data it was sealed with.
type sealedFile struct{ Path, AAD string }

// sealedFiles lists everything on this node that the seal key protects. It is
// the single place that knows how file names map to associated data, so a
// change of seal key can't miss a file.
func sealedFiles(dataDir, nodeID string) ([]sealedFile, error) {
	var out []sealedFile
	if p := filepath.Join(dataDir, "identity.sealed"); exists(p) {
		out = append(out, sealedFile{p, "identity|" + nodeID})
	}
	pre, _ := filepath.Glob(filepath.Join(dataDir, "preparams", "*.sealed"))
	for _, p := range pre {
		out = append(out, sealedFile{p, "preparams"})
	}
	entries, err := os.ReadDir(filepath.Join(dataDir, "keys"))
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	for _, e := range entries {
		name := e.Name()
		id, epoch, ok := parseKeyFile(name)
		if !ok {
			continue
		}
		out = append(out, sealedFile{filepath.Join(dataDir, "keys", name), keyAAD(id, epoch)})
	}
	return out, nil
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

// keyAAD binds a share to its key id and epoch. Epoch 0 keeps the original
// "key|<id>" form so shares created before rotation existed still open.
func keyAAD(keyID string, epoch int) string {
	if epoch == 0 {
		return "key|" + keyID
	}
	return fmt.Sprintf("key|%s|e%d", keyID, epoch)
}

// Key file names:
//
//	<id>.sealed             epoch 0 (as first generated)
//	<id>.e<N>.sealed        epoch N, active
//	<id>.e<N>.pending       epoch N, produced by a reshare, not yet committed
func parseKeyFile(name string) (id string, epoch int, ok bool) {
	switch {
	case strings.HasSuffix(name, ".pending"):
		name = strings.TrimSuffix(name, ".pending")
	case strings.HasSuffix(name, ".sealed"):
		name = strings.TrimSuffix(name, ".sealed")
	default:
		return "", 0, false
	}
	if i := strings.LastIndex(name, ".e"); i > 0 {
		var n int
		if _, err := fmt.Sscanf(name[i+2:], "%d", &n); err == nil && n > 0 && fmt.Sprint(n) == name[i+2:] {
			return name[:i], n, ValidID(name[:i])
		}
		return "", 0, false
	}
	return name, 0, ValidID(name)
}

func hexEncode(b []byte) string { return fmt.Sprintf("%x", b) }
