import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: path("./review/memory-graph/"),
  base: "./",
  envPrefix: "VITE_MEMORY_GRAPH_REVIEW_",
  publicDir: false,
  plugins: [react()],
  define: {
    __DRIFTY_SCREEN_CONTEXT_MODE__: JSON.stringify("included"),
    __DRIFTY_BUILD_COMMIT__: JSON.stringify("memory-graph-review"),
    __DRIFTY_APP_VERSION__: JSON.stringify("review"),
  },
  resolve: {
    alias: {
      "@drifty/domain": path("../../packages/domain/src/index.ts"),
      "@drifty/charts": path("../../packages/charts/src/index.tsx"),
    },
  },
});
