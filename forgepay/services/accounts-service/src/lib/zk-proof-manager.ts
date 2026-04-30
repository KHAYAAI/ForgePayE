/**
 * ZK Proof Manager — Phase 2 integration with crates/zk-proofs Groth16 circuits.
 *
 * When config.zkProofs.enabled = false (default), all methods return dev-mode stubs.
 * When enabled, this module bridges to the Rust ZK proving system.
 *
 * Phase 2 activation:
 *   1. Run `cargo run --bin export-keys` to generate proving/verifying keys
 *   2. Set ZK_PROOFS_ENABLED=true in Helm values / env
 *   3. Wire ZK sidecar HTTP service (Rust → HTTP bridge) or use subprocess
 *
 * Circuit design: see crates/zk-proofs/src/circuits/
 *   - DepositCircuit: proves knowledge of (amount, blind) that produce commitment
 *   - TransferCircuit: proves ownership of UTXO without revealing amount
 *   - WithdrawCircuit: proves valid nullifier + Merkle membership
 */

import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

export class ZkProofError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ZkProofError';
  }
}

const DEV_PROOF = 'zk-disabled-dev-mode';

export interface DepositProofRequest {
  accountId:   string;
  amountUnits: bigint;   // USDC units (6 decimals)
  assetId:     bigint;   // 1 = USDC, 2 = USDT
}

export interface DepositProofResult {
  proof:        string;   // base64 Groth16 proof
  commitment:   string;   // hex commitment (leaf in Merkle tree)
  publicInputs: { commitment: string; assetId: string };
  generatedAt:  string;
}

export interface TransferProofRequest {
  accountId:       string;
  merkleRoot:      string;   // hex
  nullifier:       string;   // hex
  encryptedAmount: string;   // hex ECDH-encrypted amount (for auditor)
}

export interface TransferProofResult {
  proof:        string;
  nullifier:    string;
  publicInputs: { merkleRoot: string; nullifier: string; encryptedAmount: string };
  generatedAt:  string;
}

export class ZkProofManager {
  async generateDepositProof(req: DepositProofRequest): Promise<DepositProofResult> {
    if (!config.zkProofs.enabled) {
      console.warn('[zk-proofs] ZK proofs disabled — returning dev stub. Set ZK_PROOFS_ENABLED=true for Phase 2.');
      const commitment = this.buildCommitment(req.accountId, req.amountUnits, randomBytes(32).toString('hex'));
      return {
        proof:        DEV_PROOF,
        commitment,
        publicInputs: { commitment, assetId: req.assetId.toString() },
        generatedAt:  new Date().toISOString(),
      };
    }

    // Phase 2: call the Rust ZK sidecar HTTP service
    // TODO: replace subprocess with a proper gRPC/HTTP sidecar once the proving service is deployed
    // The sidecar runs `crates/zk-proofs` compiled with --features embed-keys
    return this.callZkSidecar<DepositProofResult>('deposit', {
      account_id:   req.accountId,
      amount_units: req.amountUnits.toString(),
      asset_id:     req.assetId.toString(),
    });
  }

  async generateTransferProof(req: TransferProofRequest): Promise<TransferProofResult> {
    if (!config.zkProofs.enabled) {
      console.warn('[zk-proofs] ZK proofs disabled — returning dev stub.');
      return {
        proof:        DEV_PROOF,
        nullifier:    req.nullifier,
        publicInputs: {
          merkleRoot:      req.merkleRoot,
          nullifier:       req.nullifier,
          encryptedAmount: req.encryptedAmount,
        },
        generatedAt: new Date().toISOString(),
      };
    }

    return this.callZkSidecar<TransferProofResult>('transfer', {
      account_id:       req.accountId,
      merkle_root:      req.merkleRoot,
      nullifier:        req.nullifier,
      encrypted_amount: req.encryptedAmount,
    });
  }

  async verifyProof(
    proofBase64:   string,
    publicInputs:  Record<string, string>,
  ): Promise<boolean> {
    if (!config.zkProofs.enabled || proofBase64 === DEV_PROOF) {
      return true; // pass-through for dev
    }
    const result = await this.callZkSidecar<{ valid: boolean }>('verify', { proof: proofBase64, public_inputs: publicInputs });
    return result.valid;
  }

  private buildCommitment(accountId: string, amountUnits: bigint, blind: string): string {
    // Dev: SHA-256 commitment. Phase 2: replace with Poseidon hash from Rust crate.
    return '0x' + createHash('sha256')
      .update(accountId)
      .update(amountUnits.toString())
      .update(blind)
      .digest('hex');
  }

  private async callZkSidecar<T>(circuit: string, params: Record<string, unknown>): Promise<T> {
    // TODO: configure ZK_SIDECAR_URL env var pointing to the Rust HTTP proving service
    // The sidecar is a thin Axum/Actix server wrapping crates/zk-proofs prove_*() functions
    const sidecarUrl = process.env['ZK_SIDECAR_URL'] ?? 'http://zk-sidecar:9000';
    const res = await fetch(`${sidecarUrl}/prove/${circuit}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
      signal:  AbortSignal.timeout(30_000), // proof generation can take ~10-20s
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ZkProofError(`ZK sidecar error ${res.status}: ${text}`, 'SIDECAR_ERROR');
    }
    return res.json() as Promise<T>;
  }
}
