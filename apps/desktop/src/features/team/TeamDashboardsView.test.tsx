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
    projects: [project],
    mix: [{ organization_id: "team-1", organization_project_id: "project-1", project_name: "Release notes", project_color: "#6366f1", project_status: "active", activity_date: "2026-10-05", seconds: 2040 }],
    members: [
      { organization_id: "team-1", organization_project_id: "project-1", project_name: "Release notes", member_display_name: "Alex", seconds: 240 },
      { organization_id: "team-1", organization_project_id: "project-1", project_name: "Release notes", member_display_name: "Aria", seconds: 1800 },
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
});
