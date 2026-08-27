#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FULL_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu;
const PRODUCTION_POSTHOG_HOST = "https://us.i.posthog.com";

function parsePublicViteEnvironment(contents) {
  const parsed = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/u, "");
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function loadVitePublicEnvironment(
  baseEnvironment = process.env,
  mode = "production",
  envDirectory = resolve(repoRoot, "apps/desktop"),
  fileSystem = { existsSync, readFileSync },
) {
  const loaded = {};
  for (const fileName of [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`]) {
    const filePath = resolve(envDirectory, fileName);
    if (!fileSystem.existsSync(filePath)) continue;
    Object.assign(loaded, parsePublicViteEnvironment(fileSystem.readFileSync(filePath, "utf8")));
  }
  return { ...loaded, ...baseEnvironment };
}

export function productionPostHogConfig(environment) {
  const projectKey = (environment.VITE_POSTHOG_KEY ?? "").trim();
  if (!projectKey.startsWith("phc_") || /\s/u.test(projectKey)) {
    throw new Error("Production builds require a public VITE_POSTHOG_KEY beginning with phc_.");
  }

  const rawHost = (environment.VITE_POSTHOG_HOST ?? "").trim();
  if (!rawHost) {
    throw new Error("Production builds require an explicit VITE_POSTHOG_HOST.");
  }

  let host;
  try {
    const url = new URL(rawHost);
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
      throw new Error("non-origin PostHog URL");
    }
    host = url.origin;
  } catch {
    throw new Error("VITE_POSTHOG_HOST must be an absolute HTTPS origin.");
  }
  if (host !== PRODUCTION_POSTHOG_HOST) {
    throw new Error(`VITE_POSTHOG_HOST must match the production CSP origin ${PRODUCTION_POSTHOG_HOST}.`);
  }

  return {
    VITE_POSTHOG_KEY: projectKey,
    VITE_POSTHOG_HOST: host,
  };
}

function run(executable, executableArgs, env = process.env) {
  const result = spawnSync(executable, executableArgs, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function gitCheckoutState() {
  const headResult = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (headResult.status !== 0) return null;
  const statusResult = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (statusResult.status !== 0) {
    throw new Error("Could not verify the Git checkout state for this build.");
  }
  return { head: headResult.stdout.trim(), status: statusResult.stdout.trim() };
}

export function resolveBuildCommit(env = process.env, readGitState = gitCheckoutState, production = false) {
  const explicit = (env.VITE_DRIFTY_BUILD_COMMIT ?? env.GITHUB_SHA ?? "").trim();
  const checkout = readGitState();
  const gitHead = checkout?.head?.trim() ?? "";
  if (production) {
    if (!gitHead) {
      throw new Error("Production builds require a real Git checkout; copied source trees are not accepted.");
    }
    if (checkout.status) {
      throw new Error("Production builds require a clean Git checkout with no tracked or untracked source changes.");
    }
    if (explicit && explicit.toLowerCase() !== gitHead.toLowerCase()) {
      throw new Error("The explicit build commit does not match the checked-out Git HEAD.");
    }
  }
  const candidate = explicit || gitHead;
  if (!candidate) return null;
  if (!FULL_COMMIT_PATTERN.test(candidate)) {
    throw new Error("The build commit must be a full 40- or 64-character hexadecimal commit.");
  }
  return candidate.toLowerCase();
}

export function windowsReleaseConfig(env = process.env) {
  const thumbprint = (env.DRIFTY_WINDOWS_CERTIFICATE_THUMBPRINT ?? "")
    .replace(/\s/gu, "")
    .toUpperCase();
  if (!/^[A-F0-9]{40}$/u.test(thumbprint)) {
    throw new Error("DRIFTY_WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character SHA-1 certificate thumbprint.");
  }
  let timestampUrl;
  try {
    timestampUrl = new URL(env.DRIFTY_WINDOWS_TIMESTAMP_URL ?? "");
  } catch {
    throw new Error("DRIFTY_WINDOWS_TIMESTAMP_URL must be an absolute HTTP(S) URL.");
  }
  if (!new Set(["http:", "https:"]).has(timestampUrl.protocol)) {
    throw new Error("DRIFTY_WINDOWS_TIMESTAMP_URL must be an absolute HTTP(S) URL.");
  }
  if (!(env.TAURI_SIGNING_PRIVATE_KEY ?? "").trim()) {
    throw new Error("TAURI_SIGNING_PRIVATE_KEY is required for Windows updater artifacts.");
  }
  return {
    bundle: {
      createUpdaterArtifacts: true,
      windows: {
        certificateThumbprint: thumbprint,
        digestAlgorithm: "sha256",
        timestampUrl: timestampUrl.href,
      },
    },
  };
}

function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  const command = args.shift() ?? "build";
  const productionIndex = args.indexOf("--production");
  const production = productionIndex >= 0;
  if (production) args.splice(productionIndex, 1);
  const windowsReleaseIndex = args.indexOf("--windows-release");
  const windowsRelease = windowsReleaseIndex >= 0;
  if (windowsRelease) args.splice(windowsReleaseIndex, 1);

  if (command !== "build" && command !== "dev") {
    throw new Error(`Unsupported Tauri command: ${command}`);
  }
  if (windowsRelease && (!production || command !== "build" || process.platform !== "win32")) {
    throw new Error("--windows-release requires a production build running on Windows.");
  }

  const buildEnvironment = production
    ? loadVitePublicEnvironment(process.env)
    : process.env;
  const buildCommit = resolveBuildCommit(buildEnvironment, gitCheckoutState, production);

  const releaseEnvironment = {
    ...buildEnvironment,
    ...(production ? { DRIFTY_RELEASE_BUILD: "1" } : {}),
    ...(windowsRelease ? { DRIFTY_WINDOWS_SIGN_RELEASE: "1" } : {}),
  };
  if (production) Object.assign(releaseEnvironment, productionPostHogConfig(releaseEnvironment));

  if (windowsRelease) {
    args.push("--config", JSON.stringify(windowsReleaseConfig()));
  }

  // The Windows bundle requires a PyInstaller onedir resource that is ignored by
  // Git. Stage and smoke-test it on every native build so a clean checkout cannot
  // accidentally package without the tracker.
  if (process.platform === "win32") {
    run(
      process.execPath,
      [resolve(repoRoot, "scripts/build-tracker-sidecar.mjs")],
      releaseEnvironment,
    );
  }

  const hostPlatform = process.platform === "win32"
    ? "windows"
    : process.platform === "darwin"
      ? "macos"
      : "other";
  const env = {
    ...releaseEnvironment,
    // Platform-owned permissions and copy must be correct on the first frame.
    // Do not depend solely on WebView hints or an asynchronous native permission
    // response to decide which host contract is active.
    VITE_DRIFTY_HOST_PLATFORM: hostPlatform,
    ...(buildCommit ? { VITE_DRIFTY_BUILD_COMMIT: buildCommit } : {}),
    ...(production
      ? { VITE_DRIFTY_AUTH_MODE: "required", VITE_DRIFTY_CHANNEL: "production" }
      : {}),
  };
  run(
    process.execPath,
    [resolve(repoRoot, "node_modules/@tauri-apps/cli/tauri.js"), command, ...args],
    env,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
