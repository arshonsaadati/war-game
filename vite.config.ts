import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@simulation': resolve(__dirname, 'src/simulation'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@game': resolve(__dirname, 'src/game'),
    },
  },
  build: {
    target: 'esnext',
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer if we ever need it
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
