// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamMemberProjectDetail } from "./TeamMemberProjectDetail";
import { TeamMemberCalendar } from "./TeamMemberCalendar";
import { TeamMemberDetailView } from "./TeamMemberDetailView";
import { buildTeamMemberDetailModel, type TeamWindow } from "./teamFocusModel";
import { buildTeamPreviewFixture } from "./teamPreviewScenarios";
import type { TeamSharingScope } from "./teamSharingScope";

const today = "2026-10-17";
const fixture = buildTeamPreviewFixture({ scenario: { scale: "team", scope: "focus_blocks", viewer: "owner", policy: "managed" }, today, nowMs: Date.parse("2026-10-17T05:10:00Z"), nowMinuteOfDay: 850 });
function memberModel(scope: TeamSharingScope, window: TeamWindow = { start_date: "2026-10-11", end_date: today }) {
  const model = buildTeamMemberDetailModel(fixture.dataset, { scope, policy: "managed", window, today, nowMs: 0, groupId: null, projects: fixture.projects, viewerRole: "owner", expectedWeekdays: [1, 2, 3, 4, 5], dailyGoalSeconds: 10800, memberKey: fixture.dataset.members[0]!.member_key })!;
  return model;
}
function memberView(scope: TeamSharingScope, window: TeamWindow = { start_date: "2026-10-11", end_date: today }, projectPanel: "donut" | "list" = "donut", historyPosition?: "above" | "below") {
  return <LocalizationTestProvider language="en"><TeamMemberDetailView teamName="Sales Team" projectPanel={projectPanel} historyPosition={historyPosition} model={memberModel(scope, window)} projects={fixture.projects} window={window} nowMinuteOfDay={850} hasPrevious={false} hasNext={true} onBack={vi.fn()} onPrevious={vi.fn()} onNext={vi.fn()} /></LocalizationTestProvider>;
}

describe("complete member detail", () => {
  it("opens the complete screen with selectable blocks, one project summary and recent periods", () => {
    render(memberView("focus_blocks"));
    expect(screen.getByText("Work timeline")).toBeTruthy();
    expect(screen.getByText("Time by project")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Project details" })).toBeNull();
    expect(screen.getByText("Last 4 weeks")).toBeTruthy();
    const calendar = screen.getByRole("group", { name: /focus blocks by day and hour/ });
    const block = within(calendar).getAllByRole("button")[0]!;
    fireEvent.click(block);
    expect(block.getAttribute("aria-pressed")).toBe("true");
    const selection = screen.getByRole("status");
    expect(selection.querySelector("strong")?.textContent).toBeTruthy();
    expect(selection.textContent).toMatch(/\d{1,2}:\d\d [AP]M–\d{1,2}:\d\d [AP]M/);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("Personal weekly goal")).toBeNull();
    expect(screen.queryByText("Your Week")).toBeNull();
  });

  it.each(["above", "below"] as const)("moves the recent-period chart %s project allocation, with metrics fixed afterward and no goal", (position) => {
    render(memberView("focus_blocks", undefined, "donut", position));
    const history = screen.getByText("Last 4 weeks");
    const projects = screen.getByText("Time by project");
    const metrics = screen.getByRole("group", { name: "Period summary" });
    expect(history.closest(".team-member-workspace__rail")).toBeTruthy();
    expect(Boolean(history.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(position === "above");
    expect(Boolean(projects.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(history.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it.each(["donut", "list"] as const)("opens only the selected project from %s and closes back to its trigger", (variant) => {
    render(memberView("focus_blocks", undefined, variant));
    const button = screen.getByRole("button", { name: "View Proposal prep details" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.focus();
    fireEvent.click(button);
    const detail = screen.getByRole("region", { name: "Proposal prep" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-controls")!)?.contains(detail)).toBe(true);
    expect(within(detail).getByText("This period")).toBeTruthy();
    expect(within(detail).getByText("Previous period")).toBeTruthy();
    expect(within(detail).getByRole("img", { name: "Proposal prep by day" })).toBeTruthy();
    expect(within(detail).queryByText("CRM updates")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close project details" }));
    expect(screen.queryByRole("region", { name: "Proposal prep" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("clears selection on a period change and removes unassigned detail when its sharing scope is withdrawn", () => {
    const { rerender } = render(memberView("focus_blocks"));
    fireEvent.click(screen.getByRole("button", { name: "View Proposal prep details" }));
    expect(screen.getByRole("region", { name: "Proposal prep" })).toBeTruthy();
    rerender(memberView("focus_blocks", { start_date: "2026-10-01", end_date: "2026-10-31" }));
    expect(screen.queryByRole("region", { name: "Proposal prep" })).toBeNull();
    rerender(memberView("focus_blocks"));
    expect(screen.queryByRole("region", { name: "Proposal prep" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Unassigned details" }));
    expect(screen.getByRole("region", { name: "Unassigned" })).toBeTruthy();
    rerender(memberView("projects"));
    expect(screen.queryAllByText("Unassigned")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Close project details" })).toBeNull();
    rerender(memberView("focus_blocks"));
    expect(screen.queryByRole("region", { name: "Unassigned" })).toBeNull();
  });

  it("does not invent a change percentage or a new-work claim when no earlier project time is shared", () => {
    const original = memberModel("focus_blocks");
    render(<LocalizationTestProvider language="en"><TeamMemberProjectDetail model={{ ...original, previousProjects: [] }} project={original.projects[0]!} window={{ start_date: "2026-10-11", end_date: today }} onClose={vi.fn()} /></LocalizationTestProvider>);
    expect(screen.getByText("No shared time in the previous period.")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("new")).toBeNull();
  });

  it("keeps adjacent five-minute blocks inside their exact time slots and selectable", () => {
    const original = memberModel("focus_blocks");
    const model = { ...original, dayRows: [{ ...original.dayRows[0]!, blocks: [
      { start_minute: 9 * 60, end_minute: 9 * 60 + 5, project_id: null },
      { start_minute: 9 * 60 + 5, end_minute: 9 * 60 + 10, project_id: null },
    ] }] };
    const { container } = render(<LocalizationTestProvider language="en"><TeamMemberCalendar model={model} projects={fixture.projects} nowMinuteOfDay={850} /></LocalizationTestProvider>);
    const events = container.querySelectorAll<HTMLElement>(".week-v2-calendar__event");
    expect(events).toHaveLength(2);
    expect(Number.parseFloat(events[0]!.style.top) + Number.parseFloat(events[0]!.style.height)).toBeLessThan(Number.parseFloat(events[1]!.style.top));
    const block = within(events[0]!).getByRole("button", { name: /9:00 AM–9:05 AM/ });
    fireEvent.click(block);
    expect(block.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("9:00 AM–9:05 AM");
  });

  it("subtracts hourly views at member focus while keeping the summaries and project allocation", () => {
    const { rerender } = render(memberView("focus_blocks"));
    rerender(memberView("member_focus"));
    expect(screen.queryByText("Work timeline")).toBeNull();
    expect(screen.queryByText("Focus rhythm")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Deep blocks")).toBeTruthy();
    expect(screen.getByText("Time by project")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Project details" })).toBeNull();
    expect(screen.getByText("Focus by day")).toBeTruthy();
  });

  it.each(["projects", "team_focus"] as const)("at %s keeps project history but no personal focus, goal, unassigned or tracked-day hints", (scope) => {
    render(memberView(scope));
    expect(screen.getByText("Project time by day")).toBeTruthy();
    expect(screen.getByText("Time by project")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Project details" })).toBeNull();
    expect(screen.getByText("Last 4 weeks")).toBeTruthy();
    expect(screen.queryAllByText("Unassigned")).toEqual([]);
    expect(screen.queryByText("Focus time")).toBeNull();
    expect(screen.queryByText("Deep blocks")).toBeNull();
    expect(screen.queryByText("Longest block")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/Tracked \d/)).toBeNull();
  });

  it("pages a month in weeks, resets block selection, and never compares a month with a weekly goal", () => {
    render(memberView("focus_blocks", { start_date: "2026-10-01", end_date: "2026-10-31" }));
    const calendar = screen.getByRole("group", { name: /focus blocks by day and hour/ });
    expect(calendar.querySelectorAll(".week-v2-calendar__day-head > span:not(:first-child)")).toHaveLength(7);
    fireEvent.click(within(calendar).getAllByRole("button")[0]!);
    expect(screen.getByRole("status").textContent).toMatch(/\d{1,2}:\d\d [AP]M/);
    fireEvent.click(screen.getByRole("button", { name: "Previous calendar week" }));
    expect(screen.getByRole("status").textContent).toContain("Select a block");
    fireEvent.click(screen.getByRole("button", { name: "Previous calendar week" }));
    expect(calendar.querySelectorAll(".week-v2-calendar__day-head > span:not(:first-child)")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Previous calendar week" }).hasAttribute("disabled")).toBe(true);
    expect(calendar.querySelector(".week-v2-calendar__now-marker")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("Personal weekly goal")).toBeNull();
  });
});
