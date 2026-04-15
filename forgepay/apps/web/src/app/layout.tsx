import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ForgePay — Payments, forged better.',
  description:
    'The unified developer-first payments platform. Accept cards, bank transfers, stablecoins, and crypto. Built-in global tax compliance, advanced billing, and AI/agent payment support.',
  keywords: [
    'payments API',
    'stablecoin payments',
    'crypto payments',
    'merchant of record',
    'subscription billing',
    'usage-based billing',
    'AI payments',
    'x402',
  ],
  openGraph: {
    title: 'ForgePay — Payments, forged better.',
    description:
      'One API for cards, stablecoins, and crypto. Built-in global tax. Advanced billing for AI-native products.',
    type: 'website',
    siteName: 'ForgePay',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ForgePay — Payments, forged better.',
    description: 'One API for cards, stablecoins, and crypto. Built-in global tax. Advanced billing.',
  },
  themeColor: '#0A2540',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="bg-navy-800 text-white antialiased">{children}</body>
    </html>
  );
}
