#!/usr/bin/env node
/**
 * Release build of the Mac app's resource helpers.
 *
 * Builds the capture helper (Swift, ScreenCaptureKit, macOS 14 or later) and the
 * native activity helper for optional screen recording, and the permission
 * guide (the vendored PermissionFlow panel beside System Settings, macOS 13 or
 * later), into one generated, gitignored folder, then writes the Tauri config
 * that bundles them as app resources. The release script passes that config to
 * the production build and signs the helpers with the app's Developer ID.
 * Development builds do not bundle them, so the optional Screen recording row
 * stays hidden there and permission requests open System Settings without the
 * guide.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT_RELATIVE = "src-tauri/binaries/screen-context-release";
export const CONFIG_NAME = "tauri.screen-context.json";
export const CAPTURE_DESTINATION = "screen-context/helper";
export const ACTIVITY_DESTINATION = "screen-activity/drifty-screen-activity";
export const PERMISSION_GUIDE_DESTINATION = "permission-guide/drifty-permission-guide";
// PermissionFlow finds its translations in this bundle beside the helper.
export const PERMISSION_GUIDE_STRINGS_DESTINATION = "permission-guide/PermissionFlow_PermissionFlow.bundle";
const PERMISSION_GUIDE_PACKAGE = "src-tauri/native/permission-guide";

/** The Tauri config merged into the production build; paths are absolute. */
export function bundleConfig(output) {
  return { bundle: { resources: {
    [resolve(output, "screen-context/helper")]: CAPTURE_DESTINATION,
    [resolve(output, "activity/drifty-screen-activity/drifty-screen-activity")]: ACTIVITY_DESTINATION,
    [resolve(output, PERMISSION_GUIDE_DESTINATION)]: PERMISSION_GUIDE_DESTINATION,
    [resolve(output, PERMISSION_GUIDE_STRINGS_DESTINATION)]: PERMISSION_GUIDE_STRINGS_DESTINATION,
  } } };
}

export function swiftTarget(arch) {
  const cpu = { arm64: "arm64", x64: "x86_64" }[arch];
  if (!cpu) throw Error("Unsupported Mac architecture: " + arch);
  return cpu + "-apple-macos14.0";
}

/** SwiftPM architecture name for the permission guide; its package targets macOS 13. */
export function swiftPackageArch(arch) {
  const cpu = { arm64: "arm64", x64: "x86_64" }[arch];
  if (!cpu) throw Error("Unsupported Mac architecture: " + arch);
  return cpu;
}

export function permissionGuideBuildArgs(output, arch) {
  return ["swift", "build", "-c", "release",
    "--package-path", resolve(root, PERMISSION_GUIDE_PACKAGE),
    "--scratch-path", resolve(output, "permission-guide-build"),
    "--arch", swiftPackageArch(arch)];
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(command + " failed with status " + result.status);
}

function buildPermissionGuide(output) {
  const args = permissionGuideBuildArgs(output, process.arch);
  run("xcrun", args);
  const located = spawnSync("xcrun", [...args, "--show-bin-path"], { cwd: root, encoding: "utf8" });
  if (located.status !== 0) throw Error("Could not locate the permission guide build: " + located.stderr);
  const products = located.stdout.trim().split("\n").pop();
  const helper = resolve(output, PERMISSION_GUIDE_DESTINATION);
  mkdirSync(dirname(helper), { recursive: true, mode: 0o700 });
  copyFileSync(resolve(products, "drifty-permission-guide"), helper);
  chmodSync(helper, 0o755);
  cpSync(resolve(products, "PermissionFlow_PermissionFlow.bundle"), resolve(output, PERMISSION_GUIDE_STRINGS_DESTINATION), { recursive: true });
}

function main() {
  if (process.platform !== "darwin") throw Error("The Mac release helpers are built on macOS. Windows packaging is not wired yet.");
  const output = resolve(root, OUTPUT_RELATIVE);
  // A generated folder: rebuild it fully so a release never bundles stale helpers.
  if (existsSync(output)) rmSync(output, { recursive: true, force: true });
  mkdirSync(resolve(output, "screen-context"), { recursive: true, mode: 0o700 });
  const helper = resolve(output, "screen-context/helper");
  run("xcrun", ["swiftc", "-parse-as-library", "-O", "-target", swiftTarget(process.arch),
    resolve(root, "src-tauri/native/screen-context/macos.swift"), "-o", helper]);
  run(process.execPath, [resolve(root, "scripts/build-screen-activity-helper.mjs"), resolve(output, "activity")]);
  buildPermissionGuide(output);
  const config = resolve(output, CONFIG_NAME);
  const value = bundleConfig(output);
  for (const source of Object.keys(value.bundle.resources)) {
    if (!existsSync(source)) throw Error("Missing built helper: " + source);
  }
  writeFileSync(config, JSON.stringify(value, null, 2) + "\n");
  console.log(JSON.stringify({ config, resources: value.bundle.resources }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

