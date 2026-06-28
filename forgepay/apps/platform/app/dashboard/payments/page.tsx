import styles from '../dashboard.module.css';

export default function PaymentsDashboard() {
  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ marginBottom: 8 }}>💳 Forge Payments</h1>
        <p style={{ color: 'var(--text-light)' }}>
          Card and bank transfer processing with intelligent routing
        </p>
      </div>

      {/* Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24, marginBottom: 40 }}>
        <MetricCard
          title="Transactions (24h)"
          value="2,847"
          change="+12% vs yesterday"
          changePositive={true}
        />
        <MetricCard
          title="Success Rate"
          value="99.7%"
          change="0.1% above target"
          changePositive={true}
        />
        <MetricCard
          title="Fallback Usage"
          value="0.3%"
          change="Stripe → Circle"
          changePositive={true}
        />
        <MetricCard
          title="Avg Settlement"
          value="2.3s"
          change="Below 5s SLA"
          changePositive={true}
        />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24, marginBottom: 40 }}>
        <Card title="Payment Volume (24h)">
          <div style={{ height: 200, background: 'rgba(0, 240, 255, 0.1)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-light)' }}>
            Chart placeholder - Integration with Recharts
          </div>
        </Card>

        <Card title="Success Rate by Method">
          <div style={{ height: 200, background: 'rgba(0, 240, 255, 0.1)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-light)' }}>
            Chart placeholder - Stripe vs Circle
          </div>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card title="Recent Transactions">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>ID</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Amount</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Status</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Method</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Time</th>
            </tr>
          </thead>
          <tbody>
            <TransactionRow id="TXN-001" amount="R2,500" status="✅ Completed" method="Card" time="2 min ago" />
            <TransactionRow id="TXN-002" amount="R5,000" status="✅ Completed" method="Bank" time="5 min ago" />
            <TransactionRow id="TXN-003" amount="R1,200" status="⏳ Processing" method="Card" time="12 min ago" />
            <TransactionRow id="TXN-004" amount="R3,800" status="✅ Completed" method="USDC" time="15 min ago" />
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function MetricCard({
  title,
  value,
  change,
  changePositive,
}: {
  title: string;
  value: string;
  change: string;
  changePositive: boolean;
}) {
  return (
    <Card>
      <p style={{ color: 'var(--text-light)', fontSize: 14, marginBottom: 8 }}>{title}</p>
      <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>{value}</div>
      <p style={{ fontSize: 12, color: changePositive ? '#4ECB60' : '#FF6B6B' }}>{change}</p>
    </Card>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #eee', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)' }}>
      {title && <h3 style={{ marginBottom: 20, fontSize: 16, fontWeight: 600 }}>{title}</h3>}
      {children}
    </div>
  );
}

function TransactionRow({
  id,
  amount,
  status,
  method,
  time,
}: {
  id: string;
  amount: string;
  status: string;
  method: string;
  time: string;
}) {
  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td style={{ padding: 12, fontSize: 14 }}>{id}</td>
      <td style={{ padding: 12, fontSize: 14, fontWeight: 600 }}>{amount}</td>
      <td style={{ padding: 12, fontSize: 14 }}>{status}</td>
      <td style={{ padding: 12, fontSize: 14 }}>{method}</td>
      <td style={{ padding: 12, fontSize: 14, color: 'var(--text-light)' }}>{time}</td>
    </tr>
  );
}
