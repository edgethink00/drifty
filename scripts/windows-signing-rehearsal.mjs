// Authenticode rehearsal only: updater keys, upload tokens and publication
// remain on the release finalizer. The existing signing hook is unchanged.
import { constants, copyFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { containedPath, hashFile, nsisAppPayload, verifyPePdb } from "./windows-build-artifacts.mjs";

const HASH = /^[a-f0-9]{64}$/iu;
const THUMB = /^[a-f0-9]{40}$/iu;
const PLUGINS = ["NSISdl.dll", "StartMenu.dll", "System.dll", "nsDialogs.dll", "nsis_tauri_utils.dll"];
const json = (file) => JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));

export function createPluginCache(candidate, expectedManifestHash, output) {
  if (!path.isAbsolute(candidate) || !path.isAbsolute(output) || !HASH.test(expectedManifestHash ?? "")) throw new Error("Plugin cache requires absolute paths and a pinned source manifest.");
  const manifestFile = containedPath(candidate, "manifest.json");
  if (hashFile(manifestFile).sha256 !== expectedManifestHash) throw new Error("Plugin cache source manifest hash mismatch.");
  const manifest = json(manifestFile);
  if (manifest.state !== "complete" || manifest.mode !== "internal-signed-rehearsal" || manifest.publicationAllowed !== false
    || manifest.signing?.pluginCache) throw new Error("Plugin cache must come from a complete fresh signed rehearsal.");
  const evidence = collectSigningEvidence(candidate, manifest, manifest.signing?.profile);
  const records = PLUGINS.map((artifactName) => {
    const matches = evidence.records.filter((record) => record.artifactName === artifactName);
    if (matches.length !== 1) throw new Error("Plugin cache source is ambiguous.");
    const record = matches[0], completion = json(containedPath(candidate, record.completion));
    return { artifactName, file: `${record.unsignedSha256}.signed`, unsignedSha256: record.unsignedSha256,
      unsignedBytes: hashFile(containedPath(candidate, `handoff/requests/${record.requestId}--${artifactName}`)).bytes,
      signedSha256: record.signedSha256, signedBytes: record.signedBytes,
      sourceRequestId: record.requestId, timestampThumbprint: completion.timestampThumbprint, response: record.response };
  });
  if (new Set(records.map((record) => record.file)).size !== 5) throw new Error("Plugin cache inputs must be distinct.");
  mkdirSync(output, { mode: 0o700 });
  for (const record of records) copyFileSync(containedPath(candidate, record.response), path.join(output, record.file), constants.COPYFILE_EXCL);
  const profile = signingProfile(manifest.signing.profile);
  const cache = { schemaVersion: 1, purpose: "nsis-plugin-signature-cache", sourceCommit: manifest.sourceCommit,
    sourceCandidateId: path.basename(candidate), sourceManifestSha256: expectedManifestHash,
    certificateThumbprint: profile.certificateThumbprint, publisherName: profile.publisherName,
    records: records.map(({ response, ...record }) => record) };
  writeFileSync(path.join(output, "manifest.json"), JSON.stringify(cache, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { manifestSha256: hashFile(path.join(output, "manifest.json")).sha256, entries: records.length };
}

export function readPluginCache(root, expectedHash, sourceCommit, profile) {
  if (!path.isAbsolute(root ?? "") || !HASH.test(expectedHash ?? "")) throw new Error("Plugin cache requires an absolute root and pinned manifest hash.");
  const file = containedPath(root, "manifest.json"), expected = signingProfile(profile);
  if (hashFile(file).sha256 !== expectedHash) throw new Error("Plugin cache manifest hash mismatch.");
  const cache = json(file);
  if (cache.schemaVersion !== 1 || cache.purpose !== "nsis-plugin-signature-cache" || cache.sourceCommit !== sourceCommit
    || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/iu.test(cache.sourceCommit ?? "") || !HASH.test(cache.sourceManifestSha256 ?? "")
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(cache.sourceCandidateId ?? "")
    || cache.certificateThumbprint !== expected.certificateThumbprint || cache.publisherName !== expected.publisherName
    || !Array.isArray(cache.records) || cache.records.length !== 5 || new Set(cache.records.map((entry) => entry.artifactName)).size !== 5) {
    throw new Error("Plugin cache source or signer binding mismatch.");
  }
  const names = new Set(["manifest.json"]);
  for (const record of cache.records) {
    if (!PLUGINS.includes(record.artifactName) || !HASH.test(record.unsignedSha256 ?? "") || !HASH.test(record.signedSha256 ?? "")
      || !THUMB.test(record.timestampThumbprint ?? "") || !/^[a-f0-9]{32}$/u.test(record.sourceRequestId ?? "")
      || record.file !== `${record.unsignedSha256}.signed` || !Number.isSafeInteger(record.unsignedBytes) || record.unsignedBytes <= 0
      || !Number.isSafeInteger(record.signedBytes) || record.signedBytes <= record.unsignedBytes || names.has(record.file)) {
      throw new Error("Invalid approved plugin cache entry.");
    }
    const signed = hashFile(containedPath(root, record.file));
    if (signed.sha256 !== record.signedSha256 || signed.bytes !== record.signedBytes) throw new Error("Plugin cache bytes changed.");
    names.add(record.file);
  }
  if (readdirSync(root).length !== names.size || readdirSync(root).some((name) => !names.has(name))) throw new Error("Plugin cache contains unapproved files.");
  return { ...cache, manifestSha256: expectedHash, root };
}

export function assertSignerReadiness(receipt, { sourceCommit, candidateId }, profile, now = Date.now()) {
  const expected = signingProfile(profile);
  const created = Date.parse(receipt?.createdAtUtc);
  if (receipt?.schemaVersion !== 1 || receipt.state !== "ready" || receipt.uploadReady !== true || receipt.otpReady !== true
    || receipt.sourceCommit !== sourceCommit || receipt.candidateId !== candidateId
    || receipt.expectedSignerThumbprint !== expected.certificateThumbprint || receipt.expectedPublisherName !== expected.publisherName
    || !HASH.test(receipt.asideSha256 ?? "") || !Number.isFinite(created) || Math.abs(now - created) > 120_000) {
    throw new Error("Fresh authenticated signer readiness is required before the expensive signed build.");
  }
}

export function signingProfile(input) {
  const keys = new Set(["certificateThumbprint", "publisherName", "timestampUrl", "timeoutSeconds"]);
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !keys.has(key))) throw new Error("Unsupported signing rehearsal profile.");
  if (!THUMB.test(input.certificateThumbprint ?? "") || typeof input.publisherName !== "string"
    || !input.publisherName.trim() || input.publisherName.length > 256 || /[\r\n\0]/u.test(input.publisherName)) {
    throw new Error("Signing rehearsal requires an exact certificate and publisher identity.");
  }
  let url;
  try { url = new URL(input.timestampUrl); } catch { throw new Error("Invalid signing timestamp URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("Invalid signing timestamp URL.");
  const timeoutSeconds = input.timeoutSeconds ?? 1800;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 60 || timeoutSeconds > 14400) throw new Error("Invalid signing rehearsal timeout.");
  return { certificateThumbprint: input.certificateThumbprint.toUpperCase(), publisherName: input.publisherName.trim(),
    timestampUrl: url.href, timeoutSeconds };
}

export function signingBuildSettings(repo, candidate, profile, systemRoot, pluginCache = null) {
  const signing = signingProfile(profile);
  const handoff = path.join(candidate, "handoff");
  for (const directory of ["requests", "responses", "completed"]) mkdirSync(path.join(handoff, directory), { recursive: true });
  if (!systemRoot || !path.isAbsolute(systemRoot)) throw new Error("Trusted Windows SystemRoot is required.");
  let preparedCache = null;
  if (pluginCache) {
    const root = path.join(candidate, "signing-cache"); mkdirSync(root, { mode: 0o700 });
    for (const record of pluginCache.records) copyFileSync(containedPath(pluginCache.root, record.file), path.join(root, record.file), constants.COPYFILE_EXCL);
    preparedCache = { ...pluginCache, root };
  }
  return { signing, handoff, pluginCache: preparedCache, env: {
    DRIFTY_WINDOWS_SIGN_RELEASE: "1", DRIFTY_WINDOWS_SIGNING_MODE: "esigner-web",
    DRIFTY_WINDOWS_CERTIFICATE_THUMBPRINT: signing.certificateThumbprint,
    DRIFTY_WINDOWS_EXPECTED_PUBLISHER_NAME: signing.publisherName,
    DRIFTY_WINDOWS_TIMESTAMP_URL: signing.timestampUrl,
    DRIFTY_WINDOWS_ESIGNER_HANDOFF_DIR: handoff,
    DRIFTY_WINDOWS_ESIGNER_HANDOFF_TIMEOUT_SECONDS: String(signing.timeoutSeconds),
    ...(preparedCache ? { DRIFTY_WINDOWS_ESIGNER_SIGNED_CACHE_DIR: preparedCache.root } : {}),
  }, config: { bundle: { createUpdaterArtifacts: false, windows: {
    certificateThumbprint: signing.certificateThumbprint, digestAlgorithm: "sha256", timestampUrl: signing.timestampUrl,
    signCommand: { cmd: path.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), args: [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      path.join(repo, "scripts/sign-windows-artifact.ps1"), "-Path", "%1",
    ] },
  } } } };
}

export function collectSigningEvidence(candidate, manifest, profile, pluginCache = null) {
  const expected = signingProfile(profile);
  const handoff = containedPath(candidate, "handoff");
  const receipts = readdirSync(containedPath(handoff, "completed")).filter((name) => name.endsWith(".completed.json"));
  const requests = readdirSync(containedPath(handoff, "requests")).filter((name) => name.endsWith(".request.json"));
  if (!requests.length || receipts.length < requests.length || (!pluginCache && receipts.length !== requests.length)) throw new Error("Every signing request needs a completed original-hook receipt.");
  const records = receipts.map((name) => {
    const completion = json(containedPath(handoff, `completed/${name}`));
    const requestName = name.replace(/\.completed\.json$/u, "");
    if (completion.signedCacheHit === true) {
      const artifactName = path.basename(completion.artifactPath);
      const approved = pluginCache?.records.filter((record) => record.artifactName === artifactName && record.unsignedSha256 === completion.unsignedSha256?.toLowerCase()) ?? [];
      if (approved.length !== 1 || !/^[a-f0-9]{32}$/u.test(completion.requestId ?? "") || completion.schemaVersion !== 1
        || requestName !== `${completion.requestId}--${artifactName}` || completion.signerThumbprint !== expected.certificateThumbprint
        || completion.timestampThumbprint !== approved[0].timestampThumbprint || !HASH.test(completion.signedSha256 ?? "")
        || completion.signedSha256.toLowerCase() !== approved[0].signedSha256 || !Number.isInteger(completion.authenticodeAlignmentPaddingBytes)
        || completion.authenticodeAlignmentPaddingBytes < 0 || completion.authenticodeAlignmentPaddingBytes > 7
        || requests.includes(`${requestName}.request.json`)) throw new Error("Cached signing receipt is not an approved NSIS plugin.");
      const seed = approved[0], signed = hashFile(containedPath(pluginCache.root, seed.file));
      const installed = containedPath(candidate, path.relative(candidate, completion.artifactPath).split(path.sep).join("/"));
      const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
      const pluginPath = path.join(realpathSync(candidate), "target/release/nsis/x64/Plugins/x86-unicode",
        ...(artifactName === "nsis_tauri_utils.dll" ? ["additional"] : []), artifactName);
      if (normalize(installed) !== normalize(pluginPath)
        || normalize(completion.responsePath) !== normalize(path.join(pluginCache.root, seed.file))
        || signed.sha256 !== seed.signedSha256 || signed.bytes !== seed.signedBytes || hashFile(installed).sha256 !== seed.signedSha256) {
        throw new Error("Cached plugin bytes or installed path do not match their approved source.");
      }
      return { requestId: completion.requestId, artifactName, artifactPath: completion.artifactPath,
        unsignedSha256: seed.unsignedSha256, signedSha256: signed.sha256, signedBytes: signed.bytes,
        response: `signing-cache/${seed.file}`, completion: `handoff/completed/${name}`, signedCacheHit: true,
        cacheSourceRequestId: seed.sourceRequestId };
    }
    const request = json(containedPath(handoff, `requests/${requestName}.request.json`));
    const unsigned = hashFile(containedPath(handoff, `requests/${requestName}`));
    const signedPath = containedPath(handoff, `responses/${requestName}`);
    const signed = hashFile(signedPath);
    if (completion.schemaVersion !== 1 || completion.requestId !== request.requestId
      || requestName !== `${request.requestId}--${request.artifactName}` || completion.signedCacheHit !== false
      || completion.signerThumbprint !== expected.certificateThumbprint || !THUMB.test(completion.timestampThumbprint ?? "")
      || request.expectedSignerThumbprint !== expected.certificateThumbprint || request.expectedPublisherName !== expected.publisherName
      || !HASH.test(completion.unsignedSha256 ?? "") || !HASH.test(completion.signedSha256 ?? "")
      || unsigned.sha256 !== completion.unsignedSha256.toLowerCase() || unsigned.sha256 !== request.unsignedSha256.toLowerCase()
      || unsigned.bytes !== request.unsignedLength || signed.sha256 !== completion.signedSha256.toLowerCase()
      || signed.bytes <= unsigned.bytes || !Number.isInteger(completion.authenticodeAlignmentPaddingBytes)
      || completion.authenticodeAlignmentPaddingBytes < 0 || completion.authenticodeAlignmentPaddingBytes > 7) {
      throw new Error("Signing receipt or preserved PE payload does not match this candidate.");
    }
    return { requestId: request.requestId, artifactName: request.artifactName, artifactPath: completion.artifactPath,
      unsignedSha256: unsigned.sha256, signedSha256: signed.sha256, signedBytes: signed.bytes,
      response: `handoff/responses/${requestName}`, completion: `handoff/completed/${name}`, signedCacheHit: false };
  });
  if (new Set(records.map((record) => record.requestId)).size !== records.length) throw new Error("Duplicate signing receipt identity.");
  if (records.filter((record) => !record.signedCacheHit).length !== requests.length
    || records.filter((record) => record.signedCacheHit).length > 5) throw new Error("Signing request/cache accounting mismatch.");
  const at = (suffix) => {
    const matches = records.filter((record) => record.artifactPath.replaceAll("\\", "/").endsWith(suffix));
    if (matches.length !== 1) throw new Error(`Missing or ambiguous signing receipt: ${suffix}.`);
    return matches[0];
  };
  const app = at("/target/release/drifty.exe");
  const browserHost = at("/target/release/drifty-browser-host.exe");
  const tracker = at("/drifty-tracker.exe");
  const installer = at(`/${manifest.installer}`);
  const compiled = containedPath(candidate, "target/release/drifty.exe");
  if (app.unsignedSha256 !== nsisAppPayload(compiled).sha256) throw new Error("Signed app is not the exact NSIS-patched compiled app.");
  verifyPePdb(containedPath(candidate, app.response), containedPath(candidate, "target/release/drifty.pdb"));
  for (const [record, name] of [[browserHost, "target/release/drifty-browser-host.exe"], [installer, manifest.installer]]) {
    if (record.signedSha256 !== hashFile(containedPath(candidate, name)).sha256) throw new Error("Signed build output differs from its signing receipt.");
  }
  const trackerFiles = manifest.trackerResources.filter((file) => file.name === "drifty-tracker.exe");
  if (trackerFiles.length !== 1 || trackerFiles[0].sha256 !== tracker.signedSha256) throw new Error("Packaged tracker differs from its signing receipt.");
  const uninstallers = records.filter((record) => record.artifactName.endsWith(".tmp"));
  if (!uninstallers.length || PLUGINS.some((name) => records.filter((record) => record.artifactName === name).length !== 1)) {
    throw new Error("NSIS plugin/uninstaller signing sequence is incomplete.");
  }
  return { records, profile: expected, expectedInstalledHashes: Object.fromEntries(Object.entries({ app, browserHost, tracker, installer })
    .map(([name, record]) => [name, record.signedSha256])), signedAppResponse: app.response,
    uninstallerRequests: uninstallers.map((record) => record.requestId),
    ...(pluginCache ? { pluginCache: { sourceCommit: pluginCache.sourceCommit, sourceCandidateId: pluginCache.sourceCandidateId,
      sourceManifestSha256: pluginCache.sourceManifestSha256, manifestSha256: pluginCache.manifestSha256,
      reusedPlugins: records.filter((record) => record.signedCacheHit).length } } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 6 || process.argv[2] !== "create-plugin-cache") throw new Error("Usage: windows-signing-rehearsal.mjs create-plugin-cache <source-candidate> <manifest-sha256> <new-cache-root>");
    console.log(JSON.stringify(createPluginCache(process.argv[3], process.argv[4], process.argv[5])));
  } catch (error) { console.error(`windows-signing-rehearsal: ${error.message}`); process.exitCode = 1; }
}

export function verifySignedInstalledPayloads(manifest, evidence) {
  if (manifest.mode !== "internal-signed-rehearsal" || manifest.state !== "complete" || manifest.publicationAllowed !== false
    || !manifest.signing?.records?.length || evidence.passed !== true || evidence.app?.buildCommit !== manifest.sourceCommit
    || evidence.app?.version !== manifest.version || !evidence.cleanup?.credentialBaselineRestored || !evidence.cleanup?.appStopped
    || !evidence.cleanup?.debugPortClosed || !evidence.cleanup?.managedAiPortClosed
    || !Array.isArray(evidence.cleanup?.residualProductProcessIds) || evidence.cleanup.residualProductProcessIds.length) {
    throw new Error("Signed installed-runtime evidence is incomplete or belongs to another candidate.");
  }
  for (const name of ["app", "browserHost", "tracker", "installer"]) {
    const expected = manifest.signing.expectedInstalledHashes[name];
    const actual = name === "installer" ? evidence.installer?.actualSha256 : evidence[name]?.sha256;
    if (!HASH.test(expected ?? "") || actual?.toLowerCase() !== expected || evidence[name]?.authenticodeStatus !== "Valid") {
      throw new Error(`Installed signed ${name} does not match its original-hook receipt.`);
    }
  }
  return { state: "verified-internal-signed-installed-payloads", publicationAllowed: false, sourceCommit: manifest.sourceCommit,
    attemptId: manifest.attemptId, expected: manifest.signing.expectedInstalledHashes };
}
