/**
 * Proofs Resource — Client-side ZK proof generation
 *
 * ARCH: Allows JavaScript/TypeScript applications to generate Groth16 proofs
 * in the browser for shielded payments, without revealing plaintext to servers.
 *
 * Client-side proof generation maintains end-to-end privacy:
 *   - Amount hidden in commitment (Poseidon hash)
 *   - Merchant only sees encrypted memo + proof (not plaintext)
 *   - Auditor can decrypt memo to compute taxes (payment-level only)
 *   - Public ledger never sees plaintext
 *
 * Usage:
 *   ```ts
 *   import { ForgePay } from '@forgepay/sdk';
 *
 *   const fp = new ForgePay({ apiKey: process.env.FORGEPAY_API_KEY! });
 *
 *   // Initialize proof generator from user's private seed
 *   const seed = await fp.proofs.deriveSeed('user@example.com', 'password');
 *   const generator = await fp.proofs.initProofGenerator(seed);
 *
 *   // Generate a deposit proof (hide amount in Merkle tree)
 *   const deposit = await fp.proofs.generateDepositProof({
 *     asset: 0,  // USDC
 *     amountUsd: 49.00,
 *     blind: 'secret_blind_factor',
 *   });
 *   // Returns: { proof: bytes, commitment: bytes32, amount: 4900 }
 *
 *   // Generate a transfer proof (private payment)
 *   const transfer = await fp.proofs.generateTransferProof({
 *     inputs: [...],   // UTXOs being spent
 *     outputs: [...],  // New commitments
 *     merkleProofs: [...],
 *   });
 *
 *   // Submit shielded payment to checkout endpoint
 *   const checkout = await fp.checkout.createShielded({
 *     merchant_id: 'merch_123',
 *     encrypted_memo: encryptedMemo,
 *     audit_proof: transfer.proof,
 *     success_url: 'https://...',
 *     cancel_url: 'https://...',
 *   });
 *   ```
 *
 * CURRENT STATE: **STUBBED FOR TESTING** — all proof generation returns dummy proofs.
 * Replace with real WASM bindings when auditable-privacy-payment is production-ready.
 * TODO: Load WASM module dynamically (@forgepay/privacy-payment-wasm).
 */

import type { FPHttpClient } from '../client.js';

export interface DepositProofInput {
  asset: number;           // Asset ID (0=USDC, 1=USDT)
  amountUsd: number;       // Dollar amount (e.g., 49.00)
  blind?: string;          // Random blind factor (generated if omitted)
}

export interface DepositProofOutput {
  proof: string;           // Base64-encoded Groth16 proof bytes
  commitment: string;      // bytes32 commitment hash (Poseidon)
  amount: number;          // Amount in smallest unit (cents)
  blind: string;           // Blind factor used (for future reference)
}

export interface UtxoInput {
  commitment: string;      // bytes32 hidden commitment
  nullifier: string;       // bytes32 nullifier (unique per spender)
  merkleIndex: number;     // Leaf index in commitment tree
}

export interface UtxoOutput {
  asset: number;
  amountUsd: number;
  blind: string;
}

export interface TransferProofInput {
  inputs: UtxoInput[];
  outputs: UtxoOutput[];
  merkleProofs: string[];  // Merkle membership proofs
}

export interface TransferProofOutput {
  proof: string;           // Base64-encoded Groth16 proof
  nullifiers: string[];    // bytes32 nullifiers being spent
  commitments: string[];   // bytes32 new commitments (outputs)
}

export interface WithdrawProofInput {
  commitment: string;      // UTXO being redeemed
  amountUsd: number;
  merkleProof: string;
}

export interface WithdrawProofOutput {
  proof: string;
  nullifier: string;
  amount: number;
}

/**
 * ProofsResource — Manages client-side ZK proof generation via WASM.
 *
 * The SDK provides two modes:
 * 1. Client-side: ProofsResource.generateDepositProof() → proof in browser
 * 2. Server-side: POST /proofs/generate → backend generates (fallback)
 *
 * Client-side is preferred for privacy; server-side is a fallback for
 * browsers that don't support WASM or when proof generation is expensive.
 *
 * STUB: All methods return dummy proofs.
 * TODO: Load WASM and call ProofGenerator methods.
 */
export class ProofsResource {
  private proofGenerator: any = null; // TODO: type as ProofGenerator from WASM

  constructor(private client: FPHttpClient) {}

  /**
   * Derive a deterministic seed from user email + password.
   * This seed is used to generate the ZK keypair.
   *
   * IMPORTANT: Seed never leaves the browser.
   *
   * In production:
   *   - Use argon2 or similar for key derivation
   *   - Seed stored in browser localStorage (encrypted) or IndexedDB
   *   - Older browsers: fall back to server-side proof generation
   *
   * STUB: Uses simple PBKDF2-like mixing.
   * TODO: Implement proper key derivation (argon2id or scrypt).
   */
  async deriveSeed(email: string, password: string): Promise<string> {
    console.warn('⚠️  STUB: ProofsResource.deriveSeed — using naive key derivation. Real argon2id/scrypt not integrated.');

    // STUB: Simple mixing for testing
    const combined = `${email}:${password}`;
    const buffer = new TextEncoder().encode(combined);
    let seed = '';

    for (let i = 0; i < buffer.length; i++) {
      seed += buffer[i].toString(16).padStart(2, '0');
    }

    // Pad to 64 hex chars (32 bytes)
    return (seed + '0'.repeat(64)).slice(0, 64);
  }

  /**
   * Initialize the proof generator from a seed.
   * This loads the WASM module and prepares client-side proof generation.
   *
   * STUB: Returns mock generator.
   * TODO: Import and instantiate privacy-payment-wasm.ProofGenerator.
   */
  async initProofGenerator(seedHex: string): Promise<void> {
    console.warn('⚠️  STUB: ProofsResource.initProofGenerator — WASM not loaded. Real Groth16 generation not available.');

    if (seedHex.length < 64) {
      throw new Error('Seed must be at least 64 hex characters');
    }

    // STUB: Create mock generator object
    this.proofGenerator = {
      seed: seedHex,
      merkleRoot: '0x' + '0'.repeat(64),
      getPublicKey: () => `AUDITOR_PK_${seedHex.slice(0, 16)}`,
    };
  }

  /**
   * Generate a deposit proof (hide amount in commitment).
   *
   * Proves without revealing asset or amount:
   *   commitment = Poseidon(asset, amount, blind, owner_public_key)
   *
   * STUB: Returns dummy proof and commitment.
   * TODO: Call WASM ProofGenerator.generateDepositProof().
   */
  async generateDepositProof(input: DepositProofInput): Promise<DepositProofOutput> {
    console.warn('⚠️  STUB: ProofsResource.generateDepositProof — returning dummy proof. Real Groth16 logic not integrated.');

    if (!this.proofGenerator) {
      throw new Error('Proof generator not initialized. Call initProofGenerator first.');
    }

    const amountCents = Math.round(input.amountUsd * 100);
    const blind = input.blind || `blind_${Math.random().toString(16).slice(2)}`;

    // STUB: Deterministic commitment based on inputs
    const commitment = `0xdeadbeef${input.asset}${amountCents}${blind.slice(0, 8)}`;

    return {
      proof: Buffer.from(`STUB_DEPOSIT_PROOF_${commitment}`).toString('base64'),
      commitment,
      amount: amountCents,
      blind,
    };
  }

  /**
   * Generate a transfer proof (private UTXO payment).
   *
   * Proves (without revealing amounts):
   *   - Each input UTXO exists in Merkle tree
   *   - Know secret key for each input
   *   - Total input amount = total output amount
   *   - Output commitments correctly formed
   *
   * STUB: Returns dummy proof.
   * TODO: Call WASM ProofGenerator.generateTransferProof().
   */
  async generateTransferProof(input: TransferProofInput): Promise<TransferProofOutput> {
    console.warn('⚠️  STUB: ProofsResource.generateTransferProof — returning dummy proof. Real UTXO circuit not integrated.');

    if (!this.proofGenerator) {
      throw new Error('Proof generator not initialized. Call initProofGenerator first.');
    }

    const nullifiers = input.inputs.map((_, i) => `0xnullifier${i}`);
    const commitments = input.outputs.map((_, i) => `0xcommitment${i}`);

    return {
      proof: Buffer.from(`STUB_TRANSFER_PROOF_${input.inputs.length}in_${input.outputs.length}out`).toString('base64'),
      nullifiers,
      commitments,
    };
  }

  /**
   * Generate a withdrawal proof (redeem UTXO to public amount).
   *
   * STUB: Returns dummy proof.
   * TODO: Call WASM ProofGenerator.generateWithdrawProof().
   */
  async generateWithdrawProof(input: WithdrawProofInput): Promise<WithdrawProofOutput> {
    console.warn('⚠️  STUB: ProofsResource.generateWithdrawProof — returning dummy proof. Real Groth16 logic not integrated.');

    const amountCents = Math.round(input.amountUsd * 100);

    return {
      proof: Buffer.from(`STUB_WITHDRAW_PROOF_${input.commitment}_${amountCents}`).toString('base64'),
      nullifier: `0xnullifier_${Math.random().toString(16).slice(2, 10)}`,
      amount: amountCents,
    };
  }

  /**
   * Update the Merkle root (call whenever the on-chain root updates).
   * The root is used as a public input in all proofs.
   *
   * In production, the SDK should:
   *   1. Subscribe to chain-sync events via unified-router webhooks
   *   2. Detect chain.merkle_root_updated events
   *   3. Call updateMerkleRoot() automatically
   *   4. Queue proofs that used the old root for re-generation
   */
  async updateMerkleRoot(rootHex: string): Promise<void> {
    if (!this.proofGenerator) {
      throw new Error('Proof generator not initialized. Call initProofGenerator first.');
    }

    console.log(`[ProofsResource] Merkle root updated: ${rootHex.slice(0, 10)}...`);
    this.proofGenerator.merkleRoot = rootHex;
  }

  /**
   * Get the current Merkle root (for display / debugging).
   */
  getMerkleRoot(): string {
    if (!this.proofGenerator) {
      throw new Error('Proof generator not initialized. Call initProofGenerator first.');
    }

    return this.proofGenerator.merkleRoot;
  }

  /**
   * Check if WASM is available (e.g., browser support for WebAssembly).
   *
   * If false, the SDK falls back to server-side proof generation.
   */
  async isWasmAvailable(): Promise<boolean> {
    // STUB: Always return false (WASM not loaded)
    // TODO: Check if WASM module can be imported
    return false;
  }
}
