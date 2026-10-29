/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * X/Facebook ignore relative og:image URLs. At build time, make them absolute from SITE_URL
 * (e.g. SITE_URL=https://atlas.example.com npm run build) or Vercel's production domain.
 */
function absoluteShareUrls(): Plugin {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const site = (process.env.SITE_URL ?? (vercel ? `https://${vercel}` : '')).replace(/\/$/, '');
  return {
    name: 'absolute-share-urls',
    transformIndexHtml(html) {
      if (!site) return html;
      return html
        .replaceAll('content="/og.png"', `content="${site}/og.png"`)
        .replace('</title>', `</title>
    <link rel="canonical" href="${site}/" />
    <meta property="og:url" content="${site}/" />`);
    },
  };
}

/** Content hash of public/data, appended to data URLs (they aren't hashed by the bundler). */
function dataVersion(): string {
  const h = createHash('sha256');
  for (const f of readdirSync('public/data').sort()) h.update(f).update(readFileSync(`public/data/${f}`));
  return h.digest('hex').slice(0, 12);
}

export default defineConfig({
  plugins: [react(), absoluteShareUrls()],
  define: { __DATA_VERSION__: JSON.stringify(dataVersion()) },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Charts share one d3 chunk, cached across views.
        manualChunks(id: string) {
          if (/node_modules[\\/](d3|d3-[^\\/]+|topojson-client|internmap|delaunator|robust-predicates)[\\/]/.test(id)) return 'd3';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Whole-page tests render real data in jsdom; 5 s (the default) times out on a busy machine or CI runner.
    testTimeout: 30_000,
  },
});
