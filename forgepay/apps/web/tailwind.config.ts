import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        forge: {
          bg:      '#0A0A0A',
          surface: '#111111',
          border:  '#1E1E1E',
          muted:   '#1A1A1A',
        },
        green: {
          DEFAULT: '#39D353',
          dim:     '#39D35320',
          glow:    '#39D35340',
        },
        red:   { DEFAULT: '#EF4444', dim: '#EF444420' },
        amber: { DEFAULT: '#F59E0B', dim: '#F59E0B20' },
      },
      fontFamily: {
        sans: ['JetBrains Mono', 'monospace'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-green': 'pulseGreen 2s ease-in-out infinite',
        'fade-up':     'fadeUp 0.5s ease-out forwards',
        'blink':       'blink 1s step-end infinite',
      },
      keyframes: {
        pulseGreen: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 12px #39D35340' },
          '50%':      { opacity: '0.7', boxShadow: '0 0 24px #39D35360' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
