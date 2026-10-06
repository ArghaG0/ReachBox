import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", include: ["tests/recovery/**/*.test.ts"],
    testTimeout: 40000, hookTimeout: 30000, fileParallelism: false,
  },
});
