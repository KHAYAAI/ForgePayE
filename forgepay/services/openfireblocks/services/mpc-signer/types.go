package main

import "forge-crypto/mpc-signer/internal/ethtx"

// types.go defines the request/response contract for the MPC signer's HTTP API.
// These mirror the DTOs used by the NestJS api-gateway so the two services
// can communicate over JSON without a shared schema registry (Phase 0).

// SignRequest is an unsigned Ethereum transaction the caller wants signed; see
// ethtx.SignRequest for the fee model.
type SignRequest = ethtx.SignRequest

// SignResponse is returned on a successful signing.
type SignResponse struct {
	RequestID  string `json:"requestId"`  // UUID for correlating audit events
	SignedTx   string `json:"signedTx"`   // 0x-prefixed RLP-encoded signed transaction
	TxHash     string `json:"txHash"`     // 0x-prefixed transaction hash (keccak256 of the signed tx)
	From       string `json:"from"`       // signer address derived from the shared key
	Status     string `json:"status"`     // always "signed" on success
	AuditLogID uint64 `json:"auditLogId"` // immudb transaction id of the audit record
}

// ErrorResponse is returned for any failure so the caller always gets a request id.
type ErrorResponse struct {
	Error      string `json:"error"`
	RequestID  string `json:"requestId"`
	AuditLogID uint64 `json:"auditLogId,omitempty"`
}
