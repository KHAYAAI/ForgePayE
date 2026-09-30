package mpc

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/bnb-chain/tss-lib/v2/ecdsa/keygen"
	"github.com/google/uuid"
)

// preParamsPool keeps a few sealed sets of keygen pre-parameters (two safe
// primes and a Paillier key) ready. Generating them takes ~20-60s of CPU, which
// would otherwise land inside every key ceremony. Each ceremony consumes one;
// they are never reused across keys.
type preParamsPool struct {
	dir      string
	sealKey  []byte
	target   int
	refiling atomic.Bool
}

func newPreParamsPool(dataDir string, sealKey []byte, target int) (*preParamsPool, error) {
	dir := filepath.Join(dataDir, "preparams")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &preParamsPool{dir: dir, sealKey: sealKey, target: target}, nil
}

func (p *preParamsPool) files() []string {
	m, _ := filepath.Glob(filepath.Join(p.dir, "*.sealed"))
	return m
}

// Available is how many sets are ready.
func (p *preParamsPool) Available() int { return len(p.files()) }

// Take returns a set, generating one inline if the pool is empty. A background
// refill is started either way.
func (p *preParamsPool) Take(ctx context.Context) (*keygen.LocalPreParams, error) {
	defer p.Refill()
	for _, f := range p.files() {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		// Claim by deleting first: a set must never be handed out twice.
		if err := os.Remove(f); err != nil {
			continue
		}
		plain, err := Open(p.sealKey, raw, "preparams")
		if err != nil {
			log.Printf("discarding unreadable pre-params %s: %v", f, err)
			continue
		}
		var pre keygen.LocalPreParams
		if err := json.Unmarshal(plain, &pre); err != nil || !pre.Validate() {
			continue
		}
		return &pre, nil
	}
	// Nothing ready: someone is waiting, so use every core.
	return generatePreParams(ctx, runtime.NumCPU())
}

// generatePreParams searches for safe primes on `workers` cores. tss-lib uses
// all of them by default, which is right when a ceremony is waiting but would
// stall live signing if it happened in the background.
func generatePreParams(ctx context.Context, workers int) (*keygen.LocalPreParams, error) {
	pre, err := keygen.GeneratePreParamsWithContext(ctx, workers)
	if err != nil {
		return nil, fmt.Errorf("generating pre-params: %w", err)
	}
	return pre, nil
}

// Refill tops the pool up in the background; at most one refill runs at a time.
func (p *preParamsPool) Refill() {
	if !p.refiling.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer p.refiling.Store(false)
		for p.Available() < p.target {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			pre, err := generatePreParams(ctx, 1) // one core: never crowd out a signing ceremony
			cancel()
			if err != nil {
				log.Printf("pre-params refill failed: %v", err)
				return
			}
			plain, err := json.Marshal(pre)
			if err != nil {
				return
			}
			sealed, err := Seal(p.sealKey, plain, "preparams")
			if err != nil {
				return
			}
			tmp := filepath.Join(p.dir, uuid.NewString()+".tmp")
			if err := os.WriteFile(tmp, sealed, 0o600); err != nil {
				return
			}
			_ = os.Rename(tmp, tmp[:len(tmp)-4]+".sealed")
		}
	}()
}
