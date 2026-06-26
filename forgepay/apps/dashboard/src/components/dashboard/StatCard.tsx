interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
  sublabel?: string;
}

export default function StatCard({ label, value, change, changeType = 'neutral', sublabel }: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[#6B7280] mb-3">{label}</div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-mono font-bold text-white tracking-tight leading-none">{value}</span>
        {change && (
          <span className={`text-xs font-mono ${
            changeType === 'up'   ? 'text-[#39D353]' :
            changeType === 'down' ? 'text-[#EF4444]' :
            'text-[#6B7280]'
          }`}>
            {changeType === 'up' ? '↑' : changeType === 'down' ? '↓' : ''} {change}
          </span>
        )}
      </div>
      {sublabel && <div className="mt-2 text-[10px] text-[#444] font-mono">{sublabel}</div>}
    </div>
  );
}
