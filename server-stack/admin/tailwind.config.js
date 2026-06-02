/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Inter Variable"',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Segoe UI"',
          'system-ui',
          'sans-serif'
        ]
      },
      letterSpacing: {
        tighter: '-0.022em'
      },
      colors: {
        surface: {
          window: '#0b0e16',
          sidebar: '#121726',
          card: '#181f2f',
          raised: '#202a45',
          input: '#252f48',
          border: '#2a3348',
          divider: 'rgba(42, 51, 72, 0.65)'
        },
        label: {
          primary: '#eef1f8',
          secondary: '#8b95b0',
          tertiary: '#697393'
        },
        tint: {
          blue: '#7c8cff',
          'blue-hover': '#a5b0ff'
        },
        sidebar: {
          bg: '#121726',
          hover: 'rgba(255, 255, 255, 0.06)',
          active: 'rgba(255, 255, 255, 0.1)',
          border: '#2a3348',
          text: '#eef1f8',
          muted: '#8b95b0'
        }
      },
      boxShadow: {
        chromeTop: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        sheet:
          '0 0 0 1px rgba(42, 51, 72, 0.85), 0 12px 40px rgba(0, 0, 0, 0.45)',
        focus:
          '0 0 0 2px #0b0e16, 0 0 0 4px rgba(124, 140, 255, 0.38)'
      },
      transitionDuration: {
        DEFAULT: '200ms'
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.32, 0.72, 0, 1)'
      }
    }
  },
  plugins: []
}
