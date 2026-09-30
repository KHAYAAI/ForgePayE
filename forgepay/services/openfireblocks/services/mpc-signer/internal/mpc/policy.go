package mpc

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// NodePolicy is what one signing node insists on, whatever the coordinator and
// the gateway's own checks concluded. It lives in a file on the node's own
// host, owned by whoever runs that node, and the coordinator has no way to
// change it. A node that enforces its own limits means a compromised gateway
// can't drain a workspace unless it also gets past every node that signs.
//
// Every field is optional; an empty policy allows everything.
type NodePolicy struct {
	// MaxValueWei caps the value of one transaction.
	MaxValueWei string `json:"maxValueWei,omitempty"`
	// MaxFeeWei caps gasLimit × the highest per-gas fee the transaction offers,
	// so a request can't burn a balance on fees.
	MaxFeeWei string `json:"maxFeeWei,omitempty"`
	// DailyLimitWei caps the total value this node will co-sign for one key in
	// any rolling 24 hours. Counted when the node agrees to sign, released if
	// the ceremony then fails.
	DailyLimitWei string `json:"dailyLimitWei,omitempty"`
	// MaxTxPerHour caps how many transactions this node will co-sign for one
	// key in any rolling hour.
	MaxTxPerHour int `json:"maxTxPerHour,omitempty"`
	// AllowedChainIDs, when set, limits which networks this node will sign for.
	AllowedChainIDs []int `json:"allowedChainIds,omitempty"`
	// AllowedDestinations, when set, is the only set of addresses it will send to.
	AllowedDestinations []string `json:"allowedDestinations,omitempty"`
	// BlockedDestinations are never sent to — including the recipient or
	// spender inside a standard token transfer/approve call.
	BlockedDestinations []string `json:"blockedDestinations,omitempty"`
	// AllowCalldata=false limits the node to plain value transfers.
	AllowCalldata *bool `json:"allowCalldata,omitempty"`
	// AllowedSelectors, when set and calldata is allowed, limits contract calls
	// to these 4-byte function selectors (0x-prefixed hex).
	AllowedSelectors []string `json:"allowedSelectors,omitempty"`
}

// PolicySummary is the public description of a node's policy: enough for the
// console to show that limits exist and to notice when they change, without
// listing every blocked address.
type PolicySummary struct {
	Digest          string   `json:"digest"`
	Active          []string `json:"active"` // names of the rules in force
	MaxValueWei     string   `json:"maxValueWei,omitempty"`
	MaxFeeWei       string   `json:"maxFeeWei,omitempty"`
	DailyLimitWei   string   `json:"dailyLimitWei,omitempty"`
	MaxTxPerHour    int      `json:"maxTxPerHour,omitempty"`
	AllowlistSize   int      `json:"allowlistSize,omitempty"`
	BlocklistSize   int      `json:"blocklistSize,omitempty"`
	PlainTransfers  bool     `json:"plainTransfersOnly,omitempty"`
	ChainRestricted bool     `json:"chainRestricted,omitempty"`
}

// PolicyRefusal is a policy rule saying no. It maps to HTTP 403 and is never
// retried on another committee.
type PolicyRefusal struct{ Rule, Msg string }

func (e *PolicyRefusal) Error() string { return e.Msg }

type compiledPolicy struct {
	raw                     NodePolicy
	maxValue, maxFee, daily *big.Int
	allow, block            map[common.Address]bool
	selectors               map[string]bool
	chains                  map[int]bool
	summary                 PolicySummary
}

func compilePolicy(p NodePolicy) (*compiledPolicy, error) {
	c := &compiledPolicy{raw: p}
	parse := func(name, v string) (*big.Int, error) {
		if v == "" {
			return nil, nil
		}
		n, ok := new(big.Int).SetString(v, 10)
		if !ok || n.Sign() < 0 {
			return nil, fmt.Errorf("policy %s must be a non-negative base-10 integer", name)
		}
		return n, nil
	}
	var err error
	if c.maxValue, err = parse("maxValueWei", p.MaxValueWei); err != nil {
		return nil, err
	}
	if c.maxFee, err = parse("maxFeeWei", p.MaxFeeWei); err != nil {
		return nil, err
	}
	if c.daily, err = parse("dailyLimitWei", p.DailyLimitWei); err != nil {
		return nil, err
	}
	addrs := func(name string, in []string) (map[common.Address]bool, error) {
		m := map[common.Address]bool{}
		for _, a := range in {
			if !common.IsHexAddress(a) {
				return nil, fmt.Errorf("policy %s: %q is not an address", name, a)
			}
			m[common.HexToAddress(a)] = true
		}
		return m, nil
	}
	if c.allow, err = addrs("allowedDestinations", p.AllowedDestinations); err != nil {
		return nil, err
	}
	if c.block, err = addrs("blockedDestinations", p.BlockedDestinations); err != nil {
		return nil, err
	}
	c.selectors = map[string]bool{}
	for _, s := range p.AllowedSelectors {
		s = strings.ToLower(s)
		if b, err := hex.DecodeString(strings.TrimPrefix(s, "0x")); err != nil || len(b) != 4 {
			return nil, fmt.Errorf("policy allowedSelectors: %q is not a 4-byte selector", s)
		}
		c.selectors[strings.TrimPrefix(s, "0x")] = true
	}
	c.chains = map[int]bool{}
	for _, id := range p.AllowedChainIDs {
		c.chains[id] = true
	}
	if p.MaxTxPerHour < 0 {
		return nil, errors.New("policy maxTxPerHour cannot be negative")
	}

	sum := PolicySummary{
		MaxValueWei: p.MaxValueWei, MaxFeeWei: p.MaxFeeWei, DailyLimitWei: p.DailyLimitWei, MaxTxPerHour: p.MaxTxPerHour,
		AllowlistSize: len(c.allow), BlocklistSize: len(c.block),
		PlainTransfers: p.AllowCalldata != nil && !*p.AllowCalldata, ChainRestricted: len(c.chains) > 0,
	}
	for name, on := range map[string]bool{
		"max_value": c.maxValue != nil, "max_fee": c.maxFee != nil, "daily_limit": c.daily != nil,
		"rate_limit": p.MaxTxPerHour > 0, "destination_allowlist": len(c.allow) > 0, "destination_blocklist": len(c.block) > 0,
		"plain_transfers_only": sum.PlainTransfers, "selector_allowlist": len(c.selectors) > 0, "chain_allowlist": len(c.chains) > 0,
	} {
		if on {
			sum.Active = append(sum.Active, name)
		}
	}
	sortStrings(sum.Active)
	canon, _ := json.Marshal(p)
	d := sha256.Sum256(canon)
	sum.Digest = hex.EncodeToString(d[:8])
	c.summary = sum
	return c, nil
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// Standard token calls whose first address argument is a recipient/spender.
var tokenRecipientSelectors = map[string]int{
	"a9059cbb": 0, // transfer(address,uint256)
	"095ea7b3": 0, // approve(address,uint256)
	"23b872dd": 1, // transferFrom(address,address,uint256): the destination is argument 2
}

func embeddedRecipient(data []byte) (common.Address, bool) {
	if len(data) < 4+32 {
		return common.Address{}, false
	}
	arg, ok := tokenRecipientSelectors[hex.EncodeToString(data[:4])]
	if !ok || len(data) < 4+32*(arg+1) {
		return common.Address{}, false
	}
	word := data[4+32*arg : 4+32*(arg+1)]
	return common.BytesToAddress(word[12:]), true
}

// check evaluates the static rules (everything except rolling limits).
func (c *compiledPolicy) check(chainID int, tx *types.Transaction) error {
	if len(c.chains) > 0 && !c.chains[chainID] {
		return &PolicyRefusal{"chain_allowlist", fmt.Sprintf("this node does not sign for chain %d", chainID)}
	}
	if c.maxValue != nil && tx.Value().Cmp(c.maxValue) > 0 {
		return &PolicyRefusal{"max_value", "value exceeds this node's own per-transaction cap"}
	}
	if c.maxFee != nil {
		fee := new(big.Int).Mul(new(big.Int).SetUint64(tx.Gas()), tx.GasFeeCap())
		if fee.Cmp(c.maxFee) > 0 {
			return &PolicyRefusal{"max_fee", "the transaction's maximum fee exceeds this node's own cap"}
		}
	}
	to := *tx.To()
	if c.block[to] {
		return &PolicyRefusal{"destination_blocklist", "destination is on this node's blocklist"}
	}
	if len(c.allow) > 0 && !c.allow[to] {
		return &PolicyRefusal{"destination_allowlist", "destination is not on this node's allowlist"}
	}
	data := tx.Data()
	if len(data) > 0 {
		if c.raw.AllowCalldata != nil && !*c.raw.AllowCalldata {
			return &PolicyRefusal{"plain_transfers_only", "this node signs plain value transfers only, not contract calls"}
		}
		if len(data) < 4 {
			return &PolicyRefusal{"selector_allowlist", "calldata is too short to be a function call"}
		}
		if len(c.selectors) > 0 && !c.selectors[hex.EncodeToString(data[:4])] {
			return &PolicyRefusal{"selector_allowlist", "this contract function is not on this node's allowlist"}
		}
		if rcpt, ok := embeddedRecipient(data); ok {
			if c.block[rcpt] {
				return &PolicyRefusal{"destination_blocklist", "the token recipient is on this node's blocklist"}
			}
		}
	}
	return nil
}

// ---- policy holder: file, reload, rolling ledger ----------------------------

type ledgerEntry struct {
	At      time.Time `json:"at"`
	Op      string    `json:"op"` // reserve | release
	Session string    `json:"session"`
	Key     string    `json:"key"`
	Wei     string    `json:"wei,omitempty"`
}

// Policy enforces a node's policy, reloading its file when it changes and
// keeping a persistent record of what it has agreed to sign so rolling limits
// survive restarts.
type Policy struct {
	mu        sync.Mutex
	path      string
	modTime   time.Time
	cur       *compiledPolicy
	legacyMax *big.Int // MPC_NODE_MAX_VALUE_WEI / SetMaxValue, combined with the file's own cap

	ledgerPath string
	entries    []ledgerEntry
	now        func() time.Time
}

// OpenPolicy loads the policy file at path (which may be empty or missing,
// meaning "no rules") and the rolling ledger at ledgerPath.
func OpenPolicy(path, ledgerPath string) (*Policy, error) {
	p := &Policy{path: path, ledgerPath: ledgerPath, now: time.Now}
	if err := p.reload(true); err != nil {
		return nil, err
	}
	if err := p.loadLedger(); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *Policy) reload(force bool) error {
	var raw NodePolicy
	var mod time.Time
	if p.path != "" {
		fi, err := os.Stat(p.path)
		if err != nil {
			if !os.IsNotExist(err) || force {
				if os.IsNotExist(err) {
					return fmt.Errorf("policy file %s does not exist", p.path)
				}
				return err
			}
			// The file was deleted while running: keep the rules already in force.
			return nil
		}
		mod = fi.ModTime()
		if !force && mod.Equal(p.modTime) {
			return nil
		}
		b, err := os.ReadFile(p.path)
		if err != nil {
			return err
		}
		dec := json.NewDecoder(bytes.NewReader(b))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&raw); err != nil {
			return fmt.Errorf("policy file %s: %w", p.path, err)
		}
	}
	c, err := compilePolicy(raw)
	if err != nil {
		return err
	}
	p.cur, p.modTime = c, mod
	return nil
}

// refresh picks up an edited policy file. A file that no longer parses is
// ignored and the previous rules stay in force — a typo must not silently
// switch every limit off.
func (p *Policy) refresh() {
	if err := p.reload(false); err != nil {
		fmt.Fprintf(os.Stderr, "mpc-node: ignoring invalid policy file, keeping the previous rules: %v\n", err)
	}
}

// SetLegacyMaxValue applies the older single-number cap alongside the file.
func (p *Policy) SetLegacyMaxValue(wei *big.Int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.legacyMax = wei
}

// LegacyMaxValue is the cap set through SetLegacyMaxValue, or nil.
func (p *Policy) LegacyMaxValue() *big.Int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.legacyMax
}

// Summary describes the rules currently in force.
func (p *Policy) Summary() PolicySummary {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.refresh()
	s := p.cur.summary
	if p.legacyMax != nil && (s.MaxValueWei == "" || p.legacyMax.Cmp(mustBig(s.MaxValueWei)) < 0) {
		s.MaxValueWei = p.legacyMax.String()
		s.Active = appendMissing(s.Active, "max_value")
	}
	return s
}

func mustBig(s string) *big.Int { n, _ := new(big.Int).SetString(s, 10); return n }

func appendMissing(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	list = append(list, v)
	sortStrings(list)
	return list
}

// Reserve decides whether this node will co-sign tx for keyID. On success it
// records the value against the rolling limits under `session`; the caller must
// Release(session) if the ceremony then fails.
func (p *Policy) Reserve(session, keyID string, chainID int, tx *types.Transaction) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.refresh()
	c := p.cur
	if p.legacyMax != nil && tx.Value().Cmp(p.legacyMax) > 0 {
		return &PolicyRefusal{"max_value", "value exceeds this node's own per-transaction cap"}
	}
	if err := c.check(chainID, tx); err != nil {
		return err
	}
	now := p.now()
	if c.daily != nil || c.raw.MaxTxPerHour > 0 {
		var day = new(big.Int)
		hour := 0
		for _, e := range p.live() {
			if e.Key != keyID {
				continue
			}
			if now.Sub(e.At) < 24*time.Hour {
				day.Add(day, mustBig(e.Wei))
			}
			if now.Sub(e.At) < time.Hour {
				hour++
			}
		}
		if c.daily != nil && new(big.Int).Add(day, tx.Value()).Cmp(c.daily) > 0 {
			return &PolicyRefusal{"daily_limit", fmt.Sprintf("this node's 24-hour limit for this key would be exceeded (already agreed to %s wei)", day)}
		}
		if c.raw.MaxTxPerHour > 0 && hour >= c.raw.MaxTxPerHour {
			return &PolicyRefusal{"rate_limit", fmt.Sprintf("this node signs at most %d transactions per hour for one key", c.raw.MaxTxPerHour)}
		}
	}
	return p.append(ledgerEntry{At: now, Op: "reserve", Session: session, Key: keyID, Wei: tx.Value().String()})
}

// Release gives back a reservation whose ceremony failed.
func (p *Policy) Release(session string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, e := range p.entries {
		if e.Op == "reserve" && e.Session == session {
			_ = p.append(ledgerEntry{At: p.now(), Op: "release", Session: session, Key: e.Key})
			return
		}
	}
}

// Used reports what this node has agreed to sign for keyID over the last 24 hours.
func (p *Policy) Used(keyID string) (wei *big.Int, count int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	wei = new(big.Int)
	for _, e := range p.live() {
		if e.Key == keyID && p.now().Sub(e.At) < 24*time.Hour {
			wei.Add(wei, mustBig(e.Wei))
			count++
		}
	}
	return wei, count
}

// live returns reservations that haven't been released and are still in the window.
func (p *Policy) live() []ledgerEntry {
	released := map[string]bool{}
	for _, e := range p.entries {
		if e.Op == "release" {
			released[e.Session] = true
		}
	}
	var out []ledgerEntry
	cutoff := p.now().Add(-24 * time.Hour)
	for _, e := range p.entries {
		if e.Op == "reserve" && !released[e.Session] && e.At.After(cutoff) {
			out = append(out, e)
		}
	}
	return out
}

func (p *Policy) append(e ledgerEntry) error {
	p.entries = append(p.entries, e)
	if p.ledgerPath == "" {
		return nil
	}
	f, err := os.OpenFile(p.ledgerPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("cannot record the reservation, so not signing: %w", err)
	}
	defer f.Close()
	line, _ := json.Marshal(e)
	if _, err := f.Write(append(line, '\n')); err != nil {
		return fmt.Errorf("cannot record the reservation, so not signing: %w", err)
	}
	return f.Sync()
}

func (p *Policy) loadLedger() error {
	if p.ledgerPath == "" {
		return nil
	}
	f, err := os.Open(p.ledgerPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<16), 1<<20)
	cutoff := time.Now().Add(-48 * time.Hour)
	for sc.Scan() {
		var e ledgerEntry
		if json.Unmarshal(sc.Bytes(), &e) != nil {
			return errors.New("policy ledger is corrupt; refusing to start rather than forget what was signed")
		}
		if e.At.After(cutoff) {
			p.entries = append(p.entries, e)
		}
	}
	return sc.Err()
}
