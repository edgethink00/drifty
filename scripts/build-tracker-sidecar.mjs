import { accessSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trackerEntry = resolve(repoRoot, "services/tracker-python/app/main.py");
const trackerPythonRoot = resolve(repoRoot, "services/tracker-python");
const binariesDir = resolve(repoRoot, "src-tauri/binaries");
const artifactBaseName = "drifty-tracker";
// Tauri resolves a macOS externalBin as `<name>-<triple><exeSuffix>`, so the
// suffix has to match the host or the build succeeds and then fails at bundle
// time with a missing resource.
const exeSuffix = process.platform === "win32" ? ".exe" : "";

// Windows builds a directory bundle (--onedir), not a single file. A onefile
// executable self-extracts to a fresh temp directory on every launch, and the
// Windows tracker spawns itself repeatedly (request process, daemon, status
// polls), so every spawn paid a full re-extract plus a Defender scan of the
// new files: measured 1.6s for one get_status and 17.7s for start_tracking on
// the test host, against a 3s recovery budget in the app. onedir keeps the
// runtime as stable on-disk files, so a spawn pays only a normal process
// start. macOS keeps --onefile: its single extraction is fast enough there
// and the externalBin flow expects one file.
const useOneDir = process.platform === "win32";

// PyInstaller follows imports, and `tzdata` is a data-only package that
// nothing imports by name - `zoneinfo` discovers it at runtime. Without an
// explicit collection the frozen Windows sidecar would ship with an empty
// TZPATH and fail every zone lookup, exactly as an unpackaged interpreter does.
function extraPyInstallerArgs() {
  if (process.platform !== "win32") {
    return [];
  }
  return ["--collect-data", "tzdata", "--hidden-import", "tzdata"];
}

function fail(message, exitCode = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(exitCode);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: options.env ?? process.env,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function parseArgs(argv) {
  const parsed = { target: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        fail("--target requires a value", 2);
      }
      parsed.target = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--target=")) {
      const value = arg.slice("--target=".length);
      if (!value) {
        fail("--target requires a value", 2);
      }
      parsed.target = value;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run build:tracker-sidecar -- [--target <target-triple>]");
      process.exit(0);
    }
    fail(`unknown argument: ${arg}`, 2);
  }
  return parsed;
}

function assertSafeTarget(target) {
  if (!/^[A-Za-z0-9_]+-[A-Za-z0-9_]+-[A-Za-z0-9_.-]+$/u.test(target)) {
    fail(`invalid target triple: ${target}`, 2);
  }
}

function detectHostTriple() {
  const hostTuple = run("rustc", ["--print", "host-tuple"], { capture: true });
  if (hostTuple.status === 0 && hostTuple.stdout.trim()) {
    return hostTuple.stdout.trim();
  }

  const version = run("rustc", ["-vV"], { capture: true });
  if (version.status === 0) {
    const hostLine = version.stdout.split("\n").find((line) => line.startsWith("host:"));
    const host = hostLine?.replace(/^host:\s*/u, "").trim();
    if (host) {
      return host;
    }
  }

  fail("could not detect target triple with rustc --print host-tuple or rustc -vV");
}

function defaultPython() {
  if (process.env.DRIFTY_TRACKER_BUILD_PYTHON) {
    return process.env.DRIFTY_TRACKER_BUILD_PYTHON;
  }
  if (process.platform === "win32") {
    // `python3` on Windows is usually the WindowsApps execution-alias stub,
    // which is not an interpreter: it exits 9009 and offers to open the
    // Store. The `py` launcher is the documented way to find a real one.
    // Mirrors resolve_python_bin() in src-tauri/src/tracker.rs.
    for (const candidate of ["py", "python"]) {
      const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      if (!probe.error && probe.status === 0) {
        return candidate;
      }
    }
    return "python";
  }
  if (process.platform === "darwin") {
    try {
      accessSync("/usr/bin/python3", constants.X_OK);
      return "/usr/bin/python3";
    } catch {
      return "python3";
    }
  }
  return "python3";
}

function assertPyInstaller(pythonBin) {
  const result = run(pythonBin, ["-m", "PyInstaller", "--version"], { capture: true });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const hint = `Install build requirements with: ${pythonBin} -m pip install -r services/tracker-python/requirements-build.txt`;
    fail(`PyInstaller is unavailable for ${pythonBin}.${stderr ? ` ${stderr}` : ""}\n${hint}`);
  }
  return result.stdout.trim();
}

async function assertExecutable(path) {
  const stats = statSync(path);
  if (!stats.isFile()) {
    fail(`sidecar output is not a file: ${path}`);
  }
  // Windows has no execute permission bit; X_OK degrades to a read check and
  // reports success for any readable file, so the check is not meaningful there.
  if (process.platform === "win32") {
    return;
  }
  await access(path, constants.X_OK).catch(() => {
    fail(`sidecar output is not executable: ${path}`);
  });
}

function assertSmokeTest(path) {
  // A frozen PyInstaller build can succeed while the interpreter that built it
  // (e.g. Xcode's bundled Python 3.9) rejects a 3.10+-only construct at import
  // time, so the binary crashes on first run. Catch that here, before packaging.
  // Uses a throwaway --db so this never touches a real tracker database.
  const smokeRoot = mkdtempSync(resolve(tmpdir(), "drifty-tracker-sidecar-smoke-"));
  try {
    const smokeDb = resolve(smokeRoot, "smoke.sqlite3");
    const result = run(
      path,
      ["--db", smokeDb, "--request-json", '{"command":"get_status","payload":{}}'],
      { capture: true },
    );
    if (result.status !== 0) {
      fail(`sidecar smoke test failed (exit ${result.status}): ${path}\n${result.stderr.trim()}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      fail(`sidecar smoke test produced non-JSON output: ${path}\n${result.stdout}`);
    }
    if (parsed?.ok !== true) {
      fail(`sidecar smoke test returned ok=false: ${path}\n${result.stdout}`);
    }
  } finally {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}

async function main() {
  const startedAt = Date.now();
  const { target: explicitTarget } = parseArgs(process.argv.slice(2));
  const target = explicitTarget ?? detectHostTriple();
  assertSafeTarget(target);

  const pythonBin = defaultPython();
  const pyInstallerVersion = assertPyInstaller(pythonBin);
  const outputPath = resolve(binariesDir, `${artifactBaseName}-${target}${useOneDir ? "" : exeSuffix}`);
  const outputExecutable = useOneDir
    ? resolve(outputPath, `${artifactBaseName}${exeSuffix}`)
    : outputPath;
  const tempRoot = mkdtempSync(resolve(tmpdir(), "drifty-tracker-sidecar-"));
  const distPath = resolve(tempRoot, "dist");
  const buildPath = resolve(tempRoot, "build");
  const specPath = resolve(tempRoot, "spec");
  const builtBinary = useOneDir
    ? resolve(distPath, artifactBaseName, `${artifactBaseName}${exeSuffix}`)
    : resolve(distPath, `${artifactBaseName}${exeSuffix}`);

  console.log(`target=${target}`);
  console.log(`python=${pythonBin}`);
  console.log(`pyinstaller=${pyInstallerVersion}`);
  console.log(`entry=${trackerEntry}`);
  console.log(`output=${outputPath}`);
  console.log(`temp=${tempRoot}`);

  try {
    mkdirSync(binariesDir, { recursive: true });
    rmSync(outputPath, { recursive: true, force: true });

    const env = {
      ...process.env,
      PYTHONPATH: trackerPythonRoot,
    };

    const result = run(
      pythonBin,
      [
        "-m",
        "PyInstaller",
        useOneDir ? "--onedir" : "--onefile",
        "--clean",
        "--noconfirm",
        "--name",
        artifactBaseName,
        "--paths",
        trackerPythonRoot,
        "--distpath",
        distPath,
        "--workpath",
        buildPath,
        "--specpath",
        specPath,
        ...extraPyInstallerArgs(),
        trackerEntry,
      ],
      { env },
    );
    if (result.status !== 0) {
      fail(`PyInstaller build failed with exit status ${result.status}`);
    }

    if (!existsSync(builtBinary) || !statSync(builtBinary).isFile()) {
      fail(`PyInstaller did not produce expected binary: ${builtBinary}`);
    }
    if (useOneDir) {
      // The exe is useless without its `_internal` runtime, so ship the whole
      // directory PyInstaller produced.
      cpSync(dirname(builtBinary), outputPath, { recursive: true });
    } else {
      copyFileSync(builtBinary, outputPath);
      chmodSync(outputPath, 0o755);
    }
    await assertExecutable(outputExecutable);
    assertSmokeTest(outputExecutable);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`elapsed_ms=${Date.now() - startedAt}`);
  console.log(`created=${outputPath}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
