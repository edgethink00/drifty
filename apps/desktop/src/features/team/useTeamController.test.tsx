// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnTeam } from "./teamService";

import { fail, makeTeam, ok, pendingInvite, privateTeam, renderController } from "./useTeamControllerTestFixtures";
import { subscribeTeamProjectMirrorChanged } from "../../lib/teamProjectMirrorEvents";

const teamServiceMocks = vi.hoisted(() => ({
  fetchOwnTeams: vi.fn(),
  fetchTeamInvites: vi.fn(),
  createTeam: vi.fn(),
  acceptTeamInvite: vi.fn(),
  createTeamInvite: vi.fn(),
  revokeTeamInvite: vi.fn(),
  setTeamMemberInvites: vi.fn(),
  fetchTeamMembers: vi.fn(),
  removeTeamMember: vi.fn(),
  leaveTeam: vi.fn(),
  deleteTeam: vi.fn(),
}));

const trackerMocks = vi.hoisted(() => ({
  getTeamProjects: vi.fn(),
  upsertTeamProjects: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: trackerMocks }));

vi.mock("./teamService", () => ({
  DEFAULT_TEAM_PERIOD: "weekly",
  TEAM_PERIODS: ["daily", "weekly", "monthly"],
  fetchOwnTeams: teamServiceMocks.fetchOwnTeams,
  fetchTeamInvites: teamServiceMocks.fetchTeamInvites,
  createTeam: teamServiceMocks.createTeam,
  acceptTeamInvite: teamServiceMocks.acceptTeamInvite,
  createTeamInvite: teamServiceMocks.createTeamInvite,
  revokeTeamInvite: teamServiceMocks.revokeTeamInvite,
  setTeamMemberInvites: teamServiceMocks.setTeamMemberInvites,
  fetchTeamMembers: teamServiceMocks.fetchTeamMembers,
  removeTeamMember: teamServiceMocks.removeTeamMember,
  leaveTeam: teamServiceMocks.leaveTeam,
  deleteTeam: teamServiceMocks.deleteTeam,
  isTeamErrorMessage: (value: unknown): value is { readonly message: string } => (
    typeof value === "object" && value !== null && "message" in value && typeof (value as { message: unknown }).message === "string"
  ),
  messageFromTeamError: (value: Error | { readonly message: string }, fallback: string) => value.message || fallback,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useTeamController", () => {
  beforeEach(() => {
    teamServiceMocks.fetchOwnTeams.mockReset();
    teamServiceMocks.fetchTeamInvites.mockReset();
    teamServiceMocks.createTeam.mockReset();
    teamServiceMocks.acceptTeamInvite.mockReset();
    teamServiceMocks.createTeamInvite.mockReset();
    teamServiceMocks.revokeTeamInvite.mockReset();
    teamServiceMocks.setTeamMemberInvites.mockReset();
    teamServiceMocks.fetchTeamMembers.mockReset();
    teamServiceMocks.removeTeamMember.mockReset();
    teamServiceMocks.leaveTeam.mockReset();
    teamServiceMocks.deleteTeam.mockReset();
    teamServiceMocks.fetchTeamInvites.mockResolvedValue(ok([]));
    trackerMocks.getTeamProjects.mockReset().mockResolvedValue([]);
    trackerMocks.upsertTeamProjects.mockReset().mockResolvedValue([]);
  });

  it("clears the local project mirror of a team the account no longer belongs to, and never on a failed load", async () => {
    trackerMocks.getTeamProjects.mockResolvedValue([
      { id: "project-a", organizationId: "team-1" },
      { id: "project-b", organizationId: "team-gone" },
      { id: "project-c", organizationId: "team-gone" },
    ]);
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(trackerMocks.upsertTeamProjects).toHaveBeenCalledTimes(1));
    expect(trackerMocks.upsertTeamProjects).toHaveBeenCalledWith("team-gone", []);

    trackerMocks.upsertTeamProjects.mockClear();
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(fail("Offline"));
    await act(async () => {
      await hook.result.current.refreshTeamData();
    });
    expect(trackerMocks.upsertTeamProjects).not.toHaveBeenCalled();
  });

  it("loads the owner's roster and reloads the team, roster and invites after a removal", async () => {
    const roster = [
      { member_key: "key-owner", display_name: "Alex", role_label: "Owner", membership_role: "owner", joined_at: "2026-07-01T00:00:00.000Z", is_self: true },
      { member_key: "key-aria", display_name: "Aria", role_label: "Member", membership_role: "member", joined_at: "2026-07-02T00:00:00.000Z", is_self: false },
    ] as const;
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamMembers.mockResolvedValue(ok(roster));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));
    await act(async () => {
      await hook.result.current.refreshMembers("team-1");
    });
    expect(hook.result.current.members).toEqual(roster);

    teamServiceMocks.removeTeamMember.mockResolvedValue(ok({ organization_id: "team-1", member_count: 1, removed_total_rows: 2, revoked_invite_count: 1 }));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([{ ...privateTeam, member_count: 1 }]));
    teamServiceMocks.fetchTeamMembers.mockResolvedValue(ok([roster[0]]));
    teamServiceMocks.fetchTeamInvites.mockClear();
    let removed = false;
    await act(async () => {
      removed = await hook.result.current.handleRemoveMember({ organization_id: "team-1", member_key: "key-aria" });
    });
    expect(removed).toBe(true);
    expect(teamServiceMocks.removeTeamMember).toHaveBeenCalledWith({ organization_id: "team-1", member_key: "key-aria" });
    expect(hook.result.current.members).toEqual([roster[0]]);
    expect(hook.result.current.selectedTeam?.member_count).toBe(1);
    expect(teamServiceMocks.fetchTeamInvites).toHaveBeenCalledWith({ organization_id: "team-1" });
  });

  it("never asks a member for the roster", async () => {
    const memberTeam = makeTeam({ role_label: "Member", membership_role: "member" });
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([memberTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([memberTeam]));
    await act(async () => {
      await hook.result.current.refreshMembers("team-1");
    });
    expect(teamServiceMocks.fetchTeamMembers).not.toHaveBeenCalled();
    expect(hook.result.current.members).toEqual([]);
  });

  it("leaves a team, then selects a remaining team and clears the departed team's local mirror", async () => {
    const memberTeam = makeTeam({ role_label: "Member", membership_role: "member" });
    const otherTeam = makeTeam({ organization_id: "team-2", organization_name: "Studio Crew" });
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([memberTeam, otherTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.selectedTeam?.organization_id).toBe("team-1"));

    trackerMocks.getTeamProjects.mockResolvedValue([{ id: "project-a", organizationId: "team-1" }, { id: "project-b", organizationId: "team-2" }]);
    teamServiceMocks.leaveTeam.mockResolvedValue(ok({ organization_id: "team-1", removed_total_rows: 3, revoked_invite_count: 0 }));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([otherTeam]));
    let left = false;
    await act(async () => {
      left = await hook.result.current.handleLeaveTeam({ organization_id: "team-1" });
    });
    expect(left).toBe(true);
    expect(teamServiceMocks.leaveTeam).toHaveBeenCalledWith({ organization_id: "team-1" });
    expect(hook.result.current.selectedTeam?.organization_id).toBe("team-2");
    await waitFor(() => expect(trackerMocks.upsertTeamProjects).toHaveBeenCalledWith("team-1", []));
    expect(trackerMocks.upsertTeamProjects).not.toHaveBeenCalledWith("team-2", []);
  });

  it("keeps the team and shows the error when leaving is refused", async () => {
    const memberTeam = makeTeam({ role_label: "Member", membership_role: "member" });
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([memberTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([memberTeam]));

    teamServiceMocks.leaveTeam.mockResolvedValue(fail("The team owner cannot leave the team."));
    let left = true;
    await act(async () => {
      left = await hook.result.current.handleLeaveTeam({ organization_id: "team-1" });
    });
    expect(left).toBe(false);
    expect(hook.result.current.teamActionError).toBe("The team owner cannot leave the team.");
    expect(hook.result.current.teams).toEqual([memberTeam]);
  });

  it("deletes a team, then selects a remaining team and clears the deleted team's local mirror", async () => {
    const announced = vi.fn();
    const unsubscribe = subscribeTeamProjectMirrorChanged(announced);
    const otherTeam = makeTeam({ organization_id: "team-2", organization_name: "Studio Crew", role_label: "Member", membership_role: "member" });
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam, otherTeam]));
    teamServiceMocks.fetchTeamMembers.mockResolvedValue(ok([]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.selectedTeam?.organization_id).toBe("team-1"));

    trackerMocks.getTeamProjects.mockResolvedValue([{ id: "project-a", organizationId: "team-1" }, { id: "project-b", organizationId: "team-2" }]);
    teamServiceMocks.deleteTeam.mockResolvedValue(ok({ organization_id: "team-1", member_count: 2, deleted_total_rows: 3 }));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([otherTeam]));
    let deleted = false;
    await act(async () => {
      deleted = await hook.result.current.handleDeleteTeam({ organization_id: "team-1", confirmation_name: privateTeam.organization_name });
    });
    expect(deleted).toBe(true);
    expect(teamServiceMocks.deleteTeam).toHaveBeenCalledWith({ organization_id: "team-1", confirmation_name: privateTeam.organization_name });
    expect(hook.result.current.selectedTeam?.organization_id).toBe("team-2");
    expect(hook.result.current.members).toEqual([]);
    await waitFor(() => expect(trackerMocks.upsertTeamProjects).toHaveBeenCalledWith("team-1", []));
    expect(trackerMocks.upsertTeamProjects).not.toHaveBeenCalledWith("team-2", []);
    // Project analysis counts team projects, so the prune is announced.
    await waitFor(() => expect(announced).toHaveBeenCalled());
    unsubscribe();
  });

  it("keeps the team and shows the error when deleting is refused", async () => {
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamMembers.mockResolvedValue(ok([]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));

    teamServiceMocks.deleteTeam.mockResolvedValue(fail("Type the team name to confirm."));
    let deleted = true;
    await act(async () => {
      deleted = await hook.result.current.handleDeleteTeam({ organization_id: "team-1", confirmation_name: "wrong" });
    });
    expect(deleted).toBe(false);
    expect(hook.result.current.teamActionError).toBe("Type the team name to confirm.");
    expect(hook.result.current.teams).toEqual([privateTeam]);
    expect(trackerMocks.upsertTeamProjects).not.toHaveBeenCalledWith("team-1", []);
  });

  it("does not read invites for a member whose team keeps invites owner-only, and does once the owner allows it", async () => {
    const blockedTeam = makeTeam({ role_label: "Member", membership_role: "member", members_can_invite: false });
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([blockedTeam]));

    const { hook } = renderController();

    await waitFor(() => expect(hook.result.current.teams).toEqual([blockedTeam]));
    expect(teamServiceMocks.fetchTeamInvites).not.toHaveBeenCalled();
    expect(hook.result.current.invites).toEqual([]);
    expect(hook.result.current.teamActionError).toBeNull();

    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([{ ...blockedTeam, members_can_invite: true }]));
    teamServiceMocks.fetchTeamInvites.mockResolvedValue(ok([pendingInvite]));
    await act(async () => {
      await hook.result.current.refreshTeamData();
    });

    expect(teamServiceMocks.fetchTeamInvites).toHaveBeenCalledWith({ organization_id: "team-1" });
    expect(hook.result.current.invites).toEqual([pendingInvite]);
  });

  it("changes the member invite setting, then reloads the team and its invites", async () => {
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));
    teamServiceMocks.fetchOwnTeams.mockClear();
    teamServiceMocks.fetchTeamInvites.mockClear();

    const updatedTeam = { ...privateTeam, members_can_invite: false };
    teamServiceMocks.setTeamMemberInvites.mockResolvedValue(ok({ organization_id: "team-1", members_can_invite: false }));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([updatedTeam]));
    await act(async () => {
      await hook.result.current.handleSetMemberInvites({ organization_id: "team-1", enabled: false });
    });

    expect(teamServiceMocks.setTeamMemberInvites).toHaveBeenCalledWith({ organization_id: "team-1", enabled: false });
    expect(teamServiceMocks.fetchOwnTeams).toHaveBeenCalledTimes(1);
    expect(teamServiceMocks.fetchTeamInvites).toHaveBeenCalledWith({ organization_id: "team-1" });
    expect(hook.result.current.selectedTeam).toEqual(updatedTeam);
  });

  it("shows the live link alongside the error when a member's invite request is refused", async () => {
    const memberTeam = makeTeam({ role_label: "Member", membership_role: "member", members_can_invite: true });
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([memberTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([memberTeam]));

    teamServiceMocks.createTeamInvite.mockResolvedValue(fail("This team already has an active invite link."));
    teamServiceMocks.fetchTeamInvites.mockResolvedValue(ok([pendingInvite]));
    await act(async () => {
      await hook.result.current.handleCreateInvite({ organization_id: "team-1" });
    });

    expect(hook.result.current.invites).toEqual([pendingInvite]);
    expect(hook.result.current.teamActionError).toBe("This team already has an active invite link.");
  });

  it("reports a refused member invite setting without reloading", async () => {
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));
    teamServiceMocks.fetchOwnTeams.mockClear();

    teamServiceMocks.setTeamMemberInvites.mockResolvedValue(fail("Only the team owner can change who can invite."));
    await act(async () => {
      await hook.result.current.handleSetMemberInvites({ organization_id: "team-1", enabled: false });
    });

    expect(hook.result.current.teamActionError).toBe("Only the team owner can change who can invite.");
    expect(teamServiceMocks.fetchOwnTeams).not.toHaveBeenCalled();
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

  it("Given an in-flight team load When the user logs out Then its late result cannot repopulate team state", async () => {
    // Given
    const firstRequest = deferred<ReturnType<typeof ok<OwnTeam[]>>>();
    teamServiceMocks.fetchOwnTeams.mockReturnValueOnce(firstRequest.promise);
    const { hook, initialProps } = renderController();
    await waitFor(() => expect(teamServiceMocks.fetchOwnTeams).toHaveBeenCalledTimes(1));

    // When
    hook.rerender({ ...initialProps, user: null });
    await act(async () => {
      firstRequest.resolve(ok([privateTeam]));
      await firstRequest.promise;
    });

    // Then
    expect(hook.result.current.teams).toEqual([]);
    expect(hook.result.current.selectedTeam).toBeNull();
  });

  it("Given an in-flight team load for account A When account B becomes active away from Teams Then A's late result cannot populate state", async () => {
    // Given
    const firstRequest = deferred<ReturnType<typeof ok<OwnTeam[]>>>();
    teamServiceMocks.fetchOwnTeams.mockReturnValueOnce(firstRequest.promise);
    const { hook, initialProps } = renderController();
    await waitFor(() => expect(teamServiceMocks.fetchOwnTeams).toHaveBeenCalledTimes(1));
    const userB = { ...initialProps.user!, id: "user-2", email: "blair@example.com" };

    // When
    hook.rerender({ ...initialProps, activeTab: "dashboard", user: userB });
    await act(async () => {
      firstRequest.resolve(ok([makeTeam({ organization_id: "team-a" })]));
      await firstRequest.promise;
    });

    // Then
    expect(teamServiceMocks.fetchOwnTeams).toHaveBeenCalledTimes(1);
    expect(hook.result.current.teams).toEqual([]);
    expect(hook.result.current.selectedTeam).toBeNull();
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
