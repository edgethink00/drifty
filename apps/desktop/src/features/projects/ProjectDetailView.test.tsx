// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment, Project } from "@drifty/domain";

import { ProjectDetailView, type ProjectDetailViewProps } from "./ProjectDetailView";

function seg(id: string, startedAt: string, durationSeconds: number, extra: Partial<ActivitySegment> = {}): ActivitySegment {
  return { id, startedAt, endedAt: startedAt, durationSeconds, appName: "Visual Studio Code", ...extra } as ActivitySegment;
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

const SEGMENTS: ActivitySegment[] = [
  seg("s1", "2026-07-10T09:00:00", 3600),
  seg("s2", "2026-07-10T11:00:00", 1800, { appName: "Safari", siteDomain: "github.com" }),
  seg("s3", "2026-07-11T10:00:00", 600, { appName: "Figma" }), // other project → excluded
];

const ATTRIBUTION = new Map<string, string>([
  ["s1", "p1"],
  ["s2", "p1"],
  ["s3", "p2"],
]);

function baseProps(overrides: Partial<ProjectDetailViewProps> = {}): ProjectDetailViewProps {
  return {
    project: PROJECT,
    trendSegments: SEGMENTS,
    trendProjectBySegmentId: ATTRIBUTION,
    trendReady: true,
    windowDays: 7,
    startDay: "2026-07-05",
    endDay: "2026-07-11",
    isDayMode: false,
    startOfDayMinutes: 0,
    totalCaption: "Last 7 days",
    windowLabel: "Jul 5 – Jul 11",
    totalSeconds: 5400,
    windowProjectSeconds: 6000,
    lastActivityLabel: "Jul 10, 2026",
    onEdit: vi.fn(),
    ...overrides,
  };
}

describe("ProjectDetailView", () => {
  it("opens the category editor from Edit", () => {
    const props = baseProps();
    render(<ProjectDetailView {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the project header, window stats, and share", () => {
    render(<ProjectDetailView {...baseProps()} />);

    expect(screen.getByText("Project overview")).toBeTruthy();
    expect(screen.getByText("The Drifty desktop app.")).toBeTruthy();
    expect(screen.getByText("1h 30m")).toBeTruthy();
    expect(screen.getByText("90%")).toBeTruthy();
    expect(screen.getByText("Jul 10, 2026")).toBeTruthy();
  });

  it("ranks top sources from only this project's segments", () => {
    render(<ProjectDetailView {...baseProps()} />);

    const sources = screen.getByRole("region", { name: "Top sources for Drifty" });
    const labels = within(sources).getAllByText(/Visual Studio Code|github\.com/).map((node) => node.textContent);
    expect(labels).toContain("Visual Studio Code");
    expect(labels).toContain("github.com");
    expect(within(sources).queryByText("Figma")).toBeNull();
  });

  it("shows how the window compares with the one before", () => {
    render(<ProjectDetailView {...baseProps({ comparison: "+1h vs. the previous 7 days" })} />);
    expect(screen.getByText("+1h vs. the previous 7 days").className).toContain("is-up");
  });

  it("leaves archiving and deleting to the category editor", () => {
    render(<ProjectDetailView {...baseProps()} />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull();
  });
});
