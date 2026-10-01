#!/usr/bin/env node
// Controller-side orchestration. Host credentials stay behind a pinned private
// adapter; every collected stage is independently checked before advancing.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { authenticodePayload, containedPath, hashFile, nsisAppPayload, verifyPePdb } from "./windows-build-artifacts.mjs";
import { acquireBuilderLock, assertSourceIdentity, frontendSourceExpectation, sourceState } from "./windows-builder-rehearsal.mjs";
import { verifyInternalUseBasis, verifyTrackerInputs } from "./windows-cross-build-rehearsal.mjs";
import { WINDOWS_APP_KEYS, verifyPreparedFrontend } from "./windows-frontend-artifacts.mjs";
import { trackerAuthenticodeOptions, validateAuthenticodeDetails } from "./qa/windows-packaged-runtime.mjs";
import { readPluginCache, verifySignedInstalledPayloads } from "./windows-signing-rehearsal.mjs";
import { assertProcessedNativeUpload, inspectFinalizationArtifacts } from "./windows-rehearsal-finalization.mjs";
import { verifyTauriUpdaterSignature } from "./windows-updater-signature.mjs";
import { WINDOWS_NATIVE_SENTRY_PROJECT } from "./upload-windows-debug-files.mjs";

const HASH = /^[a-f0-9]{64}$/u;
const read = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const check = (value, message) => { if (!value) throw new Error(message); };
const digest = (value) => createHash("sha256").update(value).digest("hex");
const executableNames = ["drifty.exe", "drifty.pdb", "drifty-browser-host.exe", "drifty_browser_host.pdb"];

export function pipelineOperationId(sourceCommit, candidateId, stage) {
  check(/^[a-f0-9]{40}$/u.test(sourceCommit) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(candidateId)
    && ["compile", "bundle", "runtime", "updater", "native-debug"].includes(stage), "Invalid pipeline operation identity.");
  // Host descriptors can be pinned before hashing the controller configuration.
  // Including that configuration hash here would make these pins circular.
  return digest(`${sourceCommit}\0${candidateId}\0${stage}`).slice(0, 32);
}

function controllerFingerprint() {
  const names = ["windows-release-pipeline.mjs", "run-tauri.mjs", "windows-build-artifacts.mjs", "windows-builder-rehearsal.mjs",
    "windows-cross-build-rehearsal.mjs", "windows-frontend-artifacts.mjs", "windows-signing-rehearsal.mjs",
    "windows-rehearsal-finalization.mjs", "windows-updater-signature.mjs", "upload-windows-debug-files.mjs", "qa/windows-packaged-runtime.mjs",
    "windows-bundle-signing-resume.ps1", "windows-release-host-adapter.mjs", "windows-release-host-job.mjs", "prepare-windows-tracker.mjs"];
  return digest(JSON.stringify(names.map((name) => ({ name, ...hashFile(new URL(name, import.meta.url)) }))));
}

export function verifySigningRecords(root, manifest, signer) {
  const signing = manifest.signing, records = signing?.records;
  check(signing?.profile?.certificateThumbprint === signer.thumbprint.toUpperCase() && Array.isArray(records) && records.length === 10
    && new Set(records.map((r) => r.requestId)).size === 10, "Original signing sequence or signer differs.");
  const cache = signing.pluginCache ? readPluginCache(containedPath(root, "signing-cache"), signing.pluginCache.manifestSha256,
    manifest.sourceCommit, signing.profile) : null;
  const plugins = ["NSISdl.dll", "StartMenu.dll", "System.dll", "nsDialogs.dll", "nsis_tauri_utils.dll"];
  for (const name of [...plugins, "drifty.exe", "drifty-browser-host.exe", "drifty-tracker.exe", `drifty_${manifest.version}_x64-setup.exe`]) {
    check(records.filter((r) => r.artifactName === name).length === 1, "Missing or duplicate original signing role.");
  }
  check(records.filter((r) => /^[A-Za-z0-9]+\.tmp$/u.test(r.artifactName)).length === 1, "Missing original NSIS uninstaller hook.");
  for (const r of records) {
    check(/^[a-f0-9]{32}$/u.test(r.requestId) && HASH.test(r.unsignedSha256) && HASH.test(r.signedSha256)
      && r.completion === `handoff/completed/${r.requestId}--${r.artifactName}.completed.json`, "Invalid original hook record.");
    const completion = read(containedPath(root, r.completion));
    check(completion.schemaVersion === 1 && completion.requestId === r.requestId && completion.artifactPath === r.artifactPath
      && completion.unsignedSha256?.toLowerCase() === r.unsignedSha256 && completion.signedSha256?.toLowerCase() === r.signedSha256
      && completion.signerThumbprint === signer.thumbprint.toUpperCase() && /^[a-f0-9]{40}$/iu.test(completion.timestampThumbprint ?? ""), "Original completion differs.");
    if (r.signedCacheHit === true) {
      const seed = cache?.records.find((f) => f.artifactName === r.artifactName && f.unsignedSha256 === r.unsignedSha256);
      check(seed && completion.signedCacheHit === true && plugins.includes(r.artifactName)
        && r.response === `signing-cache/${seed.file}` && r.cacheSourceRequestId === seed.sourceRequestId
        && completion.timestampThumbprint === seed.timestampThumbprint && r.signedSha256 === seed.signedSha256, "Plugin reuse differs from its original proof.");
    } else {
      const name = `${r.requestId}--${r.artifactName}`, request = read(containedPath(root, `handoff/requests/${name}.request.json`));
      const unsigned = hashFile(containedPath(root, `handoff/requests/${name}`));
      check(completion.signedCacheHit === false && request.schemaVersion === 1 && request.requestId === r.requestId
        && request.artifactName === r.artifactName && request.expectedSignerThumbprint === signer.thumbprint.toUpperCase()
        && request.expectedPublisherName === signing.profile.publisherName && request.unsignedSha256?.toLowerCase() === r.unsignedSha256
        && request.unsignedLength === unsigned.bytes && unsigned.sha256 === r.unsignedSha256 && r.response === `handoff/responses/${name}`, "Original signing request differs.");
    }
    const signed = hashFile(containedPath(root, r.response));
    check(signed.sha256 === r.signedSha256 && signed.bytes === r.signedBytes, "Original signing response bytes changed.");
  }
  check(records.filter((r) => r.signedCacheHit).length === (cache ? 5 : 0), "Plugin signing accounting differs.");
  return records;
}

export function pipelineEnvironment(base) {
  return Object.fromEntries(Object.entries(base).filter(([key]) => /^(?:PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|USERPROFILE|APPDATA|LOCALAPPDATA|PATHEXT|COMSPEC|SYSTEMDRIVE)$/iu.test(key)));
}

export function pipelineConfig(file, expectedHash) {
  check(path.isAbsolute(file) && HASH.test(expectedHash ?? "") && !lstatSync(file).isSymbolicLink()
    && hashFile(file).sha256 === expectedHash, "Pin the private builder configuration.");
  const c = read(file);
  const allowed = new Set(["schemaVersion", "mode", "sourceRepo", "sourceCommit", "candidateId", "output", "appEnvironment",
    "appEnvironmentSha256", "useBasis", "useBasisSha256", "adapterScript", "adapterSha256", "adapterCommand", "finish", "signer", "timeoutSeconds"]);
  check(c.schemaVersion === 1 && c.mode === "internal-linux-cross-release" && Object.keys(c).every((k) => allowed.has(k))
    && /^[a-f0-9]{40}$/u.test(c.sourceCommit ?? "") && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(c.candidateId ?? "")
    && ["runtime", "signed-finalization"].includes(c.finish), "Unsupported distributed builder mode or binding.");
  for (const key of ["sourceRepo", "output", "appEnvironment", "useBasis", "adapterScript"]) check(path.isAbsolute(c[key] ?? ""), `Builder ${key} must be absolute.`);
  for (const [name, hash] of [["appEnvironment", "appEnvironmentSha256"], ["adapterScript", "adapterSha256"]]) {
    check(HASH.test(c[hash] ?? "") && !lstatSync(c[name]).isSymbolicLink() && hashFile(c[name]).sha256 === c[hash], `Pinned ${name} changed.`);
  }
  const settings = read(c.appEnvironment);
  check(settings && !Array.isArray(settings) && Object.entries(settings).every(([key, value]) => WINDOWS_APP_KEYS.includes(key)
    && typeof value === "string" && !value.includes("\0")), "Only explicit public app settings may enter the pipeline.");
  check(Array.isArray(c.adapterCommand) && c.adapterCommand.length >= 2 && path.isAbsolute(c.adapterCommand[0])
    && c.adapterCommand.includes(c.adapterScript) && c.adapterCommand.every((a) => typeof a === "string" && !/[\r\n\0]/u.test(a)), "Invalid private stage adapter.");
  check(Number.isInteger(c.timeoutSeconds ?? 14400) && (c.timeoutSeconds ?? 14400) >= 60 && (c.timeoutSeconds ?? 14400) <= 14400, "Invalid pipeline deadline.");
  check(/^[a-f0-9]{40}$/iu.test(c.signer?.thumbprint ?? "") && typeof c.signer.subject === "string" && c.signer.subject.trim()
    && c.signer.subject.length <= 256 && !/[\r\n\0]/u.test(c.signer.subject), "Pin the expected signer identity, including the reused tracker.");
  let parent = c.output;
  while (!existsSync(parent)) parent = path.dirname(parent);
  const canonicalOutput = path.resolve(realpathSync(parent), path.relative(parent, c.output));
  const relation = path.relative(realpathSync(c.sourceRepo), canonicalOutput);
  check(relation && (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)), "Keep pipeline outputs outside the source checkout.");
  assertSourceIdentity(sourceState(c.sourceRepo), c.sourceCommit, c.sourceRepo);
  verifyInternalUseBasis(c.useBasis, c.useBasisSha256, c.sourceCommit);
  return c;
}

function inventory(root, prefix = "") {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    check(!entry.isSymbolicLink() && !/[\\:\x00-\x1f]/u.test(entry.name), "Linked or unsafe stage artifact.");
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return inventory(root, name);
    check(entry.isFile(), "Stage artifacts must be regular files.");
    return [name];
  }).sort();
}

export function verifyStageReceipt(root, expectedHash, binding) {
  check(!lstatSync(root).isSymbolicLink() && lstatSync(root).isDirectory(), "Linked stage directory.");
  check(HASH.test(expectedHash ?? "") && hashFile(containedPath(root, "receipt.json")).sha256 === expectedHash, "Stage receipt changed.");
  const receipt = read(path.join(root, "receipt.json"));
  check(receipt.schemaVersion === 1 && receipt.publicationAllowed === false, "Stage receipt cannot grant publication.");
  for (const [key, value] of Object.entries(binding)) check(receipt[key] === value, `Stage receipt binding differs: ${key}.`);
  check(Array.isArray(receipt.files) && receipt.files.length > 0 && receipt.files.length <= 20_000
    && new Set(receipt.files.map((f) => f.name)).size === receipt.files.length, "Ambiguous stage inventory.");
  check(JSON.stringify(inventory(root)) === JSON.stringify(["receipt.json", ...receipt.files.map((f) => f.name)].sort()), "Unrecorded stage files.");
  for (const f of receipt.files) {
    check(HASH.test(f.sha256 ?? "") && Number.isSafeInteger(f.bytes) && f.bytes >= 0, "Invalid stage file pin.");
    const actual = hashFile(containedPath(root, f.name), { allowEmpty: true });
    check(actual.sha256 === f.sha256 && actual.bytes === f.bytes, `Stage bytes changed: ${f.name}.`);
  }
  return receipt;
}

export function verifyCompileStage(root, c) {
  const manifestFile = containedPath(root, "cross-manifest.json"), m = read(manifestFile);
  check(m.state === "complete" && m.mode === "internal-linux-cross-build" && m.publicationAllowed === false
    && m.sourceCommit === c.sourceCommit && m.channel === "production" && m.target === "x86_64-pc-windows-msvc", "Cross compile identity differs.");
  const basis = verifyInternalUseBasis(c.useBasis, c.useBasisSha256, c.sourceCommit);
  check(m.sdkUseBasis.manifestSha256 === basis.manifestSha256 && m.sdkUseBasis.expiresAtUtc === basis.expiresAtUtc, "Compile SDK use basis differs.");
  const expected = frontendSourceExpectation(c.sourceRepo, c.sourceCommit, read(c.appEnvironment));
  check(m.version === expected.version, "Compiled version differs from the source.");
  verifyPreparedFrontend(containedPath(root, "frontend/manifest.json"), m.frontend.manifestSha256, expected);
  verifyTrackerInputs(containedPath(root, "tracker"), containedPath(root, "tracker-manifest.json"), m.tracker.manifestSha256, c.sourceCommit);
  const features = m.compiler?.productionTauriFeatures;
  check(Array.isArray(features) && features.length > 0, "Missing compiled Tauri feature proof.");
  for (const f of features) {
    check(/^tauri-[a-f0-9]+\/lib-tauri\.json$/u.test(f.name) && Array.isArray(f.features) && f.features.includes("custom-protocol"), "Compiled Tauri production feature disabled.");
    const file = containedPath(root, `compiler-features/${f.name}`);
    check(hashFile(file).sha256 === f.sha256 && JSON.stringify(JSON.parse(read(file).features)) === JSON.stringify(f.features), "Compiled Tauri fingerprint differs.");
  }
  check(Array.isArray(m.files) && m.files.length === 4 && new Set(m.files.map((f) => path.posix.basename(f.name))).size === 4, "Cross output inventory differs.");
  for (const name of executableNames) {
    const f = m.files.find((v) => v.name === `target/x86_64-pc-windows-msvc/release/${name}`);
    const actual = hashFile(containedPath(root, `output/${name}`));
    check(f && f.sha256 === actual.sha256 && f.bytes === actual.bytes, "Cross executable/PDB changed.");
  }
  const pairs = [verifyPePdb(path.join(root, "output/drifty.exe"), path.join(root, "output/drifty.pdb")),
    verifyPePdb(path.join(root, "output/drifty-browser-host.exe"), path.join(root, "output/drifty_browser_host.pdb"))];
  check(pairs.every((p, i) => p.guid === m.pairs[i].guid && p.age === m.pairs[i].age), "Cross debug identity differs.");
  check(JSON.stringify(nsisAppPayload(path.join(root, "output/drifty.exe"))) === JSON.stringify(m.expectedUnsignedInstalledApp), "Cross NSIS app marker proof differs.");
  return { root, manifest: m, sha256: hashFile(manifestFile).sha256, pairs };
}

export function verifyTrackerSigningTransform(original, unsigned, transform) {
  const input = hashFile(original), request = hashFile(unsigned);
  check(transform?.unsigned?.sha256 === request.sha256 && transform.unsigned.bytes === request.bytes,
    "Tracker unsigned request differs from its transform proof.");
  if (transform.mode === "unsigned-native-copy") {
    check(!transform.originalSigned && !transform.signTool && transform.originalUnsigned?.sha256 === input.sha256
      && transform.originalUnsigned.bytes === input.bytes && input.sha256 === request.sha256 && input.bytes === request.bytes,
    "Native unsigned tracker must remain an exact copy.");
    authenticodePayload(original, false); authenticodePayload(unsigned, false);
  } else {
    check(transform.mode === "signature-removal-on-fresh-copy" && !transform.originalUnsigned
      && transform.originalSigned?.sha256 === input.sha256 && transform.originalSigned.bytes === input.bytes
      && authenticodePayload(original, true).equals(authenticodePayload(unsigned, false)),
    "Tracker signature removal changed the original payload.");
  }
}

export function verifyBundleStage(root, c, compile) {
  const signed = c.finish === "signed-finalization", file = containedPath(root, signed ? "manifest.json" : "bundle-manifest.json"), m = read(file);
  check(m.state === "complete" && m.publicationAllowed === false && m.sourceCommit === c.sourceCommit
    && m.crossManifestSha256 === compile.sha256, "Bundle does not belong to these cross outputs.");
  const installerName = `drifty_${compile.manifest.version}_x64-setup.exe`, installer = containedPath(root, installerName);
  let installerHash;
  if (!signed) {
    check(m.mode === "internal-cross-bundle-only" && m.noRustBuildCommand === true && m.installer.authenticodeStatus === "NotSigned"
      && JSON.stringify(m.expectedUnsignedInstalledApp) === JSON.stringify(compile.manifest.expectedUnsignedInstalledApp), "Unsigned bundle policy differs.");
    installerHash = m.installer.sha256;
  } else {
    check(m.mode === "internal-signed-rehearsal" && m.platform === "win32" && m.architecture === "x64" && m.version === compile.manifest.version
      && m.signing?.records?.length === 10, "Signed cross packaging lacks original signing hooks.");
    verifySigningRecords(root, m, c.signer);
    const names = [...executableNames, installerName];
    check(Array.isArray(m.files) && m.files.length === 5 && new Set(m.files.map((f) => f.name)).size === 5, "Signed bundle inventory differs.");
    for (const name of names) {
      const relative = name === installerName ? `target/release/bundle/nsis/${name}` : `target/release/${name}`;
      const record = m.files.find((f) => f.name === relative), actual = hashFile(containedPath(root, name));
      check(record && actual.sha256 === record.sha256 && actual.bytes === record.bytes, "Signed bundle artifact changed.");
    }
    for (const name of ["drifty.exe", "drifty.pdb", "drifty_browser_host.pdb"]) {
      const cross = compile.manifest.files.find((f) => path.posix.basename(f.name) === name);
      check(hashFile(containedPath(root, name)).sha256 === cross.sha256, "Bundle rebuilt or changed compiled outputs.");
    }
    const app = m.signing.records.find((r) => r.response === m.signing.signedAppResponse);
    const browser = m.signing.records.filter((r) => r.artifactPath.replaceAll("\\", "/").endsWith("/target/release/drifty-browser-host.exe"));
    check(app?.unsignedSha256 === compile.manifest.expectedUnsignedInstalledApp.sha256 && browser.length === 1
      && browser[0].unsignedSha256 === compile.manifest.files.find((f) => f.name.endsWith("/drifty-browser-host.exe")).sha256, "Signing hooks used different cross inputs.");
    check(hashFile(containedPath(root, "signed-drifty.exe")).sha256 === app.signedSha256
      && app.signedSha256 === m.signing.expectedInstalledHashes.app
      && hashFile(containedPath(root, "drifty-browser-host.exe")).sha256 === browser[0].signedSha256
      && browser[0].signedSha256 === m.signing.expectedInstalledHashes.browserHost, "Signed payload differs from its original hook.");
    verifyPePdb(containedPath(root, "signed-drifty.exe"), containedPath(root, "drifty.pdb"));
    verifyPePdb(containedPath(root, "drifty-browser-host.exe"), containedPath(root, "drifty_browser_host.pdb"));
    const tracker = m.signing.records.find((r) => r.artifactName === "drifty-tracker.exe");
    const original = containedPath(compile.root, "tracker/drifty-tracker.exe"), unsigned = containedPath(root, `handoff/requests/${tracker.requestId}--drifty-tracker.exe`);
    verifyTrackerSigningTransform(original, unsigned, m.trackerInputTransform);
    check(hashFile(containedPath(root, "signed-drifty-tracker.exe")).sha256 === tracker.signedSha256
      && tracker.signedSha256 === m.signing.expectedInstalledHashes.tracker, "Tracker signing changed the original payload.");
    installerHash = m.signing.expectedInstalledHashes.installer;
  }
  check(hashFile(installer).sha256 === installerHash, "Bundled installer changed.");
  return { manifest: m, sha256: hashFile(file).sha256, installer, installerHash };
}

export function verifyRuntimeStage(root, c, compile, bundle) {
  const file = containedPath(root, "runtime.json"), r = read(file), admission = read(containedPath(root, "qa-admission.json"));
  check(r.passed === true && r.app?.buildCommit === c.sourceCommit && r.app?.version === compile.manifest.version
    && admission.standardUser === true && admission.explorerReady === true && admission.builderPythonReadDenied === true
    && r.cleanup?.credentialBaselineRestored === true && r.cleanup.appStopped === true
    && r.cleanup.debugPortClosed === true && r.cleanup.managedAiPortClosed === true
    && Array.isArray(r.cleanup.residualProductProcessIds) && r.cleanup.residualProductProcessIds.length === 0, "Exact standard-user runtime or cleanup is incomplete.");
  const signed = c.finish === "signed-finalization";
  const expected = signed ? verifySignedInstalledPayloads(bundle.manifest, r).expected : {
    installer: bundle.installerHash, app: compile.manifest.expectedUnsignedInstalledApp.sha256,
    browserHost: compile.manifest.files.find((f) => f.name.endsWith("/drifty-browser-host.exe")).sha256,
    tracker: compile.manifest.tracker.files.find((f) => f.name === "drifty-tracker.exe").sha256,
  };
  const policy = { expectedAuthenticodeStatus: signed ? "Valid" : "NotSigned", expectedSignerThumbprint: c.signer.thumbprint.toUpperCase(),
    expectedPublisherSubject: c.signer.subject, ...(signed ? {} : { expectedTrackerAuthenticodeStatus: "Valid" }) };
  for (const name of ["installer", "app", "browserHost", "tracker"]) {
    const actual = name === "installer" ? r.installer.actualSha256 : r[name]?.sha256;
    check(actual?.toLowerCase() === expected[name], `Installed ${name} differs from this candidate.`);
    validateAuthenticodeDetails(r[name].authenticode, name === "tracker" ? trackerAuthenticodeOptions(policy) : policy, name);
  }
  return { runtime: r, sha256: hashFile(file).sha256 };
}

function verifyStage(stage, root, c, proofs) {
  if (stage === "compile") return verifyCompileStage(root, c);
  if (stage === "bundle") return verifyBundleStage(root, c, proofs.compile);
  if (stage === "runtime") return verifyRuntimeStage(root, c, proofs.compile, proofs.bundle);
  const binding = read(containedPath(root, "binding.json"));
  check(binding.bundleManifestSha256 === proofs.bundle.sha256 && binding.runtimeSha256 === proofs.runtime.sha256
    && binding.sourceCommit === c.sourceCommit, "Finalization belongs to another candidate.");
  if (stage === "updater") {
    const installer = containedPath(root, path.basename(proofs.bundle.installer));
    check(hashFile(installer).sha256 === proofs.bundle.installerHash, "Updater signed different installer bytes.");
    const source = read(containedPath(c.sourceRepo, "src-tauri/tauri.conf.json"));
    return verifyTauriUpdaterSignature(readFileSync(installer), readFileSync(containedPath(root, `${path.basename(installer)}.sig`), "utf8"), source.plugins?.updater?.pubkey);
  }
  const proof = inspectFinalizationArtifacts({ artifactDirectory: root, manifestSha256: proofs.bundle.sha256,
    runtimeSha256: proofs.runtime.sha256, sourceCommit: c.sourceCommit });
  const upload = read(containedPath(root, "native-upload.json"));
  check(upload.processed === true && upload.exitCode === 0 && upload.sourceCommit === c.sourceCommit
    && upload.manifestSha256 === proofs.bundle.sha256 && upload.runtimeSha256 === proofs.runtime.sha256
    && upload.org === "edgethink" && upload.project === WINDOWS_NATIVE_SENTRY_PROJECT
    && JSON.stringify(upload.pairs) === JSON.stringify(proof.pairs), "Native debug processing receipt differs.");
  for (const stream of ["stdout", "stderr"]) check(hashFile(containedPath(root, `native-upload.${stream}.log`), { allowEmpty: true }).sha256 === upload[stream].sha256, "Native upload log changed.");
  assertProcessedNativeUpload(["stdout", "stderr"].map((s) => readFileSync(path.join(root, `native-upload.${s}.log`), "utf8")).join("\n"));
  check(JSON.stringify(upload.files) === JSON.stringify(proof.nativeFiles.map((f) => ({ name: path.basename(f), ...hashFile(f) }))), "Native upload files differ.");
  return { processed: true, pairs: proof.pairs };
}

function atomic(file, value) {
  const pending = `${file}.${randomUUID()}.pending`;
  writeFileSync(pending, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" }); renameSync(pending, file);
}

export function advancePipelineStage(entry, observe, start, persist) {
  const snapshot = observe();
  check(["missing", "running", "complete", "failed"].includes(snapshot.state), "Unknown remote stage state; inspect before retry.");
  if (snapshot.state === "failed") throw new Error("Remote stage failed; preserve its original evidence.");
  if (snapshot.state !== "missing") return snapshot;
  check(!entry.startIntentRecorded, "Stage start was already submitted without a remote receipt; inspect the original operation before retry.");
  entry.startIntentRecorded = true; persist();
  const launched = start();
  check(["running", "complete"].includes(launched.state), "Stage start did not produce an observable owner.");
  return launched;
}

export function runPipeline(configFile, configSha256, { execute, now = Date.now } = {}) {
  const c = pipelineConfig(configFile, configSha256);
  mkdirSync(c.output, { recursive: true, mode: 0o700 });
  const file = path.join(c.output, "workflow.json"), controllerSha256 = controllerFingerprint();
  const release = acquireBuilderLock(path.join(c.output, "controller-lock"), { attemptId: randomUUID(), pid: process.pid });
  const binding = { configSha256, controllerSha256, sourceCommit: c.sourceCommit, candidateId: c.candidateId };
  let journal;
  const persist = () => { journal.updatedAtUtc = new Date().toISOString(); atomic(file, journal); };
  try {
    const saved = existsSync(file) ? read(file) : { schemaVersion: 1, binding, publicationAllowed: false, state: "running", stages: {} };
    check(saved.schemaVersion === 1 && saved.publicationAllowed === false && saved.stages && !Array.isArray(saved.stages)
      && JSON.stringify(saved.binding) === JSON.stringify(binding), "Pipeline configuration/controller changed; preserve the existing journal.");
    journal = saved;
    const adapter = execute ?? ((request) => {
      check(hashFile(c.adapterScript).sha256 === c.adapterSha256, "Stage adapter changed during execution.");
      const p = spawnSync(c.adapterCommand[0], c.adapterCommand.slice(1), { input: JSON.stringify(request) + "\n", encoding: "utf8",
        env: pipelineEnvironment(process.env), timeout: 60_000, maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
      if (p.error || p.status !== 0) throw new Error("Private stage adapter failed; inspect its task record without replaying the start.");
      return JSON.parse(p.stdout);
    });
    const stages = ["compile", "bundle", "runtime", ...(c.finish === "signed-finalization" ? ["updater", "native-debug"] : [])];
    const deadline = now() + (c.timeoutSeconds ?? 14400) * 1000, proofs = {};
    for (const stage of stages) {
      check(hashFile(configFile).sha256 === configSha256 && hashFile(c.appEnvironment).sha256 === c.appEnvironmentSha256
        && hashFile(c.adapterScript).sha256 === c.adapterSha256, "Pipeline inputs changed during execution.");
      verifyInternalUseBasis(c.useBasis, c.useBasisSha256, c.sourceCommit);
      assertSourceIdentity(sourceState(c.sourceRepo), c.sourceCommit, c.sourceRepo);
      const operationId = pipelineOperationId(c.sourceCommit, c.candidateId, stage);
      const stageBinding = { sourceCommit: c.sourceCommit, candidateId: c.candidateId, stage, operationId };
      const entry = journal.stages[stage] ??= { ...stageBinding, state: "observed" }; persist();
      const root = path.join(c.output, "artifacts", stage);
      if (!entry.receiptSha256) {
        while (now() < deadline) {
          const invoke = (action) => {
            const result = adapter({ action, ...stageBinding, output: c.output });
            for (const [key, value] of Object.entries(stageBinding)) check(result[key] === value, `Adapter stage identity differs: ${key}.`);
            return result;
          };
          const snapshot = advancePipelineStage(entry, () => invoke("observe"), () => invoke("start"), persist);
          if (snapshot.state === "complete") { entry.receiptSha256 = snapshot.receiptSha256; break; }
          entry.state = "running"; persist();
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
        }
        check(entry.receiptSha256, "Pipeline deadline exceeded; resume the same journal and observe its owners.");
      }
      verifyStageReceipt(root, entry.receiptSha256, stageBinding);
      proofs[stage] = verifyStage(stage, root, c, proofs);
      entry.state = "verified"; persist();
      console.log(JSON.stringify({ stage, state: "verified", publicationAllowed: false }));
    }
    journal.state = "complete"; journal.finish = c.finish; journal.lastError = null; persist();
    return journal;
  } catch (e) { if (journal) { journal.state = "needs-attention"; journal.lastError = e.message; persist(); } throw e; }
  finally { release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(process.argv.length === 4, "Usage: windows-release-pipeline.mjs <absolute-private-config.json> <config-sha256>");
    runPipeline(process.argv[2], process.argv[3]);
  } catch (e) { console.error(`windows-release-pipeline: ${e.message}`); process.exitCode = 1; }
}
