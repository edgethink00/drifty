// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActivitySegment, Project } from "@drifty/domain";
import { ProjectDayEnergyChart } from "./ProjectDayEnergyChart";

const DAY = "2026-07-05";

function makeSegment(overrides: Partial<ActivitySegment> & Pick<ActivitySegment, "id" | "startedAt" | "durationSeconds">): ActivitySegment {
  const startedMs = new Date(overrides.startedAt).getTime();
  return {
    endedAt: new Date(startedMs + overrides.durationSeconds * 1000).toISOString(),
    appName: "Code",
    platform: "macos",
    source: "nsworkspace",
    ...overrides,
  };
}

function makeProject(id: string, name: string, color: string): Project {
  return {
    id,
    name,
    description: "",
    color,
    status: "active",
    anchors: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

const PROJECTS: Project[] = [
  makeProject("pa", "Aurora", "#5f7f31"),
  makeProject("pb", "Borealis", "#486078"),
];

// Two projects across two adjacent 30-minute windows, plus one unassigned
// segment that must fall into the trailing "No project" band.
const SEGMENTS: ActivitySegment[] = [
  makeSegment({ id: "s1", startedAt: "2026-07-05T09:00:00", durationSeconds: 600 }),
  makeSegment({ id: "s2", startedAt: "2026-07-05T09:45:00", durationSeconds: 600 }),
  makeSegment({ id: "s3", startedAt: "2026-07-05T10:15:00", durationSeconds: 300 }),
];

const ASSIGNMENTS = new Map<string, string>([
  ["s1", "pa"],
  ["s2", "pb"],
]);

describe("ProjectDayEnergyChart", () => {
  it("renders a legend for both projects plus the No project band", () => {
    render(
      <ProjectDayEnergyChart
        segments={SEGMENTS}
        projectBySegmentId={ASSIGNMENTS}
        projects={PROJECTS}
        day={DAY}
      />,
    );

    expect(screen.getByText("Aurora")).toBeTruthy();
    expect(screen.getByText("Borealis")).toBeTruthy();
    expect(screen.getByText("No project")).toBeTruthy();
  });

  it("draws one stacked band path per active series", () => {
    const { container } = render(
      <ProjectDayEnergyChart
        segments={SEGMENTS}
        projectBySegmentId={ASSIGNMENTS}
        projects={PROJECTS}
        day={DAY}
      />,
    );

    // Aurora + Borealis + No project = 3 bands.
    expect(container.querySelectorAll("path.project-day-energy__band")).toHaveLength(3);
  });

  it("shows the muted empty state when there are no segments", () => {
    render(
      <ProjectDayEnergyChart
        segments={[]}
        projectBySegmentId={new Map()}
        projects={PROJECTS}
        day={DAY}
      />,
    );

    expect(screen.getByText("No project activity for this day yet.")).toBeTruthy();
    expect(document.querySelector("path.project-day-energy__band")).toBeNull();
  });
});
