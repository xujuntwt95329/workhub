import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      skipFull: false,
      include: ["shared/**/*.ts", "server/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["server/index.ts", "server/seed.ts"],
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
