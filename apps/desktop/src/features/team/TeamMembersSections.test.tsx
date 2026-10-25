// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamFocusByDayPanel } from "./TeamMembersSections";
import { buildTeamOverviewModel, type TeamProjectShare } from "./teamFocusModel";
import { buildTeamPreviewFixture } from "./teamPreviewScenarios";

vi.mock("./TeamFocusParts", async (original) => ({
  ...await original<typeof import("./TeamFocusParts")>(),
  TeamTrendChart: ({ days, ariaLabel }: { days: readonly { shares: readonly TeamProjectShare[] }[]; ariaLabel: string }) => (
    <div role="img" aria-label={ariaLabel}>
      {days.flatMap((day) => day.shares).map((share, index) => <span key={index}>{share.name}: {share.seconds}</span>)}
    </div>
  ),
}));

function model() {
  const today = "2026-10-26";
  const fixture = buildTeamPreviewFixture({ scenario: { scale: "team", scope: "focus_blocks", viewer: "owner", policy: "free" }, today, nowMs: Date.parse(today), nowMinuteOfDay: 600 });
  const base = buildTeamOverviewModel(fixture.dataset, { scope: "focus_blocks", policy: "free", window: { start_date: today, end_date: today }, today, nowMs: 0, groupId: null, projects: fixture.projects, viewerRole: "owner", expectedWeekdays: [1, 2, 3, 4, 5], dailyGoalSeconds: 10800 });
  const project = { projectId: "qa", name: "QA Project", color: "#5b783f", seconds: 7200 };
  return {
    ...base, teamFocusSeconds: 3600,
    focusByDay: [{ day: "2026-10-26", seconds: 3600, isToday: true, isFuture: false }],
    focusByDayProject: [{ day: "2026-10-26", shares: [project] }],
    focusByProject: [project],
  };
}

describe("the Overview's daily chart", () => {
  it("names recorded project time accurately even when focus is also shared", () => {
    render(<LocalizationTestProvider language="en"><TeamFocusByDayPanel model={model()} language="en" showProjects /></LocalizationTestProvider>);
    expect(screen.getByRole("img", { name: "Project time by day" }).textContent).toBe("QA Project: 7200");
    expect(screen.queryByText("Team focus by day")).toBeNull();
  });

  it("draws the independent focus total when project time is private", () => {
    render(<LocalizationTestProvider language="en"><TeamFocusByDayPanel model={model()} language="en" showProjects={false} /></LocalizationTestProvider>);
    const chart = screen.getByRole("img", { name: "Team focus by day" });
    expect(chart.textContent).toContain("3600");
    expect(chart.textContent).not.toContain("QA Project");
    expect(chart.textContent).not.toContain("7200");
  });
});
