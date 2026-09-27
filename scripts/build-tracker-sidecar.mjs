import { accessSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trackerEntry = resolve(repoRoot, "services/tracker-python/app/main.py");
const trackerPythonRoot = resolve(repoRoot, "services/tracker-python");
const binariesDir = resolve(repoRoot, "src-tauri/binaries");
const artifactBaseName = "drifty-tracker";
const chatgptHelperBaseName = "chatgpt-session-ax";
const chatgptHelperSource = resolve(trackerPythonRoot, "app/tracker/chatgpt_session_ax.swift");
const remoteExporterSourceDirectory = resolve(trackerPythonRoot, "app/tracker/dev_signals");
const remoteExporterDataDestination = "app/tracker/dev_signals/remote_exporter_support";
const remoteExporterSources = ["git_commits.py", "agent_sessions.py", "adapters.py"];
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
const WINDOWS_RELEASE_PYTHON = Object.freeze({ major: 3, minor: 14, patch: 0 });
const WINDOWS_RELEASE_PACKAGES = Object.freeze({
  "altgraph": "0.17.5",
  "certifi": "2026.7.22",
  "packaging": "26.3",
  "pefile": "2024.8.26",
  "pip": "25.2",
  "pyinstaller": "6.22.1",
  "pyinstaller-hooks-contrib": "2026.6",
  "pywin32-ctypes": "0.2.3",
  "sentry-sdk": "2.68.0",
  "setuptools": "84.0.0",
  "tzdata": "2026.3",
  "urllib3": "2.7.0",
});
const WINDOWS_RELEASE_PTH_FILES = Object.freeze({
  "distutils-precedence.pth": "2638ce9e2500e572a5e0de7faed6661eb569d1b696fcba07b0dd223da5f5d224",
});

// PyInstaller follows imports, and `tzdata` is a data-only package that
// nothing imports by name - `zoneinfo` discovers it at runtime. Without an
// explicit collection the frozen Windows sidecar would ship with an empty
// TZPATH and fail every zone lookup, exactly as an unpackaged interpreter does.
export function extraPyInstallerArgs(platform = process.platform) {
  // setuptools ships in the build venv, so PyInstaller would bundle
  // pkg_resources and add a runtime hook that imports it on every launch. Only
  // sentry_sdk's pre-3.8 fallback references it, and that path never runs here;
  // on the macOS onefile sidecar the hook alone added about 0.7 s per launch.
  const shared = ["--exclude-module", "pkg_resources"];
  return platform === "win32"
    ? ["--collect-data", "tzdata", "--hidden-import", "tzdata", ...shared]
    : shared;
}

// Release sidecars must bundle the Sentry SDK pinned in requirements-build.txt.
// A build Python without it still produces a working tracker, but one whose
// errors never reach Sentry; the Mac release shipped that way through 1.11.21.
export function pinnedSentrySdkVersion(
  requirements = readFileSync(resolve(trackerPythonRoot, "requirements-build.txt"), "utf8"),
) {
  const match = requirements.match(/^sentry-sdk==([0-9][0-9A-Za-z.]*)\s*$/mu);
  if (!match) throw new Error("services/tracker-python/requirements-build.txt must pin sentry-sdk.");
  return match[1];
}

// Returns null when the frozen sidecar's sentry-sdk-check output proves the
// pinned SDK is bundled, otherwise the reason it does not.
export function bundledSentrySdkProblem(status, stdout, expectedVersion) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout).trim());
  } catch {
    return `sentry-sdk-check produced non-JSON output (exit ${status})`;
  }
  const version = parsed?.data?.sentrySdkVersion ?? null;
  if (status !== 0 || parsed?.ok !== true) return parsed?.error ?? `sentry-sdk-check failed (exit ${status})`;
  if (version !== expectedVersion) return `bundled sentry-sdk ${version} does not match the pinned ${expectedVersion}`;
  if (parsed?.data?.initialized !== true) return "the bundled Sentry SDK did not initialize";
  return null;
}

function remoteExporterPyInstallerArgs() {
  return remoteExporterSources.flatMap((filename) => [
    "--add-data",
    `${resolve(remoteExporterSourceDirectory, filename)}${delimiter}${remoteExporterDataDestination}`,
  ]);
}

export function chatgptHelperSwiftTarget(target) {
  const [rustArchitecture, vendor, operatingSystem] = target.split("-");
  if (vendor !== "apple" || operatingSystem !== "darwin") {
    throw new Error(`native ChatGPT helper requires an Apple Darwin target, received ${target}`);
  }
  const swiftArchitecture = rustArchitecture === "aarch64"
    ? "arm64"
    : rustArchitecture === "x86_64"
      ? "x86_64"
      : undefined;
  if (!swiftArchitecture) {
    throw new Error(`unsupported native ChatGPT helper architecture: ${rustArchitecture}`);
  }
  return `${swiftArchitecture}-apple-macos13.0`;
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
    timeout: options.timeoutMs,
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

function assertWindowsReleaseToolchain(pythonBin) {
  if (process.platform !== "win32" || process.env.DRIFTY_RELEASE_BUILD !== "1") return;
  if (!process.env.DRIFTY_TRACKER_BUILD_PYTHON || !isAbsolute(pythonBin)) {
    fail("Windows release builds require an explicit absolute DRIFTY_TRACKER_BUILD_PYTHON venv interpreter.");
  }
  const inspectScript = [
    "import hashlib",
    "import importlib.metadata as metadata",
    "import json",
    "from pathlib import Path",
    "import site",
    "import sys",
    "normalize = lambda value: value.lower().replace('_', '-').replace('.', '-')",
    "packages = {normalize(dist.metadata['Name']): dist.version for dist in metadata.distributions()}",
    "site_roots = [Path(value) for value in site.getsitepackages() if Path(value).name.lower() == 'site-packages']",
    "pth_files = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for root in site_roots for path in root.glob('*.pth')}",
    "print(json.dumps({'python': [sys.version_info.major, sys.version_info.minor, sys.version_info.micro], 'inVenv': sys.prefix != sys.base_prefix, 'packages': packages, 'pthFiles': pth_files}, sort_keys=True))",
  ].join("; ");
  const inspection = run(pythonBin, ["-c", inspectScript], { capture: true });
  if (inspection.status !== 0) {
    fail(`Windows release Python environment is incomplete: ${inspection.stderr.trim()}`);
  }
  let observed;
  try {
    observed = JSON.parse(inspection.stdout.trim());
  } catch {
    fail(`Windows release Python environment returned invalid inventory: ${inspection.stdout}`);
  }
  if (!observed.inVenv) {
    fail("Windows release builds require an isolated Python virtual environment.");
  }
  if (observed.python?.[0] !== WINDOWS_RELEASE_PYTHON.major
    || observed.python?.[1] !== WINDOWS_RELEASE_PYTHON.minor
    || observed.python?.[2] !== WINDOWS_RELEASE_PYTHON.patch) {
    fail(`Windows release builds require Python ${WINDOWS_RELEASE_PYTHON.major}.${WINDOWS_RELEASE_PYTHON.minor}.${WINDOWS_RELEASE_PYTHON.patch}.`);
  }
  if (JSON.stringify(observed.packages) !== JSON.stringify(WINDOWS_RELEASE_PACKAGES)) {
    fail("Windows release Python distribution inventory does not match the complete approved lock.");
  }
  if (JSON.stringify(observed.pthFiles) !== JSON.stringify(WINDOWS_RELEASE_PTH_FILES)) {
    fail("Windows release Python startup .pth inventory does not match the approved lock.");
  }
  const dependencyCheck = run(pythonBin, ["-m", "pip", "check"], { capture: true });
  if (dependencyCheck.status !== 0) {
    fail(`Windows release Python dependency check failed: ${dependencyCheck.stdout.trim()} ${dependencyCheck.stderr.trim()}`);
  }
}

function assertReleasePythonHasSentrySdk(pythonBin) {
  if (process.env.DRIFTY_RELEASE_BUILD !== "1") return;
  const expected = pinnedSentrySdkVersion();
  // -W ignore keeps the macOS system Python's urllib3/LibreSSL import warning out of the build log.
  const probe = run(pythonBin, ["-W", "ignore", "-c", "from sentry_sdk.consts import VERSION; print(VERSION)"], { capture: true });
  if (probe.status !== 0 || probe.stdout.trim() !== expected) {
    fail(
      `Release tracker builds require sentry-sdk==${expected} in ${pythonBin}.`
        + ` Install build requirements with: ${pythonBin} -m pip install -r services/tracker-python/requirements-build.txt`,
    );
  }
}

function assertBundledSentrySdk(executable) {
  if (process.env.DRIFTY_RELEASE_BUILD !== "1") return;
  const expected = pinnedSentrySdkVersion();
  const checkRoot = mkdtempSync(resolve(tmpdir(), "drifty-tracker-sidecar-sentry-"));
  try {
    const result = run(executable, ["--db", resolve(checkRoot, "check.sqlite3"), "sentry-sdk-check"], { capture: true });
    const problem = bundledSentrySdkProblem(result.status, result.stdout, expected);
    if (problem) fail(`Release tracker sidecar cannot report errors to Sentry: ${problem}`);
    console.log(`sentry_sdk=${expected}`);
  } finally {
    rmSync(checkRoot, { recursive: true, force: true });
  }
}

function signWindowsReleaseArtifact(artifactPath) {
  if (process.platform !== "win32" || process.env.DRIFTY_WINDOWS_SIGN_RELEASE !== "1") return;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) fail("SystemRoot is required to resolve trusted Windows PowerShell for signing.");
  const powershell = resolve(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (!existsSync(powershell)) fail(`Trusted Windows PowerShell is unavailable: ${powershell}`);
  const signingScript = resolve(repoRoot, "scripts", "sign-windows-artifact.ps1");
  const result = run(
    powershell,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", signingScript, "-Path", artifactPath],
    { capture: true },
  );
  if (result.status !== 0) {
    fail(`Windows sidecar signing failed: ${result.stdout.trim()} ${result.stderr.trim()}`);
  }
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

function buildChatgptHelper(target, outputPath) {
  const swiftTarget = chatgptHelperSwiftTarget(target);
  const result = run(
    "xcrun",
    [
      "swiftc",
      "-O",
      "-target",
      swiftTarget,
      "-framework",
      "ApplicationServices",
      "-o",
      outputPath,
      chatgptHelperSource,
    ],
    { capture: true },
  );
  if (result.status !== 0) {
    fail(`native ChatGPT helper build failed with exit status ${result.status}: ${result.stderr.trim()}`);
  }
}

function assertMacosBinaryArchitecture(path, target) {
  const expected = chatgptHelperSwiftTarget(target).split("-", 1)[0];
  const result = run("lipo", ["-archs", path], { capture: true });
  if (result.status !== 0) {
    fail(`could not inspect native ChatGPT helper architecture: ${result.stderr.trim()}`);
  }
  const observed = result.stdout.trim().split(/\s+/u);
  if (!observed.includes(expected)) {
    fail(`native ChatGPT helper architecture mismatch: expected ${expected}, found ${observed.join(", ")}`);
  }
}

function assertMacosNativeHelperSmokeTest(path, target) {
  // A cross-compiled Mach-O cannot be executed reliably on the build host.
  // Architecture and package-presence checks still run for that path.
  if (target !== detectHostTriple()) return;
  // This is a bounded CLI/serialization contract check. Outside a GUI
  // security session CoreGraphics may legitimately return an empty array.
  let result;
  try {
    result = run(path, ["--onscreen-windows"], { capture: true, timeoutMs: 5_000 });
  } catch (error) {
    fail(`native helper smoke test could not run: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.status !== 0) {
    fail(`native helper smoke test failed with exit status ${result.status}: ${result.stderr.trim()}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    fail(`native helper smoke test produced non-JSON output: ${result.stdout}`);
  }
  const validRow = (row) => row !== null
    && typeof row === "object"
    && !Array.isArray(row)
    && (typeof row.owner_name === "string" || row.owner_name === null)
    && (Number.isInteger(row.layer) || row.layer === null)
    && (typeof row.name === "string" || row.name === null);
  if (!Array.isArray(parsed) || !parsed.every(validRow)) {
    fail(`native helper smoke test did not return a window array: ${result.stdout}`);
  }
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
  assertWindowsReleaseToolchain(pythonBin);
  assertReleasePythonHasSentrySdk(pythonBin);
  const pyInstallerVersion = assertPyInstaller(pythonBin);
  const outputPath = resolve(binariesDir, `${artifactBaseName}-${target}${useOneDir ? "" : exeSuffix}`);
  const outputExecutable = useOneDir
    ? resolve(outputPath, `${artifactBaseName}${exeSuffix}`)
    : outputPath;
  const chatgptHelperOutput = process.platform === "darwin"
    ? resolve(binariesDir, `${chatgptHelperBaseName}-${target}`)
    : undefined;
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
    if (chatgptHelperOutput) {
      rmSync(chatgptHelperOutput, { force: true });
      buildChatgptHelper(target, chatgptHelperOutput);
      chmodSync(chatgptHelperOutput, 0o755);
      await assertExecutable(chatgptHelperOutput);
      assertMacosBinaryArchitecture(chatgptHelperOutput, target);
      assertMacosNativeHelperSmokeTest(chatgptHelperOutput, target);
    }

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
        ...remoteExporterPyInstallerArgs(),
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
    signWindowsReleaseArtifact(outputExecutable);
    if (process.env.DRIFTY_WINDOWS_SIGN_RELEASE === "1") assertSmokeTest(outputExecutable);
    assertBundledSentrySdk(outputExecutable);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`elapsed_ms=${Date.now() - startedAt}`);
  console.log(`created=${outputPath}`);
  if (chatgptHelperOutput) console.log(`created=${chatgptHelperOutput}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
