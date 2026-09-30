package mpc

import (
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func plainTx(to string, wei int64) *types.Transaction {
	a := common.HexToAddress(to)
	return types.NewTx(&types.LegacyTx{Nonce: 1, GasPrice: big.NewInt(10), Gas: 21000, To: &a, Value: big.NewInt(wei)})
}

func writePolicy(t *testing.T, path, body string, bump int) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	when := time.Now().Add(time.Duration(bump) * time.Minute)
	_ = os.Chtimes(path, when, when)
}

func TestEmptyPolicyAllowsEverything(t *testing.T) {
	p, err := OpenPolicy("", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve("s1", "k", 1, plainTx("0x000000000000000000000000000000000000dEaD", 1e18)); err != nil {
		t.Fatalf("an empty policy should not refuse: %v", err)
	}
}

func TestPolicyRejectsBadFiles(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"unknown field": `{"maxValueWeii":"1"}`,
		"not a number":  `{"maxValueWei":"lots"}`,
		"negative":      `{"dailyLimitWei":"-5"}`,
		"bad address":   `{"blockedDestinations":["nope"]}`,
		"bad selector":  `{"allowedSelectors":["0x1234"]}`,
		"negative rate": `{"maxTxPerHour":-1}`,
		"not json":      `{`,
	} {
		path := filepath.Join(dir, strings.ReplaceAll(name, " ", "_")+".json")
		_ = os.WriteFile(path, []byte(body), 0o600)
		if _, err := OpenPolicy(path, ""); err == nil {
			t.Errorf("%s: accepted %s", name, body)
		}
	}
	if _, err := OpenPolicy(filepath.Join(dir, "missing.json"), ""); err == nil {
		t.Error("a configured but missing policy file must stop the node starting, not mean 'no rules'")
	}
}

func TestRollingLimitsAreReleasedAndPersist(t *testing.T) {
	dir := t.TempDir()
	path, ledger := filepath.Join(dir, "policy.json"), filepath.Join(dir, "ledger.jsonl")
	writePolicy(t, path, `{"dailyLimitWei":"100","maxTxPerHour":2}`, 0)
	p, err := OpenPolicy(path, ledger)
	if err != nil {
		t.Fatal(err)
	}
	dest := "0x000000000000000000000000000000000000dEaD"
	if err := p.Reserve("a", "k1", 1, plainTx(dest, 60)); err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve("b", "k1", 1, plainTx(dest, 60)); err == nil {
		t.Fatal("60+60 exceeds 100/day")
	}
	if err := p.Reserve("c", "k2", 1, plainTx(dest, 60)); err != nil {
		t.Fatalf("another key has its own allowance: %v", err)
	}
	p.Release("a") // its ceremony failed
	if err := p.Reserve("d", "k1", 1, plainTx(dest, 60)); err != nil {
		t.Fatalf("released value should be available again: %v", err)
	}

	// A restart must not forget what was agreed.
	p2, err := OpenPolicy(path, ledger)
	if err != nil {
		t.Fatal(err)
	}
	if used, n := p2.Used("k1"); used.Int64() != 60 || n != 1 {
		t.Fatalf("after restart k1 used %s over %d txs, want 60 over 1", used, n)
	}
	if err := p2.Reserve("e", "k1", 1, plainTx(dest, 60)); err == nil {
		t.Fatal("limit was forgotten across a restart")
	}
	// Hourly rate: k2 already did one (c); one more is fine, a third is not.
	if err := p2.Reserve("f", "k2", 1, plainTx(dest, 1)); err != nil {
		t.Fatal(err)
	}
	if err := p2.Reserve("g", "k2", 1, plainTx(dest, 1)); err == nil {
		t.Fatal("rate limit not enforced")
	}
}

func TestLimitsExpireAfterTheWindow(t *testing.T) {
	p, _ := OpenPolicy("", "")
	writeDir := t.TempDir()
	path := filepath.Join(writeDir, "p.json")
	writePolicy(t, path, `{"dailyLimitWei":"100"}`, 0)
	p, _ = OpenPolicy(path, "")
	now := time.Now()
	p.now = func() time.Time { return now }
	dest := "0x000000000000000000000000000000000000dEaD"
	if err := p.Reserve("a", "k", 1, plainTx(dest, 100)); err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve("b", "k", 1, plainTx(dest, 1)); err == nil {
		t.Fatal("over the daily limit")
	}
	now = now.Add(25 * time.Hour)
	if err := p.Reserve("c", "k", 1, plainTx(dest, 100)); err != nil {
		t.Fatalf("the window should have rolled: %v", err)
	}
}

func TestEditedPolicyIsPickedUpAndABrokenEditKeepsTheOldRules(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p.json")
	dest := "0x000000000000000000000000000000000000dEaD"
	writePolicy(t, path, `{"maxValueWei":"10"}`, 0)
	p, err := OpenPolicy(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if p.Reserve("a", "k", 1, plainTx(dest, 11)) == nil {
		t.Fatal("cap not applied")
	}
	writePolicy(t, path, `{"maxValueWei":"1000"}`, 1)
	if err := p.Reserve("b", "k", 1, plainTx(dest, 11)); err != nil {
		t.Fatalf("edit not picked up: %v", err)
	}
	digestBefore := p.Summary().Digest
	writePolicy(t, path, `{"maxValueWei": oops`, 2)
	if p.Reserve("c", "k", 1, plainTx(dest, 5000)) == nil {
		t.Fatal("a broken edit switched the cap off")
	}
	if p.Summary().Digest != digestBefore {
		t.Fatal("digest changed although the rules did not")
	}
	// A deleted file also keeps the rules that were loaded.
	_ = os.Remove(path)
	if p.Reserve("d", "k", 1, plainTx(dest, 5000)) == nil {
		t.Fatal("deleting the file switched the cap off")
	}
}

func TestLegacyCapCombinesWithFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p.json")
	writePolicy(t, path, `{"maxValueWei":"100"}`, 0)
	p, _ := OpenPolicy(path, "")
	p.SetLegacyMaxValue(big.NewInt(50))
	dest := "0x000000000000000000000000000000000000dEaD"
	if p.Reserve("a", "k", 1, plainTx(dest, 60)) == nil {
		t.Fatal("the stricter legacy cap should apply")
	}
	p.SetLegacyMaxValue(nil)
	if p.Reserve("b", "k", 1, plainTx(dest, 60)) != nil || p.Reserve("c", "k", 1, plainTx(dest, 101)) == nil {
		t.Fatal("file cap should apply alone")
	}
}

func TestSelectorAllowlist(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p.json")
	writePolicy(t, path, `{"allowedSelectors":["0xa9059cbb"]}`, 0)
	p, _ := OpenPolicy(path, "")
	to := common.HexToAddress("0x000000000000000000000000000000000000dEaD")
	call := func(sel string) *types.Transaction {
		data := common.FromHex(sel)
		data = append(data, make([]byte, 64)...)
		return types.NewTx(&types.LegacyTx{Gas: 60000, GasPrice: big.NewInt(1), To: &to, Data: data, Value: big.NewInt(0)})
	}
	if err := p.Reserve("a", "k", 1, call("0xa9059cbb")); err != nil {
		t.Fatalf("listed selector refused: %v", err)
	}
	if p.Reserve("b", "k", 1, call("0x095ea7b3")) == nil {
		t.Fatal("unlisted selector allowed")
	}
}
