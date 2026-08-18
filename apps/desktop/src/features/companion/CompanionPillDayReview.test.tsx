// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
import { CompanionPillDayReview } from "./CompanionPillDayReview";

afterEach(cleanup);

const reviewEvent: EndOfDayReviewEvent = {
  kind: "endOfDayReview",
  day: "2026-08-02",
  generatedAt: "2026-08-02T18:00:00.000Z",
  trackedLabel: "6h 34m tracked",
  focusLabel: "4h 12m focus",
  driftLabel: "58m drift",
  totalSeconds: 23_640,
  focusSeconds: 15_120,
  driftSeconds: 3_480,
  topSource: null,
  sourceSummaries: [
    { appName: "VS Code", sourceLabel: "VS Code", durationSeconds: 9_660, percent: 41 },
    { appName: "Figma", sourceLabel: "Figma", durationSeconds: 5_460, percent: 23 },
    { appName: "Slack", sourceLabel: "Slack", durationSeconds: 2_640, percent: 11 },
  ],
  highlightLabel: "Best this week",
  comparison: {
    focusDeltaSeconds: 2_280,
    driftDeltaSeconds: -540,
    otherDeltaSeconds: 300,
  },
  dailySignals: {
    deepSessionCount: 3,
    longestFocusRunSeconds: 6_480,
    peakHourLabel: "10:00",
    peakHourFocusSeconds: 3_120,
  },
};

describe("CompanionPillDayReview", () => {
  it("reproduces every reviewed block from the prototype", () => {
    const onDismiss = vi.fn();
    const onOpenDashboard = vi.fn();
    const { container } = render(
      <CompanionPillDayReview
        event={reviewEvent}
        onDismiss={onDismiss}
        onOpenDashboard={onOpenDashboard}
      />,
    );

    expect(screen.getByText("Best this week")).toBeTruthy();
    // The headline is the whole tracked day (6:34), not focus-only, and the
    // delta sums all three buckets: +38m focus, -9m drift, +5m other.
    expect(screen.getByText("6:34")).toBeTruthy();
    expect(screen.getByText("▲34m vs yesterday")).toBeTruthy();
    expect(screen.getByText("0:58")).toBeTruthy();
    expect(screen.getByText("0:44")).toBeTruthy();
    expect(screen.getByText("▼9m")).toBeTruthy();
    expect(screen.getByText("Deep sessions")).toBeTruthy();
    expect(screen.getByText("45m+ each · best 1:48")).toBeTruthy();
    expect(screen.getByText("Peak hour")).toBeTruthy();
    expect(screen.getByText("52m focused")).toBeTruthy();
    expect(container.querySelectorAll(".eodapp")).toHaveLength(3);
    expect(container.querySelector(".moment-brand .moment-brand__mark")).toBeTruthy();

    const ring = container.querySelector<HTMLElement>(".eodv6__ring");
    expect(ring?.style.background).toContain("conic-gradient");

    fireEvent.click(screen.getByRole("button", { name: "See full day" }));
    expect(onOpenDashboard).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTitle("Dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
