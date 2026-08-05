/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── WhatsApp-inspired tactical dark palette ──
        surface: {
          DEFAULT: '#071115',     // page background
          raised: '#111f26',      // card background
          overlay: '#13212a',     // inputs / elevated overlays
          hover: '#162832',       // internal panels / hover state
          border: '#29404a',      // subtle card borders
          'border-strong': '#3b5a66', // stronger borders
        },
        accent: {
          DEFAULT: '#25d366',     // WhatsApp action green
          hover: '#1faa59',       // pressed/active green
          muted: 'rgba(37,211,102,0.13)', // soft background tint
          glow: 'rgba(37,211,102,0.18)',  // glow effect
        },
        success: {
          DEFAULT: '#10b981',
          muted: 'rgba(16,185,129,0.15)',
        },
        danger: {
          DEFAULT: '#ef4444',
          muted: 'rgba(239,68,68,0.12)',
        },
        warning: {
          DEFAULT: '#f59e0b',
          muted: 'rgba(245,158,11,0.12)',
        },
        txt: {
          primary: '#f8fafc',     // white-ish
          secondary: '#9bb3bf',   // soft blue-gray
          muted: '#708894',       // muted blue-gray
          dim: '#4f6570',         // dim blue-gray
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        glow: '0 10px 26px rgba(0,0,0,0.30), 0 0 0 1px rgba(37,211,102,0.08)',
        'glow-sm': '0 8px 18px rgba(0,0,0,0.25), 0 0 0 1px rgba(37,211,102,0.07)',
        card: '0 14px 34px rgba(0,0,0,0.30), 0 2px 8px rgba(0,0,0,0.22)',
        'card-hover': '0 18px 42px rgba(0,0,0,0.34), 0 0 0 1px rgba(59,90,102,0.22)',
      },
      backgroundImage: {
        'grid-pattern': 'linear-gradient(rgba(41,64,74,0.44) 1px, transparent 1px), linear-gradient(90deg, rgba(41,64,74,0.44) 1px, transparent 1px)',
        'gradient-radial': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
      },
      backgroundSize: {
        'grid': '40px 40px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
