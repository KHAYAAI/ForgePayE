package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"forge-crypto/mpc-signer/internal/mpc"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// main.go wires the MPC signer's HTTP API.
//
// Endpoints:
//   POST /sign    -> sign an Ethereum transaction, audit-log the lifecycle
//   GET  /address -> return the shared signer address (useful for funding on testnet)
//   GET  /health  -> liveness/readiness probe
//
// The audit logger is best-effort: if immudb is unreachable at startup the
// service still boots and serves /sign, recording a warning per request. This
// keeps the Phase 0 happy path working even when immudb is slow to come up.
//
// Threshold mode (MPC_CLUSTER_FILE set): POST /mpc/keys creates a key across
// the node cluster, GET /mpc/status reports the cluster, and POST /sign with a
// keyId signs with that key. With MPC_REQUIRED=true nothing else is allowed.

type server struct {
	signer *MPCSigner
	audit  *AuditLogger // may be nil if immudb was unavailable at startup
	// coord drives threshold signing across the node cluster; nil when no
	// cluster is configured, in which case only the legacy single key exists.
	coord *mpc.Coordinator
	// mpcRequired refuses any /sign that doesn't name a threshold key, so the
	// legacy shared key can't be reached at all.
	mpcRequired bool
}

// signBody is a sign request plus, for threshold signing, which key to use.
type signBody struct {
	SignRequest
	KeyID           string `json:"keyId,omitempty"`
	ExpectedAddress string `json:"expectedAddress,omitempty"`
}

func (s *server) log(ctx context.Context, event AuditEvent) uint64 {
	if s.audit == nil {
		auditWriteTotal.WithLabelValues("skipped").Inc()
		return 0
	}
	id, err := s.audit.LogEvent(ctx, event)
	if err != nil {
		auditWriteTotal.WithLabelValues("failed").Inc()
		log.Printf("warning: audit log failed for %s (%s): %v", event.RequestID, event.Type, err)
		return 0
	}
	auditWriteTotal.WithLabelValues("success").Inc()
	return id
}

func (s *server) handleSign(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	requestID := uuid.NewString()

	timer := prometheus.NewTimer(signDuration)
	defer timer.ObserveDuration()

	var body signBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		signTotal.WithLabelValues("invalid").Inc()
		s.log(ctx, AuditEvent{Type: "SIGN_REQUEST_INVALID", RequestID: requestID, Message: err.Error(), Status: "failed"})
		writeJSON(w, http.StatusBadRequest, ErrorResponse{Error: "invalid request body", RequestID: requestID})
		return
	}

	req := body.SignRequest
	s.log(ctx, AuditEvent{
		Type:      "SIGN_REQUEST_RECEIVED",
		RequestID: requestID,
		Message:   fmt.Sprintf("to=%s value=%s nonce=%d data_len=%d", req.To, req.Value, req.Nonce, len(req.Data)),
		Status:    "pending",
	})

	signed, status, err := s.sign(ctx, &body)
	if err != nil {
		signTotal.WithLabelValues("failed").Inc()
		s.log(ctx, AuditEvent{Type: "SIGN_FAILED", RequestID: requestID, Message: err.Error(), Status: "failed"})
		writeJSON(w, status, ErrorResponse{Error: err.Error(), RequestID: requestID})
		return
	}
	signTotal.WithLabelValues("success").Inc()

	auditID := s.log(ctx, AuditEvent{
		Type:      "SIGN_SUCCESS",
		RequestID: requestID,
		Signature: signed.Signature,
		Hash:      signed.Hash,
		From:      signed.From,
		Status:    "signed",
	})

	writeJSON(w, http.StatusOK, SignResponse{
		RequestID:  requestID,
		SignedTx:   signed.RawTx,
		TxHash:     signed.Hash,
		From:       signed.From,
		Status:     "signed",
		AuditLogID: auditID,
	})
}

// sign routes to threshold signing when a key is named, else the legacy key.
// The int is the HTTP status to use if the error is returned.
func (s *server) sign(ctx context.Context, body *signBody) (*SignedTransaction, int, error) {
	if body.KeyID == "" {
		if s.mpcRequired {
			return nil, http.StatusBadRequest, errors.New("keyId is required: this signer only signs with threshold keys")
		}
		signed, err := s.signer.SignTransaction(ctx, &body.SignRequest)
		if err != nil {
			return nil, http.StatusBadRequest, err
		}
		return signed, 0, nil
	}
	if s.coord == nil {
		return nil, http.StatusServiceUnavailable, errors.New("threshold signing is not configured on this signer")
	}
	if body.ExpectedAddress == "" {
		return nil, http.StatusBadRequest, errors.New("expectedAddress is required with keyId")
	}
	out, err := s.coord.Sign(ctx, body.KeyID, body.ExpectedAddress, &body.SignRequest)
	if err != nil {
		var quorum *mpc.ErrQuorumUnavailable
		var refused *mpc.NodeRefusal
		switch {
		case errors.As(err, &quorum):
			return nil, http.StatusServiceUnavailable, err
		case errors.As(err, &refused):
			return nil, http.StatusForbidden, err
		default:
			return nil, http.StatusBadGateway, err
		}
	}
	return &SignedTransaction{RawTx: out.RawTx, Signature: out.Signature, Hash: out.Hash, From: out.From}, 0, nil
}

// handleKeygen creates a threshold key across the whole node cluster.
func (s *server) handleKeygen(w http.ResponseWriter, r *http.Request) {
	if s.coord == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "threshold signing is not configured on this signer"})
		return
	}
	var body struct {
		KeyID string `json:"keyId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !mpc.ValidID(body.KeyID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "keyId is required (letters, digits, - and _ only)"})
		return
	}
	info, err := s.coord.Keygen(r.Context(), body.KeyID)
	if err != nil {
		s.log(r.Context(), AuditEvent{Type: "KEYGEN_FAILED", RequestID: body.KeyID, Message: err.Error(), Status: "failed"})
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	s.log(r.Context(), AuditEvent{Type: "KEYGEN_SUCCESS", RequestID: body.KeyID, From: info.Address, Status: "created",
		Message: fmt.Sprintf("%d-of-%d across %s", info.Threshold+1, len(info.Nodes), strings.Join(info.Nodes, ","))})
	writeJSON(w, http.StatusCreated, info)
}

// handleMPCStatus reports the cluster's shape and which nodes answer right now.
func (s *server) handleMPCStatus(w http.ResponseWriter, r *http.Request) {
	if s.coord == nil {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	nodes := s.coord.Health(r.Context())
	reachable := 0
	for _, n := range nodes {
		if n.Reachable {
			reachable++
		}
	}
	c := s.coord.Cluster()
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": true, "threshold": c.Threshold, "signersNeeded": c.Threshold + 1, "total": len(c.Nodes),
		"reachable": reachable, "canSign": reachable >= c.Threshold+1, "trustDomains": c.TrustDomains(), "nodes": nodes,
		"thresholdOnly": s.mpcRequired,
		// Domains that hold enough nodes to sign alone; empty is what a sound topology looks like.
		"exposedDomains": c.ExposedDomains(c.AllNodeIDs(), c.Threshold),
		"production":     mpc.Production(),
	})
}

func (s *server) mpcErrStatus(err error) int {
	var quorum *mpc.ErrQuorumUnavailable
	var refused *mpc.NodeRefusal
	switch {
	case errors.As(err, &quorum):
		return http.StatusServiceUnavailable
	case errors.As(err, &refused):
		if refused.Status == http.StatusNotFound {
			return http.StatusNotFound
		}
		return http.StatusForbidden
	}
	return http.StatusBadGateway
}

// handleKeyMeta reports what the nodes collectively hold for a key: its epoch,
// committee and threshold, any node still holding a retired share.
func (s *server) handleKeyMeta(w http.ResponseWriter, r *http.Request) {
	if s.coord == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "threshold signing is not configured on this signer"})
		return
	}
	meta, err := s.coord.KeyMeta(r.Context(), mux.Vars(r)["id"])
	if err != nil {
		writeJSON(w, s.mpcErrStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, meta)
}

// handleReshare moves a key to a new committee and/or threshold, keeping its
// address. It runs to completion (a minute or more) and returns the steps taken.
func (s *server) handleReshare(w http.ResponseWriter, r *http.Request) {
	if s.coord == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "threshold signing is not configured on this signer"})
		return
	}
	var body struct {
		Nodes     []string `json:"nodes"`
		Threshold int      `json:"threshold"` // t: any t+1 nodes sign
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Nodes) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "nodes and threshold are required"})
		return
	}
	keyID := mux.Vars(r)["id"]
	var steps []string
	res, err := s.coord.Reshare(r.Context(), keyID, body.Nodes, body.Threshold, func(m string) {
		log.Printf("reshare %s: %s", keyID, m)
		steps = append(steps, m)
	})
	if err != nil {
		s.log(r.Context(), AuditEvent{Type: "RESHARE_FAILED", RequestID: keyID, Message: err.Error(), Status: "failed"})
		writeJSON(w, s.mpcErrStatus(err), map[string]any{"error": err.Error(), "steps": steps})
		return
	}
	s.log(r.Context(), AuditEvent{Type: "RESHARE_SUCCESS", RequestID: keyID, From: res.Address, Status: "reshared",
		Message: fmt.Sprintf("epoch %d -> %d, now %d-of-%d across %s", res.FromEpoch, res.ToEpoch, res.Threshold+1, len(res.NewNodes), strings.Join(res.NewNodes, ","))})
	writeJSON(w, http.StatusOK, map[string]any{"result": res, "steps": steps})
}

// handleRetireStale destroys leftover shares on nodes that were offline when a
// reshare completed.
func (s *server) handleRetireStale(w http.ResponseWriter, r *http.Request) {
	if s.coord == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "threshold signing is not configured on this signer"})
		return
	}
	retired, notRetired, err := s.coord.RetireStale(r.Context(), mux.Vars(r)["id"])
	if err != nil {
		writeJSON(w, s.mpcErrStatus(err), map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"retired": retired, "notRetired": notRetired})
}

func (s *server) handleAddress(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"address": s.signer.Address()})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	// Resolve the signing key from Vault (preferred), env, or generate ephemeral.
	keyHex, err := ResolveSigningKey(context.Background(), os.Getenv)
	if err != nil {
		log.Fatalf("failed to resolve signing key: %v", err)
	}

	signer, err := NewMPCSigner(keyHex)
	if err != nil {
		log.Fatalf("failed to init MPC signer: %v", err)
	}
	log.Printf("MPC signer address: %s", signer.Address())

	// immudb is best-effort at startup so a slow ledger doesn't block signing.
	var audit *AuditLogger
	immudbURL := getenv("IMMUDB_URL", "localhost:3322")
	audit, err = NewAuditLogger(immudbURL, os.Getenv("IMMUDB_USER"), os.Getenv("IMMUDB_PASSWORD"))
	if err != nil {
		log.Printf("warning: immudb audit logger unavailable (%v); continuing without immutable ledger", err)
		audit = nil
	} else {
		defer audit.Close()
		log.Printf("connected to immudb at %s", immudbURL)
	}

	s := &server{signer: signer, audit: audit, mpcRequired: os.Getenv("MPC_REQUIRED") == "true"}
	if clusterFile := os.Getenv("MPC_CLUSTER_FILE"); clusterFile != "" {
		clusters, err := mpc.WatchCluster(clusterFile)
		if err != nil {
			log.Fatalf("MPC_CLUSTER_FILE: %v", err)
		}
		cluster := clusters.Get()
		tlsFiles, err := mpc.TLSFromEnv()
		if err != nil {
			log.Fatalf("mutual TLS: %v", err)
		}
		coordKey, err := mpc.LoadCoordinatorKey(os.Getenv("MPC_COORDINATOR_KEY_FILE"))
		if err != nil {
			log.Fatalf("MPC_COORDINATOR_KEY_FILE: %v", err)
		}
		if s.coord, err = mpc.NewCoordinatorWith(clusters, coordKey, tlsFiles); err != nil {
			log.Fatalf("coordinator: %v", err)
		}
		if tlsFiles == nil {
			log.Printf("WARNING: talking to signing nodes over plain HTTP; set MPC_TLS_CA_FILE, MPC_TLS_CERT_FILE and MPC_TLS_KEY_FILE for mutual TLS")
		}
		log.Printf("threshold signing enabled: %d-of-%d across %d trust domain(s)", cluster.Threshold+1, len(cluster.Nodes), cluster.TrustDomains())
		if exposed := cluster.ExposedDomains(cluster.AllNodeIDs(), cluster.Threshold); len(exposed) > 0 {
			log.Printf("WARNING: trust domain %q holds enough signing nodes to sign on its own; compromising that one place exposes every key", exposed[0])
		}
	} else if s.mpcRequired {
		log.Fatal("MPC_REQUIRED=true but no MPC_CLUSTER_FILE is configured")
	}

	router := mux.NewRouter()
	router.HandleFunc("/sign", s.handleSign).Methods(http.MethodPost)
	router.HandleFunc("/address", s.handleAddress).Methods(http.MethodGet)
	router.HandleFunc("/mpc/keys", s.handleKeygen).Methods(http.MethodPost)
	router.HandleFunc("/mpc/status", s.handleMPCStatus).Methods(http.MethodGet)
	router.HandleFunc("/mpc/keys/{id}", s.handleKeyMeta).Methods(http.MethodGet)
	router.HandleFunc("/mpc/keys/{id}/reshare", s.handleReshare).Methods(http.MethodPost)
	router.HandleFunc("/mpc/keys/{id}/retire-stale", s.handleRetireStale).Methods(http.MethodPost)
	router.HandleFunc("/health", handleHealth).Methods(http.MethodGet)
	router.Handle("/metrics", promhttp.Handler()).Methods(http.MethodGet)

	addr := ":" + getenv("PORT", "8080")
	srv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("MPC signer listening on %s", addr)
	log.Fatal(srv.ListenAndServe())
}
