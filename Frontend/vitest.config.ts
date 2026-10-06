import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["../tests/frontend/setup.ts"],
    include: ["../tests/frontend/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Tests live outside this package; resolve their dependencies from here.
      "@tanstack/react-query": path.resolve(__dirname, "node_modules/@tanstack/react-query"),
      "@tanstack/react-router": path.resolve(__dirname, "node_modules/@tanstack/react-router"),
      "@testing-library/jest-dom/vitest": path.resolve(__dirname, "node_modules/@testing-library/jest-dom/dist/vitest.mjs"),
      "vitest": path.resolve(__dirname, "node_modules/vitest"),
    },
  },
});
