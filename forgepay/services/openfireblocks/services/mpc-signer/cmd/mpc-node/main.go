// mpc-node is one member of the FORGE threshold-signing group.
//
//	mpc-node init            -id node1 -data DIR -url http://host:8101 -domain rack-a
//	mpc-node coordinator-key -out coordinator.key         (run once, on the coordinator's host)
//	mpc-node cluster         -threshold 1 -coordinator-pub HEX -out cluster.json id1.json id2.json id3.json
//	mpc-node serve           -id node1 -data DIR -cluster cluster.json -listen :8101
//	mpc-node verify-audit    -data DIR
//
// Each node runs on its own host with its own data directory; only the public
// identity files leave a node, and they are all `cluster` needs.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"forge-crypto/mpc-signer/internal/mpc"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "init":
		err = cmdInit(args)
	case "coordinator-key":
		err = cmdCoordinatorKey(args)
	case "cluster":
		err = cmdCluster(args)
	case "serve":
		err = cmdServe(args)
	case "verify-audit":
		err = cmdVerifyAudit(args)
	case "seal-migrate":
		err = cmdSealMigrate(args)
	case "seal-rewrap":
		err = cmdSealRewrap(args)
	case "preflight":
		err = cmdPreflight(args)
	case "seal-check":
		err = cmdSealCheck(args)
	case "pki-init":
		err = cmdPKIInit(args)
	case "pki-issue":
		err = cmdPKIIssue(args)
	default:
		usage()
	}
	if err != nil {
		log.Fatalf("mpc-node %s: %v", cmd, err)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: mpc-node <init|coordinator-key|cluster|serve|verify-audit|seal-migrate|seal-rewrap|preflight|seal-check|pki-init|pki-issue> [flags]")
	os.Exit(2)
}

func cmdInit(args []string) error {
	fs := flag.NewFlagSet("init", flag.ExitOnError)
	id := fs.String("id", "", "node id")
	data := fs.String("data", "", "data directory")
	url := fs.String("url", "", "URL other nodes reach this node at")
	domain := fs.String("domain", "unspecified", "trust domain label (host, cloud account, HSM...)")
	fs.Parse(args)
	if *id == "" || *data == "" || *url == "" {
		return fmt.Errorf("-id, -data and -url are required")
	}
	key, provider, err := mpc.LoadSealKey(context.Background(), *data, *id, true)
	if err != nil {
		return err
	}
	log.Printf("seal key provider: %s", provider)
	pub, err := mpc.InitIdentity(*data, *id, *url, *domain, key)
	if err != nil {
		return err
	}
	fmt.Printf("initialised node %s\npublic identity: %s/identity.json\n", pub.ID, *data)
	return nil
}

func cmdCoordinatorKey(args []string) error {
	fs := flag.NewFlagSet("coordinator-key", flag.ExitOnError)
	out := fs.String("out", "", "file to write the private key to")
	fs.Parse(args)
	if *out == "" {
		return fmt.Errorf("-out is required")
	}
	pub, err := mpc.NewCoordinatorKey(*out)
	if err != nil {
		return err
	}
	fmt.Printf("%x\n", []byte(pub))
	return nil
}

func cmdCluster(args []string) error {
	fs := flag.NewFlagSet("cluster", flag.ExitOnError)
	threshold := fs.Int("threshold", 0, "t: any t+1 nodes can sign")
	coordPub := fs.String("coordinator-pub", "", "coordinator public key (hex)")
	out := fs.String("out", "cluster.json", "output file")
	fs.Parse(args)
	c := mpc.Cluster{Threshold: *threshold, CoordinatorPub: *coordPub}
	for _, path := range fs.Args() {
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var id mpc.PublicIdentity
		if err := json.Unmarshal(raw, &id); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		c.Nodes = append(c.Nodes, mpc.NodeInfo{ID: id.ID, URL: id.URL, X25519Pub: id.X25519Pub, Domain: id.Domain})
	}
	if err := c.Validate(); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(*out, raw, 0o644)
}

func cmdServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	id := fs.String("id", "", "node id")
	data := fs.String("data", "", "data directory")
	clusterFile := fs.String("cluster", "", "cluster file")
	listen := fs.String("listen", ":8101", "listen address")
	policyFile := fs.String("policy", os.Getenv("MPC_NODE_POLICY_FILE"), "this node's own signing policy (JSON); reloaded when edited")
	fs.Parse(args)
	if *id == "" || *data == "" || *clusterFile == "" {
		return fmt.Errorf("-id, -data and -cluster are required")
	}
	clusters, err := mpc.WatchCluster(*clusterFile)
	if err != nil {
		return err
	}
	cluster := clusters.Get()
	tlsFiles, err := mpc.TLSFromEnv()
	if err != nil {
		return err
	}
	key, provider, err := mpc.LoadSealKey(context.Background(), *data, *id, false)
	if err != nil {
		return err
	}
	log.Printf("seal key provider: %s", provider)
	cfg := mpc.NodeConfig{DataDir: *data, ID: *id, Clusters: clusters, SealKey: key, SealProvider: provider, PolicyFile: *policyFile, TLS: tlsFiles}
	if v := os.Getenv("MPC_NODE_MAX_VALUE_WEI"); v != "" {
		wei, ok := new(big.Int).SetString(v, 10)
		if !ok {
			return fmt.Errorf("MPC_NODE_MAX_VALUE_WEI must be a base-10 integer")
		}
		cfg.MaxValueWei = wei
		log.Printf("this node refuses transfers above %s wei, whatever the coordinator asks", v)
	}
	node, err := mpc.NewNode(cfg)
	if err != nil {
		return err
	}
	log.Printf("mpc-node %s listening on %s (%d nodes, threshold %d, %d trust domain(s))",
		*id, *listen, len(cluster.Nodes), cluster.Threshold, cluster.TrustDomains())
	if exposed := cluster.ExposedDomains(cluster.AllNodeIDs(), cluster.Threshold); len(exposed) > 0 {
		log.Printf("WARNING: trust domain %q holds enough nodes to sign on its own", exposed[0])
	}
	if sum := node.Policy().Summary(); len(sum.Active) > 0 {
		log.Printf("node policy %s in force: %v", sum.Digest, sum.Active)
	} else {
		log.Printf("no node policy: this node will co-sign anything the coordinator asks, within the key's committee")
	}
	srv := &http.Server{Addr: *listen, Handler: node.Handler(), ReadHeaderTimeout: 10 * time.Second}
	if tlsFiles != nil {
		srv.TLSConfig = tlsFiles.ServerConfig()
		log.Printf("mutual TLS required from every caller")
		return srv.ListenAndServeTLS("", "")
	}
	log.Printf("WARNING: serving plain HTTP; set MPC_TLS_CA_FILE, MPC_TLS_CERT_FILE and MPC_TLS_KEY_FILE for mutual TLS")
	return srv.ListenAndServe()
}

func cmdVerifyAudit(args []string) error {
	fs := flag.NewFlagSet("verify-audit", flag.ExitOnError)
	data := fs.String("data", "", "data directory")
	fs.Parse(args)
	n, err := mpc.VerifyAuditChain(*data + "/audit.log")
	if err != nil {
		return err
	}
	fmt.Printf("audit chain intact: %d entries\n", n)
	return nil
}

func cmdSealMigrate(args []string) error {
	fs := flag.NewFlagSet("seal-migrate", flag.ExitOnError)
	id := fs.String("id", "", "node id")
	data := fs.String("data", "", "data directory (node must be stopped)")
	fromName := fs.String("from", "", "current provider: file, env, vault, awskms")
	toName := fs.String("to", "", "new provider: file, vault, awskms")
	fs.Parse(args)
	if *id == "" || *data == "" || *fromName == "" || *toName == "" {
		return fmt.Errorf("-id, -data, -from and -to are required")
	}
	from, err := mpc.NewSealKeyProvider(*fromName)
	if err != nil {
		return err
	}
	to, err := mpc.NewSealKeyProvider(*toName)
	if err != nil {
		return err
	}
	n, err := mpc.MigrateSealKey(context.Background(), *data, *id, from, to)
	if err != nil {
		return err
	}
	fmt.Printf("re-encrypted %d file(s); the seal key is now held by %s\n", n, *toName)
	return nil
}

func cmdSealRewrap(args []string) error {
	fs := flag.NewFlagSet("seal-rewrap", flag.ExitOnError)
	id := fs.String("id", "", "node id")
	data := fs.String("data", "", "data directory")
	fs.Parse(args)
	if *id == "" || *data == "" {
		return fmt.Errorf("-id and -data are required")
	}
	if err := mpc.RewrapVault(context.Background(), *data, *id); err != nil {
		return err
	}
	fmt.Println("seal key re-wrapped under the current Vault transit key version")
	return nil
}

func cmdPKIInit(args []string) error {
	fs := flag.NewFlagSet("pki-init", flag.ExitOnError)
	dir := fs.String("dir", "", "directory for ca.pem and ca.key")
	name := fs.String("name", "FORGE MPC CA", "CA name")
	years := fs.Int("years", 5, "validity")
	fs.Parse(args)
	if *dir == "" {
		return fmt.Errorf("-dir is required")
	}
	if err := mpc.PKIInit(*dir, *name, time.Duration(*years)*365*24*time.Hour); err != nil {
		return err
	}
	fmt.Printf("created CA in %s (keep ca.key with the cluster's operators; nodes only need ca.pem)\n", *dir)
	return nil
}

func cmdPKIIssue(args []string) error {
	fs := flag.NewFlagSet("pki-issue", flag.ExitOnError)
	ca := fs.String("ca", "", "CA directory")
	name := fs.String("name", "", "node id, or 'coordinator'")
	hosts := fs.String("hosts", "", "comma-separated DNS names / IPs this certificate is valid for")
	out := fs.String("out", "", "output directory (cert.pem, key.pem, ca.pem)")
	days := fs.Int("days", 90, "validity in days")
	fs.Parse(args)
	if *ca == "" || *name == "" || *out == "" {
		return fmt.Errorf("-ca, -name and -out are required")
	}
	var hs []string
	for _, h := range strings.Split(*hosts, ",") {
		if h = strings.TrimSpace(h); h != "" {
			hs = append(hs, h)
		}
	}
	if err := mpc.PKIIssue(*ca, *name, hs, *out, time.Duration(*days)*24*time.Hour); err != nil {
		return err
	}
	fmt.Printf("issued certificate for %s in %s\n", *name, *out)
	return nil
}

func cmdPreflight(args []string) error {
	fs := flag.NewFlagSet("preflight", flag.ExitOnError)
	id := fs.String("id", "", "node id")
	data := fs.String("data", "", "data directory")
	clusterFile := fs.String("cluster", "", "cluster file")
	policyFile := fs.String("policy", os.Getenv("MPC_NODE_POLICY_FILE"), "node policy file")
	fs.Parse(args)
	if *id == "" || *data == "" || *clusterFile == "" {
		return fmt.Errorf("-id, -data and -cluster are required")
	}
	failed := 0
	for _, c := range mpc.Preflight(context.Background(), *data, *id, *clusterFile, *policyFile) {
		mark := "ok   "
		switch {
		case !c.OK:
			mark, failed = "FAIL ", failed+1
		case c.Warn:
			mark = "warn "
		}
		fmt.Printf("%s %-28s %s\n", mark, c.Name, c.Detail)
	}
	if failed > 0 {
		return fmt.Errorf("%d check(s) failed: this node is not ready for production", failed)
	}
	fmt.Println("ready")
	return nil
}

func cmdSealCheck(args []string) error {
	fs := flag.NewFlagSet("seal-check", flag.ExitOnError)
	provider := fs.String("provider", os.Getenv("MPC_SEAL_PROVIDER"), "vault or awskms")
	fs.Parse(args)
	if *provider != "vault" && *provider != "awskms" {
		return fmt.Errorf("-provider must be vault or awskms (or set MPC_SEAL_PROVIDER)")
	}
	failed := 0
	for _, c := range mpc.CheckSealProvider(context.Background(), *provider) {
		mark := "ok   "
		if !c.OK {
			mark, failed = "FAIL ", failed+1
		}
		fmt.Printf("%s %-50s %s\n", mark, c.Name, c.Detail)
	}
	if failed > 0 {
		return fmt.Errorf("%d check(s) failed", failed)
	}
	fmt.Println("all checks passed (nothing was left behind)")
	return nil
}
