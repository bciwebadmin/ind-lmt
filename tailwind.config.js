/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Bobcat orange. 500 is the brand fill — anything sitting ON it takes
        // WHITE text (white on #ff3300 is ~4.5:1). This is the opposite of the
        // amber fork, whose brand fill needs near-black text instead.
        // 700 is the text shade for light backgrounds; 500 as text is only
        // valid on the dark sidebar.
        brand: {
          50:   '#ffece5',
          100:  '#ffd1c2',
          200:  '#ff9b75',
          300:  '#ff7444',
          400:  '#ff5219',
          500:  '#ff3300',
          600:  '#d62b00',
          700:  '#ad2300',
          800:  '#851a00'
        },
        // Supporting neutrals from the brand palette.
        surface: '#ffffff'
      },
      fontFamily: {
        sans:    ['Manrope', 'system-ui', 'sans-serif'],
        display: ['"Saira Condensed"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace']
      }
    }
  },
  plugins: []
};
