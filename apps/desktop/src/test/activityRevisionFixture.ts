import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActivitySegment } from "@drifty/domain";

type RevisionDtos = Record<"full" | "compact" | "live", ActivitySegment>;
type RevisionPair = { before: RevisionDtos; after: RevisionDtos };

export function loadActivityRevisionFixture(start = new Date(2026, 4, 20, 12).toISOString()): {
  trim: RevisionPair;
  classificationDelete: RevisionPair;
} {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const tracker = join(root, "services/tracker-python");
  const result = spawnSync(process.env.PYTHON ?? "python3", [
    join(tracker, "tests/activity_revision_db_fixture.py"), start,
  ], { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: tracker } });
  if (result.status !== 0) throw new Error(`SQLite revision fixture failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
