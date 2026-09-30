#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { constants } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Tauri validates configured resource roots while compiling its test manifest.
// The real onedir bundle is intentionally gitignored and is built by run-tauri;
// cargo tests only need the root to exist because they never launch the sidecar.
function ensureDummyTrackerResource(relativePath) {
  const target = resolve(repoRoot, relativePath);
  if (existsSync(target)) return;
  mkdirSync(target, { recursive: true });
}

let temporaryHelper;
if (process.platform === "win32") {
  ensureDummyTrackerResource("src-tauri/binaries/drifty-tracker-x86_64-pc-windows-msvc");
} else if (process.platform === "darwin") {
  const triple = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  ensureDummyTrackerResource(`src-tauri/binaries/drifty-tracker-${triple}`);
  // Tauri 2.12 also validates the generated native helper while compiling the
  // test manifest. Tests do not execute/package it. Remove this placeholder
  // afterward and preserve a real helper when the worktree already has one.
  const helper = resolve(repoRoot, `src-tauri/binaries/chatgpt-session-ax-${triple}`);
  if (!existsSync(helper)) {
    writeFileSync(helper, "unit-test manifest placeholder\n", { flag: "wx" });
    temporaryHelper = helper;
  }
}

let result;
try {
  result = spawnSync(
    "cargo",
    ["test", "--manifest-path", "src-tauri/Cargo.toml", ...process.argv.slice(2)],
    { cwd: repoRoot, env: process.env, stdio: "inherit" },
  );
} finally {
  if (temporaryHelper) rmSync(temporaryHelper);
}
if (result.error) {
  // Report a cargo that cannot start the way a shell does instead of a stack
  // trace: 127 when it is missing, 126 when it is not executable.
  const shellFailure = { ENOENT: [127, "command not found"], EACCES: [126, "Permission denied"] }[result.error.code];
  if (shellFailure) {
    const [status, message] = shellFailure;
    console.error(`cargo: ${message}`);
    process.exit(status);
  }
  throw result.error;
}
// A cargo killed by a signal reports status null. Exit the way a shell reports
// that death (128 + signal number) so callers such as the pre-push hook still
// record which signal ended the run; an unknown signal name is a plain failure.
if (result.signal) {
  const signalNumber = constants.signals[result.signal];
  process.exit(signalNumber ? 128 + signalNumber : 1);
}
process.exit(result.status ?? 1);
