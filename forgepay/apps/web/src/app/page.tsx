/**
 * ARCH: ForgePay Marketing Site — home page
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Fully static marketing site. No API calls, no auth, no server components.
 * Can be deployed to any CDN (Vercel, Cloudflare Pages, etc.).
 *
 * Section order (matches scroll experience):
 *   Navbar        — sticky, ForgePay logo, Sign In / Get Started CTAs
 *   Hero          — headline, stats row (200 countries, 100 processors, 1.4% fee)
 *   Features      — 9 feature cards (fiat, stablecoin, crypto, subscriptions, tax, etc.)
 *   HowItWorks    — 3-step integration guide
 *   DeveloperPreview — live code snippet (SDK usage for card, USDC, subscription)
 *   Pricing       — Growth/Enterprise tiers + comparison vs Stripe/Paddle
 *   Footer        — links, legal
 *
 * Brand tokens (defined in tailwind.config.ts):
 *   navy.800  = #0A2540  (background)
 *   cyan.500  = #00F0FF  (accent/CTA)
 *   Font: Inter (variable) + JetBrains Mono (code blocks)
 *
 * NOTE: /login and /signup links in the Navbar point to the merchant dashboard.
 * Ensure the dashboard app is deployed at the same domain or configure redirects.
 */

import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Features from '@/components/Features';
import HowItWorks from '@/components/HowItWorks';
import Pricing from '@/components/Pricing';
import DeveloperPreview from '@/components/DeveloperPreview';
import Footer from '@/components/Footer';

export default function Home() {
  return (
    <main className="min-h-screen bg-navy-800">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <DeveloperPreview />
      <Pricing />
      <Footer />
    </main>
  );
}
