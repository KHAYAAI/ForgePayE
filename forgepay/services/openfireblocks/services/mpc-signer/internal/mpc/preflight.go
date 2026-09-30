package mpc

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"time"
)

// Check is one line of a preflight report.
type Check struct {
	Name   string
	OK     bool
	Warn   bool // a problem worth fixing that doesn't stop production
	Detail string
}

// Preflight examines a node's configuration the way production start-up would,
// plus a few things start-up doesn't insist on, and says what is wrong before
// the node is run. Nothing here changes any state.
func Preflight(ctx context.Context, dataDir, nodeID, clusterFile, policyFile string) []Check {
	var out []Check
	add := func(name string, ok bool, detail string) {
		out = append(out, Check{Name: name, OK: ok, Detail: detail})
	}
	warn := func(name, detail string) { out = append(out, Check{Name: name, OK: true, Warn: true, Detail: detail}) }

	if Production() {
		add("MPC_ENV=production", true, "production rules are on")
	} else {
		add("MPC_ENV=production", false, "not set: the checks below are advisory, and the node will accept development shortcuts")
	}

	// Cluster and topology.
	cluster, err := LoadCluster(clusterFile)
	if err != nil {
		add("cluster file", false, err.Error())
	} else {
		add("cluster file", true, fmt.Sprintf("%d nodes, threshold %d (any %d sign)", len(cluster.Nodes), cluster.Threshold, cluster.Threshold+1))
		if _, ok := cluster.Node(nodeID); !ok {
			add("this node is in the cluster", false, nodeID+" is not listed")
		}
		if err := cluster.CheckTransport(cluster.AllNodeIDs()); err != nil {
			add("node URLs", false, err.Error())
		} else {
			add("node URLs", true, "all https")
		}
		if err := cluster.CheckDomains(cluster.AllNodeIDs(), cluster.Threshold); err != nil {
			add("trust domains", false, err.Error())
		} else {
			add("trust domains", true, fmt.Sprintf("%d domains; none holds enough nodes to sign alone", cluster.TrustDomains()))
		}
	}

	// Seal key.
	if name, err := ProviderName(); err != nil {
		add("seal key provider", false, err.Error())
	} else if p, err := NewSealKeyProvider(name); err != nil {
		add("seal key provider", false, err.Error())
	} else if _, err := p.Load(ctx, dataDir, nodeID, false); err != nil {
		add("seal key provider", false, fmt.Sprintf("%s: cannot unwrap the key: %v", name, err))
	} else if name == ProviderVault || name == ProviderAWSKMS {
		add("seal key provider", true, name+": the key is unwrapped from the key service, not read from disk")
	} else {
		add("seal key provider", false, name+": the seal key sits with the data; production needs vault or awskms")
	}

	// Mutual TLS.
	if t, err := TLSFromEnv(); err != nil {
		add("mutual TLS", false, err.Error())
	} else if t == nil {
		add("mutual TLS", false, "no MPC_TLS_* files: traffic would be plain HTTP")
	} else if name, notAfter, err := CertInfo(t.CertFile); err != nil {
		add("mutual TLS", false, err.Error())
	} else {
		left := time.Until(notAfter)
		switch {
		case name != nodeID && name != coordinatorCertName:
			add("mutual TLS", false, fmt.Sprintf("certificate is for %q, expected %q", name, nodeID))
		case left < 0:
			add("mutual TLS", false, "certificate has expired")
		case left < 14*24*time.Hour:
			warn("mutual TLS", fmt.Sprintf("certificate for %s expires in %s; renew it", name, left.Round(time.Hour)))
		default:
			add("mutual TLS", true, fmt.Sprintf("certificate for %s valid for %d more days", name, int(left.Hours()/24)))
		}
	}

	// Node policy.
	if policyFile == "" {
		warn("node policy", "none: this node will co-sign anything the coordinator asks. Set MPC_NODE_POLICY_FILE")
	} else if p, err := OpenPolicy(policyFile, ""); err != nil {
		add("node policy", false, err.Error())
	} else if sum := p.Summary(); len(sum.Active) == 0 {
		warn("node policy", "the file sets no rules")
	} else {
		add("node policy", true, fmt.Sprintf("%v (digest %s)", sum.Active, sum.Digest))
	}

	// Data directory permissions.
	if fi, err := os.Stat(dataDir); err != nil {
		add("data directory", false, err.Error())
	} else if fi.Mode().Perm()&0o077 != 0 {
		add("data directory", false, fmt.Sprintf("%s is %o; other users can read the sealed files", dataDir, fi.Mode().Perm()))
	} else {
		add("data directory", true, fmt.Sprintf("%s is %o", dataDir, fi.Mode().Perm()))
	}
	if exists(dataDir + "/seal.key") {
		add("no seal key on disk", false, dataDir+"/seal.key exists")
	}
	return out
}

// CertInfo returns a certificate's common name and expiry.
func CertInfo(certFile string) (string, time.Time, error) {
	raw, err := os.ReadFile(certFile)
	if err != nil {
		return "", time.Time{}, err
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return "", time.Time{}, fmt.Errorf("%s holds no certificate", certFile)
	}
	c, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", time.Time{}, err
	}
	return c.Subject.CommonName, c.NotAfter, nil
}
