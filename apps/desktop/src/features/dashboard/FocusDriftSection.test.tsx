// @vitest-environment jsdom
import type { ActivitySegment } from "@drifty/domain";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FocusDriftSection } from "./FocusDriftSection";
import { applyFocusDriftReplayReveal, buildFocusDriftChart } from "./focusDriftChart";

function focusSegment(): ActivitySegment {
  return {
    id: "replay-focus",
    startedAt: "2026-06-29T18:00:00",
    endedAt: "2026-06-29T19:00:00",
    durationSeconds: 60 * 60,
    appName: "Focus Studio",
    bundleId: "com.drifty.focus-studio",
    windowTitle: "Replay focus",
    platform: "macos",
    source: "manual",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
    },
  };
}

function renderFocusDriftSection(chart: ReturnType<typeof buildFocusDriftChart>) {
  return render(
    <FocusDriftSection
      activeHourCount={0}
      appIcons={{}}
      averageSessionMinutes={0}
      chart={chart}
      peakTrackedSeconds={0}
      peakWindowLabel="No peak"
      sessionCount={0}
      topAppLabel="No apps"
      totalSeconds={0}
      uniqueAppsCount={0}
    />,
  );
}

describe("FocusDriftSection", () => {
  it("renders a live empty chart frame instead of empty-state copy", () => {
    const chart = buildFocusDriftChart([], "2026-06-29", undefined, 4 * 60, 4 * 60);

    renderFocusDriftSection(chart);

    expect(screen.getByRole("group", { name: /focus and drift curves in progress/i })).toBeTruthy();
    expect(screen.queryByText("No focus pattern yet")).toBeNull();
    expect(screen.queryByText("Not enough data yet")).toBeNull();
  });

  it("renders replay reveal with completed line geometry and a reveal marker", () => {
    const chart = applyFocusDriftReplayReveal({
      chart: buildFocusDriftChart([focusSegment()], "2026-06-29"),
      revealMinuteOfDay: 12 * 60,
      startOfDayMinutes: 0,
    });

    const { container } = renderFocusDriftSection(chart);

    expect(screen.getByRole("group", { name: /focus and drift curves replaying through 12:00 pm/i })).toBeTruthy();
    expect(container.querySelector(".focus-drift--reveal")).toBeTruthy();
    expect(container.querySelector(".focus-drift__future-region")).toBeNull();
    expect(container.querySelector(".focus-drift__plot")?.getAttribute("style")).toContain("--focus-drift-now-x: 50%");
    expect(container.querySelector(".focus-drift__now-marker--replay")).toBeTruthy();
    expect(container.querySelector("#focus-drift-chart-reveal rect")?.getAttribute("width")).toBe("47.5");
    expect(container.querySelector("g")?.getAttribute("clip-path") ?? container.querySelector("g")?.getAttribute("clipPath")).toBe("url(#focus-drift-chart-reveal)");
  });
});
