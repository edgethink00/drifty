import { describe, expect, it } from "vitest";

import { getTeamFocusWindow } from "./teamAggregate";

describe("teamAggregate", () => {
  it("Given every team period When focus windows are requested Then daily weekly and monthly ranges are supported", () => {
    // Given
    const windowEndDay = "2026-07-02";

    // When
    const daily = getTeamFocusWindow("daily", windowEndDay);
    const weekly = getTeamFocusWindow("weekly", windowEndDay);
    const monthly = getTeamFocusWindow("monthly", windowEndDay);

    // Then
    expect(daily).toEqual({ period: "daily", window_start_date: "2026-07-02", window_end_date: "2026-07-02" });
    expect(weekly).toEqual({ period: "weekly", window_start_date: "2026-06-26", window_end_date: "2026-07-02" });
    expect(monthly).toEqual({ period: "monthly", window_start_date: "2026-06-03", window_end_date: "2026-07-02" });
  });

  it("Given an unsupported period When a focus window is requested Then it returns null", () => {
    expect(getTeamFocusWindow("yearly", "2026-07-02")).toBeNull();
  });
});
