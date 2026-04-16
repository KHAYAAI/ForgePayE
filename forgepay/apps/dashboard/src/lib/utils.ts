import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(cents: number, currency = 'USD'): string {
  if (currency === 'USDC' || currency === 'USDT') {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
