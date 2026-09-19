/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./*.html",
    "./scripts/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0A',
        bgSoft: '#0E0E0E',
        bgElev: '#131313',
        line: '#1C1C1C',
        ink: '#F2F2F2',
        mute: '#6E6E6E',
        lime: '#BFFF1A',
        limeDim: '#8FC816',
        orange: '#FF6B2C',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  safelist: [
    // Toggled at runtime by scripts/main.js (mobile nav) — kept as insurance
    // even though it also appears in static markup.
    'hidden',
  ],
  plugins: [],
};
