import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ForgePay Dashboard', template: '%s — ForgePay' },
  description: 'ForgePay merchant dashboard',
  robots: 'noindex',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
