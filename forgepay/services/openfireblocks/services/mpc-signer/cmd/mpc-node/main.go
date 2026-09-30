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
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
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
	default:
		usage()
	}
	if err != nil {
		log.Fatalf("mpc-node %s: %v", cmd, err)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: mpc-node <init|coordinator-key|cluster|serve|verify-audit> [flags]")
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
	key, err := mpc.LoadSealKey(*data)
	if err != nil {
		return err
	}
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
	fs.Parse(args)
	if *id == "" || *data == "" || *clusterFile == "" {
		return fmt.Errorf("-id, -data and -cluster are required")
	}
	cluster, err := mpc.LoadCluster(*clusterFile)
	if err != nil {
		return err
	}
	key, err := mpc.LoadSealKey(*data)
	if err != nil {
		return err
	}
	cfg := mpc.NodeConfig{DataDir: *data, ID: *id, Cluster: cluster, SealKey: key}
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
	srv := &http.Server{Addr: *listen, Handler: node.Handler(), ReadHeaderTimeout: 10 * time.Second}
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
