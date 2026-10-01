#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import { windowsDebugUploadSettings } from "./upload-windows-debug-files.mjs";
import { frontendSourceExpectation } from "./windows-builder-rehearsal.mjs";
import { preparedFrontendTauriConfig, verifyPreparedFrontend } from "./windows-frontend-artifacts.mjs";
import { qaBuildConfig } from "./qa/windows-updater-feed.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FULL_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu;
const GOOGLE_DESKTOP_CLIENT_ID_PATTERN = /^[A-Za-z0-9.-]{1,256}\.apps\.googleusercontent\.com$/u;
const GOOGLE_DESKTOP_CLIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const PRODUCTION_POSTHOG_HOST = "https://us.i.posthog.com";

function parseBuildEnvironment(contents) {
  const parsed = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(
      /^\s*(VITE_[A-Z0-9_]+|GOOGLE_CALENDAR_DESKTOP_CLIENT_(?:ID|SECRET))\s*=\s*(.*?)\s*$/u,
    );
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

export function loadBuildEnvironment(
  baseEnvironment = process.env,
  mode = "production",
  envDirectory = resolve(repoRoot, "apps/desktop"),
  fileSystem = { existsSync, readFileSync },
) {
  const loaded = {};
  for (const fileName of [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`]) {
    const filePath = resolve(envDirectory, fileName);
    if (!fileSystem.existsSync(filePath)) continue;
    Object.assign(loaded, parseBuildEnvironment(fileSystem.readFileSync(filePath, "utf8")));
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

export function validateGoogleCalendarBuildConfig(environment) {
  const enabled = (environment.VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED ?? "").trim();
  if (!["", "0", "1"].includes(enabled)) {
    throw new Error("VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED must be 0 or 1.");
  }
  if (enabled !== "1") return;

  const clientId = (environment.GOOGLE_CALENDAR_DESKTOP_CLIENT_ID ?? "").trim();
  if (!GOOGLE_DESKTOP_CLIENT_ID_PATTERN.test(clientId) || clientId.startsWith("your-")) {
    throw new Error(
      "Enabled Google Calendar onboarding requires a valid public GOOGLE_CALENDAR_DESKTOP_CLIENT_ID.",
    );
  }

  // Google's installed-application token endpoint rejects the exchange without
  // the client secret, so an enabled build must carry both halves.
  const clientSecret = (environment.GOOGLE_CALENDAR_DESKTOP_CLIENT_SECRET ?? "").trim();
  if (!GOOGLE_DESKTOP_CLIENT_SECRET_PATTERN.test(clientSecret) || clientSecret.startsWith("your-")) {
    throw new Error(
      "Enabled Google Calendar onboarding requires a valid GOOGLE_CALENDAR_DESKTOP_CLIENT_SECRET.",
    );
  }
}

function run(executable, executableArgs, env = process.env, releasePhase = null) {
  const startedAt = performance.now();
  const result = spawnSync(executable, executableArgs, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (releasePhase) {
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    const label = env.DRIFTY_WINDOWS_SIGN_RELEASE === "1" ? "windows-release" : "windows-build";
    console.log(`[${label}] phase=${releasePhase} seconds=${elapsedSeconds} exit=${result.status ?? result.signal ?? "spawn-error"}`);
  }
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
  const expectedPublisherName = (env.DRIFTY_WINDOWS_EXPECTED_PUBLISHER_NAME ?? "").trim();
  if (!expectedPublisherName || expectedPublisherName.length > 256 || /[\r\n]/u.test(expectedPublisherName)) {
    throw new Error("DRIFTY_WINDOWS_EXPECTED_PUBLISHER_NAME is required for Windows Authenticode identity verification.");
  }
  return {
    bundle: {
      // Sign the NSIS updater explicitly after Tauri returns. Tauri's bundled
      // signer treats an empty-password key as interactive and can wait for
      // stdin forever even when the environment variable is present.
      createUpdaterArtifacts: false,
      windows: {
        certificateThumbprint: thumbprint,
        digestAlgorithm: "sha256",
        timestampUrl: timestampUrl.href,
        signCommand: {
          cmd: "powershell.exe",
          args: [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            resolve(repoRoot, "scripts/sign-windows-artifact.ps1"),
            "-Path",
            "%1",
          ],
        },
      },
    },
  };
}

export function validateWindowsReleaseCompiler(env = process.env) {
  const wrapperVariables = [
    "DRIFTY_WINDOWS_RELEASE_SCCACHE_PATH",
    "RUSTC_WRAPPER",
    "CARGO_BUILD_RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
  ];
  const configured = wrapperVariables.filter((key) => (env[key] ?? "").trim());
  if (configured.length > 0) {
    throw new Error(`Windows release compiler wrappers are disabled after the cache pilot: ${configured.join(", ")}.`);
  }
}

export function validatePreparedFrontendQaVersion(qaVersion) {
  if (qaVersion) throw new Error("Prepared production frontend cannot use a private updater QA version; prepare matching QA assets separately.");
}

export function distributedWindowsReleaseArguments(argv, environment = process.env) {
  const flags = ["--windows-builder-config", "--windows-builder-config-sha256", "--internal-windows-builder"];
  if (!argv.some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))) return null;
  const args = [...argv], result = {};
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index < 0 || args.lastIndexOf(flag) !== index) throw new Error("Provide the pinned builder configuration and explicit internal option once.");
    if (flag === "--internal-windows-builder") { args.splice(index, 1); continue; }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing ${flag} value.`);
    result[flag] = value; args.splice(index, 2);
  }
  if (args.length !== 3 || args[0] !== "build" || new Set(args.slice(1)).size !== 2
    || !args.includes("--production") || !args.includes("--windows-release")
    || !isAbsolute(result["--windows-builder-config"]) || !/^[a-f0-9]{64}$/u.test(result["--windows-builder-config-sha256"])) {
    throw new Error("Distributed Windows builds require build --production --windows-release and absolute pinned configuration without extra overrides.");
  }
  if (["TAURI_CONFIG", "TAURI_CONFIG_PATH", "DRIFTY_WINDOWS_UPDATER_QA", "DRIFTY_WINDOWS_UPDATER_QA_VERSION"].some((key) => environment[key])) {
    throw new Error("Distributed Windows builds reject inherited Tauri/updater QA overrides.");
  }
  return { config: result["--windows-builder-config"], sha256: result["--windows-builder-config-sha256"] };
}

async function main(argv = process.argv.slice(2)) {
  const distributed = distributedWindowsReleaseArguments(argv);
  if (distributed) {
    const { runPipeline } = await import("./windows-release-pipeline.mjs");
    runPipeline(distributed.config, distributed.sha256);
    console.log("Distributed internal Windows candidate verified; publication remains disabled.");
    return;
  }
  const args = [...argv];
  const command = args.shift() ?? "build";
  const productionIndex = args.indexOf("--production");
  const production = productionIndex >= 0;
  if (production) args.splice(productionIndex, 1);
  const windowsReleaseIndex = args.indexOf("--windows-release");
  const windowsRelease = windowsReleaseIndex >= 0;
  if (windowsRelease) args.splice(windowsReleaseIndex, 1);
  const preparedArgs = {};
  for (const flag of ["--prepared-frontend", "--prepared-frontend-sha256"]) {
    const index = args.indexOf(flag);
    if (index >= 0) {
      if (!args[index + 1] || args[index + 1].startsWith("--") || args.lastIndexOf(flag) !== index) throw new Error("Provide each prepared frontend argument once.");
      preparedArgs[flag] = args[index + 1]; args.splice(index, 2);
    }
  }
  const hasPrepared = Object.keys(preparedArgs).length > 0;
  if (hasPrepared && (Object.keys(preparedArgs).length !== 2 || !production || command !== "build" || process.platform !== "win32")) {
    throw new Error("Prepared frontend requires both pinned arguments and a Windows production build.");
  }
  if (hasPrepared && (args.some((arg) => arg === "--config" || arg.startsWith("--config="))
    || process.env.TAURI_CONFIG || process.env.TAURI_CONFIG_PATH)) {
    throw new Error("Prepared frontend cannot be combined with unverified Tauri configuration overrides.");
  }
  const qaIndex = args.indexOf("--windows-updater-qa-version");
  const qaVersion = qaIndex < 0 ? null : args[qaIndex + 1];
  if (qaIndex >= 0) {
    if (!windowsRelease || !production || !qaVersion) throw new Error("Private updater QA requires a signed Windows production-mode build and explicit QA version.");
    qaBuildConfig(qaVersion);
    args.splice(qaIndex, 2);
    args.push("--features", "windows-updater-qa");
  }

  if (hasPrepared) validatePreparedFrontendQaVersion(qaVersion);

  if (command !== "build" && command !== "dev") {
    throw new Error(`Unsupported Tauri command: ${command}`);
  }
  if (windowsRelease && (!production || command !== "build" || process.platform !== "win32")) {
    throw new Error("--windows-release requires a production build running on Windows.");
  }

  // Vite reads these files for the renderer, but Cargo is a sibling process.
  // Load the allowlisted Desktop OAuth build values here as well so dev and
  // release builds compile the same capability. Installed-app client secrets
  // are distributed identifiers rather than confidential server credentials.
  const buildEnvironment = loadBuildEnvironment(
    process.env,
    production ? "production" : "development",
  );
  if (!qaVersion && (buildEnvironment.DRIFTY_WINDOWS_UPDATER_QA || buildEnvironment.DRIFTY_WINDOWS_UPDATER_QA_VERSION)) {
    throw new Error("Private updater QA environment requires --windows-updater-qa-version; normal builds refuse it.");
  }
  validateGoogleCalendarBuildConfig(buildEnvironment);
  const buildCommit = resolveBuildCommit(buildEnvironment, gitCheckoutState, production);

  const releaseEnvironment = {
    ...buildEnvironment,
    ...(qaVersion ? { DRIFTY_WINDOWS_UPDATER_QA: "1", DRIFTY_WINDOWS_UPDATER_QA_VERSION: qaVersion } : {}),
    ...(production ? { DRIFTY_RELEASE_BUILD: "1" } : {}),
    ...(windowsRelease ? { DRIFTY_WINDOWS_SIGN_RELEASE: "1" } : {}),
  };
  if (production) Object.assign(releaseEnvironment, productionPostHogConfig(releaseEnvironment));
  if (hasPrepared) {
    const manifestFile = resolve(preparedArgs["--prepared-frontend"]);
    const expected = frontendSourceExpectation(repoRoot, buildCommit, releaseEnvironment);
    const proof = verifyPreparedFrontend(manifestFile, preparedArgs["--prepared-frontend-sha256"], expected);
    args.push("--config", JSON.stringify(preparedFrontendTauriConfig(proof, { node: process.execPath,
      verifier: resolve(repoRoot, "scripts/prepare-windows-frontend.mjs"), repo: repoRoot, manifestFile, expected })));
  }
  const timedWindowsBuild = windowsRelease || (process.platform === "win32" && command === "build"
    && releaseEnvironment.DRIFTY_WINDOWS_BUILD_TIMINGS === "1");

  if (windowsRelease) {
    validateWindowsReleaseCompiler(releaseEnvironment);
    args.push("--config", JSON.stringify({ ...windowsReleaseConfig(), ...(qaVersion ? qaBuildConfig(qaVersion) : {}) }));
    // Fail before the long build when native debug files could not be uploaded.
    windowsDebugUploadSettings(releaseEnvironment);
    run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(repoRoot, "scripts/windows-release-signing-preflight.ps1"),
      ],
      releaseEnvironment,
      "signing-preflight",
    );
  }

  // The Windows bundle requires a PyInstaller onedir resource that is ignored by
  // Git. Stage and smoke-test it on every native build so a clean checkout cannot
  // accidentally package without the tracker.
  if (process.platform === "win32") {
    if (command === "build") {
      run(
        process.execPath,
        [resolve(repoRoot, "scripts/prepare-windows-vc-redist.mjs")],
        releaseEnvironment,
        timedWindowsBuild ? "vc-redist" : null,
      );
    }
    run(
      process.execPath,
      [resolve(repoRoot, "scripts/build-tracker-sidecar.mjs")],
      releaseEnvironment,
      timedWindowsBuild ? "tracker-sidecar" : null,
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
    timedWindowsBuild ? "tauri-build-and-bundle" : null,
  );
  if (windowsRelease) {
    run(
      process.execPath,
      [resolve(repoRoot, "scripts/sign-windows-updater-artifact.mjs")],
      env,
      "updater-signature",
    );
    run(
      process.execPath,
      [resolve(repoRoot, "scripts/upload-windows-debug-files.mjs")],
      env,
      "debug-upload",
    );
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
