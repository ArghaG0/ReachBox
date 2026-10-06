import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { ETHEREAL_CACHE: "no" },
    environment: "node", include: ["tests/ethereal/**/*.test.ts"],
    testTimeout: 120000, hookTimeout: 30000, fileParallelism: false,
  },
});
