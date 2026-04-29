'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'line' | 'card' | 'stat' | 'circle';
}

export function Skeleton({ className, variant = 'line' }: SkeletonProps) {
  const base = 'animate-pulse rounded bg-white/[0.06]';
  const variants = {
    line:   'h-4 w-full',
    card:   'h-32 w-full rounded-xl',
    stat:   'h-24 w-full rounded-xl',
    circle: 'h-10 w-10 rounded-full',
  };
  return <div className={cn(base, variants[variant], className)} />;
}

export function StatCardSkeleton() {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton variant="line" className="w-24 h-3" />
        <Skeleton variant="circle" className="h-8 w-8" />
      </div>
      <Skeleton variant="line" className="w-32 h-7" />
      <Skeleton variant="line" className="w-20 h-3" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b border-white/[0.05]">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton variant="line" className={i === 0 ? 'w-28' : 'w-16'} />
        </td>
      ))}
    </tr>
  );
}
