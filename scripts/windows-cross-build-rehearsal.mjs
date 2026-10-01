#!/usr/bin/env node

// Internal Linux -> Windows MSVC experiment. Packaging, signing and installed
// runtime acceptance belong to the Windows host, after this manifest is checked.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { containedPath, hashFile, nsisAppPayload, verifyPePdb } from "./windows-build-artifacts.mjs";
import { acquireBuilderLock, assertSourceIdentity, frontendSourceExpectation,
  sourceFingerprint, sourceState } from "./windows-builder-rehearsal.mjs";
import { frontendDistForTauri, verifyPreparedFrontend, WINDOWS_APP_KEYS,
  WINDOWS_RENDERER_ENVIRONMENT } from "./windows-frontend-artifacts.mjs";

const TARGET = "x86_64-pc-windows-msvc";
const SYSTEM_KEYS = new Set(["PATH", "HOME", "TMPDIR", "CARGO_HOME", "RUSTUP_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR"]);
const FORBIDDEN = /^(?:TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?|SENTRY_AUTH_TOKEN|GH_TOKEN|GITHUB_TOKEN|RUSTC_(?:WORKSPACE_)?WRAPPER|CARGO_BUILD_RUSTC_(?:WORKSPACE_)?WRAPPER|DRIFTY_WINDOWS_(?:RELEASE_SCCACHE_PATH|SIGN_RELEASE|SIGNING_MODE|ESIGNER_.+))$/iu;
const TRIAL_TERMS_SHA256 = "9c0cd52b20db9d081854c75bd1b50c75514b8f8cb09c8cad15e89d90b97b5bf3";

export function assertClangSdkCompatibility(version) {
  const major = /clang version (\d+)\./iu.exec(version)?.[1];
  if (!major || Number(major) < 19) throw new Error("Pinned VS 17.14 STL requires Clang 19 or newer; do not suppress its compiler-version check.");
}

export function verifyProductionTauriFeatures(targetDirectory) {
  const root = path.join(targetDirectory, TARGET, "release/.fingerprint");
  const records = readdirSync(root).filter((name) => name.startsWith("tauri-"))
    .flatMap((name) => {
      const file = path.join(root, name, "lib-tauri.json");
      if (!existsSync(file)) return [];
      const metadata = JSON.parse(readFileSync(file, "utf8"));
      const features = JSON.parse(metadata.features);
      if (!Array.isArray(features) || !features.includes("custom-protocol")) {
        throw new Error("Cross release lacks Tauri custom-protocol; a release profile alone does not embed production assets.");
      }
      return [{ name: `${name}/lib-tauri.json`, features, ...hashFile(file) }];
    });
  if (!records.length) throw new Error("Missing compiled Tauri production-feature evidence.");
  return records;
}

// This receipt records the installed product and the bounded internal test basis;
// it is not an entitlement certificate or permission for production distribution.
export function verifyInternalUseBasis(file, expectedSha256, commit, now = Date.now()) {
  if (lstatSync(file).isSymbolicLink() || hashFile(file).sha256 !== expectedSha256) throw new Error("SDK use-basis identity differs.");
  const proof = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
  const receipt = containedPath(path.dirname(file), proof.installationReceipt);
  if (hashFile(receipt).sha256 !== proof.installationReceiptSha256) throw new Error("VS installation receipt changed.");
  const install = JSON.parse(readFileSync(receipt, "utf8").replace(/^\uFEFF/u, ""));
  const installed = Date.parse(install.startedAtUtc), ended = Date.parse(install.endedAtUtc);
  const expires = installed + 30 * 24 * 60 * 60_000;
  const instances = Array.isArray(install.instances) ? install.instances
    : Array.isArray(install.instances?.value) && install.instances.Count === install.instances.value.length
      ? install.instances.value : [install.instances];
  if (proof.schemaVersion !== 1 || proof.scope !== "internal-evaluation" || proof.sourceCommit !== commit
    || proof.publicationAllowed !== false || proof.termsSha256 !== TRIAL_TERMS_SHA256
    || install.licenseTermsSha256 !== TRIAL_TERMS_SHA256 || install.mode !== "internal-vs-professional-trial"
    || install.publicationAllowed !== false || install.productKeyEntered !== false || install.signinPerformed !== false
    || ![0, 3010].includes(install.exitCode) || !Number.isFinite(installed) || !Number.isFinite(ended)
    || ended < installed || ended > now || Date.parse(proof.expiresAtUtc) !== expires
    || !instances.some((instance) => instance?.isComplete === true
      && instance.productId === "Microsoft.VisualStudio.Product.Professional")) {
    throw new Error("Expected a completed, source-bound internal VS trial receipt.");
  }
  if (now >= expires) throw new Error("Internal VS trial expired; do not reset or reuse its receipt.");
  return { scope: proof.scope, manifestSha256: expectedSha256, installationReceiptSha256: proof.installationReceiptSha256,
    termsSha256: proof.termsSha256, expiresAtUtc: proof.expiresAtUtc, publicationAllowed: false };
}

export function crossBuildEnvironment(base, settings, { candidate, commit, jobs, sdk, crt, crtSelector }) {
  for (const [key, value] of Object.entries(base)) {
    if (value && FORBIDDEN.test(key)) throw new Error(`Cross builder must not inherit ${key}.`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Expected explicit app settings.");
  for (const [key, value] of Object.entries(settings)) {
    if (!WINDOWS_APP_KEYS.includes(key) || typeof value !== "string" || value.includes("\0")) throw new Error(`Unsupported app setting: ${key}.`);
  }
  for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_POSTHOG_KEY", "VITE_POSTHOG_HOST",
    "VITE_SENTRY_DSN", "DRIFTY_NATIVE_SENTRY_DSN", "DRIFTY_TRACKER_SENTRY_DSN"]) {
    if (!settings[key]?.trim()) throw new Error(`Required app setting is missing: ${key}.`);
  }
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 12) throw new Error("Choose between 1 and 12 Cargo jobs within the container budget.");
  if (!/^10\.0\.\d+\.0$/u.test(sdk) || !/^14\.\d+\.\d+$/u.test(crt)
    || !/^14\.\d+\.17\.\d+$/u.test(crtSelector)) throw new Error("Pin SDK, CRT payload version and xwin component selector.");
  return { ...Object.fromEntries(Object.entries(base).filter(([key]) => SYSTEM_KEYS.has(key))),
    ...settings, ...WINDOWS_RENDERER_ENVIRONMENT, VITE_DRIFTY_BUILD_COMMIT: commit,
    CARGO_TARGET_DIR: path.join(candidate, "target"), CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: String(jobs),
    TAURI_ENV_TARGET_TRIPLE: TARGET, XWIN_ARCH: "x86_64", XWIN_VARIANT: "desktop", XWIN_VERSION: "17",
    XWIN_SDK_VERSION: sdk.replace(/\.0$/u, ""), XWIN_CRT_VERSION: crtSelector, XWIN_CACHE_DIR: path.join(candidate, "sdk"),
    XWIN_HTTP_RETRIES: "2" };
}

export function verifySdkManifest(directory, expectedSha256, sdk, crt, crtSelector) {
  const channelFile = containedPath(directory, "manifest_17.json");
  const channel = JSON.parse(readFileSync(channelFile, "utf8"));
  const payloads = channel.channelItems?.find((item) => item.type === "Manifest" && item.payloads?.length)?.payloads;
  if (payloads?.length !== 1 || !/^[a-f0-9]{64}$/u.test(payloads[0].sha256)
    || new URL(payloads[0].url).hostname !== "download.visualstudio.microsoft.com") {
    throw new Error("Expected the Microsoft VS 17 package manifest reference.");
  }
  // xwin's cache filename uses Microsoft's advertised digest. Its source notes
  // that this digest differs from the downloaded bytes, so pin the actual bytes.
  const name = `pkg_manifest_${payloads[0].sha256}.vsman`;
  const file = containedPath(directory, name);
  if (hashFile(file).sha256 !== expectedSha256) throw new Error("Microsoft SDK package manifest changed.");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const headers = manifest.packages?.find((item) => item.id === `Microsoft.VC.${crtSelector}.CRT.Headers.base`);
  const libraries = manifest.packages?.find((item) => item.id === `Microsoft.VC.${crtSelector}.CRT.x64.Desktop.base`);
  const windows = manifest.packages?.find((item) => item.id === `Win11SDK_${sdk.replace(/\.0$/u, "")}`);
  if (libraries?.version !== crt || !headers?.version || !windows?.version) throw new Error("SDK/CRT component selection differs from the pinned payload.");
  return { packageManifestSha256: expectedSha256, crtSelector, crtPayloadVersion: libraries.version, crtHeadersVersion: headers.version,
    sdkComponent: windows.id, sdkPackageVersion: windows.version,
    files: [{ name: "manifest_17.json", ...hashFile(channelFile) }, { name, ...hashFile(file) }] };
}

export function sdkCacheFiles(root, prefix = "xwin") {
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const name = `${prefix}/${entry.name}`;
    const file = path.join(root, name);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(file);
      if (path.isAbsolute(target)) throw new Error("SDK cache links must remain relative.");
      containedPath(path.join(root, "xwin"), name.slice("xwin/".length)); // Keep aliases inside the hashed SDK tree.
      files.push({ name, link: target });
    } else if (entry.isDirectory()) files.push(...sdkCacheFiles(root, name));
    else if (entry.isFile()) files.push({ name, ...hashFile(file, { allowEmpty: true }) });
    else throw new Error("SDK cache contains an unsupported file.");
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function verifySdkCache(root, expectedSha256, sdkPackages, now = Date.now()) {
  const file = containedPath(root, "manifest.json");
  if (hashFile(file).sha256 !== expectedSha256) throw new Error("SDK cache proof changed.");
  const proof = JSON.parse(readFileSync(file, "utf8"));
  if (proof.schemaVersion !== 1 || proof.purpose !== "internal-verified-xwin-cache" || proof.publicationAllowed !== false
    || proof.packageManifestSha256 !== sdkPackages.packageManifestSha256 || proof.crtSelector !== sdkPackages.crtSelector
    || proof.crtPayloadVersion !== sdkPackages.crtPayloadVersion || proof.sdkComponent !== sdkPackages.sdkComponent
    || !/^[a-f0-9]{64}$/u.test(proof.sourceCandidateManifestSha256 ?? "")
    || !Number.isFinite(Date.parse(proof.internalUseUntilUtc)) || now >= Date.parse(proof.internalUseUntilUtc)
    || !Array.isArray(proof.files) || proof.files.length < 1 || proof.files.length > 100_000
    || JSON.stringify(sdkCacheFiles(root)) !== JSON.stringify(proof.files)
    || !readFileSync(containedPath(root, "xwin/DONE"), "utf8").split("\n")[0].split(/\s+/u).includes("x86_64")) {
    throw new Error("SDK cache scope, version, deadline or payload differs.");
  }
  return { manifestSha256: expectedSha256, files: proof.files.length, sourceCandidateManifestSha256: proof.sourceCandidateManifestSha256,
    internalUseUntilUtc: proof.internalUseUntilUtc };
}

function inventory(root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || /[\\:\x00-\x1f]/u.test(entry.name)) throw new Error("Linked or unsafe tracker resource.");
    if (entry.isDirectory()) files.push(...inventory(root, name));
    else if (entry.isFile()) files.push({ name, ...hashFile(containedPath(root, name), { allowEmpty: true }) });
    else throw new Error("Tracker resources must be regular files.");
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function verifyTrackerInputs(root, manifestFile, expectedSha256, commit) {
  if (lstatSync(root).isSymbolicLink() || hashFile(manifestFile).sha256 !== expectedSha256) throw new Error("Tracker manifest identity differs.");
  const proof = JSON.parse(readFileSync(manifestFile, "utf8").replace(/^\uFEFF/u, ""));
  if (proof.sourceCommit !== commit || !Array.isArray(proof.files) || proof.fileCount !== proof.files.length
    || proof.fileCount < 1 || proof.fileCount > 10_000) throw new Error("Tracker source proof differs.");
  const expected = proof.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  const files = inventory(root);
  if (!files.some((file) => file.name === "drifty-tracker.exe" && file.bytes > 0) || JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new Error("Windows tracker resources changed or lack the executable.");
  }
  return files;
}

function atomicJson(file, value) {
  const pending = `${file}.${randomUUID()}.pending`;
  writeFileSync(pending, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(pending, file);
}

function probe(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`Tool preflight failed: ${command}.`);
  return result.stdout.trim();
}

export function runCrossRehearsal(options) {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("This experiment requires Linux x64.");
  const repo = realpathSync(options.repo), candidate = path.resolve(options.candidate);
  assertSourceIdentity(sourceState(repo), options.commit, repo);
  if (existsSync(candidate)) throw new Error("Preserve the existing cross candidate; allocate a fresh attempt.");
  const parent = realpathSync(path.dirname(candidate));
  const relative = path.relative(repo, parent);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Keep cross outputs outside the source checkout.");
  }
  const settings = JSON.parse(readFileSync(options.appEnvironment, "utf8").replace(/^\uFEFF/u, ""));
  const env = crossBuildEnvironment(process.env, settings, { ...options, candidate });
  const useBasis = verifyInternalUseBasis(options.useBasis, options.useBasisHash, options.commit);
  const sdkPackages = verifySdkManifest(options.sdkManifests, options.sdkManifestHash, options.sdk, options.crt, options.crtSelector);
  const sdkCacheProof = options.sdkCache ? verifySdkCache(options.sdkCache, options.sdkCacheHash, sdkPackages) : null;
  if (sdkCacheProof && sdkCacheProof.internalUseUntilUtc !== useBasis.expiresAtUtc) throw new Error("SDK cache belongs to a different internal trial period.");
  const expected = frontendSourceExpectation(repo, options.commit, settings);
  const frontend = verifyPreparedFrontend(options.frontend, options.frontendHash, expected);
  const trackerRoot = path.join(repo, "src-tauri/binaries/drifty-tracker-x86_64-pc-windows-msvc");
  const trackerResources = verifyTrackerInputs(trackerRoot, options.tracker, options.trackerHash, options.commit);
  const sourceHash = sourceFingerprint(repo);
  const attemptId = randomUUID(), started = performance.now();
  const releaseLock = acquireBuilderLock(candidate, { attemptId, sourceCommit: options.commit, pid: process.pid });
  const manifest = { schemaVersion: 1, mode: "internal-linux-cross-build", state: "running", publicationAllowed: false,
    sourceCommit: options.commit, sourceFingerprint: sourceHash, version: expected.version, channel: "production",
    target: TARGET, attemptId, startedAtUtc: new Date().toISOString(), phases: [],
    sdkUseBasis: useBasis,
    frontend: { manifestSha256: frontend.manifestSha256, files: frontend.manifest.files },
    tracker: { manifestSha256: options.trackerHash, files: trackerResources },
    compiler: { sdk: options.sdk, crt: options.crt, crtSelector: options.crtSelector, jobs: options.jobs } };
  const manifestFile = path.join(candidate, "manifest.json");
  function phase(name, command, args, extra = {}) {
    verifyInternalUseBasis(options.useBasis, options.useBasisHash, options.commit);
    const out = openSync(path.join(candidate, `${name}.stdout.log`), "wx", 0o600);
    const err = openSync(path.join(candidate, `${name}.stderr.log`), "wx", 0o600);
    const start = performance.now();
    manifest.activePhase = name; atomicJson(manifestFile, manifest);
    let result;
    try { result = spawnSync(command, args, { cwd: repo, env: { ...env, ...extra },
      stdio: ["ignore", out, err], timeout: 30 * 60_000 }); }
    finally { closeSync(out); closeSync(err); }
    manifest.phases.push({ name, seconds: (performance.now() - start) / 1000, exitCode: result.status,
      signal: result.signal, stdout: hashFile(path.join(candidate, `${name}.stdout.log`), { allowEmpty: true }),
      stderr: hashFile(path.join(candidate, `${name}.stderr.log`), { allowEmpty: true }) });
    atomicJson(manifestFile, manifest);
    if (result.error || result.status !== 0) throw new Error(`${name} failed; inspect its preserved log before retrying.`);
  }
  try {
    manifest.compiler = { ...manifest.compiler, rust: probe("rustc", ["-Vv"], env),
      cargo: probe("cargo", ["-V"], env), xwin: probe("cargo-xwin", ["-V"], env),
      nativeCc: probe("cc", ["--version"], env), nativeLd: probe("ld", ["--version"], env),
      clang: probe("clang-cl", ["--version"], env), lld: probe("lld-link", ["--version"], env), node: process.version };
    assertClangSdkCompatibility(manifest.compiler.clang);
    if (sdkCacheProof) {
      phase("sdk-cache-stage", "cp", ["--reflink=auto", "-a", `${realpathSync(options.sdkCache)}/.`, path.join(candidate, "sdk")]);
      manifest.compiler.sdkCache = verifySdkCache(path.join(candidate, "sdk"), options.sdkCacheHash, sdkPackages);
    } else {
      const sdkCache = path.join(candidate, "sdk/xwin/dl");
      mkdirSync(sdkCache, { recursive: true });
      for (const file of sdkPackages.files) copyFileSync(containedPath(options.sdkManifests, file.name), path.join(sdkCache, file.name));
      verifySdkManifest(sdkCache, options.sdkManifestHash, options.sdk, options.crt, options.crtSelector);
      // Tool/SDK/dependency provisioning is separate from compilation timing.
      phase("sdk-fetch", "cargo-xwin", ["xwin", "cache", "xwin"]);
    }
    manifest.compiler.sdkPackages = verifySdkManifest(options.sdkManifests, options.sdkManifestHash, options.sdk, options.crt, options.crtSelector);
    // cargo-xwin also resolves unfiltered Cargo metadata, including other
    // platforms. A target-filtered fetch left addr2line missing in offline mode.
    phase("cargo-fetch", "cargo", ["fetch", "--locked", "--manifest-path", "src-tauri/Cargo.toml"]);
    const windows = JSON.parse(readFileSync(path.join(repo, "src-tauri/tauri.windows.conf.json"), "utf8"));
    const config = { ...windows, build: { frontendDist: frontendDistForTauri(repo, frontend.dist), beforeBuildCommand: "" } };
    // Tauri CLI's production build adds this dependency feature automatically.
    // Direct Cargo release builds otherwise still load devUrl instead of assets.
    const build = (name, bin, overlay) => phase(name, "cargo-xwin", ["build", "--release", "--locked", "--offline",
      "--features", "tauri/custom-protocol",
      "--manifest-path", "src-tauri/Cargo.toml", "--target", TARGET, "--bin", bin], { TAURI_CONFIG: JSON.stringify(overlay) });
    build("browser-build", "drifty-browser-host", { ...config, bundle: { ...config.bundle, resources: [] } });
    build("app-build", "drifty", config);
    manifest.compiler.productionTauriFeatures = verifyProductionTauriFeatures(path.join(candidate, "target"));
    verifyPreparedFrontend(options.frontend, options.frontendHash, expected);
    verifyTrackerInputs(trackerRoot, options.tracker, options.trackerHash, options.commit);
    verifyInternalUseBasis(options.useBasis, options.useBasisHash, options.commit);
    verifySdkManifest(options.sdkManifests, options.sdkManifestHash, options.sdk, options.crt, options.crtSelector);
    if (sdkCacheProof) {
      verifySdkCache(options.sdkCache, options.sdkCacheHash, sdkPackages);
      verifySdkCache(path.join(candidate, "sdk"), options.sdkCacheHash, sdkPackages);
    }
    assertSourceIdentity(sourceState(repo), options.commit, repo);
    if (sourceFingerprint(repo) !== sourceHash) throw new Error("Tracked source changed during cross compilation.");
    const output = `target/${TARGET}/release`;
    manifest.files = ["drifty.exe", "drifty.pdb", "drifty-browser-host.exe", "drifty_browser_host.pdb"]
      .map((name) => ({ name: `${output}/${name}`, ...hashFile(containedPath(candidate, `${output}/${name}`)) }));
    manifest.pairs = [["drifty.exe", "drifty.pdb"], ["drifty-browser-host.exe", "drifty_browser_host.pdb"]]
      .map(([exe, pdb]) => ({ exe: `${output}/${exe}`, pdb: `${output}/${pdb}`,
        ...verifyPePdb(containedPath(candidate, `${output}/${exe}`), containedPath(candidate, `${output}/${pdb}`)) }));
    if (manifest.pairs[0].guid === manifest.pairs[1].guid && manifest.pairs[0].age === manifest.pairs[1].age) {
      throw new Error("App and browser host need distinct debug IDs.");
    }
    manifest.expectedUnsignedInstalledApp = nsisAppPayload(containedPath(candidate, `${output}/drifty.exe`));
    manifest.state = "complete";
    return manifest;
  } catch (error) { manifest.state = "failed"; manifest.error = error.message; throw error; }
  finally {
    delete manifest.activePhase;
    manifest.endedAtUtc = new Date().toISOString(); manifest.elapsedSeconds = (performance.now() - started) / 1000;
    try { atomicJson(manifestFile, manifest); } finally { releaseLock(); }
  }
}

export function parseCrossCli(args) {
  const names = new Map([["--repo", "repo"], ["--source-sha", "commit"], ["--candidate-dir", "candidate"],
    ["--app-environment", "appEnvironment"], ["--prepared-frontend", "frontend"], ["--prepared-frontend-sha256", "frontendHash"],
    ["--tracker-manifest", "tracker"], ["--tracker-manifest-sha256", "trackerHash"],
    ["--sdk-use-basis", "useBasis"], ["--sdk-use-basis-sha256", "useBasisHash"],
    ["--sdk-manifest-sha256", "sdkManifestHash"], ["--crt-selector", "crtSelector"],
    ["--sdk-manifests", "sdkManifests"],
    ["--sdk-cache", "sdkCache"], ["--sdk-cache-sha256", "sdkCacheHash"],
    ["--sdk-version", "sdk"], ["--crt-version", "crt"], ["--jobs", "jobs"]]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = names.get(args[i]);
    if (!key || !args[i + 1] || options[key] !== undefined) throw new Error("Unknown, duplicate or incomplete cross-build option.");
    options[key] = args[i + 1];
  }
  if ([...names.values()].filter((key) => !["sdkCache", "sdkCacheHash"].includes(key)).some((key) => options[key] === undefined)
    || !/^[a-f0-9]{40}$/u.test(options.commit) || !/^[a-f0-9]{64}$/u.test(options.frontendHash)
    || !/^[a-f0-9]{64}$/u.test(options.trackerHash) || !/^[1-9][0-9]*$/u.test(options.jobs)) {
    throw new Error("Pin source, frontend, tracker, SDK use basis, SDK, CRT and Cargo job inputs.");
  }
  if (!/^[a-f0-9]{64}$/u.test(options.useBasisHash) || !/^[a-f0-9]{64}$/u.test(options.sdkManifestHash)) {
    throw new Error("Pin SDK use-basis and Microsoft package manifest hashes.");
  }
  if (Boolean(options.sdkCache) !== Boolean(options.sdkCacheHash)
    || (options.sdkCache && !/^[a-f0-9]{64}$/u.test(options.sdkCacheHash))) throw new Error("Pin the optional SDK cache and its proof together.");
  options.jobs = Number(options.jobs);
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = runCrossRehearsal(parseCrossCli(process.argv.slice(2)));
    console.log(`Internal Windows cross build complete: ${result.elapsedSeconds.toFixed(1)}s; Windows acceptance remains.`); }
  catch (error) { console.error(`windows-cross-build-rehearsal: ${error.message}`); process.exitCode = 1; }
}
