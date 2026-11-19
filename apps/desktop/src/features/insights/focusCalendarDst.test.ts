import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("finishes the real Focus calendar across the spring 4am day boundary", () => {
  const source = buildSync({
    entryPoints: [fileURLToPath(new URL("./focusCalendar.ts", import.meta.url))],
    bundle: true, platform: "node", format: "cjs", write: false,
  }).outputFiles[0].text;
  // The bundle goes in on stdin: Linux caps one argument at 128 KiB (E2BIG), macOS does not.
  const child = spawnSync(process.execPath, ["-"], { input: source + `
    console.log(JSON.stringify(module.exports.buildFocusCalendar([{
      id: "spring", appName: "Editor", source: "manual",
      startedAt: new Date("2026-03-08T03:30:00").toISOString(),
      endedAt: new Date("2026-03-08T04:30:00").toISOString(),
      durationSeconds: 3600,
      classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 }
    }], "2026-03-07", "2026-03-08", undefined, 240)));
  `, env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8", timeout: 2_000 });
  expect(child.error?.message.split(":")[0], "Focus calendar must finish").toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout).map((day: { day: string; trackedSeconds: number; focusSeconds: number }) => ({
    day: day.day, trackedSeconds: day.trackedSeconds, focusSeconds: day.focusSeconds,
  }))).toEqual([
    { day: "2026-03-07", trackedSeconds: 1800, focusSeconds: 1800 },
    { day: "2026-03-08", trackedSeconds: 1800, focusSeconds: 1800 },
  ]);
});
