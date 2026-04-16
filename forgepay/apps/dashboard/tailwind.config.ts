import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0A2540',
          50:  '#E8EEF5',
          100: '#C5D4E6',
          700: '#0F3268',
          800: '#0A2540',
          900: '#061728',
        },
        cyan: {
          DEFAULT: '#00F0FF',
          400: '#1AF0FF',
          500: '#00F0FF',
          600: '#00C8D4',
        },
        // Dashboard-specific neutrals (slightly warmer than pure gray)
        surface: {
          DEFAULT: '#0F1D2E',
          50:  '#F0F4F8',
          100: '#E2E8F0',
          200: '#CBD5E1',
          700: '#1E3248',
          800: '#142133',
          900: '#0A1826',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
