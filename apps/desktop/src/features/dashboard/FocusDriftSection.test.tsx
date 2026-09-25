// @vitest-environment jsdom
import type { ActivitySegment } from "@drifty/domain";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FocusDriftSection, FocusDriftSummaryTiles } from "./FocusDriftSection";
import {
  applyFocusDriftReplayReveal,
  buildFocusDriftChart,
  getSmoothPathPointAtX,
} from "./focusDriftChart";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";

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

function renderFocusDriftSection(chart: ReturnType<typeof buildFocusDriftChart>, language: DisplayLanguage = "en") {
  return render(
    <LocalizationTestProvider language={language}>
      <FocusDriftSection
        appIcons={{}}
        chart={chart}
      />
    </LocalizationTestProvider>,
  );
}

// A drift stretch after midnight on a logical day that starts at 04:00: the
// bucket sits 22 hours into the logical day but happens at 02:00 on the clock.
const LATE_START_OF_DAY_MINUTES = 4 * 60;

function lateNightDriftSegment(): ActivitySegment {
  return {
    id: "late-night-drift",
    startedAt: "2026-06-30T02:00:00",
    endedAt: "2026-06-30T02:30:00",
    durationSeconds: 30 * 60,
    appName: "Safari",
    bundleId: "com.apple.Safari",
    windowTitle: "Late feed",
    platform: "macos",
    source: "manual",
    classification: {
      category: "social_media",
      productivity: "drift",
      source: "manual",
      confidence: 1,
    },
  };
}

function unclassifiedSegment(): ActivitySegment {
  return {
    id: "unclassified-work",
    startedAt: "2026-06-29T10:00:00",
    endedAt: "2026-06-29T10:30:00",
    durationSeconds: 30 * 60,
    appName: "Unlabeled Tool",
    bundleId: "com.example.unlabeled-tool",
    windowTitle: "Untitled",
    platform: "macos",
    source: "manual",
  };
}

function renderDriftSummary(language: DisplayLanguage, segments: ActivitySegment[] = [lateNightDriftSegment()]) {
  const chart = buildFocusDriftChart(segments, "2026-06-29", undefined, null, LATE_START_OF_DAY_MINUTES);
  const view = render(
    <LocalizationTestProvider language={language}>
      <FocusDriftSummaryTiles
        activeHourCount={1}
        averageSessionMinutes={30}
        chart={chart}
        peakTrackedSeconds={30 * 60}
        peakWindowLabel="—"
        sessionCount={1}
        topAppLabel="Safari"
        totalSeconds={30 * 60}
        uniqueAppsCount={1}
        startOfDayMinutes={LATE_START_OF_DAY_MINUTES}
      />
    </LocalizationTestProvider>,
  );
  const tile = view.container.querySelector<HTMLElement>(".insight-summary__tile--drift");
  if (!tile) throw new Error("Drift tile did not render");
  return { chart, tile };
}

describe("FocusDriftSection", () => {
  it("shows the drift peak on the wall clock in the same format as the Peak tile", () => {
    const { chart, tile } = renderDriftSummary("en");

    expect(chart.peakDriftPoint?.bucketStartMinute).toBe(22 * 60);
    expect(within(tile).getByText("2:00 AM")).toBeTruthy();
    // The chart's 24-hour bucket key is not a display time.
    expect(within(tile).queryByText("02:00")).toBeNull();
  });

  it("keeps the Korean drift peak on the same wall clock", () => {
    const { tile } = renderDriftSummary("ko");

    // The exact Korean day-period text comes from the runtime's Intl data, so
    // assert the clock time itself: 2:00, not the 24-hour bucket key and not
    // the logical minute without the day-start offset (22:00 / 10:00).
    const value = tile.textContent ?? "";
    expect(value).toMatch(/(?:^|\D)2:00/u);
    expect(value).not.toMatch(/02:00|10:00|22:00/u);
  });

  it("keeps the Drift tile in its empty form on a classified day without drift", () => {
    // The tile once named the first focused window as the drift peak.
    const { chart, tile } = renderDriftSummary("en", [focusSegment()]);

    expect(chart.peakDriftPoint).toBeNull();
    expect(within(tile).getByText("\u2014")).toBeTruthy();
    expect(within(tile).getByText("No drift")).toBeTruthy();
    expect(within(tile).queryByText("peak")).toBeNull();
  });

  it("tells a day that is not classified yet apart from a day without drift", () => {
    const { chart, tile } = renderDriftSummary("ko", [unclassifiedSegment()]);

    expect(chart.peakDriftPoint).toBeNull();
    expect(within(tile).getByText("분류 전")).toBeTruthy();
    expect(within(tile).queryByText("딴짓 없음")).toBeNull();
  });

  it("keeps the Drift tile hidden on a day with nothing tracked", () => {
    const chart = buildFocusDriftChart([], "2026-06-29", undefined, null, LATE_START_OF_DAY_MINUTES);
    const { container } = render(
      <LocalizationTestProvider language="en">
        <FocusDriftSummaryTiles
          activeHourCount={0}
          averageSessionMinutes={0}
          chart={chart}
          peakTrackedSeconds={0}
          peakWindowLabel="—"
          sessionCount={0}
          topAppLabel="—"
          totalSeconds={0}
          uniqueAppsCount={0}
          startOfDayMinutes={LATE_START_OF_DAY_MINUTES}
        />
      </LocalizationTestProvider>,
    );

    expect(container.querySelector(".insight-summary__tile--drift")).toBeNull();
  });

  it("names chart points on the wall clock for keyboard and screen reader users", () => {
    const chart = buildFocusDriftChart([lateNightDriftSegment()], "2026-06-29", undefined, null, LATE_START_OF_DAY_MINUTES);
    render(
      <LocalizationTestProvider language="en">
        <FocusDriftSection appIcons={{}} chart={chart} startOfDayMinutes={LATE_START_OF_DAY_MINUTES} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("img", { name: /^Drift point for 2:00 AM\./ })).toBeTruthy();
    expect(screen.queryByRole("img", { name: /point for 02:00/ })).toBeNull();
  });

  it("renders the chart title and legend in natural Korean", () => {
    const chart = buildFocusDriftChart([focusSegment()], "2026-06-29");
    renderFocusDriftSection(chart, "ko");

    expect(screen.getByText("집중/딴짓 점수 · 30분 구간")).toBeTruthy();
    expect(screen.getByText("집중")).toBeTruthy();
    expect(screen.getByText("딴짓")).toBeTruthy();
  });

  it("renders a live empty chart frame instead of empty-state copy", () => {
    const chart = buildFocusDriftChart([], "2026-06-29", undefined, 4 * 60, 4 * 60);

    const { container } = renderFocusDriftSection(chart);

    expect(screen.getByRole("group", { name: /focus and drift curves in progress/i })).toBeTruthy();
    expect(screen.queryByText("No focus pattern yet")).toBeNull();
    expect(screen.queryByText("Not enough data yet")).toBeNull();
    expect(container.querySelector(".focus-drift__future-region")).toBeNull();
    expect(container.querySelector(".focus-drift__now-marker")).toBeNull();
    expect(container.querySelector(".focus-drift__line")).toBeNull();
    expect(container.querySelector(".focus-drift__area")).toBeNull();
    expect(container.querySelector(".focus-drift__plot")?.getAttribute("style")).not.toContain("--focus-drift-now-x");
  });

  it("shows the line hover card near tracked windows but not over the empty region", () => {
    const chart = buildFocusDriftChart([focusSegment()], "2026-06-29");
    const { container } = renderFocusDriftSection(chart);
    const svg = container.querySelector<SVGSVGElement>(".focus-drift__svg");
    const lineTarget = container.querySelector(".focus-drift__line-target");
    if (!svg || !lineTarget) throw new Error("focus/drift chart svg or hover target missing");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));

    // The 6pm–7pm focus segment puts its two tracked windows near x≈74–76 with
    // a fully-focused line at the chart top (y=8).
    fireEvent.mouseMove(lineTarget, { clientX: 74, clientY: 8 });
    expect(container.querySelector(".focus-drift-hover-card")).toBeTruthy();
    const nearestTrackedPoint = chart.points
      .filter((point) => point.totalSeconds > 0)
      .reduce((nearest, point) => (Math.abs(point.x - 74) < Math.abs(nearest.x - 74) ? point : nearest));
    const dot = container.querySelector<HTMLElement>(".focus-drift__hover-dot");
    const visibleFocusMarker = getSmoothPathPointAtX(
      chart.points.filter((point) => !point.isFuture),
      "focusY",
      nearestTrackedPoint.x,
    );
    if (!dot || !visibleFocusMarker) throw new Error("focus hover dot or visible curve marker missing");
    expect(Number.parseFloat(dot.style.left)).toBeCloseTo(nearestTrackedPoint.x, 5);
    expect(Number.parseFloat(dot.style.top)).toBeCloseTo(visibleFocusMarker.y, 5);
    expect(container.querySelector('circle[role="button"]')).toBeNull();
    expect(container.querySelector('circle[role="img"]')).toBeTruthy();

    // Far to the right of the last tracked window, the same y no longer snaps.
    fireEvent.mouseMove(lineTarget, { clientX: 95, clientY: 8 });
    expect(container.querySelector(".focus-drift-hover-card")).toBeNull();
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
    expect(container.querySelector(".focus-drift__plot")?.getAttribute("style")).toContain("--focus-drift-chart-left: 4.5%");
    expect(container.querySelector(".focus-drift__now-marker--replay")).toBeTruthy();
    expect(container.querySelector("#focus-drift-chart-reveal rect")?.getAttribute("x")).toBe("2");
    expect(container.querySelector("#focus-drift-chart-reveal rect")?.getAttribute("width")).toBe("48");
    expect(container.querySelector("g")?.getAttribute("clip-path") ?? container.querySelector("g")?.getAttribute("clipPath")).toBe("url(#focus-drift-chart-reveal)");
  });
});
