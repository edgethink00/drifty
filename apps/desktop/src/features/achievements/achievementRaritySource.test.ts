import { describe, expect, it } from "vitest";
import { heldAchievementIds, parseRarityRows, REPORT_REFRESH_MS, reportDue } from "./achievementRaritySource";

const earned = { firstDay: "2026-11-01", lastDay: "2026-11-02", count: 2 };

describe("achievement rarity source", () => {
  it("reports only the ids of earned achievements, in catalogue order", () => {
    expect(heldAchievementIds({ earned: { streak7: earned, firstFlow: earned } })).toEqual(["firstFlow", "streak7"]);
    expect(heldAchievementIds({ earned: {} })).toEqual([]);
  });

  it("reports again when the held set changes or a week has passed, and not otherwise", () => {
    const now = 1_000_000_000_000;
    expect(reportDue(["firstFlow"], null, now)).toBe(true);
    expect(reportDue(["firstFlow"], { ids: "firstFlow", at: now - 1000 }, now)).toBe(false);
    expect(reportDue(["firstFlow", "flow90"], { ids: "firstFlow", at: now - 1000 }, now)).toBe(true);
    expect(reportDue(["firstFlow"], { ids: "firstFlow", at: now - REPORT_REFRESH_MS }, now)).toBe(true);
  });

  it("keeps only known achievements with a sane share and a basis", () => {
    expect(parseRarityRows([
      { achievement_id: "flow90", percent: "34.2", basis_count: "1240" },
      { achievement_id: "nope", percent: 10, basis_count: 1240 },
      { achievement_id: "flow180", percent: 140, basis_count: 1240 },
      { achievement_id: "streak7", percent: 41, basis_count: 0 },
    ])).toEqual({ flow90: { percent: 34.2, basisCount: 1240 } });
  });
});
