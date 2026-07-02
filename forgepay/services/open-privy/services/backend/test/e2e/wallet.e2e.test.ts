import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Wallet E2E Tests', () => {
  let app: INestApplication;
  let authToken: string;
  let walletId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    // Signup and get token
    const signupRes = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `wallet-test-${Date.now()}@example.com`,
        password: 'TestPassword123!',
      });

    authToken = signupRes.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Create Wallet (POST /wallet/create)', () => {
    it('should create Ethereum wallet', async () => {
      const response = await request(app.getHttpServer())
        .post('/wallet/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ chain: 'ethereum' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('address');
      expect(response.body.chain).toBe('ethereum');
      expect(response.body.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      walletId = response.body.id;
    });

    it('should create Polygon wallet', async () => {
      const response = await request(app.getHttpServer())
        .post('/wallet/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ chain: 'polygon' })
        .expect(201);

      expect(response.body.chain).toBe('polygon');
      expect(response.body.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should create Solana wallet', async () => {
      const response = await request(app.getHttpServer())
        .post('/wallet/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ chain: 'solana' })
        .expect(201);

      expect(response.body.chain).toBe('solana');
      // Solana addresses are 32-50 character base58
      expect(response.body.address.length).toBeGreaterThanOrEqual(32);
    });

    it('should reject unsupported chain', async () => {
      await request(app.getHttpServer())
        .post('/wallet/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ chain: 'invalid-chain' })
        .expect(400);
    });

    it('should reject duplicate wallet', async () => {
      await request(app.getHttpServer())
        .post('/wallet/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ chain: 'ethereum' })
        .expect(409);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/wallet/create')
        .send({ chain: 'ethereum' })
        .expect(401);
    });
  });

  describe('Get Wallet (GET /wallet/get)', () => {
    it('should get wallet by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/wallet/${walletId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.id).toBe(walletId);
      expect(response.body.chain).toBe('ethereum');
    });

    it('should get user wallets', async () => {
      const response = await request(app.getHttpServer())
        .get('/wallet/list')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('should reject non-existent wallet', async () => {
      await request(app.getHttpServer())
        .get('/wallet/nonexistent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('Get Balance (GET /wallet/:id/balance)', () => {
    it('should get wallet balance', async () => {
      const response = await request(app.getHttpServer())
        .get(`/wallet/${walletId}/balance`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('balance');
      expect(typeof response.body.balance).toBe('string');
    });

    it('should handle invalid wallet', async () => {
      await request(app.getHttpServer())
        .get('/wallet/invalid-id/balance')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('Set Recovery Email (POST /wallet/:id/recovery-email)', () => {
    it('should set recovery email', async () => {
      const response = await request(app.getHttpServer())
        .post(`/wallet/${walletId}/recovery-email`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'recovery@example.com' })
        .expect(200);

      expect(response.body.recoveryEmail).toBe('recovery@example.com');
    });

    it('should reject invalid email', async () => {
      await request(app.getHttpServer())
        .post(`/wallet/${walletId}/recovery-email`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'invalid-email' })
        .expect(400);
    });
  });
});
