'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Search, Shield, X, CreditCard, Landmark, Wallet } from 'lucide-react';
import { TableRowSkeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type PaymentMethod = 'card' | 'bank' | 'usdc' | 'crypto';
type Status = 'active' | 'churned';

interface Customer {
  id: string;
  name: string;
  email: string;
  initials: string;
  joined: string;
  ltv: number;
  paymentMethod: PaymentMethod;
  status: Status;
}

interface MockPayment {
  id: string;
  amount: number;
  date: string;
  status: 'succeeded' | 'failed' | 'refunded';
}

const MOCK_CUSTOMERS: Customer[] = [
  { id: 'cus_01', name: 'Alice Nguyen',    email: 'alice@acme.io',       initials: 'AN', joined: 'Jan 12, 2025', ltv: 128400, paymentMethod: 'card',   status: 'active'  },
  { id: 'cus_02', name: 'Bob Patel',       email: 'bob@startup.io',      initials: 'BP', joined: 'Feb 3, 2025',  ltv: 237600, paymentMethod: 'usdc',   status: 'active'  },
  { id: 'cus_03', name: 'Carol Osei',      email: 'carol@co.io',         initials: 'CO', joined: 'Mar 17, 2025', ltv: 0,      paymentMethod: 'card',   status: 'churned' },
  { id: 'cus_04', name: 'David Kim',       email: 'david@corp.io',       initials: 'DK', joined: 'Nov 28, 2024', ltv: 590000, paymentMethod: 'bank',   status: 'active'  },
  { id: 'cus_05', name: 'Eve Martinez',    email: 'eve@web3.io',         initials: 'EM', joined: 'Dec 5, 2024',  ltv: 315000, paymentMethod: 'crypto', status: 'active'  },
  { id: 'cus_06', name: 'Frank Adeyemi',   email: 'frank@fintech.io',    initials: 'FA', joined: 'Apr 2, 2025',  ltv: 42000,  paymentMethod: 'card',   status: 'active'  },
  { id: 'cus_07', name: 'Grace Liu',       email: 'grace@saas.io',       initials: 'GL', joined: 'Oct 14, 2024', ltv: 198000, paymentMethod: 'usdc',   status: 'churned' },
  { id: 'cus_08', name: 'Henry Sato',      email: 'henry@platform.io',   initials: 'HS', joined: 'Jan 30, 2025', ltv: 74500,  paymentMethod: 'card',   status: 'active'  },
  { id: 'cus_09', name: 'Iris Okafor',     email: 'iris@marketplace.io', initials: 'IO', joined: 'Mar 7, 2025',  ltv: 11200,  paymentMethod: 'bank',   status: 'active'  },
  { id: 'cus_10', name: 'James Thornton',  email: 'james@devco.io',      initials: 'JT', joined: 'Feb 19, 2025', ltv: 0,      paymentMethod: 'card',   status: 'churned' },
];

const MOCK_PAYMENTS_MAP: Record<string, MockPayment[]> = {
  cus_01: [
    { id: 'py_a1', amount: 4900,  date: 'Apr 1, 2026',  status: 'succeeded' },
    { id: 'py_a2', amount: 4900,  date: 'Mar 1, 2026',  status: 'succeeded' },
    { id: 'py_a3', amount: 4900,  date: 'Feb 1, 2026',  status: 'succeeded' },
  ],
  cus_02: [
    { id: 'py_b1', amount: 9900,  date: 'Mar 1, 2026',  status: 'succeeded' },
    { id: 'py_b2', amount: 9900,  date: 'Dec 1, 2025',  status: 'succeeded' },
    { id: 'py_b3', amount: 9900,  date: 'Sep 1, 2025',  status: 'succeeded' },
  ],
};

const DEFAULT_PAYMENTS: MockPayment[] = [
  { id: 'py_x1', amount: 4900,  date: 'Apr 1, 2026',  status: 'succeeded' },
  { id: 'py_x2', amount: 4900,  date: 'Mar 1, 2026',  status: 'succeeded' },
  { id: 'py_x3', amount: 4900,  date: 'Feb 1, 2026',  status: 'refunded'  },
];

const PM_LABELS: Record<PaymentMethod, string> = {
  card:   'Card',
  bank:   'Bank Transfer',
  usdc:   'USDC',
  crypto: 'Crypto',
};

const PM_ICONS: Record<PaymentMethod, React.ReactNode> = {
  card:   <CreditCard size={13} className="text-cyan-400" />,
  bank:   <Landmark size={13} className="text-indigo-400" />,
  usdc:   <Wallet size={13} className="text-emerald-400" />,
  crypto: <Wallet size={13} className="text-amber-400" />,
};

const STATUS_STYLES: Record<Status, string> = {
  active:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  churned: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  succeeded: 'text-emerald-400',
  failed:    'text-red-400',
  refunded:  'text-amber-400',
};

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function CustomerDrawer({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const payments = MOCK_PAYMENTS_MAP[customer.id] ?? DEFAULT_PAYMENTS;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-80 bg-[#0d1b2e] border-l border-white/[0.07] z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <h2 className="text-sm font-semibold text-white">Customer Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Avatar + info */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-cyan-400">{customer.initials}</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{customer.name}</div>
              <div className="text-xs text-gray-400">{customer.email}</div>
            </div>
          </div>

          {/* Meta */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between py-2 border-b border-white/[0.05]">
              <span className="text-gray-400">Joined</span>
              <span className="text-white">{customer.joined}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-white/[0.05]">
              <span className="text-gray-400">Lifetime Value</span>
              <span className="text-white font-semibold">{fmt(customer.ltv)}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-white/[0.05]">
              <span className="text-gray-400">Payment Method</span>
              <span className="flex items-center gap-1.5 text-white">
                {PM_ICONS[customer.paymentMethod]}
                {PM_LABELS[customer.paymentMethod]}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-400">Status</span>
              <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[customer.status]}`}>
                {customer.status}
              </span>
            </div>
          </div>

          {/* Payment history */}
          <div>
            <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-3">Payment History</h3>
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <div>
                    <div className="text-white font-medium">{fmt(p.amount)}</div>
                    <div className="text-gray-500 mt-0.5">{p.date}</div>
                  </div>
                  <span className={`font-semibold capitalize ${PAYMENT_STATUS_STYLES[p.status]}`}>
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

type FilterTab = 'All' | 'Active' | 'Churned';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('All');
  const [selected, setSelected] = useState<Customer | null>(null);

  const { data: apiData, isLoading } = useSWR('/api/customers', fetcher);

  // Use API data if available and non-empty, otherwise fall back to mock
  const rawCustomers: Customer[] = (apiData?.data && apiData.data.length > 0)
    ? apiData.data
    : MOCK_CUSTOMERS;

  const filtered = rawCustomers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === 'All' ||
      (filter === 'Active' && c.status === 'active') ||
      (filter === 'Churned' && c.status === 'churned');
    return matchesSearch && matchesFilter;
  });

  const totalCount = rawCustomers.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">Customers</h1>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-gray-400">
            {totalCount}
          </span>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers…"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/40 transition-colors"
          />
        </div>
        <div className="flex gap-1.5">
          {(['All', 'Active', 'Churned'] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filter === tab
                  ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                  : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Joined</th>
              <th>LTV</th>
              <th>Payment Method</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} cols={5} />)
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3 text-gray-500">
                    <Shield size={32} className="text-gray-600" />
                    <div>
                      <div className="text-sm font-medium text-gray-400">No customers yet</div>
                      <div className="text-xs mt-1">Share your checkout link to get started</div>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((customer) => (
                <tr
                  key={customer.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(customer)}
                >
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-cyan-400">{customer.initials}</span>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-white">{customer.name}</div>
                        <div className="text-[11px] text-gray-500">{customer.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-xs text-gray-400">{customer.joined}</td>
                  <td className="text-sm font-semibold tabular-nums text-white">
                    {customer.ltv > 0 ? fmt(customer.ltv) : '—'}
                  </td>
                  <td>
                    <span className="flex items-center gap-1.5 text-xs text-gray-300">
                      {PM_ICONS[customer.paymentMethod]}
                      {PM_LABELS[customer.paymentMethod]}
                    </span>
                  </td>
                  <td>
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[customer.status]}`}>
                      {customer.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      {selected && (
        <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
