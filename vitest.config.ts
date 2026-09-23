import { defineConfig } from 'vitest/config';

// Offline unit suite only. Live checks against a Foundry sandbox are scripts/verify-*.mjs and
// scripts/parity-*.mjs, run by hand, one world-driver at a time.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
