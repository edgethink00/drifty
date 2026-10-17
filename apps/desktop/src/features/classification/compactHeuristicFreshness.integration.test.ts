import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { ActivityClassificationRecord, ActivitySegment } from "@drifty/domain";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_HEURISTIC_TAXONOMY_VERSION,
  materializeBuiltInHeuristicClassifications,
} from "./heuristicClassificationMaterialization";

const fixturePath = fileURLToPath(new URL(
  "../../../../../services/tracker-python/tests/compact_heuristic_freshness_fixture.py",
  import.meta.url,
));
const python = process.env.PYTHON
  ?? (process.platform === "darwin" ? "/usr/bin/python3" : process.platform === "win32" ? "python" : "python3");
const SEEDED_AT = "2026-10-12T10:00:00+00:00";
const REFRESHED_AT = "2026-10-12T11:00:00+00:00";
const SOURCES = { app: "app-db", domain: "domain-db", youtube: "youtube" } as const;
const KINDS = ["app", "domain", "youtube"] as const;
const AUTHORITATIVE = ["manual", "ai", "custom-rule", "synced-rule"] as const;

type StoredRow = {
  id: number;
  sync_seq: number;
  input_fingerprint: string | null;
  classified_at: string | null;
  refreshed_at: string | null;
  taxonomy_version: string | null;
  stale: number | null;
  source: string | null;
  category: string | null;
  productivity: string | null;
  classification_rule_id: number | null;
  rule_snapshot_kind: string | null;
};
type FixtureState = {
  compact: ActivitySegment[];
  rows: Record<string, StoredRow>;
  syncCounter: number;
  saved: number;
};
type FixtureRequest = {
  command: "seed" | "initialize" | "save";
  now: string;
  classifications?: ActivityClassificationRecord[];
};

// Keep the real database alive across all TS materialize -> Python save cycles.
// JSON lines avoid shell quoting and work with native Windows Python as well.
function startFixture() {
  const child = spawn(python, [fixturePath], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 15_000,
  });
  let stderr = "";
  let spawnError: Error | undefined;
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.on("error", (error) => { spawnError = error; });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return {
    async request(payload: FixtureRequest): Promise<FixtureState> {
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      const result = await output.next();
      if (result.done) {
        await closed;
        throw new Error(spawnError?.message || stderr || "Python fixture closed before responding");
      }
      return JSON.parse(result.value) as FixtureState;
    },
    async close() {
      child.stdin.end();
      const status = await closed;
      expect(spawnError, stderr).toBeUndefined();
      expect(status, stderr).toBe(0);
    },
  };
}

function materialize(state: FixtureState, classifiedAt: string) {
  return materializeBuiltInHeuristicClassifications({
    segments: state.compact,
    classifiedAt,
    classificationOptions: { rules: [] },
  });
}

function expectedIds(state: FixtureState, names: readonly string[]) {
  return names.map((name) => String(state.rows[name].id)).sort();
}

describe("compact built-in heuristic freshness across Python SQLite and TypeScript", () => {
  it("preserves current and authoritative rows, refreshes stale/old/unversioned rows once, then stops writing", async () => {
    const fixture = startFixture();
    try {
      const seed = await fixture.request({ command: "seed", now: SEEDED_AT });
      expect(seed.compact).toHaveLength(16);
      const builtInNames = ["current", "stale", "old", "unversioned"].flatMap((group) => KINDS.map((kind) => `${group}-${kind}`));
      const initial = materialize(seed, SEEDED_AT);
      expect(initial.classifications.map((record) => record.segmentId).sort()).toEqual(expectedIds(seed, builtInNames));
      for (const group of ["current", "stale", "old", "unversioned"]) {
        for (const kind of KINDS) {
          expect(initial.classifications.find((record) => record.segmentId === String(seed.rows[`${group}-${kind}`].id)))
            .toMatchObject({ source: SOURCES[kind], taxonomyVersion: BUILT_IN_HEURISTIC_TAXONOMY_VERSION });
        }
      }

      const before = await fixture.request({
        command: "initialize", now: SEEDED_AT, classifications: initial.classifications,
      });
      expect(before.saved).toBe(12);
      for (const kind of KINDS) {
        expect(before.rows[`stale-${kind}`]).toMatchObject({ stale: 1, taxonomy_version: BUILT_IN_HEURISTIC_TAXONOMY_VERSION });
        expect(before.rows[`old-${kind}`]).toMatchObject({ stale: 0, taxonomy_version: "builtin-heuristics-obsolete" });
        expect(before.rows[`unversioned-${kind}`]).toMatchObject({ stale: 0, taxonomy_version: null });
      }
      expect(before.rows["custom-rule"].classification_rule_id).not.toBeNull();
      expect(before.rows["synced-rule"]).toMatchObject({ classification_rule_id: null, rule_snapshot_kind: "synced-rule" });

      const refreshNames = ["stale", "old", "unversioned"].flatMap((group) => KINDS.map((kind) => `${group}-${kind}`));
      const refresh = materialize(before, REFRESHED_AT);
      // This fails against the old compact SQL/serializer: all three current
      // rows wrongly join the nine stale/old/unversioned rows in the save batch.
      expect(refresh.classifications.map((record) => record.segmentId).sort()).toEqual(expectedIds(before, refreshNames));
      const after = await fixture.request({
        command: "save", now: REFRESHED_AT, classifications: refresh.classifications,
      });
      expect(after.saved).toBe(9);
      expect(after.syncCounter - before.syncCounter).toBe(9);
      for (const name of [...KINDS.map((kind) => `current-${kind}`), ...AUTHORITATIVE]) {
        expect(after.rows[name], `${name} must retain timestamps, fingerprint and sync sequence`).toEqual(before.rows[name]);
      }
      for (const name of refreshNames) {
        const kind = name.split("-")[1] as typeof KINDS[number];
        expect(after.rows[name]).toMatchObject({
          source: SOURCES[kind], category: kind === "app" ? "workspace" : "learning", productivity: "focus",
          stale: 0, taxonomy_version: BUILT_IN_HEURISTIC_TAXONOMY_VERSION,
          classified_at: REFRESHED_AT, refreshed_at: REFRESHED_AT,
        });
        expect(after.rows[name].sync_seq).toBeGreaterThan(before.rows[name].sync_seq);
      }

      let current = after;
      for (let read = 0; read < 3; read += 1) {
        const now = `2026-10-12T1${read + 2}:00:00+00:00`;
        const repeated = materialize(current, now);
        expect(repeated.classifications, `compact read ${read + 1} must enqueue no re-saves`).toEqual([]);
        expect(repeated.segments).toBe(current.compact);
        current = await fixture.request({ command: "save", now, classifications: repeated.classifications });
        expect(current.saved).toBe(0);
        expect(current.rows).toEqual(after.rows);
        expect(current.syncCounter).toBe(after.syncCounter);
        expect(current.compact).toEqual(after.compact);
      }
    } finally {
      await fixture.close();
    }
  }, 20_000);
});
