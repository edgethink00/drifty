#!/usr/bin/env node
/**
 * Release build of the Mac app's resource helpers.
 *
 * Builds the capture helper (Swift, ScreenCaptureKit, macOS 14 or later) and the
 * native activity helper for optional screen recording, and the permission
 * guide (the vendored PermissionFlow panel beside System Settings, macOS 13 or
 * later), into one generated, gitignored folder, then writes the Tauri config
 * that bundles them as app resources. DRIFTY_SCREEN_CONTEXT_MODE=excluded builds
 * only the permission guide and its translations in a separate fresh folder. The release script passes that config to
 * the production build and signs the helpers with the app's Developer ID.
 * Development builds do not bundle them, so the optional Screen recording row
 * stays hidden there and permission requests open System Settings without the
 * guide.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, lstatSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
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

/** One build-owned selector for native, renderer and package inventory. */
export function screenContextMode(value) {
  if (value === undefined) return "included";
  if (value !== "included" && value !== "excluded") {
    throw Error("DRIFTY_SCREEN_CONTEXT_MODE must be included or excluded (unset defaults to included).");
  }
  return value;
}

export function screenContextBuildEnvironment(environment) {
  const mode = screenContextMode(environment.DRIFTY_SCREEN_CONTEXT_MODE);
  return { ...environment, DRIFTY_SCREEN_CONTEXT_MODE: mode };
}

// Keep historical included fingerprints valid; excluded assets can never reuse them.
export function screenContextFrontendExpectation(expected, environment) {
  const mode = screenContextBuildEnvironment(environment).DRIFTY_SCREEN_CONTEXT_MODE;
  return mode === "included" ? expected : { ...expected,
    environmentFingerprint: createHash("sha256").update(`${expected.environmentFingerprint}:screen-context:${mode}`).digest("hex") };
}

export function assertScreenContextFrontendProof(manifest, environment) {
  const mode = screenContextBuildEnvironment(environment).DRIFTY_SCREEN_CONTEXT_MODE;
  if ((manifest.screenContextMode ?? "included") !== mode) throw Error("Prepared frontend screen context mode mismatch.");
}

export function releaseOutputRelative(mode = screenContextMode(process.env.DRIFTY_SCREEN_CONTEXT_MODE)) {
  return screenContextMode(mode) === "excluded" ? "src-tauri/target/screen-context-release-excluded" : OUTPUT_RELATIVE;
}

/** The Tauri config merged into the production build; paths are absolute. */
export function bundleConfig(output, mode = screenContextMode(process.env.DRIFTY_SCREEN_CONTEXT_MODE)) {
  mode = screenContextMode(mode);
  return { bundle: { resources: {
    ...(mode === "included" ? {
      [resolve(output, "screen-context/helper")]: CAPTURE_DESTINATION,
      [resolve(output, "activity/drifty-screen-activity/drifty-screen-activity")]: ACTIVITY_DESTINATION,
    } : {}),
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

export function buildReleaseHelpers({ output, mode = screenContextMode(process.env.DRIFTY_SCREEN_CONTEXT_MODE), platform = process.platform,
  arch = process.arch, execute = run, buildGuide = buildPermissionGuide } = {}) {
  mode = screenContextMode(mode);
  if (platform !== "darwin") throw Error("The Mac release helpers are built on macOS. Windows packaging is not wired yet.");
  output ??= resolve(root, releaseOutputRelative(mode));
  if (mode === "excluded") {
    // Preserve prior outputs and failures. A stale/linked directory is never cleaned
    // into an apparently passing exclusion build.
    try { lstatSync(output); throw Error("Excluded helper output already exists; preserve it and use a fresh output: " + output); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  } else if (existsSync(output)) {
    // Historical included build behavior in its own generated directory.
    rmSync(output, { recursive: true, force: true });
  }
  mkdirSync(output, { recursive: true, mode: 0o700 });
  if (mode === "included") {
    mkdirSync(resolve(output, "screen-context"), { recursive: true, mode: 0o700 });
    const helper = resolve(output, "screen-context/helper");
    execute("xcrun", ["swiftc", "-parse-as-library", "-O", "-target", swiftTarget(arch),
      resolve(root, "src-tauri/native/screen-context/macos.swift"), "-o", helper]);
    execute(process.execPath, [resolve(root, "scripts/build-screen-activity-helper.mjs"), resolve(output, "activity")]);
  }
  buildGuide(output);
  const config = resolve(output, CONFIG_NAME);
  const value = bundleConfig(output, mode);
  for (const source of Object.keys(value.bundle.resources)) {
    if (!existsSync(source)) throw Error("Missing built helper: " + source);
  }
  if (mode === "excluded") {
    for (const name of ["screen-context", "screen-activity", "activity"]) {
      try { lstatSync(resolve(output, name)); throw Error("Excluded helper output contains forbidden screen assets: " + name); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const evidence = { screenContextMode: mode, scope: "helper-build-selection",
    compiledNativeRendererVerified: false,
    sourceCommit: process.env.RELEASE_SOURCE_SHA ?? process.env.VITE_DRIFTY_BUILD_COMMIT ?? null,
    config, resources: value.bundle.resources };
  writeFileSync(config, JSON.stringify(value, null, 2) + "\n");
  writeFileSync(resolve(output, "build-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  return evidence;
}

export function buildReleaseHelpersFromArgs(argv, { environment = process.env, build = buildReleaseHelpers } = {}) {
  const mode = screenContextBuildEnvironment(environment).DRIFTY_SCREEN_CONTEXT_MODE;
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--output") throw Error("Unknown helper build argument: " + arg);
    if (output !== undefined) throw Error("Provide --output only once.");
    const value = argv[++index];
    if (!value || value.startsWith("-") || value.includes("\0") || !isAbsolute(value)) {
      throw Error("--output requires an absolute output path.");
    }
    output = resolve(value);
  }
  // Included rebuilding keeps its historical fixed generated output. Only the
  // fresh-only excluded variant accepts caller-selected attempt paths.
  if (output !== undefined && mode !== "excluded") throw Error("--output is supported only for excluded mode.");
  return build({ mode, ...(output !== undefined ? { output } : {}) });
}

function main() {
  console.log(JSON.stringify(buildReleaseHelpersFromArgs(process.argv.slice(2))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

