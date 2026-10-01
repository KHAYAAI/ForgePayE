package mpc

import (
	"context"
	"crypto/ecdh"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"
)

// BackupConfig turns on encrypted key-share backups for a node.
type BackupConfig struct {
	Sink        BackupSink
	Recipients  []*ecdh.PublicKey // the recovery key(s) backups are encrypted to; never a private key
	ClusterFile string            // included in the backup so a rebuilt node knows its cluster
	Interval    time.Duration     // periodic refresh; default 6h
	MaxAge      time.Duration     // health reports "stale" past this; default 2*Interval
}

// BackupStatus is what a node reports about its own backups.
type BackupStatus struct {
	Enabled    bool           `json:"enabled"`
	Sink       string         `json:"sink,omitempty"`
	Recipients []string       `json:"recipients,omitempty"` // fingerprints only
	LastOK     *time.Time     `json:"lastOk,omitempty"`
	LastName   string         `json:"lastName,omitempty"`
	LastError  string         `json:"lastError,omitempty"`
	Epochs     map[string]int `json:"epochs,omitempty"`
	Covers     bool           `json:"coversCurrentShares"` // the newest backup holds every share now on disk, at its current epoch
	Stale      bool           `json:"stale"`
	Pruned     int            `json:"prunedTotal"`
}

type backupService struct {
	n   *Node
	cfg BackupConfig

	mu     sync.Mutex
	status BackupStatus
	timer  *time.Timer
	run    sync.Mutex // one backup at a time
}

// EnableBackups starts backing this node's shares up. It backs up once now, again shortly
// after every key change, and on a timer. A node cannot be left silently unbacked-up:
// failures show in /health and the first backup's failure is returned.
func (n *Node) EnableBackups(cfg BackupConfig) error {
	if cfg.Sink == nil || len(cfg.Recipients) == 0 {
		return errors.New("backups need a sink and at least one recovery recipient")
	}
	if cfg.Interval == 0 {
		cfg.Interval = 6 * time.Hour
	}
	if cfg.MaxAge == 0 {
		cfg.MaxAge = 2 * cfg.Interval
	}
	s := &backupService{n: n, cfg: cfg}
	s.status.Enabled, s.status.Sink = true, cfg.Sink.Name()
	for _, r := range cfg.Recipients {
		s.status.Recipients = append(s.status.Recipients, RecipientFingerprint(r))
	}
	n.backups = s
	if _, err := s.backupNow(context.Background()); err != nil {
		return fmt.Errorf("first backup failed: %w", err)
	}
	go func() {
		for range time.Tick(cfg.Interval) {
			if _, err := s.backupNow(context.Background()); err != nil {
				log.Printf("backup: %v", err)
			}
		}
	}()
	return nil
}

// BackupNow takes a backup immediately and returns its name.
func (n *Node) BackupNow(ctx context.Context) (string, error) {
	if n.backups == nil {
		return "", errors.New("backups are not enabled on this node")
	}
	return n.backups.backupNow(ctx)
}

// backupSoon schedules a backup shortly after a key change; bursts collapse into one.
func (n *Node) backupSoon() {
	s := n.backups
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.timer != nil {
		s.timer.Reset(2 * time.Second)
		return
	}
	s.timer = time.AfterFunc(2*time.Second, func() {
		s.mu.Lock()
		s.timer = nil
		s.mu.Unlock()
		if _, err := s.backupNow(context.Background()); err != nil {
			log.Printf("backup after key change: %v", err)
		}
	})
}

// BackupStatus reports the state of this node's backups (Enabled=false if none).
func (n *Node) BackupStatus() BackupStatus {
	s := n.backups
	if s == nil {
		return BackupStatus{}
	}
	s.mu.Lock()
	st := s.status
	s.mu.Unlock()
	if st.LastOK == nil || time.Since(*st.LastOK) > s.cfg.MaxAge {
		st.Stale = true
	}
	// Does the newest backup still cover what is on disk? (a key added or reshared since is not covered)
	if cur, err := n.currentEpochs(); err == nil {
		st.Covers = st.LastOK != nil && sameEpochs(cur, st.Epochs)
	}
	return st
}

func (n *Node) currentEpochs() (map[string]int, error) {
	n.keyMu.Lock()
	defer n.keyMu.Unlock()
	entries, err := os.ReadDir(n.cfg.DataDir + "/keys")
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	out := map[string]int{}
	for _, e := range entries {
		id, epoch, ok := parseKeyFile(e.Name())
		if !ok || strings.HasSuffix(e.Name(), ".pending") {
			continue
		}
		if cur, seen := out[id]; !seen || epoch > cur {
			out[id] = epoch
		}
	}
	return out, nil
}

func sameEpochs(a, b map[string]int) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if w, ok := b[k]; !ok || w != v {
			return false
		}
	}
	return true
}

func (s *backupService) backupNow(ctx context.Context) (string, error) {
	s.run.Lock()
	defer s.run.Unlock()
	name, err := s.doBackup(ctx)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.status.LastError = err.Error()
		s.n.audit.Record("backup_failed", "", "", map[string]any{"error": err.Error()})
		return "", err
	}
	s.status.LastError = ""
	return name, nil
}

func (s *backupService) doBackup(ctx context.Context) (string, error) {
	p, err := s.n.buildBackupPayload(s.cfg.ClusterFile)
	if err != nil {
		return "", err
	}
	plain, err := marshalPayload(p)
	if err != nil {
		return "", err
	}
	data, err := EncryptBackup(plain, p.Node, p.Epochs(), p.Created, s.cfg.Recipients)
	if err != nil {
		return "", err
	}
	name := backupName(p.Node, p.Created, len(p.Keys), data)
	if err := s.cfg.Sink.Put(ctx, name, data); err != nil {
		return "", fmt.Errorf("could not store the backup in %s: %w", s.cfg.Sink.Name(), err)
	}
	// Read it back: a backup that was never checked is a hope, not a backup.
	got, err := s.cfg.Sink.Get(ctx, name)
	if err != nil {
		return "", fmt.Errorf("stored the backup but could not read it back: %w", err)
	}
	env, err := ParseBackup(got)
	if err != nil || env.Node != p.Node || !sameEpochs(env.Epochs, p.Epochs()) || len(got) != len(data) {
		return "", errors.New("the stored backup did not read back intact")
	}
	now := time.Now().UTC()
	s.mu.Lock()
	s.status.LastOK, s.status.LastName, s.status.Epochs = &now, name, p.Epochs()
	s.mu.Unlock()
	s.n.audit.Record("backup_ok", "", "", map[string]any{"name": name, "epochs": p.Epochs(), "recipients": s.status.Recipients})
	pruned := s.prune(ctx, name, p.Epochs())
	s.mu.Lock()
	s.status.Pruned += pruned
	s.mu.Unlock()
	return name, nil
}

// prune deletes this node's earlier backups that hold superseded shares. After a reshare the old
// shares are retired on the nodes; a backup that still held one would let an attacker who steals
// it combine it with old shares from other nodes' stale backups, undoing the rotation.
// Earlier backups at the same epochs are kept (the latest one) as a fallback.
func (s *backupService) prune(ctx context.Context, keep string, current map[string]int) int {
	names, err := s.cfg.Sink.List(ctx, s.n.cfg.ID+"/")
	if err != nil {
		log.Printf("backup prune: %v", err)
		return 0
	}
	removed, keptSame := 0, 0
	for i := len(names) - 1; i >= 0; i-- { // newest first
		name := names[i]
		if name == keep {
			continue
		}
		raw, err := s.cfg.Sink.Get(ctx, name)
		if err != nil {
			continue
		}
		env, err := ParseBackup(raw)
		if err != nil {
			continue
		}
		if sameEpochs(env.Epochs, current) {
			if keptSame++; keptSame <= 1 {
				continue
			}
		}
		if err := s.cfg.Sink.Delete(ctx, name); err != nil {
			log.Printf("backup prune %s: %v", name, err)
			continue
		}
		removed++
		s.n.audit.Record("backup_pruned", "", "", map[string]any{"name": name, "epochs": env.Epochs})
	}
	return removed
}
