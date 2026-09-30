package mpc

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"forge-crypto/mpc-signer/internal/ethtx"
	"github.com/ethereum/go-ethereum/core/types"
	eth "github.com/ethereum/go-ethereum/crypto"
)

// ---- fast unit tests ------------------------------------------------------

func TestSealRoundTripAndBinding(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	sealed, err := Seal(key, []byte("share"), "key|a")
	if err != nil {
		t.Fatal(err)
	}
	if got, err := Open(key, sealed, "key|a"); err != nil || string(got) != "share" {
		t.Fatalf("round trip: %q %v", got, err)
	}
	if _, err := Open(key, sealed, "key|b"); err == nil {
		t.Fatal("a sealed share opened under a different key id")
	}
	if _, err := Open(bytes.Repeat([]byte{8}, 32), sealed, "key|a"); err == nil {
		t.Fatal("opened with the wrong seal key")
	}
	sealed[len(sealed)-1] ^= 1
	if _, err := Open(key, sealed, "key|a"); err == nil {
		t.Fatal("tampered ciphertext was accepted")
	}
}

func TestPeerMessagesAreAuthenticatedAndDirectional(t *testing.T) {
	a, _ := ecdh.X25519().GenerateKey(rand.Reader)
	b, _ := ecdh.X25519().GenerateKey(rand.Reader)
	c, _ := ecdh.X25519().GenerateKey(rand.Reader)
	m := &PeerMessage{Session: "s1", From: "a", To: "b", Seq: 1, Type: "round"}
	if err := EncryptMessage(a, b.PublicKey(), m, []byte("secret share")); err != nil {
		t.Fatal(err)
	}
	if got, err := DecryptMessage(b, a.PublicKey(), m); err != nil || string(got) != "secret share" {
		t.Fatalf("recipient could not read: %v", err)
	}
	if bytes.Contains(m.Payload, []byte("secret share")) {
		t.Fatal("payload is not encrypted")
	}
	if _, err := DecryptMessage(c, a.PublicKey(), m); err == nil {
		t.Fatal("a third node read a message not addressed to it")
	}
	// Any change to the routing header must fail authentication.
	for name, mut := range map[string]func(*PeerMessage){
		"session": func(x *PeerMessage) { x.Session = "s2" },
		"from":    func(x *PeerMessage) { x.From = "c" },
		"seq":     func(x *PeerMessage) { x.Seq = 2 },
		"type":    func(x *PeerMessage) { x.Type = "other" },
		"payload": func(x *PeerMessage) { x.Payload[0] ^= 1 },
	} {
		cp := *m
		cp.Payload = append([]byte(nil), m.Payload...)
		mut(&cp)
		if _, err := DecryptMessage(b, a.PublicKey(), &cp); err == nil {
			t.Fatalf("altered %s was accepted", name)
		}
	}
}

func TestCoordinatorSignature(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	body := []byte(`{"session":"x"}`)
	sig := SignBody(priv, body)
	if !VerifyBody(pub, body, sig) {
		t.Fatal("valid signature rejected")
	}
	if VerifyBody(pub, append(body, ' '), sig) {
		t.Fatal("signature verified over different bytes")
	}
	other, _, _ := ed25519.GenerateKey(rand.Reader)
	if VerifyBody(other, body, sig) {
		t.Fatal("signature verified under another key")
	}
}

func TestClusterValidation(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	xk, _ := ecdh.X25519().GenerateKey(rand.Reader)
	node := func(id string) NodeInfo {
		return NodeInfo{ID: id, URL: "http://x", X25519Pub: hex.EncodeToString(xk.PublicKey().Bytes())}
	}
	ok := Cluster{Threshold: 1, CoordinatorPub: hex.EncodeToString(pub), Nodes: []NodeInfo{node("a"), node("b"), node("c")}}
	if err := ok.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, mut := range map[string]func(*Cluster){
		"threshold equals n":  func(c *Cluster) { c.Threshold = 3 },
		"threshold zero":      func(c *Cluster) { c.Threshold = 0 },
		"duplicate node":      func(c *Cluster) { c.Nodes[1].ID = "a" },
		"bad node id":         func(c *Cluster) { c.Nodes[0].ID = "../etc" },
		"bad coordinator key": func(c *Cluster) { c.CoordinatorPub = "abcd" },
		"single node":         func(c *Cluster) { c.Nodes = c.Nodes[:1] },
	} {
		c := ok
		c.Nodes = append([]NodeInfo(nil), ok.Nodes...)
		mut(&c)
		if c.Validate() == nil {
			t.Fatalf("%s was accepted", name)
		}
	}
}

// Ethereum rejects signatures whose S is in the upper half of the curve order.
func TestFinalizeSignatureFoldsHighS(t *testing.T) {
	key, _ := eth.GenerateKey()
	hash := eth.Keccak256([]byte("hello"))
	sig, err := eth.Sign(hash, key)
	if err != nil {
		t.Fatal(err)
	}
	n := eth.S256().Params().N
	high := new(big.Int).Sub(n, new(big.Int).SetBytes(sig[32:64])) // the malleated twin
	pub := hex.EncodeToString(eth.FromECDSAPub(&key.PublicKey))
	out, err := finalizeSignature(hash, sig[:32], high.Bytes(), pub)
	if err != nil {
		t.Fatalf("high-S input was not repaired: %v", err)
	}
	if new(big.Int).SetBytes(out[32:64]).Cmp(new(big.Int).Rsh(n, 1)) > 0 {
		t.Fatal("output S is still in the upper half")
	}
	if _, err := finalizeSignature(eth.Keccak256([]byte("other")), sig[:32], sig[32:64], pub); err == nil {
		t.Fatal("a signature over a different message was accepted")
	}
}

func TestAuditChainDetectsTampering(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.log")
	a, _ := newAuditLog(path)
	for i := 0; i < 4; i++ {
		a.Record("sign_completed", fmt.Sprintf("s%d", i), "k", map[string]any{"i": i})
	}
	if n, err := VerifyAuditChain(path); err != nil || n != 4 {
		t.Fatalf("intact chain: %d %v", n, err)
	}
	raw, _ := os.ReadFile(path)
	lines := bytes.Split(bytes.TrimSpace(raw), []byte("\n"))
	lines[1] = bytes.Replace(lines[1], []byte(`"i":1`), []byte(`"i":9`), 1)
	os.WriteFile(path, append(bytes.Join(lines, []byte("\n")), '\n'), 0o600)
	if _, err := VerifyAuditChain(path); err == nil {
		t.Fatal("an edited entry went undetected")
	}
	// Removing an entry must break the chain too.
	lines = append(lines[:1], lines[2:]...)
	os.WriteFile(path, append(bytes.Join(lines, []byte("\n")), '\n'), 0o600)
	if _, err := VerifyAuditChain(path); err == nil {
		t.Fatal("a removed entry went undetected")
	}
}

// ---- the real thing: three nodes, real HTTP, real tss-lib ------------------

type harness struct {
	t       *testing.T
	cluster *Cluster
	coord   *Coordinator
	coordPk ed25519.PrivateKey
	cfgs    []NodeConfig
	nodes   []*Node
	servers []*httptest.Server
	handler []*atomic.Pointer[http.Handler]
	down    []atomic.Bool
}

func newHarness(t *testing.T) *harness { return newHarnessN(t, 3, 1) }

func newHarnessN(t *testing.T, n, threshold int) *harness {
	t.Helper()
	h := &harness{t: t, down: make([]atomic.Bool, n)}
	coordPub, coordPriv, _ := ed25519.GenerateKey(rand.Reader)
	h.coordPk = coordPriv

	cluster := &Cluster{Threshold: threshold, CoordinatorPub: hex.EncodeToString(coordPub)}
	for i := 0; i < n; i++ {
		i := i
		ptr := &atomic.Pointer[http.Handler]{}
		srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if h.down[i].Load() {
				// A dead node doesn't answer; it drops the connection.
				if hj, ok := w.(http.Hijacker); ok {
					if c, _, err := hj.Hijack(); err == nil {
						c.Close()
					}
				}
				return
			}
			(*ptr.Load()).ServeHTTP(w, r)
		}))
		srv.Start()
		t.Cleanup(srv.Close)

		id := fmt.Sprintf("node%d", i+1)
		dir := t.TempDir()
		sealKey := make([]byte, 32)
		rand.Read(sealKey)
		pub, err := InitIdentity(dir, id, srv.URL, fmt.Sprintf("test-domain-%d", i+1), sealKey)
		if err != nil {
			t.Fatal(err)
		}
		cluster.Nodes = append(cluster.Nodes, NodeInfo{ID: id, URL: srv.URL, X25519Pub: pub.X25519Pub, Domain: pub.Domain})
		policyPath := filepath.Join(dir, "policy.json")
		if err := os.WriteFile(policyPath, []byte("{}"), 0o600); err != nil {
			t.Fatal(err)
		}
		h.cfgs = append(h.cfgs, NodeConfig{DataDir: dir, ID: id, SealKey: sealKey, PolicyFile: policyPath})
		h.servers = append(h.servers, srv)
		h.handler = append(h.handler, ptr)
	}
	if err := cluster.Validate(); err != nil {
		t.Fatal(err)
	}
	h.cluster = cluster
	for i := range h.cfgs {
		h.cfgs[i].Cluster = cluster
		h.startNode(i)
	}
	coord, err := NewCoordinator(cluster, coordPriv)
	if err != nil {
		t.Fatal(err)
	}
	h.coord = coord
	return h
}

// setPolicy replaces every node's own policy file, as each node's operator would.
func (h *harness) setPolicy(body string) {
	h.t.Helper()
	for _, c := range h.cfgs {
		if err := os.WriteFile(c.PolicyFile, []byte(body), 0o600); err != nil {
			h.t.Fatal(err)
		}
		future := time.Now().Add(time.Duration(len(body)+1) * time.Second) // never equal to the last mtime
		_ = os.Chtimes(c.PolicyFile, future, future)
	}
}

func (h *harness) startNode(i int) {
	node, err := NewNode(h.cfgs[i])
	if err != nil {
		h.t.Fatal(err)
	}
	var handler http.Handler = node.Handler()
	h.handler[i].Store(&handler)
	if len(h.nodes) <= i {
		h.nodes = append(h.nodes, node)
	} else {
		h.nodes[i] = node
	}
}

// waitForPreParams lets every node finish its slow prime generation, so key
// generation measures the protocol rather than piling more CPU onto the box.
func (h *harness) waitForPreParams() {
	deadline := time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		ready := 0
		for _, st := range h.coord.Health(context.Background()) {
			if st.PreParams >= 1 {
				ready++
			}
		}
		if ready == len(h.nodes) {
			return
		}
		time.Sleep(time.Second)
	}
	h.t.Fatal("nodes never finished generating pre-parameters")
}

func testTx(nonce uint64, value string) *ethtx.SignRequest {
	return &ethtx.SignRequest{
		ChainID: 11155111, To: "0x49ddddb2987a27e2de4ba26bd57e646caf8c548c",
		Value: value, GasLimit: 21000, GasPrice: "20000000000", Nonce: nonce,
	}
}

func (h *harness) mustSign(nonce uint64, key *KeyInfo) *SignedTx {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	out, err := h.coord.Sign(ctx, key.KeyID, key.Address, testTx(nonce, "1000000000000000"))
	if err != nil {
		h.t.Fatalf("sign: %v", err)
	}
	return out
}

// verifyOnChainRules checks the signed transaction the way an Ethereum node would.
func verifyOnChainRules(t *testing.T, out *SignedTx, want string) {
	t.Helper()
	raw, _ := hex.DecodeString(strings.TrimPrefix(out.RawTx, "0x"))
	tx := new(types.Transaction)
	if err := tx.UnmarshalBinary(raw); err != nil {
		t.Fatal(err)
	}
	from, err := types.Sender(types.NewEIP155Signer(big.NewInt(11155111)), tx)
	if err != nil {
		t.Fatalf("network would reject this transaction: %v", err)
	}
	if !strings.EqualFold(from.Hex(), want) {
		t.Fatalf("sender %s != key address %s", from.Hex(), want)
	}
}

func (h *harness) rawPost(node int, path string, body []byte, sig string) (int, string) {
	req, _ := http.NewRequest(http.MethodPost, h.servers[node].URL+path, bytes.NewReader(body))
	if sig != "" {
		req.Header.Set("X-Coordinator-Signature", sig)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]string
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out["error"]
}

func TestThresholdSigningAcrossRealNodes(t *testing.T) {
	if testing.Short() {
		t.Skip("real key generation takes a minute of CPU; skipped in -short")
	}
	h := newHarness(t)
	h.waitForPreParams()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	// ---- key generation ----
	start := time.Now()
	key, err := h.coord.Keygen(ctx, "ws-alpha")
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	t.Logf("2-of-3 key generated across 3 nodes in %s: %s", time.Since(start).Round(time.Millisecond), key.Address)

	t.Run("each node holds its own sealed share and they differ", func(t *testing.T) {
		var blobs [][]byte
		for i, c := range h.cfgs {
			raw, err := os.ReadFile(filepath.Join(c.DataDir, "keys", "ws-alpha.sealed"))
			if err != nil {
				t.Fatalf("node %d has no share: %v", i+1, err)
			}
			if bytes.Contains(raw, []byte(key.PublicKey)) {
				t.Fatalf("node %d's share file is readable without the seal key", i+1)
			}
			if _, err := Open(h.cfgs[(i+1)%3].SealKey, raw, "key|ws-alpha"); err == nil {
				t.Fatalf("node %d's share opened with node %d's seal key", i+1, (i+1)%3+1)
			}
			plain, err := Open(c.SealKey, raw, "key|ws-alpha")
			if err != nil {
				t.Fatal(err)
			}
			var sk storedKey
			json.Unmarshal(plain, &sk)
			if sk.Address != key.Address {
				t.Fatalf("node %d disagrees on the address", i+1)
			}
			blobs = append(blobs, plain)
		}
		if bytes.Equal(blobs[0], blobs[1]) || bytes.Equal(blobs[1], blobs[2]) {
			t.Fatal("two nodes hold identical key material")
		}
	})

	t.Run("a key id can't be overwritten", func(t *testing.T) {
		if _, err := h.coord.Keygen(ctx, "ws-alpha"); err == nil {
			t.Fatal("regenerating an existing key id succeeded")
		}
	})

	t.Run("every 2-node committee signs a valid Ethereum transaction", func(t *testing.T) {
		// Take nodes offline to force each committee: {1,2}, {1,3}, {2,3}.
		cases := []struct {
			down      int
			committee string
		}{{2, "node1,node2"}, {1, "node1,node3"}, {0, "node2,node3"}}
		for i, c := range cases {
			h.down[c.down].Store(true)
			began := time.Now()
			out := h.mustSign(uint64(i), key)
			h.down[c.down].Store(false)
			t.Logf("committee %s took %s", c.committee, time.Since(began).Round(time.Millisecond))
			if got := strings.Join(out.Committee, ","); got != c.committee {
				t.Fatalf("committee = %s, want %s", got, c.committee)
			}
			verifyOnChainRules(t, out, key.Address)
			t.Logf("signed by %s -> %s", c.committee, out.Hash[:14])
		}
	})

	t.Run("one node down is tolerated, two down is refused", func(t *testing.T) {
		h.down[0].Store(true)
		verifyOnChainRules(t, h.mustSign(10, key), key.Address)
		h.down[1].Store(true)
		_, err := h.coord.Sign(ctx, key.KeyID, key.Address, testTx(11, "1"))
		var q *ErrQuorumUnavailable
		if !errors.As(err, &q) || q.Reachable != 1 || q.Needed != 2 {
			t.Fatalf("want a quorum-unavailable error, got %v", err)
		}
		h.down[0].Store(false)
		h.down[1].Store(false)
		verifyOnChainRules(t, h.mustSign(12, key), key.Address)
	})

	t.Run("signing routes to the right key", func(t *testing.T) {
		h.waitForPreParams() // key generation consumes a pre-parameter set per node; refilling is CPU-bound
		other, err := h.coord.Keygen(ctx, "ws-beta")
		if err != nil {
			t.Fatal(err)
		}
		if other.Address == key.Address {
			t.Fatal("two workspaces got the same address")
		}
		verifyOnChainRules(t, h.mustSign(20, other), other.Address)
		// Asking for one key while claiming the other's address must fail.
		_, err = h.coord.Sign(ctx, "ws-alpha", other.Address, testTx(21, "1"))
		var refused *NodeRefusal
		if !errors.As(err, &refused) {
			t.Fatalf("signed under a key whose address didn't match the request: %v", err)
		}
	})

	t.Run("nodes refuse requests the coordinator didn't sign", func(t *testing.T) {
		req := signReq{Session: "forged-1", KeyID: "ws-alpha", Committee: []string{"node1", "node2"},
			ExpectedAddress: key.Address, Tx: *testTx(30, "1"), TS: time.Now().Unix()}
		body, _ := json.Marshal(req)

		if code, _ := h.rawPost(0, "/v1/sign", body, ""); code != http.StatusUnauthorized {
			t.Fatalf("unsigned request: %d", code)
		}
		_, attacker, _ := ed25519.GenerateKey(rand.Reader)
		if code, _ := h.rawPost(0, "/v1/sign", body, SignBody(attacker, body)); code != http.StatusUnauthorized {
			t.Fatalf("request signed by the wrong key: %d", code)
		}
		good := SignBody(h.coordPk, body)
		if code, _ := h.rawPost(0, "/v1/sign", append(body[:len(body)-1:len(body)-1], ' ', '}'), good); code != http.StatusUnauthorized {
			t.Fatalf("request altered after signing: %d", code)
		}

		stale := req
		stale.Session, stale.TS = "stale-1", time.Now().Add(-time.Hour).Unix()
		sb, _ := json.Marshal(stale)
		if code, _ := h.rawPost(0, "/v1/sign", sb, SignBody(h.coordPk, sb)); code != http.StatusUnauthorized {
			t.Fatalf("stale request: %d", code)
		}
	})

	t.Run("a session id can't be replayed", func(t *testing.T) {
		req := signReq{Session: "replay-1", KeyID: "ws-alpha", Committee: []string{"node1", "node2"},
			ExpectedAddress: key.Address, Tx: *testTx(40, "1"), TS: time.Now().Unix()}
		body, _ := json.Marshal(req)
		sig := SignBody(h.coordPk, body)
		if code, _ := h.rawPost(0, "/v1/sign", body, sig); code != http.StatusAccepted {
			t.Fatalf("first use: %d", code)
		}
		if code, _ := h.rawPost(0, "/v1/sign", body, sig); code != http.StatusConflict {
			t.Fatalf("replay: %d", code)
		}
	})

	t.Run("nodes refuse forged peer messages", func(t *testing.T) {
		msg := PeerMessage{Session: "s", From: "node2", To: "node1", FromParty: "node2", ToParty: "node1", Seq: 1, Type: "x", Nonce: make([]byte, 12), Payload: []byte("not really encrypted")}
		body, _ := json.Marshal(msg)
		if code, _ := h.rawPost(0, "/v1/msg", body, ""); code != http.StatusUnauthorized {
			t.Fatalf("forged peer message: %d", code)
		}
	})

	t.Run("a node enforces its own value cap regardless of the coordinator", func(t *testing.T) {
		cap := big.NewInt(1_000_000_000_000_000) // 0.001 ETH
		for _, n := range h.nodes {
			n.SetMaxValue(cap)
		}
		defer func() {
			for _, n := range h.nodes {
				n.SetMaxValue(nil)
			}
		}()
		_, err := h.coord.Sign(ctx, key.KeyID, key.Address, testTx(50, "5000000000000000000"))
		var refused *NodeRefusal
		if !errors.As(err, &refused) || refused.Status != http.StatusForbidden {
			t.Fatalf("want a refusal from a node over its cap, got %v", err)
		}
		verifyOnChainRules(t, h.mustSign(51, key), key.Address) // 0.001 ETH: allowed
	})

	t.Run("each node's own policy file is enforced and can't be argued with", func(t *testing.T) {
		defer h.setPolicy("{}")
		refusedBy := func(err error, rule string) {
			t.Helper()
			var refused *NodeRefusal
			if !errors.As(err, &refused) || refused.Status != http.StatusForbidden {
				t.Fatalf("want a 403 refusal (%s), got %v", rule, err)
			}
		}
		to := "0x49ddddb2987a27e2de4ba26bd57e646caf8c548c"

		h.setPolicy(`{"blockedDestinations":["` + to + `"]}`)
		_, err := h.coord.Sign(ctx, key.KeyID, key.Address, testTx(70, "1"))
		refusedBy(err, "blocklist")

		h.setPolicy(`{"allowedDestinations":["0x000000000000000000000000000000000000dEaD"]}`)
		_, err = h.coord.Sign(ctx, key.KeyID, key.Address, testTx(71, "1"))
		refusedBy(err, "allowlist")

		h.setPolicy(`{"allowedChainIds":[1]}`)
		_, err = h.coord.Sign(ctx, key.KeyID, key.Address, testTx(72, "1"))
		refusedBy(err, "chain")

		h.setPolicy(`{"maxFeeWei":"1000"}`)
		_, err = h.coord.Sign(ctx, key.KeyID, key.Address, testTx(73, "1"))
		refusedBy(err, "fee")

		callTx := testTx(74, "0")
		callTx.Data, callTx.GasLimit = "0xa9059cbb"+strings.Repeat("00", 12)+"49ddddb2987a27e2de4ba26bd57e646caf8c548c"+strings.Repeat("00", 32), 60000
		callTx.To = "0x000000000000000000000000000000000000dEaD"
		h.setPolicy(`{"allowCalldata":false}`)
		_, err = h.coord.Sign(ctx, key.KeyID, key.Address, callTx)
		refusedBy(err, "plain transfers only")
		h.setPolicy(`{"blockedDestinations":["` + to + `"]}`)
		_, err = h.coord.Sign(ctx, key.KeyID, key.Address, callTx) // blocked recipient hidden inside a token transfer
		refusedBy(err, "token recipient")

		// Rolling daily limit: room for one more 0.002 ETH on top of whatever each
		// node has already agreed to for this key today, but not two.
		used := new(big.Int)
		for _, n := range h.nodes {
			if u, _ := n.Policy().Used(key.KeyID); u.Cmp(used) > 0 {
				used = u
			}
		}
		limit := new(big.Int).Add(used, big.NewInt(3_000_000_000_000_000))
		h.setPolicy(`{"dailyLimitWei":"` + limit.String() + `"}`)
		big2 := func(n uint64) *ethtx.SignRequest { return testTx(n, "2000000000000000") }
		if _, err := h.coord.Sign(ctx, key.KeyID, key.Address, big2(75)); err != nil {
			t.Fatalf("first 0.002 ETH: %v", err)
		}
		_, err = h.coord.Sign(ctx, key.KeyID, key.Address, big2(76))
		refusedBy(err, "daily limit")

		// A broken edit must not switch the limits off.
		h.setPolicy(`{"dailyLimitWei": nonsense`)
		_, err = h.coord.Sign(ctx, key.KeyID, key.Address, big2(77))
		refusedBy(err, "invalid edit keeps previous rules")

		// Once the operator lifts it, signing resumes.
		h.setPolicy("{}")
		verifyOnChainRules(t, h.mustSign(78, key), key.Address)

		// The node says what it enforces, so the console can show it.
		st := h.coord.Health(ctx)
		if st[0].Policy == nil || st[0].Policy.Digest == "" {
			t.Fatal("health should report the node's policy digest")
		}
	})

	t.Run("shares survive a restart", func(t *testing.T) {
		for i := range h.nodes {
			h.startNode(i) // a brand-new Node over the same directory: no memory carried over
		}
		verifyOnChainRules(t, h.mustSign(60, key), key.Address)
	})

	t.Run("every node kept a tamper-evident record of what it signed", func(t *testing.T) {
		total := 0
		for i, c := range h.cfgs {
			n, err := VerifyAuditChain(filepath.Join(c.DataDir, "audit.log"))
			if err != nil {
				t.Fatalf("node %d: %v", i+1, err)
			}
			total += n
			raw, _ := os.ReadFile(filepath.Join(c.DataDir, "audit.log"))
			if !bytes.Contains(raw, []byte("sign_requested")) || !bytes.Contains(raw, []byte("keygen_completed")) {
				t.Fatalf("node %d's log is missing events", i+1)
			}
			if !bytes.Contains(raw, []byte("0x49dd")) && !bytes.Contains(raw, []byte("0x49Dd")) {
				t.Fatalf("node %d didn't record where funds were going", i+1)
			}
		}
		t.Logf("%d audit entries across 3 nodes, all chains intact", total)
	})
}

// Regression: a node completes the moment it receives its peer's last message,
// which can be before its own last message has reached that peer. Delivery
// must survive that — the first cluster-test hangs were this.
func TestOutgoingMessagesAreStillDeliveredAfterTheSessionCompletes(t *testing.T) {
	var attempts atomic.Int32
	delivered := make(chan struct{})
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if attempts.Add(1) <= 3 { // the peer had just come back: first tries fail
			http.Error(w, "warming up", http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusAccepted)
		close(delivered)
	}))
	defer peer.Close()

	n := &Node{cfg: NodeConfig{HTTP: &http.Client{Timeout: 2 * time.Second}}}
	s := &session{id: "s1", started: time.Now(), status: "done"} // already finished
	go n.post(s, NodeInfo{ID: "peer", URL: peer.URL}, &PeerMessage{Session: "s1", From: "me", To: "peer", Seq: 1})

	select {
	case <-delivered:
		if got := attempts.Load(); got < 4 {
			t.Fatalf("delivered after only %d attempts", got)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("a finished session gave up on a message its peer still needs (%d attempts)", attempts.Load())
	}
}

func TestAFailedSessionStopsSending(t *testing.T) {
	var attempts atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		http.Error(w, "down", http.StatusBadGateway)
	}))
	defer peer.Close()
	n := &Node{cfg: NodeConfig{HTTP: &http.Client{Timeout: 2 * time.Second}}}
	s := &session{id: "s2", started: time.Now(), status: "failed"}
	n.post(s, NodeInfo{ID: "peer", URL: peer.URL}, &PeerMessage{Session: "s2", From: "me", To: "peer", Seq: 1})
	if attempts.Load() != 0 {
		t.Fatalf("a failed session still sent %d messages", attempts.Load())
	}
}
