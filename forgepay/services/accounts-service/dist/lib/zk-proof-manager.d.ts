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
export declare class ZkProofError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export interface DepositProofRequest {
    accountId: string;
    amountUnits: bigint;
    assetId: bigint;
}
export interface DepositProofResult {
    proof: string;
    commitment: string;
    publicInputs: {
        commitment: string;
        assetId: string;
    };
    generatedAt: string;
}
export interface TransferProofRequest {
    accountId: string;
    merkleRoot: string;
    nullifier: string;
    encryptedAmount: string;
}
export interface TransferProofResult {
    proof: string;
    nullifier: string;
    publicInputs: {
        merkleRoot: string;
        nullifier: string;
        encryptedAmount: string;
    };
    generatedAt: string;
}
export declare class ZkProofManager {
    generateDepositProof(req: DepositProofRequest): Promise<DepositProofResult>;
    generateTransferProof(req: TransferProofRequest): Promise<TransferProofResult>;
    verifyProof(proofBase64: string, publicInputs: Record<string, string>): Promise<boolean>;
    private buildCommitment;
    private callZkSidecar;
}
//# sourceMappingURL=zk-proof-manager.d.ts.map