import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Web edition: the page may only load its own files and blob: images; `connect-src 'self'`
 *  means the browser itself refuses to send anything (like photos) to another server. */
const CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const webCsp = (): Plugin => ({
  name: 'pixora-web-csp',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    ),
})

// `npm run dev`        -> UI on :5173, /api proxied to the FastAPI backend on :8000
// `npm run build`      -> desktop app: bundles into the Python package (`pixora` serves it)
// `npm run build:web`  -> browser-only web edition in dist/ (GitHub Pages; relative paths)
export default defineConfig(({ mode }) =>
  mode === 'web'
    ? {
        plugins: [react(), webCsp()],
        base: './',
        build: { outDir: 'dist', emptyOutDir: true },
      }
    : {
        plugins: [react()],
        server: {
          port: 5173,
          proxy: { '/api': 'http://127.0.0.1:8000' },
        },
        build: {
          outDir: '../backend/src/photo_cleanup/static',
          emptyOutDir: true,
        },
      },
)
