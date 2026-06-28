export default function AnalyticsDashboard() {
  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ marginBottom: 8 }}>📈 Analytics Dashboard</h1>
        <p style={{ color: 'var(--text-light)' }}>
          Onboarding funnels, churn detection, and revenue metrics
        </p>
      </div>

      {/* Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24, marginBottom: 40 }}>
        <MetricCard
          title="Monthly Revenue"
          value="R63,500"
          change="Payments + Treasury + CB"
        />
        <MetricCard
          title="Churn Rate"
          value="2.1%"
          change="Target: <3%"
        />
        <MetricCard
          title="Onboarding Completion"
          value="78%"
          change="Payments: 85%, Treasury: 72%"
        />
        <MetricCard
          title="Email CTR"
          value="8.4%"
          change="Target: >5%"
        />
      </div>

      {/* Onboarding Funnel */}
      <Card title="Onboarding Funnel (Payments)">
        <FunnelStep step={1} label="Sign-up" value={100} />
        <FunnelStep step={2} label="Email Verified" value={96} />
        <FunnelStep step={3} label="Subscription Created" value={88} />
        <FunnelStep step={4} label="First Transaction" value={78} />
        <FunnelStep step={5} label="10+ Transactions" value={64} />
      </Card>

      {/* Churn Signals */}
      <Card title="Churn Risk Alerts">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Customer</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Signal</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Severity</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>CSM Action</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>CUST-045</td>
              <td style={{ padding: 12 }}>API inactivity 7 days</td>
              <td style={{ padding: 12, color: '#FFA500' }}>⚠️ Medium</td>
              <td style={{ padding: 12, color: '#4ECB60' }}>✅ Call scheduled</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>CUST-032</td>
              <td style={{ padding: 12 }}>MRR declined 35%</td>
              <td style={{ padding: 12, color: '#FF6B6B' }}>🔴 High</td>
              <td style={{ padding: 12, color: '#4ECB60' }}>✅ Outreach sent</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Email Performance */}
      <Card title="Email Campaign Performance">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Campaign</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Sent</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Opens</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Clicks</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>CTR</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Onboarding Series</td>
              <td style={{ padding: 12 }}>247</td>
              <td style={{ padding: 12 }}>142 (57%)</td>
              <td style={{ padding: 12 }}>23 (9.3%)</td>
              <td style={{ padding: 12, color: '#4ECB60', fontWeight: 600 }}>9.3%</td>
            </tr>
            <tr>
              <td style={{ padding: 12 }}>Promo: Launch Discount</td>
              <td style={{ padding: 12 }}>1200</td>
              <td style={{ padding: 12 }}>468 (39%)</td>
              <td style={{ padding: 12 }}>78 (6.5%)</td>
              <td style={{ padding: 12, fontWeight: 600 }}>6.5%</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Revenue Breakdown */}
      <Card title="Revenue Breakdown (MTD)">
        <div>
          <RevenueRow product="Forge Payments" amount="R15,000" percentage={24} />
          <RevenueRow product="Forge Treasury" amount="R40,000" percentage={63} />
          <RevenueRow product="Forge Credit Bureau" amount="R8,500" percentage={13} />
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #eee', fontWeight: 600, fontSize: 16 }}>
            Total: R63,500/mo
          </div>
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

function FunnelStep({
  step,
  label,
  value,
}: {
  step: number;
  label: string;
  value: number;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>
          {step}. {label}
        </span>
        <span style={{ color: 'var(--text-light)' }}>{value}%</span>
      </div>
      <div style={{ width: '100%', height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
        <div
          style={{
            width: `${value}%`,
            height: '100%',
            background: 'linear-gradient(90deg, var(--navy) 0%, var(--cyan) 100%)',
          }}
        />
      </div>
    </div>
  );
}

function RevenueRow({
  product,
  amount,
  percentage,
}: {
  product: string;
  amount: string;
  percentage: number;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span>{product}</span>
        <span style={{ fontWeight: 600 }}>{amount}</span>
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
      <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 4 }}>{percentage}% of total</div>
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
