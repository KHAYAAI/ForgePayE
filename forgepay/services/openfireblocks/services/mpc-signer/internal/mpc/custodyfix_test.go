package mpc

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// F-03: a signed "retire, I'm leaving" must not destroy a share unless the node really took part in the reshare.
// F-07: a reshare interrupted half way through committing is finished, after a probe, rather than left split.
func TestLeavingRetireNeedsProofAndHalfCommitsAreResumed(t *testing.T) {
	if testing.Short() {
		t.Skip("real key generation and resharing take minutes of CPU; skipped in -short")
	}
	h := newHarnessN(t, 3, 1)
	h.waitForPreParams()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	key, err := h.coord.Keygen(ctx, "ws-c")
	if err != nil {
		t.Fatal(err)
	}

	// F-03. The coordinator's signature is valid; the node still refuses.
	node1, _ := h.cluster.Node("node1")
	if err := h.coord.lifecycle(ctx, node1, "retire", "ws-c", 1, true); err == nil {
		t.Fatal("a leaving-retire destroyed a share with no reshare behind it")
	}
	if got := keyFilesOn(t, h, 0, "ws-c"); len(got) != 1 {
		t.Fatalf("node1's share was touched: %v", got)
	}
	verifyOnChainRules(t, h.mustSign(1, key), key.Address)

	// F-07. Reshare to the same committee, but the commit never reaches node3.
	h.waitForPreParams()
	h.coord.beforeCommit = func(n NodeInfo) error {
		if n.ID == "node3" {
			return errors.New("simulated: commit lost on the way to node3")
		}
		return nil
	}
	if _, err := h.coord.Reshare(ctx, "ws-c", []string{"node1", "node2", "node3"}, 1, func(m string) { t.Log("  ", m) }); err == nil || !strings.Contains(err.Error(), "node3") {
		t.Fatalf("expected the commit on node3 to fail, got %v", err)
	}
	h.coord.beforeCommit = nil
	if got := keyFilesOn(t, h, 2, "ws-c"); strings.Join(got, ",") != "ws-c.e1.pending,ws-c.sealed" && strings.Join(got, ",") != "ws-c.sealed,ws-c.e1.pending" {
		t.Fatalf("node3 should hold its old share and a pending one, has %v", got)
	}

	resumed, err := h.coord.ResumeCommit(ctx, "ws-c", func(m string) { t.Log("  ", m) })
	if err != nil || !resumed {
		t.Fatalf("resume: %v %v", resumed, err)
	}
	for _, f := range keyFilesOn(t, h, 2, "ws-c") {
		if strings.HasSuffix(f, ".pending") {
			t.Fatalf("node3 still has a pending share: %s", f)
		}
	}
	meta, err := h.coord.KeyMeta(ctx, "ws-c")
	if err != nil || meta.Epoch != 1 || len(meta.Holders) != 3 {
		t.Fatalf("after resume: %+v %v", meta, err)
	}
	if again, err := h.coord.ResumeCommit(ctx, "ws-c", func(string) {}); err != nil || again {
		t.Fatalf("a finished reshare was 'resumed' again: %v %v", again, err)
	}
	// A node that never contributed but whose peers verifiably hold the new epoch may let go of its old share
	// (this is how an offline node is cleaned up later) ...
	if err := h.coord.lifecycleWith(ctx, node1, "retire", "ws-c", 1, true, []string{"node2", "node3"}); err != nil {
		t.Fatalf("a retire backed by peers that hold the new epoch was refused: %v", err)
	}
	// ... but naming peers that do not hold it proves nothing.
	if err := h.coord.lifecycleWith(ctx, node1, "retire", "ws-c", 9, true, []string{"node2", "node3"}); err == nil {
		t.Fatal("a retire naming peers that do not hold epoch 9 was accepted")
	}
	// Now that node1 genuinely contributed to epoch 1, a leaving-retire at that epoch is legitimate.
	if !h.nodes[0].contributedTo("ws-c", 1) {
		t.Fatal("node1 did not record its contribution")
	}
	h.down[2].Store(true) // and signing works with the resumed committee (node1+node2)
	verifyOnChainRules(t, h.mustSign(2, key), key.Address)
	_ = os.Stderr
}
