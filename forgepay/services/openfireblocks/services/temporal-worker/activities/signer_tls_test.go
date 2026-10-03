package activities

import (
	"net/http"
	"testing"
)

func TestSignerClientFailsClosedInProduction(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	fb := &http.Client{}
	if _, err := signerClientFrom(env(map[string]string{"NODE_ENV": "production"}), fb); err == nil {
		t.Fatal("production fell back to a client without mutual TLS")
	}
	if c, err := signerClientFrom(env(map[string]string{}), fb); err != nil || c != fb {
		t.Fatalf("development should use the plain client: %v", err)
	}
	if _, err := signerClientFrom(env(map[string]string{"MPC_SIGNER_CLIENT_CERT_FILE": "x"}), fb); err == nil {
		t.Fatal("a partial configuration was accepted")
	}
}
