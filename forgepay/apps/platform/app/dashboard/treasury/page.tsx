export default function TreasuryDashboard() {
  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ marginBottom: 8 }}>💰 Forge Treasury</h1>
        <p style={{ color: 'var(--text-light)' }}>
          Multi-agent payout netting, OFAC screening, and FX optimization
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24, marginBottom: 40 }}>
        <MetricCard
          title="Daily Netting (Today)"
          value="R450,000"
          change="12 agents | 47 transactions"
          icon="✅"
        />
        <MetricCard
          title="Pending Settlements"
          value="3"
          change="Next batch: 4 hours"
          icon="⏳"
        />
        <MetricCard
          title="OFAC Status"
          value="All Clear"
          change="0 flagged, 0 false positives"
          icon="🛡️"
        />
        <MetricCard
          title="FX Savings (MTD)"
          value="R8,200"
          change="vs market average"
          icon="💹"
        />
      </div>

      {/* Agent Netting */}
      <Card title="Agent Settlement Queue">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Agent</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Payable</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Method</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Agent-001</td>
              <td style={{ padding: 12, fontWeight: 600 }}>R125,000</td>
              <td style={{ padding: 12 }}>✅ Settled</td>
              <td style={{ padding: 12 }}>Bank EFT</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Agent-002</td>
              <td style={{ padding: 12, fontWeight: 600 }}>R87,500</td>
              <td style={{ padding: 12 }}>✅ Settled</td>
              <td style={{ padding: 12 }}>USDC</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Agent-003</td>
              <td style={{ padding: 12, fontWeight: 600 }}>R62,300</td>
              <td style={{ padding: 12 }}>⏳ Processing</td>
              <td style={{ padding: 12 }}>Bank EFT</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* OFAC Screening Log */}
      <Card title="Recent OFAC Screening">
        <div style={{ padding: 12 }}>
          <p style={{ marginBottom: 8 }}>✅ 1,247 agents screened today</p>
          <p style={{ marginBottom: 8, color: 'var(--text-light)' }}>False positive rate: 0.08% (flagged for manual review)</p>
          <p style={{ color: '#4ECB60' }}>All screens completed under 2s</p>
        </div>
      </Card>
    </div>
  );
}

function MetricCard({
  title,
  value,
  change,
  icon,
}: {
  title: string;
  value: string;
  change: string;
  icon: string;
}) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #eee' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <p style={{ color: 'var(--text-light)', fontSize: 14, marginBottom: 8 }}>{title}</p>
      <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{value}</div>
      <p style={{ fontSize: 12, color: 'var(--text-light)' }}>{change}</p>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #eee', marginBottom: 24 }}>
      {title && <h3 style={{ marginBottom: 20, fontSize: 16, fontWeight: 600 }}>{title}</h3>}
      {children}
    </div>
  );
}
