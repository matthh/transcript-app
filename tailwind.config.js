/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'brand-dark': '#323232',
        'brand-plum': '#473742',
        'brand-plum-light': '#5e4a56',
        'brand-plum-lighter': '#f0eaed',
        'brand-plum-muted': '#8a7380',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
