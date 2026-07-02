import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { useContainer } from 'class-validator';

describe('Auth E2E Tests', () => {
  let app: INestApplication;
  let authToken: string;
  const testUser = {
    email: 'test@example.com',
    password: 'TestPassword123!',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.useGlobalPipes(new ValidationPipe());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Signup (POST /auth/signup)', () => {
    it('should create new user', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          email: testUser.email,
          password: testUser.password,
          username: 'testuser',
        })
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testUser.email);
      authToken = response.body.token;
    });

    it('should reject duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(409);
    });

    it('should reject weak password', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          email: 'new@example.com',
          password: '123',
        })
        .expect(400);
    });

    it('should reject invalid email', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          email: 'invalid-email',
          password: testUser.password,
        })
        .expect(400);
    });
  });

  describe('Login (POST /auth/login)', () => {
    it('should login with correct credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      authToken = response.body.token;
    });

    it('should reject incorrect password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword',
        })
        .expect(401);
    });

    it('should reject non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testUser.password,
        })
        .expect(401);
    });
  });

  describe('Get Me (GET /auth/me)', () => {
    it('should return current user', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.email).toBe(testUser.email);
    });

    it('should reject request without token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);
    });

    it('should reject request with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('Refresh Token (POST /auth/refresh)', () => {
    it('should refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('token');
      authToken = response.body.token;
    });

    it('should reject without token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .expect(401);
    });
  });

  describe('Logout (POST /auth/logout)', () => {
    it('should logout user', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Token should be invalid after logout
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(401);
    });
  });
});
