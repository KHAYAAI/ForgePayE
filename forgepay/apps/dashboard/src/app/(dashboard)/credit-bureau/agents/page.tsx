'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';

const AGENTS = [
  { agentId: 'agent_super_001', did: 'did:fp:0xdead…beef', score: 921, tier: 'SUPER_PRIME', util: '24%', delinq: 0, updated: '2024-12-26' },
  { agentId: 'agent_prime_001', did: 'did:fp:0x7a3b…8b',   score: 847, tier: 'PRIME',       util: '24%', delinq: 0, updated: '2024-12-26' },
  { agentId: 'agent_prime_002', did: 'did:fp:0x1a2b…0b',   score: 712, tier: 'PRIME',       util: '64%', delinq: 0, updated: '2024-12-25' },
  { agentId: 'agent_near_001',  did: 'did:fp:0xc4d5…f6',   score: 631, tier: 'NEAR_PRIME',  util: '51%', delinq: 1, updated: '2024-12-24' },
  { agentId: 'agent_near_002',  did: 'did:fp:0xe8f9…ab',   score: 608, tier: 'NEAR_PRIME',  util: '58%', delinq: 0, updated: '2024-12-23' },
  { agentId: 'agent_subprime_001',did:'did:fp:0x9f8e…3c',  score: 541, tier: 'SUBPRIME',    util: '90%', delinq: 1, updated: '2024-12-22' },
  { agentId: 'agent_subprime_002',did:'did:fp:0x3b2a…7f',  score: 518, tier: 'SUBPRIME',    util: '85%', delinq: 0, updated: '2024-12-21' },
  { agentId: 'agent_deep_001',  did: 'did:fp:0x0000…dead', score: 423, tier: 'DEEP_SUBPRIME',util:'100%',delinq: 1, updated: '2024-12-20' },
  { agentId: 'agent_deep_002',  did: 'did:fp:0x1111…0000', score: 390, tier: 'DEEP_SUBPRIME',util:'100%',delinq: 2, updated: '2024-12-19' },
  { agentId: 'agent_new_001',   did: 'did:fp:0x5e4d…2c',   score: 650, tier: 'PRIME',       util: '0%',  delinq: 0, updated: '2024-12-18' },
];

const TIER_COLORS: Record<string, string> = {
  SUPER_PRIME:   'text-[#39D353] bg-[#39D35312]',
  PRIME:         'text-[#86EFAC] bg-[#86EFAC12]',
  NEAR_PRIME:    'text-[#F59E0B] bg-[#F59E0B12]',
  SUBPRIME:      'text-[#F97316] bg-[#F9731612]',
  DEEP_SUBPRIME: 'text-[#EF4444] bg-[#EF444412]',
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round((score / 1000) * 100);
  const color = score >= 800 ? '#39D353' : score >= 670 ? '#86EFAC' : score >= 580 ? '#F59E0B' : score >= 500 ? '#F97316' : '#EF4444';
  return (
    <div className="flex items-center gap-2">
      <span className="text-white font-mono text-xs w-8">{score}</span>
      <div className="flex-1 h-1 bg-[#1A1A1A] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const [search, setSearch] = useState('');
  const filtered = AGENTS.filter(a =>
    a.agentId.includes(search) || a.did.includes(search) || a.tier.includes(search.toUpperCase()),
  );

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-[#6B7280]">REGISTERED AGENTS</div>
          <div className="text-2xl font-mono font-bold text-white mt-1">{AGENTS.length.toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#111] border border-[#1E1E1E] px-3 py-2">
            <Search size={12} className="text-[#444]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="SEARCH_AGENTS..."
              className="bg-transparent text-xs font-mono text-white placeholder-[#333] outline-none w-48"
            />
          </div>
          <button className="text-xs font-mono text-[#39D353] border border-[#39D353] px-4 py-2 hover:bg-[#39D35310] transition-colors">
            + REGISTER AGENT
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <table className="fp-table w-full">
          <thead>
            <tr>
              <th>AGENT_ID</th>
              <th>DID</th>
              <th>SCORE</th>
              <th>TIER</th>
              <th>UTILIZATION</th>
              <th>DELINQUENCIES</th>
              <th>LAST_UPDATED</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.agentId} className="cursor-pointer" onClick={() => window.location.href = `/credit-bureau/agents/${a.agentId}`}>
                <td className="text-[#39D353] font-mono text-xs">{a.agentId}</td>
                <td className="text-[#444] font-mono text-xs">{a.did}</td>
                <td className="min-w-[140px]"><ScoreBar score={a.score} /></td>
                <td>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${TIER_COLORS[a.tier]}`}>
                    {a.tier.replace('_', ' ')}
                  </span>
                </td>
                <td className={`font-mono text-xs ${parseFloat(a.util) > 80 ? 'text-[#EF4444]' : parseFloat(a.util) > 50 ? 'text-[#F59E0B]' : 'text-[#39D353]'}`}>{a.util}</td>
                <td className={`font-mono text-xs ${a.delinq > 0 ? 'text-[#EF4444]' : 'text-[#6B7280]'}`}>{a.delinq}</td>
                <td className="text-[#444] font-mono text-xs">{a.updated}</td>
                <td>
                  <button
                    onClick={e => { e.stopPropagation(); window.location.href = `/credit-bureau/agents/${a.agentId}`; }}
                    className="text-[10px] font-mono text-[#39D353] border border-[#39D35330] px-2 py-0.5 hover:bg-[#39D35310] transition-colors"
                  >
                    VIEW →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-5 py-3 border-t border-[#1A1A1A] flex items-center justify-between">
          <span className="text-[10px] font-mono text-[#444]">Showing {filtered.length} of {AGENTS.length} agents</span>
          <div className="flex items-center gap-2 text-xs font-mono text-[#444]">
            <button className="hover:text-white transition-colors">← PREV</button>
            <span className="text-[#39D353]">1</span>
            <span>2</span>
            <span>3</span>
            <button className="hover:text-white transition-colors">NEXT →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
