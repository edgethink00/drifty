import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const devSkipOnboarding = command === "serve" && mode !== "production" && process.env.SKIP_ONBOARDING === "1";

  return {
    define: {
      __DRIFTY_DEV_SKIP_ONBOARDING__: JSON.stringify(devSkipOnboarding),
    },
    plugins: [react()],
    resolve: {
      alias: [
        {
          find: "@drifty/domain",
          replacement: new URL("../../packages/domain/src/index.ts", import.meta.url).pathname,
        },
        {
          find: "@drifty/charts",
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
  };
});
