import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'crypto';
import { reputationEventRefusal } from '../reputation-policy';
import { verifyEd25519 } from '../lib/ed25519';

const subject = { id: 'a1', ownerMerchantId: 'm-owner' };
const owner = { kind: 'merchant' as const, principalId: 'm-owner' };
const other = { kind: 'merchant' as const, principalId: 'm-other' };
const admin = { kind: 'admin' as const, principalId: 'admin' };

describe('reputation policy', () => {
  it('a merchant cannot vouch for its own agent through another agent it owns, nor with an untrusted agent', () => {
    const mine = { id: 'v1', ownerMerchantId: 'm-owner', trustLevel: 'premium' as const, status: 'active' as const };
    expect(reputationEventRefusal(owner, subject, 'vouched_by_trusted', { relatedAgent: mine }, [])).toMatch(/cannot vouch for its own/);
    const untrusted = { id: 'v2', ownerMerchantId: 'm-other', trustLevel: 'verified' as const, status: 'active' as const };
    expect(reputationEventRefusal(other, subject, 'vouched_by_trusted', { relatedAgent: untrusted }, [])).toMatch(/trusted or premium/);
    const notTheirs = { id: 'v3', ownerMerchantId: 'm-third', trustLevel: 'trusted' as const, status: 'active' as const };
    expect(reputationEventRefusal(other, subject, 'vouched_by_trusted', { relatedAgent: notTheirs }, [])).toMatch(/agent you own/);
  });
  it('a genuine vouch is accepted once', () => {
    const v = { id: 'v4', ownerMerchantId: 'm-other', trustLevel: 'trusted' as const, status: 'active' as const };
    expect(reputationEventRefusal(other, subject, 'vouched_by_trusted', { relatedAgent: v }, [])).toBeNull();
    expect(reputationEventRefusal(other, subject, 'vouched_by_trusted', { relatedAgent: v }, [{ eventType: 'vouched_by_trusted', relatedAgentId: 'v4' }])).toMatch(/already vouched/);
  });
  it('fraud and dispute resolution are the platform\'s to record; the platform may record anything', () => {
    expect(reputationEventRefusal(other, subject, 'fraud_detected', { transactionId: 't' }, [])).toMatch(/FORGE itself/);
    expect(reputationEventRefusal(owner, subject, 'dispute_resolved', {}, [])).toMatch(/FORGE itself/);
    expect(reputationEventRefusal(admin, subject, 'transaction_success', {}, [])).toBeNull();
  });
  it('a dispute and an outcome on the same transaction are separate reports', () => {
    const prior = [{ eventType: 'transaction_success' as const, transactionId: 't1' }];
    expect(reputationEventRefusal(other, subject, 'dispute_raised', { transactionId: 't1' }, prior)).toBeNull();
    expect(reputationEventRefusal(other, subject, 'transaction_failure', { transactionId: 't1' }, prior)).toMatch(/already been reported/);
  });
});

describe('Ed25519 signature verification (was: every signature reported invalid)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spkiHex = publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
  const rawHex = spkiHex.slice(24);
  const sig = sign(null, Buffer.from('hello agent'), privateKey).toString('hex');
  it('accepts a genuine signature with either key encoding, and rejects a wrong message or key', () => {
    expect(verifyEd25519(spkiHex, 'hello agent', sig)).toBe(true);
    expect(verifyEd25519(rawHex, 'hello agent', sig)).toBe(true);
    expect(verifyEd25519(rawHex, 'hello agenT', sig)).toBe(false);
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
    expect(verifyEd25519(other, 'hello agent', sig)).toBe(false);
  });
});
