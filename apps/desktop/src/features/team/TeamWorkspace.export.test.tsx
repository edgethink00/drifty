// @vitest-environment jsdom
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamWorkspace } from "./TeamWorkspace";
import { useTeamPreviewController } from "./teamPreview";
import { buildTeamPreviewFixture, type TeamPreviewFixture, type TeamPreviewScenario } from "./teamPreviewScenarios";
import type { TeamProjectsSubView } from "./useTeamProjects";

const downloads = vi.hoisted(() => [] as { name: string; text: string }[]);
vi.mock("./teamBoardExport", async (original) => ({
  ...(await original<typeof import("./teamBoardExport")>()),
  downloadTeamBoardCsv: (name: string, text: string) => { downloads.push({ name, text }); },
}));

const CLOCK = { today: "2026-10-17", nowMs: Date.parse("2026-10-17T05:10:00Z"), nowMinuteOfDay: 850 };
const fixture = (scenario: Partial<TeamPreviewScenario>) => buildTeamPreviewFixture({
  scenario: { scale: "company", scope: "member_focus", viewer: "owner", policy: "managed", sharing: "work_and_focus", ...scenario },
  ...CLOCK,
});

function Harness({ preview }: { readonly preview: TeamPreviewFixture }) {
  const controller = useTeamPreviewController(preview);
  const [view, setView] = useState<TeamProjectsSubView>("dashboards");
  return <LocalizationTestProvider language="en"><TeamWorkspace controller={controller} previewFixture={preview} isSupabaseEnabled={false} hasRequiredAccountAuth={false} isSignedIn={false} user={null} startOfDayMinutes={0} subView={view} onSubViewChange={setView} onSignIn={vi.fn()} onCopyInvite={vi.fn()} onAcceptPendingInvite={vi.fn()} /></LocalizationTestProvider>;
}

const panel = () => screen.getByRole("region", { name: "Export your data" });
const exportCsv = async () => {
  fireEvent.click(within(panel()).getByRole("button", { name: "Export CSV" }));
  await act(async () => { await Promise.resolve(); });
};
const lines = (index: number) => downloads[index]!.text.split("\r\n");

function openExport(preview: TeamPreviewFixture, tab = true) {
  render(<Harness preview={preview} />);
  fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
  if (tab) fireEvent.click(screen.getByRole("tab", { name: "Export" }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T05:10:00Z"));
  downloads.length = 0;
});
afterEach(() => { vi.useRealTimers(); window.localStorage.clear(); });

describe("Settings › Export (owner decision 2026-10-22: Dayflow's start and end, Rize's and RescueTime's one table)", () => {
  it("downloads this week as one table, a row per day, person and project, with focus where the team shares it", async () => {
    openExport(fixture({ scale: "team" }));
    await exportCsv();
    expect(downloads[0]!.name).toBe("Sales Team 2026-10-12–2026-10-17.csv");
    expect(lines(0)[0]).toBe("Date,Team,Person,Project,Hours");
    expect(lines(0).slice(1).every((line) => line >= "2026-10-12" && line < "2026-10-18")).toBe(true);
    expect(lines(0).some((line) => line.includes(",Focus time,"))).toBe(true);
  });

  it("writes each team's totals where people are not shared, and no focus where the team keeps it", async () => {
    openExport(fixture({ scale: "team", sharing: "project_totals" }));
    await exportCsv();
    expect(lines(0)[0]).toBe("Date,Team,Project,Hours");
    expect(lines(0).some((line) => line.includes("Focus time"))).toBe(false);
  });

  it("writes a row per team across an organization's teams", async () => {
    openExport(fixture({}));
    await exportCsv();
    expect(lines(0)[0]).toBe("Date,Team,Project,Hours");
    expect(new Set(lines(0).slice(1).map((line) => line.split(",")[1])).size).toBeGreaterThan(1);
  });

  it("takes any start and end day, keeps them in order, and never a day after today", async () => {
    openExport(fixture({ scale: "team" }));
    fireEvent.click(within(panel()).getByRole("button", { name: /^Start/ }));
    fireEvent.click(within(screen.getByRole("grid", { name: "October 2026" })).getByRole("gridcell", { name: /Oct 1\b/ }));
    fireEvent.click(within(panel()).getByRole("button", { name: /^End/ }));
    const october = screen.getByRole("grid", { name: "October 2026" });
    expect((within(october).getByRole("gridcell", { name: /Oct 25\b/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(october).getByRole("gridcell", { name: /Oct 10\b/ }));
    await exportCsv();
    expect(downloads[0]!.name).toContain("2026-10-01–2026-10-10");
    expect(lines(0).slice(1).every((line) => line >= "2026-10-01" && line < "2026-10-11")).toBe(true);
    // A start after the end brings the end along.
    fireEvent.click(within(panel()).getByRole("button", { name: /^Start/ }));
    fireEvent.click(within(screen.getByRole("grid", { name: "October 2026" })).getByRole("gridcell", { name: /Oct 16\b/ }));
    expect(within(panel()).getByRole("button", { name: /^End/ }).getAttribute("aria-label")).toMatch(/October 16, 2026/);
  });

  it("closes a month on Escape without changing the day", () => {
    openExport(fixture({ scale: "team" }));
    const start = within(panel()).getByRole("button", { name: /^Start/ });
    const before = start.getAttribute("aria-label");
    fireEvent.click(start);
    expect(screen.getByRole("grid", { name: "October 2026" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("grid", { name: "October 2026" })).toBeNull();
    expect(start.getAttribute("aria-label")).toBe(before);
  });

  it("shows each day short with its weekday", () => {
    openExport(fixture({ scale: "team" }));
    expect(within(panel()).getByRole("button", { name: /^Start/ }).textContent).toBe("Mon, October 12");
    expect(within(panel()).getByRole("button", { name: /^End/ }).textContent).toBe("Sat, October 17");
  });

  it("shades the days between start and end in the month it opens", () => {
    openExport(fixture({ scale: "team" }));
    fireEvent.click(within(panel()).getByRole("button", { name: /^End/ }));
    const october = screen.getByRole("grid", { name: "October 2026" });
    const shaded = within(october).getAllByRole("gridcell").filter((cell) => cell.className.includes("is-in-range")).map((cell) => cell.textContent);
    expect(shaded).toEqual(["12", "13", "14", "15", "16", "17"]);
  });

  it("gives a team manager the export in its own settings tab and a member none", () => {
    const { unmount } = render(<Harness preview={fixture({ scale: "team", viewer: "manager" })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Export" }));
    expect(panel()).toBeTruthy();
    unmount();
    render(<Harness preview={fixture({ scale: "team", viewer: "member" })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.queryByRole("region", { name: "Export your data" })).toBeNull();
  });
});
