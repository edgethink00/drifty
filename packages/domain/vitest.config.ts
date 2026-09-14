import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const domainRoot = fileURLToPath(new URL(".", import.meta.url));
const cacheDir = fileURLToPath(new URL("../../.vite-cache/domain-vitest", import.meta.url));

export default defineConfig({
  root: domainRoot,
  cacheDir,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    passWithNoTests: false,
  },
});
