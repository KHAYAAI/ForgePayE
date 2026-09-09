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
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'ZkProofError';
    }
}
const DEV_PROOF = 'zk-disabled-dev-mode';
export class ZkProofManager {
    async generateDepositProof(req) {
        if (!config.zkProofs.enabled) {
            console.warn('[zk-proofs] ZK proofs disabled — returning dev stub. Set ZK_PROOFS_ENABLED=true for Phase 2.');
            const commitment = this.buildCommitment(req.accountId, req.amountUnits, randomBytes(32).toString('hex'));
            return {
                proof: DEV_PROOF,
                commitment,
                publicInputs: { commitment, assetId: req.assetId.toString() },
                generatedAt: new Date().toISOString(),
            };
        }
        // Phase 2: call the Rust ZK sidecar HTTP service
        // TODO: replace subprocess with a proper gRPC/HTTP sidecar once the proving service is deployed
        // The sidecar runs `crates/zk-proofs` compiled with --features embed-keys
        return this.callZkSidecar('deposit', {
            account_id: req.accountId,
            amount_units: req.amountUnits.toString(),
            asset_id: req.assetId.toString(),
        });
    }
    async generateTransferProof(req) {
        if (!config.zkProofs.enabled) {
            console.warn('[zk-proofs] ZK proofs disabled — returning dev stub.');
            return {
                proof: DEV_PROOF,
                nullifier: req.nullifier,
                publicInputs: {
                    merkleRoot: req.merkleRoot,
                    nullifier: req.nullifier,
                    encryptedAmount: req.encryptedAmount,
                },
                generatedAt: new Date().toISOString(),
            };
        }
        return this.callZkSidecar('transfer', {
            account_id: req.accountId,
            merkle_root: req.merkleRoot,
            nullifier: req.nullifier,
            encrypted_amount: req.encryptedAmount,
        });
    }
    async verifyProof(proofBase64, publicInputs) {
        if (!config.zkProofs.enabled || proofBase64 === DEV_PROOF) {
            return true; // pass-through for dev
        }
        const result = await this.callZkSidecar('verify', { proof: proofBase64, public_inputs: publicInputs });
        return result.valid;
    }
    buildCommitment(accountId, amountUnits, blind) {
        // Dev: SHA-256 commitment. Phase 2: replace with Poseidon hash from Rust crate.
        return '0x' + createHash('sha256')
            .update(accountId)
            .update(amountUnits.toString())
            .update(blind)
            .digest('hex');
    }
    async callZkSidecar(circuit, params) {
        // TODO: configure ZK_SIDECAR_URL env var pointing to the Rust HTTP proving service
        // The sidecar is a thin Axum/Actix server wrapping crates/zk-proofs prove_*() functions
        const sidecarUrl = process.env['ZK_SIDECAR_URL'] ?? 'http://zk-sidecar:9000';
        const res = await fetch(`${sidecarUrl}/prove/${circuit}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
            signal: AbortSignal.timeout(30_000), // proof generation can take ~10-20s
        });
        if (!res.ok) {
            const text = await res.text();
            throw new ZkProofError(`ZK sidecar error ${res.status}: ${text}`, 'SIDECAR_ERROR');
        }
        return res.json();
    }
}
//# sourceMappingURL=zk-proof-manager.js.map