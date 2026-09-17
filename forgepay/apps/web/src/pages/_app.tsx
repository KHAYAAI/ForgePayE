/**
 * ARCH: Pages Router entry point.
 * ──────────────────────────────────────────────────────────────────────────────
 * This didn't exist. Every page under src/pages/ (products/*, checkout/*) has
 * been rendering with zero Tailwind or global CSS since the site has both an
 * App Router (src/app/) and a Pages Router (src/pages/) side, and only the App
 * Router half had globals.css wired in via its own layout.tsx. Confirmed live:
 * a rendered products/credit-bureau screenshot came back as plain black-on-
 * white text, no dark background, no color, no font — the exact signature of
 * this missing import, not a bug in any individual page's own markup.
 */

import type { AppProps } from 'next/app';
import '@/app/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
