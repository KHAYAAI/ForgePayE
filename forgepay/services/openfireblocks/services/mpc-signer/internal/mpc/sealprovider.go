package mpc

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/kms"
)

// The seal key encrypts everything a node keeps on disk: its identity, its
// pre-parameters and its key shares. Where that key lives decides what a stolen
// disk is worth:
//
//	file   — beside the data. A stolen disk includes the key. Development only.
//	env    — supplied by the platform (MPC_NODE_SEAL_KEY). The disk alone is
//	         not enough, but the key is in the process environment.
//	vault  — HashiCorp Vault transit. Disk holds only a wrapped copy; Vault
//	         must be reachable, and willing, to unwrap it at start-up.
//	awskms — AWS KMS. Same shape, with the wrapping key inside KMS.
//
// vault and awskms hold a random 32-byte data key wrapped by the key service,
// bound to the node's id so one node's wrapped key can't unlock another's data.
// The key is unwrapped once at start and held in memory; the key service is not
// on the signing path, so a Vault outage doesn't stop signing — only a restart.
const (
	ProviderFile   = "file"
	ProviderEnv    = "env"
	ProviderVault  = "vault"
	ProviderAWSKMS = "awskms"
)

const wrappedKeyFile = "seal.key.wrapped"

// SealKeyProvider produces a node's seal key.
type SealKeyProvider interface {
	Name() string
	// Load returns the seal key, creating and wrapping a new one the first time
	// (create=true). It never returns a key it could not authenticate.
	Load(ctx context.Context, dataDir, nodeID string, create bool) ([]byte, error)
}

// ProviderName chooses a provider from the environment: explicit
// MPC_SEAL_PROVIDER, else env if MPC_NODE_SEAL_KEY is set, else file.
// Production accepts only key services.
func ProviderName() (string, error) {
	name := strings.ToLower(os.Getenv("MPC_SEAL_PROVIDER"))
	if name == "" {
		if os.Getenv("MPC_NODE_SEAL_KEY") != "" {
			name = ProviderEnv
		} else {
			name = ProviderFile
		}
	}
	switch name {
	case ProviderFile, ProviderEnv, ProviderVault, ProviderAWSKMS:
	default:
		return "", fmt.Errorf("unknown MPC_SEAL_PROVIDER %q (file, env, vault, awskms)", name)
	}
	if Production() && name != ProviderVault && name != ProviderAWSKMS {
		return "", fmt.Errorf("MPC_ENV=production needs MPC_SEAL_PROVIDER=vault or awskms; %q keeps the seal key where the data is", name)
	}
	return name, nil
}

// Production reports whether the process runs in production mode.
func Production() bool { return os.Getenv("MPC_ENV") == "production" }

// NewSealKeyProvider builds the named provider from environment configuration.
func NewSealKeyProvider(name string) (SealKeyProvider, error) {
	switch name {
	case ProviderFile:
		return fileProvider{}, nil
	case ProviderEnv:
		return envProvider{}, nil
	case ProviderVault:
		return newVaultProvider()
	case ProviderAWSKMS:
		return &kmsProvider{}, nil
	}
	return nil, fmt.Errorf("unknown seal provider %q", name)
}

// LoadSealKey resolves the provider from the environment and loads the key.
func LoadSealKey(ctx context.Context, dataDir, nodeID string, create bool) ([]byte, string, error) {
	name, err := ProviderName()
	if err != nil {
		return nil, "", err
	}
	p, err := NewSealKeyProvider(name)
	if err != nil {
		return nil, "", err
	}
	key, err := p.Load(ctx, dataDir, nodeID, create)
	return key, name, err
}

// ---- file / env ------------------------------------------------------------

type fileProvider struct{}

func (fileProvider) Name() string { return ProviderFile }

func (fileProvider) Load(_ context.Context, dataDir, _ string, create bool) ([]byte, error) {
	path := filepath.Join(dataDir, "seal.key")
	if raw, err := os.ReadFile(path); err == nil {
		key, err := hex.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil || len(key) != 32 {
			return nil, fmt.Errorf("%s is not a valid seal key", path)
		}
		return key, nil
	}
	if !create {
		return nil, fmt.Errorf("no seal key at %s", path)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)), 0o600); err != nil {
		return nil, err
	}
	log.Printf("WARNING: seal provider is 'file': created %s. The shares are only as safe as this directory. Use MPC_SEAL_PROVIDER=vault or awskms outside development.", path)
	return key, nil
}

type envProvider struct{}

func (envProvider) Name() string { return ProviderEnv }

func (envProvider) Load(_ context.Context, _, _ string, _ bool) ([]byte, error) {
	key, err := hex.DecodeString(os.Getenv("MPC_NODE_SEAL_KEY"))
	if err != nil || len(key) != 32 {
		return nil, errors.New("MPC_NODE_SEAL_KEY must be 64 hex characters (32 bytes)")
	}
	return key, nil
}

// ---- wrapped-key file shared by vault and awskms ---------------------------

type wrappedKey struct {
	Provider   string `json:"provider"`
	KeyRef     string `json:"key_ref"`    // which wrapping key (vault transit key name / KMS key id or ARN)
	Node       string `json:"node"`       // bound at wrap time
	Ciphertext string `json:"ciphertext"` // provider-specific
	CreatedAt  string `json:"created_at"`
}

func wrappedPath(dataDir string) string { return filepath.Join(dataDir, wrappedKeyFile) }

func readWrapped(dataDir, provider, nodeID string) (*wrappedKey, error) {
	raw, err := os.ReadFile(wrappedPath(dataDir))
	if err != nil {
		return nil, err
	}
	var w wrappedKey
	if err := json.Unmarshal(raw, &w); err != nil {
		return nil, fmt.Errorf("%s: %w", wrappedPath(dataDir), err)
	}
	if w.Provider != provider {
		return nil, fmt.Errorf("this node's seal key is wrapped by %q, not %q (use `mpc-node seal-migrate` to change)", w.Provider, provider)
	}
	if w.Node != nodeID {
		return nil, fmt.Errorf("the wrapped seal key in %s belongs to node %q, not %q", dataDir, w.Node, nodeID)
	}
	return &w, nil
}

func writeWrapped(path string, w *wrappedKey) error {
	raw, _ := json.MarshalIndent(w, "", "  ")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ---- Vault transit ---------------------------------------------------------

type vaultProvider struct {
	addr, namespace, mount, keyName string
	http                            *http.Client
	token                           func(ctx context.Context) (string, error)
}

func newVaultProvider() (*vaultProvider, error) {
	addr := strings.TrimRight(os.Getenv("VAULT_ADDR"), "/")
	if addr == "" {
		return nil, errors.New("VAULT_ADDR is required for the vault seal provider")
	}
	if Production() && !strings.HasPrefix(addr, "https://") {
		return nil, errors.New("VAULT_ADDR must be https:// in production")
	}
	client := &http.Client{Timeout: 20 * time.Second}
	if ca := os.Getenv("VAULT_CACERT"); ca != "" {
		tlsCfg, err := tlsWithCA(ca)
		if err != nil {
			return nil, fmt.Errorf("VAULT_CACERT: %w", err)
		}
		client.Transport = &http.Transport{TLSClientConfig: tlsCfg}
	}
	v := &vaultProvider{
		addr: addr, namespace: os.Getenv("VAULT_NAMESPACE"), http: client,
		mount:   envOr("MPC_VAULT_TRANSIT_MOUNT", "transit"),
		keyName: os.Getenv("MPC_VAULT_KEY"),
	}
	v.token = v.resolveToken
	return v, nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func (v *vaultProvider) Name() string { return ProviderVault }

func (v *vaultProvider) keyFor(nodeID string) string {
	if v.keyName != "" {
		return v.keyName
	}
	return "mpc-node-" + nodeID
}

// resolveToken uses VAULT_TOKEN / VAULT_TOKEN_FILE, else AppRole.
func (v *vaultProvider) resolveToken(ctx context.Context) (string, error) {
	if t := os.Getenv("VAULT_TOKEN"); t != "" {
		return t, nil
	}
	if f := os.Getenv("VAULT_TOKEN_FILE"); f != "" {
		raw, err := os.ReadFile(f)
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(raw)), nil
	}
	role, secret := os.Getenv("VAULT_ROLE_ID"), os.Getenv("VAULT_SECRET_ID")
	if role == "" || secret == "" {
		return "", errors.New("set VAULT_TOKEN, VAULT_TOKEN_FILE, or VAULT_ROLE_ID and VAULT_SECRET_ID")
	}
	var out struct {
		Auth struct {
			ClientToken string `json:"client_token"`
		} `json:"auth"`
	}
	mount := envOr("VAULT_APPROLE_MOUNT", "approle")
	if err := v.do(ctx, "", http.MethodPut, "/v1/auth/"+mount+"/login", map[string]string{"role_id": role, "secret_id": secret}, &out); err != nil {
		return "", fmt.Errorf("vault approle login: %w", err)
	}
	if out.Auth.ClientToken == "" {
		return "", errors.New("vault approle login returned no token")
	}
	return out.Auth.ClientToken, nil
}

func (v *vaultProvider) do(ctx context.Context, token, method, path string, body, into any) error {
	var rdr io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, v.addr+path, rdr)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("X-Vault-Token", token)
	}
	if v.namespace != "" {
		req.Header.Set("X-Vault-Namespace", v.namespace)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := v.http.Do(req)
	if err != nil {
		return fmt.Errorf("vault unreachable: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		var e struct {
			Errors []string `json:"errors"`
		}
		_ = json.Unmarshal(raw, &e)
		msg := strings.Join(e.Errors, "; ")
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		return fmt.Errorf("vault HTTP %d: %s", resp.StatusCode, msg)
	}
	if into != nil {
		return json.Unmarshal(raw, into)
	}
	return nil
}

func (v *vaultProvider) transit(ctx context.Context, token, op, keyName string, body map[string]string, field string) (string, error) {
	var out struct {
		Data map[string]any `json:"data"`
	}
	if err := v.do(ctx, token, http.MethodPost, "/v1/"+v.mount+"/"+op+"/"+url.PathEscape(keyName), body, &out); err != nil {
		return "", err
	}
	s, _ := out.Data[field].(string)
	if s == "" {
		return "", fmt.Errorf("vault transit %s returned no %s", op, field)
	}
	return s, nil
}

func (v *vaultProvider) Load(ctx context.Context, dataDir, nodeID string, create bool) ([]byte, error) {
	token, err := v.token(ctx)
	if err != nil {
		return nil, err
	}
	keyName := v.keyFor(nodeID)
	if w, err := readWrapped(dataDir, ProviderVault, nodeID); err == nil {
		b64, err := v.transit(ctx, token, "decrypt", w.KeyRef, map[string]string{"ciphertext": w.Ciphertext}, "plaintext")
		if err != nil {
			return nil, fmt.Errorf("unwrapping the seal key: %w", err)
		}
		return decodeWrapped(b64, nodeID)
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if !create {
		return nil, fmt.Errorf("no wrapped seal key in %s", dataDir)
	}
	key, w, err := v.newWrapped(ctx, token, keyName, nodeID)
	if err != nil {
		return nil, err
	}
	if err := writeWrapped(wrappedPath(dataDir), w); err != nil {
		return nil, err
	}
	return key, nil
}

// newWrapped makes a fresh random key and wraps it. The plaintext handed to
// transit carries the node id, checked on unwrap.
func (v *vaultProvider) newWrapped(ctx context.Context, token, keyName, nodeID string) ([]byte, *wrappedKey, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, nil, err
	}
	payload, _ := json.Marshal(map[string]string{"node": nodeID, "key": hex.EncodeToString(key)})
	ct, err := v.transit(ctx, token, "encrypt", keyName, map[string]string{"plaintext": base64.StdEncoding.EncodeToString(payload)}, "ciphertext")
	if err != nil {
		return nil, nil, fmt.Errorf("wrapping the seal key: %w", err)
	}
	return key, &wrappedKey{Provider: ProviderVault, KeyRef: keyName, Node: nodeID, Ciphertext: ct, CreatedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func decodeWrapped(b64, nodeID string) ([]byte, error) {
	payload, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	var p struct{ Node, Key string }
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, errors.New("unwrapped seal key is malformed")
	}
	if p.Node != nodeID {
		return nil, fmt.Errorf("the unwrapped seal key belongs to node %q, not %q", p.Node, nodeID)
	}
	key, err := hex.DecodeString(p.Key)
	if err != nil || len(key) != 32 {
		return nil, errors.New("unwrapped seal key has the wrong length")
	}
	return key, nil
}

// Rewrap re-wraps the stored key under the newest version of the transit key,
// after a Vault key rotation. The seal key itself does not change, so no data
// is re-encrypted.
func (v *vaultProvider) Rewrap(ctx context.Context, dataDir, nodeID string) error {
	token, err := v.token(ctx)
	if err != nil {
		return err
	}
	w, err := readWrapped(dataDir, ProviderVault, nodeID)
	if err != nil {
		return err
	}
	ct, err := v.transit(ctx, token, "rewrap", w.KeyRef, map[string]string{"ciphertext": w.Ciphertext}, "ciphertext")
	if err != nil {
		return err
	}
	w.Ciphertext = ct
	return writeWrapped(wrappedPath(dataDir), w)
}

// ---- AWS KMS ---------------------------------------------------------------

type kmsProvider struct{ client *kms.Client }

func (k *kmsProvider) Name() string { return ProviderAWSKMS }

func (k *kmsProvider) api(ctx context.Context) (*kms.Client, error) {
	if k.client != nil {
		return k.client, nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}
	if cfg.Region == "" {
		return nil, errors.New("AWS_REGION is required for the awskms seal provider")
	}
	k.client = kms.NewFromConfig(cfg)
	return k.client, nil
}

func (k *kmsProvider) Load(ctx context.Context, dataDir, nodeID string, create bool) ([]byte, error) {
	client, err := k.api(ctx)
	if err != nil {
		return nil, err
	}
	encCtx := map[string]string{"mpc-node": nodeID}
	if w, err := readWrapped(dataDir, ProviderAWSKMS, nodeID); err == nil {
		blob, err := base64.StdEncoding.DecodeString(w.Ciphertext)
		if err != nil {
			return nil, err
		}
		out, err := client.Decrypt(ctx, &kms.DecryptInput{CiphertextBlob: blob, EncryptionContext: encCtx, KeyId: aws.String(w.KeyRef)})
		if err != nil {
			return nil, fmt.Errorf("unwrapping the seal key with KMS: %w", err)
		}
		if len(out.Plaintext) != 32 {
			return nil, errors.New("KMS returned a seal key of the wrong length")
		}
		return out.Plaintext, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if !create {
		return nil, fmt.Errorf("no wrapped seal key in %s", dataDir)
	}
	keyID := os.Getenv("MPC_KMS_KEY_ID")
	if keyID == "" {
		return nil, errors.New("MPC_KMS_KEY_ID is required for the awskms seal provider")
	}
	out, err := client.GenerateDataKey(ctx, &kms.GenerateDataKeyInput{KeyId: aws.String(keyID), NumberOfBytes: aws.Int32(32), EncryptionContext: encCtx})
	if err != nil {
		return nil, fmt.Errorf("generating the seal key with KMS: %w", err)
	}
	if len(out.Plaintext) != 32 {
		return nil, errors.New("KMS returned a seal key of the wrong length")
	}
	w := &wrappedKey{Provider: ProviderAWSKMS, KeyRef: keyID, Node: nodeID, Ciphertext: base64.StdEncoding.EncodeToString(out.CiphertextBlob), CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	if err := writeWrapped(wrappedPath(dataDir), w); err != nil {
		return nil, err
	}
	return out.Plaintext, nil
}

// RewrapVault re-wraps a Vault-held seal key under the newest transit key version.
func RewrapVault(ctx context.Context, dataDir, nodeID string) error {
	v, err := newVaultProvider()
	if err != nil {
		return err
	}
	return v.Rewrap(ctx, dataDir, nodeID)
}
