#!/usr/bin/env node
// Finalize a pinned internal rehearsal on the controller. Never publishes.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { containedPath, hashFile, nsisAppPayload, verifyPePdb } from "./windows-build-artifacts.mjs";
import { verifySignedInstalledPayloads } from "./windows-signing-rehearsal.mjs";
import { sentryDebugUploadArgs, windowsDebugUploadSettings } from "./upload-windows-debug-files.mjs";
import { verifyTauriUpdaterSignature } from "./windows-updater-signature.mjs";

const read = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const HASH = /^[a-f0-9]{64}$/u;

export function inspectFinalizationArtifacts(options) {
  const { artifactDirectory: root, manifestSha256, runtimeSha256, sourceCommit } = options;
  if (!path.isAbsolute(root ?? "") || !HASH.test(manifestSha256 ?? "") || !HASH.test(runtimeSha256 ?? "")
    || !/^[a-f0-9]{40}$/u.test(sourceCommit ?? "")) throw new Error("Finalization requires absolute artifacts and exact source/receipt pins.");
  const manifestFile = containedPath(root, "manifest.json"), runtimeFile = containedPath(root, "signed-runtime.json");
  if (hashFile(manifestFile).sha256 !== manifestSha256 || hashFile(runtimeFile).sha256 !== runtimeSha256) throw new Error("Finalization receipt changed.");
  const manifest = read(manifestFile), runtime = read(runtimeFile);
  if (manifest.sourceCommit !== sourceCommit || manifest.channel !== "production" || manifest.platform !== "win32"
    || manifest.architecture !== "x64" || manifest.signing?.records?.length !== 10) throw new Error("Finalization source/platform/signing sequence differs.");
  verifySignedInstalledPayloads(manifest, runtime);
  const expectedNames = ["target/release/drifty.exe", "target/release/drifty.pdb", "target/release/drifty-browser-host.exe",
    "target/release/drifty_browser_host.pdb", `target/release/bundle/nsis/drifty_${manifest.version}_x64-setup.exe`];
  if (manifest.installer !== expectedNames[4] || !Array.isArray(manifest.files) || manifest.files.length !== 5
    || new Set(manifest.files.map((f) => f.name)).size !== 5) throw new Error("Finalization artifact inventory differs.");
  const files = expectedNames.map((name) => {
    const record = manifest.files.find((f) => f.name === name), file = containedPath(root, path.posix.basename(name));
    if (!record || JSON.stringify(hashFile(file)) !== JSON.stringify({ bytes: record.bytes, sha256: record.sha256 })) throw new Error("Finalization artifact bytes differ.");
    return file;
  });
  const signedApp = containedPath(root, "signed-drifty.exe"), appRecords = manifest.signing.records.filter((r) => r.response === manifest.signing.signedAppResponse);
  if (appRecords.length !== 1 || hashFile(signedApp).sha256 !== appRecords[0].signedSha256
    || appRecords[0].signedSha256 !== manifest.signing.expectedInstalledHashes.app
    || nsisAppPayload(files[0]).sha256 !== appRecords[0].unsignedSha256) throw new Error("Signed main app differs from its original NSIS hook.");
  const pairs = [verifyPePdb(files[0], files[1]), verifyPePdb(signedApp, files[1]), verifyPePdb(files[2], files[3])];
  return { manifest, files, nativeFiles: [signedApp, files[1], files[2], files[3]], pairs, installer: files[4],
    binding: { sourceCommit, manifestSha256, runtimeSha256 }, publicationAllowed: false };
}

export function assertProcessedNativeUpload(log) {
  if (!/File processing complete/iu.test(log) || /(?:error:|upload failed|processing failed)/iu.test(log)) {
    throw new Error("Native upload lacks successful server processing.");
  }
}

export function nativeFinalizationUploadArgs(settings, proof) {
  const ids = [...new Set(proof.pairs.map((pair) => `${pair.guid}-${pair.age.toString(16)}`))];
  return [...sentryDebugUploadArgs(settings, proof.nativeFiles), "--require-all", ...ids.flatMap((id) => ["--id", id])];
}

export function uploadRehearsalNativeFiles(options, environment = process.env) {
  const proof = inspectFinalizationArtifacts(options), settings = windowsDebugUploadSettings(environment);
  if (!path.isAbsolute(options.cli ?? "") || !HASH.test(options.cliSha256 ?? "") || hashFile(options.cli).sha256 !== options.cliSha256
    || !path.isAbsolute(options.output ?? "") || path.relative(options.artifactDirectory, options.output).split(path.sep)[0] !== "..") {
    throw new Error("Native upload requires a pinned CLI and fresh output outside artifacts.");
  }
  mkdirSync(options.output, { mode: 0o700 });
  const stdoutFile = path.join(options.output, "native-upload.stdout.log"), stderrFile = path.join(options.output, "native-upload.stderr.log");
  const out = openSync(stdoutFile, "wx", 0o600), err = openSync(stderrFile, "wx", 0o600), started = performance.now();
  const base = Object.fromEntries(Object.entries(environment).filter(([k]) => /^(?:PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|USERPROFILE|APPDATA|LOCALAPPDATA|PATHEXT)$/iu.test(k)));
  let result;
  try {
    result = spawnSync(process.execPath, [options.cli, ...nativeFinalizationUploadArgs(settings, proof)], {
      env: { ...base, SENTRY_AUTH_TOKEN: environment.SENTRY_AUTH_TOKEN, SENTRY_DISABLE_AUTO_UPDATE: "1" },
      stdio: ["ignore", out, err], windowsHide: true, timeout: 300_000,
    });
  } finally { closeSync(out); closeSync(err); }
  const receipt = { ...proof.binding, publicationAllowed: false, project: settings.project, org: settings.org,
    seconds: (performance.now() - started) / 1000, exitCode: result.status, pairs: proof.pairs,
    files: proof.nativeFiles.map((file) => ({ name: path.basename(file), ...hashFile(file) })),
    stdout: hashFile(stdoutFile, { allowEmpty: true }), stderr: hashFile(stderrFile, { allowEmpty: true }), processed: false };
  const save = () => writeFileSync(path.join(options.output, "native-upload.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  save();
  if (result.error || result.status !== 0) throw new Error("Native upload failed; preserve private logs and inspect before retry.");
  assertProcessedNativeUpload([stdoutFile, stderrFile].map((f) => readFileSync(f, "utf8")).join("\n"));
  inspectFinalizationArtifacts(options);
  if (hashFile(options.cli).sha256 !== options.cliSha256) throw new Error("Native uploader changed during processing.");
  receipt.processed = true; save(); return receipt;
}

export function verifyRehearsalUpdater(options) {
  const proof = inspectFinalizationArtifacts(options);
  if (!path.isAbsolute(options.config ?? "") || !HASH.test(options.configSha256 ?? "") || hashFile(options.config).sha256 !== options.configSha256) throw new Error("Updater source configuration pin differs.");
  const config = read(options.config);
  if (config.version !== proof.manifest.version) throw new Error("Updater source version differs.");
  const signature = `${proof.installer}.sig`;
  return { ...proof.binding, publicationAllowed: false, installer: hashFile(proof.installer), signature: hashFile(signature),
    ...verifyTauriUpdaterSignature(readFileSync(proof.installer), readFileSync(signature, "utf8"), config.plugins?.updater?.pubkey) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: windows-rehearsal-finalization.mjs <upload-native|verify-updater> <private-options.json>");
    const options = read(process.argv[3]), operation = process.argv[2];
    if (!["upload-native", "verify-updater"].includes(operation)) throw new Error("Unknown finalization operation.");
    console.log(JSON.stringify(operation === "upload-native" ? uploadRehearsalNativeFiles(options) : verifyRehearsalUpdater(options)));
  } catch (error) { console.error(`windows-finalization: ${error.message}`); process.exitCode = 1; }
}
