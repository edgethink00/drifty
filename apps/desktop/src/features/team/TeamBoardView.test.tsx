// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamBoardView } from "./TeamBoardView";
import { buildTeamOverviewModel, type TeamWindow } from "./teamFocusModel";
import { buildTeamPreviewFixture } from "./teamPreviewScenarios";
import { teamSharingVisibility } from "./teamSharingPolicy";

const today = "2026-10-17";
const range: TeamWindow = { start_date: "2026-10-11", end_date: today };
const fixture = buildTeamPreviewFixture({ scenario: { scale: "team", scope: "focus_blocks", viewer: "owner", policy: "managed" }, today, nowMs: Date.parse("2026-10-17T05:10:00Z"), nowMinuteOfDay: 850 });
const model = buildTeamOverviewModel(fixture.dataset, { scope: "focus_blocks", policy: "managed", window: range, today, nowMs: 0, groupId: null, projects: fixture.projects, viewerRole: "owner", expectedWeekdays: [1, 2, 3, 4, 5], dailyGoalSeconds: 10800 });
const access = { visibility: teamSharingVisibility({ projects: "hourly", tasks: "hourly", focus: "off", memberSummary: false }), acrossTeams: false, summarySeat: false, hasTeams: model.groupCards.length > 0 };

function board() {
  return render(
    <LocalizationTestProvider language="en">
      <TeamBoardView organizationId="board-test" model={model} dataset={fixture.dataset} groupId={null} window={range} access={access} projects={fixture.projects} path={[]} onOpenMember={vi.fn()} onOpenGroup={vi.fn()} />
    </LocalizationTestProvider>,
  );
}
const boards = () => screen.getByRole("group", { name: "Boards" });
const grips = () => document.querySelectorAll("[data-board-grip]");

afterEach(() => window.localStorage.clear());

describe("the Dashboard's boards (decided 2026-10-25)", () => {
  it("reads without handles and arranges only between Edit and Done", () => {
    board();
    expect(grips()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Add widget/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(grips().length).toBeGreaterThan(1);
    expect(screen.getByText("Changes are saved as your board")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(grips()).toHaveLength(0);
  });

  it("opens a first change to the standard board as the leader's own board, and Undo returns to the standard one", () => {
    board();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    act(() => { fireEvent.keyDown(grips()[1]!, { key: "ArrowRight" }); });
    const mine = within(boards()).getByRole("button", { name: /My board/ });
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    expect(within(boards()).getByRole("button", { name: /Team at a glance/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Saved your changes as My board")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(within(boards()).queryByRole("button", { name: /My board/ })).toBeNull();
    expect(within(boards()).getByRole("button", { name: /Team at a glance/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps export in Settings: the standard board has no menu, and a leader's own board's menu holds no export (decided 2026-10-25)", () => {
    board();
    expect(screen.queryByRole("button", { name: "Board options" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New board" }));
    fireEvent.click(within(screen.getByRole("menu", { name: "New board" })).getByRole("menuitem", { name: /Project review/ }));
    fireEvent.click(screen.getByRole("button", { name: "Board options" }));
    const items = within(screen.getByRole("menu", { name: "Board options" })).getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.some((item) => /export|csv/i.test(item ?? ""))).toBe(false);
    expect(items.length).toBe(3);
  });

  it("adds a widget from a window that previews it with the team's figures (2026-10-25)", () => {
    board();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Add widget/ })[0]!);
    const picker = screen.getByRole("dialog", { name: "Add widget" });
    fireEvent.change(within(picker).getByRole("textbox", { name: "Search widgets" }), { target: { value: "timetable" } });
    const options = within(picker).getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => /timetable/i.test(option.textContent ?? ""))).toBe(true);
    fireEvent.change(within(picker).getByRole("textbox", { name: "Search widgets" }), { target: { value: "" } });
    fireEvent.click(within(picker).getByRole("option", { name: /Project timetable/ }));
    expect(within(picker).getByRole("heading", { name: "Project timetable" })).toBeTruthy();
    fireEvent.click(within(picker).getByRole("button", { name: "Add to board" }));
    expect(screen.queryByRole("dialog", { name: "Add widget" })).toBeNull();
    expect(screen.getAllByText("Project timetable").length).toBeGreaterThan(0);
  });

  it("starts a new board blank, from a template that can show here, or as a copy", () => {
    board();
    fireEvent.click(screen.getByRole("button", { name: "New board" }));
    const menu = screen.getByRole("menu", { name: "New board" });
    const names = within(menu).getAllByRole("menuitem").map((item) => item.textContent);
    expect(names[0]).toMatch(/^Blank board/);
    expect(names.some((name) => /^Project review/.test(name ?? ""))).toBe(true);
    // A single team has no teams below it to compare.
    expect(names.some((name) => /^Team comparison/.test(name ?? ""))).toBe(false);
    expect(names[names.length - 1]).toMatch(/^Copy of Team at a glance/);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Project review/ }));
    expect(within(boards()).getByRole("button", { name: /Project review/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

