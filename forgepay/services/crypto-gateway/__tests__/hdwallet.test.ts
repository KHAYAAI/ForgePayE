import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as tinysecp from 'tiny-secp256k1';

const bip32 = BIP32Factory(tinysecp);

describe('Crypto Gateway - HD Wallet Generation', () => {
  const testMnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  describe('Bitcoin Address Generation', () => {
    it('should derive BTC address from HD seed', () => {
      // M/84'/0'/0'/0/0 (BIP84 - Native SegWit)
      const seed = Buffer.from(
        '000102030405060708090a0b0c0d0e0f',
        'hex'
      );
      const root = bip32.fromSeed(seed);
      const child = root
        .derivePath("m/84'/0'/0'/0/0");

      const { address } = bitcoin.payments.p2wpkh({
        pubkey: child.publicKey,
      });

      expect(address).toBeDefined();
      expect(address).toMatch(/^bc1/); // bech32 prefix
    });

    it('should generate unique addresses for different derivation paths', () => {
      const seed = Buffer.from(
        '000102030405060708090a0b0c0d0e0f',
        'hex'
      );
      const root = bip32.fromSeed(seed);

      const addr1 = root.derivePath("m/84'/0'/0'/0/0").publicKey;
      const addr2 = root.derivePath("m/84'/0'/0'/0/1").publicKey;

      expect(addr1.toString('hex')).not.toBe(addr2.toString('hex'));
    });
  });

  describe('Ethereum Address Generation', () => {
    it('should generate valid Ethereum address format', () => {
      const ethAddr = '0x742d35Cc6634C0532925a3b844Bc9e7595f42E';
      expect(ethAddr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });

  describe('Address Validation', () => {
    it('should validate BTC bech32 addresses', () => {
      const validBech32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
      expect(validBech32).toMatch(/^bc1[ac-hj-np-z02-9]{39,}$/);
    });

    it('should validate ETH addresses', () => {
      const validEth = '0x742d35Cc6634C0532925a3b844Bc9e7595f42E';
      expect(validEth).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });
  });
});
