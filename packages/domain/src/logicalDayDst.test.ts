import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Run real domain functions in an isolated timezone/process. A regression in
// buildDailyTotals must fail with a timeout rather than hang the test runner.
const source = buildSync({
  entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
}).outputFiles[0].text;

function probe(timezone: string, expression: string): unknown {
  // The bundle goes in on stdin: Linux caps one argument at 128 KiB (E2BIG), macOS does not.
  const child = spawnSync(process.execPath, ["-"], {
    input: source + "\nconsole.log(JSON.stringify(" + expression + "));",
    env: { ...process.env, TZ: timezone },
    encoding: "utf8",
    timeout: 2_000,
  });
  expect(child.error?.message.split(":")[0], "domain calculation must finish").toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout);
}

describe("logical days across timezone offset changes", () => {
  it.each([
    ["America/New_York", "2026-11-01", 0, "2026-11-01T01:10:00-04:00", "2026-11-01T01:10:00-05:00"],
    ["America/New_York", "2026-10-31", 240, "2026-11-01T01:10:00-04:00", "2026-11-01T01:10:00-05:00"],
    ["Australia/Lord_Howe", "2026-04-05", 0, "2026-04-05T01:40:00+11:00", "2026-04-05T01:40:00+10:30"],
  ])("finishes Flow traversal and preserves both repeated hours in %s with boundary %s/%s", (zone, day, boundary, first, second) => {
    expect(probe(zone, `(() => {
      const rows = ["${first}", "${second}"].map((start, index) => ({
        id: "fold-" + index, appName: "Editor", source: "manual",
        startedAt: start, endedAt: new Date(Date.parse(start) + 600000).toISOString(), durationSeconds: 600
      }));
      return [5, 15, 30].map(interval => {
        const blocks = module.exports.buildFlowBlocks(rows, "${day}", interval, undefined, ${boundary});
        return {
          seconds: blocks.reduce((sum, block) => sum + block.durationSeconds, 0),
          visible: [...module.exports.selectFlowVisibleSegmentIds(rows, "${day}", interval, undefined, ${boundary})].sort(),
          sources: [...new Set(blocks.flatMap(block => block.sourceSegmentIds))].sort()
        };
      });
    })()`)).toEqual(Array.from({ length: 3 }, () => ({ seconds: 1200, visible: ["fold-0", "fold-1"], sources: ["fold-0", "fold-1"] })));
  });

  it("advances Flow across a spring gap without inventing the skipped hour", () => {
    expect(probe("America/New_York", `module.exports.buildFlowBlocks([{
      id: "spring-flow", appName: "Editor", source: "manual",
      startedAt: "2026-03-08T01:55:00-05:00", endedAt: "2026-03-08T03:05:00-04:00", durationSeconds: 600
    }], "2026-03-08", 5).map(block => [block.minuteOfDay, block.durationSeconds])`)).toEqual([[115, 300], [180, 300]]);
  });

  it.each([
    ["America/New_York", "2026-03-08T04:30:00", 240, "2026-03-08"],
    ["America/New_York", "2026-03-08T03:59:59", 240, "2026-03-07"],
    ["America/New_York", "2026-11-01T03:30:00", 240, "2026-10-31"],
    ["America/New_York", "2026-11-01T04:00:00", 240, "2026-11-01"],
    ["Australia/Lord_Howe", "2026-10-04T04:15:00", 240, "2026-10-04"],
    ["Asia/Seoul", "2026-03-08T03:59:59", 240, "2026-03-07"],
    ["Asia/Seoul", "2026-03-08T04:00:00", 240, "2026-03-08"],
  ])("assigns %s %s to its local clock boundary", (zone, timestamp, minutes, day) => {
    expect(probe(zone, `module.exports.logicalDayIsoDateForDate(new Date("${timestamp}"), ${minutes})`)).toBe(day);
  });

  it("keeps day end contiguous with the next start when the boundary falls in a skipped hour", () => {
    expect(probe("America/New_York", `[
      module.exports.logicalDayEndExclusiveMs("2026-03-08", 150),
      module.exports.logicalDayStartMs("2026-03-09", 150)
    ]`)).toEqual([1773037800000, 1773037800000]);
  });

  it("finishes real daily aggregation and splits at the spring clock boundary", () => {
    expect(probe("America/New_York", `module.exports.buildDailyTotals([{
      id: "spring", appName: "Editor", source: "manual",
      startedAt: new Date("2026-03-08T03:30:00").toISOString(),
      endedAt: new Date("2026-03-08T04:30:00").toISOString(),
      durationSeconds: 3600
    }], "2026-03-07", "2026-03-08", 240)`)).toEqual([
      { day: "2026-03-07", totalSeconds: 1800 },
      { day: "2026-03-08", totalSeconds: 1800 },
    ]);
  });

  it("keeps fall activity before 4am in the previous logical day", () => {
    expect(probe("America/New_York", `module.exports.buildDailyTotals([{
      id: "fall", appName: "Editor", source: "manual",
      startedAt: new Date("2026-11-01T03:15:00").toISOString(),
      endedAt: new Date("2026-11-01T04:15:00").toISOString(),
      durationSeconds: 3600
    }], "2026-10-31", "2026-11-01", 240)`)).toEqual([
      { day: "2026-10-31", totalSeconds: 2700 },
      { day: "2026-11-01", totalSeconds: 900 },
    ]);
  });

  it.each([
    ["2026-03-08", 82_800_000],
    ["2026-11-01", 90_000_000],
  ])("clips a raw summary inside the %s DST logical day instead of assuming 24 hours", (day, expectedWindowMs) => {
    expect(probe("America/New_York", `(() => {
      const start = module.exports.logicalDayStartMs("${day}", 0);
      const end = module.exports.logicalDayEndExclusiveMs("${day}", 0);
      const segment = {
        id: "dst", appName: "Editor", source: "manual",
        startedAt: new Date(start - 600000).toISOString(),
        endedAt: new Date(start + 600000).toISOString(),
        durationSeconds: 1200
      };
      return [end - start, module.exports.clipDeviceElapsedTimeSegment(segment, { start, end }).durationSeconds];
    })()`)).toEqual([expectedWindowMs, 600]);
  });
});
