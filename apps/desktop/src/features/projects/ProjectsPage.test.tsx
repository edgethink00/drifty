// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { ProjectsPage, type ProjectsPageProps } from "./ProjectsPage";

function baseProps(overrides: Partial<ProjectsPageProps> = {}): ProjectsPageProps {
  return {
    projects: [],
    assignments: [],
    selectedDay: "2026-07-08",
    startOfDayMinutes: 240,
    daySegments: [],
    dayProjectBySegmentId: new Map(),
    trendSegments: [],
    trendProjectBySegmentId: new Map(),
    projectsLoading: false,
    running: false,
    runError: null,
    analysisConnected: true,
    analysisSetup: DEFAULT_ANALYSIS_AI_SETUP,
    consentOpen: false,
    consentProviderLabel: "Custom endpoint",
    onConfigureModel: vi.fn(),
    onSaveProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onAddAnchor: vi.fn(),
    onDeleteAnchor: vi.fn(),
    onRunAnalysis: vi.fn(),
    onConsentConfirm: vi.fn(),
    onConsentCancel: vi.fn(),
    ...overrides,
  };
}

describe("ProjectsPage", () => {
  it("shows that project-pass titles are excluded in the consent modal", () => {
    render(<ProjectsPage {...baseProps({ consentOpen: true })} />);

    expect(screen.getByRole("dialog", { name: /Turn on project analysis/i })).toBeTruthy();
    expect(screen.getByText(/compacted 3-minute activity-window summary/i)).toBeTruthy();
    expect(screen.getByText(/titles are excluded/i)).toBeTruthy();
  });

  it("keeps analysis loading on the button instead of showing chunk progress", () => {
    render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          running: true,
        })}
      />,
    );

    const analyzeButton = screen.getByRole("button", { name: "Analyzing…" });
    expect(analyzeButton).toHaveProperty("disabled", true);
    expect(screen.queryByText(/chunk 1 of 3/i)).toBeNull();
    expect(screen.queryByRole("status", { name: /Analyzing your activity/i })).toBeNull();
  });
});
