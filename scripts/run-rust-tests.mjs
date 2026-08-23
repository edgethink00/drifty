#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Tauri validates configured resource roots while compiling its test manifest.
// The real onedir bundle is intentionally gitignored and is built by run-tauri;
// cargo tests only need the root to exist because they never launch the sidecar.
if (process.platform === "win32") {
  mkdirSync(
    resolve(repoRoot, "src-tauri/binaries/drifty-tracker-x86_64-pc-windows-msvc"),
    { recursive: true },
  );
}

const result = spawnSync(
  "cargo",
  ["test", "--manifest-path", "src-tauri/Cargo.toml", ...process.argv.slice(2)],
  { cwd: repoRoot, env: process.env, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
