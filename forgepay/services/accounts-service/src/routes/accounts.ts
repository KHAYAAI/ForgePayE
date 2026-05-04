import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { WalletManager } from '../lib/wallet-manager.js';
import { BlockchainManager } from '../lib/blockchain-manager.js';
import { KycAmlManager } from '../lib/kyc-aml-manager.js';
import { buildEvent, forwardToUnifiedRouter } from '../lib/events.js';
import { config } from '../config.js';

interface CreateAccountBody {
  merchant_id:    string;
  email:          string;
  display_name?:  string;
  default_chain?: string;
  account_type?:  'custodial' | 'self_custodial';
}

interface KycBody {
  first_name:    string;
  last_name:     string;
  email:         string;
  date_of_birth: string;
  address: {
    line1:       string;
    city:        string;
    country:     string;
    postal_code: string;
  };
  document_type?: 'passport' | 'driving_licence' | 'national_identity_card';
}

function sanitizeAccount(row: Record<string, unknown>) {
  const { encrypted_key: _enc, ...safe } = row;
  return safe;
}

export async function buildAccountRoutes(app: FastifyInstance) {
  const wallets    = new WalletManager();
  const blockchain = new BlockchainManager(wallets);
  const db         = getDb();
  const kyc        = new KycAmlManager(db, config.kyc.onfidoApiKey, config.kyc.ofacScreeningEnabled);

  // ── POST /v1/accounts ──────────────────────────────────────────────────────
  app.post<{ Body: CreateAccountBody }>('/', {
    schema: {
      body: {
        type: 'object',
        required: ['merchant_id', 'email'],
        properties: {
          merchant_id:   { type: 'string' },
          email:         { type: 'string', format: 'email' },
          display_name:  { type: 'string' },
          default_chain: { type: 'string', enum: ['polygon', 'base', 'ethereum', 'arbitrum'] },
        },
      },
    },
  }, async (req, reply) => {
    const { merchant_id, email, display_name, default_chain, account_type } = req.body;
    const chain = default_chain ?? config.accounts.defaultChain;
    const accType = account_type ?? 'self_custodial';

    // Generate deterministic account number
    const seqResult = await db.query(`SELECT COUNT(*) AS cnt FROM fp_accounts`);
    const seq       = parseInt((seqResult.rows[0] as Record<string, unknown>)['cnt'] as string, 10) + 1;
    const year      = new Date().getFullYear();
    const accountNumber = `FP-${year}-${String(seq).padStart(5, '0')}`;

    // Generate wallet (custodial or self_custodial)
    const wallet = await wallets.generateWallet(chain, accType);

    const accountId = randomUUID();
    await db.query(
      `INSERT INTO fp_accounts
         (id, merchant_id, account_number, email, display_name, default_chain,
          wallet_address, encrypted_key, account_type, kms_key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [accountId, merchant_id, accountNumber, email, display_name ?? null,
       chain, wallet.address, wallet.encryptedKey ?? null, accType, wallet.kmsKeyId ?? null],
    );

    const result = await db.query(`SELECT * FROM fp_accounts WHERE id=$1`, [accountId]);
    const account = sanitizeAccount(result.rows[0] as Record<string, unknown>);

    await forwardToUnifiedRouter(buildEvent(
      'account.created', merchant_id, accountId,
      { accountNumber, email, chain, walletAddress: wallet.address, accountType: accType },
    ));

    reply.code(201).send(account);
  });

  // ── GET /v1/accounts ───────────────────────────────────────────────────────
  app.get<{ Querystring: { merchant_id: string; limit?: string; kyc_status?: string } }>('/', {
    schema: {
      querystring: {
        type: 'object',
        required: ['merchant_id'],
        properties: {
          merchant_id: { type: 'string' },
          limit:       { type: 'string' },
          kyc_status:  { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { merchant_id, limit, kyc_status } = req.query;
    const n = Math.min(parseInt(limit ?? '50', 10), 200);

    let query  = `SELECT * FROM fp_accounts WHERE merchant_id=$1`;
    const args: unknown[] = [merchant_id];

    if (kyc_status) {
      args.push(kyc_status);
      query += ` AND kyc_status=$${args.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${args.length + 1}`;
    args.push(n);

    const result = await db.query(query, args);
    reply.send({ data: (result.rows as Record<string, unknown>[]).map(sanitizeAccount) });
  });

  // ── GET /v1/accounts/:id ───────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = await db.query(`SELECT * FROM fp_accounts WHERE id=$1`, [req.params.id]);
    if (result.rows.length === 0) {
      reply.code(404).send({ error: 'Account not found' });
      return;
    }
    reply.send(sanitizeAccount(result.rows[0] as Record<string, unknown>));
  });

  // ── GET /v1/accounts/:id/balance ───────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/balance', async (req, reply) => {
    const result = await db.query(
      `SELECT id, balance_usdc, balance_usdt, wallet_address, default_chain FROM fp_accounts WHERE id=$1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      reply.code(404).send({ error: 'Account not found' });
      return;
    }

    const row     = result.rows[0] as Record<string, unknown>;
    const address = row['wallet_address'] as string | null;
    const chain   = row['default_chain'] as string;

    // Optionally query live on-chain balance if wallet exists
    let chainUsdc = '0';
    if (address) {
      try {
        chainUsdc = await blockchain.getBalance(address, 'USDC', chain);
      } catch {
        // Non-fatal: return DB balance if RPC fails
      }
    }

    reply.send({
      account_id:   req.params.id,
      usdc:         row['balance_usdc'],
      usdt:         row['balance_usdt'],
      chain_balances: { [chain]: { usdc: chainUsdc, usdt: '0' } },
    });
  });

  // ── POST /v1/accounts/:id/kyc ──────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: KycBody }>('/:id/kyc', {
    schema: {
      body: {
        type: 'object',
        required: ['first_name', 'last_name', 'email', 'date_of_birth', 'address'],
        properties: {
          first_name:    { type: 'string' },
          last_name:     { type: 'string' },
          email:         { type: 'string' },
          date_of_birth: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          address: {
            type: 'object',
            required: ['line1', 'city', 'country', 'postal_code'],
            properties: {
              line1:       { type: 'string' },
              city:        { type: 'string' },
              country:     { type: 'string', minLength: 2, maxLength: 2 },
              postal_code: { type: 'string' },
            },
          },
          document_type: { type: 'string', enum: ['passport', 'driving_licence', 'national_identity_card'] },
        },
      },
    },
  }, async (req, reply) => {
    // Validate account exists
    const acctResult = await db.query(`SELECT id, merchant_id FROM fp_accounts WHERE id=$1`, [req.params.id]);
    if (acctResult.rows.length === 0) {
      reply.code(404).send({ error: 'Account not found' });
      return;
    }
    const { merchant_id } = acctResult.rows[0] as Record<string, unknown>;

    const verification = await kyc.submitKyc({
      accountId:    req.params.id,
      firstName:    req.body.first_name,
      lastName:     req.body.last_name,
      email:        req.body.email,
      dateOfBirth:  req.body.date_of_birth,
      address: {
        line1:      req.body.address.line1,
        city:       req.body.address.city,
        country:    req.body.address.country,
        postalCode: req.body.address.postal_code,
      },
      documentType: req.body.document_type,
    });

    await forwardToUnifiedRouter(buildEvent(
      'account.kyc.submitted', merchant_id as string, req.params.id,
      { kycId: verification.id, status: verification.status },
    ));

    reply.code(201).send(verification);
  });

  // ── GET /v1/accounts/:id/kyc ───────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id/kyc', async (req, reply) => {
    const verification = await kyc.getKycStatus(req.params.id);
    if (!verification) {
      reply.code(404).send({ error: 'No KYC verification found for this account' });
      return;
    }
    reply.send(verification);
  });
}
