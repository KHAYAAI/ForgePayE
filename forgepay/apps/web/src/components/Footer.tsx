import Link from 'next/link';

const FOOTER_LINKS = {
  Product: [
    { label: 'Features',     href: '#features' },
    { label: 'Pricing',      href: '#pricing' },
    { label: 'Changelog',    href: '/changelog' },
    { label: 'Status',       href: 'https://status.forgepay.io' },
  ],
  Developers: [
    { label: 'Documentation', href: '/docs' },
    { label: 'API Reference', href: '/docs/api' },
    { label: 'SDKs',          href: '/docs/sdks' },
    { label: 'GitHub',        href: 'https://github.com/forgepay' },
  ],
  Company: [
    { label: 'About',    href: '/about' },
    { label: 'Blog',     href: '/blog' },
    { label: 'Careers',  href: '/careers' },
    { label: 'Contact',  href: '/contact' },
  ],
  Legal: [
    { label: 'Privacy Policy',   href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Security',         href: '/security' },
    { label: 'Compliance',       href: '/compliance' },
  ],
};

export default function Footer() {
  return (
    <footer className="border-t border-[#1A1A1A] bg-[#0A0A0A] py-12 px-8">
      <div className="max-w-7xl mx-auto">
        {/* Top row: brand + links */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-white text-base font-mono font-bold">✳</span>
              <span className="text-white text-xs font-mono font-semibold tracking-widest">FORGEPAY</span>
            </div>
            <p className="text-[11px] font-mono text-[#6B7280] leading-relaxed">
              Payment infrastructure for autonomous economies.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(FOOTER_LINKS).map(([group, links]) => (
            <div key={group}>
              <h4 className="text-[10px] font-mono font-semibold text-[#6B7280] uppercase tracking-widest mb-4">
                {group}
              </h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-xs font-mono text-[#6B7280] hover:text-white transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pt-6 border-t border-[#1A1A1A] gap-3">
          <p className="text-[11px] font-mono text-[#6B7280]">
            © 2026 ForgePay, Inc. All rights reserved.
          </p>
          <p className="text-[11px] font-mono text-[#6B7280]">
            Built on Apache 2.0 open-source software.{' '}
            <Link href="/attribution" className="text-[#6B7280] hover:text-white transition-colors">
              Attribution
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
