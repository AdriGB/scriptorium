/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./index.html', './js/**/*.js'],
    theme: {
        extend: {
            colors: {
                bg: '#080912',
                bg2: '#0c0e1c',
                surface: 'rgba(16,18,32,0.56)',
                surface2: '#181b2e',
                border1: '#252848',
                border2: '#363a6a',
                gold: '#c9a84c',
                gold2: '#e8cc80',
                goldDim: '#7a6230',
                violet: '#6d52c4',
                violet2: '#a07eff',
                violetDim: '#2d2558',
                text1: '#ddd5c0',
                text2: '#a09880',
                text3: '#847b66',
                char: '#e8b860',
                user: '#7ea8e8',
                editor: '#3ab8a0',
                editorDim: '#1a4a3e'
            },
            fontFamily: {
                cinzel: ['Georgia', 'Cambria', 'serif'],
                cinzelDeco: ['Georgia', 'Cambria', 'serif'],
                crimson: ['Georgia', 'Cambria', 'serif'],
                dmMono: ['Consolas', 'Cascadia Mono', 'monospace']
            },
            animation: {
                'pulse-glow': 'pulseGlow 4s ease-in-out infinite',
                'spin-slow': 'spin 12s linear infinite',
                'fade-in-up': 'fadeInUp 0.4s ease-out forwards'
            },
            keyframes: {
                pulseGlow: {
                    '0%, 100%': { boxShadow: '0 0 14px rgba(201,168,76,0.15),0 0 40px rgba(201,168,76,0.05)' },
                    '50%': { boxShadow: '0 0 22px rgba(201,168,76,0.25),0 0 60px rgba(201,168,76,0.1)' }
                },
                fadeInUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' }
                }
            }
        }
    },
    plugins: []
};
