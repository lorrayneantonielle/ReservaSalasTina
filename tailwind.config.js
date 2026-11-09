/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        tina: {
          50: '#f8f4fb',
          100: '#efe6f6',
          200: '#dfcdec',
          300: '#c6a6dc',
          400: '#a877c6',
          500: '#8c52ad',
          600: '#743d91',
          700: '#5f3176',
          800: '#4f2a62',
          900: '#422552',
          950: '#2a1036',
        },
        terra: {
          50: '#fdf5f1',
          100: '#fae8de',
          200: '#f4cdb9',
          300: '#eba98a',
          400: '#e07c58',
          500: '#d45d38',
          600: '#c0472b',
          700: '#a03825',
          800: '#813025',
          900: '#692b22',
        },
        creme: '#fbf7f2',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      boxShadow: {
        suave: '0 1px 2px rgb(66 37 82 / 0.06), 0 8px 24px -12px rgb(66 37 82 / 0.18)',
      },
    },
  },
  plugins: [],
}
