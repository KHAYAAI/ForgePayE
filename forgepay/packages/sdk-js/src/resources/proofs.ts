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
   * Derive a deterministic seed from user email + password using PBKDF2.
   * This seed is used to generate the ZK keypair.
   *
   * Uses PBKDF2-SHA-256 with 210,000 iterations (OWASP recommendation for 2024+).
   * Result is a 32-byte (64-char hex) seed.
   *
   * IMPORTANT: Seed never leaves the browser. Store encrypted in localStorage or IndexedDB.
   *
   * Browser: uses SubtleCrypto (async)
   * Node.js: uses crypto module (async via webcrypto interface)
   */
  async deriveSeed(email: string, password: string): Promise<string> {
    const salt = new TextEncoder().encode(`ForgePay-${email}`);
    const passwordBytes = new TextEncoder().encode(password);

    let derivedKey: ArrayBuffer;

    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      // Browser environment
      const baseKey = await window.crypto.subtle.importKey(
        'raw',
        passwordBytes,
        'PBKDF2',
        false,
        ['deriveBits']
      );
      derivedKey = await window.crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt,
          iterations: 210_000,
          hash: 'SHA-256',
        },
        baseKey,
        256 // 256 bits = 32 bytes
      );
    } else {
      // Node.js environment
      const crypto = await import('crypto').then(m => m.webcrypto);
      const baseKey = await crypto.subtle.importKey(
        'raw',
        passwordBytes,
        'PBKDF2',
        false,
        ['deriveBits']
      );
      derivedKey = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt,
          iterations: 210_000,
          hash: 'SHA-256',
        },
        baseKey,
        256
      );
    }

    // Convert to hex string
    const bytes = new Uint8Array(derivedKey);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Initialize the proof generator from a seed.
   * Dynamically imports the WASM module (@forgepay/privacy-payment-wasm).
   *
   * If WASM is unavailable (browser doesn't support it, module not installed),
   * falls back to a mock generator that returns dummy proofs.
   */
  async initProofGenerator(seedHex: string): Promise<void> {
    if (seedHex.length < 64) {
      throw new Error('Seed must be at least 64 hex characters');
    }

    try {
      // Try to load WASM module
      const module = await import('@forgepay/privacy-payment-wasm');
      if (!module.ProofGenerator) {
        throw new Error('ProofGenerator not exported from WASM module');
      }

      // Initialize real WASM proof generator
      this.proofGenerator = module.ProofGenerator.fromSeed(seedHex);
      console.log('[ProofsResource] WASM proof generator initialized successfully');
    } catch (err) {
      // WASM unavailable — fall back to mock generator
      console.warn(
        `[ProofsResource] WASM not available (${err instanceof Error ? err.message : 'unknown error'}); using stub mode`
      );
      this.proofGenerator = {
        seed: seedHex,
        merkleRoot: '0x' + '0'.repeat(64),
        getPublicKey: () => `AUDITOR_PK_${seedHex.slice(0, 16)}`,
        isWasm: false,
      };
    }
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
   * Check if WASM module is available and can be loaded.
   *
   * Returns false if:
   * - Browser doesn't support WebAssembly
   * - @forgepay/privacy-payment-wasm package is not installed
   * - Dynamic import fails
   */
  async isWasmAvailable(): Promise<boolean> {
    // Check if WebAssembly is supported
    if (typeof WebAssembly === 'undefined') {
      return false;
    }

    try {
      // Try to dynamically import the module
      await import('@forgepay/privacy-payment-wasm');
      return true;
    } catch {
      return false;
    }
  }
}
