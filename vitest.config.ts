import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json', 'html'],
      reportsDirectory: './test-results/coverage',
      reportOnFailure: true,
    },
  },
});