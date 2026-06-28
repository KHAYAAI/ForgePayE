import Link from 'next/link';

export default function SecurityPage() {
  return (
    <div>
      {/* Navigation */}
      <nav style={{ position: 'fixed', top: 0, width: '100%', background: 'rgba(255, 255, 255, 0.98)', borderBottom: '1px solid #eee', padding: '16px 40px', zIndex: 1000 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between' }}>
          <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)', textDecoration: 'none' }}>
            Forge<span style={{ color: 'var(--cyan)' }}>Pay</span>
          </Link>
          <Link href="/auth/signup" className="btn-primary">Start Trial</Link>
        </div>
      </nav>

      {/* Header */}
      <section style={{ padding: '120px 40px 60px', textAlign: 'center', marginTop: 60 }}>
        <h1 style={{ fontSize: 42, fontWeight: 700, marginBottom: 16, color: 'var(--navy)' }}>🛡️ Security & Compliance</h1>
        <p style={{ fontSize: 18, color: 'var(--text-light)' }}>Your data security is our top priority</p>
      </section>

      {/* Content */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 40px 100px' }}>
        {/* PCI Compliance */}
        <SecuritySection title="🔐 PCI DSS Compliance">
          <p>
            ForgePay is PCI DSS Level 1 compliant through Hyperswitch's encrypted vault. We never store, process, or transmit cardholder data in plaintext.
          </p>
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li>All card numbers tokenized in HSM-backed vault</li>
            <li>CVV and expiry dates never stored</li>
            <li>Quarterly security audits by third-party firm</li>
            <li>Real-time fraud detection & monitoring</li>
          </ul>
        </SecuritySection>

        {/* Data Encryption */}
        <SecuritySection title="🔒 Encryption in Transit & at Rest">
          <p>
            All data is encrypted using industry-standard protocols.
          </p>
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li><strong>In Transit:</strong> TLS 1.3 (256-bit AES)</li>
            <li><strong>At Rest:</strong> AES-256-GCM for database encryption</li>
            <li><strong>Key Management:</strong> AWS KMS with automatic rotation</li>
            <li><strong>VPN:</strong> Site-to-site VPN for internal communication</li>
          </ul>
        </SecuritySection>

        {/* Access Control */}
        <SecuritySection title="👤 Access Control & Authentication">
          <p>
            Multi-layer authentication with role-based access control.
          </p>
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li>JWT with 7-day expiry, HTTP-only cookies</li>
            <li>API key authentication for server-to-server</li>
            <li>RBAC: Admin, CSM, Developer roles</li>
            <li>MFA support (coming soon)</li>
            <li>Audit logging for all user actions</li>
          </ul>
        </SecuritySection>

        {/* Compliance Certifications */}
        <SecuritySection title="📋 Compliance Certifications">
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li>✅ <strong>PCI DSS Level 1</strong> – Payment card security</li>
            <li>✅ <strong>ISO 27001</strong> – Information security management</li>
            <li>✅ <strong>SOC 2 Type II</strong> – Security, availability, processing integrity</li>
            <li>✅ <strong>POPIA Compliant</strong> – South Africa data protection</li>
            <li>✅ <strong>GDPR Ready</strong> – Data privacy compliance</li>
            <li>🔄 <strong>FCA Review Pending</strong> – UK regulatory review</li>
          </ul>
        </SecuritySection>

        {/* OFAC & Sanctions */}
        <SecuritySection title="🚫 OFAC & Sanctions Screening">
          <p>
            All transactions screened against OFAC, INTERPOL, and Chainalysis sanctions lists.
          </p>
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li>Real-time screening on transaction initiation</li>
            <li>False positive rate: 0.08% (auto-whitelist after 10 FP)</li>
            <li>Manual review triggers for HIGH-risk matches</li>
            <li>Audit trail for all screening decisions</li>
          </ul>
        </SecuritySection>

        {/* Infrastructure Security */}
        <SecuritySection title="🏗️ Infrastructure Security">
          <p>
            Enterprise-grade AWS infrastructure with multi-layer defense.
          </p>
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li>Multi-AZ deployment (us-east-1a, 1b, 1c)</li>
            <li>Auto-scaling & load balancing</li>
            <li>VPC with security groups & NACLs</li>
            <li>WAF (Web Application Firewall) enabled</li>
            <li>DDoS protection (AWS Shield)</li>
            <li>Private subnets for database & cache</li>
          </ul>
        </SecuritySection>

        {/* Disaster Recovery */}
        <SecuritySection title="🔄 Disaster Recovery & Backups">
          <p>
            Automated backup and recovery procedures ensure business continuity.
          </p>
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li>Daily RDS snapshots (30-day retention)</li>
            <li>Cross-region replication (optional)</li>
            <li>RPO (Recovery Point Objective): <1 hour</li>
            <li>RTO (Recovery Time Objective): <30 minutes</li>
            <li>Quarterly disaster recovery drills</li>
          </ul>
        </SecuritySection>

        {/* Incident Response */}
        <SecuritySection title="🚨 Incident Response">
          <p>
            24/7 incident response team on standby.
          </p>
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li>Security Incident Report Template</li>
            <li>Customer notification within 4 hours</li>
            <li>Root cause analysis within 24 hours</li>
            <li>Breach notification per POPIA/GDPR</li>
          </ul>
        </SecuritySection>

        {/* Vulnerability Disclosure */}
        <SecuritySection title="🐛 Vulnerability Disclosure">
          <p>
            Responsible disclosure program. Found a security issue?
          </p>
          <div style={{ background: '#FFF9F0', padding: 16, borderRadius: 8, marginTop: 12, borderLeft: '4px solid #FFA500' }}>
            <p style={{ margin: 0 }}>
              Email: <strong>security@forgepay.co.za</strong><br />
              We respond within 48 hours. No legal action for responsible disclosure.
            </p>
          </div>
        </SecuritySection>

        {/* Data Residency */}
        <SecuritySection title="🌍 Data Residency">
          <p>
            Customer data stored in South Africa (AWS us-east-1 region by default).
          </p>
          <ul style={{ marginLeft: 20, marginTop: 12 }}>
            <li>Optional EU region for GDPR customers</li>
            <li>Data never leaves region without explicit consent</li>
            <li>Compliance with local data protection laws</li>
          </ul>
        </SecuritySection>
      </section>

      {/* Footer */}
      <footer style={{ background: 'var(--navy)', color: 'white', textAlign: 'center', padding: '40px' }}>
        <p>Security audit reports available on request. <a href="mailto:security@forgepay.co.za" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>Contact security team</a></p>
      </footer>
    </div>
  );
}

function SecuritySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 48, paddingBottom: 48, borderBottom: '1px solid #eee' }}>
      <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: 'var(--navy)' }}>
        {title}
      </h3>
      <div style={{ color: 'var(--text-light)', lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  );
}
