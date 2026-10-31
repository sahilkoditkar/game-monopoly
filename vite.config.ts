import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist', chunkSizeWarningLimit: 600 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
