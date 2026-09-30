package mpc

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Transport security between the coordinator and the nodes, and between nodes.
//
// Protocol messages are already encrypted end to end between node pairs, and
// coordinator requests are already signed. TLS with client certificates adds
// what those don't: the transaction details in a sign request are not readable
// on the wire, an outsider can't even reach a node's API, and a node knows
// *which* peer is connecting before it parses anything. Certificates are issued
// by a CA the cluster's operators share; a node's certificate name is its node
// id, and the coordinator's is "coordinator".
const coordinatorCertName = "coordinator"

// TLSFiles points at a process's certificate material. Files are re-read when
// they change, so renewing a certificate needs no restart.
type TLSFiles struct{ CAFile, CertFile, KeyFile string }

// TLSFromEnv reads MPC_TLS_CA_FILE, MPC_TLS_CERT_FILE and MPC_TLS_KEY_FILE.
// It returns nil when none is set. Production requires all three.
func TLSFromEnv() (*TLSFiles, error) {
	t := &TLSFiles{CAFile: os.Getenv("MPC_TLS_CA_FILE"), CertFile: os.Getenv("MPC_TLS_CERT_FILE"), KeyFile: os.Getenv("MPC_TLS_KEY_FILE")}
	if t.CAFile == "" && t.CertFile == "" && t.KeyFile == "" {
		if Production() {
			return nil, errors.New("MPC_ENV=production requires MPC_TLS_CA_FILE, MPC_TLS_CERT_FILE and MPC_TLS_KEY_FILE")
		}
		return nil, nil
	}
	if t.CAFile == "" || t.CertFile == "" || t.KeyFile == "" {
		return nil, errors.New("set all of MPC_TLS_CA_FILE, MPC_TLS_CERT_FILE and MPC_TLS_KEY_FILE, or none")
	}
	if _, err := t.load(); err != nil {
		return nil, err
	}
	return t, nil
}

type loaded struct {
	cert tls.Certificate
	pool *x509.CertPool
}

func (t *TLSFiles) load() (*loaded, error) {
	pem, err := os.ReadFile(t.CAFile)
	if err != nil {
		return nil, fmt.Errorf("MPC_TLS_CA_FILE: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, errors.New("MPC_TLS_CA_FILE holds no certificates")
	}
	cert, err := tls.LoadX509KeyPair(t.CertFile, t.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("loading certificate: %w", err)
	}
	return &loaded{cert, pool}, nil
}

// reloader caches the loaded material and refreshes it when a file changes.
type reloader struct {
	t    *TLSFiles
	mu   sync.Mutex
	cur  *loaded
	sig  string
	last time.Time
}

func (r *reloader) get() (*loaded, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cur != nil && time.Since(r.last) < 5*time.Second {
		return r.cur, nil
	}
	r.last = time.Now()
	sig := ""
	for _, f := range []string{r.t.CAFile, r.t.CertFile, r.t.KeyFile} {
		if fi, err := os.Stat(f); err == nil {
			sig += fmt.Sprintf("%d/%d|", fi.ModTime().UnixNano(), fi.Size())
		}
	}
	if r.cur != nil && sig == r.sig {
		return r.cur, nil
	}
	l, err := r.t.load()
	if err != nil {
		if r.cur != nil {
			return r.cur, nil // a half-written renewal must not take the node down
		}
		return nil, err
	}
	r.cur, r.sig = l, sig
	return l, nil
}

// ServerConfig requires every client to present a certificate from the CA.
func (t *TLSFiles) ServerConfig() *tls.Config {
	r := &reloader{t: t}
	return &tls.Config{
		MinVersion: tls.VersionTLS13,
		ClientAuth: tls.RequireAndVerifyClientCert,
		GetConfigForClient: func(*tls.ClientHelloInfo) (*tls.Config, error) {
			l, err := r.get()
			if err != nil {
				return nil, err
			}
			return &tls.Config{
				MinVersion:   tls.VersionTLS13,
				Certificates: []tls.Certificate{l.cert},
				ClientCAs:    l.pool,
				ClientAuth:   tls.RequireAndVerifyClientCert,
			}, nil
		},
	}
}

// ClientConfig presents this process's certificate and trusts only the CA.
func (t *TLSFiles) ClientConfig() *tls.Config {
	r := &reloader{t: t}
	return &tls.Config{
		MinVersion: tls.VersionTLS13,
		// Verify the server against the CA ourselves so a renewed CA is picked up.
		InsecureSkipVerify: true,
		VerifyConnection: func(cs tls.ConnectionState) error {
			l, err := r.get()
			if err != nil {
				return err
			}
			opts := x509.VerifyOptions{Roots: l.pool, DNSName: cs.ServerName, Intermediates: x509.NewCertPool()}
			for _, c := range cs.PeerCertificates[1:] {
				opts.Intermediates.AddCert(c)
			}
			_, err = cs.PeerCertificates[0].Verify(opts)
			return err
		},
		GetClientCertificate: func(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
			l, err := r.get()
			if err != nil {
				return nil, err
			}
			return &l.cert, nil
		},
	}
}

// HTTPClient returns an http.Client that speaks mTLS, or a plain one if t is nil.
func (t *TLSFiles) HTTPClient(timeout time.Duration) *http.Client {
	if t == nil {
		return &http.Client{Timeout: timeout}
	}
	return &http.Client{Timeout: timeout, Transport: &http.Transport{TLSClientConfig: t.ClientConfig(), MaxIdleConnsPerHost: 8}}
}

// peerName returns the certificate name the caller authenticated as, or "" when
// the connection has no client certificate (plain HTTP, development).
func peerName(r *http.Request) string {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
		return ""
	}
	return r.TLS.PeerCertificates[0].Subject.CommonName
}

// tlsWithCA returns a client TLS config trusting only the CA in the given PEM file.
func tlsWithCA(caFile string) (*tls.Config, error) {
	raw, err := os.ReadFile(caFile)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(raw) {
		return nil, errors.New("no certificates found")
	}
	return &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}, nil
}

// ---- a small private CA ------------------------------------------------------

// PKIInit creates a CA (ca.pem, ca.key) in dir. The CA key should live wherever
// the cluster's operators agree to keep it — it is only needed to issue or
// renew certificates, never to run a node.
func PKIInit(dir, name string, validFor time.Duration) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if exists(filepath.Join(dir, "ca.key")) {
		return errors.New("a CA already exists in " + dir)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial(), Subject: pkix.Name{CommonName: name, Organization: []string{"FORGE MPC cluster"}},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(validFor),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		MaxPathLenZero: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return err
	}
	if err := writePEM(filepath.Join(dir, "ca.pem"), "CERTIFICATE", der, 0o644); err != nil {
		return err
	}
	keyDER, _ := x509.MarshalECPrivateKey(key)
	return writePEM(filepath.Join(dir, "ca.key"), "EC PRIVATE KEY", keyDER, 0o600)
}

// PKIIssue signs a certificate for `name` (a node id, or "coordinator") valid
// for the given hosts (DNS names and IPs), and writes cert.pem and key.pem to out.
func PKIIssue(caDir, name string, hosts []string, out string, validFor time.Duration) error {
	caPEM, err := os.ReadFile(filepath.Join(caDir, "ca.pem"))
	if err != nil {
		return err
	}
	caKeyPEM, err := os.ReadFile(filepath.Join(caDir, "ca.key"))
	if err != nil {
		return err
	}
	caBlock, _ := pem.Decode(caPEM)
	keyBlock, _ := pem.Decode(caKeyPEM)
	if caBlock == nil || keyBlock == nil {
		return errors.New("unreadable CA files")
	}
	caCert, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		return err
	}
	caKey, err := x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		return err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial(), Subject: pkix.Name{CommonName: name},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(validFor),
		KeyUsage:    x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			tmpl.IPAddresses = append(tmpl.IPAddresses, ip)
		} else if h != "" {
			tmpl.DNSNames = append(tmpl.DNSNames, h)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &key.PublicKey, caKey)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(out, 0o700); err != nil {
		return err
	}
	if err := writePEM(filepath.Join(out, "cert.pem"), "CERTIFICATE", der, 0o644); err != nil {
		return err
	}
	keyDER, _ := x509.MarshalECPrivateKey(key)
	if err := writePEM(filepath.Join(out, "key.pem"), "EC PRIVATE KEY", keyDER, 0o600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, "ca.pem"), caPEM, 0o644)
}

func serial() *big.Int {
	n, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	return n
}

func writePEM(path, kind string, der []byte, mode os.FileMode) error {
	return os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: der}), mode)
}
