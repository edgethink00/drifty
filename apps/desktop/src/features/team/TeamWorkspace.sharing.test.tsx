// @vitest-environment jsdom
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamWorkspace } from "./TeamWorkspace";
import { useTeamPreviewController } from "./teamPreview";
import { buildTeamPreviewFixture, type TeamPreviewFixture, type TeamPreviewScenario } from "./teamPreviewScenarios";
import type { TeamProjectsSubView } from "./useTeamProjects";

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

const headline = () => document.querySelector(".team-focus__head")!.textContent ?? "";

// These cases describe the earlier candidates where they set none; the options decided on 2026-10-21
// (path title, team switcher, the Rize own-row view, per-manager grants, the hours clock)
// have cases that set them.
const EARLIER_CANDIDATES = {
  "drifty.dev.teamPageTitle": "section",
  "drifty.dev.teamTitleSwitcher": "organization",
  "drifty.dev.teamMemberSelfView": "preview",
  "drifty.dev.teamManagerEdit": "admins",
  "drifty.dev.teamHoursZone": "hidden",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T05:10:00Z"));
  for (const [key, value] of Object.entries(EARLIER_CANDIDATES)) window.localStorage.setItem(key, value);
});
afterEach(() => { vi.useRealTimers(); window.localStorage.clear(); });


/** Settings opens on General; most checks here are about another of its tabs (a member's page has none). */
function openSettings(tab = "Sharing") {
  fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
  const inner = screen.queryByRole("tab", { name: tab });
  if (inner) fireEvent.click(inner);
}

describe("teams that share on their own policies", () => {
  it("adds the organization's teams on project time and opens each team on its own sharing", () => {
    render(<Harness preview={fixture({})} />);
    // Across teams: project time, how many teams, no focus, and no lone card for the admin above them.
    expect(headline()).toContain("Team project time");
    expect(headline()).toContain("7 teams");
    expect(headline()).not.toContain("focus");
    expect(screen.queryByRole("button", { name: "Open Minseok Park's focus" })).toBeNull();

    // Engineering shares a work log without focus; Sales follows the default, which shares focus.
    fireEvent.click(screen.getByRole("button", { name: "Open Engineering" }));
    expect(headline()).toContain("Engineering project time");
    fireEvent.click(screen.getByRole("button", { name: "Brightline" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Sales" }));
    expect(headline()).toContain("Sales focus time");
  });

  it("finds a person across teams by name only and opens them inside a team that shares nothing per person", () => {
    const preview = fixture({});
    render(<Harness preview={preview} />);
    const legal = preview.dataset.members.find((member) => member.group_id === "qa-group-legal")!;
    fireEvent.change(screen.getByRole("textbox", { name: "Search members…" }), { target: { value: legal.display_name } });
    const card = screen.getByRole("button", { name: "Open " + legal.display_name + "'s focus" });
    expect(card.textContent).not.toMatch(/\d+h/);
    fireEvent.click(card);
    // Legal shares project totals only, so the person opens as their team, not as their own page.
    expect(screen.queryByRole("navigation", { name: "Member navigation" })).toBeNull();
    expect(headline()).toContain("Legal");
  });

  it("shows a member what their managers see of them", () => {
    render(<Harness preview={fixture({ viewer: "member", sharing: "project_totals", memberSummary: false })} />);
    expect(screen.getByRole("heading", { name: "What managers see of me" })).toBeTruthy();
    expect(screen.getByText("Only in the team total")).toBeTruthy();
    expect(screen.getByText(/nothing managers can see about you alone/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See it as they do" })).toBeNull();
  });

  it("gives a member their own records as the first tab, the page managers open of them (candidate D)", () => {
    window.localStorage.setItem("drifty.dev.teamMemberSelfView", "tab");
    const view = render(<Harness preview={fixture({ viewer: "member", scale: "team", sharing: "work_and_focus" })} />);
    const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabNames()).toEqual(["My records", "Overview", "Projects", "Settings"]);
    expect(screen.getByRole("tab", { name: "My records" }).getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".team-member-detail--self")).not.toBeNull();
    // The records are the page managers open; no line on them names what managers see.
    expect(screen.queryByText("Managers see:")).toBeNull();
    // The Overview keeps the team's totals and no people.
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(document.querySelector(".team-member-detail--self")).toBeNull();
    expect(headline()).toContain("Team focus time");
    fireEvent.click(screen.getByRole("tab", { name: "My records" }));
    expect(document.querySelector(".team-member-detail--self")).not.toBeNull();
    view.unmount();

    // A team that keeps its summary from members has nothing for the Overview tab to show.
    const hidden = render(<Harness preview={fixture({ viewer: "member", scale: "team", sharing: "work_and_focus", memberSummary: false })} />);
    expect(tabNames()).toEqual(["My records", "Projects", "Settings"]);
    hidden.unmount();

    // Nothing shared per person: no records tab and no notice in its place.
    render(<Harness preview={fixture({ viewer: "member", scale: "team", sharing: "project_totals" })} />);
    expect(tabNames()).toEqual(["Overview", "Projects", "Settings"]);
    expect(document.querySelector(".team-member-detail--self")).toBeNull();
    expect(screen.queryByText(/nothing managers can see about you alone/)).toBeNull();
  });

  it("keeps a member's own records out of the team page when it follows Rize and RescueTime (candidate E)", () => {
    window.localStorage.setItem("drifty.dev.teamMemberSelfView", "none");
    const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);
    const view = render(<Harness preview={fixture({ viewer: "member", scale: "team", sharing: "full_timeline", scope: "focus_blocks" })} />);
    expect(tabNames()).toEqual(["Overview", "Projects", "Settings"]);
    expect(headline()).toContain("Team focus time");
    expect(document.querySelector(".team-member-detail--self")).toBeNull();
    expect(document.querySelector(".team-self-share")).toBeNull();
    expect(document.querySelector(".team-focus__people")).toBeNull();
    view.unmount();

    // A team that keeps its summary from members opens on its projects.
    render(<Harness preview={fixture({ viewer: "member", scale: "team", sharing: "work_and_focus", memberSummary: false })} />);
    expect(tabNames()).toEqual(["Projects", "Settings"]);
    expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows a member the managers' Overview with only their own card, as Rize does (candidate F)", () => {
    window.localStorage.setItem("drifty.dev.teamMemberSelfView", "rize");
    const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);
    const view = render(<Harness preview={fixture({ viewer: "member", scale: "team", sharing: "work_and_focus" })} />);
    expect(tabNames()).toEqual(["Overview", "Projects", "Settings"]);
    expect(headline()).toContain("Team focus time");
    const cards = screen.getAllByRole("button", { name: /^Open .+'s focus$/ });
    expect(cards).toHaveLength(1);
    expect(screen.queryByText("Only your own row")).toBeNull();
    expect(screen.queryByText("Managers see:")).toBeNull();
    expect(document.querySelector(".team-self-share")).toBeNull();
    fireEvent.click(cards[0]!);
    expect(screen.getByRole("navigation", { name: "Member navigation" })).toBeTruthy();
    view.unmount();

    // Nothing shared per person: no own card, and no notice in its place.
    const totals = render(<Harness preview={fixture({ viewer: "member", scale: "team", sharing: "project_totals" })} />);
    expect(screen.queryAllByRole("button", { name: /^Open .+'s focus$/ })).toHaveLength(0);
    expect(document.querySelector(".team-focus__people")).toBeNull();
    totals.unmount();

    // ...and with the summary kept from members too, an empty Overview leaves and the team opens on Projects.
    render(<Harness preview={fixture({ viewer: "member", scale: "team", sharing: "project_totals", memberSummary: false })} />);
    expect(tabNames()).toEqual(["Projects", "Settings"]);
    expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe("true");
  });

  it("puts a team back on the default from settings opened inside it", async () => {
    render(<Harness preview={fixture({})} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Engineering" }));
    openSettings();
    const follow = screen.getByRole("switch", { name: "Follow the default" });
    expect(follow.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(follow);
    expect(screen.getByText("Teams changed: Engineering")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(headline()).toContain("Engineering focus time");
  });

  it("keeps no footnote on the team pages; the never-shared line stays in sharing settings", () => {
    const view = render(<Harness preview={fixture({})} />);
    const footnote = () => document.querySelector(".team-footnote");
    expect(footnote()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Sales" }));
    expect(footnote()).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /^Open .+'s focus$/ })[0]!);
    expect(screen.getByRole("navigation", { name: "Member navigation" })).toBeTruthy();
    expect(footnote()).toBeNull();
    view.unmount();

    render(<Harness preview={fixture({ viewer: "member" })} />);
    expect(footnote()).toBeNull();
    openSettings();
    expect(screen.getByText("Apps and sites, window titles, drift time and personal notes are never shared.")).toBeTruthy();
  });

  it("lets a division set sharing that its teams inherit, and names where a team's sharing comes from", async () => {
    render(<Harness preview={fixture({ scale: "enterprise" })} />);
    // Settings opened inside a division start on it, like a team.
    fireEvent.click(screen.getByRole("button", { name: "Open Consumer" }));
    openSettings();
    expect(screen.getByText("This division and its teams share what the default shares. Turn this off to choose for them.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Follow the default" }));
    fireEvent.click(screen.getByRole("switch", { name: "Each person's work records" }));
    const focus = screen.getByRole("switch", { name: "Focus time" });
    if (focus.getAttribute("aria-checked") === "true") fireEvent.click(focus);
    expect(screen.getByRole("switch", { name: "Focus time" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Teams changed: Consumer")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save changes" })); });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));

    // Its teams follow it: the switch and the hint name Consumer, and the team opens on project time.
    fireEvent.click(screen.getByRole("button", { name: "Open Growth" }));
    expect(headline()).toContain("Growth project time");
    openSettings();
    expect(screen.getByRole("switch", { name: "Follow Consumer" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("This team shares what Consumer shares. Turn this off to choose for this team.")).toBeTruthy();
  });
});

describe("decision candidates in the Dev preview", () => {
  it("puts where the seat is into the page title and drops the small path (B)", () => {
    window.localStorage.setItem("drifty.dev.teamPageTitle", "path");
    render(<Harness preview={fixture({ scale: "enterprise" })} />);
    const title = () => document.querySelector(".team-title")!.textContent ?? "";
    expect(title()).toContain("Northwind Group");
    fireEvent.click(screen.getByRole("button", { name: "Open Consumer" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Growth" }));
    expect(title()).toContain("Northwind Group");
    expect(title()).toContain("Consumer");
    expect(title()).toContain("Growth");
    expect(document.querySelector(".team-crumbs")).toBeNull();
    // The headline no longer names the place the title names.
    expect(headline()).not.toContain("Growth");
    // A level in the title opens it; the organization's name returns to the top.
    fireEvent.click(screen.getByRole("button", { name: "Consumer" }));
    expect(title()).not.toContain("Growth");
    fireEvent.click(screen.getByRole("button", { name: "Northwind Group" }));
    expect(headline()).toContain("Team project time");
  });

  it("adds focus across teams only from the teams that share it, naming the rest (C)", () => {
    window.localStorage.setItem("drifty.dev.teamAcrossRule", "sharedFocus");
    render(<Harness preview={fixture({})} />);
    expect(headline()).toContain("Team focus time");
    expect(headline()).toContain("Focus without Engineering, Legal");
  });

  it("keeps project time across teams unless every team shares focus (B)", () => {
    window.localStorage.setItem("drifty.dev.teamAcrossRule", "allFocus");
    render(<Harness preview={fixture({})} />);
    expect(headline()).toContain("Team project time");
  });

  it("shows a small team's summary to its member whenever the team shows it, at any size", () => {
    render(<Harness preview={fixture({ scale: "trio", viewer: "member" })} />);
    expect(headline()).toMatch(/Team (focus|project) time/);
    expect(headline()).toMatch(/\d+h/);
  });

  it("lets a manager narrow their team but locks what lies above the admin's choice (B)", () => {
    window.localStorage.setItem("drifty.dev.teamManagerEdit", "narrow");
    render(<Harness preview={fixture({ viewer: "manager", sharing: "work_log" })} />);
    openSettings();
    // The admin chose daily work records without focus: more detail and sharing focus stay closed.
    expect((screen.getByRole("switch", { name: "Times of day" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "Focus time" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Each person's work records" }));
    expect(screen.getByText("Teams changed: Sales")).toBeTruthy();
  });

  it("locks what the organization admin keeps and leaves the rest to managers (D)", () => {
    window.localStorage.setItem("drifty.dev.teamManagerEdit", "delegate");
    const view = render(<Harness preview={fixture({ viewer: "manager", sharing: "work_log" })} />);
    openSettings();
    expect(screen.getByText("You can change what an organization admin left to managers. Locked: Focus time.")).toBeTruthy();
    // Focus is locked: only the admin's choice stays, every other level is closed, lower ones too.
    const focusCells = Array.from(screen.getByRole("radiogroup", { name: "Focus time" }).querySelectorAll<HTMLButtonElement>("button[role=radio]"));
    expect(focusCells.filter((cell) => !cell.disabled).map((cell) => cell.getAttribute("aria-checked"))).toEqual(["true"]);
    // Project time is left to managers: they may go as far as times of day, beyond the admin's choice.
    const projectCells = Array.from(screen.getByRole("radiogroup", { name: "Project time" }).querySelectorAll<HTMLButtonElement>("button[role=radio]"));
    const hourly = projectCells[projectCells.length - 1]!;
    expect(hourly.disabled).toBe(false);
    fireEvent.click(hourly);
    expect(screen.getByText("Teams changed: Sales")).toBeTruthy();
    view.unmount();

    // The organization admin chooses, on the default, what each item does.
    render(<Harness preview={fixture({})} />);
    openSettings();
    const focusChoice = screen.getByRole("group", { name: "Focus time: team managers" });
    expect(within(focusChoice).getByRole("button", { name: "Locked" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(focusChoice).getByRole("button", { name: "Managers choose" }));
    expect(window.localStorage.getItem("drifty.dev.teamManagerDelegation")).toBe("projects,tasks,focus");
  });

  it("lets only the managers an organization admin allowed narrow their team's sharing (E)", () => {
    window.localStorage.setItem("drifty.dev.teamManagerEdit", "grant");
    const allowed = render(<Harness preview={fixture({ viewer: "manager", sharing: "work_log", managerSharing: "narrow" })} />);
    openSettings();
    expect(screen.getByText("You can only narrow what this team shares. To widen it, ask an organization admin.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Focus time" })).toBeTruthy();
    allowed.unmount();

    const readOnly = render(<Harness preview={fixture({ viewer: "manager", sharing: "work_log", managerSharing: "view" })} />);
    openSettings();
    expect(screen.getByText("Only organization admins change what the team shares.")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Focus time" })).toBeNull();
    readOnly.unmount();

    // The organization admin sets it on the person, next to how far they see.
    render(<Harness preview={fixture({})} />);
    openSettings("Members");
    const granted = Array.from(document.querySelectorAll<HTMLElement>(".team-roster__row")).find((row) => row.textContent?.includes("narrows sharing"))!;
    expect(granted).toBeTruthy();
    fireEvent.click(within(granted).getByRole("button", { name: /^Edit / }));
    const grant = screen.getByRole("radiogroup", { name: "Sharing settings" });
    expect(within(grant).getByRole("radio", { name: /May narrow/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(grant).getByRole("radio", { name: /Read only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(Array.from(document.querySelectorAll(".team-roster__row")).some((row) => row.textContent?.includes("narrows sharing"))).toBe(false);
  });

  it("says whose clock the team's hours follow and saves each person's local time", () => {
    window.localStorage.setItem("drifty.dev.teamHoursZone", "choose");
    const admin = render(<Harness preview={fixture({})} />);
    openSettings("Hours");
    const clock = screen.getByRole("combobox", { name: "Whose clock" });
    expect(clock.textContent).toMatch(/^Team time · /);
    fireEvent.click(clock);
    fireEvent.click(screen.getByRole("option", { name: /^Each person's local time/ }));
    expect(screen.getByText("New hours and pausing apply from now on.")).toBeTruthy();
    admin.unmount();

    // A member reads the clock with the hours.
    render(<Harness preview={fixture({ viewer: "member" })} />);
    openSettings();
    expect(document.querySelector(".team-policy-summary__notes")!.textContent).toMatch(/Team hours .+ · \S/);
  });
});

describe("team settings controls", () => {
  it("gives a member one leave button that asks in a dialog what leaving means", () => {
    render(<Harness preview={fixture({ viewer: "member" })} />);
    openSettings();
    const leave = screen.getByRole("group", { name: "Leave organization" });
    expect(within(leave).getAllByRole("button")).toHaveLength(1);
    // The button names the section; no heading repeats it.
    expect(leave.querySelector(".label-mono")).toBeNull();
    fireEvent.click(within(leave).getByRole("button"));
    const dialog = screen.getByRole("dialog", { name: "Leave Brightline?" });
    expect(dialog.textContent).toContain("Records already shared stay with the team");
    // Cancel returns to settings without leaving.
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel/ }));
    expect(screen.queryByRole("dialog", { name: "Leave Brightline?" })).toBeNull();
    expect(screen.getByRole("region", { name: "Team settings" })).toBeTruthy();
  });

  it("keeps unsaved sharing when leaving the Settings tab and saves it with Command-Enter", async () => {
    render(<Harness preview={fixture({})} />);
    openSettings();
    fireEvent.click(screen.getByRole("switch", { name: "Each person's work records" }));
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    openSettings();
    const save = screen.getByRole("button", { name: /^Save changes/ });
    expect(save.textContent).toMatch(/Save changes/);
    await act(async () => { fireEvent.keyDown(save, { key: "Enter", metaKey: true }); });
    expect(screen.queryByRole("button", { name: /^Save changes/ })).toBeNull();
  });

  it("makes a team from a manager's teams and adds it to them", async () => {
    render(<Harness preview={fixture({})} />);
    openSettings("Members");
    const lead = Array.from(document.querySelectorAll<HTMLElement>(".team-roster__row")).find((row) => row.textContent?.includes("Individual detail"))!;
    fireEvent.click(within(lead).getByRole("button", { name: /^Edit / }));
    fireEvent.click(screen.getByRole("button", { name: "Make a new team" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New team name" }), { target: { value: "Partnerships" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create" })); });
    expect(screen.getByRole("button", { name: "Partnerships" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(Array.from(document.querySelectorAll(".team-roster__row")).some((row) => row.textContent?.includes("Partnerships"))).toBe(true);
  });
});

describe("Settings › General", () => {
  it("opens settings on General, where an organization admin renames and deletes the organization", async () => {
    render(<Harness preview={fixture({})} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    const name = screen.getByRole("textbox", { name: "Organization name" }) as HTMLInputElement;
    expect(name.value).toBe("Brightline");
    // Save appears only once the name changes; Esc puts the saved name back.
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    fireEvent.change(name, { target: { value: "Brightline Korea" } });
    fireEvent.keyDown(name, { key: "Escape" });
    expect((screen.getByRole("textbox", { name: "Organization name" }) as HTMLInputElement).value).toBe("Brightline");
    fireEvent.change(screen.getByRole("textbox", { name: "Organization name" }), { target: { value: "  Brightline Korea " } });
    // The Save button submits the field's form, which Enter also submits in the browser.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Save/ })); });
    expect(document.querySelector(".team-title")!.textContent).toContain("Brightline Korea");
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    // Deleting is the danger zone's, not the end of the members list.
    fireEvent.click(screen.getByRole("button", { name: "Delete organization" }));
    expect(screen.getByRole("dialog", { name: "Delete this organization?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("gives a manager General, Sharing and Export, with their teams, their reach and leaving", () => {
    render(<Harness preview={fixture({ viewer: "manager" })} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    const inner = Array.from(document.querySelectorAll(".team-settings__tabs [role=tab]")).map((tab) => tab.textContent);
    expect(inner).toEqual(["General", "Sharing", "Export"]);
    // A manager reads the name; only organization admins rename.
    expect(screen.queryByRole("textbox", { name: "Organization name" })).toBeNull();
    expect(screen.getByText("Your team")).toBeTruthy();
    expect(screen.getByText("Can see")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
    expect(screen.getByRole("dialog", { name: "Leave Brightline?" })).toBeTruthy();
  });
});

describe("organization admins, ownership, deleting and teams (2026-10-23)", () => {
  const editableMemberRow = () => Array.from(document.querySelectorAll<HTMLElement>(".team-roster__row"))
    .find((row) => !row.textContent?.includes("Team manager") && !row.textContent?.includes("Organization admin") && within(row).queryByRole("button", { name: /^Edit / }))!;

  it("makes someone an organization admin, then hands them the organization from General", async () => {
    render(<Harness preview={fixture({})} />);
    openSettings("General");
    // No organization admin yet: transferring waits for one.
    expect((screen.getByRole("button", { name: "Transfer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("To hand it over, first make someone an organization admin in Members.")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    const row = editableMemberRow();
    const name = row.querySelector(".team-set-member__name")!.textContent!;
    fireEvent.click(within(row).getByRole("button", { name: /^Edit / }));
    fireEvent.click(screen.getByRole("radio", { name: "Organization admin" }));
    expect(screen.getByText("Manages every team and the settings, and can be handed the team.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    const promoted = Array.from(document.querySelectorAll<HTMLElement>(".team-roster__row")).find((candidate) => candidate.textContent?.includes(name))!;
    expect(promoted.textContent).toContain("Organization admin");

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    const dialog = screen.getByRole("dialog", { name: "Transfer Brightline?" });
    expect(within(dialog).getByRole("combobox", { name: "New owner" }).textContent).toContain(name);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Transfer" })); });
    // The previous owner stays an organization admin: they may leave now, and delete no longer.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Leave organization" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete organization" })).toBeNull();
  });

  it("closes a deleted organization at once and keeps it 30 days for its owner to restore", async () => {
    render(<Harness preview={fixture({})} />);
    openSettings("General");
    expect(screen.getByText(/After 30 days every team, member, project and shared total is deleted for good/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete organization" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this organization?" });
    expect(dialog.textContent).toContain("For 30 days, the owner can restore it.");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "brightline" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Delete organization" })); });
    const scheduled = screen.getByRole("region", { name: "Teams being deleted" });
    expect(scheduled.textContent).toContain("Brightline · being deleted");
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
    await act(async () => { fireEvent.click(within(scheduled).getByRole("button", { name: "Restore" })); });
    expect(screen.queryByRole("region", { name: "Teams being deleted" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeTruthy();
  });

  it("renames a team and deletes another, moving its people, from Settings › Teams", async () => {
    render(<Harness preview={fixture({})} />);
    openSettings("Teams");
    fireEvent.click(screen.getByRole("button", { name: "Edit Sales" }));
    const edit = screen.getByRole("dialog", { name: "Sales" });
    fireEvent.change(within(edit).getByRole("textbox", { name: "Name" }), { target: { value: "Sales East" } });
    await act(async () => { fireEvent.click(within(edit).getByRole("button", { name: "Save" })); });
    expect(screen.getByRole("button", { name: "Edit Sales East" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit Legal" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Legal" })).getByRole("button", { name: "Delete team" }));
    const confirm = screen.getByRole("dialog", { name: "Delete Legal?" });
    expect(within(confirm).getByRole("combobox", { name: "Move its people to" })).toBeTruthy();
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Delete team" })); });
    expect(screen.queryByRole("button", { name: "Edit Legal" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists open invites under Members and revokes one", async () => {
    render(<Harness preview={fixture({})} />);
    openSettings("Members");
    fireEvent.click(screen.getByRole("button", { name: "Invites 1" }));
    const list = screen.getByRole("list", { name: "Open invites" });
    const code = within(list).getByText(/^DRFT-/).textContent!;
    await act(async () => { fireEvent.click(within(list).getByRole("button", { name: "Revoke invite " + code })); });
    expect(screen.getByText("No open invites.")).toBeTruthy();
  });

  it("tells a member once that the team now shares more of their records", () => {
    const preview = fixture({ viewer: "member" });
    // What the member last saw: project time per person by day, no focus.
    window.localStorage.setItem("drifty.team.sharingSeen.v1:" + preview.team.organization_id, JSON.stringify({ projects: "member_daily", tasks: "member_daily", focus: "off", memberSummary: true }));
    const view = render(<Harness preview={preview} />);
    const notice = screen.getByRole("status", { name: "Your team now shares more" });
    expect(notice.textContent).toContain("From now on the team also sees: Focus time. Earlier records stay unshared.");
    fireEvent.click(within(notice).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("status", { name: "Your team now shares more" })).toBeNull();
    view.unmount();
    // Seen once, it stays away.
    render(<Harness preview={preview} />);
    expect(screen.queryByRole("status", { name: "Your team now shares more" })).toBeNull();
  });
});

describe("the Settings tab", () => {
  const managerRow = () => Array.from(document.querySelectorAll<HTMLElement>(".team-roster__row")).find((row) => row.textContent?.includes("Individual detail"))!;

  it("lays the hours out as one row per setting with compact controls", () => {
    window.localStorage.setItem("drifty.dev.teamHoursZone", "choose");
    render(<Harness preview={fixture({})} />);
    openSettings("Hours");
    expect(document.querySelectorAll(".team-form-row")).toHaveLength(4);
    expect(screen.getByRole("combobox", { name: "Pausing" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Whose clock" })).toBeTruthy();
  });

  it("puts settings in a tab of the team page, where a confirmation stands alone", () => {
    render(<Harness preview={fixture({ viewer: "member" })} />);
    expect(screen.queryByRole("button", { name: "Team settings" })).toBeNull();
    openSettings();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(document.querySelector(".team-settings-page")).toBeNull();
  });

  it("edits a person in one dialog over the list, which gives way to the removal confirmation", () => {
    render(<Harness preview={fixture({})} />);
    openSettings("Members");
    const name = managerRow().querySelector(".team-set-member__name")!.textContent!;
    fireEvent.click(within(managerRow()).getByRole("button", { name: /^Edit / }));
    // The list stays behind the dialog, and team-wide settings stay with the list.
    expect(document.querySelectorAll(".team-roster__row").length).toBeGreaterThan(1);
    const person = screen.getByRole("dialog", { name });
    expect(within(person).queryByRole("button", { name: "Delete team" })).toBeNull();
    fireEvent.click(within(person).getByRole("button", { name: "Remove from team" }));
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]!.getAttribute("aria-labelledby")).toBe("team-confirm-title");
    // Cancelling the confirmation brings the person back, not the bare list.
    fireEvent.click(within(dialogs[0]!).getByRole("button", { name: /^Cancel/ }));
    expect(screen.getByRole("dialog", { name })).toBeTruthy();
  });
});
