import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API_TARGET lets the UI run against a deployed backend without the api container.
const API = process.env.API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev proxies to the api container so the browser only ever talks
    // to one origin — same as the Caddy setup in production.
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true, changeOrigin: true, headers: { origin: API } },
    },
  },
});
