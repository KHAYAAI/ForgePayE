package mpc

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fakeVault implements just enough of Vault's transit API to test the provider:
// it "encrypts" by tagging, and checks the token and namespace it was given.
func fakeVault(t *testing.T, token string) (*httptest.Server, *[]string) {
	t.Helper()
	var mu sync.Mutex
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls = append(calls, r.URL.Path)
		mu.Unlock()
		if r.Header.Get("X-Vault-Token") != token {
			w.WriteHeader(403)
			_, _ = w.Write([]byte(`{"errors":["permission denied"]}`))
			return
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/") // v1 transit op name
		reply := func(k, v string) { _ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{k: v}}) }
		switch parts[2] {
		case "encrypt":
			reply("ciphertext", "vault:v1:"+parts[3]+":"+body["plaintext"])
		case "decrypt":
			c := strings.SplitN(body["ciphertext"], ":", 4)
			if len(c) != 4 || c[2] != parts[3] {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"errors":["wrong key"]}`))
				return
			}
			reply("plaintext", c[3])
		case "rewrap":
			reply("ciphertext", strings.Replace(body["ciphertext"], "vault:v1:", "vault:v2:", 1))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

func TestVaultProviderWrapsKeyAndBindsItToTheNode(t *testing.T) {
	srv, calls := fakeVault(t, "s3cret")
	t.Setenv("VAULT_ADDR", srv.URL)
	t.Setenv("VAULT_TOKEN", "s3cret")
	dir := t.TempDir()
	ctx := context.Background()

	p, err := newVaultProvider()
	if err != nil {
		t.Fatal(err)
	}
	key, err := p.Load(ctx, dir, "node1", true)
	if err != nil || len(key) != 32 {
		t.Fatalf("create: %v", err)
	}
	// Disk holds only the wrapped key: the plaintext must not be anywhere in it.
	raw, _ := os.ReadFile(filepath.Join(dir, wrappedKeyFile))
	if bytes.Contains(raw, []byte(base64.StdEncoding.EncodeToString(key))) || strings.Contains(string(raw), hexOf(key)) {
		t.Fatal("wrapped key file contains the plaintext seal key")
	}
	if _, err := os.Stat(filepath.Join(dir, "seal.key")); err == nil {
		t.Fatal("a plaintext seal.key was written")
	}

	again, err := p.Load(ctx, dir, "node1", false)
	if err != nil || !bytes.Equal(again, key) {
		t.Fatalf("reload gave a different key: %v", err)
	}
	if _, err := p.Load(ctx, dir, "node2", false); err == nil || !strings.Contains(err.Error(), "belongs to node") {
		t.Fatalf("another node's wrapped key must not load, got %v", err)
	}

	t.Setenv("VAULT_TOKEN", "wrong")
	bad, _ := newVaultProvider()
	if _, err := bad.Load(ctx, dir, "node1", false); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("bad token should surface Vault's refusal, got %v", err)
	}

	t.Setenv("VAULT_TOKEN", "s3cret")
	if err := p.Rewrap(ctx, dir, "node1"); err != nil {
		t.Fatal(err)
	}
	again, err = p.Load(ctx, dir, "node1", false)
	if err != nil || !bytes.Equal(again, key) {
		t.Fatal("rewrap changed the key")
	}
	if !strings.Contains(strings.Join(*calls, " "), "rewrap") {
		t.Fatal("rewrap never reached Vault")
	}
}

func TestVaultUnreachableFailsClosed(t *testing.T) {
	t.Setenv("VAULT_ADDR", "http://127.0.0.1:1")
	t.Setenv("VAULT_TOKEN", "x")
	p, _ := newVaultProvider()
	dir := t.TempDir()
	if err := writeWrapped(wrappedPath(dir), &wrappedKey{Provider: ProviderVault, KeyRef: "k", Node: "node1", Ciphertext: "vault:v1:k:AAAA"}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Load(context.Background(), dir, "node1", false); err == nil {
		t.Fatal("must not produce a key when Vault is unreachable")
	}
}

func TestProductionRefusesKeysBesideTheData(t *testing.T) {
	t.Setenv("MPC_ENV", "production")
	for _, name := range []string{"", "file", "env"} {
		t.Setenv("MPC_SEAL_PROVIDER", name)
		if _, err := ProviderName(); err == nil {
			t.Errorf("production accepted seal provider %q", name)
		}
	}
	t.Setenv("MPC_SEAL_PROVIDER", "vault")
	if n, err := ProviderName(); err != nil || n != "vault" {
		t.Fatalf("vault should be allowed in production: %v", err)
	}
	t.Setenv("VAULT_ADDR", "http://vault.internal:8200")
	if _, err := newVaultProvider(); err == nil {
		t.Fatal("production must require an https Vault address")
	}
}

// fakeKMS speaks the KMS JSON protocol for GenerateDataKey and Decrypt.
func fakeKMS(t *testing.T) *httptest.Server {
	t.Helper()
	type entry struct {
		plain []byte
		ctx   map[string]string
	}
	var mu sync.Mutex
	store := map[string]entry{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			KeyId             string
			NumberOfBytes     int
			EncryptionContext map[string]string
			CiphertextBlob    []byte
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		w.Header().Set("Content-Type", "application/x-amz-json-1.1")
		mu.Lock()
		defer mu.Unlock()
		switch r.Header.Get("X-Amz-Target") {
		case "TrentService.GenerateDataKey":
			plain := make([]byte, in.NumberOfBytes)
			_, _ = rand.Read(plain)
			blob := make([]byte, 24)
			_, _ = rand.Read(blob)
			store[string(blob)] = entry{plain, in.EncryptionContext}
			_ = json.NewEncoder(w).Encode(map[string]any{"CiphertextBlob": blob, "Plaintext": plain, "KeyId": in.KeyId})
		case "TrentService.Decrypt":
			e, ok := store[string(in.CiphertextBlob)]
			if !ok || e.ctx["mpc-node"] != in.EncryptionContext["mpc-node"] {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"__type":"InvalidCiphertextException","message":"context mismatch"}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"Plaintext": e.plain, "KeyId": in.KeyId})
		default:
			w.WriteHeader(400)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestKMSProviderUsesEncryptionContext(t *testing.T) {
	srv := fakeKMS(t)
	t.Setenv("AWS_ENDPOINT_URL_KMS", srv.URL)
	t.Setenv("AWS_REGION", "us-east-1")
	t.Setenv("AWS_ACCESS_KEY_ID", "test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test")
	t.Setenv("MPC_KMS_KEY_ID", "alias/mpc-node")
	dir := t.TempDir()
	ctx := context.Background()
	p := &kmsProvider{}

	key, err := p.Load(ctx, dir, "node1", true)
	if err != nil || len(key) != 32 {
		t.Fatalf("create: %v", err)
	}
	again, err := (&kmsProvider{}).Load(ctx, dir, "node1", false)
	if err != nil || !bytes.Equal(again, key) {
		t.Fatalf("reload: %v", err)
	}
	// The same wrapped blob presented as another node must be refused by KMS
	// itself (encryption context), and by our own node check first.
	raw, _ := os.ReadFile(wrappedPath(dir))
	forged := strings.Replace(string(raw), `"node": "node1"`, `"node": "node2"`, 1)
	dir2 := t.TempDir()
	_ = os.WriteFile(wrappedPath(dir2), []byte(forged), 0o600)
	if _, err := (&kmsProvider{}).Load(ctx, dir2, "node2", false); err == nil {
		t.Fatal("a wrapped key relabelled for another node must not unwrap")
	}
}

func TestMigrateSealKeyFileToVaultAndResume(t *testing.T) {
	srv, _ := fakeVault(t, "tok")
	t.Setenv("VAULT_ADDR", srv.URL)
	t.Setenv("VAULT_TOKEN", "tok")
	dir := t.TempDir()
	ctx := context.Background()

	old, err := fileProvider{}.Load(ctx, dir, "node1", true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InitIdentity(dir, "node1", "http://x", "d", old); err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Join(dir, "keys"), 0o700)
	share, _ := Seal(old, []byte("a share"), keyAAD("ws-a", 0))
	_ = os.WriteFile(filepath.Join(dir, "keys", "ws-a.sealed"), share, 0o600)
	share2, _ := Seal(old, []byte("a later share"), keyAAD("ws-a", 3))
	_ = os.WriteFile(filepath.Join(dir, "keys", "ws-a.e3.sealed"), share2, 0o600)
	_ = os.MkdirAll(filepath.Join(dir, "preparams"), 0o700)
	pp, _ := Seal(old, []byte("pre"), "preparams")
	_ = os.WriteFile(filepath.Join(dir, "preparams", "one.sealed"), pp, 0o600)

	to, _ := newVaultProvider()
	n, err := MigrateSealKey(ctx, dir, "node1", fileProvider{}, to)
	if err != nil || n != 4 {
		t.Fatalf("migrated %d files, err %v", n, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "seal.key")); err == nil {
		t.Fatal("the plaintext seal key survived migration")
	}
	newKey, err := to.Load(ctx, dir, "node1", false)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(newKey, old) {
		t.Fatal("migration reused the old key")
	}
	for _, f := range []struct{ path, aad, want string }{
		{"keys/ws-a.sealed", "key|ws-a", "a share"},
		{"keys/ws-a.e3.sealed", "key|ws-a|e3", "a later share"},
	} {
		raw, _ := os.ReadFile(filepath.Join(dir, f.path))
		got, err := Open(newKey, raw, f.aad)
		if err != nil || string(got) != f.want {
			t.Fatalf("%s did not survive migration: %v", f.path, err)
		}
	}
	if _, _, err := LoadIdentity(dir, "node1", newKey); err != nil {
		t.Fatalf("identity did not survive: %v", err)
	}
}

func hexOf(b []byte) string { return strings.ToLower(hexEncode(b)) }
