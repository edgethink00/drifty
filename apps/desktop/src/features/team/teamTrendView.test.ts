import { describe, expect, it } from "vitest";

import { thinAxisTicks } from "../projects/projectTrendView";
import { buildTeamTrendModel } from "./teamTrendView";

describe("team trend axis labels", () => {
  it("keeps a week's daily labels", () => {
    const week = Array.from({ length: 7 }, (_, index) => index);
    expect(thinAxisTicks(week)).toEqual(week);
  });

  it("thins a month to an even stride that still starts and ends on the window edges", () => {
    const month = Array.from({ length: 30 }, (_, index) => index);
    const kept = thinAxisTicks(month);
    expect(kept.length).toBeLessThanOrEqual(8);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(29);
  });

  it("applies the thinning to the month chart the dashboards render", () => {
    const model = buildTeamTrendModel(
      [{ organization_id: "team-1", organization_project_id: "p1", project_name: "Alpha", project_color: "#6366f1", project_status: "active", activity_date: "2026-09-20", seconds: 3600 }],
      { start_date: "2026-09-11", end_date: "2026-10-10" },
    );
    expect(model.view.columns).toHaveLength(30);
    expect(model.view.axisTicks.map((tick) => tick.label)).toEqual(["9/11", "9/16", "9/21", "9/26", "10/1", "10/6", "10/10"]);
  });
});
