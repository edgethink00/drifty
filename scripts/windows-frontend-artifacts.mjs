import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { containedPath, hashFile } from "./windows-build-artifacts.mjs";

export const WINDOWS_APP_KEYS = Object.freeze([
  "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_POSTHOG_KEY", "VITE_POSTHOG_HOST",
  "VITE_SENTRY_DSN", "DRIFTY_NATIVE_SENTRY_DSN", "DRIFTY_TRACKER_SENTRY_DSN",
  "VITE_GOOGLE_CALENDAR_ONBOARDING_ENABLED", "GOOGLE_CALENDAR_DESKTOP_CLIENT_ID", "GOOGLE_CALENDAR_DESKTOP_CLIENT_SECRET",
]);
export const WINDOWS_RENDERER_ENVIRONMENT = Object.freeze({
  VITE_DRIFTY_HOST_PLATFORM: "windows", VITE_DRIFTY_CHANNEL: "production", VITE_DRIFTY_AUTH_MODE: "required",
  VITE_DRIFTY_PREVIEW: "0", VITE_SENTRY_ENVIRONMENT: "production", VITE_SENTRY_TRACES_SAMPLE_RATE: "0",
});

export function frontendEnvironmentFingerprint(environment) {
  const values = Object.fromEntries(WINDOWS_APP_KEYS.map((key) => [key, environment[key] ?? ""]));
  return createHash("sha256").update(JSON.stringify({ ...values, ...WINDOWS_RENDERER_ENVIRONMENT })).digest("hex");
}

export function frontendInventory(root, { allowMaps = false } = {}, prefix = "") {
  if (lstatSync(root).isSymbolicLink()) throw new Error("Frontend directory must not be a symlink.");
  const result = [];
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || entry.name.startsWith(".") || /[\\:\x00-\x1f]/u.test(entry.name)) {
      throw new Error("Frontend contains a hidden, linked or unsafe artifact.");
    }
    if (entry.isDirectory()) result.push(...frontendInventory(root, { allowMaps }, name));
    else {
      if (!entry.isFile() || (!allowMaps && name.endsWith(".map"))) throw new Error("Frontend must contain regular assets without source maps.");
      result.push({ name, ...hashFile(containedPath(root, name)) });
    }
  }
  if (result.length > 10_000) throw new Error("Frontend artifact count exceeds its bound.");
  return result.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function sourceMapDebugIds(dist) {
  const files = frontendInventory(dist, { allowMaps: true });
  const js = files.filter((file) => file.name.endsWith(".js"));
  if (!js.length || files.filter((file) => file.name.endsWith(".map")).length !== js.length) throw new Error("Prepared frontend needs one source map per JavaScript bundle.");
  const ids = [];
  for (const file of js) {
    const bytes = readFileSync(containedPath(dist, file.name), "utf8");
    const id = bytes.match(/\/\/# debugId=([a-f0-9-]{36})(?:\r?\n|$)/iu)?.[1];
    const map = JSON.parse(readFileSync(containedPath(dist, `${file.name}.map`), "utf8"));
    if (!id || !bytes.includes("_sentryDebugIds") || (map.debug_id ?? map.debugId)?.toLowerCase() !== id.toLowerCase()
      || !Array.isArray(map.sources) || !map.sources.length || !Array.isArray(map.sourcesContent)
      || map.sourcesContent.length !== map.sources.length || map.sourcesContent.some((source) => typeof source !== "string")) {
      throw new Error("Every JavaScript bundle needs a matching injected source map with source content.");
    }
    ids.push({ name: file.name, debugId: id.toLowerCase(), javascript: hashFile(containedPath(dist, file.name)),
      sourceMap: hashFile(containedPath(dist, `${file.name}.map`)) });
  }
  return ids;
}

export function verifyPreparedFrontend(manifestFile, expectedSha256, expected) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256 ?? "") || hashFile(manifestFile).sha256 !== expectedSha256) {
    throw new Error("Prepared frontend manifest hash is missing or mismatched.");
  }
  const root = realpathSync(path.dirname(manifestFile));
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (manifest.schemaVersion !== 2 || manifest.sourceIdentity !== "git-tree" || manifest.mode !== "windows-prepared-frontend" || manifest.state !== "complete"
    || manifest.platform !== "windows" || manifest.channel !== "production" || manifest.publicationAllowed !== false
    || manifest.sourceCommit !== expected.commit || manifest.version !== expected.version
    || manifest.sourceFingerprint !== expected.sourceFingerprint || manifest.environmentFingerprint !== expected.environmentFingerprint
    || manifest.dist !== "dist" || !/^[a-f0-9]{64}$/u.test(manifest.lockfileSha256 ?? "")
    || manifest.lockfileSha256 !== expected.lockfileSha256
    || manifest.rendererMaps?.project !== "drifty-mac-renderer" || manifest.rendererMaps.org !== "edgethink"
    || manifest.rendererMaps.release !== `drifty-mac@${expected.version}+${expected.commit.slice(0, 12)}`
    || manifest.rendererMaps.exitCode !== 0 || manifest.rendererMaps.processed !== true
    || !Number.isInteger(manifest.rendererMaps.mapCount) || manifest.rendererMaps.mapCount <= 0
    || !/^[a-f0-9]{64}$/u.test(manifest.rendererMaps.uploadLogSha256 ?? "")) {
    throw new Error("Prepared frontend source, environment or processed renderer-map proof differs.");
  }
  const dist = containedPath(root, "dist");
  if (lstatSync(path.join(root, "dist")).isSymbolicLink()) throw new Error("Prepared dist must not be linked.");
  const files = frontendInventory(dist);
  if (!files.some((file) => file.name === "index.html") || !files.some((file) => file.name === "auxiliary.html")
    || JSON.stringify(files) !== JSON.stringify(manifest.files)
    || !Array.isArray(manifest.debugIds) || manifest.debugIds.length !== manifest.rendererMaps.mapCount
    || files.filter((file) => file.name.endsWith(".js")).length !== manifest.debugIds.length
    || new Set(manifest.debugIds.map((item) => item.name)).size !== manifest.debugIds.length) {
    throw new Error("Prepared frontend assets changed or lack their required entry points.");
  }
  for (const item of manifest.debugIds) {
    const actual = files.find((file) => file.name === item.name);
    if (!actual || !item.name.endsWith(".js") || actual.sha256 !== item.javascript?.sha256 || actual.bytes !== item.javascript?.bytes
      || !/^[a-f0-9-]{36}$/u.test(item.debugId ?? "")
      || !readFileSync(containedPath(dist, item.name), "utf8").includes(`//# debugId=${item.debugId}`)) {
      throw new Error("Prepared JavaScript no longer matches its uploaded debug ID.");
    }
  }
  return { manifest, dist, manifestSha256: expectedSha256 };
}

function powerShellLiteral(value) {
  if (!value || /["%&|<>^!\r\n]/u.test(value)) throw new Error("Prepared frontend command argument contains shell metacharacters.");
  return `'${value.replace(/'/gu, "''")}'`;
}

export function frontendDistForTauri(repo, dist) {
  const paths = /^[a-z]:[\\/]|^\\\\/iu.test(repo ?? "") ? path.win32 : path;
  if (!paths.isAbsolute(repo ?? "") || !paths.isAbsolute(dist ?? "")
    || (paths === path.win32 && !/^[a-z]:[\\/]|^\\\\/iu.test(dist ?? ""))) {
    throw new Error("Prepared frontend paths must use the same absolute path format.");
  }
  const relative = paths.relative(paths.join(repo, "src-tauri"), dist);
  if (!relative || paths.isAbsolute(relative) || /^[a-z]:/iu.test(relative)) {
    throw new Error("Prepared frontend must be on the source volume and differ from src-tauri.");
  }
  // FrontendDist deserializes URL before PathBuf. C:\\... is a valid opaque
  // URL, so an absolute Windows path builds but panics on its first WebView.
  return `./${relative.split(paths.sep).join("/")}`;
}

export function preparedFrontendTauriConfig(proof, { node, verifier, repo, manifestFile, expected }) {
  const args = [node, verifier, "verify", "--repo", repo, "--manifest", manifestFile, "--manifest-sha256", proof.manifestSha256,
    "--commit", expected.commit, "--environment-fingerprint", expected.environmentFingerprint];
  // Tauri 2.10.1 passes the hook as one Rust Command argument to cmd /S /C.
  // Nested double quotes acquire literal backslashes on that path. Keep the
  // cmd command quote-free and carry the exact argv in a UTF-16 PowerShell payload.
  const script = `& ${args.map(powerShellLiteral).join(" ")}; exit $LASTEXITCODE`;
  const command = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
  if (command.length > 7000) throw new Error("Prepared frontend verification command exceeds the Windows command limit.");
  return { build: { frontendDist: frontendDistForTauri(repo, proof.dist), beforeBuildCommand: command } };
}
