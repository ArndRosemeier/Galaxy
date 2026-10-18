import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs: the app is published under a sub-path and must not care
  // which one. Anything absolute breaks the first deploy under /galaxy/.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // three.js is one big vendor chunk; splitting it would only add a round trip.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Generation is CPU-bound but small; keep a generous ceiling so a slow shared
    // host cannot turn a correct test red.
    testTimeout: 20_000,
  },
});
