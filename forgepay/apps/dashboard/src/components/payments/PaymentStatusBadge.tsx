import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  succeeded:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  failed:     'bg-red-500/10 text-red-400 border-red-500/20',
  processing: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  cancelled:  'bg-gray-500/10 text-gray-400 border-gray-500/20',
  refunded:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
  pending:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

export default function PaymentStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center text-[10px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5',
        STATUS_STYLES[status] ?? 'bg-white/5 text-gray-400 border-white/10',
      )}
    >
      {status}
    </span>
  );
}
