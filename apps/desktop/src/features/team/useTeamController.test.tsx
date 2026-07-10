// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, makeTeam, ok, pendingInvite, privateTeam, renderController } from "./useTeamControllerTestFixtures";

const teamServiceMocks = vi.hoisted(() => ({
  fetchOwnTeams: vi.fn(),
  fetchTeamInvites: vi.fn(),
  createTeam: vi.fn(),
  acceptTeamInvite: vi.fn(),
  createTeamInvite: vi.fn(),
  revokeTeamInvite: vi.fn(),
}));

vi.mock("./teamService", () => ({
  DEFAULT_TEAM_PERIOD: "weekly",
  TEAM_PERIODS: ["daily", "weekly", "monthly"],
  fetchOwnTeams: teamServiceMocks.fetchOwnTeams,
  fetchTeamInvites: teamServiceMocks.fetchTeamInvites,
  createTeam: teamServiceMocks.createTeam,
  acceptTeamInvite: teamServiceMocks.acceptTeamInvite,
  createTeamInvite: teamServiceMocks.createTeamInvite,
  revokeTeamInvite: teamServiceMocks.revokeTeamInvite,
  isTeamErrorMessage: (value: unknown): value is { readonly message: string } => (
    typeof value === "object" && value !== null && "message" in value && typeof (value as { message: unknown }).message === "string"
  ),
  messageFromTeamError: (value: Error | { readonly message: string }, fallback: string) => value.message || fallback,
}));

describe("useTeamController", () => {
  beforeEach(() => {
    teamServiceMocks.fetchOwnTeams.mockReset();
    teamServiceMocks.fetchTeamInvites.mockReset();
    teamServiceMocks.createTeam.mockReset();
    teamServiceMocks.acceptTeamInvite.mockReset();
    teamServiceMocks.createTeamInvite.mockReset();
    teamServiceMocks.revokeTeamInvite.mockReset();
    teamServiceMocks.fetchTeamInvites.mockResolvedValue(ok([]));
  });

  it("Given a non-team tab When the hook renders Then it does not call team services until the team tab is active", async () => {
    // Given
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));

    // When
    const { hook, initialProps } = renderController({ activeTab: "dashboard" });

    // Then
    expect(teamServiceMocks.fetchOwnTeams).not.toHaveBeenCalled();

    // When
    hook.rerender({
      ...initialProps,
      activeTab: "team",
    });

    // Then
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));
    expect(teamServiceMocks.fetchOwnTeams).toHaveBeenCalledWith();
    await waitFor(() => expect(teamServiceMocks.fetchTeamInvites).toHaveBeenCalledWith({ organization_id: "team-1" }));
  });

  it("Given a non-team tab When refresh runs directly Then it does not call team services", async () => {
    // Given
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController({ activeTab: "dashboard" });

    // When
    await act(async () => {
      await hook.result.current.refreshTeamData();
    });

    // Then
    expect(teamServiceMocks.fetchOwnTeams).not.toHaveBeenCalled();
    expect(teamServiceMocks.fetchTeamInvites).not.toHaveBeenCalled();
  });

  it("Given loaded team rows When invite actions run Then it calls team services and refreshes invite state", async () => {
    // Given
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamInvites
      .mockResolvedValueOnce(ok([pendingInvite]))
      .mockResolvedValueOnce(ok([{ ...pendingInvite, invite_id: "invite-2", invite_code: "DRFT-WXYZ-6789" }]))
      .mockResolvedValueOnce(ok([]));
    teamServiceMocks.createTeamInvite.mockResolvedValue(ok({
      ok: true,
      action: "create",
      inviteId: "invite-2",
      organizationId: "team-1",
    }));
    teamServiceMocks.revokeTeamInvite.mockResolvedValue(ok({
      ok: true,
      action: "revoke",
      inviteId: "invite-1",
      organizationId: "team-1",
    }));

    // When
    const { hook } = renderController();

    // Then
    await waitFor(() => expect(hook.result.current.invites).toEqual([pendingInvite]));

    // When
    await act(async () => {
      await hook.result.current.handleCreateInvite({ organization_id: "team-1", role_label: "Reviewer" });
    });

    // Then
    expect(teamServiceMocks.createTeamInvite).toHaveBeenCalledWith({ organization_id: "team-1", role_label: "Reviewer" });
    await waitFor(() => expect(hook.result.current.invites[0]?.invite_id).toBe("invite-2"));

    // When
    await act(async () => {
      await hook.result.current.handleRevokeInvite({ invite_id: "invite-1" });
    });

    // Then
    expect(teamServiceMocks.revokeTeamInvite).toHaveBeenCalledWith({ invite_id: "invite-1" });
    await waitFor(() => expect(hook.result.current.invites).toEqual([]));
  });

  it("Given create or join succeeds When membership changes Then it refreshes teams and prefers the returned organization", async () => {
    // Given
    const createdTeam = makeTeam({ organization_id: "team-2", organization_name: "Focus Guild", role_label: "Coach" });
    teamServiceMocks.fetchOwnTeams
      .mockResolvedValueOnce(ok([privateTeam]))
      .mockResolvedValueOnce(ok([privateTeam, createdTeam]))
      .mockResolvedValueOnce(ok([createdTeam]));
    teamServiceMocks.createTeam.mockResolvedValue(ok(createdTeam));
    teamServiceMocks.acceptTeamInvite.mockResolvedValue(ok({
      ok: true,
      action: "accept",
      organizationId: "team-2",
      organizationName: "Focus Guild",
    }));

    // When
    const { hook } = renderController();

    // Then
    await waitFor(() => expect(hook.result.current.selectedTeam?.organization_id).toBe("team-1"));

    // When
    await act(async () => {
      await hook.result.current.handleCreateTeam({ organizationName: "Focus Guild", roleLabel: "Coach" });
    });

    // Then
    expect(teamServiceMocks.createTeam).toHaveBeenCalledWith({ organizationName: "Focus Guild", roleLabel: "Coach" });
    await waitFor(() => expect(hook.result.current.selectedTeam?.organization_id).toBe("team-2"));

    // When
    await act(async () => {
      await hook.result.current.handleAcceptInvite({ inviteKey: "DRFT-WXYZ-6789" });
    });

    // Then
    expect(teamServiceMocks.acceptTeamInvite).toHaveBeenCalledWith({ inviteKey: "DRFT-WXYZ-6789" });
    expect(teamServiceMocks.fetchOwnTeams).toHaveBeenCalledTimes(3);
  });

  it("Given loaded team rows When a background refresh fails Then stale rows remain visible with a background error", async () => {
    // Given
    teamServiceMocks.fetchOwnTeams.mockResolvedValueOnce(ok([privateTeam])).mockResolvedValueOnce(fail("Network unavailable"));

    // When
    const { hook } = renderController();

    // Then
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));

    // When
    await act(async () => {
      await hook.result.current.refreshTeamData();
    });

    // Then
    expect(hook.result.current.teams).toEqual([privateTeam]);
    expect(hook.result.current.teamError).toBeNull();
    expect(hook.result.current.teamStatusMessage).toBe("Network unavailable");
    expect(hook.result.current.teamStatusTone).toBe("error");
  });

  it("Given disabled or insufficient account states When load and actions run Then team services are not called", async () => {
    // Given
    const disabled = renderController({ isSupabaseConfigured: false });
    const signedOut = renderController({ user: null });
    const fullAccountRequired = renderController({ hasRequiredAccountAuth: false });

    // When
    await act(async () => {
      await disabled.hook.result.current.handleCreateInvite({ organization_id: "team-1" });
      await signedOut.hook.result.current.handleCreateInvite({ organization_id: "team-1" });
      await fullAccountRequired.hook.result.current.handleCreateInvite({ organization_id: "team-1" });
    });

    // Then
    expect(teamServiceMocks.fetchOwnTeams).not.toHaveBeenCalled();
    expect(teamServiceMocks.createTeam).not.toHaveBeenCalled();
    expect(teamServiceMocks.acceptTeamInvite).not.toHaveBeenCalled();
    expect(teamServiceMocks.createTeamInvite).not.toHaveBeenCalled();
    expect(teamServiceMocks.revokeTeamInvite).not.toHaveBeenCalled();
    expect(signedOut.onAuthRequired).toHaveBeenCalledTimes(1);
    expect(fullAccountRequired.onAuthRequired).toHaveBeenCalledTimes(1);
  });
});
