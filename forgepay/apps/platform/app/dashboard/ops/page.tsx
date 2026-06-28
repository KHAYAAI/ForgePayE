export default function OpsDashboard() {
  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ marginBottom: 8 }}>🚨 Operations Dashboard</h1>
        <p style={{ color: 'var(--text-light)' }}>
          System health, monitoring alerts, and critical incident tracking
        </p>
      </div>

      {/* System Status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24, marginBottom: 40 }}>
        <StatusCard status="✅ Operational" title="Payment Router" uptime="99.97% this month" />
        <StatusCard status="✅ Operational" title="Kill Bill Sync" uptime="Last sync: 3 min ago" />
        <StatusCard status="✅ Operational" title="Email Queue" uptime="23 jobs pending" />
        <StatusCard status="✅ Operational" title="Database" uptime="98.2% uptime" />
      </div>

      {/* Alerts */}
      <Card title="Active Alerts">
        <div style={{ color: 'var(--text-light)' }}>
          <p>✅ All systems nominal</p>
          <p style={{ marginTop: 8, fontSize: 12 }}>Last alert: 2 days ago (resolved)</p>
        </div>
      </Card>

      {/* Kill Bill Sync */}
      <Card title="Kill Bill Subscription Sync">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Last Verification</td>
              <td style={{ padding: 12, fontWeight: 600 }}>2026-06-28 14:45:32</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Total Verified</td>
              <td style={{ padding: 12, fontWeight: 600 }}>1,247 subscriptions</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Divergences Detected</td>
              <td style={{ padding: 12, color: '#4ECB60' }}>0</td>
            </tr>
            <tr>
              <td style={{ padding: 12 }}>Reconciliations Done</td>
              <td style={{ padding: 12, color: '#4ECB60' }}>0</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Support Metrics */}
      <Card title="Support Team Metrics">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Stat label="Tickets Today" value="12" />
          <Stat label="Avg Resolution" value="3.2h" good />
          <Stat label="SLA Compliance" value="100%" good />
          <Stat label="Escalations" value="0" good />
        </div>
      </Card>

      {/* Email Queue */}
      <Card title="Email Queue Status">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Stat label="Queue Depth" value="23 jobs" />
          <Stat label="Processing Rate" value="10/5s" good />
          <Stat label="Dead Letter" value="0" good />
          <Stat label="Avg Retry Rate" value="0.2%" good />
        </div>
      </Card>
    </div>
  );
}

function StatusCard({
  status,
  title,
  uptime,
}: {
  status: string;
  title: string;
  uptime: string;
}) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '2px solid #4ECB60' }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{status}</div>
      <p style={{ color: 'var(--text-light)', fontSize: 14, marginBottom: 12 }}>{title}</p>
      <p style={{ fontSize: 12, color: 'var(--text-light)' }}>{uptime}</p>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div style={{ background: '#f9f9f9', padding: 12, borderRadius: 8 }}>
      <p style={{ fontSize: 12, color: 'var(--text-light)', marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 700, color: good ? '#4ECB60' : 'var(--navy)' }}>
        {value}
      </p>
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
