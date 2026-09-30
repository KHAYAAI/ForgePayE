package mpc

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"sync"
	"time"
)

// auditLog is a node's own append-only record of what it was asked to do and
// what it did. Each line carries the hash of the previous line, so removing or
// editing an entry breaks the chain from that point on. It exists so that each
// node can answer "what did you sign?" independently of the coordinator.
type auditLog struct {
	mu   sync.Mutex
	path string
	prev string
}

type auditLine struct {
	TS      string         `json:"ts"`
	Event   string         `json:"event"`
	Session string         `json:"session,omitempty"`
	KeyID   string         `json:"keyId,omitempty"`
	Detail  map[string]any `json:"detail,omitempty"`
	Prev    string         `json:"prev"`
	Hash    string         `json:"hash"`
}

func newAuditLog(path string) (*auditLog, error) {
	a := &auditLog{path: path}
	if raw, err := os.ReadFile(path); err == nil && len(raw) > 0 {
		var last auditLine
		lines := splitLines(raw)
		if len(lines) > 0 && json.Unmarshal(lines[len(lines)-1], &last) == nil {
			a.prev = last.Hash
		}
	}
	return a, nil
}

func splitLines(b []byte) [][]byte {
	var out [][]byte
	start := 0
	for i, c := range b {
		if c == '\n' {
			if i > start {
				out = append(out, b[start:i])
			}
			start = i + 1
		}
	}
	return out
}

func (a *auditLog) Record(event, session, keyID string, detail map[string]any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	line := auditLine{TS: time.Now().UTC().Format(time.RFC3339Nano), Event: event, Session: session, KeyID: keyID, Detail: detail, Prev: a.prev}
	body, _ := json.Marshal(line)
	sum := sha256.Sum256(body)
	line.Hash = hex.EncodeToString(sum[:])
	out, _ := json.Marshal(line)
	f, err := os.OpenFile(a.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(out, '\n'))
	a.prev = line.Hash
}

// VerifyAuditChain checks every line's hash and its link to the previous one.
func VerifyAuditChain(path string) (int, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	prev := ""
	n := 0
	for _, l := range splitLines(raw) {
		var line auditLine
		if err := json.Unmarshal(l, &line); err != nil {
			return n, err
		}
		want := line.Hash
		if line.Prev != prev {
			return n, errBrokenChain(n)
		}
		line.Hash = ""
		body, _ := json.Marshal(line)
		sum := sha256.Sum256(body)
		if hex.EncodeToString(sum[:]) != want {
			return n, errBrokenChain(n)
		}
		prev = want
		n++
	}
	return n, nil
}

type errBrokenChain int

func (e errBrokenChain) Error() string { return "audit chain broken at entry " + itoa(uint64(e)) }
