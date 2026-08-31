'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Text input, styled to match the dashboard's dark surfaces.
 *
 * Imported by the agents page since it was written; the file never existed,
 * which is one of the unresolved imports that kept this app from building.
 *
 * forwardRef because callers eventually want focus control and react-hook-form
 * registration, both of which need the underlying node.
 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white',
        'placeholder-gray-600 transition-colors',
        'focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = 'Input';

export default Input;
