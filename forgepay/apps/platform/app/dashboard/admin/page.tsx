export default function AdminDashboard() {
  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ marginBottom: 8 }}>🛠️ Admin Panel</h1>
        <p style={{ color: 'var(--text-light)' }}>CSM tools, customer management, and churn playbook execution</p>
      </div>

      {/* Overview Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24, marginBottom: 40 }}>
        <MetricCard title="Active Customers" value="47" change="+8 this week" />
        <MetricCard title="MRR" value="R63,500" change="+15% vs last month" />
        <MetricCard title="Churn Risk (High)" value="3" change="Actively engaging" />
        <MetricCard title="Support SLA" value="100%" change="No breaches this week" />
      </div>

      {/* Churn Risk Queue */}
      <Card title="🔴 Churn Risk Queue">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee', background: '#f9f9f9' }}>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Customer</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Product</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Risk Signal</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Severity</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            <ChurnRiskRow
              customer="SnapPay Marketplace"
              product="Payments"
              signal="MRR down 35%"
              severity="HIGH"
              action="Schedule CSM call"
            />
            <ChurnRiskRow
              customer="Umuntu Fintech"
              product="Treasury"
              signal="API inactivity 7 days"
              severity="MEDIUM"
              action="Send check-in email"
            />
            <ChurnRiskRow
              customer="AfroBiz Lender"
              product="Credit Bureau"
              signal="Cancellation request"
              severity="CRITICAL"
              action="Escalate to founder"
            />
          </tbody>
        </table>
      </Card>

      {/* Churn Playbook */}
      <Card title="📋 Churn Retention Playbook">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 24 }}>
          <PlaybookAction
            title="Offer Pause (30 days)"
            description="Customer can pause billing for 30 days to evaluate"
            trigger="Low usage + inactivity"
            effectiveness="45% retention"
          />
          <PlaybookAction
            title="Downgrade Tier"
            description="Move to lower tier (e.g., Payments-only instead of bundle)"
            trigger="Budget concerns"
            effectiveness="60% retention"
          />
          <PlaybookAction
            title="10% Discount (6 months)"
            description="Lock in 10% discount for 6-month commitment"
            trigger="Price sensitivity"
            effectiveness="72% retention"
          />
          <PlaybookAction
            title="Extended Trial"
            description="Add 14 days free to re-engage user"
            trigger="Low engagement"
            effectiveness="38% retention"
          />
          <PlaybookAction
            title="Executive Call"
            description="Founder/CEO call with customer founder"
            trigger="CRITICAL churn"
            effectiveness="85% retention"
          />
          <PlaybookAction
            title="Custom Plan"
            description="Negotiate custom pricing/terms"
            trigger="Enterprise customer"
            effectiveness="90% retention"
          />
        </div>
      </Card>

      {/* Customer Management */}
      <Card title="👥 Customer Management">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 32 }}>
          <div>
            <h4 style={{ fontWeight: 600, marginBottom: 12, color: 'var(--navy)' }}>Quick Actions</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button style={{ padding: '10px 16px', background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                + Invite New Customer
              </button>
              <button style={{ padding: '10px 16px', background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Generate Bulk Invites
              </button>
              <button style={{ padding: '10px 16px', background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Export Customer List
              </button>
            </div>
          </div>

          <div>
            <h4 style={{ fontWeight: 600, marginBottom: 12, color: 'var(--navy)' }}>Bulk Operations</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button style={{ padding: '10px 16px', background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Apply Launch Discount
              </button>
              <button style={{ padding: '10px 16px', background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Send Announcement Email
              </button>
              <button style={{ padding: '10px 16px', background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                Trigger Onboarding Email
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Team Assignment */}
      <Card title="👤 CSM Team Assignment">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee', background: '#f9f9f9' }}>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>CSM</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Assigned Customers</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>MRR Managed</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Churn Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Thabo (Lead)</td>
              <td style={{ padding: 12 }}>15 customers</td>
              <td style={{ padding: 12, fontWeight: 600 }}>R28,500</td>
              <td style={{ padding: 12, color: '#4ECB60' }}>1.2%</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>Zama</td>
              <td style={{ padding: 12 }}>14 customers</td>
              <td style={{ padding: 12, fontWeight: 600 }}>R22,800</td>
              <td style={{ padding: 12, color: '#4ECB60' }}>2.1%</td>
            </tr>
            <tr>
              <td style={{ padding: 12 }}>Amara</td>
              <td style={{ padding: 12 }}>18 customers</td>
              <td style={{ padding: 12, fontWeight: 600 }}>R12,200</td>
              <td style={{ padding: 12, color: '#FFA500' }}>3.8%</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* Upsell Opportunities */}
      <Card title="💰 Upsell Opportunities">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee', background: '#f9f9f9' }}>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Customer</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Current</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>Recommended Upsell</th>
              <th style={{ textAlign: 'left', padding: 12, fontWeight: 600 }}>MRR Potential</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>SnapPay</td>
              <td style={{ padding: 12 }}>Payments</td>
              <td style={{ padding: 12 }}>+ Treasury (20 agents)</td>
              <td style={{ padding: 12, color: 'var(--cyan)', fontWeight: 600 }}>+R40K</td>
            </tr>
            <tr>
              <td style={{ padding: 12 }}>Umuntu</td>
              <td style={{ padding: 12 }}>Treasury</td>
              <td style={{ padding: 12 }}>+ Credit Bureau (bundle)</td>
              <td style={{ padding: 12, color: 'var(--cyan)', fontWeight: 600 }}>+R4.5K (saves 3.5K)</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, change }: { title: string; value: string; change: string }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, padding: 24, border: '1px solid #eee' }}>
      <p style={{ color: 'var(--text-light)', fontSize: 14, marginBottom: 8 }}>{title}</p>
      <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>{value}</div>
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

function ChurnRiskRow({
  customer,
  product,
  signal,
  severity,
  action,
}: {
  customer: string;
  product: string;
  signal: string;
  severity: string;
  action: string;
}) {
  const severityColor = severity === 'CRITICAL' ? '#FF6B6B' : severity === 'HIGH' ? '#FFA500' : '#FFD700';
  return (
    <tr style={{ borderBottom: '1px solid #eee' }}>
      <td style={{ padding: 12 }}>{customer}</td>
      <td style={{ padding: 12 }}>{product}</td>
      <td style={{ padding: 12 }}>{signal}</td>
      <td style={{ padding: 12, color: severityColor, fontWeight: 600 }}>{severity}</td>
      <td style={{ padding: 12 }}>
        <button style={{ padding: '6px 12px', background: 'var(--navy)', color: 'white', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
          {action}
        </button>
      </td>
    </tr>
  );
}

function PlaybookAction({
  title,
  description,
  trigger,
  effectiveness,
}: {
  title: string;
  description: string;
  trigger: string;
  effectiveness: string;
}) {
  return (
    <div style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, border: '1px solid #eee' }}>
      <h4 style={{ marginBottom: 8, color: 'var(--navy)', fontWeight: 600 }}>{title}</h4>
      <p style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 8 }}>{description}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: 'var(--text-light)' }}>Trigger: {trigger}</span>
        <span style={{ color: '#4ECB60', fontWeight: 600 }}>{effectiveness}</span>
      </div>
    </div>
  );
}
