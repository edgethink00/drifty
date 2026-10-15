// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { afterEach, describe, expect, it } from "vitest";
import { InsightEvidencePanel } from "./InsightEvidencePanel";
import { buildInsightSourceLists } from "./insightData";

function talk(id: string, start: string, minutes: number): ActivitySegment {
  return {
    id,
    appName: "Safari",
    bundleId: "com.apple.Safari",
    platform: "macos",
    source: "nsworkspace",
    siteDomain: "youtube.com",
    siteTitle: "Talk " + id,
    startedAt: start,
    endedAt: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
    classification: { category: "entertainment", productivity: "drift", source: "manual", confidence: 1 },
  };
}

// Two records on one day, one on another, an hour apart so they stay separate records.
const segments = [
  talk("a", "2026-10-14T09:00:00", 10),
  talk("b", "2026-10-15T09:00:00", 12),
  talk("c", "2026-10-15T11:00:00", 20),
];
const item = buildInsightSourceLists(segments, "drift").apps[0]!;

afterEach(cleanup);

describe("InsightEvidencePanel", () => {
  it("only shows the records: Back is its one control", () => {
    render(
      <InsightEvidencePanel
        target={{ variant: "drift", list: "apps", itemId: item.id }}
        item={item}
        listLabel="Drift apps"
        rangeLabel="Oct 9–15"
        segments={segments}
        classificationOptions={{}}
        startOfDayMinutes={0}
        appIcons={{}}
        autoFocus={false}
        motion="open"
        onClose={() => {}}
      />,
    );

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Back"]);
    expect(screen.queryByRole("dialog")).toBeNull();

    // A day total appears only when it adds up more than one record.
    const days = screen.getAllByRole("region").filter((region) => region.classList.contains("insight-evidence__day"));
    const busyDay = days.find((day) => within(day).queryByText("Talk b"));
    const quietDay = days.find((day) => within(day).queryByText("Talk a"));
    expect(days).toHaveLength(2);
    expect(busyDay?.querySelector(".insight-evidence__day-total")?.textContent).toBe("32m");
    expect(quietDay?.querySelector(".insight-evidence__day-total")).toBeNull();
  });
});
