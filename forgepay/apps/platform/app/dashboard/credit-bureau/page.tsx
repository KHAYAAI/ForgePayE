export default function CreditBureauDashboard() {
  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ marginBottom: 8 }}>📊 Forge Credit Bureau</h1>
        <p style={{ color: 'var(--text-light)' }}>
          Dual-mode credit scoring with Mode 1 (FICO) and Mode 2 (On-chain Ops)
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24, marginBottom: 40 }}>
        <MetricCard title="Inquiries (24h)" value="487" change="↑ 8% vs yesterday" />
        <MetricCard title="Avg Mode 1 Score" value="68 pts" change="Traditional FICO" />
        <MetricCard title="Avg Mode 2 Score" value="72 pts" change="On-chain operational" />
        <MetricCard title="Variance Alerts" value="12" change="Scores reviewed" />
      </div>

      {/* Scoring Modes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 24, marginBottom: 40 }}>
        <Card title="Mode 1: FICO Scoring">
          <div style={{ paddingBottom: 12 }}>
            <ScoreFactor label="Payment History" percentage={40} />
            <ScoreFactor label="Transaction Volume" percentage={30} />
            <ScoreFactor label="Account Age" percentage={20} />
            <ScoreFactor label="Risk Profile" percentage={10} />
          </div>
        </Card>

        <Card title="Mode 2: On-Chain Scoring">
          <div>
            <ScoreFactor label="Success Rate" percentage={35} />
            <ScoreFactor label="Transaction Volume" percentage={30} />
            <ScoreFactor label="Compliance Status" percentage={20} />
            <ScoreFactor label="Account Age" percentage={15} />
          </div>
        </Card>
      </div>

      {/* Recent Scores */}
      <Card title="Recent Credit Inquiries">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Customer</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Mode 1</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Mode 2</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Variance</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>CUST-001</td>
              <td style={{ padding: 12 }}>62</td>
              <td style={{ padding: 12 }}>68</td>
              <td style={{ padding: 12, color: '#FFA500' }}>+6 pts</td>
              <td style={{ padding: 12 }}>Approve</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>CUST-002</td>
              <td style={{ padding: 12 }}>75</td>
              <td style={{ padding: 12 }}>74</td>
              <td style={{ padding: 12, color: '#4ECB60' }}>-1 pts</td>
              <td style={{ padding: 12 }}>Approve</td>
            </tr>
            <tr>
              <td style={{ padding: 12 }}>CUST-003</td>
              <td style={{ padding: 12 }}>45</td>
              <td style={{ padding: 12 }}>52</td>
              <td style={{ padding: 12, color: '#FFA500' }}>+7 pts</td>
              <td style={{ padding: 12 }}>Review</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Revenue from Inquiries */}
      <Card title="Revenue from Inquiry Sharing">
        <div>
          <p style={{ marginBottom: 12 }}>
            <strong>Monthly Inquiries:</strong> 14,600 inquiries
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong>Avg Inquiry Value:</strong> R100 per inquiry
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong>Your Share (25%):</strong> <span style={{ fontSize: 20, fontWeight: 700 }}>R36,500/mo</span>
          </p>
          <p style={{ color: 'var(--text-light)', fontSize: 13 }}>
            Plus R8,500/mo base subscription = R45K total monthly revenue
          </p>
        </div>
      </Card>
    </div>
  );
}

function MetricCard({
  title,
  value,
  change,
}: {
  title: string;
  value: string;
  change: string;
}) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #eee' }}>
      <p style={{ color: 'var(--text-light)', fontSize: 14, marginBottom: 8 }}>{title}</p>
      <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>{value}</div>
      <p style={{ fontSize: 12, color: 'var(--text-light)' }}>{change}</p>
    </div>
  );
}

function ScoreFactor({ label, percentage }: { label: string; percentage: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{percentage}%</span>
      </div>
      <div style={{ width: '100%', height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: `${percentage}%`,
            height: '100%',
            background: 'var(--cyan)',
          }}
        />
      </div>
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
