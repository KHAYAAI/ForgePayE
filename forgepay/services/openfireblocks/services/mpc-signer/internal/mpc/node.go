package mpc

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"forge-crypto/mpc-signer/internal/ethtx"
	"github.com/bnb-chain/tss-lib/v2/common"
	"github.com/bnb-chain/tss-lib/v2/ecdsa/keygen"
	"github.com/bnb-chain/tss-lib/v2/ecdsa/resharing"
	"github.com/bnb-chain/tss-lib/v2/ecdsa/signing"
	"github.com/bnb-chain/tss-lib/v2/tss"
	eth "github.com/ethereum/go-ethereum/crypto"
)

const (
	sessionTTL     = 10 * time.Minute
	sessionTimeout = 5 * time.Minute // longest a ceremony may run
	requestSkew    = 2 * time.Minute
	maxMailbox     = 512
)

// NodeConfig is everything a node needs to run.
type NodeConfig struct {
	DataDir         string
	ID              string
	Cluster         *Cluster       // fixed cluster description, or
	Clusters        *ClusterSource // a file that is re-read when it changes (takes precedence)
	SealKey         []byte
	SealProvider    string   // where SealKey came from: file, env, vault, awskms
	MaxValueWei     *big.Int // optional per-transaction cap this node enforces on its own
	PolicyFile      string   // optional node policy (see NodePolicy); reloaded when edited
	PreParamsTarget int
	TLS             *TLSFiles // mutual TLS with the coordinator and peers; required in production
	HTTP            *http.Client
}

// Node is one member of the signing group. It holds exactly one key share per
// key, sealed on its own disk, and takes part in ceremonies started by the
// coordinator. It talks to its peers directly; the coordinator never sees
// protocol messages.
type Node struct {
	cfg      NodeConfig
	clusters *ClusterSource
	priv     *ecdh.PrivateKey
	coordPub ed25519.PublicKey
	pool     *preParamsPool
	audit    *auditLog
	policy   *Policy
	backups  *backupService

	mu       sync.Mutex
	sessions map[string]*session
	mailbox  map[string][]bufferedMsg
	keyMu    sync.Mutex // serialises changes to key files
}

func (n *Node) cluster() *Cluster { return n.clusters.Get() }

type bufferedMsg struct {
	from      string // sending node
	fromParty string // sending party (a moniker: "node1", or "node1@old" in a reshare)
	toParty   string
	seq       uint64
	bcast     bool
	wire      []byte
	at        time.Time
}

// session is one ceremony as seen by this node. A node normally runs one party
// in it; in a reshare a node that is in both the old and the new committee runs
// two, one per role.
type session struct {
	id      string
	kind    string // keygen | sign | probe | reshare
	keyID   string
	all     map[string]*tss.PartyID // every party in the session, by moniker
	order   []string                // their monikers, sorted
	started time.Time
	seq     atomic.Uint64
	finish  chan struct{} // closed once the session has ended
	once    sync.Once

	mu      sync.Mutex
	local   map[string]tss.Party // the parties this node runs
	ready   bool
	pending []bufferedMsg
	seen    map[string]bool
	status  string // running | done | failed
	err     string
	result  json.RawMessage
}

func NewNode(cfg NodeConfig) (*Node, error) {
	if cfg.HTTP == nil {
		cfg.HTTP = cfg.TLS.HTTPClient(20 * time.Second)
	}
	if cfg.PreParamsTarget == 0 {
		cfg.PreParamsTarget = 1
	}
	clusters := cfg.Clusters
	if clusters == nil {
		if cfg.Cluster == nil {
			return nil, errors.New("node needs a cluster description")
		}
		clusters = StaticCluster(cfg.Cluster)
	}
	cluster := clusters.Get()
	me, ok := cluster.Node(cfg.ID)
	if !ok {
		return nil, fmt.Errorf("node %q is not in the cluster file", cfg.ID)
	}
	if Production() {
		if cfg.TLS == nil {
			return nil, errors.New("MPC_ENV=production requires mutual TLS (MPC_TLS_* files)")
		}
		if err := cluster.CheckProduction(cluster.AllNodeIDs(), cluster.Threshold); err != nil {
			return nil, fmt.Errorf("MPC_ENV=production: %w", err)
		}
	}
	priv, pub, err := LoadIdentity(cfg.DataDir, cfg.ID, cfg.SealKey)
	if err != nil {
		return nil, err
	}
	if hex.EncodeToString(pub) != me.X25519Pub {
		return nil, fmt.Errorf("this node's identity key does not match the cluster file entry for %q", cfg.ID)
	}
	coord, _ := hex.DecodeString(cluster.CoordinatorPub)
	pool, err := newPreParamsPool(cfg.DataDir, cfg.SealKey, cfg.PreParamsTarget)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "keys"), 0o700); err != nil {
		return nil, err
	}
	audit, err := newAuditLog(filepath.Join(cfg.DataDir, "audit.log"))
	if err != nil {
		return nil, err
	}
	policy, err := OpenPolicy(cfg.PolicyFile, filepath.Join(cfg.DataDir, "policy-ledger.jsonl"))
	if err != nil {
		return nil, err
	}
	policy.SetLegacyMaxValue(cfg.MaxValueWei)
	// A node with no rules of its own co-signs anything the coordinator asks, so production refuses it:
	// the whole point of a node policy is that a compromised gateway still cannot drain a workspace.
	if Production() && len(policy.Summary().Active) == 0 {
		return nil, errors.New("MPC_ENV=production requires a node policy (MPC_NODE_POLICY_FILE) with at least one rule, e.g. maxValueWei and dailyLimitWei")
	}
	n := &Node{
		cfg: cfg, clusters: clusters, priv: priv, coordPub: ed25519.PublicKey(coord), pool: pool, audit: audit, policy: policy,
		sessions: map[string]*session{}, mailbox: map[string][]bufferedMsg{},
	}
	pool.Refill()
	go n.janitor()
	return n, nil
}

// SetMaxValue changes this node's own per-transaction cap (nil removes it).
func (n *Node) SetMaxValue(wei *big.Int) { n.policy.SetLegacyMaxValue(wei) }

// MaxValue is the node's current cap, or nil.
func (n *Node) MaxValue() *big.Int { return n.policy.LegacyMaxValue() }

// Policy returns the node's policy engine.
func (n *Node) Policy() *Policy { return n.policy }

// ---- HTTP surface ---------------------------------------------------------

func (n *Node) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", n.handleHealth)
	mux.HandleFunc("POST /v1/keygen", n.handleKeygen)
	mux.HandleFunc("POST /v1/sign", n.handleSign)
	mux.HandleFunc("POST /v1/probe", n.handleProbe)
	mux.HandleFunc("POST /v1/reshare", n.handleReshare)
	mux.HandleFunc("POST /v1/reshare/commit", n.handleLifecycle("commit"))
	mux.HandleFunc("POST /v1/reshare/retire", n.handleLifecycle("retire"))
	mux.HandleFunc("POST /v1/reshare/abort", n.handleLifecycle("abort"))
	mux.HandleFunc("POST /v1/msg", n.handleMsg)
	mux.HandleFunc("GET /v1/sessions/{id}", n.handleSession)
	mux.HandleFunc("GET /v1/keys", n.handleKeyList)
	mux.HandleFunc("GET /v1/keys/{id}", n.handleKeyInfo)
	if n.cfg.TLS == nil {
		return mux
	}
	// With mutual TLS the caller's certificate name is its identity. Only the
	// coordinator may start or change anything; peers may only send messages,
	// and only as themselves (checked in handleMsg).
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := peerName(r)
		if name == "" {
			fail(w, http.StatusUnauthorized, "a client certificate is required")
			return
		}
		coordinatorOnly := r.Method == http.MethodPost && r.URL.Path != "/v1/msg"
		if coordinatorOnly && name != coordinatorCertName {
			n.audit.Record("rejected", "", "", map[string]any{"reason": "certificate is not the coordinator's", "name": name, "path": r.URL.Path})
			fail(w, http.StatusForbidden, "only the coordinator may call this")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (n *Node) handleHealth(w http.ResponseWriter, _ *http.Request) {
	me, _ := n.cluster().Node(n.cfg.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "id": n.cfg.ID, "domain": me.Domain, "preparams": n.pool.Available(),
		"sealProvider": n.cfg.SealProvider, "policy": n.policy.Summary(), "mtls": n.cfg.TLS != nil,
		"backup":    n.BackupStatus(),
		"placement": DescribePlacement(n.cfg.ID, n.cfg.SealProvider, me.Domain, os.Getenv, os.ReadFile),
	})
}

// authenticated reads a request body and checks the coordinator signed it,
// recently, and that its session id is new.
func (n *Node) authenticated(w http.ResponseWriter, r *http.Request, into any, ts func() int64, sessionID func() string) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		fail(w, http.StatusBadRequest, "unreadable body")
		return false
	}
	if !VerifyBody(n.coordPub, body, r.Header.Get("X-Coordinator-Signature")) {
		n.audit.Record("rejected", "", "", map[string]any{"reason": "bad coordinator signature", "path": r.URL.Path})
		fail(w, http.StatusUnauthorized, "not signed by the coordinator")
		return false
	}
	if err := json.Unmarshal(body, into); err != nil {
		fail(w, http.StatusBadRequest, "malformed request")
		return false
	}
	if d := time.Since(time.Unix(ts(), 0)); d > requestSkew || d < -requestSkew {
		fail(w, http.StatusUnauthorized, "request is outside the allowed time window")
		return false
	}
	if !ValidID(sessionID()) {
		fail(w, http.StatusBadRequest, "invalid session id")
		return false
	}
	return true
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

type keygenReq struct {
	Session      string   `json:"session"`
	KeyID        string   `json:"keyId"`
	Threshold    int      `json:"threshold"`
	Participants []string `json:"participants"`
	TS           int64    `json:"ts"`
}

func (n *Node) handleKeygen(w http.ResponseWriter, r *http.Request) {
	var req keygenReq
	if !n.authenticated(w, r, &req, func() int64 { return req.TS }, func() string { return req.Session }) {
		return
	}
	if !ValidID(req.KeyID) {
		fail(w, http.StatusBadRequest, "invalid key id")
		return
	}
	cluster := n.cluster()
	if req.Threshold != cluster.Threshold || len(req.Participants) != len(cluster.Nodes) {
		fail(w, http.StatusBadRequest, "keygen must use the whole cluster at its configured threshold")
		return
	}
	for _, id := range req.Participants {
		if _, ok := cluster.Node(id); !ok {
			fail(w, http.StatusBadRequest, "unknown participant "+id)
			return
		}
	}
	if Production() {
		if err := cluster.CheckProduction(req.Participants, req.Threshold); err != nil {
			fail(w, http.StatusForbidden, err.Error())
			return
		}
	}
	if len(n.keyFiles(req.KeyID)) > 0 {
		fail(w, http.StatusConflict, "a key with that id already exists on this node")
		return
	}
	ids := SortedParties(req.Participants)
	self := findParty(ids, n.cfg.ID)
	if self == nil {
		fail(w, http.StatusBadRequest, "this node is not a participant")
		return
	}
	s, err := n.newSession(req.Session, "keygen", req.KeyID, ids)
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	n.audit.Record("keygen_started", s.id, req.KeyID, map[string]any{"threshold": req.Threshold, "participants": req.Participants})
	go n.runKeygen(s, self, ids, req.Threshold, req.Participants)
	writeJSON(w, http.StatusAccepted, map[string]string{"session": s.id})
}

type signReq struct {
	Session         string            `json:"session"`
	KeyID           string            `json:"keyId"`
	Epoch           int               `json:"epoch"`
	Committee       []string          `json:"committee"`
	ExpectedAddress string            `json:"expectedAddress"`
	Tx              ethtx.SignRequest `json:"tx"`
	TS              int64             `json:"ts"`
}

// checkCommittee verifies a signing committee against the key it will sign with.
func checkCommittee(k *storedKey, committee []string) string {
	if len(committee) != k.Threshold+1 {
		return fmt.Sprintf("a signing committee is exactly %d nodes", k.Threshold+1)
	}
	seen := map[string]bool{}
	for _, id := range committee {
		if seen[id] {
			return "committee lists " + id + " twice"
		}
		seen[id] = true
		if !contains(k.Participants, id) {
			return "committee member " + id + " does not hold this key"
		}
	}
	return ""
}

func (n *Node) handleSign(w http.ResponseWriter, r *http.Request) {
	var req signReq
	if !n.authenticated(w, r, &req, func() int64 { return req.TS }, func() string { return req.Session }) {
		return
	}
	stored, err := n.loadKey(req.KeyID)
	if err != nil {
		fail(w, http.StatusNotFound, "no such key on this node")
		return
	}
	if stored.Epoch != req.Epoch {
		fail(w, http.StatusConflict, fmt.Sprintf("this node's share of the key is at epoch %d, not %d", stored.Epoch, req.Epoch))
		return
	}
	if !strings.EqualFold(stored.Address, req.ExpectedAddress) {
		n.audit.Record("rejected", req.Session, req.KeyID, map[string]any{"reason": "address mismatch", "asked": req.ExpectedAddress})
		fail(w, http.StatusConflict, "this key's address is not the one the request expects")
		return
	}
	if msg := checkCommittee(stored, req.Committee); msg != "" {
		fail(w, http.StatusBadRequest, msg)
		return
	}

	// Rebuild the transaction here and hash it ourselves, so this node signs
	// what it can read rather than a digest handed to it.
	tx, signer, err := ethtx.Build(&req.Tx)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid transaction: "+err.Error())
		return
	}
	hash := signer.Hash(tx)

	ids := SortedPartiesAt(req.Committee, stored.Epoch, "")
	self := findParty(ids, n.cfg.ID)
	if self == nil {
		fail(w, http.StatusBadRequest, "this node is not in the committee")
		return
	}
	// This node's own rules, applied to the transaction it rebuilt itself.
	if err := n.policy.Reserve(req.Session, req.KeyID, req.Tx.ChainID, tx); err != nil {
		var refusal *PolicyRefusal
		if errors.As(err, &refusal) {
			n.audit.Record("rejected", req.Session, req.KeyID, map[string]any{"reason": "policy", "rule": refusal.Rule, "detail": refusal.Msg, "to": tx.To().Hex(), "valueWei": tx.Value().String()})
			if refusal.Rule == "duplicate_session" {
				fail(w, http.StatusConflict, refusal.Msg) // a replay, not a policy decision about the transaction
				return
			}
			fail(w, http.StatusForbidden, refusal.Msg)
			return
		}
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	s, err := n.newSession(req.Session, "sign", req.KeyID, ids)
	if err != nil {
		n.policy.Release(req.Session)
		fail(w, http.StatusConflict, err.Error())
		return
	}
	n.audit.Record("sign_requested", s.id, req.KeyID, map[string]any{
		"to": tx.To().Hex(), "valueWei": tx.Value().String(), "chainId": req.Tx.ChainID,
		"nonce": tx.Nonce(), "hash": hash.Hex(), "committee": req.Committee, "epoch": stored.Epoch,
	})
	go func() {
		n.runSign(s, stored, hash.Bytes(), ids, self, func() {
			n.audit.Record("sign_completed", s.id, s.keyID, map[string]any{"hash": "0x" + hex.EncodeToString(hash.Bytes())})
		})
		// A ceremony that didn't produce a signature must not use up the limits.
		s.mu.Lock()
		failed := s.status != "done"
		s.mu.Unlock()
		if failed {
			n.policy.Release(s.id)
		}
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"session": s.id})
}

// probeDigest is what a rotation probe signs. It is domain-separated and never
// a transaction hash, so a probe can't be turned into a spendable signature.
func probeDigest(keyID string, epoch int, nonce string) []byte {
	return eth.Keccak256([]byte(fmt.Sprintf("forge-mpc-probe|%s|%d|%s", keyID, epoch, nonce)))
}

type probeReq struct {
	Session   string   `json:"session"`
	KeyID     string   `json:"keyId"`
	Epoch     int      `json:"epoch"`
	Committee []string `json:"committee"`
	Nonce     string   `json:"nonce"`
	TS        int64    `json:"ts"`
}

// handleProbe signs a throwaway digest with a specific epoch of a key —
// including a pending one — to prove a reshare produced working shares before
// anything is committed.
func (n *Node) handleProbe(w http.ResponseWriter, r *http.Request) {
	var req probeReq
	if !n.authenticated(w, r, &req, func() int64 { return req.TS }, func() string { return req.Session }) {
		return
	}
	if !ValidID(req.Nonce) {
		fail(w, http.StatusBadRequest, "invalid nonce")
		return
	}
	stored, err := n.loadEpochAny(req.KeyID, req.Epoch)
	if err != nil {
		fail(w, http.StatusNotFound, "no share of that key epoch on this node")
		return
	}
	if msg := checkCommittee(stored, req.Committee); msg != "" {
		fail(w, http.StatusBadRequest, msg)
		return
	}
	ids := SortedPartiesAt(req.Committee, stored.Epoch, "")
	self := findParty(ids, n.cfg.ID)
	if self == nil {
		fail(w, http.StatusBadRequest, "this node is not in the committee")
		return
	}
	s, err := n.newSession(req.Session, "probe", req.KeyID, ids)
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	digest := probeDigest(req.KeyID, req.Epoch, req.Nonce)
	n.audit.Record("probe_requested", s.id, req.KeyID, map[string]any{"epoch": req.Epoch, "committee": req.Committee})
	go n.runSign(s, stored, digest, ids, self, func() {
		n.audit.Record("probe_completed", s.id, s.keyID, map[string]any{"epoch": req.Epoch})
	})
	writeJSON(w, http.StatusAccepted, map[string]string{"session": s.id})
}

type reshareReq struct {
	Session      string   `json:"session"`
	KeyID        string   `json:"keyId"`
	Epoch        int      `json:"epoch"`     // the key's current epoch
	PublicKey    string   `json:"publicKey"` // hex uncompressed; every new share must reproduce it
	OldCommittee []string `json:"oldCommittee"`
	OldThreshold int      `json:"oldThreshold"`
	NewCommittee []string `json:"newCommittee"`
	NewThreshold int      `json:"newThreshold"`
	TS           int64    `json:"ts"`
}

// handleReshare starts this node's part in moving a key to a new committee
// and/or threshold without changing its public key or address. A node takes the
// "old" role if it is in OldCommittee (it holds a current share and contributes
// it) and the "new" role if it is in NewCommittee (it receives a fresh share,
// stored as *pending* until the coordinator commits it).
func (n *Node) handleReshare(w http.ResponseWriter, r *http.Request) {
	var req reshareReq
	if !n.authenticated(w, r, &req, func() int64 { return req.TS }, func() string { return req.Session }) {
		return
	}
	cluster := n.cluster()
	if !ValidID(req.KeyID) || req.Epoch < 0 {
		fail(w, http.StatusBadRequest, "invalid key")
		return
	}
	if req.NewThreshold < 1 || len(req.NewCommittee) <= req.NewThreshold || req.OldThreshold < 1 || len(req.OldCommittee) != req.OldThreshold+1 {
		fail(w, http.StatusBadRequest, "committee sizes don't match their thresholds")
		return
	}
	for _, list := range [][]string{req.OldCommittee, req.NewCommittee} {
		seen := map[string]bool{}
		for _, id := range list {
			if _, ok := cluster.Node(id); !ok || seen[id] {
				fail(w, http.StatusBadRequest, "unknown or repeated node "+id)
				return
			}
			seen[id] = true
		}
	}
	if Production() {
		if err := cluster.CheckProduction(req.NewCommittee, req.NewThreshold); err != nil {
			fail(w, http.StatusForbidden, err.Error())
			return
		}
	}
	inOld, inNew := contains(req.OldCommittee, n.cfg.ID), contains(req.NewCommittee, n.cfg.ID)
	if !inOld && !inNew {
		fail(w, http.StatusBadRequest, "this node takes no part in this reshare")
		return
	}
	var oldKey *storedKey
	if inOld {
		k, err := n.loadKey(req.KeyID)
		if err != nil {
			fail(w, http.StatusNotFound, "no such key on this node")
			return
		}
		if k.Epoch != req.Epoch || k.Threshold != req.OldThreshold || !strings.EqualFold(k.PublicKey, req.PublicKey) {
			fail(w, http.StatusConflict, fmt.Sprintf("this node's share is at epoch %d with threshold %d; the request disagrees", k.Epoch, k.Threshold))
			return
		}
		for _, id := range req.OldCommittee {
			if !contains(k.Participants, id) {
				fail(w, http.StatusBadRequest, "old committee member "+id+" does not hold this key")
				return
			}
		}
		oldKey = k
	}
	newEpoch := req.Epoch + 1
	if inNew {
		if exists(n.keyFilePath(req.KeyID, newEpoch, false)) || exists(n.keyFilePath(req.KeyID, newEpoch, true)) {
			fail(w, http.StatusConflict, "this node already holds a share for the next epoch")
			return
		}
	}

	oldIDs := SortedPartiesAt(req.OldCommittee, req.Epoch, "old")
	newIDs := SortedPartiesAt(req.NewCommittee, newEpoch, "new")
	var selfOld, selfNew *tss.PartyID
	if inOld {
		selfOld = findParty(oldIDs, n.cfg.ID+"@old")
	}
	if inNew {
		selfNew = findParty(newIDs, n.cfg.ID+"@new")
	}
	all := append(append(tss.SortedPartyIDs{}, oldIDs...), newIDs...)
	s, err := n.newSession(req.Session, "reshare", req.KeyID, all)
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	n.audit.Record("reshare_started", s.id, req.KeyID, map[string]any{
		"epoch": req.Epoch, "oldCommittee": req.OldCommittee, "oldThreshold": req.OldThreshold,
		"newCommittee": req.NewCommittee, "newThreshold": req.NewThreshold,
	})
	go n.runReshare(s, req, oldKey, oldIDs, newIDs, selfOld, selfNew)
	writeJSON(w, http.StatusAccepted, map[string]string{"session": s.id})
}

type lifecycleReq struct {
	Session string `json:"session"`
	KeyID   string `json:"keyId"`
	Epoch   int    `json:"epoch"`
	// Leaving (retire only): this node is not in the key's new committee, so
	// every share it holds below Epoch is to be destroyed, with nothing to keep.
	Leaving bool `json:"leaving"`
	// Staying (retire, leaving): the new committee. A node that did not take part in the reshare (it was
	// offline) checks with these peers, itself, that they hold the new epoch before it destroys anything.
	Staying []string `json:"staying,omitempty"`
	TS      int64    `json:"ts"`
}

// handleLifecycle finishes or cancels a reshare on this node. All three
// operations are idempotent, so the coordinator can repeat them after a failure.
//
//	commit  pending share for Epoch becomes the active share
//	retire  shares below Epoch are destroyed (the old committee's, after commit)
//	abort   the pending share for Epoch is destroyed (the reshare didn't complete)
func (n *Node) handleLifecycle(op string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req lifecycleReq
		if !n.authenticated(w, r, &req, func() int64 { return req.TS }, func() string { return req.Session }) {
			return
		}
		if !ValidID(req.KeyID) || req.Epoch < 1 {
			fail(w, http.StatusBadRequest, "invalid key or epoch")
			return
		}
		n.keyMu.Lock()
		defer n.keyMu.Unlock()
		switch op {
		case "commit":
			pending, active := n.keyFilePath(req.KeyID, req.Epoch, true), n.keyFilePath(req.KeyID, req.Epoch, false)
			switch {
			case exists(pending):
				if err := os.Link(pending, active); err != nil && !os.IsExist(err) {
					fail(w, http.StatusInternalServerError, "could not activate the new share: "+err.Error())
					return
				}
				_ = os.Remove(pending)
			case exists(active):
				// already committed
			default:
				fail(w, http.StatusNotFound, "no pending share for that epoch")
				return
			}
			n.audit.Record("reshare_committed", req.Session, req.KeyID, map[string]any{"epoch": req.Epoch})
			n.backupSoon()
			writeJSON(w, http.StatusOK, map[string]any{"epoch": req.Epoch})
		case "retire":
			if !req.Leaving && !exists(n.keyFilePath(req.KeyID, req.Epoch, false)) {
				fail(w, http.StatusConflict, "this node holds no active share at or above that epoch, so it won't destroy its only one")
				return
			}
			// A node that is leaving holds no newer share, so the check above cannot protect it. It destroys
			// its share only if it actually took part, as an old member, in the reshare that produced this
			// epoch. A signed request alone (a compromised coordinator, a replay) is not enough.
			if req.Leaving && !n.contributedTo(req.KeyID, req.Epoch) && !exists(n.keyFilePath(req.KeyID, req.Epoch, false)) &&
				!n.peersHoldNewEpoch(r.Context(), req.KeyID, req.Epoch, req.Staying) {
				n.audit.Record("rejected", req.Session, req.KeyID, map[string]any{"reason": "retire as leaving without having contributed to that reshare", "epoch": req.Epoch})
				fail(w, http.StatusConflict, "this node did not take part in a reshare to that epoch, so it will not destroy its share")
				return
			}
			var removed []int
			for _, f := range n.keyFiles(req.KeyID) {
				if !f.pending && f.epoch < req.Epoch {
					shred(f.path)
					removed = append(removed, f.epoch)
				}
			}
			n.audit.Record("shares_retired", req.Session, req.KeyID, map[string]any{"below": req.Epoch, "removed": removed, "leaving": req.Leaving})
			n.backupSoon() // so superseded shares drop out of the backups too
			writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
		case "abort":
			p := n.keyFilePath(req.KeyID, req.Epoch, true)
			had := exists(p)
			if had {
				shred(p)
			}
			n.audit.Record("reshare_aborted", req.Session, req.KeyID, map[string]any{"epoch": req.Epoch, "hadPending": had})
			writeJSON(w, http.StatusOK, map[string]any{"aborted": had})
		}
	}
}

func (n *Node) handleMsg(w http.ResponseWriter, r *http.Request) {
	var m PeerMessage
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&m); err != nil {
		fail(w, http.StatusBadRequest, "malformed message")
		return
	}
	peer, ok := n.cluster().Node(m.From)
	if !ok || m.To != n.cfg.ID || !ValidID(m.Session) || nodeOf(m.FromParty) != m.From || nodeOf(m.ToParty) != m.To {
		fail(w, http.StatusBadRequest, "bad message routing")
		return
	}
	// With mutual TLS, the connection itself must be the sender's.
	if n.cfg.TLS != nil && peerName(r) != m.From {
		n.audit.Record("rejected", m.Session, "", map[string]any{"reason": "certificate does not match the sender", "from": m.From, "cert": peerName(r)})
		fail(w, http.StatusForbidden, "certificate does not match the sending node")
		return
	}
	pubBytes, _ := hex.DecodeString(peer.X25519Pub)
	pub, err := ecdh.X25519().NewPublicKey(pubBytes)
	if err != nil {
		fail(w, http.StatusBadRequest, "bad peer key")
		return
	}
	// Authenticate before buffering anything.
	wire, err := DecryptMessage(n.priv, pub, &m)
	if err != nil {
		n.audit.Record("rejected", m.Session, "", map[string]any{"reason": "peer message failed authentication", "from": m.From})
		fail(w, http.StatusUnauthorized, err.Error())
		return
	}
	msg := bufferedMsg{from: m.From, fromParty: m.FromParty, toParty: m.ToParty, seq: m.Seq, bcast: m.Broadcast, wire: wire, at: time.Now()}

	n.mu.Lock()
	s := n.sessions[m.Session]
	if s == nil {
		if len(n.mailbox[m.Session]) < maxMailbox {
			n.mailbox[m.Session] = append(n.mailbox[m.Session], msg)
		}
		n.mu.Unlock()
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "buffered"})
		return
	}
	n.mu.Unlock()
	s.receive(msg)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "delivered"})
}

func (n *Node) handleSession(w http.ResponseWriter, r *http.Request) {
	n.mu.Lock()
	s := n.sessions[r.PathValue("id")]
	n.mu.Unlock()
	if s == nil {
		fail(w, http.StatusNotFound, "no such session")
		return
	}
	s.mu.Lock()
	status, errText, result := s.status, s.err, s.result
	parties := make(map[string]tss.Party, len(s.local))
	for k, v := range s.local {
		parties[k] = v
	}
	s.mu.Unlock()
	out := map[string]any{"status": status, "error": errText, "result": result}
	if status == "running" {
		// Who this node is still waiting to hear from — what "stuck" means.
		var waiting, rounds []string
		for _, p := range parties {
			for _, w := range p.WaitingFor() {
				waiting = append(waiting, w.Moniker)
			}
			rounds = append(rounds, partyRound(p))
		}
		sort.Strings(waiting)
		out["waitingFor"] = waiting
		out["round"] = strings.Join(rounds, " / ")
	}
	writeJSON(w, http.StatusOK, out)
}

// partyRound describes where a party is. tss-lib's String() dereferences the current round, which
// does not exist until the party has started, so a status poll in that window would panic.
func partyRound(p tss.Party) (round string) {
	defer func() {
		if recover() != nil {
			round = "starting"
		}
	}()
	return p.String()
}

func (n *Node) handleKeyInfo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	k, err := n.loadKey(id)
	if err != nil {
		fail(w, http.StatusNotFound, "no such key")
		return
	}
	pending := 0
	held := []int{}
	for _, f := range n.keyFiles(id) {
		if f.pending {
			if f.epoch > pending {
				pending = f.epoch
			}
		} else {
			held = append(held, f.epoch)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"keyId": k.KeyID, "address": k.Address, "publicKey": k.PublicKey,
		"threshold": k.Threshold, "participants": k.Participants, "createdAt": k.CreatedAt,
		// epoch is the newest active share; held lists every active share on disk,
		// so a leftover from before a reshare can be seen and destroyed.
		"epoch": k.Epoch, "pendingEpoch": pending, "held": held,
	})
}

func (n *Node) handleKeyList(w http.ResponseWriter, _ *http.Request) {
	entries, _ := os.ReadDir(filepath.Join(n.cfg.DataDir, "keys"))
	latest := map[string]int{}
	for _, e := range entries {
		if id, epoch, ok := parseKeyFile(e.Name()); ok && !strings.HasSuffix(e.Name(), ".pending") && epoch >= latest[id] {
			latest[id] = epoch
		}
	}
	type row struct {
		KeyID string `json:"keyId"`
		Epoch int    `json:"epoch"`
	}
	out := []row{}
	for id, e := range latest {
		out = append(out, row{id, e})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].KeyID < out[j].KeyID })
	writeJSON(w, http.StatusOK, map[string]any{"keys": out})
}

// ---- sessions -------------------------------------------------------------

func (n *Node) newSession(id, kind, keyID string, ids tss.SortedPartyIDs) (*session, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if _, dup := n.sessions[id]; dup {
		return nil, errors.New("session id already used")
	}
	s := &session{
		id: id, kind: kind, keyID: keyID, started: time.Now(), status: "running",
		all: map[string]*tss.PartyID{}, local: map[string]tss.Party{}, seen: map[string]bool{}, finish: make(chan struct{}),
	}
	for _, p := range ids {
		s.all[p.Moniker] = p
		s.order = append(s.order, p.Moniker)
	}
	sort.Strings(s.order)
	n.sessions[id] = s
	return s, nil
}

func (s *session) markFailed(reason string) {
	s.mu.Lock()
	if s.status == "running" {
		s.status, s.err = "failed", reason
	}
	s.mu.Unlock()
	s.once.Do(func() { close(s.finish) })
}

func (s *session) markDone(result any) {
	raw, _ := json.Marshal(result)
	s.mu.Lock()
	if s.status == "running" {
		s.status, s.result = "done", raw
	}
	s.mu.Unlock()
	s.once.Do(func() { close(s.finish) })
}

func (s *session) receive(m bufferedMsg) {
	s.mu.Lock()
	if !s.ready {
		s.pending = append(s.pending, m)
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	s.deliver(m)
}

func (s *session) deliver(m bufferedMsg) {
	key := fmt.Sprintf("%s|%d|%s", m.from, m.seq, m.toParty)
	s.mu.Lock()
	if s.seen[key] || s.status != "running" {
		s.mu.Unlock()
		return
	}
	s.seen[key] = true
	party := s.local[m.toParty]
	s.mu.Unlock()

	from := s.all[m.fromParty]
	if from == nil {
		s.markFailed("message from a party outside this session: " + m.fromParty)
		return
	}
	if party == nil {
		s.markFailed("message for a party this node doesn't run: " + m.toParty)
		return
	}
	if _, err := party.UpdateFromBytes(m.wire, from, m.bcast); err != nil {
		s.markFailed("protocol error: " + err.Error())
	}
}

// partySpec is one party this node runs in a session, with its outbound channel.
type partySpec struct {
	moniker string
	party   tss.Party
	out     <-chan tss.Message
}

// begin registers this node's parties, starts them, and hands them anything
// that arrived before they existed.
func (n *Node) begin(s *session, specs ...partySpec) {
	s.mu.Lock()
	for _, sp := range specs {
		s.local[sp.moniker] = sp.party
	}
	s.mu.Unlock()
	for _, sp := range specs {
		sp := sp
		go func() {
			for {
				select {
				case msg := <-sp.out:
					n.send(s, sp.moniker, msg)
				case <-s.finish:
					// Everything a party queued before it finished is already in
					// its channel; deliver it rather than dropping it.
					for {
						select {
						case msg := <-sp.out:
							n.send(s, sp.moniker, msg)
						default:
							return
						}
					}
				}
			}
		}()
		go func() {
			if err := sp.party.Start(); err != nil {
				s.markFailed("could not start: " + err.Error())
			}
		}()
	}

	// Anything that arrived before this session existed, or before the parties
	// were ready, is delivered now.
	n.mu.Lock()
	early := n.mailbox[s.id]
	delete(n.mailbox, s.id)
	n.mu.Unlock()
	s.mu.Lock()
	s.ready = true
	backlog := append(early, s.pending...)
	s.pending = nil
	s.mu.Unlock()
	for _, m := range backlog {
		s.deliver(m)
	}
}

func (n *Node) send(s *session, src string, msg tss.Message) {
	wire, routing, err := msg.WireBytes()
	if err != nil {
		s.markFailed("cannot encode message: " + err.Error())
		return
	}
	var targets []string
	if len(routing.To) > 0 {
		for _, id := range routing.To {
			if id.Moniker != src {
				targets = append(targets, id.Moniker)
			}
		}
	} else {
		for _, m := range s.order {
			if m != src {
				targets = append(targets, m)
			}
		}
	}
	for _, to := range targets {
		if s.all[to] == nil {
			s.markFailed("unknown party " + to)
			return
		}
		toNode := nodeOf(to)
		if toNode == n.cfg.ID {
			// Both roles on this node: no network hop.
			s.receive(bufferedMsg{from: n.cfg.ID, fromParty: src, toParty: to, seq: s.seq.Add(1), bcast: routing.IsBroadcast, wire: wire, at: time.Now()})
			continue
		}
		peer, ok := n.cluster().Node(toNode)
		if !ok {
			s.markFailed("unknown peer " + toNode)
			return
		}
		pm := &PeerMessage{Session: s.id, From: n.cfg.ID, To: toNode, FromParty: src, ToParty: to, Seq: s.seq.Add(1), Broadcast: routing.IsBroadcast, Type: msg.Type()}
		pubBytes, _ := hex.DecodeString(peer.X25519Pub)
		pub, err := ecdh.X25519().NewPublicKey(pubBytes)
		if err != nil || EncryptMessage(n.priv, pub, pm, wire) != nil {
			s.markFailed("cannot encrypt for " + toNode)
			return
		}
		go n.post(s, peer, pm)
	}
}

// post delivers a message to a peer, retrying transport failures until the
// session's deadline. Retrying is safe: the receiver drops repeats by sequence
// number.
//
// It must keep going after this node's own session is *done*. A node finishes
// the moment it has received its peer's last message — often before its own
// last message has reached that peer — so giving up on "done" would leave the
// peer waiting forever for a message lost to one transient error. Only this
// node's own failure ends delivery.
func (n *Node) post(s *session, peer NodeInfo, pm *PeerMessage) {
	body, _ := json.Marshal(pm)
	deadline := s.started.Add(sessionTimeout)
	backoff := 100 * time.Millisecond
	var lastErr error
	for time.Now().Before(deadline) {
		s.mu.Lock()
		failed := s.status == "failed"
		s.mu.Unlock()
		if failed {
			return
		}
		resp, err := n.cfg.HTTP.Post(strings.TrimRight(peer.URL, "/")+"/v1/msg", "application/json", bytes.NewReader(body))
		if err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode < 300 {
				return
			}
			if resp.StatusCode < 500 {
				s.markFailed(fmt.Sprintf("peer %s rejected a message (HTTP %d)", peer.ID, resp.StatusCode))
				return
			}
			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
		} else {
			lastErr = err
		}
		time.Sleep(backoff)
		if backoff < 2*time.Second {
			backoff *= 2
		}
	}
	s.markFailed(fmt.Sprintf("peer %s unreachable: %v", peer.ID, lastErr))
}

func (n *Node) janitor() {
	for range time.Tick(time.Minute) {
		cutoff := time.Now().Add(-sessionTTL)
		n.mu.Lock()
		for id, s := range n.sessions {
			if s.started.Before(cutoff) {
				delete(n.sessions, id)
			}
		}
		for id, msgs := range n.mailbox {
			if len(msgs) > 0 && msgs[0].at.Before(cutoff) {
				delete(n.mailbox, id)
			}
		}
		n.mu.Unlock()
	}
}

// ---- key storage ----------------------------------------------------------

type storedKey struct {
	KeyID string `json:"keyId"`
	// Epoch counts reshares: 0 as first generated, +1 each time the key moves
	// to a new committee or threshold. Threshold and Participants describe this
	// epoch's committee. The public key and address never change.
	Epoch        int                       `json:"epoch,omitempty"`
	Threshold    int                       `json:"threshold"`
	Participants []string                  `json:"participants"`
	Address      string                    `json:"address"`
	PublicKey    string                    `json:"publicKey"`
	CreatedAt    time.Time                 `json:"createdAt"`
	Save         keygen.LocalPartySaveData `json:"save"`
}

type keyFile struct {
	path    string
	epoch   int
	pending bool
}

// keyFilePath names a share file: <id>.sealed (epoch 0), <id>.e<N>.sealed, or
// <id>.e<N>.pending for a share a reshare produced but nobody committed yet.
func (n *Node) keyFilePath(keyID string, epoch int, pending bool) string {
	name := keyID
	if epoch > 0 {
		name = fmt.Sprintf("%s.e%d", keyID, epoch)
	}
	if pending {
		name += ".pending"
	} else {
		name += ".sealed"
	}
	return filepath.Join(n.cfg.DataDir, "keys", name)
}

// keyFiles lists every share file this node has for a key, active or pending.
func (n *Node) keyFiles(keyID string) []keyFile {
	entries, _ := os.ReadDir(filepath.Join(n.cfg.DataDir, "keys"))
	var out []keyFile
	for _, e := range entries {
		if id, epoch, ok := parseKeyFile(e.Name()); ok && id == keyID {
			out = append(out, keyFile{filepath.Join(n.cfg.DataDir, "keys", e.Name()), epoch, strings.HasSuffix(e.Name(), ".pending")})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].epoch < out[j].epoch })
	return out
}

func (n *Node) readKeyFile(path, keyID string, epoch int) (*storedKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	plain, err := Open(n.cfg.SealKey, raw, keyAAD(keyID, epoch))
	if err != nil {
		return nil, err
	}
	var k storedKey
	if err := json.Unmarshal(plain, &k); err != nil {
		return nil, err
	}
	if k.KeyID != keyID || k.Epoch != epoch {
		return nil, errors.New("key file does not describe the key it is named for")
	}
	return &k, nil
}

// loadKey returns this node's newest *active* share of a key.
func (n *Node) loadKey(keyID string) (*storedKey, error) {
	if !ValidID(keyID) {
		return nil, errors.New("invalid key id")
	}
	files := n.keyFiles(keyID)
	for i := len(files) - 1; i >= 0; i-- {
		if !files[i].pending {
			return n.readKeyFile(files[i].path, keyID, files[i].epoch)
		}
	}
	return nil, os.ErrNotExist
}

// loadEpochAny returns the share for one epoch, active or pending.
func (n *Node) loadEpochAny(keyID string, epoch int) (*storedKey, error) {
	if !ValidID(keyID) {
		return nil, errors.New("invalid key id")
	}
	for _, pending := range []bool{false, true} {
		if p := n.keyFilePath(keyID, epoch, pending); exists(p) {
			return n.readKeyFile(p, keyID, epoch)
		}
	}
	return nil, os.ErrNotExist
}

func (n *Node) saveKey(k *storedKey, pending bool) error {
	plain, err := json.Marshal(k)
	if err != nil {
		return err
	}
	sealed, err := Seal(n.cfg.SealKey, plain, keyAAD(k.KeyID, k.Epoch))
	if err != nil {
		return err
	}
	dest := n.keyFilePath(k.KeyID, k.Epoch, pending)
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, sealed, 0o600); err != nil {
		return err
	}
	// Link, not rename: a share file must never be overwritten.
	defer os.Remove(tmp)
	return os.Link(tmp, dest)
}

func publicKeyHex(save *keygen.LocalPartySaveData) (address, pub string) {
	pk := &ecdsa.PublicKey{Curve: eth.S256(), X: save.ECDSAPub.X(), Y: save.ECDSAPub.Y()}
	return eth.PubkeyToAddress(*pk).Hex(), hex.EncodeToString(eth.FromECDSAPub(pk))
}

// ---- ceremonies -----------------------------------------------------------

func (n *Node) runKeygen(s *session, self *tss.PartyID, ids tss.SortedPartyIDs, threshold int, participants []string) {
	ctx, cancel := context.WithTimeout(context.Background(), sessionTimeout)
	defer cancel()

	pre, err := n.pool.Take(ctx)
	if err != nil {
		s.markFailed(err.Error())
		return
	}
	params := tss.NewParameters(tss.S256(), tss.NewPeerContext(ids), self, len(ids), threshold)
	out := make(chan tss.Message, len(ids)*4)
	end := make(chan keygen.LocalPartySaveData, 1)
	party := keygen.NewLocalParty(params, out, end, *pre)
	n.begin(s, partySpec{self.Moniker, party, out})

	select {
	case save := <-end:
		address, pub := publicKeyHex(&save)
		k := &storedKey{
			KeyID: s.keyID, Threshold: threshold, Participants: participants, CreatedAt: time.Now().UTC(),
			Address: address, PublicKey: pub, Save: save,
		}
		n.keyMu.Lock()
		err := n.saveKey(k, false)
		n.keyMu.Unlock()
		if err != nil {
			s.markFailed("could not store key share: " + err.Error())
			return
		}
		n.audit.Record("keygen_completed", s.id, s.keyID, map[string]any{"address": k.Address})
		n.backupSoon()
		s.markDone(map[string]any{"address": k.Address, "publicKey": k.PublicKey})
	case <-ctx.Done():
		s.markFailed("key generation timed out" + n.stalledDetail(s))
	}
}

// runSign runs a signing ceremony for hash with key share k. The committee's
// party ids must be the ones for k's epoch.
func (n *Node) runSign(s *session, k *storedKey, hash []byte, ids tss.SortedPartyIDs, self *tss.PartyID, onDone func()) {
	ctx, cancel := context.WithTimeout(context.Background(), sessionTimeout)
	defer cancel()

	defer func() {
		// BuildLocalSaveDataSubset panics if the committee doesn't match the key.
		if r := recover(); r != nil {
			s.markFailed(fmt.Sprintf("signing setup failed: %v", r))
		}
	}()
	subset := keygen.BuildLocalSaveDataSubset(k.Save, ids)
	params := tss.NewParameters(tss.S256(), tss.NewPeerContext(ids), self, len(ids), k.Threshold)
	out := make(chan tss.Message, len(ids)*4)
	end := make(chan common.SignatureData, 1)
	party := signing.NewLocalParty(new(big.Int).SetBytes(hash), params, subset, out, end)
	n.begin(s, partySpec{self.Moniker, party, out})

	select {
	case sd := <-signatureParts(end):
		sig, err := finalizeSignature(hash, sd.R, sd.S, k.PublicKey)
		if err != nil {
			s.markFailed(err.Error())
			return
		}
		onDone()
		s.markDone(map[string]string{"signature": hex.EncodeToString(sig)})
	case <-ctx.Done():
		s.markFailed("signing timed out" + n.stalledDetail(s))
	}
}

type reshareOutcome struct {
	role string
	save keygen.LocalPartySaveData
}

func (n *Node) runReshare(s *session, req reshareReq, oldKey *storedKey, oldIDs, newIDs tss.SortedPartyIDs, selfOld, selfNew *tss.PartyID) {
	ctx, cancel := context.WithTimeout(context.Background(), sessionTimeout)
	defer cancel()
	defer func() {
		if r := recover(); r != nil {
			s.markFailed(fmt.Sprintf("reshare setup failed: %v", r))
		}
	}()

	oldCtx, newCtx := tss.NewPeerContext(oldIDs), tss.NewPeerContext(newIDs)
	buf := (len(oldIDs) + len(newIDs)) * 4
	done := make(chan reshareOutcome, 2)
	var specs []partySpec
	pump := func(role string, end <-chan keygen.LocalPartySaveData) {
		go func() { done <- reshareOutcome{role, recvSave(end)} }()
	}

	if selfOld != nil {
		params := tss.NewReSharingParameters(tss.S256(), oldCtx, newCtx, selfOld, len(oldIDs), req.OldThreshold, len(newIDs), req.NewThreshold)
		out := make(chan tss.Message, buf)
		end := make(chan keygen.LocalPartySaveData, 1)
		specs = append(specs, partySpec{selfOld.Moniker, resharing.NewLocalParty(params, oldKey.Save, out, end), out})
		pump("old", end)
	}
	if selfNew != nil {
		pre, err := n.pool.Take(ctx)
		if err != nil {
			s.markFailed("no pre-parameters for the new share: " + err.Error())
			return
		}
		params := tss.NewReSharingParameters(tss.S256(), oldCtx, newCtx, selfNew, len(oldIDs), req.OldThreshold, len(newIDs), req.NewThreshold)
		save := keygen.NewLocalPartySaveData(len(newIDs))
		save.LocalPreParams = *pre
		out := make(chan tss.Message, buf)
		end := make(chan keygen.LocalPartySaveData, 1)
		specs = append(specs, partySpec{selfNew.Moniker, resharing.NewLocalParty(params, save, out, end), out})
		pump("new", end)
	}
	n.begin(s, specs...)

	result := map[string]any{"role": "old"}
	for range specs {
		select {
		case o := <-done:
			if o.role != "new" {
				continue
			}
			save := o.save
			if save.ECDSAPub == nil || save.Xi == nil {
				s.markFailed("reshare finished without producing a share")
				return
			}
			address, pub := publicKeyHex(&save)
			if !strings.EqualFold(pub, req.PublicKey) {
				n.audit.Record("reshare_failed", s.id, s.keyID, map[string]any{"reason": "public key changed", "got": address})
				s.markFailed("the reshared key's public key differs from the original; discarding it")
				return
			}
			k := &storedKey{
				KeyID: s.keyID, Epoch: req.Epoch + 1, Threshold: req.NewThreshold, Participants: req.NewCommittee,
				CreatedAt: time.Now().UTC(), Address: address, PublicKey: pub, Save: save,
			}
			n.keyMu.Lock()
			err := n.saveKey(k, true)
			n.keyMu.Unlock()
			if err != nil {
				s.markFailed("could not store the new share: " + err.Error())
				return
			}
			n.audit.Record("reshare_pending", s.id, s.keyID, map[string]any{"epoch": k.Epoch, "address": address, "threshold": k.Threshold, "participants": k.Participants})
			result = map[string]any{"role": "new", "epoch": k.Epoch, "address": address, "publicKey": pub}
		case <-ctx.Done():
			s.markFailed("reshare timed out" + n.stalledDetail(s))
			return
		}
	}
	if oldKey != nil {
		n.audit.Record("reshare_contributed", s.id, s.keyID, map[string]any{"epoch": oldKey.Epoch})
		n.markContributed(s.keyID, oldKey.Epoch+1)
	}
	s.markDone(result)
}

// peersHoldNewEpoch is how a node that was offline for a reshare gets proof it may let go of its old share:
// it asks the named new-committee nodes (which must be in the cluster file) whether they hold the new epoch
// of the same key as an ACTIVE share, and requires enough of them for the key to sign. The coordinator's
// word alone is not taken: it can name nodes, but cannot make them report a share they do not have.
func (n *Node) peersHoldNewEpoch(ctx context.Context, keyID string, epoch int, staying []string) bool {
	mine, err := n.loadKey(keyID)
	if err != nil || len(staying) == 0 {
		return false
	}
	cluster := n.cluster()
	holders, need := 0, 0
	seen := map[string]bool{}
	for _, id := range staying {
		if id == n.cfg.ID || seen[id] {
			continue
		}
		seen[id] = true
		peer, ok := cluster.Node(id)
		if !ok {
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		req, _ := http.NewRequestWithContext(cctx, http.MethodGet, strings.TrimRight(peer.URL, "/")+"/v1/keys/"+keyID, nil)
		resp, err := n.cfg.HTTP.Do(req)
		if err != nil {
			cancel()
			continue
		}
		var r struct {
			PublicKey    string   `json:"publicKey"`
			Threshold    int      `json:"threshold"`
			Epoch        int      `json:"epoch"`
			Participants []string `json:"participants"`
		}
		ok = resp.StatusCode == http.StatusOK && json.NewDecoder(resp.Body).Decode(&r) == nil
		resp.Body.Close()
		cancel()
		if ok && r.Epoch >= epoch && strings.EqualFold(r.PublicKey, mine.PublicKey) && contains(r.Participants, id) && !contains(r.Participants, n.cfg.ID) {
			holders++
			if r.Threshold+1 > need {
				need = r.Threshold + 1
			}
		}
	}
	return need > 0 && holders >= need
}

// markContributed records that this node finished its old-member part of the reshare to `epoch`.
func (n *Node) markContributed(keyID string, epoch int) {
	dir := filepath.Join(n.cfg.DataDir, "reshared")
	_ = os.MkdirAll(dir, 0o700)
	_ = os.WriteFile(filepath.Join(dir, fmt.Sprintf("%s.e%d", keyID, epoch)), []byte(time.Now().UTC().Format(time.RFC3339)), 0o600)
}

func (n *Node) contributedTo(keyID string, epoch int) bool {
	return exists(filepath.Join(n.cfg.DataDir, "reshared", fmt.Sprintf("%s.e%d", keyID, epoch)))
}

// recvSave is a plain receive of a save-data value.
func recvSave(ch <-chan keygen.LocalPartySaveData) keygen.LocalPartySaveData { return <-ch }

// stalledDetail names the parties a timed-out session was still waiting on.
func (n *Node) stalledDetail(s *session) string {
	s.mu.Lock()
	parties := make([]tss.Party, 0, len(s.local))
	for _, p := range s.local {
		parties = append(parties, p)
	}
	s.mu.Unlock()
	if len(parties) == 0 {
		return " (before the protocol started)"
	}
	var waiting, rounds []string
	for _, p := range parties {
		for _, w := range p.WaitingFor() {
			waiting = append(waiting, w.Moniker)
		}
		rounds = append(rounds, p.String())
	}
	sort.Strings(waiting)
	n.audit.Record("session_stalled", s.id, s.keyID, map[string]any{"waitingFor": waiting, "round": strings.Join(rounds, " / ")})
	return fmt.Sprintf(" (still waiting on %s in %s)", strings.Join(waiting, ", "), strings.Join(rounds, " / "))
}

// recv is a plain receive. tss-lib delivers signatures as common.SignatureData
// values, which embed a protobuf mutex, so `x := <-ch` trips vet's copylocks
// check. Going through a generic function keeps the check switched on for the
// rest of the package; only the two byte slices are read from the value.
func recv[T any](ch <-chan T) T { return <-ch }

type sigParts struct{ R, S []byte }

func signatureParts(end <-chan common.SignatureData) <-chan sigParts {
	out := make(chan sigParts, 1)
	go func() {
		v := recv(end)
		out <- sigParts{R: v.R, S: v.S}
	}()
	return out
}

// finalizeSignature turns tss-lib's output into a 65-byte [R||S||V] Ethereum
// signature. S is folded into the lower half of the curve order (Ethereum
// rejects the other half), and V is found by recovering the public key rather
// than trusting a returned recovery byte — the result must recover to the
// key's own public key or it is discarded.
func finalizeSignature(hash, rBytes, sBytes []byte, pubKeyHex string) ([]byte, error) {
	n := eth.S256().Params().N
	halfN := new(big.Int).Rsh(n, 1)
	r := new(big.Int).SetBytes(rBytes)
	s := new(big.Int).SetBytes(sBytes)
	if s.Cmp(halfN) > 0 {
		s.Sub(n, s)
	}
	sig := make([]byte, 65)
	r.FillBytes(sig[0:32])
	s.FillBytes(sig[32:64])
	want, err := hex.DecodeString(pubKeyHex)
	if err != nil {
		return nil, err
	}
	for v := byte(0); v <= 1; v++ {
		sig[64] = v
		if pub, err := eth.SigToPub(hash, sig); err == nil && bytes.Equal(eth.FromECDSAPub(pub), want) {
			return sig, nil
		}
	}
	return nil, errors.New("threshold signature does not verify against the key's public key")
}
