// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamDashboardsView, type TeamDashboardsViewProps } from "./TeamDashboardsView";
import type { TeamProject } from "./teamTypes";

const project: TeamProject = {
  id: "project-1",
  organization_id: "team-1",
  name: "Release notes",
  description: "Shared project",
  color: "#6366f1",
  status: "active",
  anchors: [],
  can_manage: true,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

function props(overrides: Partial<TeamDashboardsViewProps> = {}): TeamDashboardsViewProps {
  return {
    window: { start_date: "2026-09-29", end_date: "2026-10-05" },
    isLatestWindow: true,
    projects: [project],
    mix: [{ organization_id: "team-1", organization_project_id: "project-1", project_name: "Release notes", project_color: "#6366f1", project_status: "active", activity_date: "2026-10-05", seconds: 2040 }],
    members: [
      { organization_id: "team-1", organization_project_id: "project-1", project_name: "Release notes", member_display_name: "Alex", member_slot: 1, is_self: true, seconds: 240 },
      { organization_id: "team-1", organization_project_id: "project-1", project_name: "Release notes", member_display_name: "Aria", member_slot: 2, is_self: false, seconds: 1800 },
    ],
    memberCount: 2,
    memberDisplayName: "Alex",
    loading: false,
    error: null,
    publishNote: null,
    onRefresh: vi.fn(),
    ...overrides,
  };
}

describe("TeamDashboardsView", () => {
  it("never shows more members sharing than the team has while the member count lags a join", () => {
    const { rerender } = render(<LocalizationTestProvider language="en"><TeamDashboardsView {...props()} /></LocalizationTestProvider>);
    expect(screen.getByText("2 of 2")).toBeTruthy();

    rerender(<LocalizationTestProvider language="en"><TeamDashboardsView {...props({ memberCount: 1 })} /></LocalizationTestProvider>);
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.queryByText("2 of 1")).toBeNull();

    rerender(<LocalizationTestProvider language="en"><TeamDashboardsView {...props({ memberCount: 3 })} /></LocalizationTestProvider>);
    expect(screen.getByText("2 of 3")).toBeTruthy();
  });

  it("keeps two members who share under the same name apart and marks only the caller", () => {
    const row = { organization_id: "team-1", organization_project_id: "project-1", project_name: "Release notes", member_display_name: "alex" };
    render(
      <LocalizationTestProvider language="en">
        <TeamDashboardsView
          {...props({
            memberCount: 2,
            memberDisplayName: "alex",
            members: [
              { ...row, member_slot: 1, is_self: false, seconds: 1200 },
              { ...row, member_slot: 2, is_self: true, seconds: 840 },
            ],
          })}
        />
      </LocalizationTestProvider>,
    );
    expect(screen.getAllByText("alex")).toHaveLength(2);
    expect(screen.getAllByText("You")).toHaveLength(1);
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("still groups by name when an older server sends no member slot", () => {
    const row = { organization_id: "team-1", organization_project_id: "project-1", project_name: "Release notes", member_slot: null, is_self: null };
    render(
      <LocalizationTestProvider language="en">
        <TeamDashboardsView
          {...props({
            members: [
              { ...row, member_display_name: "Alex", seconds: 240 },
              { ...row, member_display_name: "Aria", seconds: 1800 },
            ],
          })}
        />
      </LocalizationTestProvider>,
    );
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.getAllByText("You")).toHaveLength(1);
  });

  it("names an earlier window by its dates instead of calling it the last 7 days", () => {
    const { rerender } = render(<LocalizationTestProvider language="en"><TeamDashboardsView {...props()} /></LocalizationTestProvider>);
    expect(screen.getByText("Shared · Last 7 days")).toBeTruthy();

    rerender(<LocalizationTestProvider language="en"><TeamDashboardsView {...props({ isLatestWindow: false })} /></LocalizationTestProvider>);
    expect(screen.queryByText(/Last 7 days/)).toBeNull();
    expect(screen.getByText(/^Shared · Sep 29/)).toBeTruthy();
  });

  it("draws the overview with the shared project bars, so a single day is one bar", () => {
    render(
      <LocalizationTestProvider language="en">
        <TeamDashboardsView {...props({ window: { start_date: "2026-10-05", end_date: "2026-10-05" } })} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByRole("img", { name: /stacked by project/i })).toBeTruthy();
    expect(document.querySelectorAll(".ptc-bars__stack")).toHaveLength(1);
    expect(document.querySelector(".ptc-area")).toBeNull();
  });
});
