package mpc

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

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
// This is the epoch-0 identity used by key generation.
func PartyID(nodeID string) *tss.PartyID { return PartyIDAt(nodeID, 0, "") }

// PartyIDAt is a node's party id for a given key epoch and role.
//
// A key's shares are only valid together with the party keys they were made
// for, and a reshare must run two parties on a node that is in both the old and
// the new committee. tss-lib tells the two roles apart by party *key*, so each
// epoch gets its own key: epoch 0 keeps the original derivation, later epochs
// mix the epoch in. role ("old"/"new") only labels the moniker used to route
// messages inside a reshare session; it does not change the key.
func PartyIDAt(nodeID string, epoch int, role string) *tss.PartyID {
	label := "mpc-party|" + nodeID
	if epoch > 0 {
		label = fmt.Sprintf("mpc-party|%s|e%d", nodeID, epoch)
	}
	sum := sha256.Sum256([]byte(label))
	moniker := nodeID
	if role != "" {
		moniker = nodeID + "@" + role
	}
	return tss.NewPartyID(moniker, moniker, new(big.Int).SetBytes(sum[:]))
}

// SortedParties returns the sorted party ids for the given node ids (epoch 0).
func SortedParties(nodeIDs []string) tss.SortedPartyIDs { return SortedPartiesAt(nodeIDs, 0, "") }

// SortedPartiesAt returns sorted party ids for the given nodes at an epoch.
func SortedPartiesAt(nodeIDs []string, epoch int, role string) tss.SortedPartyIDs {
	ids := make(tss.UnSortedPartyIDs, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		ids = append(ids, PartyIDAt(id, epoch, role))
	}
	return tss.SortPartyIDs(ids)
}

func findParty(ids tss.SortedPartyIDs, moniker string) *tss.PartyID {
	for _, p := range ids {
		if p.Moniker == moniker {
			return p
		}
	}
	return nil
}

// nodeOf returns the node a party moniker belongs to ("node1@old" -> "node1").
func nodeOf(moniker string) string {
	if i := strings.IndexByte(moniker, '@'); i >= 0 {
		return moniker[:i]
	}
	return moniker
}

// ExposedDomains returns the trust domains that, on their own, hold enough of
// the given nodes to sign for a key of threshold t (t+1 or more). Anyone who
// controls such a domain controls the key, so splitting it protects nothing
// against them. An empty result means no single domain can sign alone.
//
// Domain labels are declared by whoever builds the cluster file; nothing here
// can prove a label is true. What this does is refuse a topology that is
// visibly one place.
func (c *Cluster) ExposedDomains(nodeIDs []string, t int) []string {
	count := map[string]int{}
	for _, id := range nodeIDs {
		if n, ok := c.Node(id); ok {
			count[n.Domain]++
		}
	}
	var out []string
	for d, n := range count {
		if n >= t+1 {
			out = append(out, d)
		}
	}
	sortStrings(out)
	return out
}

// AllNodeIDs lists every node in the cluster.
func (c *Cluster) AllNodeIDs() []string {
	ids := make([]string, len(c.Nodes))
	for i, n := range c.Nodes {
		ids[i] = n.ID
	}
	return ids
}

// CheckTransport requires every listed node to be reached over https.
func (c *Cluster) CheckTransport(nodeIDs []string) error {
	for _, id := range nodeIDs {
		if n, ok := c.Node(id); ok && !strings.HasPrefix(n.URL, "https://") {
			return fmt.Errorf("node %s is reached over %q; production requires https", id, n.URL)
		}
	}
	return nil
}

// CheckDomains requires that no single trust domain hold enough of the listed
// nodes to sign alone.
func (c *Cluster) CheckDomains(nodeIDs []string, t int) error {
	if exposed := c.ExposedDomains(nodeIDs, t); len(exposed) > 0 {
		return fmt.Errorf("trust domain %q holds %d or more of these nodes, enough to sign on its own; a %d-of-%d key needs its nodes spread so that no one domain holds more than %d",
			exposed[0], t+1, t+1, len(nodeIDs), t)
	}
	return nil
}

// CheckProduction enforces what production requires of a topology: every node
// reached over https, and no single trust domain able to sign alone.
func (c *Cluster) CheckProduction(nodeIDs []string, t int) error {
	if err := c.CheckTransport(nodeIDs); err != nil {
		return err
	}
	return c.CheckDomains(nodeIDs, t)
}

// ---- hot-reloadable cluster file --------------------------------------------

// ClusterSource serves the current cluster description, reloading the file when
// it changes so a node can be added or moved without restarting the others.
// A reload that fails to parse, or that changes the coordinator key, is ignored
// and the previous description stays in force.
type ClusterSource struct {
	path string
	mu   sync.Mutex
	cur  *Cluster
	mod  time.Time
	last time.Time
}

// StaticCluster wraps a fixed cluster (tests, and callers with no file).
func StaticCluster(c *Cluster) *ClusterSource { return &ClusterSource{cur: c} }

// WatchCluster loads path now and reloads it when it changes.
func WatchCluster(path string) (*ClusterSource, error) {
	c, err := LoadCluster(path)
	if err != nil {
		return nil, err
	}
	fi, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	return &ClusterSource{path: path, cur: c, mod: fi.ModTime()}, nil
}

// Get returns the current cluster.
func (s *ClusterSource) Get() *Cluster {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path == "" || time.Since(s.last) < time.Second {
		return s.cur
	}
	s.last = time.Now()
	fi, err := os.Stat(s.path)
	if err != nil || fi.ModTime().Equal(s.mod) {
		return s.cur
	}
	next, err := LoadCluster(s.path)
	if err != nil {
		log.Printf("mpc: ignoring invalid cluster file, keeping the previous one: %v", err)
		s.mod = fi.ModTime()
		return s.cur
	}
	if next.CoordinatorPub != s.cur.CoordinatorPub {
		log.Printf("mpc: ignoring cluster file that changes the coordinator key; that needs a restart")
		s.mod = fi.ModTime()
		return s.cur
	}
	for _, old := range s.cur.Nodes {
		if n, ok := next.Node(old.ID); ok && n.X25519Pub != old.X25519Pub {
			log.Printf("mpc: ignoring cluster file that changes node %s's identity key", old.ID)
			s.mod = fi.ModTime()
			return s.cur
		}
	}
	log.Printf("mpc: cluster file reloaded (%d nodes)", len(next.Nodes))
	s.cur, s.mod = next, fi.ModTime()
	return s.cur
}
