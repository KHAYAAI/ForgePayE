package mpc

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Shamir secret sharing over GF(2^8), applied byte by byte. It splits the recovery key
// for node backups among officers so that no one person can open a backup: any K of the
// N shares rebuild the key, and K-1 reveal nothing about it.
//
// Each share carries a short fingerprint of the secret, so shares from different splits
// are not silently mixed, and a wrong or damaged set is reported rather than producing
// garbage.

var (
	gfExp [512]byte
	gfLog [256]byte
)

func init() {
	// Log/exp tables for GF(256) with the AES polynomial 0x11b and generator 3.
	x := 1
	for i := 0; i < 255; i++ {
		gfExp[i] = byte(x)
		gfLog[x] = byte(i)
		x ^= x << 1 // multiply by 3 = x*2 + x
		if x&0x100 != 0 {
			x ^= 0x11b
		}
	}
	for i := 255; i < 512; i++ {
		gfExp[i] = gfExp[i-255]
	}
}

func gfMul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}
	return gfExp[int(gfLog[a])+int(gfLog[b])]
}

func gfDiv(a, b byte) byte {
	if b == 0 {
		panic("division by zero in GF(256)")
	}
	if a == 0 {
		return 0
	}
	return gfExp[(int(gfLog[a])+255-int(gfLog[b]))%255]
}

// Share is one officer's piece of a split secret.
type Share struct {
	K, N int
	X    byte   // 1..N
	FP   string // 8 hex chars: fingerprint of the secret
	Data []byte
}

func secretFingerprint(secret []byte) string {
	h := sha256.Sum256(append([]byte("mpc-shamir|"), secret...))
	return hex.EncodeToString(h[:4])
}

// SplitSecret splits secret into n shares, any k of which rebuild it.
func SplitSecret(secret []byte, k, n int) ([]Share, error) {
	if k < 2 || n < k || n > 255 {
		return nil, fmt.Errorf("need 2 <= threshold <= shares <= 255 (got %d of %d)", k, n)
	}
	if len(secret) == 0 {
		return nil, errors.New("nothing to split")
	}
	fp := secretFingerprint(secret)
	shares := make([]Share, n)
	for i := range shares {
		shares[i] = Share{K: k, N: n, X: byte(i + 1), FP: fp, Data: make([]byte, len(secret))}
	}
	coeff := make([]byte, k)
	for pos, b := range secret {
		coeff[0] = b
		if _, err := rand.Read(coeff[1:]); err != nil {
			return nil, err
		}
		for i := range shares {
			// Horner evaluation of the polynomial at x = i+1.
			x := shares[i].X
			var y byte
			for c := k - 1; c >= 0; c-- {
				y = gfMul(y, x) ^ coeff[c]
			}
			shares[i].Data[pos] = y
		}
	}
	return shares, nil
}

// CombineShares rebuilds the secret from at least k shares of the same split.
func CombineShares(shares []Share) ([]byte, error) {
	if len(shares) == 0 {
		return nil, errors.New("no shares given")
	}
	k, n, fp, size := shares[0].K, shares[0].N, shares[0].FP, len(shares[0].Data)
	seen := map[byte]bool{}
	for _, s := range shares {
		if s.K != k || s.N != n || s.FP != fp || len(s.Data) != size {
			return nil, errors.New("these shares are not from the same split")
		}
		if s.X == 0 || seen[s.X] {
			return nil, errors.New("a share was given twice, or is invalid")
		}
		seen[s.X] = true
	}
	if len(shares) < k {
		return nil, fmt.Errorf("need %d shares to rebuild the secret, got %d", k, len(shares))
	}
	use := shares[:k]
	secret := make([]byte, size)
	for pos := 0; pos < size; pos++ {
		var acc byte
		for i, si := range use {
			// Lagrange basis polynomial for share i, evaluated at 0.
			num, den := byte(1), byte(1)
			for j, sj := range use {
				if i == j {
					continue
				}
				num = gfMul(num, sj.X)
				den = gfMul(den, si.X^sj.X)
			}
			acc ^= gfMul(si.Data[pos], gfDiv(num, den))
		}
		secret[pos] = acc
	}
	if secretFingerprint(secret) != fp {
		return nil, errors.New("the shares did not rebuild a secret that matches their fingerprint: a share is wrong or damaged")
	}
	return secret, nil
}

var shareEnc = base32.StdEncoding.WithPadding(base32.NoPadding)

// Encode renders a share as text an officer can store and later type or paste:
// fpshare1.<k>.<n>.<x>.<fingerprint>.<base32 data>
func (s Share) Encode() string {
	return fmt.Sprintf("fpshare1.%d.%d.%d.%s.%s", s.K, s.N, s.X, s.FP, shareEnc.EncodeToString(s.Data))
}

// ParseShare reads Encode's output, tolerating surrounding whitespace and case.
func ParseShare(text string) (Share, error) {
	parts := strings.Split(strings.TrimSpace(text), ".")
	if len(parts) != 6 || parts[0] != "fpshare1" {
		return Share{}, errors.New("not a recovery share (expected fpshare1.k.n.x.fingerprint.data)")
	}
	k, err1 := strconv.Atoi(parts[1])
	n, err2 := strconv.Atoi(parts[2])
	x, err3 := strconv.Atoi(parts[3])
	if err1 != nil || err2 != nil || err3 != nil || x < 1 || x > 255 || k < 2 || n < k {
		return Share{}, errors.New("malformed recovery share header")
	}
	data, err := shareEnc.DecodeString(strings.ToUpper(parts[5]))
	if err != nil || len(data) == 0 {
		return Share{}, errors.New("malformed recovery share data")
	}
	return Share{K: k, N: n, X: byte(x), FP: strings.ToLower(parts[4]), Data: data}, nil
}
