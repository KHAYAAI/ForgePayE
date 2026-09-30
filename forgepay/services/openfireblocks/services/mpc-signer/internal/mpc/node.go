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
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"forge-crypto/mpc-signer/internal/ethtx"
	"github.com/bnb-chain/tss-lib/v2/common"
	"github.com/bnb-chain/tss-lib/v2/ecdsa/keygen"
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
	Cluster         *Cluster
	SealKey         []byte
	MaxValueWei     *big.Int // optional per-transaction cap this node enforces on its own
	PreParamsTarget int
	HTTP            *http.Client
}

// Node is one member of the signing group. It holds exactly one key share per
// key, sealed on its own disk, and takes part in ceremonies started by the
// coordinator. It talks to its peers directly; the coordinator never sees
// protocol messages.
type Node struct {
	cfg      NodeConfig
	priv     *ecdh.PrivateKey
	coordPub ed25519.PublicKey
	pool     *preParamsPool
	audit    *auditLog

	mu       sync.Mutex
	maxValue *big.Int // guarded by mu; starts as cfg.MaxValueWei
	sessions map[string]*session
	mailbox  map[string][]bufferedMsg
}

type bufferedMsg struct {
	from  string
	seq   uint64
	bcast bool
	wire  []byte
	at    time.Time
}

type session struct {
	id      string
	kind    string // "keygen" | "sign"
	keyID   string
	ids     tss.SortedPartyIDs
	self    *tss.PartyID
	started time.Time
	seq     atomic.Uint64

	mu      sync.Mutex
	party   tss.Party
	ready   bool
	pending []bufferedMsg
	seen    map[string]bool
	status  string // running | done | failed
	err     string
	result  json.RawMessage
}

func NewNode(cfg NodeConfig) (*Node, error) {
	if cfg.HTTP == nil {
		cfg.HTTP = &http.Client{Timeout: 20 * time.Second}
	}
	if cfg.PreParamsTarget == 0 {
		cfg.PreParamsTarget = 1
	}
	me, ok := cfg.Cluster.Node(cfg.ID)
	if !ok {
		return nil, fmt.Errorf("node %q is not in the cluster file", cfg.ID)
	}
	priv, pub, err := LoadIdentity(cfg.DataDir, cfg.ID, cfg.SealKey)
	if err != nil {
		return nil, err
	}
	if hex.EncodeToString(pub) != me.X25519Pub {
		return nil, fmt.Errorf("this node's identity key does not match the cluster file entry for %q", cfg.ID)
	}
	coord, _ := hex.DecodeString(cfg.Cluster.CoordinatorPub)
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
	n := &Node{
		cfg: cfg, priv: priv, coordPub: ed25519.PublicKey(coord), pool: pool, audit: audit,
		maxValue: cfg.MaxValueWei,
		sessions: map[string]*session{}, mailbox: map[string][]bufferedMsg{},
	}
	pool.Refill()
	go n.janitor()
	return n, nil
}

// SetMaxValue changes this node's own per-transaction cap (nil removes it).
func (n *Node) SetMaxValue(wei *big.Int) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.maxValue = wei
}

// MaxValue is the node's current cap, or nil.
func (n *Node) MaxValue() *big.Int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.maxValue
}

// ---- HTTP surface ---------------------------------------------------------

func (n *Node) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", n.handleHealth)
	mux.HandleFunc("POST /v1/keygen", n.handleKeygen)
	mux.HandleFunc("POST /v1/sign", n.handleSign)
	mux.HandleFunc("POST /v1/msg", n.handleMsg)
	mux.HandleFunc("GET /v1/sessions/{id}", n.handleSession)
	mux.HandleFunc("GET /v1/keys/{id}", n.handleKeyInfo)
	return mux
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
	me, _ := n.cfg.Cluster.Node(n.cfg.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "id": n.cfg.ID, "domain": me.Domain, "preparams": n.pool.Available(),
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
	if req.Threshold != n.cfg.Cluster.Threshold || len(req.Participants) != len(n.cfg.Cluster.Nodes) {
		fail(w, http.StatusBadRequest, "keygen must use the whole cluster at its configured threshold")
		return
	}
	for _, id := range req.Participants {
		if _, ok := n.cfg.Cluster.Node(id); !ok {
			fail(w, http.StatusBadRequest, "unknown participant "+id)
			return
		}
	}
	if _, err := os.Stat(n.keyPath(req.KeyID)); err == nil {
		fail(w, http.StatusConflict, "a key with that id already exists on this node")
		return
	}
	ids := SortedParties(req.Participants)
	self := findParty(ids, n.cfg.ID)
	if self == nil {
		fail(w, http.StatusBadRequest, "this node is not a participant")
		return
	}
	s, err := n.newSession(req.Session, "keygen", req.KeyID, ids, self)
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	n.audit.Record("keygen_started", s.id, req.KeyID, map[string]any{"threshold": req.Threshold, "participants": req.Participants})
	go n.runKeygen(s, req.Threshold, req.Participants)
	writeJSON(w, http.StatusAccepted, map[string]string{"session": s.id})
}

type signReq struct {
	Session         string            `json:"session"`
	KeyID           string            `json:"keyId"`
	Committee       []string          `json:"committee"`
	ExpectedAddress string            `json:"expectedAddress"`
	Tx              ethtx.SignRequest `json:"tx"`
	TS              int64             `json:"ts"`
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
	if !strings.EqualFold(stored.Address, req.ExpectedAddress) {
		n.audit.Record("rejected", req.Session, req.KeyID, map[string]any{"reason": "address mismatch", "asked": req.ExpectedAddress})
		fail(w, http.StatusConflict, "this key's address is not the one the request expects")
		return
	}
	if len(req.Committee) != stored.Threshold+1 {
		fail(w, http.StatusBadRequest, fmt.Sprintf("a signing committee is exactly %d nodes", stored.Threshold+1))
		return
	}
	member := map[string]bool{}
	for _, id := range stored.Participants {
		member[id] = true
	}
	for _, id := range req.Committee {
		if !member[id] {
			fail(w, http.StatusBadRequest, "committee member "+id+" does not hold this key")
			return
		}
	}

	// Rebuild the transaction here and hash it ourselves, so this node signs
	// what it can read rather than a digest handed to it.
	tx, signer, err := ethtx.Build(&req.Tx)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid transaction: "+err.Error())
		return
	}
	if limit := n.MaxValue(); limit != nil && tx.Value().Cmp(limit) > 0 {
		n.audit.Record("rejected", req.Session, req.KeyID, map[string]any{"reason": "over this node's value cap", "value": tx.Value().String()})
		fail(w, http.StatusForbidden, "value exceeds this node's own per-transaction cap")
		return
	}
	hash := signer.Hash(tx)

	ids := SortedParties(req.Committee)
	self := findParty(ids, n.cfg.ID)
	if self == nil {
		fail(w, http.StatusBadRequest, "this node is not in the committee")
		return
	}
	s, err := n.newSession(req.Session, "sign", req.KeyID, ids, self)
	if err != nil {
		fail(w, http.StatusConflict, err.Error())
		return
	}
	n.audit.Record("sign_requested", s.id, req.KeyID, map[string]any{
		"to": tx.To().Hex(), "valueWei": tx.Value().String(), "chainId": req.Tx.ChainID,
		"nonce": tx.Nonce(), "hash": hash.Hex(), "committee": req.Committee,
	})
	go n.runSign(s, stored, hash.Bytes())
	writeJSON(w, http.StatusAccepted, map[string]string{"session": s.id})
}

func (n *Node) handleMsg(w http.ResponseWriter, r *http.Request) {
	var m PeerMessage
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&m); err != nil {
		fail(w, http.StatusBadRequest, "malformed message")
		return
	}
	peer, ok := n.cfg.Cluster.Node(m.From)
	if !ok || m.To != n.cfg.ID || !ValidID(m.Session) {
		fail(w, http.StatusBadRequest, "bad message routing")
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
	msg := bufferedMsg{from: m.From, seq: m.Seq, bcast: m.Broadcast, wire: wire, at: time.Now()}

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
	party, status, errText, result := s.party, s.status, s.err, s.result
	s.mu.Unlock()
	out := map[string]any{"status": status, "error": errText, "result": result}
	if status == "running" && party != nil {
		// Who this node is still waiting to hear from — what "stuck" means.
		var waiting []string
		for _, p := range party.WaitingFor() {
			waiting = append(waiting, p.Moniker)
		}
		out["waitingFor"] = waiting
		out["round"] = party.String()
	}
	writeJSON(w, http.StatusOK, out)
}

func (n *Node) handleKeyInfo(w http.ResponseWriter, r *http.Request) {
	k, err := n.loadKey(r.PathValue("id"))
	if err != nil {
		fail(w, http.StatusNotFound, "no such key")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"keyId": k.KeyID, "address": k.Address, "publicKey": k.PublicKey,
		"threshold": k.Threshold, "participants": k.Participants, "createdAt": k.CreatedAt,
	})
}

// ---- sessions -------------------------------------------------------------

func (n *Node) newSession(id, kind, keyID string, ids tss.SortedPartyIDs, self *tss.PartyID) (*session, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if _, dup := n.sessions[id]; dup {
		return nil, errors.New("session id already used")
	}
	s := &session{id: id, kind: kind, keyID: keyID, ids: ids, self: self, started: time.Now(), status: "running", seen: map[string]bool{}}
	n.sessions[id] = s
	return s, nil
}

func (s *session) markFailed(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status == "running" {
		s.status, s.err = "failed", reason
	}
}

func (s *session) markDone(result any) {
	raw, _ := json.Marshal(result)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.status == "running" {
		s.status, s.result = "done", raw
	}
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
	key := fmt.Sprintf("%s|%d", m.from, m.seq)
	s.mu.Lock()
	if s.seen[key] || s.status != "running" {
		s.mu.Unlock()
		return
	}
	s.seen[key] = true
	party := s.party
	s.mu.Unlock()

	from := findParty(s.ids, m.from)
	if from == nil {
		s.markFailed("message from a node outside this session: " + m.from)
		return
	}
	if _, err := party.UpdateFromBytes(m.wire, from, m.bcast); err != nil {
		s.markFailed("protocol error: " + err.Error())
	}
}

// begin hands a freshly built party its buffered messages and starts it.
func (n *Node) begin(s *session, party tss.Party, out <-chan tss.Message) {
	go func() {
		for msg := range out {
			n.send(s, msg)
		}
	}()
	s.mu.Lock()
	s.party = party
	s.mu.Unlock()
	go func() {
		if err := party.Start(); err != nil {
			s.markFailed("could not start: " + err.Error())
		}
	}()

	// Anything that arrived before this session existed, or before the party
	// was ready, is delivered now.
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

func (n *Node) send(s *session, msg tss.Message) {
	wire, routing, err := msg.WireBytes()
	if err != nil {
		s.markFailed("cannot encode message: " + err.Error())
		return
	}
	var targets []string
	if routing.IsBroadcast || len(routing.To) == 0 {
		for _, id := range s.ids {
			if id.Moniker != n.cfg.ID {
				targets = append(targets, id.Moniker)
			}
		}
	} else {
		for _, id := range routing.To {
			targets = append(targets, id.Moniker)
		}
	}
	for _, to := range targets {
		peer, ok := n.cfg.Cluster.Node(to)
		if !ok {
			s.markFailed("unknown peer " + to)
			return
		}
		pm := &PeerMessage{Session: s.id, From: n.cfg.ID, To: to, Seq: s.seq.Add(1), Broadcast: routing.IsBroadcast, Type: msg.Type()}
		pubBytes, _ := hex.DecodeString(peer.X25519Pub)
		pub, err := ecdh.X25519().NewPublicKey(pubBytes)
		if err != nil || EncryptMessage(n.priv, pub, pm, wire) != nil {
			s.markFailed("cannot encrypt for " + to)
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

// ---- ceremonies -----------------------------------------------------------

type storedKey struct {
	KeyID        string                    `json:"keyId"`
	Threshold    int                       `json:"threshold"`
	Participants []string                  `json:"participants"`
	Address      string                    `json:"address"`
	PublicKey    string                    `json:"publicKey"`
	CreatedAt    time.Time                 `json:"createdAt"`
	Save         keygen.LocalPartySaveData `json:"save"`
}

func (n *Node) keyPath(keyID string) string {
	return filepath.Join(n.cfg.DataDir, "keys", keyID+".sealed")
}

func (n *Node) loadKey(keyID string) (*storedKey, error) {
	if !ValidID(keyID) {
		return nil, errors.New("invalid key id")
	}
	raw, err := os.ReadFile(n.keyPath(keyID))
	if err != nil {
		return nil, err
	}
	plain, err := Open(n.cfg.SealKey, raw, "key|"+keyID)
	if err != nil {
		return nil, err
	}
	var k storedKey
	return &k, json.Unmarshal(plain, &k)
}

func (n *Node) saveKey(k *storedKey) error {
	plain, err := json.Marshal(k)
	if err != nil {
		return err
	}
	sealed, err := Seal(n.cfg.SealKey, plain, "key|"+k.KeyID)
	if err != nil {
		return err
	}
	tmp := n.keyPath(k.KeyID) + ".tmp"
	if err := os.WriteFile(tmp, sealed, 0o600); err != nil {
		return err
	}
	// Link, not rename: a key id must never be overwritten.
	defer os.Remove(tmp)
	return os.Link(tmp, n.keyPath(k.KeyID))
}

func (n *Node) runKeygen(s *session, threshold int, participants []string) {
	ctx, cancel := context.WithTimeout(context.Background(), sessionTimeout)
	defer cancel()

	pre, err := n.pool.Take(ctx)
	if err != nil {
		s.markFailed(err.Error())
		return
	}
	params := tss.NewParameters(tss.S256(), tss.NewPeerContext(s.ids), s.self, len(s.ids), threshold)
	out := make(chan tss.Message, len(s.ids)*4)
	end := make(chan keygen.LocalPartySaveData, 1)
	party := keygen.NewLocalParty(params, out, end, *pre)
	n.begin(s, party, out)

	select {
	case save := <-end:
		pk := &ecdsa.PublicKey{Curve: eth.S256(), X: save.ECDSAPub.X(), Y: save.ECDSAPub.Y()}
		k := &storedKey{
			KeyID: s.keyID, Threshold: threshold, Participants: participants, CreatedAt: time.Now().UTC(),
			Address: eth.PubkeyToAddress(*pk).Hex(), PublicKey: hex.EncodeToString(eth.FromECDSAPub(pk)), Save: save,
		}
		if err := n.saveKey(k); err != nil {
			s.markFailed("could not store key share: " + err.Error())
			return
		}
		n.audit.Record("keygen_completed", s.id, s.keyID, map[string]any{"address": k.Address})
		s.markDone(map[string]any{"address": k.Address, "publicKey": k.PublicKey})
	case <-ctx.Done():
		s.markFailed("key generation timed out" + n.stalledDetail(s))
	}
}

func (n *Node) runSign(s *session, k *storedKey, hash []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), sessionTimeout)
	defer cancel()

	defer func() {
		// BuildLocalSaveDataSubset panics if the committee doesn't match the key.
		if r := recover(); r != nil {
			s.markFailed(fmt.Sprintf("signing setup failed: %v", r))
		}
	}()
	subset := keygen.BuildLocalSaveDataSubset(k.Save, s.ids)
	params := tss.NewParameters(tss.S256(), tss.NewPeerContext(s.ids), s.self, len(s.ids), k.Threshold)
	out := make(chan tss.Message, len(s.ids)*4)
	end := make(chan common.SignatureData, 1)
	party := signing.NewLocalParty(new(big.Int).SetBytes(hash), params, subset, out, end)
	n.begin(s, party, out)

	select {
	case sd := <-signatureParts(end):
		sig, err := finalizeSignature(hash, sd.R, sd.S, k.PublicKey)
		if err != nil {
			s.markFailed(err.Error())
			return
		}
		n.audit.Record("sign_completed", s.id, s.keyID, map[string]any{"hash": "0x" + hex.EncodeToString(hash)})
		s.markDone(map[string]string{"signature": hex.EncodeToString(sig)})
	case <-ctx.Done():
		s.markFailed("signing timed out" + n.stalledDetail(s))
	}
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

// stalledDetail names the parties a timed-out session was still waiting on.
func (n *Node) stalledDetail(s *session) string {
	s.mu.Lock()
	party := s.party
	s.mu.Unlock()
	if party == nil {
		return " (before the protocol started)"
	}
	var waiting []string
	for _, p := range party.WaitingFor() {
		waiting = append(waiting, p.Moniker)
	}
	n.audit.Record("session_stalled", s.id, s.keyID, map[string]any{"waitingFor": waiting, "round": party.String()})
	return fmt.Sprintf(" (still waiting on %s in %s)", strings.Join(waiting, ", "), party.String())
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
