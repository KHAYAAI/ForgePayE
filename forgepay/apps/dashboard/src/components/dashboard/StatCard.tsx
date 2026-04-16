import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title:   string;
  value:   string;
  change?: string;
  trend?:  'up' | 'down' | 'neutral';
  icon:    LucideIcon;
  sub?:    string;
}

export default function StatCard({ title, value, change, trend = 'neutral', icon: Icon, sub }: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
          <Icon size={16} className="text-cyan-400" />
        </div>
        {change && (
          <span
            className={cn(
              'text-[11px] font-semibold px-2 py-0.5 rounded-full',
              trend === 'up'      && 'bg-emerald-500/10 text-emerald-400',
              trend === 'down'    && 'bg-red-500/10 text-red-400',
              trend === 'neutral' && 'bg-white/5 text-gray-400',
            )}
          >
            {change}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
      <div className="text-xs text-gray-400">{title}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-1">{sub}</div>}
    </div>
  );
}
