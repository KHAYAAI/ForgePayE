package mpc

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// keyFilesOn lists a node's share files for a key, e.g. ["ws.e2.sealed"].
func keyFilesOn(t *testing.T, h *harness, node int, keyID string) []string {
	t.Helper()
	entries, _ := os.ReadDir(filepath.Join(h.cfgs[node].DataDir, "keys"))
	var out []string
	for _, e := range entries {
		if id, _, ok := parseKeyFile(e.Name()); ok && id == keyID {
			out = append(out, e.Name())
		}
	}
	return out
}

func TestReshareMovesAKeyWithoutChangingItsAddress(t *testing.T) {
	if testing.Short() {
		t.Skip("real key generation and resharing take minutes of CPU; skipped in -short")
	}
	h := newHarnessN(t, 4, 1)
	h.waitForPreParams()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	defer cancel()

	key, err := h.coord.Keygen(ctx, "ws-r")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("2-of-4 key %s", key.Address)
	verifyOnChainRules(t, h.mustSign(1, key), key.Address)

	var reshareNow func(nodes []string, threshold int, wait bool) *ReshareResult
	reshare := func(nodes []string, threshold int) *ReshareResult {
		t.Helper()
		return reshareNow(nodes, threshold, true)
	}
	reshareNow = func(nodes []string, threshold int, wait bool) *ReshareResult {
		t.Helper()
		if wait {
			h.waitForPreParams() // each new share needs a pre-parameter set, which is CPU-bound to make
		}
		start := time.Now()
		res, err := h.coord.Reshare(ctx, "ws-r", nodes, threshold, func(m string) { t.Log("  ", m) })
		if err != nil {
			t.Fatalf("reshare to %v: %v", nodes, err)
		}
		t.Logf("reshared to %v (threshold %d) in %s", nodes, threshold+1, time.Since(start).Round(time.Second))
		if !strings.EqualFold(res.Address, key.Address) {
			t.Fatalf("address changed: %s -> %s", key.Address, res.Address)
		}
		return res
	}
	wantFiles := func(node int, want ...string) {
		t.Helper()
		got := keyFilesOn(t, h, node, "ws-r")
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("node%d holds %v, want %v", node+1, got, want)
		}
	}

	t.Run("drop a node: 2-of-4 becomes 2-of-3, the address stays, the dropped node's share is destroyed", func(t *testing.T) {
		h.waitForPreParams()
		h.down[3].Store(true) // node4 is offline while it is being removed
		res := reshareNow([]string{"node1", "node2", "node3"}, 1, false)
		if res.ToEpoch != 1 {
			t.Fatalf("epoch %d", res.ToEpoch)
		}
		if len(res.NotRetired) != 1 || res.NotRetired[0] != "node4" {
			t.Fatalf("the unreachable node should be reported as still holding an old share, got %v", res.NotRetired)
		}
		wantFiles(0, "ws-r.e1.sealed")
		wantFiles(1, "ws-r.e1.sealed")
		wantFiles(2, "ws-r.e1.sealed")
		wantFiles(3, "ws-r.sealed") // still there: it was offline

		h.down[3].Store(false)
		meta, err := h.coord.KeyMeta(ctx, "ws-r")
		if err != nil || meta.Epoch != 1 || len(meta.Stale) != 1 || meta.Stale[0] != "node4" {
			t.Fatalf("meta %+v, err %v: node4 should show as stale", meta, err)
		}
		retired, notRetired, err := h.coord.RetireStale(ctx, "ws-r")
		if err != nil || len(notRetired) != 0 || len(retired) != 1 || retired[0] != "node4" {
			t.Fatalf("retire stale: %v %v %v", retired, notRetired, err)
		}
		wantFiles(3) // destroyed

		verifyOnChainRules(t, h.mustSign(2, key), key.Address)
		// node4 can no longer take part.
		_, err = h.coord.signWith(ctx, []NodeInfo{h.cluster.Nodes[0], h.cluster.Nodes[3]}, "ws-r", 1, key.Address, testTx(3, "1"))
		if err == nil {
			t.Fatal("a removed node signed")
		}
	})

	t.Run("refresh: same committee, new shares", func(t *testing.T) {
		before, _ := os.ReadFile(filepath.Join(h.cfgs[0].DataDir, "keys", "ws-r.e1.sealed"))
		res := reshare([]string{"node1", "node2", "node3"}, 1)
		if res.ToEpoch != 2 || len(res.NotRetired) != 0 {
			t.Fatalf("%+v", res)
		}
		wantFiles(0, "ws-r.e2.sealed")
		if b, _ := os.ReadFile(filepath.Join(h.cfgs[0].DataDir, "keys", "ws-r.e2.sealed")); string(b) == string(before) {
			t.Fatal("share file unchanged")
		}
		// The share itself changed, not just the file.
		k1, _ := h.nodes[0].loadKey("ws-r")
		if k1.Epoch != 2 {
			t.Fatalf("epoch %d", k1.Epoch)
		}
		verifyOnChainRules(t, h.mustSign(4, key), key.Address)
	})

	t.Run("replace a node: node1 out, node4 in", func(t *testing.T) {
		res := reshare([]string{"node2", "node3", "node4"}, 1)
		if res.ToEpoch != 3 {
			t.Fatalf("%+v", res)
		}
		wantFiles(0) // node1's share is gone
		wantFiles(3, "ws-r.e3.sealed")
		signed := h.mustSign(5, key)
		verifyOnChainRules(t, signed, key.Address)
		if contains(signed.Committee, "node1") {
			t.Fatalf("node1 is no longer a holder but signed: %v", signed.Committee)
		}
	})

	t.Run("raise the threshold: 2-of-3 becomes 3-of-4", func(t *testing.T) {
		res := reshare([]string{"node1", "node2", "node3", "node4"}, 2)
		if res.ToEpoch != 4 || res.Threshold != 2 {
			t.Fatalf("%+v", res)
		}
		signed := h.mustSign(6, key)
		verifyOnChainRules(t, signed, key.Address)
		if len(signed.Committee) != 3 {
			t.Fatalf("committee %v, want 3 nodes", signed.Committee)
		}
		h.down[2].Store(true)
		h.down[3].Store(true)
		defer func() {
			h.down[2].Store(false)
			h.down[3].Store(false)
		}()
		_, err := h.coord.Sign(ctx, "ws-r", key.Address, testTx(7, "1"))
		var q *ErrQuorumUnavailable
		if !errors.As(err, &q) || q.Needed != 3 || q.Reachable != 2 {
			t.Fatalf("with 2 of 4 up a 3-of-4 key must refuse with a quorum error, got %v", err)
		}
	})

	t.Run("a reshare that can't reach a new member changes nothing", func(t *testing.T) {
		h.waitForPreParams()
		h.down[2].Store(true)
		_, err := h.coord.Reshare(ctx, "ws-r", []string{"node1", "node2", "node3"}, 1, nil)
		h.down[2].Store(false)
		if err == nil || !strings.Contains(err.Error(), "not reachable") {
			t.Fatalf("want a clear refusal, got %v", err)
		}
		meta, err := h.coord.KeyMeta(ctx, "ws-r")
		if err != nil || meta.Epoch != 4 || len(meta.Pending) != 0 {
			t.Fatalf("state changed: %+v %v", meta, err)
		}
		verifyOnChainRules(t, h.mustSign(8, key), key.Address)
	})

	t.Run("bad requests are refused before anything moves", func(t *testing.T) {
		for name, tc := range map[string]struct {
			nodes []string
			t     int
		}{
			"threshold too high":  {[]string{"node1", "node2"}, 2},
			"unknown node":        {[]string{"node1", "node2", "nodeX"}, 1},
			"duplicate node":      {[]string{"node1", "node1", "node2"}, 1},
			"threshold too small": {[]string{"node1", "node2", "node3"}, 0},
		} {
			if _, err := h.coord.Reshare(ctx, "ws-r", tc.nodes, tc.t, nil); err == nil {
				t.Errorf("%s was accepted", name)
			}
		}
		if _, err := h.coord.Reshare(ctx, "no-such-key", []string{"node1", "node2", "node3"}, 1, nil); err == nil {
			t.Error("resharing an unknown key was accepted")
		}
	})

	t.Run("the nodes recorded every step and their logs are intact", func(t *testing.T) {
		for i, c := range h.cfgs {
			if _, err := VerifyAuditChain(filepath.Join(c.DataDir, "audit.log")); err != nil {
				t.Fatalf("node%d: %v", i+1, err)
			}
		}
		raw, _ := os.ReadFile(filepath.Join(h.cfgs[1].DataDir, "audit.log"))
		for _, want := range []string{"reshare_started", "reshare_pending", "reshare_committed", "shares_retired", "probe_completed"} {
			if !strings.Contains(string(raw), want) {
				t.Errorf("node2's audit log has no %q", want)
			}
		}
	})
}
