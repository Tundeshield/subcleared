/** @type {import('tailwindcss').Config} */
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), raised: v('raised'), line: v('line'), 'line-strong': v('line-strong'),
        ink: v('ink'), muted: v('muted'), faint: v('faint'),
        accent: v('accent'), 'accent-ink': v('accent-ink'), 'accent-soft': v('accent-soft'),
        ok: v('ok'), warn: v('warn'), bad: v('bad'), info: v('info'),
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['0.8125rem', '1.15rem'], sm: ['0.875rem', '1.3rem'], base: ['0.9375rem', '1.45rem'], md: ['1rem', '1.5rem'],
        lg: ['1.125rem', '1.6rem'], xl: ['1.375rem', '1.8rem'], '2xl': ['1.75rem', '2.1rem'], '3xl': ['2.25rem', '2.55rem'], '4xl': ['3rem', '3.2rem'], '5xl': ['3.75rem', '3.9rem'],
      },
      borderRadius: { DEFAULT: '5px', md: '6px', lg: '8px' },
      boxShadow: { pop: '0 12px 40px -12px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(var(--line))' },
    },
  },
  plugins: [],
};
