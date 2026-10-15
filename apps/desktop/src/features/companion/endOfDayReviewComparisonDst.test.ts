import { buildSync } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const source = buildSync({
  entryPoints: [fileURLToPath(new URL("./endOfDayReviewModel.ts", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", write: false,
}).outputFiles[0].text;

it.each(["spring", "fall"] as const)("compares the same local clock across %s DST", (season) => {
  const day = season === "spring" ? "2026-03-08" : "2026-11-01";
  const previous = season === "spring" ? "2026-03-07" : "2026-10-31";
  const late = season === "spring" ? ["18:30", "19:30"] : ["20:30", "21:30"];
  for (const timezone of ["America/New_York", "Asia/Seoul"]) {
    for (const startOfDayMinutes of [0, 240]) {
      const child = spawnSync(process.execPath, ["-e", source + `
        const segment = (id, start, end, durationSeconds) => ({
          id, appName: 'Code', source: 'manual', platform: 'macos', durationSeconds,
          startedAt: new Date('${previous}T' + start + ':00').toISOString(),
          endedAt: new Date('${previous}T' + end + ':00').toISOString(),
          classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1 }
        });
        console.log(JSON.stringify(module.exports.buildEndOfDayReviewComparison({
          day: '${day}', generatedAt: new Date('${day}T20:00:00').toISOString(), startOfDayMinutes: ${startOfDayMinutes},
          previousDaySegments: [segment('morning', '09:00', '12:00', 10800), segment('late', '${late[0]}', '${late[1]}', 3600)],
          current: { focusSeconds: ${season === "spring" ? 14400 : 10800}, driftSeconds: 0, neutralSeconds: 0 }
        })));
      `], { env: { ...process.env, TZ: timezone }, encoding: "utf8", timeout: 3000 });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({ focusDeltaSeconds: 0, driftDeltaSeconds: 0, otherDeltaSeconds: 0, scope: "sameTime" });
    }
  }
});


it("finishes hourly signals through the repeated fall hour and shares its device time once", () => {
  const child = spawnSync(process.execPath, ["-e", source + `
    const record = {
      id: 'fall', appName: 'Code', source: 'manual', platform: 'macos', durationSeconds: 10800,
      startedAt: new Date('2026-11-01T00:30:00').toISOString(), endedAt: new Date('2026-11-01T02:30:00').toISOString(),
      classification: { category: 'workspace', productivity: 'focus', source: 'manual', confidence: 1 }
    };
    console.log(JSON.stringify(module.exports.buildEndOfDayReviewDailySignals([record, { ...record, id: 'pc', deviceId: 'pc' }])));
  `], { env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8", timeout: 3000 });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toMatchObject({ longestFocusRunSeconds: 10800, peakHourFocusSeconds: 3600, peakHourLabel: "01:00" });
});
