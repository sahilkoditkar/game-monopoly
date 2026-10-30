import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
