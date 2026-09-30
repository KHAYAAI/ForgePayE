// Package ethtx builds Ethereum transactions from a sign request. It is shared
// by the coordinator and by every signing node, so a node can rebuild the exact
// transaction it is being asked to sign and compute the hash itself, rather than
// signing a 32-byte value it cannot interpret.
package ethtx

import (
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
)

// SignRequest is an unsigned Ethereum transaction the caller wants signed.
//
// Fee model: if MaxFeePerGas and MaxPriorityFeePerGas are both set, an EIP-1559
// dynamic-fee transaction is produced; otherwise a legacy (EIP-155) transaction
// using GasPrice.
type SignRequest struct {
	ChainID  int    `json:"chainId"`  // 11155111 for Sepolia, 1 for mainnet
	To       string `json:"to"`       // 0x-prefixed recipient address
	Data     string `json:"data"`     // 0x-prefixed call data, or "" / "0x" for a plain transfer
	Value    string `json:"value"`    // amount in wei as a base-10 string ("0" allowed)
	GasLimit uint64 `json:"gasLimit"` // gas units, >= 21000
	GasPrice string `json:"gasPrice"` // legacy: wei per gas as a base-10 string
	Nonce    uint64 `json:"nonce"`    // sender account nonce

	// EIP-1559 dynamic fee fields (both required to select the 1559 path).
	MaxFeePerGas         string `json:"maxFeePerGas,omitempty"`
	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas,omitempty"`
}

// Build returns the unsigned transaction and the signer that hashes/encodes it.
func Build(req *SignRequest) (*types.Transaction, types.Signer, error) {
	if !common.IsHexAddress(req.To) {
		return nil, nil, fmt.Errorf("invalid 'to' address: %q", req.To)
	}
	toAddr := common.HexToAddress(req.To)

	value, err := ParseBig(req.Value, true)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid value: %w", err)
	}
	data, err := DecodeData(req.Data)
	if err != nil {
		return nil, nil, err
	}

	chainID := big.NewInt(int64(req.ChainID))
	if req.MaxFeePerGas != "" && req.MaxPriorityFeePerGas != "" {
		maxFee, err := ParseBig(req.MaxFeePerGas, false)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid maxFeePerGas: %w", err)
		}
		tip, err := ParseBig(req.MaxPriorityFeePerGas, false)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid maxPriorityFeePerGas: %w", err)
		}
		return types.NewTx(&types.DynamicFeeTx{
			ChainID:   chainID,
			Nonce:     req.Nonce,
			GasTipCap: tip,
			GasFeeCap: maxFee,
			Gas:       req.GasLimit,
			To:        &toAddr,
			Value:     value,
			Data:      data,
		}), types.NewLondonSigner(chainID), nil
	}

	gasPrice, err := ParseBig(req.GasPrice, false)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid gasPrice: %w", err)
	}
	return types.NewTx(&types.LegacyTx{
		Nonce:    req.Nonce,
		GasPrice: gasPrice,
		Gas:      req.GasLimit,
		To:       &toAddr,
		Value:    value,
		Data:     data,
	}), types.NewEIP155Signer(chainID), nil
}

// ParseBig parses a base-10 integer string. When zeroOK, "" and "0" yield 0.
func ParseBig(s string, zeroOK bool) (*big.Int, error) {
	if s == "" || s == "0" {
		if zeroOK || s == "0" {
			return new(big.Int), nil
		}
		return nil, fmt.Errorf("empty value")
	}
	n := new(big.Int)
	if _, ok := n.SetString(s, 10); !ok {
		return nil, fmt.Errorf("not a base-10 integer: %q", s)
	}
	return n, nil
}

// DecodeData decodes optional 0x-prefixed call data.
func DecodeData(s string) ([]byte, error) {
	if s == "" || s == "0x" {
		return nil, nil
	}
	decoded, err := hexutil.Decode(s)
	if err != nil {
		return nil, fmt.Errorf("invalid data: %w", err)
	}
	return decoded, nil
}
