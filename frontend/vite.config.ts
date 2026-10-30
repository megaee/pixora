import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev`  -> UI on :5173, /api proxied to the FastAPI backend on :8000
// `npm run build`-> bundles into the Python package so `photo-cleanup` serves it
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    outDir: '../backend/src/photo_cleanup/static',
    emptyOutDir: true,
  },
})
