import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        amatista: '#5C3472',
        'amatista-light': '#7B4A96',
        'amatista-dark': '#3D2250',
        carbon: '#1C2233',
        'carbon-light': '#252D42',
        'carbon-mid': '#2E3850',
        terra: '#C4622D',
        'terra-light': '#D97440',
        parch: '#F0EDE8',
        'parch-dim': '#C8C4BE',
      },
      fontFamily: {
        garamond: ['EB Garamond', 'Georgia', 'serif'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        cormorant: ['Cormorant Garamond', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
export default config
