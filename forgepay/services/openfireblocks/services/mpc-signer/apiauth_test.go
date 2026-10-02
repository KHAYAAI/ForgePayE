package main

import (
	"crypto/tls"
	"crypto/x509"
	"os"
	"time"

	"forge-crypto/mpc-signer/internal/mpc"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSignerAPIRequiresTheToken(t *testing.T) {
	token := strings.Repeat("a", 40)
	hit := 0
	h := authMiddleware(token, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hit++; w.WriteHeader(200) }))
	do := func(path, auth string) int {
		req := httptest.NewRequest("POST", path, nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	for _, p := range []string{"/sign", "/mpc/keys", "/mpc/keys/ws/reshare", "/mpc/keys/ws/retire-stale", "/mpc/status", "/address", "/metrics"} {
		if c := do(p, ""); c != 401 {
			t.Fatalf("%s without a credential: %d (was open before)", p, c)
		}
		if c := do(p, "Bearer wrong"); c != 401 {
			t.Fatalf("%s with a wrong credential: %d", p, c)
		}
		if c := do(p, token); c != 401 {
			t.Fatalf("%s with the token but no Bearer scheme: %d", p, c)
		}
	}
	if hit != 0 {
		t.Fatal("a handler ran without authentication")
	}
	if c := do("/sign", "Bearer "+token); c != 200 {
		t.Fatalf("the right token was refused: %d", c)
	}
	if c := do("/health", ""); c != 200 {
		t.Fatalf("health must stay open for probes: %d", c)
	}
}

func TestAuthTokenRules(t *testing.T) {
	if checkAuthToken("", true) == nil {
		t.Fatal("production started without a token")
	}
	if checkAuthToken("short", false) == nil {
		t.Fatal("a weak token was accepted")
	}
	if checkAuthToken("", false) != nil || checkAuthToken(strings.Repeat("x", 32), true) != nil {
		t.Fatal("valid configurations refused")
	}
}

func TestSignerMutualTLSAcceptsOnlyTheGatewayCertificate(t *testing.T) {
	dir := t.TempDir()
	if err := mpc.PKIInit(dir+"/ca", "test CA", 24*time.Hour); err != nil {
		t.Fatal(err)
	}
	for _, who := range []string{"signer", "gateway", "node1"} {
		if err := mpc.PKIIssue(dir+"/ca", who, []string{"127.0.0.1", "localhost"}, dir+"/"+who, 24*time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	files := &mpc.TLSFiles{CAFile: dir + "/signer/ca.pem", CertFile: dir + "/signer/cert.pem", KeyFile: dir + "/signer/key.pem"}
	h := requireClientName(signerClientCertName, authMiddleware(strings.Repeat("a", 40), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })))
	srv := httptest.NewUnstartedServer(h)
	srv.TLS = files.ServerConfig()
	srv.StartTLS()
	defer srv.Close()

	call := func(who, path string) (int, error) {
		var client *http.Client
		if who == "" {
			pool := x509.NewCertPool()
			pem, _ := os.ReadFile(dir + "/signer/ca.pem")
			pool.AppendCertsFromPEM(pem)
			client = &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}}}
		} else {
			cf := &mpc.TLSFiles{CAFile: dir + "/" + who + "/ca.pem", CertFile: dir + "/" + who + "/cert.pem", KeyFile: dir + "/" + who + "/key.pem"}
			client = cf.HTTPClient(5 * time.Second)
		}
		req, _ := http.NewRequest("POST", srv.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+strings.Repeat("a", 40))
		resp, err := client.Do(req)
		if err != nil {
			return 0, err
		}
		defer resp.Body.Close()
		return resp.StatusCode, nil
	}
	if code, err := call("gateway", "/sign"); err != nil || code != 200 {
		t.Fatalf("the gateway certificate with the token: %d %v", code, err)
	}
	if code, err := call("node1", "/sign"); err != nil || code != 403 {
		t.Fatalf("a signing node's certificate (valid CA, wrong name): %d %v", code, err)
	}
	if _, err := call("", "/sign"); err == nil {
		t.Fatal("a client with no certificate got through the handshake")
	}
}
