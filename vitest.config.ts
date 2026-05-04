import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['packages/*/src/**/*.{test,spec}.ts', 'packages/*/test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/perf/**'],
    environment: 'node',
  },
});
