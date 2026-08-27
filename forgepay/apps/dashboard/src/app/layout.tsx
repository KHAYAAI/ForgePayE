import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: { default: 'ForgePay', template: '%s — ForgePay' },
  description: 'ForgePay operational dashboard',
  robots: 'noindex',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0A0A0A] text-white font-mono antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
