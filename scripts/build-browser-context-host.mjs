/** Explicit macOS pilot package. Does not install/register or modify the app sidecar. */
import { existsSync, mkdirSync, mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chatgptHelperSwiftTarget } from "./build-tracker-sidecar.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostName = "drifty-browser-context-host";

export function prepareHostDestination(destination) {
  if (!destination) throw Error("Provide a NEW task-owned output directory");
  const path = resolve(destination);
  if (existsSync(path)) throw Error("Refusing existing output directory: " + path);
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(path, { mode: 0o700 });
  return path;
}

export function hostPyInstallerArguments({ trackerRoot, entry, buildRoot }) {
  return ["-m", "PyInstaller", "--onedir", "--clean", "--noconfirm", "--name", hostName,
    "--paths", trackerRoot, "--exclude-module", "pkg_resources",
    "--distpath", resolve(buildRoot, "dist"), "--workpath", resolve(buildRoot, "build"),
    "--specpath", resolve(buildRoot, "spec"), entry];
}

export function copyHostRuntime(source, destination) {
  // Python.framework links must stay relative after the build temp is removed.
  cpSync(source, destination, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(command + " failed: " + (result.stderr || result.status));
  return result.stdout?.trim();
}

function main() {
  if (process.platform !== "darwin") throw Error("Browser context pilot host requires macOS");
  if (process.argv.length !== 3) throw Error("Usage: node scripts/build-browser-context-host.mjs <new-output-directory>");
  const triple = process.arch === "arm64" ? "aarch64-apple-darwin" : process.arch === "x64" ? "x86_64-apple-darwin" : null;
  if (!triple) throw Error("Unsupported macOS architecture");
  const python = process.env.DRIFTY_TRACKER_BUILD_PYTHON || "/usr/bin/python3";
  const pyinstaller = run(python, ["-m", "PyInstaller", "--version"], true);
  const destination = prepareHostDestination(process.argv[2]);
  const buildRoot = mkdtempSync(resolve(tmpdir(), "drifty-browser-context-build-"));
  const directory = resolve(destination, hostName), executable = resolve(directory, hostName);
  const helper = resolve(directory, "chatgpt-session-ax");
  try {
    const trackerRoot = resolve(root, "services/tracker-python");
    run(python, hostPyInstallerArguments({ trackerRoot, entry: resolve(trackerRoot, "app/browser_context_main.py"), buildRoot }));
    // Copy the complete stable runtime. Moving only the executable breaks onedir.
    copyHostRuntime(resolve(buildRoot, "dist", hostName), directory);
    run("xcrun", ["swiftc", "-O", "-target", chatgptHelperSwiftTarget(triple), resolve(trackerRoot, "app/tracker/chatgpt_session_ax.swift"), "-o", helper]);
    for (const path of [executable, helper]) {
      const architectures = run("lipo", ["-archs", path], true).split(/\s+/u);
      if (!architectures.includes(process.arch === "arm64" ? "arm64" : "x86_64")) throw Error("Package architecture mismatch");
    }
  } finally {
    rmSync(buildRoot, { recursive: true, force: true });
  }
  // Run only after removing the original runtime, proving the copy is portable.
  const denied = spawnSync(executable, ["invalid-origin"], { encoding: "utf8", timeout: 15000 });
  if (denied.error || denied.status !== 1 || denied.stdout !== "" || denied.stderr !== "") throw Error("Native host rejection smoke failed");
  const manifest = { kind: "macos_browser_context_pilot", layout: "onedir", pyinstaller, sourceSha: run("git", ["rev-parse", "HEAD"], true), sourceDirty: !!run("git", ["status", "--porcelain"], true),
    executable: hostName + "/" + hostName, helper: hostName + "/chatgpt-session-ax", developerIDSigned: false,
    executableSha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), helperSha256: createHash("sha256").update(readFileSync(helper)).digest("hex") };
  writeFileSync(resolve(destination, "pilot-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ destination, executable, layout: "onedir", developerIDSigned: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
