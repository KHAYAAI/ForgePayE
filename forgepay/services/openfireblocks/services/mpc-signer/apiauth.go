package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"forge-crypto/mpc-signer/internal/mpc"
	"net/http"
	"strings"
)

// The coordinator API signs and moves money, so every route except /health requires a bearer token
// (MPC_SIGNER_AUTH_TOKEN) known only to the gateway. Without it, anything that could reach the port
// could ask for a signature or a reshare. Mutual TLS between gateway and signer is the stronger control
// and can be added on top; this is the floor.

const minAuthTokenLen = 32

// authMiddleware rejects requests without the token. Comparison is constant-time on fixed-size digests.
func authMiddleware(token string, next http.Handler) http.Handler {
	want := sha256.Sum256([]byte(token))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		got := sha256.Sum256([]byte(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")))
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing or invalid signer credential"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// checkAuthToken validates the configured token. Production requires one; elsewhere it is optional
// but, if set, must be strong enough to mean something.
func checkAuthToken(token string, production bool) error {
	if token == "" {
		if production {
			return errors.New("MPC_SIGNER_AUTH_TOKEN is required when MPC_ENV=production: the signer API has no other authentication")
		}
		return nil
	}
	if len(token) < minAuthTokenLen {
		return errors.New("MPC_SIGNER_AUTH_TOKEN must be at least 32 characters")
	}
	return nil
}

// ── Optional mutual TLS on the signer's own API ───────────────────────────────
//
// The bearer token proves the caller knows a secret; mutual TLS also keeps the request unreadable on the
// wire and means only a holder of a certificate from the operators' CA, named "gateway", can even connect.
// Set MPC_SIGNER_TLS_CA_FILE, MPC_SIGNER_TLS_CERT_FILE and MPC_SIGNER_TLS_KEY_FILE (all or none). It is
// additional to the token, not a replacement: both are required when both are configured.

const signerClientCertName = "gateway"

func signerTLSFromEnv(getenv func(string) string) (*mpc.TLSFiles, error) {
	t := &mpc.TLSFiles{CAFile: getenv("MPC_SIGNER_TLS_CA_FILE"), CertFile: getenv("MPC_SIGNER_TLS_CERT_FILE"), KeyFile: getenv("MPC_SIGNER_TLS_KEY_FILE")}
	if t.CAFile == "" && t.CertFile == "" && t.KeyFile == "" {
		return nil, nil
	}
	if t.CAFile == "" || t.CertFile == "" || t.KeyFile == "" {
		return nil, errors.New("set all of MPC_SIGNER_TLS_CA_FILE, MPC_SIGNER_TLS_CERT_FILE and MPC_SIGNER_TLS_KEY_FILE, or none")
	}
	return t, nil
}

// requireClientName lets through only a verified client certificate with the expected common name.
// (Other certificates from the same CA, such as signing nodes', are valid TLS clients but not this API's.)
func requireClientName(name string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 || r.TLS.PeerCertificates[0].Subject.CommonName != name {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "this API is for the gateway's certificate only"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
