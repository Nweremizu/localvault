import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Production pages run inside WebView2 from https://app.localvault/ only; the dev server keeps Vite's inline HMR scripts.
const csp: Plugin = {
  name: 'localvault-csp',
  apply: 'build',
  transformIndexHtml: html => html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`),
};

export default defineConfig({
  plugins: [react(), tailwindcss(), csp],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  test: { environment: 'jsdom', include: ['src/**/*.test.tsx'], clearMocks: true },
});
