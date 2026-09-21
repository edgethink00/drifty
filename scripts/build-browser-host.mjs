#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function browserHostBuildEnvironment(environment = process.env) {
  const config = environment.TAURI_CONFIG ? JSON.parse(environment.TAURI_CONFIG) : {};
  // This standalone build still runs this package's Tauri build.rs. Requiring
  // the not-yet-created tracker resource here forms a clean-checkout dependency
  // cycle, so skip bundle resources only in this child process.
  return {
    ...environment,
    TAURI_CONFIG: JSON.stringify({
      ...config,
      bundle: { ...config.bundle, resources: [] },
    }),
  };
}

export function browserHostOutputPath(release, environment = process.env) {
  const configuredTargetDirectory = environment.CARGO_TARGET_DIR;
  const targetDirectory = configuredTargetDirectory
    ? isAbsolute(configuredTargetDirectory)
      ? configuredTargetDirectory
      : resolve(repoRoot, configuredTargetDirectory)
    : resolve(repoRoot, "src-tauri", "target");
  return resolve(
    targetDirectory,
    release ? "release" : "debug",
    "drifty-browser-host.exe",
  );
}

function main() {
  const release = process.argv.includes("--release");

  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("The Browser Bridge host must be built natively on Windows x64.");
  }

  const args = [
    "build",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--bin",
    "drifty-browser-host",
    ...(release ? ["--release"] : []),
  ];
  const result = spawnSync("cargo", args, {
    cwd: repoRoot,
    env: browserHostBuildEnvironment(),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  console.log(`created=${browserHostOutputPath(release)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
