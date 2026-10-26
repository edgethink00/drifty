/** Explicit private helper build. Never installs, registers or signs an app. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = "drifty-screen-activity";
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("Helper build step failed: " + (result.stderr || result.status));
  return result.stdout?.trim() || "";
}

function main() {
  if (!["darwin", "win32"].includes(process.platform)) throw Error("Mac or Windows required");
  if (process.argv.length !== 3) throw Error("Provide a NEW task-owned output directory");
  const output = resolve(process.argv[2]);
  if (existsSync(output)) throw Error("Refusing existing output directory");
  // Mac's optional reader must meet the existing two-second first-launch
  // budget without booting a Python runtime. Windows retains its pinned onedir
  // implementation and its own timestamp behavior.
  let version = null;
  let python;
  if (process.platform === "win32") {
    python = process.env.DRIFTY_TRACKER_BUILD_PYTHON || "python";
    version = run(python, ["-I", "-m", "PyInstaller", "--version"]);
    const requirements = readFileSync(resolve(root, "services/tracker-python/requirements-build.txt"), "utf8");
    const pins = requirements.split(/\r?\n/u).filter(line => line.startsWith("pyinstaller==") && line.includes('sys_platform != "darwin"'));
    if (pins.length !== 1 || version !== pins[0].split(";")[0].slice("pyinstaller==".length)) throw Error("Pinned PyInstaller required");
  }
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const build = mkdtempSync(resolve(tmpdir(), "drifty-screen-activity-build-"));
  const tracker = resolve(root, "services/tracker-python");
  const entry = resolve(tracker, "app/screen_activity_main.py");
  const directory = resolve(output, name);
  try {
    if (process.platform === "darwin") {
      const target = { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" }[process.arch];
      if (!target) throw Error("Unsupported Mac architecture");
      const targetDirectory = resolve(build, "target");
      run("cargo", ["build", "--locked", "--release", "--manifest-path", resolve(root, "src-tauri/Cargo.toml"),
        "--package", "drifty-screen-activity-helper", "--bin", name, "--target", target,
        "--target-dir", targetDirectory], { stdio: "inherit" });
      mkdirSync(directory, { mode: 0o700 });
      cpSync(resolve(targetDirectory, target, "release", name), resolve(directory, name), { force: false, errorOnExist: true });
    } else {
      run(python, ["-I", "-m", "PyInstaller", "--onedir", "--clean", "--noconfirm", "--name", name,
        "--paths", tracker, "--exclude-module", "pkg_resources", "--distpath", resolve(build, "dist"),
        "--workpath", resolve(build, "build"), "--specpath", resolve(build, "spec"), entry], { stdio: "inherit" });
      cpSync(resolve(build, "dist", name), directory, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
    }
  } finally {
    rmSync(build, { recursive: true, force: true });
  }
  const executable = resolve(directory, name + (process.platform === "win32" ? ".exe" : ""));
  const smokeStarted = performance.now();
  const denied = spawnSync(executable, ["serve"], { encoding: "utf8", timeout: 2000 });
  const smokePassed = !denied.error && denied.status === 2 && denied.stdout === "" && denied.stderr === "";
  // Preserve a first-launch failure before throwing. Status/elapsed/byte counts
  // diagnose cold/runtime failures without echoing child diagnostics or paths.
  writeFileSync(resolve(output, "helper-smoke.json"), JSON.stringify({
    passed: smokePassed, timeoutMillis: 2000, elapsedMillis: performance.now() - smokeStarted,
    status: denied.status, signal: denied.signal, errorCode: denied.error?.code || null,
    stdoutBytes: Buffer.byteLength(denied.stdout || ""), stderrBytes: Buffer.byteLength(denied.stderr || ""),
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (!smokePassed) throw Error("Relocated helper rejection failed; inspect helper-smoke.json");
  const manifest = { kind: "private_screen_activity_helper", layout: "onedir", platform: process.platform,
    implementation: process.platform === "darwin" ? "native_rust" : "pinned_python_onedir",
    pyinstaller: version, sourceHead: run("git", ["rev-parse", "HEAD"]), sourceDirty: !!run("git", ["status", "--porcelain"]),
    executable: executable.slice(output.length + 1), executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"),
    developerIDSigned: false, registeredOrInstalled: false };
  writeFileSync(resolve(output, "helper-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ output, ...manifest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
