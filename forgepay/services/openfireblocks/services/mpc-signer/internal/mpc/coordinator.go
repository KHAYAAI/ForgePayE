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
	"sort"
	"strings"
	"sync"
	"time"

	"forge-crypto/mpc-signer/internal/ethtx"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	eth "github.com/ethereum/go-ethereum/crypto"
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

// notFound is a reachable node that doesn't have what was asked for.
type notFound struct{}

func (*notFound) Error() string { return "not found" }

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
	clusters *ClusterSource
	priv     ed25519.PrivateKey
	http     *http.Client
	// beforeCommit is a test seam: an error here stands in for a commit that did not reach a node.
	beforeCommit func(NodeInfo) error
}

// NewCoordinator builds a coordinator over a fixed cluster, over plain HTTP.
func NewCoordinator(c *Cluster, priv ed25519.PrivateKey) (*Coordinator, error) {
	return NewCoordinatorWith(StaticCluster(c), priv, nil)
}

// NewCoordinatorWith builds a coordinator over a cluster source (which may
// reload its file) and, if tls is set, talks to nodes with mutual TLS.
func NewCoordinatorWith(src *ClusterSource, priv ed25519.PrivateKey, tls *TLSFiles) (*Coordinator, error) {
	c := src.Get()
	want, _ := hex.DecodeString(c.CoordinatorPub)
	if !bytes.Equal(priv.Public().(ed25519.PublicKey), want) {
		return nil, errors.New("coordinator key does not match coordinator_pub in the cluster file")
	}
	if Production() {
		if tls == nil {
			return nil, errors.New("MPC_ENV=production requires mutual TLS (MPC_TLS_* files)")
		}
		if err := c.CheckProduction(c.AllNodeIDs(), c.Threshold); err != nil {
			return nil, fmt.Errorf("MPC_ENV=production: %w", err)
		}
	}
	return &Coordinator{clusters: src, priv: priv, http: tls.HTTPClient(15 * time.Second)}, nil
}

func (c *Coordinator) cl() *Cluster { return c.clusters.Get() }

func (c *Coordinator) Cluster() *Cluster { return c.cl() }

// NodeStatus is one node's reachability, for health reporting.
type NodeStatus struct {
	ID        string `json:"id"`
	Domain    string `json:"domain"`
	Reachable bool   `json:"reachable"`
	PreParams int    `json:"preparams"`
	// SealProvider is where the node keeps its seal key ("file" is development only).
	SealProvider string         `json:"seal_provider,omitempty"`
	Policy       *PolicySummary `json:"policy,omitempty"`
	MTLS         bool           `json:"mtls"`
	// Backup is the node's own report of its key-share backups: whether they are on, how fresh, and
	// whether the newest one covers the shares now on disk.
	Backup *BackupStatus `json:"backup,omitempty"`
}

func (c *Coordinator) Health(ctx context.Context) []NodeStatus {
	out := make([]NodeStatus, len(c.cl().Nodes))
	var wg sync.WaitGroup
	for i, n := range c.cl().Nodes {
		wg.Add(1)
		go func(i int, n NodeInfo) {
			defer wg.Done()
			out[i] = NodeStatus{ID: n.ID, Domain: n.Domain}
			cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			var h struct {
				OK           bool           `json:"ok"`
				PreParams    int            `json:"preparams"`
				SealProvider string         `json:"sealProvider"`
				Policy       *PolicySummary `json:"policy"`
				MTLS         bool           `json:"mtls"`
				Backup       *BackupStatus  `json:"backup"`
			}
			if err := c.get(cctx, n, "/v1/health", &h); err == nil && h.OK {
				out[i].Reachable, out[i].PreParams = true, h.PreParams
				out[i].SealProvider, out[i].Policy, out[i].MTLS = h.SealProvider, h.Policy, h.MTLS
				out[i].Backup = h.Backup
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
	if resp.StatusCode == http.StatusNotFound {
		return &notFound{}
	}
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
	Epoch     int      `json:"epoch"`
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
	ids := make([]string, len(c.cl().Nodes))
	for i, n := range c.cl().Nodes {
		ids[i] = n.ID
	}
	req := keygenReq{Session: session, KeyID: keyID, Threshold: c.cl().Threshold, Participants: ids, TS: time.Now().Unix()}
	for _, n := range c.cl().Nodes {
		if err := c.post(ctx, n, "/v1/keygen", req); err != nil {
			return nil, fmt.Errorf("starting key generation: %w", err)
		}
	}
	results, err := c.await(ctx, c.cl().Nodes, session)
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
			info = &KeyInfo{KeyID: keyID, Address: r.Address, PublicKey: r.PublicKey, Threshold: c.cl().Threshold, Nodes: ids}
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

// KeyMeta is what the nodes collectively say about a key right now. Nodes are
// the source of truth: the coordinator keeps no key registry of its own, so it
// can't be out of step with them after a reshare.
type KeyMeta struct {
	KeyID        string         `json:"keyId"`
	Address      string         `json:"address"`
	PublicKey    string         `json:"publicKey"`
	Epoch        int            `json:"epoch"`
	Threshold    int            `json:"threshold"`
	Participants []string       `json:"participants"`
	Holders      []string       `json:"holders"`           // participants that reported this epoch
	Stale        []string       `json:"stale,omitempty"`   // nodes still holding an older epoch
	Pending      map[string]int `json:"pending,omitempty"` // nodes holding an uncommitted share, by epoch
}

type keyReport struct {
	Node         string   `json:"-"`
	KeyID        string   `json:"keyId"`
	Address      string   `json:"address"`
	PublicKey    string   `json:"publicKey"`
	Threshold    int      `json:"threshold"`
	Participants []string `json:"participants"`
	Epoch        int      `json:"epoch"`
	PendingEpoch int      `json:"pendingEpoch"`
	Held         []int    `json:"held"`
}

// holdsBelow reports whether the node still has an active share older than epoch.
func (r keyReport) holdsBelow(epoch int) bool {
	for _, e := range r.Held {
		if e < epoch {
			return true
		}
	}
	return r.Epoch < epoch
}

func (r keyReport) sameAs(o keyReport) bool {
	if r.Address != o.Address || r.PublicKey != o.PublicKey || r.Threshold != o.Threshold || len(r.Participants) != len(o.Participants) {
		return false
	}
	a, b := append([]string{}, r.Participants...), append([]string{}, o.Participants...)
	sortStrings(a)
	sortStrings(b)
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// KeyMeta asks every node what it holds for keyID and returns the newest epoch
// that enough holders agree on to sign with. One node claiming a newer epoch on
// its own is not believed.
func (c *Coordinator) KeyMeta(ctx context.Context, keyID string) (*KeyMeta, error) {
	if !ValidID(keyID) {
		return nil, errors.New("invalid key id")
	}
	nodes := c.cl().Nodes
	reports := make([]*keyReport, len(nodes))
	answered := make([]bool, len(nodes))
	var wg sync.WaitGroup
	for i, n := range nodes {
		wg.Add(1)
		go func(i int, n NodeInfo) {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()
			var r keyReport
			err := c.get(cctx, n, "/v1/keys/"+keyID, &r)
			var nf *notFound
			if err == nil {
				r.Node = n.ID
				reports[i], answered[i] = &r, true
			} else if errors.As(err, &nf) {
				answered[i] = true // reachable, holds nothing
			}
		}(i, n)
	}
	wg.Wait()

	reachable := 0
	for _, a := range answered {
		if a {
			reachable++
		}
	}
	need := c.cl().Threshold + 1
	var got []*keyReport
	for _, r := range reports {
		if r != nil {
			got = append(got, r)
		}
	}
	sort.Slice(got, func(i, j int) bool { return got[i].Epoch > got[j].Epoch })
	for _, lead := range got {
		var group []*keyReport
		for _, r := range got {
			if r.Epoch == lead.Epoch && r.sameAs(*lead) {
				group = append(group, r)
			}
		}
		if len(group) < lead.Threshold+1 {
			continue
		}
		m := &KeyMeta{KeyID: keyID, Address: lead.Address, PublicKey: lead.PublicKey, Epoch: lead.Epoch, Threshold: lead.Threshold, Participants: lead.Participants, Pending: map[string]int{}}
		for _, r := range group {
			m.Holders = append(m.Holders, r.Node)
		}
		sortStrings(m.Holders)
		for _, r := range got {
			if r.holdsBelow(lead.Epoch) {
				m.Stale = append(m.Stale, r.Node)
			}
			if r.PendingEpoch > 0 {
				m.Pending[r.Node] = r.PendingEpoch
			}
		}
		sortStrings(m.Stale)
		return m, nil
	}
	if len(got) == 0 {
		if reachable < need {
			return nil, &ErrQuorumUnavailable{reachable, need, len(nodes)}
		}
		return nil, &NodeRefusal{Node: "cluster", Status: http.StatusNotFound, Msg: "no such key on any node"}
	}
	// No epoch has enough agreeing holders. If the newest epoch's reports are all
	// consistent, the key is fine and simply too few of its holders answered —
	// a quorum problem, the ordinary "some nodes are down" case. Otherwise the
	// nodes really do disagree.
	lead := got[0]
	var agreeing int
	for _, r := range got {
		if r.Epoch == lead.Epoch && r.sameAs(*lead) {
			agreeing++
		}
	}
	disagreeing := false
	for _, r := range got {
		if r.Epoch == lead.Epoch && !r.sameAs(*lead) {
			disagreeing = true
		}
	}
	if !disagreeing {
		return nil, &ErrQuorumUnavailable{agreeing, lead.Threshold + 1, len(lead.Participants)}
	}
	return nil, fmt.Errorf("the nodes that answered don't agree on the state of key %s", keyID)
}

// Sign has a committee of threshold+1 of the key's holders sign the
// transaction. It picks the committee from the holders that are reachable now,
// and if one drops out mid-ceremony it tries again without that node.
func (c *Coordinator) Sign(ctx context.Context, keyID, expectedAddress string, tx *ethtx.SignRequest) (*SignedTx, error) {
	excluded := map[string]bool{}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		meta, err := c.KeyMeta(ctx, keyID)
		if err != nil {
			return nil, err
		}
		need := meta.Threshold + 1
		var live []NodeInfo
		reachable := 0
		for _, st := range c.Health(ctx) {
			if !contains(meta.Holders, st.ID) {
				continue
			}
			if st.Reachable {
				reachable++
			}
			if st.Reachable && !excluded[st.ID] {
				n, _ := c.cl().Node(st.ID)
				live = append(live, n)
			}
		}
		if len(live) < need {
			if lastErr != nil {
				return nil, fmt.Errorf("%w (after: %v)", &ErrQuorumUnavailable{reachable, need, len(meta.Participants)}, lastErr)
			}
			return nil, &ErrQuorumUnavailable{reachable, need, len(meta.Participants)}
		}
		committee := live[:need]
		out, err := c.signWith(ctx, committee, keyID, meta.Epoch, expectedAddress, tx)
		if err == nil {
			return out, nil
		}
		lastErr = err
		var refused *NodeRefusal
		if errors.As(err, &refused) && refused.Status == http.StatusConflict && strings.Contains(refused.Msg, "epoch") {
			continue // the key moved while we were choosing; look again
		}
		var failed *nodeFailure
		if !errors.As(err, &failed) {
			return nil, err // a refusal, or a problem no other committee would fix
		}
		excluded[failed.Node] = true
	}
	return nil, lastErr
}

func (c *Coordinator) signWith(ctx context.Context, committee []NodeInfo, keyID string, epoch int, expectedAddress string, tx *ethtx.SignRequest) (*SignedTx, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	session := uuid.NewString()
	ids := make([]string, len(committee))
	for i, n := range committee {
		ids[i] = n.ID
	}
	req := signReq{Session: session, KeyID: keyID, Epoch: epoch, Committee: ids, ExpectedAddress: expectedAddress, Tx: *tx, TS: time.Now().Unix()}
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

// ---- resharing ---------------------------------------------------------------

// ReshareResult describes a completed reshare.
type ReshareResult struct {
	KeyID      string   `json:"keyId"`
	Address    string   `json:"address"`
	FromEpoch  int      `json:"fromEpoch"`
	ToEpoch    int      `json:"toEpoch"`
	OldNodes   []string `json:"oldNodes"`
	NewNodes   []string `json:"newNodes"`
	Threshold  int      `json:"threshold"`
	Retired    []string `json:"retired"`              // nodes whose old share was destroyed
	NotRetired []string `json:"notRetired,omitempty"` // nodes that still hold an old share (were unreachable)
}

// Reshare moves a key to the committee `newNodes` at `newThreshold` without
// changing its public key or address. The steps are ordered so that a failure
// at any point leaves the key signable with the committee it had before:
//
//  1. the old committee (threshold+1 holders) and the new committee run the
//     resharing protocol; each new member stores its share as *pending*;
//  2. every new share is checked to reproduce the original public key;
//  3. the new committee signs a throwaway digest, proving the shares work;
//  4. only then are the pending shares committed, and
//  5. the old shares destroyed.
//
// Failing at steps 1–3 discards the pending shares; nothing has changed.
func (c *Coordinator) Reshare(ctx context.Context, keyID string, newNodes []string, newThreshold int, progress func(string)) (*ReshareResult, error) {
	if progress == nil {
		progress = func(string) {}
	}
	cluster := c.cl()
	seen := map[string]bool{}
	for _, id := range newNodes {
		if _, ok := cluster.Node(id); !ok {
			return nil, fmt.Errorf("unknown node %q", id)
		}
		if seen[id] {
			return nil, fmt.Errorf("node %q listed twice", id)
		}
		seen[id] = true
	}
	if newThreshold < 1 || newThreshold >= len(newNodes) {
		return nil, fmt.Errorf("a threshold of %d needs at least %d nodes (got %d)", newThreshold, newThreshold+1, len(newNodes))
	}
	if Production() {
		if err := cluster.CheckProduction(newNodes, newThreshold); err != nil {
			return nil, err
		}
	}

	// An earlier reshare may have died half way through committing. Finish it first (after proving the
	// shares sign), otherwise the nodes that did commit and the ones that did not disagree forever.
	if resumed, err := c.ResumeCommit(ctx, keyID, progress); err != nil {
		return nil, fmt.Errorf("an earlier reshare was left half committed and could not be finished: %w", err)
	} else if resumed {
		progress("finished the commit an earlier reshare left half done")
	}

	meta, err := c.KeyMeta(ctx, keyID)
	if err != nil {
		return nil, err
	}
	progress(fmt.Sprintf("key %s is at epoch %d, %d-of-%d across %s", keyID, meta.Epoch, meta.Threshold+1, len(meta.Participants), strings.Join(meta.Participants, ",")))

	// Clear a leftover from an earlier attempt that didn't finish.
	next := meta.Epoch + 1
	for node, ep := range meta.Pending {
		if ep == next {
			if n, ok := cluster.Node(node); ok {
				_ = c.lifecycle(ctx, n, "abort", keyID, next, false)
			}
		}
	}

	health := c.Health(ctx)
	status := map[string]NodeStatus{}
	for _, st := range health {
		status[st.ID] = st
	}
	for _, id := range newNodes {
		if !status[id].Reachable {
			return nil, fmt.Errorf("new committee member %s is not reachable; every new member must be online to receive its share", id)
		}
	}
	for _, id := range newNodes {
		if status[id].PreParams < 1 {
			return nil, fmt.Errorf("node %s is still generating the parameters it needs for a new share; try again shortly", id)
		}
	}
	var oldLive []string
	for _, id := range meta.Holders {
		if status[id].Reachable {
			oldLive = append(oldLive, id)
		}
	}
	if len(oldLive) < meta.Threshold+1 {
		return nil, &ErrQuorumUnavailable{len(oldLive), meta.Threshold + 1, len(meta.Participants)}
	}
	// Prefer old members that stay, so fewer nodes are involved.
	sort.SliceStable(oldLive, func(i, j int) bool { return contains(newNodes, oldLive[i]) && !contains(newNodes, oldLive[j]) })
	oldCommittee := append([]string{}, oldLive[:meta.Threshold+1]...)

	involved := append([]string{}, oldCommittee...)
	for _, id := range newNodes {
		if !contains(involved, id) {
			involved = append(involved, id)
		}
	}
	infos := func(ids []string) []NodeInfo {
		var out []NodeInfo
		for _, id := range ids {
			n, _ := cluster.Node(id)
			out = append(out, n)
		}
		return out
	}
	abortAll := func() {
		actx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		for _, n := range infos(newNodes) {
			_ = c.lifecycle(actx, n, "abort", keyID, next, false)
		}
	}

	rctx, cancel := context.WithTimeout(ctx, sessionTimeout)
	defer cancel()
	session := uuid.NewString()
	req := reshareReq{
		Session: session, KeyID: keyID, Epoch: meta.Epoch, PublicKey: meta.PublicKey,
		OldCommittee: oldCommittee, OldThreshold: meta.Threshold, NewCommittee: newNodes, NewThreshold: newThreshold, TS: time.Now().Unix(),
	}
	progress(fmt.Sprintf("resharing: old committee %s -> new committee %s (threshold %d)", strings.Join(oldCommittee, ","), strings.Join(newNodes, ","), newThreshold+1))
	for _, n := range infos(involved) {
		if err := c.post(rctx, n, "/v1/reshare", req); err != nil {
			abortAll()
			return nil, fmt.Errorf("starting reshare: %w", err)
		}
	}
	results, err := c.await(rctx, infos(involved), session)
	if err != nil {
		abortAll()
		return nil, fmt.Errorf("resharing: %w", err)
	}
	for _, id := range newNodes {
		var r struct {
			Role, PublicKey string
			Epoch           int
		}
		if json.Unmarshal(results[id], &r) != nil || r.Role != "new" || r.Epoch != next || !strings.EqualFold(r.PublicKey, meta.PublicKey) {
			abortAll()
			return nil, fmt.Errorf("node %s did not produce a share for the same public key; nothing was changed", id)
		}
	}

	// Prove the new shares sign before any of them becomes the real one.
	progress("probing: the new committee signs a test digest")
	probeSet := infos(newNodes[:newThreshold+1])
	nonce := strings.ReplaceAll(uuid.NewString(), "-", "")
	pctx, pcancel := context.WithTimeout(ctx, 120*time.Second)
	defer pcancel()
	probeSession := uuid.NewString()
	preq := probeReq{Session: probeSession, KeyID: keyID, Epoch: next, Committee: newNodes[:newThreshold+1], Nonce: nonce, TS: time.Now().Unix()}
	for _, n := range probeSet {
		if err := c.post(pctx, n, "/v1/probe", preq); err != nil {
			abortAll()
			return nil, fmt.Errorf("probing the new shares: %w", err)
		}
	}
	presults, err := c.await(pctx, probeSet, probeSession)
	if err != nil {
		abortAll()
		return nil, fmt.Errorf("probing the new shares: %w", err)
	}
	if err := verifyProbe(presults, keyID, next, nonce, meta.PublicKey); err != nil {
		abortAll()
		return nil, err
	}

	progress("committing the new shares")
	cctx, ccancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer ccancel()
	for _, n := range infos(newNodes) {
		if err := retry(3, func() error {
			if c.beforeCommit != nil {
				if err := c.beforeCommit(n); err != nil {
					return err
				}
			}
			return c.lifecycle(cctx, n, "commit", keyID, next, false)
		}); err != nil {
			return nil, fmt.Errorf("committing on %s failed (%v); the old shares are untouched. Run the reshare again to finish", n.ID, err)
		}
	}

	res := &ReshareResult{KeyID: keyID, Address: meta.Address, FromEpoch: meta.Epoch, ToEpoch: next, OldNodes: meta.Participants, NewNodes: newNodes, Threshold: newThreshold}
	progress("destroying the old shares")
	retired, notRetired := c.retireStale(cctx, keyID, next, newNodes)
	res.Retired, res.NotRetired = retired, notRetired
	return res, nil
}

func (c *Coordinator) collectReports(ctx context.Context, keyID string) []*keyReport {
	nodes := c.cl().Nodes
	reports := make([]*keyReport, len(nodes))
	var wg sync.WaitGroup
	for i, n := range nodes {
		wg.Add(1)
		go func(i int, n NodeInfo) {
			defer wg.Done()
			cctx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()
			var r keyReport
			if err := c.get(cctx, n, "/v1/keys/"+keyID, &r); err == nil {
				r.Node = n.ID
				reports[i] = &r
			}
		}(i, n)
	}
	wg.Wait()
	var out []*keyReport
	for _, r := range reports {
		if r != nil {
			out = append(out, r)
		}
	}
	return out
}

// ResumeCommit finishes a reshare whose commit step was interrupted: some members of the new committee
// hold the new epoch as their active share while others still hold it as a pending share. It only acts
// when (a) at least one node already committed that epoch, which proves the probe passed before the
// commit started, and (b) a fresh probe signed by a threshold of the combined holders verifies against the
// key. Then it commits the remaining pending shares. It returns whether it changed anything.
func (c *Coordinator) ResumeCommit(ctx context.Context, keyID string, progress func(string)) (bool, error) {
	reports := c.collectReports(ctx, keyID)
	var top *keyReport
	for _, r := range reports {
		if top == nil || r.Epoch > top.Epoch {
			top = r
		}
	}
	if top == nil {
		return false, nil
	}
	var committed, pending []*keyReport
	for _, r := range reports {
		switch {
		case r.Epoch == top.Epoch && r.sameAs(*top):
			committed = append(committed, r)
		case r.PendingEpoch == top.Epoch && r.Epoch < top.Epoch && contains(top.Participants, r.Node):
			pending = append(pending, r)
		}
	}
	if len(pending) == 0 || len(committed) == 0 {
		return false, nil
	}
	need := top.Threshold + 1
	if len(committed)+len(pending) < need {
		return false, nil // not enough shares at that epoch to sign with; leave it for the operator
	}
	if len(pending) > need {
		return false, fmt.Errorf("%d pending shares is more than one probe can verify; resolve by hand", len(pending))
	}
	var committee []string
	for _, r := range pending {
		committee = append(committee, r.Node)
	}
	for _, r := range committed {
		if len(committee) < need {
			committee = append(committee, r.Node)
		}
	}
	progress(fmt.Sprintf("epoch %d is committed on %d node(s) and pending on %d; probing before finishing the commit", top.Epoch, len(committed), len(pending)))
	nonce := strings.ReplaceAll(uuid.NewString(), "-", "")
	pctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	session := uuid.NewString()
	preq := probeReq{Session: session, KeyID: keyID, Epoch: top.Epoch, Committee: committee, Nonce: nonce, TS: time.Now().Unix()}
	var set []NodeInfo
	for _, id := range committee {
		n, ok := c.cl().Node(id)
		if !ok {
			return false, fmt.Errorf("node %s is not in the cluster file", id)
		}
		set = append(set, n)
		if err := c.post(pctx, n, "/v1/probe", preq); err != nil {
			return false, fmt.Errorf("probe: %w", err)
		}
	}
	results, err := c.await(pctx, set, session)
	if err != nil {
		return false, fmt.Errorf("probe: %w", err)
	}
	if err := verifyProbe(results, keyID, top.Epoch, nonce, top.PublicKey); err != nil {
		return false, err
	}
	cctx, ccancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer ccancel()
	for _, r := range pending {
		n, _ := c.cl().Node(r.Node)
		if err := retry(3, func() error { return c.lifecycle(cctx, n, "commit", keyID, top.Epoch, false) }); err != nil {
			return false, fmt.Errorf("committing on %s: %w", r.Node, err)
		}
	}
	return true, nil
}

func verifyProbe(results map[string]json.RawMessage, keyID string, epoch int, nonce, pubHex string) error {
	var sig string
	for id, raw := range results {
		var r struct{ Signature string }
		if json.Unmarshal(raw, &r) != nil || r.Signature == "" {
			return fmt.Errorf("node %s returned no probe signature", id)
		}
		if sig == "" {
			sig = r.Signature
		} else if sig != r.Signature {
			return errors.New("the new committee produced different probe signatures; nothing was changed")
		}
	}
	b, err := hex.DecodeString(sig)
	if err != nil || len(b) != 65 {
		return errors.New("malformed probe signature")
	}
	pub, err := eth.SigToPub(probeDigest(keyID, epoch, nonce), b)
	if err != nil || hex.EncodeToString(eth.FromECDSAPub(pub)) != strings.ToLower(pubHex) {
		return errors.New("the new shares' probe signature does not verify against the key; nothing was changed")
	}
	return nil
}

func retry(n int, f func() error) error {
	var err error
	for i := 0; i < n; i++ {
		if err = f(); err == nil {
			return nil
		}
		time.Sleep(time.Duration(i+1) * 300 * time.Millisecond)
	}
	return err
}

func (c *Coordinator) lifecycle(ctx context.Context, n NodeInfo, op, keyID string, epoch int, leaving bool) error {
	return c.lifecycleWith(ctx, n, op, keyID, epoch, leaving, nil)
}

func (c *Coordinator) lifecycleWith(ctx context.Context, n NodeInfo, op, keyID string, epoch int, leaving bool, staying []string) error {
	return c.post(ctx, n, "/v1/reshare/"+op, lifecycleReq{Session: uuid.NewString(), KeyID: keyID, Epoch: epoch, Leaving: leaving, Staying: staying, TS: time.Now().Unix()})
}

// retireStale destroys every share older than `epoch`, on every node that
// holds one. Nodes in `staying` keep their newer share; the rest are leaving.
func (c *Coordinator) retireStale(ctx context.Context, keyID string, epoch int, staying []string) (retired, notRetired []string) {
	for _, n := range c.cl().Nodes {
		var r keyReport
		err := c.get(ctx, n, "/v1/keys/"+keyID, &r)
		var nf *notFound
		if errors.As(err, &nf) {
			continue // holds nothing
		}
		if err != nil {
			notRetired = append(notRetired, n.ID) // unreachable: can't tell, assume it may hold an old share
			continue
		}
		if !r.holdsBelow(epoch) {
			continue // nothing older than the current epoch to destroy
		}
		if err := retry(3, func() error {
			return c.lifecycleWith(ctx, n, "retire", keyID, epoch, !contains(staying, n.ID), staying)
		}); err != nil {
			notRetired = append(notRetired, n.ID)
			continue
		}
		retired = append(retired, n.ID)
	}
	return retired, notRetired
}

// RetireStale destroys leftover shares of an earlier epoch — for nodes that
// were offline when a reshare finished. It only acts on a key whose current
// epoch a quorum agrees on.
func (c *Coordinator) RetireStale(ctx context.Context, keyID string) (retired, notRetired []string, err error) {
	meta, err := c.KeyMeta(ctx, keyID)
	if err != nil {
		return nil, nil, err
	}
	retired, notRetired = c.retireStale(ctx, keyID, meta.Epoch, meta.Participants)
	return retired, notRetired, nil
}
