#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trackerRoot = resolve(repoRoot, "services/tracker-python");

function pythonCandidates() {
  if (process.env.DRIFTY_TEST_PYTHON) {
    return [{ command: process.env.DRIFTY_TEST_PYTHON, prefix: [] }];
  }
  if (process.platform === "win32") {
    return [
      { command: "py", prefix: ["-3"] },
      { command: "python", prefix: [] },
      { command: "python3", prefix: [] },
    ];
  }
  return [
    { command: "python3", prefix: [] },
    { command: "python", prefix: [] },
  ];
}

function resolvePython() {
  for (const candidate of pythonCandidates()) {
    const probe = spawnSync(candidate.command, [...candidate.prefix, "--version"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error("No usable Python 3 interpreter was found for tracker tests.");
}

const python = resolvePython();
const requestedArgs = process.argv.slice(2);
const testArgs = requestedArgs.length > 0
  ? requestedArgs
  : ["-m", "unittest", "discover", "-s", "services/tracker-python/tests", "-v"];
const result = spawnSync(python.command, [...python.prefix, ...testArgs], {
  cwd: repoRoot,
  env: { ...process.env, PYTHONPATH: trackerRoot },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
