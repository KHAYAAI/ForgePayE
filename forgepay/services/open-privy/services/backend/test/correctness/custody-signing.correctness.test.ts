import { ethers } from 'ethers';
import * as crypto from 'crypto';
import { EncryptionService } from '../../src/common/encryption/encryption.service';

/**
 * CORRECTNESS TEST: Custodial key custody -> signing round-trip
 *
 * The whole point of the custodial model is: a key generated + encrypted at
 * wallet-creation time must decrypt back to the exact same key later, so the
 * server can sign as that wallet. This proves that end-to-end at the crypto
 * level (the DB layer is a thin store around this).
 */
describe('Custody -> signing round-trip', () => {
  let encryption: EncryptionService;

  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY = crypto.randomBytes(32).toString('base64');
    encryption = new EncryptionService();
  });

  it('decrypted key reproduces the original wallet address', async () => {
    const userId = 'user-abc';
    const original = ethers.Wallet.createRandom();

    const stored = await encryption.encrypt(original.privateKey, userId);
    const recovered = await encryption.decrypt(stored, userId);

    expect(recovered).toBe(original.privateKey);

    // The recovered key must control the same address (this is what makes
    // server-side signing valid).
    const signer = new ethers.Wallet(recovered);
    expect(signer.address).toBe(original.address);
  });

  it('a signature from the recovered key verifies to the wallet address', async () => {
    const userId = 'user-xyz';
    const original = ethers.Wallet.createRandom();

    const stored = await encryption.encrypt(original.privateKey, userId);
    const recovered = await encryption.decrypt(stored, userId);
    const signer = new ethers.Wallet(recovered);

    const message = 'openprivy custodial signing test';
    const signature = await signer.signMessage(message);

    expect(ethers.verifyMessage(message, signature)).toBe(original.address);
  });

  it('the wrong user cannot recover the key', async () => {
    const original = ethers.Wallet.createRandom();
    const stored = await encryption.encrypt(original.privateKey, 'owner');

    await expect(encryption.decrypt(stored, 'attacker')).rejects.toThrow();
  });
});
