/**
 * @example Shielded Payment Flow
 *
 * This example demonstrates the complete flow for privacy-preserving payments:
 * 1. Derive ZK keypair from user password
 * 2. Generate deposit proof (hide amount in commitment)
 * 3. Encrypt transaction memo
 * 4. Create shielded checkout session
 * 5. Redirect to Hyperswitch hosted checkout
 *
 * Privacy guarantee: merchant never sees plaintext amount.
 * Only auditor (with decryption key) can compute taxes.
 *
 * CURRENT STATE: **STUBBED FOR TESTING**
 * Real ECDH + AES-GCM encryption and Groth16 proofs not integrated.
 * TODO: Replace stub implementations with real WASM bindings.
 */

import { ForgePay } from '@forgepay/sdk';

async function main() {
  // Initialize SDK
  const fp = new ForgePay({
    apiKey: process.env.FORGEPAY_API_KEY || 'test_key_123',
  });

  console.log('🔐 Shielded Payment Example\n');

  // ── Step 1: Derive ZK keypair from password ────────────────────────────────

  const userEmail = 'user@example.com';
  const userPassword = 'super_secret_password';

  console.log('Step 1: Deriving ZK keypair from password...');
  const seed = await fp.proofs.deriveSeed(userEmail, userPassword);
  console.log(`  ✓ Seed derived (${seed.slice(0, 16)}...)`);

  // Initialize proof generator
  console.log('Step 2: Initializing proof generator...');
  await fp.proofs.initProofGenerator(seed);
  console.log('  ✓ Proof generator initialized');

  // ── Step 2: Generate deposit proof ──────────────────────────────────────────

  const depositAmount = 49.99; // $49.99
  console.log(`\nStep 3: Generating deposit proof for $${depositAmount}...`);

  const deposit = await fp.proofs.generateDepositProof({
    asset: 0, // USDC
    amountUsd: depositAmount,
  });

  console.log(`  ✓ Deposit proof generated`);
  console.log(`    Commitment: ${deposit.commitment.slice(0, 18)}...`);
  console.log(`    Amount (cents): ${deposit.amount}`);
  console.log(`    Blind: ${deposit.blind.slice(0, 16)}...`);

  // ── Step 3: Encrypt transaction memo ───────────────────────────────────────

  console.log('\nStep 4: Encrypting transaction memo...');

  // STUB: In real implementation, this would use ECDH + AES-GCM
  // For now, we just pass the deposit proof as-is
  const memo = {
    asset: 0,
    amount: deposit.amount,
    commitment: deposit.commitment,
  };

  const encryptedMemo = await fp.shieldedCheckout.encryptMemo(
    memo,
    '0xauditor_public_key_placeholder'
  );

  console.log(`  ✓ Memo encrypted (${encryptedMemo.slice(0, 20)}...)`);

  // ── Step 4: Create shielded checkout session ───────────────────────────────

  console.log('\nStep 5: Creating shielded checkout session...');

  const checkout = await fp.shieldedCheckout.create({
    merchant_id: 'merch_demo_123',
    customer_id: 'cus_user_001',
    customer_email: userEmail,
    encrypted_memo: encryptedMemo,
    audit_proof: deposit.proof,
    currency: 'USD',
    payment_methods: ['card', 'usdc'],
    success_url: 'https://example.com/success',
    cancel_url: 'https://example.com/cancel',
    customer_country: 'US',
    customer_state: 'CA',
    metadata: {
      order_id: 'order_001',
      product: 'Premium Plan',
    },
  });

  console.log(`  ✓ Checkout session created`);
  console.log(`    Session ID: ${checkout.session_id}`);
  console.log(`    Status: ${checkout.status}`);
  console.log(`    Amount: $${(checkout.amount_total / 100).toFixed(2)}`);
  console.log(`    Tax: $${(checkout.amount_tax / 100).toFixed(2)}`);
  console.log(`    Expires at: ${checkout.expires_at}`);

  // ── Step 5: Redirect to checkout ────────────────────────────────────────────

  console.log('\nStep 6: Redirecting to Hyperswitch checkout...');
  console.log(`  Client secret: ${checkout.client_secret.slice(0, 30)}...`);

  // In a real browser context, redirect to checkout:
  // window.location.href = checkout.client_secret;

  // For this example, just display the session
  console.log('\n✅ Shielded payment flow completed!');
  console.log('\nFinal checkout session:');
  console.log(JSON.stringify(checkout, null, 2));
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
