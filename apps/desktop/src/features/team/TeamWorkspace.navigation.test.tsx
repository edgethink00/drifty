// @vitest-environment jsdom
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamWorkspace } from "./TeamWorkspace";
import { useTeamPreviewController } from "./teamPreview";
import { buildTeamPreviewFixture, type TeamPreviewFixture } from "./teamPreviewScenarios";
import type { TeamProjectsSubView } from "./useTeamProjects";

const fixture = (scale: "team" | "company" = "team") => buildTeamPreviewFixture({ scenario: { scale, scope: "focus_blocks", viewer: "owner", policy: "managed" }, today: "2026-10-17", nowMs: Date.parse("2026-10-17T05:10:00Z"), nowMinuteOfDay: 850 });
function Harness({ preview = fixture() }: { readonly preview?: TeamPreviewFixture }) {
  const controller = useTeamPreviewController(preview);
  const [view, setView] = useState<TeamProjectsSubView>("dashboards");
  return <LocalizationTestProvider language="en"><TeamWorkspace controller={controller} previewFixture={preview} isSupabaseEnabled={false} hasRequiredAccountAuth={false} isSignedIn={false} user={null} startOfDayMinutes={0} subView={view} onSubViewChange={setView} onSignIn={vi.fn()} onCopyInvite={vi.fn()} onAcceptPendingInvite={vi.fn()} /></LocalizationTestProvider>;
}

// These cases describe the earlier candidates where they set none; the options decided on 2026-10-21
// (path title, team switcher, the Rize own-row view, per-manager grants, the hours clock, three besides the member)
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

describe("leaving Settings and people who leave (owner decisions 2026-10-25)", () => {
  it("asks before leaving Settings with unsaved sharing, and saving or dropping it then goes on", () => {
    render(<Harness preview={fixture()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Sharing" }));
    fireEvent.click(screen.getByRole("switch", { name: "Focus time" }));
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    const dialog = screen.getByRole("dialog", { name: "Save your changes?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Don't save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Sharing" }));
    expect(screen.getByRole("switch", { name: "Focus time" }).getAttribute("aria-checked")).toBe("true");
    // Cancel stays in Settings with the edit kept.
    fireEvent.click(screen.getByRole("switch", { name: "Focus time" }));
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Save your changes?" })).getByRole("button", { name: /Cancel/ }));
    expect(screen.getByRole("switch", { name: "Focus time" }).getAttribute("aria-checked")).toBe("false");
  });

  it("keeps what a removed member shared, lists them as former, and deletes it only on request", async () => {
    render(<Harness preview={fixture()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Nadia Choi" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from team" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "Remove Nadia Choi from the team?" })).getByRole("button", { name: /^Remove/ })); });
    fireEvent.click(screen.getByRole("button", { name: /^Former 1/ }));
    expect(within(screen.getByRole("list", { name: "Former members" })).getByText("Nadia Choi")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByRole("button", { name: "Open Nadia Choi's focus" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Members" }));
    fireEvent.click(screen.getByRole("button", { name: /^Former 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete shared records" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "Delete what Nadia Choi shared?" })).getByRole("button", { name: /^Delete records/ })); });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.queryByRole("button", { name: "Open Nadia Choi's focus" })).toBeNull();
  });
});

describe("team member page navigation", () => {
  it("keeps the invite dialog's link and code in place while the link is made, and retries a failure there, on a server without email invites (2026-10-29)", () => {
    const create = vi.fn().mockResolvedValue(undefined);
    function InviteHarness({ loading, error }: { readonly loading: boolean; readonly error: string | null }) {
      const preview = fixture();
      const controller = useTeamPreviewController(preview);
      const [view, setView] = useState<TeamProjectsSubView>("dashboards");
      return <LocalizationTestProvider language="en"><TeamWorkspace controller={{ ...controller, invites: [], teamActionLoading: loading, teamActionError: error, handleCreateInvite: create, handleSendEmailInvites: undefined }} previewFixture={preview} isSupabaseEnabled={false} hasRequiredAccountAuth={false} isSignedIn={false} user={null} startOfDayMinutes={0} subView={view} onSubViewChange={setView} onSignIn={vi.fn()} onCopyInvite={vi.fn()} onAcceptPendingInvite={vi.fn()} /></LocalizationTestProvider>;
    }
    const { rerender } = render(<InviteHarness loading error={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Invite teammate" }));
    const dialog = screen.getByRole("dialog", { name: /^Invite to/ });
    expect(within(dialog).getByRole("textbox", { name: "Invite link" }).getAttribute("placeholder")).toBe("Creating an invite…");
    expect((within(dialog).getByRole("button", { name: "Copy link" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText("Invite code")).toBeTruthy();

    rerender(<InviteHarness loading={false} error="Unable to create invite." />);
    create.mockClear();
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(create).toHaveBeenCalledWith({ organization_id: expect.any(String) });
  });

  it("finds people by search and shows them as cards or a list, never sorted by their time (decided 2026-10-25)", () => {
    render(<Harness preview={fixture()} />);
    expect(screen.getByRole("textbox", { name: "Search members…" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Show members as" })).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Sort members/ })).toBeNull();
    expect(screen.queryByLabelText("Sort members")).toBeNull();
  });

  it("keeps the team header and switcher while hiding only the team tabs on member detail", () => {
    render(<Harness preview={fixture()} />);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Nadia Choi's focus" }));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.getByRole("button", { name: "Invite teammate" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Teams" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Nadia Choi" })).toBe(document.activeElement);
    fireEvent.click(screen.getByRole("button", { name: "Switch team. Current team: Sales Team" }));
    expect(screen.getByRole("menu", { name: "Your teams" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch team. Current team: Sales Team" }));
    expect(screen.getAllByText("Preview data")).toHaveLength(1);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(within(screen.getByRole("navigation", { name: "Member navigation" })).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Team Overview" }));
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Projects" })).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });

  it("keeps the selected period and date window while stepping people and returning", () => {
    render(<Harness preview={fixture()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Nadia Choi's focus" }));
    fireEvent.click(screen.getByRole("radio", { name: "Month" }));
    const navigator = document.querySelector(".team-member-detail__range .day-nav")!;
    fireEvent.click(within(navigator as HTMLElement).getAllByRole("button")[0]!);
    const range = navigator.querySelector("strong")!.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Next member" }));
    expect(screen.queryByRole("heading", { level: 2, name: "Nadia Choi" })).toBeNull();
    expect(document.querySelector(".day-nav strong")!.textContent).toBe(range);
    fireEvent.click(screen.getByRole("button", { name: "Team Overview" }));
    expect(screen.getByRole("radio", { name: "Month" }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".day-nav strong")!.textContent).toBe(range);
  });

  it("returns to the current group instead of the organization root", () => {
    const preview = fixture("company");
    render(<Harness preview={preview} />);
    const group = preview.dataset.groups.find((entry) => entry.parent_group_id === null)!;
    fireEvent.click(screen.getByRole("button", { name: "Open " + group.name }));
    const member = preview.dataset.members.find((entry) => entry.group_id === group.id)!;
    fireEvent.click(screen.getByRole("button", { name: "Open " + member.display_name + "'s focus" }));
    expect(document.querySelector(".team-member-detail__context")!.textContent).toContain(group.name);
    fireEvent.click(screen.getByRole("button", { name: "Team Overview" }));
    expect(screen.getByRole("button", { name: "Open " + member.display_name + "'s focus" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open " + group.name })).toBeNull();
  });
});
