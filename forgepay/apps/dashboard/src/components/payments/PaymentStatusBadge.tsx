const STATUS_CLASS: Record<string, string> = {
  succeeded:  'status-success',
  failed:     'status-error',
  processing: 'status-warning',
  cancelled:  'status-pending',
  refunded:   'status-pending',
  pending:    'status-pending',
};

export default function PaymentStatusBadge({ status }: { status: string }) {
  const cls = STATUS_CLASS[status] ?? 'status-pending';
  return (
    <span className={`inline-flex items-center uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}
