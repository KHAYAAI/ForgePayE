/**
 * Tests for the ProofsResource WASM wrapper.
 *
 * WASM is stubbed in the current implementation — tests verify that the stub
 * returns the expected structure and that the API contracts are upheld.
 * When real WASM is integrated, these tests will still pass (same contracts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProofsResource } from '../src/resources/proofs.js';

const mockClient = { apiKey: 'fp_test_key' } as any;

describe('ProofsResource', () => {
  let resource: ProofsResource;

  beforeEach(() => {
    resource = new ProofsResource(mockClient);
  });

  // ── deriveSeed ──────────────────────────────────────────────────────────────

  describe('deriveSeed', () => {
    it('returns a 64-char hex string', async () => {
      const seed = await resource.deriveSeed('user@example.com', 'my-strong-password');
      expect(seed).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same email + password', async () => {
      const s1 = await resource.deriveSeed('user@example.com', 'same-password');
      const s2 = await resource.deriveSeed('user@example.com', 'same-password');
      expect(s1).toBe(s2);
    });

    it('produces different seeds for different passwords', async () => {
      const s1 = await resource.deriveSeed('user@example.com', 'password-a');
      const s2 = await resource.deriveSeed('user@example.com', 'password-b');
      expect(s1).not.toBe(s2);
    });

    it('produces different seeds for different emails with same password', async () => {
      const s1 = await resource.deriveSeed('alice@example.com', 'same-pass');
      const s2 = await resource.deriveSeed('bob@example.com', 'same-pass');
      expect(s1).not.toBe(s2);
    });

    it('returns exactly 64 characters', async () => {
      const seed = await resource.deriveSeed('a@b.com', 'pw');
      expect(seed.length).toBe(64);
    });
  });

  // ── isWasmAvailable ─────────────────────────────────────────────────────────

  describe('isWasmAvailable', () => {
    it('returns false before initProofGenerator is called (WASM not loaded)', async () => {
      expect(await resource.isWasmAvailable()).toBe(false);
    });
  });

  // ── initProofGenerator ──────────────────────────────────────────────────────

  describe('initProofGenerator', () => {
    it('succeeds with a valid 64-char hex seed', async () => {
      const seed = 'a'.repeat(64);
      await expect(resource.initProofGenerator(seed)).resolves.not.toThrow();
    });

    it('throws when seed is shorter than 64 hex chars', async () => {
      const shortSeed = 'a'.repeat(63);
      await expect(resource.initProofGenerator(shortSeed)).rejects.toThrow(
        /64 hex/i,
      );
    });
  });

  // ── generateDepositProof ────────────────────────────────────────────────────

  describe('generateDepositProof', () => {
    beforeEach(async () => {
      await resource.initProofGenerator('b'.repeat(64));
    });

    it('returns proof, commitment, amount, and blind fields', async () => {
      const result = await resource.generateDepositProof({
        asset: 0,
        amountUsd: 49.00,
      });

      expect(typeof result.proof).toBe('string');
      expect(typeof result.commitment).toBe('string');
      expect(typeof result.amount).toBe('number');
      expect(typeof result.blind).toBe('string');
    });

    it('amount is in cents (amountUsd * 100)', async () => {
      const result = await resource.generateDepositProof({
        asset: 0,
        amountUsd: 10.50,
      });
      expect(result.amount).toBe(1050);
    });

    it('proof is a non-empty base64 string', async () => {
      const result = await resource.generateDepositProof({
        asset: 1,
        amountUsd: 5.00,
      });
      // Base64 strings only contain [A-Za-z0-9+/=]
      expect(result.proof).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(result.proof.length).toBeGreaterThan(0);
    });

    it('uses provided blind factor', async () => {
      const result = await resource.generateDepositProof({
        asset: 0,
        amountUsd: 1.00,
        blind: 'my_custom_blind',
      });
      expect(result.blind).toBe('my_custom_blind');
    });

    it('throws when proof generator is not initialized', async () => {
      const fresh = new ProofsResource(mockClient);
      await expect(
        fresh.generateDepositProof({ asset: 0, amountUsd: 1.00 }),
      ).rejects.toThrow(/not initialized/i);
    });
  });

  // ── generateTransferProof ───────────────────────────────────────────────────

  describe('generateTransferProof', () => {
    beforeEach(async () => {
      await resource.initProofGenerator('c'.repeat(64));
    });

    it('returns proof, nullifiers, and commitments', async () => {
      const result = await resource.generateTransferProof({
        inputs: [
          { commitment: '0xabc', nullifier: '0xdef', merkleIndex: 0 },
        ],
        outputs: [
          { asset: 0, amountUsd: 10.00, blind: 'blind_1' },
        ],
        merkleProofs: ['0xmerkle_proof_1'],
      });

      expect(typeof result.proof).toBe('string');
      expect(Array.isArray(result.nullifiers)).toBe(true);
      expect(Array.isArray(result.commitments)).toBe(true);
    });

    it('returns one nullifier per input', async () => {
      const result = await resource.generateTransferProof({
        inputs: [
          { commitment: '0xa', nullifier: '0xb', merkleIndex: 0 },
          { commitment: '0xc', nullifier: '0xd', merkleIndex: 1 },
        ],
        outputs: [{ asset: 0, amountUsd: 5.00, blind: 'blind_a' }],
        merkleProofs: [],
      });

      expect(result.nullifiers.length).toBe(2);
    });

    it('returns one commitment per output', async () => {
      const result = await resource.generateTransferProof({
        inputs: [{ commitment: '0xa', nullifier: '0xb', merkleIndex: 0 }],
        outputs: [
          { asset: 0, amountUsd: 3.00, blind: 'b1' },
          { asset: 0, amountUsd: 2.00, blind: 'b2' },
        ],
        merkleProofs: [],
      });

      expect(result.commitments.length).toBe(2);
    });

    it('throws when proof generator is not initialized', async () => {
      const fresh = new ProofsResource(mockClient);
      await expect(
        fresh.generateTransferProof({ inputs: [], outputs: [], merkleProofs: [] }),
      ).rejects.toThrow(/not initialized/i);
    });
  });

  // ── generateWithdrawProof ───────────────────────────────────────────────────

  describe('generateWithdrawProof', () => {
    beforeEach(async () => {
      await resource.initProofGenerator('d'.repeat(64));
    });

    it('returns proof, nullifier, and amount', async () => {
      const result = await resource.generateWithdrawProof({
        commitment: '0xcommitment_abc',
        amountUsd: 25.00,
        merkleProof: '0xmerkle_proof',
      });

      expect(typeof result.proof).toBe('string');
      expect(typeof result.nullifier).toBe('string');
      expect(typeof result.amount).toBe('number');
    });

    it('amount is in cents', async () => {
      const result = await resource.generateWithdrawProof({
        commitment: '0xabc',
        amountUsd: 7.50,
        merkleProof: '0xmp',
      });
      expect(result.amount).toBe(750);
    });
  });

  // ── getMerkleRoot / updateMerkleRoot ────────────────────────────────────────

  describe('getMerkleRoot / updateMerkleRoot', () => {
    beforeEach(async () => {
      await resource.initProofGenerator('e'.repeat(64));
    });

    it('getMerkleRoot returns a string after init', () => {
      const root = resource.getMerkleRoot();
      expect(typeof root).toBe('string');
    });

    it('updateMerkleRoot changes the stored root', async () => {
      const newRoot = '0x' + 'f'.repeat(64);
      await resource.updateMerkleRoot(newRoot);
      expect(resource.getMerkleRoot()).toBe(newRoot);
    });

    it('getMerkleRoot throws before initProofGenerator is called', () => {
      const fresh = new ProofsResource(mockClient);
      expect(() => fresh.getMerkleRoot()).toThrow(/not initialized/i);
    });
  });
});
