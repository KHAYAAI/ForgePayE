package mpc

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func clusterOf(domains ...string) *Cluster {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	c := &Cluster{Threshold: 1, CoordinatorPub: hex.EncodeToString(pub)}
	for i, d := range domains {
		c.Nodes = append(c.Nodes, NodeInfo{ID: "node" + string(rune('1'+i)), URL: "https://n" + string(rune('1'+i)) + ".example", X25519Pub: strings.Repeat("00", 32), Domain: d})
	}
	return c
}

func TestNoSingleDomainMayHoldEnoughNodesToSign(t *testing.T) {
	// 2-of-3: two nodes in one domain is enough to sign alone.
	c := clusterOf("aws-a", "aws-a", "gcp-b")
	if got := c.ExposedDomains(c.AllNodeIDs(), 1); len(got) != 1 || got[0] != "aws-a" {
		t.Fatalf("exposed = %v", got)
	}
	if err := c.CheckProduction(c.AllNodeIDs(), 1); err == nil || !strings.Contains(err.Error(), "aws-a") {
		t.Fatalf("production must refuse it, got %v", err)
	}
	// One node per domain is sound.
	c = clusterOf("aws-a", "gcp-b", "azure-c")
	if err := c.CheckProduction(c.AllNodeIDs(), 1); err != nil {
		t.Fatalf("one node per domain should pass: %v", err)
	}
	// 3-of-5 tolerates two nodes per domain but not three.
	c = clusterOf("a", "a", "b", "b", "c")
	if err := c.CheckProduction(c.AllNodeIDs(), 2); err != nil {
		t.Fatalf("2+2+1 across three domains is fine for 3-of-5: %v", err)
	}
	c = clusterOf("a", "a", "a", "b", "c")
	if err := c.CheckProduction(c.AllNodeIDs(), 2); err == nil {
		t.Fatal("three nodes in one domain can sign a 3-of-5 key alone")
	}
	// The same rule applies to a committee chosen for a reshare.
	c = clusterOf("a", "b", "c", "a")
	if c.ExposedDomains([]string{"node1", "node2", "node3"}, 1) != nil {
		t.Fatal("node1,node2,node3 are three different domains")
	}
	if len(c.ExposedDomains([]string{"node1", "node4", "node2"}, 1)) != 1 {
		t.Fatal("node1+node4 share a domain and can sign a 2-of-3 alone")
	}
	// http is refused in production.
	c = clusterOf("a", "b", "c")
	c.Nodes[1].URL = "http://n2.example"
	if err := c.CheckProduction(c.AllNodeIDs(), 1); err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("plain http must be refused in production, got %v", err)
	}
}

func TestProductionNodeRefusesToStartInADevTopology(t *testing.T) {
	t.Setenv("MPC_ENV", "production")
	c := clusterOf("dev-local", "dev-local", "dev-local")
	dir := t.TempDir()
	key := make([]byte, 32)
	if _, err := InitIdentity(dir, "node1", "https://n1.example", "dev-local", key); err != nil {
		t.Fatal(err)
	}
	if _, err := NewNode(NodeConfig{DataDir: dir, ID: "node1", Cluster: c, SealKey: key}); err == nil || !strings.Contains(err.Error(), "TLS") {
		t.Fatalf("production without mutual TLS must not start, got %v", err)
	}
	tlsFiles := issueTestPKI(t, "node1")
	_, err := NewNode(NodeConfig{DataDir: dir, ID: "node1", Cluster: c, SealKey: key, TLS: tlsFiles})
	if err == nil || !strings.Contains(err.Error(), "dev-local") {
		t.Fatalf("production with one trust domain must not start, got %v", err)
	}
}

// issueTestPKI makes a CA and a certificate for name (valid for 127.0.0.1).
func issueTestPKI(t *testing.T, name string) *TLSFiles {
	t.Helper()
	root := t.TempDir()
	ca := filepath.Join(root, "ca")
	if err := PKIInit(ca, "test CA", time.Hour); err != nil {
		t.Fatal(err)
	}
	return issueFrom(t, ca, root, name)
}

func issueFrom(t *testing.T, ca, root, name string) *TLSFiles {
	t.Helper()
	out := filepath.Join(root, name)
	if err := PKIIssue(ca, name, []string{"127.0.0.1", "localhost"}, out, time.Hour); err != nil {
		t.Fatal(err)
	}
	return &TLSFiles{CAFile: filepath.Join(out, "ca.pem"), CertFile: filepath.Join(out, "cert.pem"), KeyFile: filepath.Join(out, "key.pem")}
}

func TestMutualTLSIdentifiesCallers(t *testing.T) {
	root := t.TempDir()
	ca := filepath.Join(root, "ca")
	if err := PKIInit(ca, "test CA", time.Hour); err != nil {
		t.Fatal(err)
	}
	nodeTLS := issueFrom(t, ca, root, "node1")
	coordTLS := issueFrom(t, ca, root, "coordinator")
	peerTLS := issueFrom(t, ca, root, "node2")
	strangerRoot := t.TempDir()
	strangerCA := filepath.Join(strangerRoot, "ca")
	_ = PKIInit(strangerCA, "someone else's CA", time.Hour)
	strangerTLS := issueFrom(t, strangerCA, strangerRoot, "coordinator")

	coordPub, coordPriv, _ := ed25519.GenerateKey(rand.Reader)
	cluster := clusterOf("a", "b", "c")
	cluster.CoordinatorPub = hex.EncodeToString(coordPub)
	dir := t.TempDir()
	seal := make([]byte, 32)
	pub, err := InitIdentity(dir, "node1", "https://127.0.0.1", "a", seal)
	if err != nil {
		t.Fatal(err)
	}
	cluster.Nodes[0].X25519Pub = pub.X25519Pub
	node, err := NewNode(NodeConfig{DataDir: dir, ID: "node1", Cluster: cluster, SealKey: seal, TLS: nodeTLS})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewUnstartedServer(node.Handler())
	srv.TLS = nodeTLS.ServerConfig()
	srv.StartTLS()
	defer srv.Close()

	do := func(c *http.Client, method, path, body string) (int, string) {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.Do(req)
		if err != nil {
			return 0, err.Error()
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	coordClient := coordTLS.HTTPClient(5 * time.Second)

	if code, _ := do(coordClient, "GET", "/v1/health", ""); code != 200 {
		t.Fatalf("the coordinator's certificate should reach the node: %d", code)
	}
	if code, msg := do(&http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}, "GET", "/v1/health", ""); code != 0 {
		t.Fatalf("a caller without a client certificate got in: %d %s", code, msg)
	}
	if code, msg := do(strangerTLS.HTTPClient(5*time.Second), "GET", "/v1/health", ""); code != 0 {
		t.Fatalf("a certificate from another CA got in: %d %s", code, msg)
	}
	if code, _ := do(peerTLS.HTTPClient(5*time.Second), "GET", "/v1/health", ""); code != 200 {
		t.Fatalf("a peer may read health: %d", code)
	}
	// A peer's certificate must not be able to start ceremonies.
	if code, msg := do(peerTLS.HTTPClient(5*time.Second), "POST", "/v1/keygen", "{}"); code != http.StatusForbidden || !strings.Contains(msg, "coordinator") {
		t.Fatalf("a peer started a ceremony: %d %s", code, msg)
	}
	// A peer may only send messages as itself.
	spoof := `{"session":"s","from":"node3","to":"node1","from_party":"node3","to_party":"node1","seq":1,"type":"x"}`
	if code, msg := do(peerTLS.HTTPClient(5*time.Second), "POST", "/v1/msg", spoof); code != http.StatusForbidden || !strings.Contains(msg, "certificate") {
		t.Fatalf("node2's certificate sent as node3: %d %s", code, msg)
	}
	honest := `{"session":"s","from":"node2","to":"node1","from_party":"node2","to_party":"node1","seq":1,"type":"x"}`
	if code, _ := do(peerTLS.HTTPClient(5*time.Second), "POST", "/v1/msg", honest); code == http.StatusForbidden {
		t.Fatal("a peer was refused sending as itself")
	}
	// And the coordinator's certificate alone isn't enough: the body must be signed too.
	if code, msg := do(coordClient, "POST", "/v1/keygen", "{}"); code != http.StatusUnauthorized {
		t.Fatalf("an unsigned request with the right certificate: %d %s", code, msg)
	}
	_ = coordPriv
	_ = context.Background
}
