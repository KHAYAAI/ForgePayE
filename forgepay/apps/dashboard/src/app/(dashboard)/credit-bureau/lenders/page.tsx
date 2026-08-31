'use client';

const CONTRIBUTORS = [
  { id: 'contrib_aave',     name: 'Aave V3 Protocol',   type: 'defi_protocol',  records: 284000, used: 12450, allowed: 50000, status: 'active', joined: '2024-01-10' },
  { id: 'contrib_compound', name: 'Compound V3',          type: 'defi_protocol',  records: 91000,  used: 5200,  allowed: 20000, status: 'active', joined: '2024-02-15' },
  { id: 'contrib_openai',   name: 'OpenAI Platform',      type: 'saas_platform',  records: 14000,  used: 890,   allowed: 5000,  status: 'active', joined: '2024-04-01' },
  { id: 'contrib_morpho',   name: 'Morpho Blue',          type: 'defi_protocol',  records: 42000,  used: 3100,  allowed: 15000, status: 'active', joined: '2024-05-20' },
  { id: 'contrib_stripe',   name: 'Stripe (via ForgePay)',type: 'cefi_lender',    records: 180000, used: 28000, allowed: 75000, status: 'active', joined: '2024-03-01' },
  { id: 'contrib_fwb',      name: 'Friends With Benefits', type: 'dao',           records: 3200,   used: 120,   allowed: 2000,  status: 'pending', joined: '2024-12-01' },
  { id: 'contrib_mercury',  name: 'Mercury Bank',          type: 'bank',           records: 0,      used: 0,     allowed: 1000,  status: 'pending', joined: '2024-12-20' },
];

const TYPE_COLORS: Record<string, string> = {
  defi_protocol: 'text-[#A78BFA] bg-[#A78BFA12]',
  cefi_lender:   'text-[#60A5FA] bg-[#60A5FA12]',
  saas_platform: 'text-[#F59E0B] bg-[#F59E0B12]',
  bank:          'text-[#39D353] bg-[#39D35312]',
  dao:           'text-[#F472B6] bg-[#F472B612]',
};

function QueryBar({ used, allowed }: { used: number; allowed: number }) {
  const pct = Math.round((used / allowed) * 100);
  const color = pct > 80 ? '#EF4444' : pct > 60 ? '#F59E0B' : '#39D353';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px] font-mono text-[#444]">
        <span>{used.toLocaleString()} / {allowed.toLocaleString()}</span>
        <span style={{ color }}>{pct}%</span>
      </div>
      <div className="h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function LendersPage() {
  const totalRecords = CONTRIBUTORS.reduce((s, c) => s + c.records, 0);
  const totalQueries = CONTRIBUTORS.reduce((s, c) => s + c.used, 0);
  const active = CONTRIBUTORS.filter(c => c.status === 'active').length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-[#6B7280]">DATA CONTRIBUTORS & LENDERS</div>
          <div className="text-sm font-mono text-[#6B7280] mt-1">
            <span className="text-white">ACTIVE CONTRIBUTORS: {active}</span>
            <span className="mx-3 text-[#333]">|</span>
            <span>RECORDS CONTRIBUTED: {(totalRecords / 1000).toFixed(1)}K</span>
            <span className="mx-3 text-[#333]">|</span>
            <span>QUERIES TODAY: {totalQueries.toLocaleString()}</span>
          </div>
        </div>
        <button className="text-xs font-mono text-[#39D353] border border-[#39D353] px-4 py-2 hover:bg-[#39D35310] transition-colors">
          + REGISTER CONTRIBUTOR
        </button>
      </div>

      {/* Table */}
      <div className="card">
        <table className="fp-table w-full">
          <thead>
            <tr>
              <th>CONTRIBUTOR</th>
              <th>TYPE</th>
              <th>RECORDS</th>
              <th>QUERIES USED / ALLOWED</th>
              <th>STATUS</th>
              <th>JOINED</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {CONTRIBUTORS.map(c => (
              <tr key={c.id}>
                <td>
                  <div className="font-mono text-xs text-white font-medium">{c.name}</div>
                  <div className="font-mono text-[10px] text-[#444]">{c.id}</div>
                </td>
                <td>
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded ${TYPE_COLORS[c.type]}`}>
                    {c.type.replace('_', ' ').toUpperCase()}
                  </span>
                </td>
                <td className="font-mono text-xs text-white">{c.records.toLocaleString()}</td>
                <td className="min-w-[180px]"><QueryBar used={c.used} allowed={c.allowed} /></td>
                <td>
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded ${
                    c.status === 'active' ? 'text-[#39D353] bg-[#39D35312]' : 'text-[#F59E0B] bg-[#F59E0B12]'
                  }`}>
                    {c.status.toUpperCase()}
                  </span>
                </td>
                <td className="font-mono text-xs text-[#444]">{c.joined}</td>
                <td>
                  <div className="flex gap-1">
                    <button className="text-[9px] font-mono text-[#6B7280] border border-[#1E1E1E] px-1.5 py-0.5 hover:text-white hover:bg-[#1A1A1A]">STATS</button>
                    {c.status === 'pending' && (
                      <button className="text-[9px] font-mono text-[#39D353] border border-[#39D35330] px-1.5 py-0.5 hover:bg-[#39D35310]">APPROVE</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-5 py-3 border-t border-[#1A1A1A]">
          <span className="text-[10px] font-mono text-[#444]">
            {CONTRIBUTORS.length} contributors — {(totalRecords / 1000).toFixed(0)}K total records indexed
          </span>
        </div>
      </div>

      {/* Incentive info */}
      <div className="card p-5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[#6B7280] mb-3">INCENTIVE STRUCTURE</div>
        <div className="grid grid-cols-3 gap-4 text-xs font-mono">
          <div>
            <div className="text-[#39D353] font-bold">DATA CONTRIBUTORS</div>
            <div className="text-[#6B7280] mt-1">Earn 1 free API query for every 2 records contributed. Platinum tier at 500K+ records.</div>
          </div>
          <div>
            <div className="text-[#60A5FA] font-bold">LENDERS (CONSUMERS)</div>
            <div className="text-[#6B7280] mt-1">$0.05 per credit report pull. 50% of revenue redistributed to top contributors monthly.</div>
          </div>
          <div>
            <div className="text-[#F59E0B] font-bold">GOVERNANCE POWER</div>
            <div className="text-[#6B7280] mt-1">Contribute 100K+ records = 1 governance vote on scoring model updates.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
