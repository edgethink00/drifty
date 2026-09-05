import process from "node:process";
import { execFileSync } from "node:child_process";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { previewAiProxyPlugin } from "./vitePreviewAiProxy";

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

function resolveAppVersion(): string {
  return process.env.npm_package_version?.trim() || "unknown";
}

function resolveSentryRelease(appVersion: string, buildCommit: string): string {
  const trimmedCommit = buildCommit.trim();
  if (!trimmedCommit || trimmedCommit === "unknown") return `drifty-mac@${appVersion}`;
  return `drifty-mac@${appVersion}+${trimmedCommit.slice(0, 12)}`;
}

function shouldUploadSentrySourcemaps(command: string): boolean {
  return command === "build" && Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);
}

export default defineConfig(({ command, mode }) => {
  const devSkipOnboarding = command === "serve" && mode !== "production" && process.env.SKIP_ONBOARDING === "1";
  const devSkipOnboardingAuth = command === "serve" && mode !== "production" && process.env.SKIP_ONBOARDING_AUTH === "1";
  const devForceOnboarding = command === "serve" && mode !== "production" && process.env.FORCE_ONBOARDING === "1";
  const devAllowOnboardingAuthSkip = command === "serve" && mode !== "production" && process.env.ALLOW_ONBOARDING_AUTH_SKIP === "1";
  const buildCommit = resolveBuildCommit();
  const appVersion = resolveAppVersion();
  const uploadSentrySourcemaps = shouldUploadSentrySourcemaps(command);
  const enablePreviewAiProxy = command === "serve" && mode !== "production" && process.env.VITE_DRIFTY_PREVIEW === "1";

  return {
    define: {
      __DRIFTY_BUILD_COMMIT__: JSON.stringify(buildCommit),
      __DRIFTY_APP_VERSION__: JSON.stringify(appVersion),
      __DRIFTY_DEV_SKIP_ONBOARDING__: JSON.stringify(devSkipOnboarding),
      __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__: JSON.stringify(devSkipOnboardingAuth),
      __DRIFTY_DEV_FORCE_ONBOARDING__: JSON.stringify(devForceOnboarding),
      __DRIFTY_DEV_ALLOW_ONBOARDING_AUTH_SKIP__: JSON.stringify(devAllowOnboardingAuthSkip),
    },
    plugins: [
      react(),
      previewAiProxyPlugin(enablePreviewAiProxy),
      ...(uploadSentrySourcemaps
        ? [
            sentryVitePlugin({
              authToken: process.env.SENTRY_AUTH_TOKEN,
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              release: {
                name: process.env.SENTRY_RELEASE ?? resolveSentryRelease(appVersion, buildCommit),
              },
              sourcemaps: {
                filesToDeleteAfterUpload: ["./dist/**/*.map"],
              },
              telemetry: false,
            }),
          ]
        : []),
    ],
    build: {
      ...(uploadSentrySourcemaps ? { sourcemap: "hidden" as const } : {}),
      rollupOptions: {
        input: {
          auxiliary: new URL("./auxiliary.html", import.meta.url).pathname,
          main: new URL("./index.html", import.meta.url).pathname,
        },
      },
    },
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
      // Windows and the shared CI host have enough memory for two Vitest
      // workers, but default parallelism starves long jsdom integration files
      // and makes their per-test timeouts flaky. Keep native defaults locally.
      maxWorkers: process.platform === "win32" || process.env.CI ? 2 : undefined,
      setupFiles: ["./src/test/setupTimezone.ts"],
    },
  };
});
