import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

function productSources(): ReadonlyArray<{ readonly path: string; readonly text: string }> {
  return readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
    .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
    .map((entry) => ({ path: entry, text: readFileSync(`${sourceRoot}${entry}`, "utf8") }));
}

/**
 * iPhone time is a Pro device-sync view for the person's own flow chart. It
 * must never reach leaderboards, public profiles, team surfaces, AI
 * classification, product analytics or the tracker database (product decision
 * 2026-10-15). It stays out of them by never becoming an activity segment and
 * by being reachable only from the Day flow chart and its activity lane.
 */
describe("iPhone time on the Mac", () => {
  const sources = productSources();

  it("is read only by the Day flow chart and its activity lane", () => {
    const importers = sources
      .filter(({ path, text }) => !path.startsWith("features/phone-time/") && /from "[^"]*phone-time\//.test(text))
      .map(({ path }) => path)
      .sort();
    expect(importers).toEqual([
      "App.tsx",
      "features/dashboard/DashboardPage.tsx",
      "features/dashboard/yourDayLaneNotes.tsx",
      "features/device-sync/deviceSyncApi.ts",
      "features/flow-chart/FlowChartGrid.tsx",
      "features/flow-chart/FlowChartView.tsx",
    ]);
    const readers = sources.filter(({ text }) => /fetchPhoneTimeBlocks\(/.test(text)).map(({ path }) => path).sort();
    expect(readers).toEqual(["features/device-sync/deviceSyncApi.ts", "features/phone-time/usePhoneTimeBlocks.ts"]);
  });

  it("never reaches storage, analytics, AI, leaderboard or team code", () => {
    const phoneTimeImports = sources
      .filter(({ path }) => path.startsWith("features/phone-time/"))
      .flatMap(({ text }) => [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1]));
    const forbidden = /trackerClient|analytics|posthog|sentry|leaderboard|account-stats|team|classification|profile|share/i;
    expect(phoneTimeImports.filter((path) => forbidden.test(path))).toEqual([]);
  });
});
