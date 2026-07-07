import process from "node:process";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveBuildCommit(): string {
  const envCommit = process.env.VITE_DRIFTY_BUILD_COMMIT ?? process.env.GITHUB_SHA ?? "";
  const trimmedEnvCommit = envCommit.trim();
  if (trimmedEnvCommit.length > 0) return trimmedEnvCommit;

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ command, mode }) => {
  const devSkipOnboarding = command === "serve" && mode !== "production" && process.env.SKIP_ONBOARDING === "1";
  const devSkipOnboardingAuth = command === "serve" && mode !== "production" && process.env.SKIP_ONBOARDING_AUTH === "1";
  const buildCommit = resolveBuildCommit();

  return {
    define: {
      __DRIFTY_BUILD_COMMIT__: JSON.stringify(buildCommit),
      __DRIFTY_DEV_SKIP_ONBOARDING__: JSON.stringify(devSkipOnboarding),
      __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__: JSON.stringify(devSkipOnboardingAuth),
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
      setupFiles: ["./src/test/setupTimezone.ts"],
    },
  };
});
