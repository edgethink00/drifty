import { cpSync, mkdirSync, lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = resolve(repoRoot, "services/tracker-python/app");
const defaultDestination = resolve(repoRoot, "src-tauri/target/release-resources/tracker-python/app");

const excludedNames = new Set(["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);
const excludedExtensions = new Set([".pyc", ".pyo"]);
const excludedExactFiles = new Set(["drifty_tracker.sqlite3"]);

export function shouldStageTrackerResource(path) {
  const name = path.split(/[\\/]/).pop() ?? path;
  if (excludedNames.has(name)) return false;
  if (excludedExactFiles.has(name)) return false;
  if (excludedExtensions.has(name.slice(-4))) return false;
  if (/\.sqlite(?:3)?(?:$|[-.].*)/u.test(name)) return false;
  if (/\.db(?:3)?(?:$|[-.].*)/u.test(name)) return false;
  if (/[-.](?:wal|shm|journal)$/u.test(name)) return false;
  return true;
}

export function stageTrackerResource({ source = defaultSource, destination = defaultDestination } = {}) {
  const sourcePath = resolve(source);
  const destinationPath = resolve(destination);

  if (!statSync(sourcePath).isDirectory()) {
    throw new Error(`Tracker resource source is not a directory: ${sourcePath}`);
  }

  rmSync(destinationPath, { recursive: true, force: true });
  mkdirSync(destinationPath, { recursive: true });
  cpSync(sourcePath, destinationPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (sourceEntry) => shouldStageTrackerResource(relative(sourcePath, sourceEntry)) && !lstatSync(sourceEntry).isSymbolicLink(),
  });

  assertSafeStagedTrackerResource(destinationPath);

  return { source: sourcePath, destination: destinationPath };
}

export function assertSafeStagedTrackerResource(destination) {
  const destinationPath = resolve(destination);
  const unsafeEntries = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      const relativePath = relative(destinationPath, fullPath);
      if (!shouldStageTrackerResource(relativePath) || entry.isSymbolicLink()) {
        unsafeEntries.push(relativePath);
      }
      if (entry.isDirectory()) walk(fullPath);
    }
  }
  walk(destinationPath);
  if (unsafeEntries.length > 0) {
    throw new Error(`Unsafe tracker resource entries staged: ${unsafeEntries.join(", ")}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = stageTrackerResource();
  console.log(`Staged tracker resource from ${result.source} to ${result.destination}`);
}
