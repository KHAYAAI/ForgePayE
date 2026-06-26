import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ForgePay — Payment infrastructure for autonomous economies.',
  description: 'One API for cards, stablecoins, crypto, and AI agent payments. Built-in compliance, credit bureau, and DeFi yield.',
  keywords: ['payments API', 'AI payments', 'credit bureau', 'stablecoin', 'x402'],
  openGraph: {
    title: 'ForgePay',
    description: 'Payment infrastructure for autonomous economies.',
    type: 'website',
  },
  themeColor: '#0A0A0A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="bg-[#0A0A0A] text-white antialiased">{children}</body>
    </html>
  );
}
