package mpc

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"regexp"

	"github.com/bnb-chain/tss-lib/v2/tss"
)

// NodeInfo is the public description of one signing node.
type NodeInfo struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	X25519Pub string `json:"x25519_pub"` // hex, 32 bytes — node-to-node message encryption
	// Domain names the trust domain the node runs in (host, cloud account, HSM
	// vendor...). Nodes that share a domain share fate, and the console says so.
	Domain string `json:"domain"`
}

// Cluster is the shared, public description of the signing group. It holds no
// secrets: every field is a public key, an address or a label.
type Cluster struct {
	// Threshold t: any t+1 nodes can sign, t nodes learn nothing.
	Threshold      int        `json:"threshold"`
	CoordinatorPub string     `json:"coordinator_pub"` // hex ed25519 — only this key may start sessions
	Nodes          []NodeInfo `json:"nodes"`
}

var idPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// ValidID reports whether s is acceptable as a node, key or session id.
func ValidID(s string) bool { return idPattern.MatchString(s) }

func LoadCluster(path string) (*Cluster, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Cluster
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("cluster file: %w", err)
	}
	return &c, c.Validate()
}

func (c *Cluster) Validate() error {
	n := len(c.Nodes)
	if n < 2 || c.Threshold < 1 || c.Threshold >= n {
		return fmt.Errorf("cluster needs n>=2 nodes and 1<=threshold<n (got n=%d, threshold=%d)", n, c.Threshold)
	}
	if b, err := hex.DecodeString(c.CoordinatorPub); err != nil || len(b) != ed25519.PublicKeySize {
		return fmt.Errorf("coordinator_pub must be a 32-byte hex ed25519 public key")
	}
	seen := map[string]bool{}
	for _, nd := range c.Nodes {
		if !ValidID(nd.ID) {
			return fmt.Errorf("invalid node id %q", nd.ID)
		}
		if seen[nd.ID] {
			return fmt.Errorf("duplicate node id %q", nd.ID)
		}
		seen[nd.ID] = true
		if b, err := hex.DecodeString(nd.X25519Pub); err != nil || len(b) != 32 {
			return fmt.Errorf("node %s: x25519_pub must be 32 bytes of hex", nd.ID)
		}
		if nd.URL == "" {
			return fmt.Errorf("node %s has no url", nd.ID)
		}
	}
	return nil
}

func (c *Cluster) Node(id string) (NodeInfo, bool) {
	for _, n := range c.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return NodeInfo{}, false
}

// TrustDomains returns how many distinct domains the nodes span.
func (c *Cluster) TrustDomains() int {
	d := map[string]bool{}
	for _, n := range c.Nodes {
		d[n.Domain] = true
	}
	return len(d)
}

// PartyID derives a node's tss party id deterministically from its name, so
// every process — and every later session — agrees on it without coordination.
func PartyID(nodeID string) *tss.PartyID {
	sum := sha256.Sum256([]byte("mpc-party|" + nodeID))
	return tss.NewPartyID(nodeID, nodeID, new(big.Int).SetBytes(sum[:]))
}

// SortedParties returns the sorted party ids for the given node ids.
func SortedParties(nodeIDs []string) tss.SortedPartyIDs {
	ids := make(tss.UnSortedPartyIDs, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		ids = append(ids, PartyID(id))
	}
	return tss.SortPartyIDs(ids)
}

func findParty(ids tss.SortedPartyIDs, nodeID string) *tss.PartyID {
	for _, p := range ids {
		if p.Moniker == nodeID {
			return p
		}
	}
	return nil
}
