package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"forge-crypto/mpc-signer/internal/mpc"
)

// topology asks every node where it says it runs and checks the answers against each other and the cluster file:
// distinct hosts, distinct seal keys, distinct infrastructure per trust domain, no domain holding a quorum.
// Run it after every deployment or move, and put the output in the change record. Exit status 1 on any failure.
func cmdTopology(args []string) error {
	fs := flag.NewFlagSet("topology", flag.ExitOnError)
	clusterFile := fs.String("cluster", os.Getenv("MPC_CLUSTER_FILE"), "cluster file")
	coordKey := fs.String("coordinator-key", os.Getenv("MPC_COORDINATOR_KEY_FILE"), "coordinator key file (nodes require it only for writes; health is read with mutual TLS)")
	production := fs.Bool("production", mpc.Production(), "apply production rules (infrastructure declared, no file/env seal keys)")
	fs.Parse(args)
	if *clusterFile == "" || *coordKey == "" {
		return fmt.Errorf("-cluster and -coordinator-key are required")
	}
	clusters, err := mpc.WatchCluster(*clusterFile)
	if err != nil {
		return err
	}
	key, err := mpc.LoadCoordinatorKey(*coordKey)
	if err != nil {
		return err
	}
	tlsFiles, err := mpc.TLSFromEnv()
	if err != nil {
		return err
	}
	coord, err := mpc.NewCoordinatorWith(clusters, key, tlsFiles)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	rep := coord.Topology(ctx, *production)
	for _, n := range rep.Nodes {
		if n.Placement == nil {
			fmt.Printf("%-8s %-14s UNREACHABLE\n", n.ID, n.Domain)
			continue
		}
		p := n.Placement
		fmt.Printf("%-8s %-14s host %s (%s)  infra %-24s seal %s %s\n", n.ID, n.Domain, p.HostID, p.HostSource, orDash(p.InfraID), p.SealKind, orDash(p.SealRef))
	}
	fmt.Println()
	for _, f := range rep.Findings {
		fmt.Printf("%-4s %-24s %s\n", f.Severity, f.Code, f.Detail)
	}
	if !rep.OK {
		return fmt.Errorf("topology check FAILED: the nodes are not as separate as the key's security assumes")
	}
	fmt.Println("topology check passed: no node shares a host, seal key or infrastructure with another trust domain, as far as the nodes report (a node can misreport itself; this catches mistakes, not lies)")
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
