// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment, Project, ProjectWindowAssignmentRecord } from "@drifty/domain";

import { ProjectDetailView, type ProjectDetailViewProps } from "./ProjectDetailView";

function seg(id: string, startedAt: string, durationSeconds: number, extra: Partial<ActivitySegment> = {}): ActivitySegment {
  const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();
  return { id, startedAt, endedAt, durationSeconds, appName: "Visual Studio Code", ...extra } as ActivitySegment;
}

const PROJECT: Project = {
  id: "p1",
  name: "Drifty",
  description: "The Drifty desktop app.",
  color: "#6366f1",
  status: "active",
  anchors: [],
  createdAt: "",
  updatedAt: "",
};

const WINDOW: ActivitySegment[] = [
  seg("s1", "2026-07-10T09:00:00", 1800, { windowTitle: "DashboardPage.tsx — drifty" }),
  seg("s2", "2026-07-10T09:30:00", 1800, { appName: "Safari", siteDomain: "github.com", siteTitle: "Pull request #12", windowTitle: "Pull request #12" }),
  // More than twenty minutes later: a session of its own, recorded without titles.
  seg("s3", "2026-07-10T14:00:00", 1200, { appName: "Figma" }),
  seg("s4", "2026-07-11T10:00:00", 600, { appName: "Notion", windowTitle: "Other project notes" }),
];
const PREVIOUS: ActivitySegment[] = [seg("before", "2026-07-01T10:00:00", 1800)];

const ATTRIBUTION = new Map<string, string>([
  ["s1", "p1"],
  ["s2", "p1"],
  ["s3", "p1"],
  ["s4", "p2"],
  ["before", "p1"],
]);

const WINDOW_MATCH: ProjectWindowAssignmentRecord = {
  windowId: "w1",
  windowStartedAt: new Date("2026-07-10T09:00:00").toISOString(),
  windowEndedAt: new Date("2026-07-10T09:30:00").toISOString(),
  durationSeconds: 1800,
  segmentOverlaps: [{ segmentId: "s1", durationSeconds: 1800 }],
  projectId: "p1",
  teamProjectId: null,
  source: "ai",
  confidence: 0.8,
  reason: "Edits the Drifty dashboard",
} as ProjectWindowAssignmentRecord;

function baseProps(overrides: Partial<ProjectDetailViewProps> = {}): ProjectDetailViewProps {
  return {
    project: PROJECT,
    windowSegments: WINDOW,
    previousSegments: PREVIOUS,
    historySegments: [...PREVIOUS, ...WINDOW],
    projectBySegmentId: ATTRIBUTION,
    assignmentSources: {
      assignments: [{ segmentId: "s2", projectId: "p1", source: "ai", confidence: 0.6 }],
      windowAssignments: [WINDOW_MATCH],
      sourceSegmentIdBySliceId: new Map(),
    },
    appIcons: {},
    trendReady: true,
    rangeMode: "week",
    startDay: "2026-07-05",
    endDay: "2026-07-11",
    totalCaption: "Last 7 days",
    onEdit: vi.fn(),
    ...overrides,
  };
}

const block = () => screen.getByRole("complementary", { name: "About this project" });
const log = () => screen.getByRole("region", { name: /Work/ });

describe("ProjectDetailView", () => {
  it("opens the category editor from Edit beside the description", () => {
    const props = baseProps();
    render(<ProjectDetailView {...props} />);
    expect(within(block()).getByText("The Drifty desktop app.")).toBeTruthy();
    fireEvent.click(within(block()).getByRole("button", { name: "Edit" }));
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("leads with the window's time and one change against the window before", () => {
    render(<ProjectDetailView {...baseProps()} />);
    const headline = screen.getByRole("banner");
    expect(within(headline).getByText("1h 20m")).toBeTruthy();
    expect(within(headline).getByText("50m more than the previous 7 days")).toBeTruthy();
  });

  it("names each session by its titles, and by its apps and sites when none were recorded", () => {
    render(<ProjectDetailView {...baseProps()} />);
    const sessions = within(log()).getAllByRole("button", { pressed: false });
    expect(sessions).toHaveLength(2);
    // A day's sessions read in the order they happened.
    expect(sessions[0]!.textContent).toContain("DashboardPage.tsx — drifty");
    expect(sessions[0]!.textContent).toContain("Pull request #12");
    expect(sessions[1]!.textContent).toContain("Figma");
    expect(sessions[1]!.textContent?.match(/Figma/g)).toHaveLength(1);
    // Another project's record stays out of the log and the block.
    expect(screen.queryByText("Other project notes")).toBeNull();
    expect(within(block()).queryByText("Notion")).toBeNull();
  });

  it("opens a picked day in the block and returns to the project from All", () => {
    render(<ProjectDetailView {...baseProps()} />);
    const bar = screen.getByRole("button", { name: /Jul 10/ });
    fireEvent.click(bar);
    expect(bar.getAttribute("aria-pressed")).toBe("true");
    expect(within(block()).getByText("2 sessions")).toBeTruthy();
    expect(within(block()).queryByText("Top apps and sites")).toBeNull();

    fireEvent.click(within(block()).getByRole("button", { name: "All" }));
    expect(within(block()).getByText("Top apps and sites")).toBeTruthy();
    expect(bar.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a picked session's records and why they belong to the project", () => {
    render(<ProjectDetailView {...baseProps()} />);
    fireEvent.click(within(log()).getByRole("button", { name: /DashboardPage\.tsx/ }));

    expect(within(block()).getByText("Selected session")).toBeTruthy();
    expect(within(block()).getByText("9:00–10:00 AM")).toBeTruthy();
    // The window match and the legacy record weigh in by time: (80% + 60%) / 2.
    expect(within(block()).getByText("Matched by AI · 70% confident")).toBeTruthy();
    expect(within(block()).getByText("Edits the Drifty dashboard")).toBeTruthy();
    // The log keeps every session; the chosen one is marked.
    expect(within(log()).getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(within(log()).getAllByRole("button", { pressed: false })).toHaveLength(1);

    fireEvent.click(within(block()).getByRole("button", { name: "All" }));
    expect(within(block()).queryByText("Selected session")).toBeNull();
  });

  it("compares the latest week with the average since the project's first record", () => {
    render(<ProjectDetailView {...baseProps()} />);
    expect(within(block()).getByText("Last 8 weeks")).toBeTruthy();
    expect(within(block()).getByText("Avg 30m")).toBeTruthy();
    expect(within(block()).getByText("+50m").closest("p")?.textContent).toBe("Last 7 days vs. average: +50m");
  });

  it("holds the layout with placeholders while the window loads", () => {
    const { container } = render(<ProjectDetailView {...baseProps({ trendReady: false })} />);
    expect(container.querySelector(".pd-layout")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll(".pd-kpi .loading-skeleton-text").length).toBe(8);
    expect(screen.queryByText("No time in this range")).toBeNull();
    // The description and its Edit are known before the activity arrives.
    expect(within(block()).getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("says when the project was last recorded instead of drawing an empty window", () => {
    render(<ProjectDetailView {...baseProps({ windowSegments: [], startDay: "2026-07-12", endDay: "2026-07-18" })} />);
    expect(screen.getByText(/Nothing matched to this project/)).toBeTruthy();
    expect(screen.getByText(/Last recorded on .*Jul 10/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Work log" })).toBeNull();
  });

  it("names the eight weeks it searched when the project has no record in them", () => {
    const { container } = render(<ProjectDetailView {...baseProps({ windowSegments: [], previousSegments: [], historySegments: [], startDay: "2026-07-12", endDay: "2026-07-18" })} />);
    expect(screen.getByText("No time matched to this project in the last 8 weeks")).toBeTruthy();
    // No scale is drawn over an empty chart.
    expect(container.querySelectorAll(".pd-datebars .ptc-bars__gridline")).toHaveLength(0);
  });
});
