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

  it("keeps an organization's day chart to a few gridlines when a day holds hundreds of hours", () => {
    // A 480-person organization books ~1,500 focus hours on a weekday; the hour ladder used to stop at 24h steps.
    const model = buildTeamTrendModel(
      [{ organization_id: "org-1", organization_project_id: "p1", project_name: "Alpha", project_color: "#6366f1", project_status: "active", activity_date: "2026-10-12", seconds: 1_530 * 3600 }],
      { start_date: "2026-10-11", end_date: "2026-10-17" },
    );
    expect(model.view.yAxis.length).toBeGreaterThan(0);
    expect(model.view.yAxis.length).toBeLessThanOrEqual(4);
    expect(model.view.yAxis.map((tick) => tick.label)).toEqual(["500h", "1000h", "1500h"]);
  });
});
