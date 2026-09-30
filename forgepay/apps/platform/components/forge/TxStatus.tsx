'use client';

import { Pill, Mono } from './ui';
import { explorerUrl, TxStatus as Status } from './useCustody';

/* How a transfer stands on the network, described honestly:
   signed (no network) / broadcast / confirmed n / stuck / failed. */

type Tone = 'ok' | 'warn' | 'danger' | 'accent';

export function txPill(status: string, confirmations: number | null): { label: string; tone: Tone } {
  switch (status as Status) {
    case 'pending_approval': return { label: 'awaiting approval', tone: 'warn' };
    case 'rejected': return { label: 'rejected', tone: 'danger' };
    case 'signed': return { label: 'signed', tone: 'accent' };
    case 'broadcasting': return { label: 'broadcasting', tone: 'warn' };
    case 'signed_not_broadcast': return { label: 'signed · not broadcast', tone: 'danger' };
    case 'broadcasted': return { label: 'broadcast', tone: 'accent' };
    case 'confirmed': return { label: `confirmed ${confirmations ?? 1}`, tone: 'ok' };
    case 'stuck': return { label: 'stuck', tone: 'danger' };
    case 'failed': return { label: 'failed', tone: 'danger' };
    default: return { label: status.replace(/_/g, ' '), tone: 'accent' };
  }
}

export function TxStatusPill({ status, confirmations, detail }: { status: string; confirmations: number | null; detail?: string | null }) {
  const { label, tone } = txPill(status, confirmations);
  const showDetail = detail && ['signed_not_broadcast', 'stuck', 'failed'].includes(status);
  return (
    <span title={detail ?? ''}>
      <Pill tone={tone}>{label}</Pill>
      {showDetail && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--danger)', maxWidth: 280, marginTop: 4, overflowWrap: 'anywhere' }}>{detail}</span>
      )}
    </span>
  );
}

/** Short tx hash; a link to the block explorer only when NEXT_PUBLIC_EXPLORER_TX_URL is set. */
export function TxHash({ hash }: { hash: string | null | undefined }) {
  if (!hash) return <span>—</span>;
  const short = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  const url = explorerUrl(hash);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" title={hash}><Mono>{short}</Mono> ↗</a>
  ) : (
    <span title={hash}><Mono>{short}</Mono></span>
  );
}
