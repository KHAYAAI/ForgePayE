import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  hashPassword,
  createUser,
  setAuthCookie,
  generateToken,
} from '@/lib/auth';
import { sendVerificationEmail, sendOnboardingEmail } from '@/lib/email';
import { query } from '@/lib/db';

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  password: z.string().min(8),
  company: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, name, password, company } = signupSchema.parse(body);

    // Check if user exists
    const existingUser = await query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409 }
      );
    }

    // Create tenant
    const tenantId = crypto.randomUUID();
    await query(
      `INSERT INTO tenants (id, name, status, created_at) VALUES ($1, $2, 'active', NOW())`,
      [tenantId, company || name]
    );

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const user = await createUser(email, name, passwordHash, tenantId);

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      tenantId: user.tenant_id,
    });

    // Set auth cookie
    await setAuthCookie(token);

    // Send verification email
    await sendVerificationEmail(email, token);

    // Send onboarding email
    await sendOnboardingEmail(email, name);

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: user.tenant_id,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Signup error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Signup failed' },
      { status: 500 }
    );
  }
}
