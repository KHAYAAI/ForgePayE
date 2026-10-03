package mpc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"strings"
)

// "Nodes on separate hosts" is the whole point of splitting a key, and it is the easiest property to lose without
// noticing: two nodes land on one machine, share one cloud account or one KMS key, and the key is protected by
// less than everyone believes. Each node reports who it is, as identity facts and never secrets, and the coordinator
// checks them against each other and against the cluster file. It cannot prove separation (a node can lie about itself)
// but it catches the mistakes people actually make, and it makes a lie a deliberate act.

// Placement is what a node says about where it runs. All of it is a fingerprint or a label: no secret.
type Placement struct {
	HostID      string `json:"hostId"`      // fingerprint of the machine identity
	HostSource  string `json:"hostSource"`  // where that identity came from: operator | machine-id | hostname
	InfraID     string `json:"infraId"`     // operator-declared account/project/rack label (MPC_NODE_INFRA_ID)
	SealRef     string `json:"sealRef"`     // fingerprint of the seal-key reference (KMS key id / Vault key name)
	SealKind    string `json:"sealKind"`    // file | env | vault | awskms
	TrustDomain string `json:"trustDomain"` // the node's own idea of its domain
}

func fp(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(h[:6])
}

// DescribePlacement reads this process's own placement. nodeID, sealKind and domain are the node's configuration.
func DescribePlacement(nodeID, sealKind, domain string, getenv func(string) string, readFile func(string) ([]byte, error)) Placement {
	p := Placement{InfraID: getenv("MPC_NODE_INFRA_ID"), SealKind: sealKind, TrustDomain: domain}
	switch {
	case getenv("MPC_NODE_HOST_ID") != "":
		// Injected by the operator: the Kubernetes node name (downward API spec.nodeName), the instance id, etc.
		p.HostID, p.HostSource = fp("operator", getenv("MPC_NODE_HOST_ID")), "operator"
	default:
		if b, err := readFile("/etc/machine-id"); err == nil && len(strings.TrimSpace(string(b))) > 0 {
			p.HostID, p.HostSource = fp("machine-id", strings.TrimSpace(string(b))), "machine-id"
		} else if h, err := os.Hostname(); err == nil {
			p.HostID, p.HostSource = fp("hostname", h), "hostname"
		}
	}
	ref := ""
	switch sealKind {
	case ProviderAWSKMS:
		ref = getenv("MPC_KMS_KEY_ID")
	case ProviderVault:
		ref = getenv("VAULT_ADDR") + "/" + getenv("MPC_VAULT_KEY")
	}
	if ref != "" {
		p.SealRef = fp("seal", sealKind, ref)
	}
	return p
}

// TopologyFinding is one problem (or caution) in a cluster's placement.
type TopologyFinding struct {
	Severity string   `json:"severity"` // fail | warn
	Code     string   `json:"code"`
	Nodes    []string `json:"nodes,omitempty"`
	Detail   string   `json:"detail"`
}

type TopologyReport struct {
	Nodes    []TopologyNode    `json:"nodes"`
	Findings []TopologyFinding `json:"findings"`
	OK       bool              `json:"ok"` // no "fail" findings
}

type TopologyNode struct {
	ID        string     `json:"id"`
	Domain    string     `json:"domain"`
	Reachable bool       `json:"reachable"`
	Placement *Placement `json:"placement,omitempty"`
}

// CheckTopology compares what the nodes say about themselves. `production` raises the bar.
func CheckTopology(c *Cluster, nodes []TopologyNode, production bool) *TopologyReport {
	r := &TopologyReport{Nodes: nodes, OK: true}
	add := func(sev, code, detail string, ids ...string) {
		sort.Strings(ids)
		r.Findings = append(r.Findings, TopologyFinding{Severity: sev, Code: code, Nodes: ids, Detail: detail})
		if sev == "fail" {
			r.OK = false
		}
	}
	// The trust-domain rule from the cluster file itself.
	if ex := c.ExposedDomains(c.AllNodeIDs(), c.Threshold); len(ex) > 0 {
		add("fail", "domain_holds_quorum", fmt.Sprintf("trust domain %q holds %d or more nodes: whoever controls it can sign alone", ex[0], c.Threshold+1))
	}
	seenHost, seenSeal := map[string][]string{}, map[string][]string{}
	byInfra := map[string]map[string][]string{} // infraId -> domain -> nodes
	for _, n := range nodes {
		if !n.Reachable || n.Placement == nil {
			add("warn", "unreachable", fmt.Sprintf("%s did not report its placement, so it was not checked", n.ID), n.ID)
			continue
		}
		p := n.Placement
		if p.TrustDomain != "" && p.TrustDomain != n.Domain {
			add("fail", "domain_mismatch", fmt.Sprintf("%s says its trust domain is %q but the cluster file says %q", n.ID, p.TrustDomain, n.Domain), n.ID)
		}
		if p.HostID != "" {
			seenHost[p.HostID] = append(seenHost[p.HostID], n.ID)
		}
		if p.SealRef != "" {
			seenSeal[p.SealRef] = append(seenSeal[p.SealRef], n.ID)
		}
		if p.InfraID == "" {
			sev := "warn"
			if production {
				sev = "fail"
			}
			add(sev, "no_infra_id", fmt.Sprintf("%s declares no MPC_NODE_INFRA_ID (the account/project/rack it runs in), so separation of infrastructure cannot be checked", n.ID), n.ID)
		} else {
			if byInfra[p.InfraID] == nil {
				byInfra[p.InfraID] = map[string][]string{}
			}
			byInfra[p.InfraID][n.Domain] = append(byInfra[p.InfraID][n.Domain], n.ID)
		}
		if p.HostSource == "hostname" {
			add("warn", "weak_host_identity", fmt.Sprintf("%s identifies its host only by hostname, which is unique per container even on the same machine; set MPC_NODE_HOST_ID (e.g. the Kubernetes node name)", n.ID), n.ID)
		}
		if production && (p.SealKind == ProviderFile || p.SealKind == ProviderEnv) {
			add("fail", "seal_key_beside_data", fmt.Sprintf("%s keeps its seal key in %q, beside the shares it protects", n.ID, p.SealKind), n.ID)
		}
	}
	for _, ids := range seenHost {
		if len(ids) > 1 {
			add("fail", "shared_host", fmt.Sprintf("%s report the same host: one machine compromise exposes all of them", strings.Join(sortedCopy(ids), ", ")), ids...)
		}
	}
	for _, ids := range seenSeal {
		if len(ids) > 1 {
			add("fail", "shared_seal_key", fmt.Sprintf("%s use the same seal-key reference: whoever can use that key can open all of their shares", strings.Join(sortedCopy(ids), ", ")), ids...)
		}
	}
	for infra, domains := range byInfra {
		if len(domains) > 1 {
			var ids []string
			for _, d := range domains {
				ids = append(ids, d...)
			}
			add("fail", "shared_infrastructure", fmt.Sprintf("nodes in different trust domains declare the same infrastructure %q: the domains are not independent", infra), ids...)
		}
	}
	sort.Slice(r.Findings, func(i, j int) bool { return r.Findings[i].Code < r.Findings[j].Code })
	return r
}

func sortedCopy(in []string) []string {
	out := append([]string{}, in...)
	sort.Strings(out)
	return out
}

// Topology asks every node for its placement and checks them against each other.
func (c *Coordinator) Topology(ctx context.Context, production bool) *TopologyReport {
	health := c.Health(ctx)
	nodes := make([]TopologyNode, len(health))
	for i, h := range health {
		nodes[i] = TopologyNode{ID: h.ID, Domain: h.Domain, Reachable: h.Reachable, Placement: h.Placement}
	}
	return CheckTopology(c.cl(), nodes, production)
}
