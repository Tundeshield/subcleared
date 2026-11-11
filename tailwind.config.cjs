/** @type {import('tailwindcss').Config} */
// SubCleared brand: three colours only — Warm Ivory, Deep Charcoal, Field Green.
// Every other tone is one of these at a set opacity, mixed onto ivory.
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: v('ivory'), charcoal: v('charcoal'), field: v('field'),
        bg: v('ivory'), paper: v('paper'), surface: v('paper'), raised: v('raised'), line: v('line'), 'line-strong': v('line-strong'),
        ink: v('charcoal'), muted: v('muted'), faint: v('faint'), accent: v('field'), 'accent-ink': v('ivory'),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.75rem', '1.1rem'], xs: ['0.8125rem', '1.2rem'], sm: ['0.875rem', '1.35rem'], base: ['0.9375rem', '1.5rem'], md: ['1rem', '1.55rem'],
        lg: ['1.125rem', '1.6rem'], xl: ['1.375rem', '1.8rem'], '2xl': ['1.75rem', '2.15rem'], '3xl': ['2.25rem', '2.6rem'], '4xl': ['3rem', '3.3rem'], '5xl': ['3.75rem', '4rem'],
      },
      borderRadius: { DEFAULT: '4px', md: '6px', lg: '8px' },
      boxShadow: { pop: '0 1px 2px rgb(37 43 39 / 0.06), 0 12px 32px -12px rgb(37 43 39 / 0.22)', drawer: '-16px 0 40px -16px rgb(37 43 39 / 0.25)' },
      maxWidth: { content: '1320px' },
    },
  },
  plugins: [],
};
