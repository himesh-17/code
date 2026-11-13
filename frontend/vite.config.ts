import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const API = process.env.VITE_API_URL || 'http://localhost:8001'
const proxied = ['/auth', '/content', '/findings', '/kb', '/analytics',
                 '/audit', '/health', '/comments', '/integrations', '/uploads']

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: Object.fromEntries(proxied.map((p) => [p, API])),
  },
  build: {
    target: 'es2020',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Path-boundary match: 'react-chartjs-2' must NOT land in the eager
          // react chunk — chart.js is only needed by the lazy dashboard.
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons'
          }
        },
      },
    },
  },
})
