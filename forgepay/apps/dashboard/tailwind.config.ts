import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
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
          text:    '#39D353',
        },
        red: {
          DEFAULT: '#EF4444',
          dim:     '#EF444420',
        },
        amber: {
          DEFAULT: '#F59E0B',
          dim:     '#F59E0B20',
        },
      },
      fontFamily: {
        sans: ['JetBrains Mono', 'monospace'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
