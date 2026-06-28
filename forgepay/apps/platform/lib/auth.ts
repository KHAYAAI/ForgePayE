import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { query, queryOne } from './db';

export interface TokenPayload {
  userId: string;
  email: string;
  tenantId: string;
  iat?: number;
  exp?: number;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const JWT_EXPIRY = '7d';

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set('auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete('auth-token');
}

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  tenant_id: string;
  api_key: string;
  status: 'active' | 'inactive';
  created_at: Date;
  updated_at: Date;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT * FROM users WHERE email = $1 AND status = 'active'`,
    [email]
  );
}

export async function getUserById(userId: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT * FROM users WHERE id = $1 AND status = 'active'`,
    [userId]
  );
}

export async function createUser(
  email: string,
  name: string,
  passwordHash: string,
  tenantId: string
): Promise<User> {
  const userId = crypto.randomUUID();
  const apiKey = crypto.randomUUID();

  const result = await queryOne<User>(
    `INSERT INTO users (id, email, name, password_hash, tenant_id, api_key, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW())
     RETURNING *`,
    [userId, email, name, passwordHash, tenantId, apiKey]
  );

  if (!result) throw new Error('Failed to create user');
  return result;
}

export async function generateApiKey(userId: string): Promise<string> {
  const newApiKey = crypto.randomUUID();
  await query(
    `UPDATE users SET api_key = $1, updated_at = NOW() WHERE id = $2`,
    [newApiKey, userId]
  );
  return newApiKey;
}

export async function verifyApiKey(apiKey: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT * FROM users WHERE api_key = $1 AND status = 'active'`,
    [apiKey]
  );
}
