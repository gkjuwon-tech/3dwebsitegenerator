import { defineConfig } from 'vite';

// The generator service (FastAPI) runs separately. Proxy the SDK's /api calls
// and the static /assets it serves so the studio is same-origin in dev.
const GENERATOR = process.env.HERO_GENERATOR_URL ?? 'http://localhost:8000';

export default defineConfig({
  server: {
    proxy: {
      '/api': { target: GENERATOR, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
      '/assets': { target: GENERATOR, changeOrigin: true },
    },
  },
  // workspace packages are plain TS — let esbuild transpile them
  optimizeDeps: { include: ['three'] },
});
