import { describe, expect, it } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import { buildWeekBreakdownHoverRows } from "./weekBreakdownHover";

function segment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  return {
    id: "overnight-focus",
    startedAt: "2024-01-03T03:30:00",
    endedAt: "2024-01-03T04:30:00",
    durationSeconds: 3600,
    appName: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
    platform: "macos",
    source: "nsworkspace",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
    },
    ...overrides,
  };
}

describe("buildWeekBreakdownHoverRows", () => {
  it("clips overnight activity to the selected logical day", () => {
    const rows = buildWeekBreakdownHoverRows({
      segments: [segment()],
      classificationOptions: { includeAiClassifications: false },
      startDay: "2024-01-02",
      endDay: "2024-01-02",
      startOfDayMinutes: 4 * 60,
      mode: "category",
      key: "workspace",
      day: "2024-01-02",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ appName: "Visual Studio Code", totalSeconds: 1800 });
  });

  it("filters app rows by the active productivity mode", () => {
    const rows = buildWeekBreakdownHoverRows({
      segments: [
        segment({ id: "focus", startedAt: "2024-01-03T09:00:00", endedAt: "2024-01-03T10:00:00" }),
        segment({
          id: "drift",
          startedAt: "2024-01-03T10:00:00",
          endedAt: "2024-01-03T10:15:00",
          durationSeconds: 900,
          appName: "Safari",
          classification: { category: "entertainment", productivity: "drift", source: "manual", confidence: 1 },
        }),
      ],
      classificationOptions: { includeAiClassifications: false },
      startDay: "2024-01-03",
      endDay: "2024-01-03",
      startOfDayMinutes: 0,
      mode: "productivity",
      key: "focus",
    });

    expect(rows.map((row) => row.appName)).toEqual(["Visual Studio Code"]);
  });
});
