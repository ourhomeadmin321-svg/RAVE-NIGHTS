import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  // GLSL is imported with `?raw`, which Vite handles natively. Listing the
  // extension here keeps it out of the module graph transform pipeline.
  assetsInclude: ['**/*.glsl'],
});
