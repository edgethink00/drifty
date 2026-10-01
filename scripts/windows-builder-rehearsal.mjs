#!/usr/bin/env node

// Internal measurement only. Public release entry points keep their
// signing, updater and Sentry requirements; this runner cannot publish assets.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync,
  renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { containedPath, hashFile, nsisAppPayload, verifyPePdb } from "./windows-build-artifacts.mjs";
import { assertSignerReadiness, collectSigningEvidence, readPluginCache, signingBuildSettings, verifySignedInstalledPayloads } from "./windows-signing-rehearsal.mjs";
import { WINDOWS_APP_KEYS, frontendEnvironmentFingerprint, preparedFrontendTauriConfig, verifyPreparedFrontend } from "./windows-frontend-artifacts.mjs";

const APP_KEYS = new Set(WINDOWS_APP_KEYS);
const OS_KEYS = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PROGRAMFILES",
  "PROGRAMFILES(X86)", "PROGRAMW6432", "PROGRAMDATA", "ALLUSERSPROFILE", "USERPROFILE",
  "USERNAME", "USERDOMAIN", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "HOMEDRIVE",
  "HOMEPATH", "COMPUTERNAME", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  "CARGO_HOME", "RUSTUP_HOME",
]);
const FORBIDDEN = /^(?:TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?|SENTRY_AUTH_TOKEN|GH_TOKEN|GITHUB_TOKEN|RUSTC_(?:WORKSPACE_)?WRAPPER|CARGO_BUILD_RUSTC_(?:WORKSPACE_)?WRAPPER|DRIFTY_WINDOWS_(?:RELEASE_SCCACHE_PATH|SIGN_RELEASE|SIGNING_MODE|ESIGNER_.+))$/iu;

export function builderEnvironment(base, config, { python, target, commit }) {
  for (const [key, value] of Object.entries(base)) {
    if (value && FORBIDDEN.test(key)) throw new Error(`Builder must not inherit ${key}.`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("App environment must be an object.");
  for (const [key, value] of Object.entries(config)) {
    if (!APP_KEYS.has(key) || typeof value !== "string" || value.includes("\0")) throw new Error(`Unsupported builder app setting: ${key}.`);
  }
  for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_POSTHOG_KEY", "VITE_POSTHOG_HOST",
    "VITE_SENTRY_DSN", "DRIFTY_NATIVE_SENTRY_DSN", "DRIFTY_TRACKER_SENTRY_DSN"]) {
    if (!config[key]?.trim()) throw new Error(`Builder app setting is required: ${key}.`);
  }
  // Drop all other inherited variables, including unrelated upload tokens.
  const clean = Object.fromEntries(Object.entries(base).filter(([key]) => OS_KEYS.has(key.toUpperCase())));
  return { ...clean, ...config, DRIFTY_TRACKER_BUILD_PYTHON: python, CARGO_TARGET_DIR: target,
    CARGO_INCREMENTAL: "0", VITE_DRIFTY_BUILD_COMMIT: commit, DRIFTY_WINDOWS_BUILD_TIMINGS: "1" };
}

export function assertSourceIdentity({ head, status, root }, expectedCommit, expectedRoot) {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/iu.test(expectedCommit)) throw new Error("Expected a full source commit.");
  if (head.toLowerCase() !== expectedCommit.toLowerCase()) throw new Error("Source HEAD does not match the requested commit.");
  if (status.trim()) throw new Error("Source must be a clean Git checkout.");
  if (path.resolve(root) !== path.resolve(expectedRoot)) {
    // Windows may return a different drive-letter case or long/8.3 spelling.
    // Compare real directory identity instead of treating aliases as a new repo.
    let same = false;
    try {
      const a = statSync(root, { bigint: true }), b = statSync(expectedRoot, { bigint: true });
      same = a.isDirectory() && b.isDirectory() && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino;
    } catch { /* Missing or unrelated paths remain denied. */ }
    if (!same) throw new Error("--repo must identify the Git checkout root.");
  }
}

export function assertControllerClock(controllerUtc, now = Date.now()) {
  const controller = Date.parse(controllerUtc);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/u.test(controllerUtc)
    || !Number.isFinite(controller) || Math.abs(now - controller) > 120_000) {
    throw new Error("Guest clock or controller timestamp is stale; synchronize before building.");
  }
}

export function acquireBuilderLock(directory, owner) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "builder.lock");
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(owner)}\n`); } catch (error) { closeSync(fd); unlinkSync(file); throw error; }
  closeSync(fd);
  return () => {
    const recorded = JSON.parse(readFileSync(file, "utf8"));
    if (recorded.attemptId !== owner.attemptId) throw new Error("Builder lock ownership changed; preserve it for inspection.");
    unlinkSync(file);
  };
}

function atomicJson(file, value) {
  const pending = `${file}.${randomUUID()}.pending`;
  writeFileSync(pending, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(pending, file);
}

function git(repo, args) {
  // Cross-host frontend identity checks also run on Unix. Git needs HOME to
  // read the container's explicitly scoped safe.directory configuration.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => OS_KEYS.has(key.toUpperCase()) || key === "HOME"));
  const result = spawnSync("git", ["-C", repo, ...args], { env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0 || result.error) throw new Error("Could not inspect source Git identity.");
  return result.stdout;
}

export function sourceState(repo) {
  return { head: git(repo, ["rev-parse", "HEAD"]).trim(), root: realpathSync(git(repo, ["rev-parse", "--show-toplevel"]).trim()),
    status: git(repo, ["status", "--porcelain=v1", "--untracked-files=all"]) };
}

export function sourceFingerprint(repo) {
  const hash = createHash("sha256");
  for (const name of git(repo, ["ls-files", "-z"]).split("\0").filter(Boolean).sort()) {
    const file = containedPath(repo, name);
    hash.update(`${name}\0${createHash("sha256").update(readFileSync(file)).digest("hex")}\0`);
  }
  return hash.digest("hex");
}

export function frontendSourceExpectation(repo, commit, environment) {
  assertSourceIdentity(sourceState(repo), commit, repo);
  const version = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).version;
  const tauriVersion = JSON.parse(readFileSync(path.join(repo, "src-tauri/tauri.conf.json"), "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/u.test(version) || version !== tauriVersion) throw new Error("Frontend and native release versions differ.");
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (existsSync(path.join(repo, "apps/desktop", name))) throw new Error("Prepared frontend requires explicit public settings without local env overrides.");
  }
  // Bind cross-host source to the committed tree. Git's known checkout CRLF
  // conversion must not invalidate a frontend built from the same clean HEAD.
  // The build still records/checks its actual working bytes before and after.
  return { commit, version,
    sourceFingerprint: createHash("sha256").update(`git-tree:${git(repo, ["rev-parse", "HEAD^{tree}"]).trim()}`).digest("hex"),
    environmentFingerprint: frontendEnvironmentFingerprint(environment),
    lockfileSha256: createHash("sha256").update(git(repo, ["show", "HEAD:package-lock.json"])).digest("hex") };
}

function probe(executable, args, env) {
  const result = spawnSync(executable, args, { env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (result.status !== 0 || result.error) throw new Error("Builder preflight failed; check clock, idle processes and toolchain.");
  return result.stdout.trim();
}

function powershell(script, env) {
  return probe(path.join(env.SystemRoot ?? env.SYSTEMROOT, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], env);
}

function toolchain(env, python) {
  const native = JSON.parse(powershell(`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';
    if(@(Get-Process cargo,rustc,cl,link -ErrorAction SilentlyContinue).Count){throw 'Another native build is active'};
    $vswhere=Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft Visual Studio\\Installer\\vswhere.exe';
    $vs=(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json|ConvertFrom-Json);
    if(-not $vs){throw 'MSVC installation missing'};
    @{visualStudio=$vs.installationVersion;msvc=@(Get-ChildItem (Join-Path $vs.installationPath 'VC\\Tools\\MSVC') -Directory|ForEach-Object {[string]$_.Name});
      windowsBuild=[Environment]::OSVersion.Version.ToString();utc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json`, env));
  return { ...native, git: probe("git", ["--version"], env), rust: probe("rustc", ["-Vv"], env),
    cargo: probe("cargo", ["--version"], env), python: probe(python, ["--version"], env) };
}

function resourceFiles(root, prefix = "") {
  const files = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error("Tracker resources must not contain symlinks.");
    if (entry.isDirectory()) files.push(...resourceFiles(root, name));
    else files.push({ name, ...hashFile(containedPath(root, name), { allowEmpty: true }) });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function phase(repo, candidate, name, args, env, manifest, executable = process.execPath) {
  const stdout = openSync(path.join(candidate, `${name}.stdout.log`), "wx", 0o600);
  const stderr = openSync(path.join(candidate, `${name}.stderr.log`), "wx", 0o600);
  const start = performance.now();
  const startedAtUtc = new Date().toISOString();
  let result;
  try {
    // Real file handles avoid waiting for descendant-owned pipe endpoints.
    result = spawnSync(executable, args, { cwd: repo, env, stdio: ["ignore", stdout, stderr], windowsHide: true });
  } finally { closeSync(stdout); closeSync(stderr); }
  manifest.phases.push({ name, startedAtUtc, endedAtUtc: new Date().toISOString(), seconds: (performance.now() - start) / 1000,
    exitCode: result.status, ...(result.error ? { spawnError: result.error.code } : {}),
    stdout: `${name}.stdout.log`, stderr: `${name}.stderr.log` });
  atomicJson(path.join(candidate, "manifest.json"), manifest);
  if (result.status !== 0 || result.error) throw new Error(`Builder phase ${name} failed; inspect its local logs.`);
}

export function collectArtifacts(candidate) {
  const release = "target/release";
  const pairs = [["drifty.exe", "drifty.pdb"], ["drifty-browser-host.exe", "drifty_browser_host.pdb"]].map(([exe, pdb]) => ({
    exe: `${release}/${exe}`, pdb: `${release}/${pdb}`,
    ...verifyPePdb(containedPath(candidate, `${release}/${exe}`), containedPath(candidate, `${release}/${pdb}`)),
  }));
  if (pairs[0].guid === pairs[1].guid && pairs[0].age === pairs[1].age) throw new Error("Native binaries unexpectedly share a debug identity.");
  const installers = readdirSync(containedPath(candidate, `${release}/bundle/nsis`)).filter((name) => name.endsWith(".exe"));
  if (installers.length !== 1) throw new Error("Expected exactly one installer in this fresh attempt.");
  const names = [...pairs.flatMap((pair) => [pair.exe, pair.pdb]), `${release}/bundle/nsis/${installers[0]}`];
  return { pairs, installer: names.at(-1), files: names.map((name) => ({ name, ...hashFile(containedPath(candidate, name)) })) };
}

export function verifyInstalledPayloads(manifest, evidence, compiledApp) {
  if (manifest.schemaVersion !== 1 || manifest.mode !== "internal-unsigned-rehearsal" || manifest.state !== "complete"
    || manifest.publicationAllowed !== false || evidence.passed !== true
    || evidence.app?.buildCommit !== manifest.sourceCommit || evidence.app?.version !== manifest.version
    || !evidence.cleanup?.credentialBaselineRestored || !evidence.cleanup?.appStopped
    || !evidence.cleanup?.debugPortClosed || !evidence.cleanup?.managedAiPortClosed
    || !Array.isArray(evidence.cleanup?.residualProductProcessIds) || evidence.cleanup.residualProductProcessIds.length) {
    throw new Error("Installed runtime evidence is incomplete or belongs to another candidate.");
  }
  const file = (name) => {
    const records = manifest.files.filter((entry) => entry.name === name);
    if (records.length !== 1) throw new Error("Candidate artifact inventory is ambiguous.");
    return records[0];
  };
  const app = nsisAppPayload(compiledApp);
  const compiled = file("target/release/drifty.exe");
  if (app.compiledSha256 !== compiled.sha256 || app.bytes !== compiled.bytes) throw new Error("Compiled app does not match the candidate manifest.");
  const installer = file(manifest.installer);
  const tracker = manifest.trackerResources.filter((entry) => entry.name === "drifty-tracker.exe");
  if (tracker.length !== 1) throw new Error("Candidate tracker inventory is ambiguous.");
  const expected = { installer: installer.sha256, app: app.sha256,
    browserHost: file("target/release/drifty-browser-host.exe").sha256, tracker: tracker[0].sha256 };
  for (const [name, sha] of Object.entries(expected)) {
    const actual = name === "installer" ? evidence.installer?.actualSha256 : evidence[name]?.sha256;
    if (!/^[a-f0-9]{64}$/iu.test(sha ?? "") || typeof actual !== "string" || actual.toLowerCase() !== sha.toLowerCase()
      || evidence[name]?.authenticodeStatus !== "NotSigned") throw new Error(`Installed ${name} payload does not match this unsigned candidate.`);
  }
  return { state: "verified-internal-installed-payloads", publicationAllowed: false,
    sourceCommit: manifest.sourceCommit, attemptId: manifest.attemptId, expected, appBundlePatch: app };
}

export function parseCli(argv) {
  const options = {};
  const flags = new Map([["--repo", "repo"], ["--source-sha", "commit"], ["--candidate-dir", "candidate"],
    ["--python", "python"], ["--app-environment", "config"], ["--controller-utc", "controllerUtc"], ["--signing-profile", "signingProfile"],
    ["--signer-readiness", "signerReadiness"], ["--nsis-plugin-cache", "pluginCache"], ["--nsis-plugin-cache-sha256", "pluginCacheHash"],
    ["--prepared-frontend", "preparedFrontend"], ["--prepared-frontend-sha256", "preparedFrontendHash"]]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = flags.get(argv[i]);
    if (!key || !argv[i + 1] || options[key]) throw new Error("Provide each required builder argument exactly once.");
    options[key] = argv[i + 1];
  }
  for (const key of [...flags.values()].filter((key) => !["signingProfile", "signerReadiness", "pluginCache", "pluginCacheHash", "preparedFrontend", "preparedFrontendHash"].includes(key))) if (!options[key]) throw new Error(`Missing builder argument: ${key}.`);
  if (Boolean(options.preparedFrontend) !== Boolean(options.preparedFrontendHash)
    || (options.preparedFrontend && !/^[a-f0-9]{64}$/u.test(options.preparedFrontendHash))) throw new Error("Provide a prepared frontend and its pinned SHA-256 together.");
  if (Boolean(options.signingProfile) !== Boolean(options.signerReadiness)) throw new Error("Provide signing profile and fresh signer readiness together.");
  if (Boolean(options.pluginCache) !== Boolean(options.pluginCacheHash) || (options.pluginCache && (!options.signingProfile || !/^[a-f0-9]{64}$/u.test(options.pluginCacheHash)))) throw new Error("Provide a signed rehearsal with a pinned plugin cache together.");
  for (const key of ["repo", "candidate", "python", "config", ...(options.signingProfile ? ["signingProfile", "signerReadiness"] : []), ...(options.pluginCache ? ["pluginCache"] : []), ...(options.preparedFrontend ? ["preparedFrontend"] : [])]) {
    if (!path.isAbsolute(options[key])) throw new Error(`Builder ${key} must be an absolute path.`);
  }
  return options;
}

export function runRehearsal(options) {
  if (process.platform !== "win32") throw new Error("The builder rehearsal must run on Windows x64.");
  if (process.arch !== "x64") throw new Error("Expected a Windows x64 Node process.");
  assertControllerClock(options.controllerUtc);
  const repo = realpathSync(options.repo);
  const parent = realpathSync(path.dirname(options.candidate));
  const candidate = path.join(parent, path.basename(options.candidate));
  if (options.signingProfile) {
    assertSignerReadiness(JSON.parse(readFileSync(options.signerReadiness, "utf8").replace(/^\uFEFF/u, "")),
      { sourceCommit: options.commit.toLowerCase(), candidateId: path.basename(candidate) },
      JSON.parse(readFileSync(options.signingProfile, "utf8").replace(/^\uFEFF/u, "")));
  }
  const relation = path.relative(repo, candidate);
  if (!relation || (!relation.startsWith(`..${path.sep}`) && relation !== ".." && !path.isAbsolute(relation))) {
    throw new Error("Candidate outputs must be outside the source checkout.");
  }
  assertSourceIdentity(sourceState(repo), options.commit, repo);
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (existsSync(path.join(repo, "apps/desktop", name))) throw new Error("Use the explicit app environment; remove source-local env files from the isolated clone.");
  }
  const env = builderEnvironment(process.env, JSON.parse(readFileSync(options.config, "utf8").replace(/^\uFEFF/u, "")), {
    python: realpathSync(options.python), target: path.join(candidate, "target"), commit: options.commit.toLowerCase(),
  });
  const frontendExpected = options.preparedFrontend ? frontendSourceExpectation(repo, options.commit.toLowerCase(), env) : null;
  const frontend = frontendExpected ? verifyPreparedFrontend(options.preparedFrontend, options.preparedFrontendHash, frontendExpected) : null;
  const attemptId = randomUUID();
  if (!process.env.ProgramData) throw new Error("ProgramData is required for the host-wide builder lock.");
  const releaseLock = acquireBuilderLock(path.join(process.env.ProgramData, "DriftyWindowsBuilder"), {
    attemptId, pid: process.pid, host: os.hostname(), sourceCommit: options.commit, candidate, createdAtUtc: new Date().toISOString(),
  });
  let manifest;
  const start = performance.now();
  try {
    // Never replace an interrupted candidate. A retry gets a new directory.
    mkdirSync(candidate, { mode: 0o700 });
    manifest = { schemaVersion: 1, attemptId, mode: options.signingProfile ? "internal-signed-rehearsal" : "internal-unsigned-rehearsal", channel: "production", publicationAllowed: false,
      sourceCommit: options.commit.toLowerCase(), version: JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).version,
      host: os.hostname(), logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(),
      node: process.version, platform: process.platform, architecture: process.arch,
      runnerSha256: hashFile(process.argv[1]).sha256,
      artifactVerifierSha256: hashFile(new URL("./windows-build-artifacts.mjs", import.meta.url)).sha256,
      startedAtUtc: new Date().toISOString(), state: "running", rendererSourceMapsUploaded: Boolean(frontend),
      ...(frontend ? { preparedFrontend: { manifestSha256: frontend.manifestSha256, sourceFingerprint: frontend.manifest.sourceFingerprint,
        environmentFingerprint: frontend.manifest.environmentFingerprint, rendererMaps: frontend.manifest.rendererMaps } } : {}), phases: [] };
    atomicJson(path.join(candidate, "manifest.json"), manifest);
    manifest.toolchain = toolchain(env, options.python);
    atomicJson(path.join(candidate, "manifest.json"), manifest);
    const sourceHash = sourceFingerprint(repo);
    const profile = options.signingProfile ? JSON.parse(readFileSync(options.signingProfile, "utf8").replace(/^\uFEFF/u, "")) : null;
    const pluginCache = options.pluginCache ? readPluginCache(options.pluginCache, options.pluginCacheHash, manifest.sourceCommit, profile) : null;
    const signing = profile ? signingBuildSettings(repo, candidate, profile, env.SystemRoot ?? env.SYSTEMROOT, pluginCache) : null;
    const frontendConfig = frontend ? preparedFrontendTauriConfig(frontend, { node: process.execPath,
      verifier: fileURLToPath(new URL("./prepare-windows-frontend.mjs", import.meta.url)), repo,
      manifestFile: options.preparedFrontend, expected: frontendExpected }) : null;
    const buildConfig = (frontendConfig || signing) ? { ...signing?.config, ...frontendConfig } : null;
    phase(repo, candidate, "build", [path.join(repo, "scripts/run-tauri.mjs"), "build", "--production", "--bundles", "nsis",
      ...(buildConfig ? ["--config", JSON.stringify(buildConfig)] : [])], { ...env, ...signing?.env }, manifest);
    if (frontend) verifyPreparedFrontend(options.preparedFrontend, options.preparedFrontendHash, frontendExpected);
    assertSourceIdentity(sourceState(repo), options.commit, repo);
    if (sourceHash !== sourceFingerprint(repo)) throw new Error("Tracked source bytes changed during the rehearsal.");
    Object.assign(manifest, collectArtifacts(candidate), { sourceFingerprint: sourceHash });
    manifest.trackerResources = resourceFiles(path.join(repo, "src-tauri/binaries/drifty-tracker-x86_64-pc-windows-msvc"));
    if (signing) manifest.signing = collectSigningEvidence(candidate, manifest, signing.signing, signing.pluginCache);
    else manifest.expectedInstalledApp = nsisAppPayload(containedPath(candidate, "target/release/drifty.exe"));
    atomicJson(path.join(candidate, "manifest.json"), manifest);
    const signatures = JSON.parse(powershell(`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';
      $manifest=Get-Content -LiteralPath (Join-Path $env:DRIFTY_REHEARSAL_CANDIDATE 'manifest.json') -Raw|ConvertFrom-Json;
      @($manifest.files|Where-Object {$_.name -like '*.exe'}|ForEach-Object {
        @{name=$_.name;status=[string](Get-AuthenticodeSignature -LiteralPath (Join-Path $env:DRIFTY_REHEARSAL_CANDIDATE $_.name)).Status}
      })|ConvertTo-Json`, { ...env, DRIFTY_REHEARSAL_CANDIDATE: candidate }));
    if (!Array.isArray(signatures) || signatures.length !== 3 || signatures.some((entry) =>
      entry.status !== (signing && !entry.name.endsWith("/drifty.exe") ? "Valid" : "NotSigned"))) {
      throw new Error("Rehearsal output has an unexpected Authenticode status.");
    }
    manifest.authenticode = signatures;
    phase(repo, candidate, "browser-host-smoke", [path.join(repo, "scripts/qa/windows-browser-host-smoke.py"),
      "--host", containedPath(candidate, "target/release/drifty-browser-host.exe")], env, manifest, options.python);
    manifest.state = "complete";
    return manifest;
  } catch (error) {
    if (manifest) { manifest.state = "failed"; manifest.error = error.message; }
    throw error;
  } finally {
    try {
      if (manifest) {
        manifest.endedAtUtc = new Date().toISOString();
        manifest.elapsedSeconds = (performance.now() - start) / 1000;
        atomicJson(path.join(candidate, "manifest.json"), manifest);
      }
    } finally { releaseLock(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "verify-installed") {
      if (process.argv.length !== 6) throw new Error("Usage: windows-builder-rehearsal.mjs verify-installed <manifest.json> <runtime.json> <compiled-app.exe>");
      const json = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
      const manifest = json(process.argv[3]);
      console.log(JSON.stringify(manifest.mode === "internal-signed-rehearsal"
        ? verifySignedInstalledPayloads(manifest, json(process.argv[4]))
        : verifyInstalledPayloads(manifest, json(process.argv[4]), process.argv[5])));
    } else {
      const manifest = runRehearsal(parseCli(process.argv.slice(2)));
      console.log(`Internal builder rehearsal complete: ${manifest.elapsedSeconds.toFixed(1)}s`);
    }
  }
  catch (error) { console.error(`windows-builder-rehearsal: ${error.message}`); process.exitCode = 1; }
}
