// @vitest-environment jsdom
import type { ActivitySegment } from "@drifty/domain";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
      appIcons={{}}
      chart={chart}
    />,
  );
}

describe("FocusDriftSection", () => {
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
