package mpc

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CheckSealProvider exercises a seal-key provider against the real key service it is
// configured for — Vault or AWS KMS, not a stand-in — using a scratch directory and a
// throwaway node id. It creates and stores nothing that outlives the check, and never
// touches a node's own data. Run it once with production credentials before relying on
// the provider.
func CheckSealProvider(ctx context.Context, providerName string) []Check {
	var out []Check
	add := func(name string, err error, detail string) {
		if err != nil {
			out = append(out, Check{Name: name, OK: false, Detail: err.Error()})
			return
		}
		out = append(out, Check{Name: name, OK: true, Detail: detail})
	}
	p, err := NewSealKeyProvider(providerName)
	if err != nil {
		return []Check{{Name: "configuration", OK: false, Detail: err.Error()}}
	}
	dir, err := os.MkdirTemp("", "mpc-seal-check-")
	if err != nil {
		return []Check{{Name: "scratch directory", OK: false, Detail: err.Error()}}
	}
	defer os.RemoveAll(dir)
	node := "seal-check"
	if v := os.Getenv("MPC_VAULT_KEY"); v != "" && providerName == ProviderVault {
		node = strings.TrimPrefix(v, "mpc-node-") // the Vault key policy is per node; use the one configured
	}

	var key []byte
	key, err = p.Load(ctx, dir, node, true)
	if err == nil && len(key) != 32 {
		err = fmt.Errorf("the provider returned a %d-byte key", len(key))
	}
	add("create and wrap a seal key", err, "a 32-byte key was generated and wrapped by the key service")
	if err != nil {
		return out
	}

	raw, _ := os.ReadFile(filepath.Join(dir, wrappedKeyFile))
	if bytes.Contains(raw, []byte(fmt.Sprintf("%x", key))) {
		add("the stored file does not contain the key", fmt.Errorf("the plaintext key is in %s", wrappedKeyFile), "")
	} else {
		add("the stored file does not contain the key", nil, "only the wrapped form is on disk")
	}

	again, err := p.Load(ctx, dir, node, false)
	if err == nil && !bytes.Equal(again, key) {
		err = fmt.Errorf("unwrapping returned a different key")
	}
	add("unwrap it again from the key service", err, "same key back")

	if _, err := p.Load(ctx, dir, "some-other-node", false); err == nil {
		add("the wrapped key will not load for a different node", fmt.Errorf("it loaded for another node id"), "")
	} else {
		add("the wrapped key will not load for a different node", nil, err.Error())
	}

	// A wrapped key altered on disk must not unwrap.
	if len(raw) > 40 {
		altered := bytes.Replace(raw, []byte(`"ciphertext": "`), []byte(`"ciphertext": "AAAA`), 1)
		if bytes.Equal(altered, raw) { // KMS stores it under a different field layout
			altered = bytes.Replace(raw, []byte(`:"`), []byte(`:"AAAA`), 1)
		}
		_ = os.WriteFile(filepath.Join(dir, wrappedKeyFile), altered, 0o600)
		if _, err := p.Load(ctx, dir, node, false); err == nil {
			add("an altered wrapped key is refused", fmt.Errorf("it unwrapped after being altered"), "")
		} else {
			add("an altered wrapped key is refused", nil, "refused")
		}
	}
	return out
}
