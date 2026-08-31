'use client';
import { useState } from 'react';

const DISPUTES = [
  { id: 'disp_001', agentId: 'agent_deep_001',    event: 'default',        filed: '2024-06-20', daysOpen: 189, status: 'investigating', assignee: 'compliance_01' },
  { id: 'disp_002', agentId: 'agent_prime_002',   event: 'payment_late_30',filed: '2024-05-10', daysOpen: 230, status: 'open',          assignee: null },
  { id: 'disp_003', agentId: 'agent_near_001',    event: 'hard_inquiry',   filed: '2024-11-01', daysOpen: 55,  status: 'open',          assignee: null },
  { id: 'disp_004', agentId: 'agent_subprime_001',event: 'payment_late_60',filed: '2024-12-01', daysOpen: 25,  status: 'investigating', assignee: 'compliance_02' },
  { id: 'disp_005', agentId: 'agent_near_002',    event: 'credit_opened',  filed: '2024-10-15', daysOpen: 72,  status: 'resolved_corrected', assignee: 'compliance_01' },
  { id: 'disp_006', agentId: 'agent_deep_002',    event: 'default',        filed: '2024-09-12', daysOpen: 105, status: 'resolved_upheld', assignee: 'compliance_02' },
];

type Filter = 'ALL' | 'OPEN' | 'INVESTIGATING' | 'OVERDUE' | 'RESOLVED';

const STATUS_LABELS: Record<string, string> = {
  open:                'OPEN',
  investigating:       'INVESTIGATING',
  resolved_corrected:  'CORRECTED',
  resolved_upheld:     'UPHELD',
  resolved_deleted:    'DELETED',
};

export default function DisputesPage() {
  const [filter, setFilter] = useState<Filter>('ALL');

  const filtered = DISPUTES.filter(d => {
    if (filter === 'ALL')          return true;
    if (filter === 'OPEN')         return d.status === 'open';
    if (filter === 'INVESTIGATING')return d.status === 'investigating';
    if (filter === 'OVERDUE')      return (d.status === 'open' || d.status === 'investigating') && d.daysOpen > 25;
    if (filter === 'RESOLVED')     return d.status.startsWith('resolved');
    return true;
  });

  const open      = DISPUTES.filter(d => d.status === 'open').length;
  const overdue   = DISPUTES.filter(d => (d.status === 'open' || d.status === 'investigating') && d.daysOpen > 25).length;
  const resolved  = DISPUTES.filter(d => d.status.startsWith('resolved')).length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-[#6B7280]">DISPUTE QUEUE</div>
          <div className="text-sm font-mono text-[#6B7280] mt-1">
            <span className="text-white">OPEN: {open}</span>
            <span className="mx-3 text-[#333]">|</span>
            <span className="text-[#EF4444]">OVERDUE (&gt;25d): {overdue}</span>
            <span className="mx-3 text-[#333]">|</span>
            <span>RESOLVED: {resolved}</span>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {(['ALL', 'OPEN', 'INVESTIGATING', 'OVERDUE', 'RESOLVED'] as Filter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`tab-pill ${filter === f ? 'active' : ''}`}>{f}</button>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        <table className="fp-table w-full">
          <thead>
            <tr>
              <th>DISPUTE_ID</th>
              <th>AGENT_ID</th>
              <th>EVENT_TYPE</th>
              <th>FILED</th>
              <th>DAYS_OPEN</th>
              <th>STATUS</th>
              <th>ASSIGNEE</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(d => {
              const isOverdue = (d.status === 'open' || d.status === 'investigating') && d.daysOpen > 25;
              const isResolved = d.status.startsWith('resolved');
              return (
                <tr key={d.id} style={isOverdue ? { borderLeft: '2px solid #EF4444' } : {}}>
                  <td className="text-[#39D353] font-mono text-xs">{d.id}</td>
                  <td className="font-mono text-xs">{d.agentId}</td>
                  <td className="font-mono text-xs text-[#6B7280]">{d.event}</td>
                  <td className="font-mono text-xs text-[#444]">{d.filed}</td>
                  <td className={`font-mono text-xs font-bold ${isOverdue ? 'text-[#EF4444]' : isResolved ? 'text-[#6B7280]' : 'text-white'}`}>
                    {isResolved ? '—' : `${d.daysOpen}d`}
                  </td>
                  <td>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded ${
                      isResolved ? 'text-[#39D353] bg-[#39D35312]' :
                      d.status === 'investigating' ? 'text-[#F59E0B] bg-[#F59E0B12]' :
                      isOverdue ? 'text-[#EF4444] bg-[#EF444412]' :
                      'text-[#6B7280] bg-[#6B728012]'
                    }`}>
                      {STATUS_LABELS[d.status] ?? d.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-[#444]">{d.assignee ?? '—'}</td>
                  <td>
                    {!isResolved && (
                      <div className="flex gap-1">
                        <button className="text-[9px] font-mono text-[#F59E0B] border border-[#F59E0B30] px-1.5 py-0.5 hover:bg-[#F59E0B10]">INVESTIGATE</button>
                        <button className="text-[9px] font-mono text-[#39D353] border border-[#39D35330] px-1.5 py-0.5 hover:bg-[#39D35310]">RESOLVE</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-5 py-3 border-t border-[#1A1A1A]">
          <span className="text-[10px] font-mono text-[#444]">
            Showing {filtered.length} of {DISPUTES.length} disputes — FCRA 30-day resolution required
          </span>
        </div>
      </div>
    </div>
  );
}
