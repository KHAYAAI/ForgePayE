package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
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
