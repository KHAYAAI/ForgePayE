'use client';

import { ShieldCheck, Lock, EyeOff, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';

const ARCH_STEPS = [
  {
    icon: ShieldCheck,
    title: 'Client Browser',
    description: 'WASM proof generation',
    accent: 'cyan',
    detail: 'Amount never leaves the browser as plaintext. Groth16 proof generated locally.',
  },
  {
    icon: Lock,
    title: 'MoR Layer',
    description: 'Decrypt for tax only',
    accent: 'slate',
    detail: 'Auditor key decrypts the amount solely to compute and remit tax. No merchant access.',
  },
  {
    icon: EyeOff,
    title: 'Public Ledger',
    description: 'Commitment only (no amount)',
    accent: 'slate',
    detail: 'Only the Pedersen commitment is published on-chain. Amount stays private.',
  },
];

const TECH_BADGES = [
  'Groth16 BN254',
  'X25519 ECDH',
  'AES-256-GCM',
  'Poseidon2',
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: 'easeOut' } },
};

export default function PrivacyFeature() {
  return (
    <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-navy-900 via-navy-800 to-navy-900" />

      {/* Subtle grid overlay — matches Hero style */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(#00F0FF 1px, transparent 1px), linear-gradient(90deg, #00F0FF 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />

      {/* Glow orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="text-center mb-16"
        >
          {/* Badge */}
          <motion.div variants={itemVariants}>
            <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-full px-4 py-1.5 mb-6">
              <ShieldCheck size={13} className="text-cyan-400" />
              <span className="text-xs font-semibold text-cyan-300 tracking-wide uppercase">
                Zero-Knowledge Privacy
              </span>
            </div>
          </motion.div>

          {/* Headline */}
          <motion.h2
            variants={itemVariants}
            className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.08] mb-3"
          >
            Payments your merchant{' '}
            <span className="text-cyan-500">never sees.</span>
          </motion.h2>

          {/* Sub-headline */}
          <motion.p
            variants={itemVariants}
            className="text-xl sm:text-2xl font-semibold text-gray-300 mb-6"
          >
            Taxes your auditor still can.
          </motion.p>

          {/* Body */}
          <motion.p
            variants={itemVariants}
            className="text-base text-gray-400 max-w-2xl mx-auto leading-relaxed"
          >
            ForgePay&apos;s shielded payment mode uses{' '}
            <span className="text-gray-200 font-medium">Groth16 ZK proofs</span> to encrypt
            transaction amounts client-side. The merchant only sees a cryptographic commitment.
            Only the compliance auditor — armed with a decryption key — can reveal the amount to
            compute taxes.
          </motion.p>
        </motion.div>

        {/* Architecture diagram */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          className="flex flex-col sm:flex-row items-stretch justify-center gap-0 mb-14"
        >
          {ARCH_STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isCyan = step.accent === 'cyan';
            return (
              <div key={step.title} className="flex flex-row sm:flex-col items-center sm:items-stretch flex-1 min-w-0">
                {/* Card */}
                <motion.div
                  variants={itemVariants}
                  className={`flex-1 rounded-2xl border p-6 flex flex-col gap-3 ${
                    isCyan
                      ? 'bg-cyan-500/[0.07] border-cyan-500/40'
                      : 'bg-white/[0.03] border-white/10'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center mb-1 ${
                      isCyan ? 'bg-cyan-500/20' : 'bg-white/5'
                    }`}
                  >
                    <Icon size={20} className={isCyan ? 'text-cyan-400' : 'text-gray-400'} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white mb-0.5">{step.title}</div>
                    <div
                      className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
                        isCyan ? 'text-cyan-400' : 'text-gray-500'
                      }`}
                    >
                      {step.description}
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{step.detail}</p>
                  </div>
                </motion.div>

                {/* Arrow between cards (not after last) */}
                {idx < ARCH_STEPS.length - 1 && (
                  <div className="flex items-center justify-center px-3 sm:py-3 sm:px-0 shrink-0">
                    <ArrowRight size={20} className="text-cyan-500 rotate-0 sm:rotate-0" />
                  </div>
                )}
              </div>
            );
          })}
        </motion.div>

        {/* Tech badge row */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex flex-wrap justify-center gap-3 mb-10"
        >
          {TECH_BADGES.map((badge, idx) => (
            <span
              key={badge}
              className="bg-white/[0.04] border border-white/10 rounded-full px-4 py-1.5 text-xs font-mono text-gray-300"
            >
              {badge}
              {idx < TECH_BADGES.length - 1 && (
                <span className="ml-3 text-gray-600">·</span>
              )}
            </span>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="text-center"
        >
          <Link
            href="/docs/privacy-architecture"
            className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 text-sm font-semibold transition-colors group"
          >
            Read the privacy architecture
            <ArrowRight
              size={14}
              className="group-hover:translate-x-1 transition-transform"
            />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
