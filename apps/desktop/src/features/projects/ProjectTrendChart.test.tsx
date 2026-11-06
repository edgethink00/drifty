// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActivitySegment, Project } from "@drifty/domain";

import { ProjectTrendChart } from "./ProjectTrendChart";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

// Local (no "Z") midday timestamps so each segment buckets into the expected
// calendar day regardless of the test machine's timezone.
function seg(id: string, startedAt: string, durationSeconds: number): ActivitySegment {
  return { id, startedAt, endedAt: startedAt, durationSeconds, appName: "App" } as ActivitySegment;
}

function project(id: string, name: string, color: string): Project {
  return {
    id,
    name,
    description: "",
    color,
    status: "active",
    anchors: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

const PROJECTS: Project[] = [
  project("p-alpha", "Project Alpha", "#3b82f6"),
  project("p-beta", "Project Beta", "#ef4444"),
];

// Segments spanning three days across two projects plus one unassigned segment.
const SEGMENTS: ActivitySegment[] = [
  seg("s1", "2026-07-04T09:00:00", 3600), // Alpha
  seg("s2", "2026-07-05T10:00:00", 1800), // Beta
  seg("s3", "2026-07-06T11:00:00", 2400), // Alpha
  seg("s4", "2026-07-06T13:00:00", 1200), // unassigned → No project
];

const ASSIGNMENTS = new Map<string, string>([
  ["s1", "p-alpha"],
  ["s2", "p-beta"],
  ["s3", "p-alpha"],
  // s4 intentionally left unassigned
]);

describe("ProjectTrendChart", () => {
  it("renders a pill legend with both projects and a No project band", () => {
    render(
      <ProjectTrendChart
        segments={SEGMENTS}
        projectBySegmentId={ASSIGNMENTS}
        projects={PROJECTS}
        days={7}
        endDay="2026-07-06"
      />,
    );

    expect(screen.getByText("Project Alpha")).toBeTruthy();
    expect(screen.getByText("Project Beta")).toBeTruthy();
    expect(screen.getByText("No project")).toBeTruthy();
  });

  it("names the No project band in the display language", () => {
    render(
      <LocalizationTestProvider language="ko">
        <ProjectTrendChart
          segments={SEGMENTS}
          projectBySegmentId={ASSIGNMENTS}
          projects={PROJECTS}
          days={7}
          endDay="2026-07-06"
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByText("프로젝트 없음")).toBeTruthy();
    expect(screen.queryByText("No project")).toBeNull();
  });

  it("renders the library overview as a compact 14-day fixed-window panel", () => {
    const { container } = render(
      <ProjectTrendChart
        segments={SEGMENTS}
        projectBySegmentId={ASSIGNMENTS}
        projects={PROJECTS}
        days={14}
        endDay="2026-07-06"
        variant="overview"
      />,
    );

    expect(document.querySelector(".ptc-panel .insight-panel-head .label-mono")?.textContent).toMatch(/Project allocation · latest 14 days/i);
    expect(container.querySelector(".ptc-panel--overview")).toBeTruthy();
    expect(container.querySelectorAll(".ptc-bars__column")).toHaveLength(14);
    expect(container.querySelectorAll(".ptc-bars__vline")).toHaveLength(13);
    expect(screen.getByText("6/23")).toBeTruthy();
    expect(screen.getByText("7/6")).toBeTruthy();
    expect(container.querySelectorAll(".ptc-area")).toHaveLength(0);
    expect(screen.getByRole("img", { name: /Project Alpha 1h/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /No project 20m/i })).toBeTruthy();
  });

  it("draws one smooth stacked area band (fill + line) per active series", () => {
    const { container } = render(
      <ProjectTrendChart
        segments={SEGMENTS}
        projectBySegmentId={ASSIGNMENTS}
        projects={PROJECTS}
        days={7}
        endDay="2026-07-06"
      />,
    );

    // Project Alpha + Project Beta + No project → three stacked bands.
    expect(container.querySelectorAll(".ptc-area")).toHaveLength(3);
    expect(container.querySelectorAll(".ptc-line")).toHaveLength(3);
    // The area path is a smooth curve (uses cubic-bezier "C" commands), not a polyline.
    const firstArea = container.querySelector(".ptc-area");
    expect(firstArea?.getAttribute("d")).toContain("C");
  });

  it("labels every day on the x-axis, not every third", () => {
    render(
      <ProjectTrendChart
        segments={SEGMENTS}
        projectBySegmentId={ASSIGNMENTS}
        projects={PROJECTS}
        days={7}
        endDay="2026-07-06"
      />,
    );

    // Every day in the selected seven-day window stays visible, including idle days.
    expect(screen.getByText("6/30")).toBeTruthy();
    expect(screen.getByText("7/4")).toBeTruthy();
    expect(screen.getByText("7/5")).toBeTruthy();
    expect(screen.getByText("7/6")).toBeTruthy();
  });

  it("defaults to a 14-day window when days is omitted", () => {
    // A segment ~9 days before endDay is inside the default 14-day window but
    // outside a 7-day one; the fitted span reaching back to it proves the default.
    const withOld: ActivitySegment[] = [seg("s0", "2026-06-27T09:00:00", 1800), ...SEGMENTS];
    const withOldAssign = new Map<string, string>([...ASSIGNMENTS, ["s0", "p-alpha"]]);
    render(
      <ProjectTrendChart
        segments={withOld}
        projectBySegmentId={withOldAssign}
        projects={PROJECTS}
        endDay="2026-07-06"
      />,
    );

    // The oldest active day is only in range under the 14-day default, and the
    // eyebrow keeps the complete selected calendar span.
    expect(screen.getByText("6/27")).toBeTruthy();
    expect(screen.getByText(/6\/23 – 7\/6/)).toBeTruthy();
  });

  it("preserves idle days at the edges of the selected window", () => {
    // 14-day window ending 7/6, but the segments only cover 7/4–7/6.
    render(
      <ProjectTrendChart
        segments={SEGMENTS}
        projectBySegmentId={ASSIGNMENTS}
        projects={PROJECTS}
        days={14}
        endDay="2026-07-06"
      />,
    );

    expect(screen.getByText(/6\/23 – 7\/6/)).toBeTruthy();
    expect(screen.getByText("6/23")).toBeTruthy();
  });

  it("omits the No project band when every segment is assigned", () => {
    const allAssigned = new Map<string, string>([...ASSIGNMENTS, ["s4", "p-beta"]]);
    const { container } = render(
      <ProjectTrendChart
        segments={SEGMENTS}
        projectBySegmentId={allAssigned}
        projects={PROJECTS}
        days={7}
        endDay="2026-07-06"
      />,
    );

    expect(screen.getByText("Project Alpha")).toBeTruthy();
    expect(screen.queryByText("No project")).toBeNull();
    expect(container.querySelectorAll(".ptc-area")).toHaveLength(2);
  });

  it("uses one honest y-axis for project and unassigned time", () => {
    // 1h of project time under a 5h unassigned pile on the same day.
    const segs: ActivitySegment[] = [
      seg("p1", "2026-07-06T09:00:00", 3600), // 1h → Alpha
      seg("n1", "2026-07-06T11:00:00", 18000), // 5h → unassigned
    ];
    render(
      <ProjectTrendChart
        segments={segs}
        projectBySegmentId={new Map([["p1", "p-alpha"]])}
        projects={PROJECTS}
        days={7}
        endDay="2026-07-06"
      />,
    );

    // The six-hour stacked total drives the scale, so the gray band is comparable
    // with the project band instead of being clamped at the chart ceiling.
    expect(screen.getByText("1.5h")).toBeTruthy();
    expect(screen.getByText("6h")).toBeTruthy();
    expect(screen.getByText("No project")).toBeTruthy();
  });

  it("shows an empty state and no area bands when there are no segments", () => {
    const { container } = render(
      <ProjectTrendChart
        segments={[]}
        projectBySegmentId={new Map()}
        projects={PROJECTS}
        days={7}
        endDay="2026-07-06"
      />,
    );

    expect(screen.getByText(/No project activity in this range yet/i)).toBeTruthy();
    expect(container.querySelectorAll(".ptc-area")).toHaveLength(0);
  });

  it("renders the intraday (Day mode) view through the same panel with minute ticks and hour x-labels", () => {
    const daySegments: ActivitySegment[] = [
      seg("d1", "2026-07-06T09:05:00", 600), // Alpha, 09:00–09:30 window
      seg("d2", "2026-07-06T09:40:00", 300), // Beta, 09:30–10:00 window
      seg("d3", "2026-07-06T11:10:00", 900), // unassigned
    ];
    const dayAssignments = new Map<string, string>([
      ["d1", "p-alpha"],
      ["d2", "p-beta"],
    ]);
    const { container } = render(
      <ProjectTrendChart
        segments={daySegments}
        projectBySegmentId={dayAssignments}
        projects={PROJECTS}
        days={1}
        endDay="2026-07-06"
        intraday
        startOfDayMinutes={0}
      />,
    );

    // Same ptc panel family as Week/Month.
    expect(container.querySelector(".ptc-panel")).toBeTruthy();
    expect(container.querySelectorAll("path.ptc-area").length).toBe(3);
    // Minute-scale y ticks (busiest window is 15m → 5m steps).
    const scale = [...container.querySelectorAll(".ptc-scale span")].map((node) => node.textContent);
    expect(scale).toEqual(["5m", "10m", "15m"]);
    // X axis labels cover the complete logical day.
    const axis = [...container.querySelectorAll(".ptc-axis span")].map((node) => node.textContent);
    expect(axis.length).toBeGreaterThan(0);
    expect(axis.every((label) => /(am|pm)/i.test(label ?? ""))).toBe(true);
    expect(axis).toContain("12am");
  });
});
