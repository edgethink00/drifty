// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";

import { DEFAULT_ANALYSIS_AI_SETUP } from "../settings/analysisModelSetup";
import { ProjectsPage, type ProjectsPageProps } from "./ProjectsPage";
import { IDLE_PROJECT_AUTO_ANALYSIS } from "./projectAutoAnalysisState";
import { NO_PROJECT_MATCH_COOLDOWN } from "./projectMatchCooldown";

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
    trendLoadedRange: null,
    projectsLoading: false,
    running: false,
    runError: null,
    analysisConnected: true,
    analysisSetup: DEFAULT_ANALYSIS_AI_SETUP,
    autoAnalysis: IDLE_PROJECT_AUTO_ANALYSIS,
    matchCooldown: NO_PROJECT_MATCH_COOLDOWN,
    onTrendWindowChange: vi.fn(),
    onConfigureModel: vi.fn(),
    onOpenTrends: vi.fn(),
    onSaveProject: vi.fn(),
    onDeleteProject: vi.fn(),
    onRunAnalysis: vi.fn(),
    ...overrides,
  };
}

describe("ProjectsPage", () => {
  it("keeps assignment refresh loading on the button instead of showing chunk progress", () => {
    render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          running: true,
        })}
      />,
    );

    const analyzeButton = screen.getByRole("button", { name: "Refreshing…" });
    expect(analyzeButton).toHaveProperty("disabled", true);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByText("Project model ready")).toBeNull();
    expect(screen.getByRole("group", { name: "Project matching model" }).textContent).toContain("without changing live activity classification");
    expect(screen.queryByText(/chunk 1 of 3/i)).toBeNull();
    expect(screen.queryByRole("status", { name: /Analyzing your activity/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Explore in Insights/i })).toBeTruthy();
  });

  it("reports automatic matching on the model card while a new project is analyzed", () => {
    render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          running: true,
          autoAnalysis: { p1: "running" },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Matching…" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Matching")).toBeTruthy();
  });

  it("explains a paused automatic run instead of leaving the new project silent", () => {
    render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          autoAnalysis: { p1: "error" },
        })}
      />,
    );

    expect(screen.getByText(/Automatic matching paused/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry latest 7 days" })).toBeTruthy();
  });

  it("blocks a redundant refresh right after a completed pass", () => {
    const onRunAnalysis = vi.fn();
    render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          matchCooldown: { active: true, remainingSeconds: 72 },
          onRunAnalysis,
        })}
      />,
    );

    const action = screen.getByRole("button", { name: /Just matched/i });
    expect(action).toHaveProperty("disabled", true);
    fireEvent.click(action);
    expect(onRunAnalysis).not.toHaveBeenCalled();
    expect(screen.getByText(/already up to date/i)).toBeTruthy();
    // The readiness badge must not still claim "Ready" while the action is locked.
    expect(screen.getByText("Up to date")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("keeps a queued burst clickable even inside the cooldown window", () => {
    render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          autoAnalysis: { p1: "queued" },
          matchCooldown: { active: true, remainingSeconds: 30 },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Match now" })).toHaveProperty("disabled", false);
  });

  it("keeps a failed run retryable even inside the cooldown window", () => {
    render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#000", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          autoAnalysis: { p1: "error" },
          matchCooldown: { active: true, remainingSeconds: 30 },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Retry latest 7 days" })).toHaveProperty("disabled", false);
  });

  it("uses one seven-day window for the overview, project totals, and assignment refresh", () => {
    const onOpenTrends = vi.fn();
    const onTrendWindowChange = vi.fn();
    const trendSegments = [
      { id: "older", startedAt: "2026-06-28T09:00:00", endedAt: "2026-06-28T10:00:00", durationSeconds: 3600, appName: "App" },
      { id: "recent", startedAt: "2026-07-08T09:00:00", endedAt: "2026-07-08T11:00:00", durationSeconds: 7200, appName: "App" },
    ] as ActivitySegment[];
    render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#6366f1", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          trendSegments,
          trendProjectBySegmentId: new Map([["older", "p1"], ["recent", "p1"]]),
          trendLoadedRange: { startDay: "2026-07-02", endDay: "2026-07-08" },
          onTrendWindowChange,
          onOpenTrends,
        })}
      />,
    );

    expect(onTrendWindowChange).toHaveBeenCalledWith({ startDay: "2026-07-02", endDay: "2026-07-08" });
    expect(screen.getByRole("region", { name: /Latest 7 days project overview/i })).toBeTruthy();
    const projectTable = screen.getByRole("region", { name: "Projects" });
    expect(within(projectTable).getByText("Time · Latest 7 days")).toBeTruthy();
    expect(within(projectTable).getByText("2h")).toBeTruthy();
    expect(within(projectTable).queryByText("3h")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Explore in Insights/i }));
    expect(onOpenTrends).toHaveBeenCalledTimes(1);
  });

  it("pairs the project overview with a compact, non-pill model readiness card", () => {
    const onTrendWindowChange = vi.fn();
    const trendSegments = [
      { id: "recent", startedAt: "2026-07-08T09:00:00", endedAt: "2026-07-08T11:00:00", durationSeconds: 7200, appName: "App" },
    ] as ActivitySegment[];
    const { container } = render(
      <ProjectsPage
        {...baseProps({
          projects: [{ id: "p1", name: "Drifty", description: "Mac app", color: "#6366f1", status: "active", anchors: [], createdAt: "", updatedAt: "" }],
          trendSegments,
          trendProjectBySegmentId: new Map([["recent", "p1"]]),
          trendLoadedRange: { startDay: "2026-07-02", endDay: "2026-07-08" },
          onTrendWindowChange,
        })}
      />,
    );

    expect(onTrendWindowChange).toHaveBeenCalledWith({ startDay: "2026-07-02", endDay: "2026-07-08" });
    expect(screen.getByRole("region", { name: /Latest 7 days project overview/i })).toBeTruthy();
    expect(container.querySelector(".projects-overview-layout")).toBeTruthy();
    expect(container.querySelectorAll(".projects-model-status")).toHaveLength(1);
    expect(screen.getByText("Refresh scope")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(container.querySelector(".projects-model-status__readiness-dot")).toBeTruthy();
    expect(container.querySelector(".projects-model-status__chip")).toBeNull();
    expect(screen.queryByText(/latest 14 days/i)).toBeNull();
  });

  it("keeps project action errors visible in both the library and project detail", () => {
    const project = { id: "p1", name: "Drifty", description: "Mac app", color: "#6366f1", status: "active" as const, anchors: [], createdAt: "", updatedAt: "" };
    render(<ProjectsPage {...baseProps({ projects: [project], runError: "Could not save the project." })} />);

    expect(screen.getByRole("alert").textContent).toBe("Could not save the project.");
    fireEvent.click(screen.getByRole("button", { name: "Open Drifty project" }));
    expect(screen.getByRole("alert").textContent).toBe("Could not save the project.");
  });
});
