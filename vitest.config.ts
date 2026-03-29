import { defineConfig } from 'vitest/config';
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
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: ['verbose', 'json'],
    outputFile: 'test-results.json',
  },
});
