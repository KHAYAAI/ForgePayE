'use client';

import { useState } from 'react';
import { Bot, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

type Tab = 'Integrate' | 'Insight' | 'Act';

const TABS: Tab[] = ['Integrate', 'Insight', 'Act'];

const INTEGRATE_CODE = `import { ForgePay } from '@forgepay/sdk';

const fp = new ForgePay({ apiKey: process.env.FORGEPAY_API_KEY });

const session = await fp.checkout.create({
  amount: 4900,
  currency: 'USD',
  success_url: 'https://yourapp.com/success',
  cancel_url:  'https://yourapp.com/cancel',
});

// Redirect or embed
window.location.href = session.url;`;

const CONVERSATIONS: Record<Tab, React.ReactNode> = {
  Integrate: (
    <div className="space-y-4">
      <ChatBubble role="user">
        How do I add a checkout button to my React app?
      </ChatBubble>
      <ChatBubble role="agent">
        <p className="mb-3 text-sm text-gray-300">
          Here&apos;s the minimal integration. Install the SDK then call{' '}
          <code className="text-cyan-400 text-xs">fp.checkout.create()</code> from your API route:
        </p>
        <pre className="bg-navy-900 border border-white/10 rounded-xl p-4 text-[11px] font-mono text-gray-300 overflow-x-auto leading-relaxed">
          <code>{INTEGRATE_CODE}</code>
        </pre>
        <p className="mt-3 text-xs text-gray-500">
          The session URL redirects to ForgePay&apos;s hosted checkout. Need an embedded version instead?
        </p>
      </ChatBubble>
    </div>
  ),

  Insight: (
    <div className="space-y-4">
      <ChatBubble role="user">
        What&apos;s my MRR this month vs last month?
      </ChatBubble>
      <ChatBubble role="agent">
        <p className="mb-4 text-sm text-gray-300">Here&apos;s your revenue summary:</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { label: 'MRR — April 2026', value: '$48,320', delta: '+12.4%', positive: true },
            { label: 'MRR — March 2026', value: '$42,990', delta: null, positive: null },
            { label: 'New subscriptions', value: '143', delta: '+28', positive: true },
            { label: 'Churn rate', value: '1.8%', delta: '-0.3pp', positive: true },
          ].map((row) => (
            <div
              key={row.label}
              className="bg-navy-900/70 border border-white/10 rounded-xl p-3"
            >
              <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">
                {row.label}
              </div>
              <div className="text-lg font-black text-white">{row.value}</div>
              {row.delta && (
                <div
                  className={`text-xs font-semibold mt-0.5 ${
                    row.positive ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {row.delta} vs prev period
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Growth driven primarily by annual plan upgrades (+8%). Want a breakdown by plan tier?
        </p>
      </ChatBubble>
    </div>
  ),

  Act: (
    <div className="space-y-4">
      <ChatBubble role="user">
        Refund the last payment from alice@example.com
      </ChatBubble>
      <ChatBubble role="agent">
        <p className="mb-3 text-sm text-gray-300">
          Found the payment. Before I proceed, please confirm:
        </p>
        <div className="bg-navy-900/70 border border-amber-500/30 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold text-amber-300 uppercase tracking-wide mb-2">
                Approval required
              </div>
              <div className="space-y-1.5 text-xs text-gray-300">
                <div className="flex justify-between">
                  <span className="text-gray-500">Payment ID</span>
                  <span className="font-mono text-gray-200">pay_9xKj2mNp</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount</span>
                  <span className="font-semibold text-white">$49.00 USD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Customer</span>
                  <span className="text-gray-200">alice@example.com</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Date</span>
                  <span className="text-gray-200">Apr 28, 2026</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold rounded-lg py-2 transition-colors">
            <CheckCircle2 size={13} />
            Approve refund
          </button>
          <button className="flex-1 border border-white/10 hover:border-white/20 text-gray-400 text-xs font-semibold rounded-lg py-2 transition-colors">
            Cancel
          </button>
        </div>
      </ChatBubble>
    </div>
  ),
};

function ChatBubble({
  role,
  children,
}: {
  role: 'user' | 'agent';
  children: React.ReactNode;
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-xs bg-cyan-500/15 border border-cyan-500/25 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-gray-200">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0 mt-0.5">
        <Bot size={14} className="text-cyan-400" />
      </div>
      <div className="flex-1 bg-white/[0.04] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
        {children}
      </div>
    </div>
  );
}

const PILLS = ['15 SDK tools', 'Approval gates', 'Dashboard + VS Code'];

export default function ForgeAgentSection() {
  const [activeTab, setActiveTab] = useState<Tab>('Integrate');

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Left — copy */}
          <div>
            <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-full px-4 py-1.5 mb-6">
              <Bot size={13} className="text-cyan-400" />
              <span className="text-xs font-semibold text-cyan-300 tracking-wide uppercase">
                Forge Agent · Beta
              </span>
            </div>

            <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-[1.1] mb-6">
              Your AI billing co-pilot,{' '}
              <span className="text-cyan-500">built in.</span>
            </h2>

            <p className="text-gray-400 text-base leading-relaxed mb-8">
              Forge Agent lives inside your dashboard and your IDE. Ask it to integrate, pull revenue
              insights, or take action — with approval gates before any write operation.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 mb-8">
              {PILLS.map((pill) => (
                <span
                  key={pill}
                  className="bg-white/[0.05] border border-white/10 rounded-full px-3 py-1 text-xs text-gray-300 font-medium"
                >
                  {pill}
                </span>
              ))}
            </div>

            {/* CTA */}
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 text-cyan-300 font-semibold px-5 py-2.5 rounded-xl text-sm transition-all duration-200"
            >
              <Bot size={15} />
              Available in your dashboard
            </Link>
          </div>

          {/* Right — chat mock */}
          <div>
            {/* Tab row */}
            <div className="flex gap-1 mb-4 bg-white/[0.03] border border-white/10 rounded-xl p-1 w-fit">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    activeTab === tab
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Chat card */}
            <div className="bg-navy-900/80 border border-white/10 rounded-2xl overflow-hidden">
              {/* Title bar */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-white/[0.02]">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
                <span className="ml-3 text-xs text-gray-500 font-mono">Forge Agent</span>
                <span className="ml-auto text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  online
                </span>
              </div>

              {/* Messages */}
              <div className="p-5 min-h-[340px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.22 }}
                  >
                    {CONVERSATIONS[activeTab]}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
