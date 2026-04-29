'use client';

import { motion } from 'framer-motion';

const TESTIMONIALS = [
  {
    quote:
      'ForgePay cut our integration time from 3 weeks to 3 days. The stablecoin support alone is worth the switch.',
    name: 'Sarah K.',
    title: 'CTO at Beam AI',
    initials: 'B',
  },
  {
    quote:
      'We handle 12 countries’ VAT automatically. Previously this was a full-time job.',
    name: 'Marcus T.',
    title: 'Founder at Loop SaaS',
    initials: 'L',
  },
  {
    quote:
      'The ZK privacy mode is a genuine moat. Our enterprise clients require it now.',
    name: 'Priya N.',
    title: 'Head of Payments at Cipher Labs',
    initials: 'C',
  },
];

const LOGOS = ['ACME', 'BEAM', 'LOOP', 'CIPHER', 'NEXUS'];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

export default function SocialProof() {
  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 bg-navy-900/60">
      <div className="max-w-6xl mx-auto">
        {/* Label */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
          className="text-center mb-14"
        >
          <div className="inline-block bg-white/[0.04] border border-white/10 rounded-full px-4 py-1 text-xs font-semibold text-gray-400 uppercase tracking-widest mb-0">
            Trusted by developers
          </div>
        </motion.div>

        {/* Testimonial cards */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16"
        >
          {TESTIMONIALS.map((t) => (
            <motion.div
              key={t.name}
              variants={cardVariants}
              className="relative bg-navy-800/80 border border-white/10 rounded-2xl p-6 flex flex-col gap-4 hover:border-cyan-500/20 transition-colors duration-300"
            >
              {/* Quote mark */}
              <div className="text-4xl font-black text-cyan-500/20 leading-none select-none -mb-2">
                &ldquo;
              </div>

              {/* Quote text */}
              <p className="text-sm text-gray-300 leading-relaxed flex-1">{t.quote}</p>

              {/* Author */}
              <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-navy-700 border border-cyan-500/30 flex items-center justify-center shrink-0">
                  <span className="text-xs font-black text-cyan-400">{t.initials}</span>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{t.name}</div>
                  <div className="text-xs text-gray-500">{t.title}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Company logo row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="flex flex-wrap items-center justify-center gap-4"
        >
          {LOGOS.map((logo) => (
            <div
              key={logo}
              className="bg-navy-800/60 border border-white/8 rounded-xl px-6 py-3 text-xs font-black tracking-[0.18em] text-gray-500 hover:text-gray-400 hover:border-white/15 transition-all duration-200 select-none"
              style={{ borderColor: 'rgba(255,255,255,0.06)' }}
            >
              {logo}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
