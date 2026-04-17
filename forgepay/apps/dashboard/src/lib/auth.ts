import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

// Extend next-auth types to carry the merchant's Hyperswitch API key in the JWT.
declare module 'next-auth' {
  interface Session {
    user: {
      id:      string;
      email:   string;
      name?:   string | null;
      apiKey:  string;
    };
  }
  interface User {
    id:     string;
    email:  string;
    name?:  string | null;
    apiKey: string;
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    apiKey: string;
  }
}

export const authOptions: NextAuthOptions = {
  secret: process.env['NEXTAUTH_SECRET'] ?? 'dev-nextauth-secret-change-me',
  session: { strategy: 'jwt' },
  pages: {
    signIn:  '/login',
    newUser: '/signup',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const adminEmail    = process.env['DASHBOARD_ADMIN_EMAIL']    ?? 'admin@forgepay.io';
        const adminPassword = process.env['DASHBOARD_ADMIN_PASSWORD'] ?? 'devpassword';
        const apiKey        = process.env['HYPERSWITCH_MERCHANT_API_KEY'] ?? '';

        if (
          credentials.email    !== adminEmail ||
          credentials.password !== adminPassword
        ) return null;

        return {
          id:     'merchant-1',
          email:  credentials.email,
          name:   'Merchant Admin',
          apiKey,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.apiKey = (user as { apiKey: string }).apiKey;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.apiKey = token.apiKey;
      return session;
    },
  },
};
