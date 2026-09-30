package mpc

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"forge-crypto/mpc-signer/internal/ethtx"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/google/uuid"
)

// ErrQuorumUnavailable means too few signing nodes are reachable to reach the
// threshold. It is a normal, expected condition — the point of a threshold key
// is that some nodes can be down — and callers should report it as such.
type ErrQuorumUnavailable struct{ Reachable, Needed, Total int }

func (e *ErrQuorumUnavailable) Error() string {
	return fmt.Sprintf("only %d of %d signing nodes are reachable; %d are needed to sign", e.Reachable, e.Total, e.Needed)
}

// NodeRefusal is a node saying no on purpose: it rejected the request over
// policy, an address mismatch, or authentication. Unlike a crash, it is not
// something to route around — trying a different committee until one agrees
// would defeat the point of nodes judging requests independently.
type NodeRefusal struct {
	Node   string
	Status int
	Msg    string
}

func (e *NodeRefusal) Error() string {
	return fmt.Sprintf("node %s refused (HTTP %d): %s", e.Node, e.Status, e.Msg)
}

// nodeFailure is a node being unreachable or failing mid-ceremony. The
// coordinator retries these with a committee that leaves the node out.
type nodeFailure struct {
	Node string
	Err  error
}

func (e *nodeFailure) Error() string { return fmt.Sprintf("node %s failed: %v", e.Node, e.Err) }
func (e *nodeFailure) Unwrap() error { return e.Err }

// Coordinator starts ceremonies and collects results. It never holds a key
// share and never sees a protocol message: it tells nodes what to do (with a
// signature they check) and reads back public results.
type Coordinator struct {
	cluster *Cluster
	priv    ed25519.PrivateKey
	http    *http.Client
}

func NewCoordinator(c *Cluster, priv ed25519.PrivateKey) (*Coordinator, error) {
	want, _ := hex.DecodeString(c.CoordinatorPub)
	if !bytes.Equal(priv.Public().(ed25519.PublicKey), want) {
		return nil, errors.New("coordinator key does not match coordinator_pub in the cluster file")
	}
	return &Coordinator{cluster: c, priv: priv, http: &http.Client{Timeout: 15 * time.Second}}, nil
}

func (c *Coordinator) Cluster() *Cluster { return c.cluster }

// NodeStatus is one node's reachability, for health reporting.
type NodeStatus struct {
	ID        string `json:"id"`
	Domain    string `json:"domain"`
	Reachable bool   `json:"reachable"`
	PreParams int    `json:"preparams"`
}

func (c *Coordinator) Health(ctx context.Context) []NodeStatus {
	out := make([]NodeStatus, len(c.cluster.Nodes))
	var wg sync.WaitGroup
	for i, n := range c.cluster.Nodes {
		wg.Add(1)
		go func(i int, n NodeInfo) {
			defer wg.Done()
			out[i] = NodeStatus{ID: n.ID, Domain: n.Domain}
			cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			var h struct {
				OK        bool `json:"ok"`
				PreParams int  `json:"preparams"`
			}
			if err := c.get(cctx, n, "/v1/health", &h); err == nil && h.OK {
				out[i].Reachable, out[i].PreParams = true, h.PreParams
			}
		}(i, n)
	}
	wg.Wait()
	return out
}

func (c *Coordinator) get(ctx context.Context, n NodeInfo, path string, into any) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(n.URL, "/")+path, nil)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(into)
}

func (c *Coordinator) post(ctx context.Context, n NodeInfo, path string, body any) error {
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(n.URL, "/")+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Coordinator-Signature", SignBody(c.priv, raw))
	resp, err := c.http.Do(req)
	if err != nil {
		return &nodeFailure{Node: n.ID, Err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		var parsed struct{ Error string }
		text := strings.TrimSpace(string(msg))
		if json.Unmarshal(msg, &parsed) == nil && parsed.Error != "" {
			text = parsed.Error
		}
		if resp.StatusCode >= 500 {
			return &nodeFailure{Node: n.ID, Err: fmt.Errorf("HTTP %d %s", resp.StatusCode, text)}
		}
		return &NodeRefusal{Node: n.ID, Status: resp.StatusCode, Msg: text}
	}
	return nil
}

type sessionResult struct {
	Status     string          `json:"status"`
	Error      string          `json:"error"`
	Result     json.RawMessage `json:"result"`
	WaitingFor []string        `json:"waitingFor"`
	Round      string          `json:"round"`
}

// await polls the given nodes until all report done, any reports failure, or
// the deadline passes.
func (c *Coordinator) await(ctx context.Context, nodes []NodeInfo, session string) (map[string]json.RawMessage, error) {
	results := map[string]json.RawMessage{}
	pending := map[string]string{} // last thing each unfinished node reported
	for {
		for _, n := range nodes {
			if _, done := results[n.ID]; done {
				continue
			}
			var sr sessionResult
			if err := c.get(ctx, n, "/v1/sessions/"+session, &sr); err != nil {
				if ctx.Err() != nil {
					return nil, fmt.Errorf("timed out waiting for %s: %w", n.ID, ctx.Err())
				}
				continue // transient; the deadline bounds this
			}
			if sr.Status == "running" {
				pending[n.ID] = fmt.Sprintf("%s waiting on [%s] in %s", n.ID, strings.Join(sr.WaitingFor, ","), sr.Round)
			}
			switch sr.Status {
			case "failed":
				return nil, &nodeFailure{Node: n.ID, Err: errors.New(sr.Error)}
			case "done":
				results[n.ID] = sr.Result
			}
		}
		if len(results) == len(nodes) {
			return results, nil
		}
		select {
		case <-ctx.Done():
			var waiting []string
			for _, n := range nodes {
				if _, done := results[n.ID]; !done {
					waiting = append(waiting, n.ID)
				}
			}
			var detail []string
			for _, id := range waiting {
				if d, ok := pending[id]; ok {
					detail = append(detail, d)
				}
			}
			return nil, fmt.Errorf("timed out waiting for %s (%s): %w", strings.Join(waiting, ", "), strings.Join(detail, "; "), ctx.Err())
		case <-time.After(400 * time.Millisecond):
		}
	}
}

// KeyInfo describes a generated key. It is all public.
type KeyInfo struct {
	KeyID     string   `json:"keyId"`
	Address   string   `json:"address"`
	PublicKey string   `json:"publicKey"`
	Threshold int      `json:"threshold"`
	Nodes     []string `json:"nodes"`
}

// Keygen runs a distributed key generation across every node in the cluster.
// The private key is never assembled anywhere: each node ends with its own
// share, and the only thing returned here is the public key.
func (c *Coordinator) Keygen(ctx context.Context, keyID string) (*KeyInfo, error) {
	if !ValidID(keyID) {
		return nil, errors.New("invalid key id")
	}
	ctx, cancel := context.WithTimeout(ctx, sessionTimeout)
	defer cancel()

	session := uuid.NewString()
	ids := make([]string, len(c.cluster.Nodes))
	for i, n := range c.cluster.Nodes {
		ids[i] = n.ID
	}
	req := keygenReq{Session: session, KeyID: keyID, Threshold: c.cluster.Threshold, Participants: ids, TS: time.Now().Unix()}
	for _, n := range c.cluster.Nodes {
		if err := c.post(ctx, n, "/v1/keygen", req); err != nil {
			return nil, fmt.Errorf("starting key generation: %w", err)
		}
	}
	results, err := c.await(ctx, c.cluster.Nodes, session)
	if err != nil {
		return nil, err
	}
	var info *KeyInfo
	for id, raw := range results {
		var r struct{ Address, PublicKey string }
		if err := json.Unmarshal(raw, &r); err != nil {
			return nil, err
		}
		if info == nil {
			info = &KeyInfo{KeyID: keyID, Address: r.Address, PublicKey: r.PublicKey, Threshold: c.cluster.Threshold, Nodes: ids}
		} else if info.PublicKey != r.PublicKey {
			return nil, fmt.Errorf("nodes disagree on the public key (%s differs)", id)
		}
	}
	return info, nil
}

// SignedTx is the outcome of a threshold signing.
type SignedTx struct {
	RawTx     string
	Signature string
	Hash      string
	From      string
	Committee []string
}

// Sign has a committee of threshold+1 nodes sign the transaction. It picks the
// committee from the nodes that are reachable now, and if one drops out
// mid-ceremony it tries again without that node.
func (c *Coordinator) Sign(ctx context.Context, keyID, expectedAddress string, tx *ethtx.SignRequest) (*SignedTx, error) {
	need := c.cluster.Threshold + 1
	excluded := map[string]bool{}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		var live []NodeInfo
		reachable := 0
		for _, st := range c.Health(ctx) {
			if st.Reachable {
				reachable++
			}
			if st.Reachable && !excluded[st.ID] {
				n, _ := c.cluster.Node(st.ID)
				live = append(live, n)
			}
		}
		if len(live) < need {
			if lastErr != nil {
				return nil, fmt.Errorf("%w (after: %v)", &ErrQuorumUnavailable{reachable, need, len(c.cluster.Nodes)}, lastErr)
			}
			return nil, &ErrQuorumUnavailable{reachable, need, len(c.cluster.Nodes)}
		}
		committee := live[:need]
		out, err := c.signWith(ctx, committee, keyID, expectedAddress, tx)
		if err == nil {
			return out, nil
		}
		lastErr = err
		var failed *nodeFailure
		if !errors.As(err, &failed) {
			return nil, err // a refusal, or a problem no other committee would fix
		}
		excluded[failed.Node] = true
	}
	return nil, lastErr
}

func (c *Coordinator) signWith(ctx context.Context, committee []NodeInfo, keyID, expectedAddress string, tx *ethtx.SignRequest) (*SignedTx, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	session := uuid.NewString()
	ids := make([]string, len(committee))
	for i, n := range committee {
		ids[i] = n.ID
	}
	req := signReq{Session: session, KeyID: keyID, Committee: ids, ExpectedAddress: expectedAddress, Tx: *tx, TS: time.Now().Unix()}
	for _, n := range committee {
		if err := c.post(ctx, n, "/v1/sign", req); err != nil {
			return nil, err
		}
	}
	results, err := c.await(ctx, committee, session)
	if err != nil {
		return nil, err
	}

	var sig string
	for id, raw := range results {
		var r struct{ Signature string }
		if err := json.Unmarshal(raw, &r); err != nil {
			return nil, err
		}
		if sig == "" {
			sig = r.Signature
		} else if sig != r.Signature {
			return nil, fmt.Errorf("committee nodes produced different signatures (%s differs)", id)
		}
	}
	sigBytes, err := hex.DecodeString(sig)
	if err != nil || len(sigBytes) != 65 {
		return nil, errors.New("malformed signature from committee")
	}

	// Attach the signature and check the network would accept it as the key's.
	unsigned, signer, err := ethtx.Build(tx)
	if err != nil {
		return nil, err
	}
	signed, err := unsigned.WithSignature(signer, sigBytes)
	if err != nil {
		return nil, fmt.Errorf("attaching signature: %w", err)
	}
	from, err := types.Sender(signer, signed)
	if err != nil || !strings.EqualFold(from.Hex(), expectedAddress) {
		return nil, fmt.Errorf("signature recovers to %s, not the key's address %s", from.Hex(), expectedAddress)
	}
	raw, err := signed.MarshalBinary()
	if err != nil {
		return nil, err
	}
	return &SignedTx{RawTx: hexutil.Encode(raw), Signature: "0x" + sig, Hash: signed.Hash().Hex(), From: from.Hex(), Committee: ids}, nil
}
