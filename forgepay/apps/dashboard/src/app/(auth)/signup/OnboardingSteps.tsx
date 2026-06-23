'use client';

import { CheckCircle, Loader2, XCircle } from 'lucide-react';

type StepStatus = 'pending' | 'loading' | 'done' | 'error';

interface Step {
  label: string;
  sublabel: string;
  status: StepStatus;
}

export function OnboardingSteps({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-3 mt-4">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="shrink-0">
            {step.status === 'done'    && <CheckCircle size={16} className="text-emerald-400" />}
            {step.status === 'loading' && <Loader2 size={16} className="text-cyan-400 animate-spin" />}
            {step.status === 'error'   && <XCircle size={16} className="text-red-400" />}
            {step.status === 'pending' && <div className="w-4 h-4 rounded-full border border-gray-600" />}
          </div>
          <div>
            <div className="text-sm font-medium text-white">{step.label}</div>
            <div className="text-[11px] text-gray-500">{step.sublabel}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
