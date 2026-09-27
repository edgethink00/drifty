#!/usr/bin/env node

// Windows release builds must leave native crashes symbolicated. Each native
// binary has a PDB with the same debug ID; Sentry needs the PE (unwind tables)
// and the PDB (symbols) together, mirroring the Mac release's dSYM upload.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sentryCli = resolve(repoRoot, "node_modules/@sentry/cli/bin/sentry-cli");

export const WINDOWS_NATIVE_SENTRY_PROJECT = "drifty-mac-native";
export const WINDOWS_DEBUG_FILES = Object.freeze([
  "drifty.exe",
  "drifty.pdb",
  "drifty-browser-host.exe",
  "drifty_browser_host.pdb",
]);

export function windowsDebugUploadSettings(environment = process.env) {
  if (!(environment.SENTRY_AUTH_TOKEN ?? "").trim()) {
    throw new Error(
      "SENTRY_AUTH_TOKEN is required for Windows release builds so native debug files can be uploaded.",
    );
  }
  const org = (environment.SENTRY_ORG ?? "edgethink").trim();
  if (!/^[a-z0-9-]+$/u.test(org)) {
    throw new Error("SENTRY_ORG must be a Sentry organization slug.");
  }
  const project = (environment.SENTRY_NATIVE_PROJECT ?? WINDOWS_NATIVE_SENTRY_PROJECT).trim();
  if (project !== WINDOWS_NATIVE_SENTRY_PROJECT) {
    throw new Error(`SENTRY_NATIVE_PROJECT must be ${WINDOWS_NATIVE_SENTRY_PROJECT} for native debug-file upload.`);
  }
  return { org, project };
}

export function windowsDebugFilePaths(
  releaseDirectory = resolve(repoRoot, "src-tauri/target/release"),
  fileSystem = { existsSync, statSync },
) {
  const paths = WINDOWS_DEBUG_FILES.map((name) => resolve(releaseDirectory, name));
  const missing = paths.filter((path) => !fileSystem.existsSync(path) || fileSystem.statSync(path).size === 0);
  if (missing.length > 0) {
    throw new Error(
      `Missing Windows debug files (${missing.join(", ")}); release builds must generate native Sentry debug files.`,
    );
  }
  return paths;
}

export function sentryDebugUploadArgs({ org, project }, paths) {
  return ["debug-files", "upload", "--org", org, "--project", project, "--wait-for", "180", ...paths];
}

export function uploadWindowsDebugFiles(environment = process.env) {
  if (process.platform !== "win32") {
    throw new Error("Windows debug-file upload must run on Windows.");
  }
  const settings = windowsDebugUploadSettings(environment);
  const paths = windowsDebugFilePaths();
  // The token stays in the child environment; it never appears on the command line.
  const result = spawnSync(process.execPath, [sentryCli, ...sentryDebugUploadArgs(settings, paths)], {
    cwd: repoRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Windows debug files uploaded to Sentry project ${settings.project}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  uploadWindowsDebugFiles();
}
