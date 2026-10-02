package main

import (
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
