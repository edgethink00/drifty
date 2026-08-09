#!/usr/bin/env node
// Runs `tauri dev` isolated per worktree so multiple worktrees can run the
// desktop app at the same time (docs/agent-operations.md, "Parallel Tauri QA").
//
// Isolation is derived deterministically from the worktree path:
//   - Vite port:        1421-1439 (hash of the worktree path; falls back to
//     the next free port in range when the derived one is taken)
//   - bundle identifier: so.drifty.mac.wt-<slug>  (separate single-instance
//     socket AND separate Application Support data dir / tracker DB)
//   - devUrl + devCsp:  rewritten to the isolated port so HMR works
//
// The base tauri.conf.json is never modified; overrides go through the Tauri
// CLI `--config` JSON merge patch written to a temp file.
//
// Env knobs:
//   DRIFTY_ISOLATED_PORT=1425   force a specific port (skips fallback scan)
//   DRIFTY_ISOLATED_FRESH_DB=1  start with an empty tracker DB (default seeds
//                               a copy of the normal dev DB so the UI has data)
//   SKIP_ONBOARDING=0           show onboarding (isolated data dirs have fresh
//                               localStorage, so onboarding would appear on
//                               every first launch; default is skip)
//
// Known limits (see docs/agent-operations.md): deep links (drifty://) are not
// testable in any `tauri dev` instance, macOS TCC permissions must be granted
// once per worktree binary, and the final crate relinks (~40s) when switching
// between isolated and normal dev in the same worktree.

import { createHash } from "node:crypto";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BASE_PORT = 1420;
const PORT_RANGE = Object.freeze({ start: 1421, end: 1439 });

export function deriveIsolation(repoRoot, baseIdentifier) {
  const pathHash = createHash("sha256").update(repoRoot).digest();
  const pathHashHex = pathHash.toString("hex").slice(0, 8);
  const nameSlug =
    path
      .basename(repoRoot)
      .toLowerCase()
      .replace(/^drifty_mac[_-]*/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "root";
  // The path hash keeps practical collision risk low when long or duplicate
  // worktree basenames collapse to the same slug.
  const slug = `${nameSlug}-${pathHashHex}`;
  const derivedPort =
    PORT_RANGE.start +
    (pathHash.readUInt16BE(0) % (PORT_RANGE.end - PORT_RANGE.start + 1));

  return {
    slug,
    productName: `drifty-wt-${nameSlug.slice(0, 20)}-${pathHashHex}`,
    identifier: `${baseIdentifier}.wt-${slug}`,
    derivedPort,
  };
}

export function portCandidates(derivedPort) {
  const candidates = [derivedPort];
  for (let port = PORT_RANGE.start; port <= PORT_RANGE.end; port += 1) {
    if (port !== derivedPort) candidates.push(port);
  }
  return candidates;
}

export function parseForcedPort(value) {
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === BASE_PORT) {
    throw new RangeError(`must be 1024-65535 and not ${BASE_PORT}`);
  }
  return port;
}

export function parsePortOwnershipResult(result) {
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`check-dev-server.sh failed with exit ${result.status}`);
  }
  const stdout = result.stdout ?? "";
  const free = /^Port \d+ is free\./mu.test(stdout);
  const inUse = /^Port \d+ is in use:/mu.test(stdout);
  if (!free && !inUse) {
    throw new Error(`check-dev-server.sh returned unexpected output (exit ${result.status})`);
  }
  return { ok: result.status === 0, free, stdout };
}

export function buildConfigPatch(baseConf, isolation, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === BASE_PORT) {
    throw new RangeError(`isolated port must be 1024-65535 and not ${BASE_PORT}`);
  }
  const devCsp = baseConf?.app?.security?.devCsp;
  if (typeof devCsp !== "string" || !devCsp.includes(`:${BASE_PORT}`)) {
    throw new Error(`tauri.conf.json app.security.devCsp must include :${BASE_PORT}`);
  }
  if (!Array.isArray(baseConf?.app?.windows) || baseConf.app.windows.length === 0) {
    throw new Error(`tauri.conf.json app.windows must contain at least one window`);
  }
  const isolatedDevCsp = devCsp.replaceAll(`:${BASE_PORT}`, `:${port}`);
  // Isolated dev is an agent/background QA surface. Launch focus is never
  // needed: attended input can activate the ready window explicitly.
  const windows = (baseConf.app.windows ?? []).map((window) => ({
    ...window,
    focus: false,
  }));

  return {
    identifier: isolation.identifier,
    productName: isolation.productName,
    build: {
      devUrl: `http://127.0.0.1:${port}`,
      beforeDevCommand: `cd apps/desktop && npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    },
    // A clean task worktree does not contain the gitignored PyInstaller
    // sidecar. Isolated mode is source-only development, and the Rust bridge
    // already falls back to services/tracker-python/app/main.py when no
    // packaged sidecar is configured. Keep release/plain Tauri config intact.
    bundle: { externalBin: [] },
    app: { security: { devCsp: isolatedDevCsp }, windows },
  };
}

export function buildChildEnv(inheritedEnv = process.env) {
  const childEnv = { ...inheritedEnv };
  delete childEnv.DRIFTY_ISOLATED_FOCUS;
  childEnv.DRIFTY_ISOLATED_DEV = "1";
  if (childEnv.SKIP_ONBOARDING === undefined) childEnv.SKIP_ONBOARDING = "1";
  return childEnv;
}

export function removeIsolatedDatabase(isolatedDb) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const candidate = `${isolatedDb}${suffix}`;
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}

export function buildTrackerStopInvocation(repoRoot, isolatedDb, inheritedEnv = process.env) {
  const trackerRoot = path.join(repoRoot, "services", "tracker-python");
  const trackerScript =
    inheritedEnv.DRIFTY_TRACKER_SCRIPT ?? path.join(trackerRoot, "app", "main.py");
  const pythonBin =
    inheritedEnv.DRIFTY_PYTHON_BIN ?? (existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3");
  return {
    command: pythonBin,
    args: [
      trackerScript,
      "--db",
      isolatedDb,
      "--request-json",
      JSON.stringify({ command: "stop_tracking", payload: {} }),
    ],
    env: { ...inheritedEnv, PYTHONPATH: trackerRoot },
  };
}

export function stopIsolatedTracker(repoRoot, isolatedDb, inheritedEnv = process.env) {
  const invocation = buildTrackerStopInvocation(repoRoot, isolatedDb, inheritedEnv);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: invocation.env,
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return false;
  try {
    return JSON.parse(result.stdout.trim())?.ok === true;
  } catch {
    return false;
  }
}

function run() {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const confPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const baseConf = JSON.parse(readFileSync(confPath, "utf8"));
  const baseIdentifier = baseConf.identifier;
  const isolation = deriveIsolation(repoRoot, baseIdentifier);
  const { slug, identifier, derivedPort } = isolation;

  function portOwnership(candidate) {
    // check-dev-server.sh: exit 0 = free or owned by this worktree, 1 = other owner.
    const res = spawnSync(
      path.join(repoRoot, "scripts", "check-dev-server.sh"),
      [String(candidate)],
      { cwd: repoRoot, encoding: "utf8" },
    );
    return parsePortOwnershipResult(res);
  }

  let port;
  try {
    port = parseForcedPort(process.env.DRIFTY_ISOLATED_PORT);
  } catch (error) {
    if (error instanceof RangeError) {
      console.error(
        `[tauri-dev-isolated] invalid DRIFTY_ISOLATED_PORT: ${process.env.DRIFTY_ISOLATED_PORT} ` +
          `(${error.message})`,
      );
      process.exit(1);
    }
    throw error;
  }

  if (port !== undefined) {
    const check = portOwnership(port);
    process.stdout.write(check.stdout);
    if (!check.ok || !check.free) {
      console.error(`[tauri-dev-isolated] forced port ${port} is already in use.`);
      process.exit(1);
    }
  } else {
    for (const candidate of portCandidates(derivedPort)) {
      const check = portOwnership(candidate);
      if (check.ok && !check.free) {
        // A server owned by THIS worktree already holds the port: a second
        // instance of the same worktree cannot bind it (strictPort).
        process.stdout.write(check.stdout);
        console.error(
          `[tauri-dev-isolated] this worktree already has a dev server on port ${candidate}. ` +
            `Reuse it, or stop it before starting a new isolated instance.`,
        );
        process.exit(1);
      }
      if (check.free) {
        port = candidate;
        process.stdout.write(check.stdout);
        if (candidate !== derivedPort) {
          console.log(
            `[tauri-dev-isolated] derived port ${derivedPort} busy; using free port ${candidate}`,
          );
        }
        break;
      }
    }
    if (!port) {
      console.error(
        `[tauri-dev-isolated] no free port in ${PORT_RANGE.start}-${PORT_RANGE.end}. ` +
          `Stop an instance or force one with DRIFTY_ISOLATED_PORT=<port>.`,
      );
      process.exit(1);
    }
  }

  // Seed the isolated tracker DB from the normal dev DB so timeline/stats UI
  // has real data. Skip with DRIFTY_ISOLATED_FRESH_DB=1.
  const appSupport = path.join(os.homedir(), "Library", "Application Support");
  const sourceDb = path.join(appSupport, baseIdentifier, "tracker.sqlite3");
  const isolatedDir = path.join(appSupport, identifier);
  const isolatedDb = path.join(isolatedDir, "tracker.sqlite3");
  if (process.env.DRIFTY_ISOLATED_FRESH_DB === "1") {
    removeIsolatedDatabase(isolatedDb);
    console.log(`[tauri-dev-isolated] removed existing isolated tracker DB for a fresh launch`);
  } else if (!existsSync(isolatedDb) && existsSync(sourceDb)) {
    mkdirSync(isolatedDir, { recursive: true });
    const backup = spawnSync("sqlite3", [sourceDb, `.backup "${isolatedDb}"`], {
      encoding: "utf8",
    });
    if (backup.status === 0) {
      console.log(`[tauri-dev-isolated] seeded tracker DB from ${sourceDb}`);
    } else {
      // A plain copy of a live SQLite file can omit WAL data or produce an
      // inconsistent snapshot. Empty isolated data is safer than a partial DB.
      console.warn(`[tauri-dev-isolated] sqlite3 backup unavailable; starting empty`);
    }
  }

  const patch = buildConfigPatch(baseConf, isolation, port);
  const patchDir = path.join(os.tmpdir(), "drifty-isolated-dev");
  mkdirSync(patchDir, { recursive: true });
  const patchPath = path.join(patchDir, `${slug}.json`);
  writeFileSync(patchPath, JSON.stringify(patch, null, 2));

  const childEnv = buildChildEnv();
  console.log(`[tauri-dev-isolated] worktree:   ${repoRoot}`);
  console.log(`[tauri-dev-isolated] port:       ${port} (derived ${derivedPort})`);
  console.log(`[tauri-dev-isolated] identifier: ${identifier}`);
  console.log(`[tauri-dev-isolated] data dir:   ${isolatedDir}`);
  console.log(
    `[tauri-dev-isolated] cargo dir:  ${childEnv.CARGO_TARGET_DIR ?? "<worktree default>"}`,
  );
  console.log(`[tauri-dev-isolated] config:     ${patchPath}`);
  if (process.env.SKIP_ONBOARDING === undefined) {
    console.log(
      `[tauri-dev-isolated] SKIP_ONBOARDING=1 (default for isolated mode; set SKIP_ONBOARDING=0 for onboarding QA)`,
    );
  }
  if (process.env.DRIFTY_ISOLATED_FOCUS !== undefined) {
    console.warn(
      `[tauri-dev-isolated] DRIFTY_ISOLATED_FOCUS is ignored; isolated windows always open unfocused.`,
    );
  }
  console.log(`[tauri-dev-isolated] window opens unfocused; activate it only for attended input.`);
  console.log(
    `[tauri-dev-isolated] note: deep links / OAuth callbacks are not testable in dev instances.`,
  );

  const extraArgs = process.argv.slice(2);
  const child = spawn(
    "sh",
    ["-c", `. "$HOME/.cargo/env" && npx tauri dev --config "$0" "$@"`, patchPath, ...extraArgs],
    { cwd: repoRoot, stdio: "inherit", env: childEnv },
  );
  const cleanupMarker = process.env.DRIFTY_ISOLATED_CLEANUP_MARKER;
  if (cleanupMarker) {
    const resolvedMarker = path.resolve(cleanupMarker);
    const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!resolvedMarker.startsWith(temporaryRoot) || path.basename(resolvedMarker) !== "started") {
      child.kill("SIGTERM");
      throw new Error("invalid DRIFTY_ISOLATED_CLEANUP_MARKER");
    }
    writeFileSync(resolvedMarker, "");
  }
  let forwardedSignal;
  let trackerShutdownConfirmed = false;
  function cleanupTracker() {
    if (trackerShutdownConfirmed) return true;
    trackerShutdownConfirmed = stopIsolatedTracker(repoRoot, isolatedDb, childEnv);
    return trackerShutdownConfirmed;
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      forwardedSignal = signal;
      // npm can tear down the process group before the child exit callback
      // runs, so perform the bounded synchronous cleanup while this handler
      // still owns the signal turn.
      cleanupTracker();
      child.kill(signal);
    });
  }
  child.on("error", (error) => {
    console.error(`[tauri-dev-isolated] failed to start Tauri: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (!cleanupTracker()) {
      console.warn(
        `[tauri-dev-isolated] could not confirm isolated tracker shutdown; check ${isolatedDb}`,
      );
    }
    const signalExitCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
    process.exit(code ?? signalExitCodes[signal ?? forwardedSignal] ?? 1);
  });
}

function cleanupTrackerOnly() {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const confPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const baseConf = JSON.parse(readFileSync(confPath, "utf8"));
  const { identifier } = deriveIsolation(repoRoot, baseConf.identifier);
  const isolatedDb = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    identifier,
    "tracker.sqlite3",
  );
  process.exit(stopIsolatedTracker(repoRoot, isolatedDb) ? 0 : 1);
}

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  if (process.argv.length === 3 && process.argv[2] === "--cleanup-tracker") {
    cleanupTrackerOnly();
  } else {
    run();
  }
}
