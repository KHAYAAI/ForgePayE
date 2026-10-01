package mpc

import (
	"context"
	"crypto/ecdh"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

// BackupFromEnv builds a BackupConfig from MPC_BACKUP_* variables, or returns nil if none are set.
//
//	MPC_BACKUP_RECIPIENTS   comma-separated fprec1:… public recovery keys (required)
//	MPC_BACKUP_DIR          directory sink, or
//	MPC_BACKUP_S3_BUCKET    S3 sink (+ MPC_BACKUP_S3_PREFIX, MPC_BACKUP_S3_KMS_KEY)
//	MPC_BACKUP_INTERVAL     refresh period, e.g. 6h
func BackupFromEnv(ctx context.Context, clusterFile string) (*BackupConfig, error) {
	rec, dir, bucket := os.Getenv("MPC_BACKUP_RECIPIENTS"), os.Getenv("MPC_BACKUP_DIR"), os.Getenv("MPC_BACKUP_S3_BUCKET")
	if rec == "" && dir == "" && bucket == "" {
		return nil, nil
	}
	if rec == "" {
		return nil, errors.New("MPC_BACKUP_RECIPIENTS is required to back up (the public recovery key; never put the private key on a node)")
	}
	var recipients []*ecdh.PublicKey
	for _, r := range strings.Split(rec, ",") {
		pub, err := ParseRecipient(strings.TrimSpace(r))
		if err != nil {
			return nil, err
		}
		recipients = append(recipients, pub)
	}
	cfg := &BackupConfig{Recipients: recipients, ClusterFile: clusterFile}
	switch {
	case bucket != "" && dir != "":
		return nil, errors.New("set MPC_BACKUP_DIR or MPC_BACKUP_S3_BUCKET, not both")
	case bucket != "":
		s, err := NewS3Sink(ctx, bucket, os.Getenv("MPC_BACKUP_S3_PREFIX"), os.Getenv("MPC_BACKUP_S3_KMS_KEY"))
		if err != nil {
			return nil, err
		}
		cfg.Sink = s
	case dir != "":
		cfg.Sink = DirSink{Dir: dir}
	default:
		return nil, errors.New("set MPC_BACKUP_DIR or MPC_BACKUP_S3_BUCKET")
	}
	if v := os.Getenv("MPC_BACKUP_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d < time.Minute {
			return nil, fmt.Errorf("MPC_BACKUP_INTERVAL %q is not a duration of at least 1m", v)
		}
		cfg.Interval = d
	}
	return cfg, nil
}
