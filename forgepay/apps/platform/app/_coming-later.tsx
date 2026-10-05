import Link from 'next/link';

/**
 * A product page for something that has not launched. It says what exists today and what has to happen first, and
 * nothing else: no prices, trials, SLAs or results, because there are no customers and nothing to guarantee yet.
 */
export function ComingLater({ name, summary, built, before }: { name: string; summary: string; built: string[]; before: string[] }) {
  return (
    <div>
      <nav style={{ position: 'fixed', top: 0, width: '100%', background: 'rgba(255, 255, 255, 0.98)', borderBottom: '1px solid #eee', padding: '16px 40px', zIndex: 1000 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between' }}>
          <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)', textDecoration: 'none' }}>
            Forge<span style={{ color: 'var(--cyan)' }}>Pay</span>
          </Link>
          <Link href="/products/credit-bureau" className="btn-primary">Credit Bureau</Link>
        </div>
      </nav>
      <section style={{ padding: '140px 40px 60px', textAlign: 'center', marginTop: 60 }}>
        <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--text-light)' }}>Not yet available</p>
        <h1 style={{ fontSize: 44, fontWeight: 700, margin: '12px 0 16px', color: 'var(--navy)' }}>{name}</h1>
        <p style={{ fontSize: 18, color: 'var(--text-light)', maxWidth: 640, margin: '0 auto' }}>{summary}</p>
      </section>
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 40px 100px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 32 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)', marginBottom: 12 }}>What exists today</h2>
          <ul style={{ lineHeight: 1.8, color: 'var(--text)' }}>{built.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)', marginBottom: 12 }}>Before it opens</h2>
          <ul style={{ lineHeight: 1.8, color: 'var(--text)' }}>{before.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      </section>
      <footer style={{ background: 'var(--navy)', color: 'white', textAlign: 'center', padding: 40 }}>
        <p>Want to hear when it opens? <a href="mailto:hello@myforgepay.com" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>Get in touch</a></p>
      </footer>
    </div>
  );
}
