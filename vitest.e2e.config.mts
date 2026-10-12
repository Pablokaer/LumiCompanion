import { defineConfig } from 'vitest/config';

// End-to-end tests: they start the real, built app (npm run build first) and drive it over the DevTools protocol.
export default defineConfig({
  test: { include: ['tests/e2e/**/*.e2e.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 90_000, fileParallelism: false },
});
