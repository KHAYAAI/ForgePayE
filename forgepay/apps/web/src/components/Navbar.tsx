'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const navLinks = [
  { label: 'Features',   href: '#features' },
  { label: 'Pricing',    href: '#pricing' },
  { label: 'Docs',       href: '/docs' },
  { label: 'Blog',       href: '/blog' },
];

export default function Navbar() {
  const [scrolled,     setScrolled]     = useState(false);
  const [menuOpen,     setMenuOpen]     = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-navy-800/95 backdrop-blur-md border-b border-white/5 shadow-lg'
          : 'bg-transparent',
      )}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <ForgeLogo />
            <span className="text-xl font-bold tracking-tight text-white group-hover:text-cyan-500 transition-colors">
              ForgePay
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-gray-300 hover:text-cyan-400 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* CTA buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors px-4 py-2"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold bg-cyan-500 hover:bg-cyan-400 text-navy-800 px-5 py-2 rounded-lg transition-all duration-200 glow-cyan hover:shadow-cyan-500/50"
            >
              Start free
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 text-gray-400 hover:text-white"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-white/10 py-4 space-y-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-2 py-2 text-sm font-medium text-gray-300 hover:text-cyan-400"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-3 flex flex-col gap-2">
              <Link href="/login" className="text-sm text-center text-gray-300 py-2">
                Sign in
              </Link>
              <Link
                href="/signup"
                className="text-sm font-semibold bg-cyan-500 text-navy-800 text-center py-2.5 rounded-lg"
              >
                Start free
              </Link>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}

function ForgeLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Anvil / forge icon */}
      <path
        d="M4 20h20v2.5a1 1 0 01-1 1H5a1 1 0 01-1-1V20z"
        fill="#00F0FF"
        opacity="0.9"
      />
      <path
        d="M7 20V12c0-3.866 3.134-7 7-7s7 3.134 7 7v8"
        fill="none"
        stroke="#00F0FF"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10 14h8"
        stroke="#00F0FF"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle cx="14" cy="10" r="2" fill="#00F0FF" opacity="0.8" />
    </svg>
  );
}
