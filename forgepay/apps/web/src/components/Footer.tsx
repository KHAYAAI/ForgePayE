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
    { label: 'Privacy Policy', href: '/privacy' },
    { label: 'Terms of Service', href: '/terms' },
    { label: 'Security',       href: '/security' },
    { label: 'Compliance',     href: '/compliance' },
  ],
};

export default function Footer() {
  return (
    <footer className="border-t border-white/10 bg-navy-900/50 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-cyan-500 text-lg font-black">⚡</span>
              <span className="text-white font-bold text-lg">ForgePay</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Payments, forged better. The unified payments + billing + compliance platform for developers.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(FOOTER_LINKS).map(([group, links]) => (
            <div key={group}>
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4">
                {group}
              </h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-400 hover:text-cyan-400 transition-colors"
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
        <div className="flex flex-col sm:flex-row items-center justify-between pt-8 border-t border-white/10 gap-4">
          <p className="text-xs text-gray-600">
            © 2026 ForgePay, Inc. All rights reserved.
          </p>
          <p className="text-xs text-gray-600">
            Built on Apache 2.0 open-source software.{' '}
            <Link href="/attribution" className="text-gray-500 hover:text-gray-400">
              Attribution
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
