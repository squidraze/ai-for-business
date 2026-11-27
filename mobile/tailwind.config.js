/** @type {import('tailwindcss').Config} */
module.exports = {
  // `dark:` follows the system theme, the same source `useColors()` reads
  // (app.json `userInterfaceStyle: automatic`).
  darkMode: 'media',
  // Every folder with `className` must be listed, or Tailwind strips its
  // classes from the production bundle (dev still looks fine).
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Brand, from the CSS variables in global.css — the same values as
        // `primary` in src/lib/theme.ts, per theme.
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          foreground: 'rgb(var(--primary-foreground) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
