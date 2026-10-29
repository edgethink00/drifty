// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TeamWorkspace } from "./TeamWorkspace";
import { useTeamPreviewController } from "./teamPreview";
import { buildTeamPreviewFixture } from "./teamPreviewScenarios";
import type { TeamProjectsSubView } from "./useTeamProjects";
import type { UseTeamControllerResult } from "./useTeamController";

const preview = buildTeamPreviewFixture({ scenario: { scale: "team", scope: "focus_blocks", viewer: "owner", policy: "managed" }, today: "2026-10-17", nowMs: Date.parse("2026-10-17T05:10:00Z"), nowMinuteOfDay: 850 });
function Harness({ overrides }: { readonly overrides: Partial<UseTeamControllerResult> }) {
  const controller = useTeamPreviewController(preview);
  const [view, setView] = useState<TeamProjectsSubView>("dashboards");
  return <LocalizationTestProvider language="en"><TeamWorkspace controller={{ ...controller, ...overrides }} previewFixture={preview} isSupabaseEnabled={false} hasRequiredAccountAuth={false} isSignedIn={false} user={null} startOfDayMinutes={0} subView={view} onSubViewChange={setView} onSignIn={vi.fn()} onCopyInvite={vi.fn()} onAcceptPendingInvite={vi.fn()} /></LocalizationTestProvider>;
}

beforeEach(() => {
  window.localStorage.setItem("drifty.dev.teamPageTitle", "section");
  window.localStorage.setItem("drifty.dev.teamTitleSwitcher", "organization");
});
afterEach(() => { cleanup(); window.localStorage.clear(); });

async function createTeamThroughWizard() {
  fireEvent.click(screen.getByRole("button", { name: /^Switch team/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Create or join a team" }));
  const wizard = screen.getByRole("dialog", { name: "Add a team" });
  fireEvent.change(within(wizard).getByLabelText("Team name"), { target: { value: "Design" } });
  fireEvent.click(within(wizard).getByRole("button", { name: "Next" }));
  fireEvent.click(within(wizard).getByRole("button", { name: "Next" }));
  fireEvent.click(within(wizard).getByRole("combobox", { name: "Pausing" }));
  fireEvent.click(screen.getByRole("option", { name: /^Members can pause/ }));
  fireEvent.click(within(wizard).getByRole("button", { name: "Next" }));
  await act(async () => { fireEvent.click(within(wizard).getByRole("button", { name: "Create team" })); });
}

describe("a new team's first invite (2026-10-29)", () => {
  it("opens the email invite dialog once the team exists, which also makes its link", async () => {
    const makeLink = vi.fn().mockResolvedValue(undefined);
    const createTeam = vi.fn(async () => true);
    render(<Harness overrides={{ invites: [], handleCreateInvite: makeLink, handleCreateTeamWithPolicy: createTeam }} />);
    await createTeamThroughWizard();
    expect(createTeam).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a team" })).toBeNull());
    const invite = screen.getByRole("dialog", { name: /^Invite to/ });
    expect(within(invite).getByLabelText("Email addresses")).toBeTruthy();
    expect(within(invite).getByRole("button", { name: /^Send invite/ })).toBeTruthy();
    expect(makeLink).toHaveBeenCalledWith({ organization_id: expect.any(String) });
  });

  it("stays in the wizard with the reason when the team was made but its sharing was not saved", async () => {
    const createTeam = vi.fn(async () => true);
    render(<Harness overrides={{ handleCreateTeamWithPolicy: createTeam, teamActionError: "The team was made, but its sharing was not saved. Set it in Settings before inviting anyone." }} />);
    await createTeamThroughWizard();
    const wizard = screen.getByRole("dialog", { name: "Add a team" });
    expect(within(wizard).getByRole("button", { name: "Done" })).toBeTruthy();
    expect(within(wizard).queryByRole("button", { name: "Create team" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: /^Invite to/ })).toBeNull();
    fireEvent.click(within(wizard).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Add a team" })).toBeNull();
    expect(createTeam).toHaveBeenCalledTimes(1);
  });
});
