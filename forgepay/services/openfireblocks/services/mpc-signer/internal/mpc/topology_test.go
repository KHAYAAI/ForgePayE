package mpc

import (
	"context"
	"strings"
	"testing"
)

func cl(t *testing.T) *Cluster {
	c := &Cluster{Threshold: 1, Nodes: []NodeInfo{
		{ID: "node1", Domain: "aws-a"}, {ID: "node2", Domain: "gcp-b"}, {ID: "node3", Domain: "onprem-c"},
	}}
	return c
}

func node(id, domain string, p Placement) TopologyNode {
	p.TrustDomain = domain
	return TopologyNode{ID: id, Domain: domain, Reachable: true, Placement: &p}
}

func codes(r *TopologyReport) string {
	var s []string
	for _, f := range r.Findings {
		s = append(s, f.Severity+":"+f.Code)
	}
	return strings.Join(s, ",")
}

func TestTopologyAcceptsASoundPlacement(t *testing.T) {
	r := CheckTopology(cl(t), []TopologyNode{
		node("node1", "aws-a", Placement{HostID: "h1", HostSource: "operator", InfraID: "acct-111", SealRef: "s1", SealKind: "awskms"}),
		node("node2", "gcp-b", Placement{HostID: "h2", HostSource: "operator", InfraID: "proj-222", SealRef: "s2", SealKind: "vault"}),
		node("node3", "onprem-c", Placement{HostID: "h3", HostSource: "operator", InfraID: "rack-9", SealRef: "s3", SealKind: "vault"}),
	}, true)
	if !r.OK || len(r.Findings) != 0 {
		t.Fatalf("a sound placement was rejected: %s", codes(r))
	}
}

func TestTopologyCatchesTheMistakesPeopleMake(t *testing.T) {
	r := CheckTopology(cl(t), []TopologyNode{
		node("node1", "aws-a", Placement{HostID: "SAME", HostSource: "machine-id", InfraID: "acct-111", SealRef: "kms-1", SealKind: "awskms"}),
		node("node2", "gcp-b", Placement{HostID: "SAME", HostSource: "machine-id", InfraID: "acct-111", SealRef: "kms-1", SealKind: "awskms"}),
		node("node3", "onprem-c", Placement{HostID: "h3", HostSource: "hostname", InfraID: "", SealRef: "", SealKind: "file"}),
	}, true)
	if r.OK {
		t.Fatal("a cluster with two nodes on one host passed")
	}
	got := codes(r)
	for _, want := range []string{"fail:shared_host", "fail:shared_seal_key", "fail:shared_infrastructure", "fail:no_infra_id", "fail:seal_key_beside_data", "warn:weak_host_identity"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in %s", want, got)
		}
	}
}

func TestTopologyDomainClaimsMustMatchTheClusterFile(t *testing.T) {
	bad := node("node2", "gcp-b", Placement{HostID: "h2", InfraID: "p", SealKind: "vault"})
	bad.Placement.TrustDomain = "aws-a" // node says it is in node1's domain
	r := CheckTopology(cl(t), []TopologyNode{bad}, false)
	if !strings.Contains(codes(r), "fail:domain_mismatch") {
		t.Fatalf("%s", codes(r))
	}
	// Two nodes in one domain that can reach quorum alone: the cluster file itself is wrong.
	one := &Cluster{Threshold: 1, Nodes: []NodeInfo{{ID: "a", Domain: "same"}, {ID: "b", Domain: "same"}, {ID: "c", Domain: "other"}}}
	if r := CheckTopology(one, nil, false); r.OK || !strings.Contains(codes(r), "domain_holds_quorum") {
		t.Fatalf("a domain holding a quorum passed: %s", codes(r))
	}
}

func TestTopologyUnreachableNodesAreNotSilentlyPassed(t *testing.T) {
	r := CheckTopology(cl(t), []TopologyNode{{ID: "node1", Domain: "aws-a"}}, false)
	if !strings.Contains(codes(r), "warn:unreachable") {
		t.Fatal(codes(r))
	}
}

func TestDescribePlacementPrefersTheOperatorsHostID(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	noFile := func(string) ([]byte, error) { return nil, context.Canceled }
	a := DescribePlacement("n1", "vault", "d", env(map[string]string{"MPC_NODE_HOST_ID": "ip-10-0-0-1", "MPC_NODE_INFRA_ID": "acct-1", "VAULT_ADDR": "https://v", "MPC_VAULT_KEY": "k1"}), noFile)
	b := DescribePlacement("n2", "vault", "d", env(map[string]string{"MPC_NODE_HOST_ID": "ip-10-0-0-2", "VAULT_ADDR": "https://v", "MPC_VAULT_KEY": "k2"}), noFile)
	if a.HostSource != "operator" || a.HostID == b.HostID || a.SealRef == b.SealRef || a.InfraID != "acct-1" {
		t.Fatalf("%+v %+v", a, b)
	}
	// The seal reference is a fingerprint, never the key name or address itself.
	if strings.Contains(a.SealRef, "k1") || strings.Contains(a.SealRef, "https") {
		t.Fatal("the placement leaks the seal-key reference")
	}
}

// Three real nodes in one test process are, truthfully, on one machine: the check must say so.
func TestTopologyOfRealNodesOnOneMachineIsReported(t *testing.T) {
	h := newHarness(t)
	rep := h.coord.Topology(context.Background(), false)
	if rep.OK {
		t.Fatalf("three nodes on one machine were reported as separate: %s", codes(rep))
	}
	if !strings.Contains(codes(rep), "fail:shared_host") {
		t.Fatalf("expected shared_host, got %s", codes(rep))
	}
}
