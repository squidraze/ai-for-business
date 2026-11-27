/** @type {import('tailwindcss').Config} */
module.exports = {
  // 'class' lets Profile → Theme force a scheme (NativeWind `colorScheme.set`,
  // see src/lib/themeMode.ts); with 'system' `dark:` still follows the device,
  // the same source `useColors()` reads.
  darkMode: 'class',
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
