import { defineConfig } from "vitest/config";

// Database integration tests: run against a migrated Supabase-compatible Postgres.
// Start it with `npm run stack:start` (or point TEST_DATABASE_URL at another instance).
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
