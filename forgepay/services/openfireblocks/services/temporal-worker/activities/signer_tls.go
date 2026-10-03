package activities

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net/http"
	"os"
	"time"
)

// signerClient returns the HTTP client for calls to the MPC signer. When MPC_SIGNER_CLIENT_CERT_FILE,
// MPC_SIGNER_CLIENT_KEY_FILE and MPC_SIGNER_CA_FILE are set it presents the gateway certificate and trusts only
// that CA (mutual TLS); in production it refuses to fall back to anything else.
func signerClient(fallback *http.Client) (*http.Client, error) {
	return signerClientFrom(os.Getenv, fallback)
}

func signerClientFrom(getenv func(string) string, fallback *http.Client) (*http.Client, error) {
	cert, key, ca := getenv("MPC_SIGNER_CLIENT_CERT_FILE"), getenv("MPC_SIGNER_CLIENT_KEY_FILE"), getenv("MPC_SIGNER_CA_FILE")
	if cert == "" && key == "" && ca == "" {
		if getenv("NODE_ENV") == "production" {
			return nil, errors.New("production requires mutual TLS to the signer: set MPC_SIGNER_CLIENT_CERT_FILE, MPC_SIGNER_CLIENT_KEY_FILE and MPC_SIGNER_CA_FILE")
		}
		return fallback, nil
	}
	if cert == "" || key == "" || ca == "" {
		return nil, errors.New("set all of MPC_SIGNER_CLIENT_CERT_FILE, MPC_SIGNER_CLIENT_KEY_FILE and MPC_SIGNER_CA_FILE, or none")
	}
	pair, err := tls.LoadX509KeyPair(cert, key)
	if err != nil {
		return nil, err
	}
	pem, err := os.ReadFile(ca)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, errors.New("MPC_SIGNER_CA_FILE holds no certificate")
	}
	return &http.Client{
		Timeout:   2 * time.Minute,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, RootCAs: pool}},
	}, nil
}
