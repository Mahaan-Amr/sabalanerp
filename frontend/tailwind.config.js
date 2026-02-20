/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Silver (Primary) - Light Mode
        'silver': {
          50: '#f8f9fa',
          100: '#f1f3f4',
          200: '#e8eaed',
          300: '#dadce0',
          400: '#bdc1c6',
          500: '#9aa0a6',
          600: '#80868b',
          700: '#5f6368',
          800: '#3c4043',
          900: '#202124',
        },
        // Gold (Secondary) - Light Mode
        'gold': {
          50: '#fffdf7',
          100: '#fff9e6',
          200: '#fff2cc',
          300: '#ffe699',
          400: '#ffd966',
          500: '#ffcc33',
          600: '#ffbf00',
          700: '#e6ac00',
          800: '#cc9900',
          900: '#b38600',
        },
        // Teal (Accent) - Light Mode
        'teal': {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        // Dark Mode Colors
        'dark-silver': {
          50: '#1a1a1a',
          100: '#2d2d2d',
          200: '#404040',
          300: '#525252',
          400: '#666666',
          500: '#808080',
          600: '#999999',
          700: '#b3b3b3',
          800: '#cccccc',
          900: '#e6e6e6',
        },
        'dark-gold': {
          50: '#1a1a0a',
          100: '#2d2d1a',
          200: '#40402d',
          300: '#525240',
          400: '#666652',
          500: '#808066',
          600: '#999980',
          700: '#b3b399',
          800: '#ccccb3',
          900: '#e6e6cc',
        },
        'dark-teal': {
          50: '#0a1a1a',
          100: '#1a2d2d',
          200: '#2d4040',
          300: '#405252',
          400: '#526666',
          500: '#668080',
          600: '#809999',
          700: '#99b3b3',
          800: '#b3cccc',
          900: '#cce6e6',
        },
      },
      fontFamily: {
        'vazir': ['Yekan Bakh', 'Tahoma', 'Arial', 'sans-serif'],
        'samim': ['Yekan Bakh', 'Tahoma', 'Arial', 'sans-serif'],
      },
      backdropBlur: {
        'xs': '2px',
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '24px',
        '3xl': '32px',
      },
      animation: {
        'liquid': 'liquid 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'glass-hover': 'glass-hover 0.3s ease-out',
        'theme-transition': 'theme-transition 0.3s ease-in-out',
      },
      keyframes: {
        liquid: {
          '0%': { transform: 'scale(1) translateY(0px)' },
          '50%': { transform: 'scale(1.02) translateY(-2px)' },
          '100%': { transform: 'scale(1) translateY(0px)' },
        },
        'glass-hover': {
          '0%': { 
            backdropFilter: 'blur(12px)',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
          },
          '100%': { 
            backdropFilter: 'blur(20px)',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
          },
        },
        'theme-transition': {
          '0%': { opacity: '0.8' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
