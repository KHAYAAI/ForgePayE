import type { LucideIcon } from 'lucide-react';

/**
 * A single headline figure.
 *
 * Two call-site conventions had grown up against this component — one passing
 * `label`/`sublabel`, another passing `title`/`sub`/`icon`/`trend` that the
 * component never declared. The second failed to type-check on every use. This
 * is the one contract: `label` and `sublabel`, with an optional icon and
 * direction. Call sites were updated to match rather than the props being
 * widened to accept both spellings.
 */
interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
  sublabel?: string;
  icon?: LucideIcon;
}

export default function StatCard({
  label,
  value,
  change,
  changeType = 'neutral',
  sublabel,
  icon: Icon,
}: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[#6B7280]">{label}</div>
        {Icon && <Icon size={14} className="text-[#6B7280] shrink-0" aria-hidden />}
      </div>
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
