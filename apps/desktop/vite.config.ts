import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@dtime/domain",
        replacement: new URL("../../packages/domain/src/index.ts", import.meta.url).pathname,
      },
      {
        find: "@dtime/charts",
        replacement: new URL("../../packages/charts/src/index.tsx", import.meta.url).pathname,
      },
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "node",
    globals: true,
  },
});
