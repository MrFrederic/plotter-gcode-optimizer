import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/app-assets/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api/v2': 'http://localhost:8000',
      '/upload': 'http://localhost:8000',
      '/upload-svg': 'http://localhost:8000',
      '/download': 'http://localhost:8000',
    },
  },
})
