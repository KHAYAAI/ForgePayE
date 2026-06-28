import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@forgepay.co.za',
      ...options,
    });
    return true;
  } catch (error) {
    console.error('Email send error:', error);
    return false;
  }
}

export function generateVerificationLink(token: string): string {
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/auth/verify-email?token=${token}`;
}

export async function sendVerificationEmail(email: string, token: string): Promise<boolean> {
  const verificationLink = generateVerificationLink(token);
  return sendEmail({
    to: email,
    subject: 'Verify your ForgePay account',
    html: `
      <h2>Welcome to ForgePay!</h2>
      <p>Click the link below to verify your email address:</p>
      <p><a href="${verificationLink}">Verify Email</a></p>
      <p>Or copy and paste this link: ${verificationLink}</p>
      <p>This link expires in 24 hours.</p>
    `,
    text: `Verify your email: ${verificationLink}`,
  });
}

export async function sendApiKeyEmail(email: string, apiKey: string): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: 'Your ForgePay API Key',
    html: `
      <h2>API Key Generated</h2>
      <p>Your new API key is:</p>
      <code style="background: #f5f5f5; padding: 12px; border-radius: 6px; display: inline-block; font-family: monospace; font-weight: bold;">
        ${apiKey}
      </code>
      <p>Keep this secure and never share it. You can regenerate it anytime in your settings.</p>
    `,
    text: `Your API key: ${apiKey}`,
  });
}

export async function sendOnboardingEmail(email: string, name: string): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: 'Getting started with ForgePay',
    html: `
      <h2>Welcome, ${name}!</h2>
      <p>You're all set to start using ForgePay.</p>
      <h3>Next Steps:</h3>
      <ol>
        <li>Create your first subscription (Payments, Treasury, or Credit Bureau)</li>
        <li>Generate an API key from your dashboard</li>
        <li>Start integrating with our SDK</li>
        <li>Monitor transactions in real-time</li>
      </ol>
      <p><a href="http://localhost:3000/dashboard">Go to Dashboard</a></p>
    `,
  });
}
