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
        // ForgePay brand palette
        navy: {
          DEFAULT: '#0A2540',
          50:  '#E8EEF5',
          100: '#C5D4E6',
          200: '#9AB2CF',
          300: '#6F90B8',
          400: '#4A72A5',
          500: '#335D94',
          600: '#1F4880',
          700: '#0F3268',
          800: '#0A2540',  // brand navy
          900: '#061728',
        },
        cyan: {
          DEFAULT: '#00F0FF',
          50:  '#E0FDFF',
          100: '#B3FAFF',
          200: '#80F7FF',
          300: '#4DF3FF',
          400: '#1AF0FF',
          500: '#00F0FF',  // brand cyan
          600: '#00C8D4',
          700: '#009EA8',
          800: '#007580',
          900: '#004C52',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'gradient-forge': 'linear-gradient(135deg, #0A2540 0%, #0D3260 50%, #0A2540 100%)',
        'gradient-cyan':  'linear-gradient(135deg, #00F0FF 0%, #00C8D4 100%)',
        'gradient-hero':  'radial-gradient(ellipse at top, #0D3260 0%, #0A2540 60%)',
      },
      animation: {
        'fade-up':    'fadeUp 0.6s ease-out forwards',
        'fade-in':    'fadeIn 0.4s ease-out forwards',
        'pulse-cyan': 'pulseCyan 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':       'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulseCyan: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
        glow: {
          '0%':   { boxShadow: '0 0 5px #00F0FF44, 0 0 10px #00F0FF22' },
          '100%': { boxShadow: '0 0 20px #00F0FF88, 0 0 40px #00F0FF44' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
