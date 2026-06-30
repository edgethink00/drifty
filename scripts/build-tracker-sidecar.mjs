import { accessSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
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
  await access(path, constants.X_OK).catch(() => {
    fail(`sidecar output is not executable: ${path}`);
  });
}

async function main() {
  const startedAt = Date.now();
  const { target: explicitTarget } = parseArgs(process.argv.slice(2));
  const target = explicitTarget ?? detectHostTriple();
  assertSafeTarget(target);

  const pythonBin = defaultPython();
  const pyInstallerVersion = assertPyInstaller(pythonBin);
  const outputPath = resolve(binariesDir, `${artifactBaseName}-${target}`);
  const tempRoot = mkdtempSync(resolve(tmpdir(), "drifty-tracker-sidecar-"));
  const distPath = resolve(tempRoot, "dist");
  const buildPath = resolve(tempRoot, "build");
  const specPath = resolve(tempRoot, "spec");
  const builtBinary = resolve(distPath, artifactBaseName);

  console.log(`target=${target}`);
  console.log(`python=${pythonBin}`);
  console.log(`pyinstaller=${pyInstallerVersion}`);
  console.log(`entry=${trackerEntry}`);
  console.log(`output=${outputPath}`);
  console.log(`temp=${tempRoot}`);

  try {
    mkdirSync(binariesDir, { recursive: true });
    rmSync(outputPath, { force: true });

    const env = {
      ...process.env,
      PYTHONPATH: trackerPythonRoot,
    };

    const result = run(
      pythonBin,
      [
        "-m",
        "PyInstaller",
        "--onefile",
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
    copyFileSync(builtBinary, outputPath);
    chmodSync(outputPath, 0o755);
    await assertExecutable(outputPath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`elapsed_ms=${Date.now() - startedAt}`);
  console.log(`created=${outputPath}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
