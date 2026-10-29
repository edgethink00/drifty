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
  fetchTeamEmailInvites: vi.fn(),
  fetchOwnEmailInvites: vi.fn(),
  sendTeamEmailInvites: vi.fn(),
  cancelTeamEmailInvite: vi.fn(),
}));

const trackerMocks = vi.hoisted(() => ({
  getTeamProjects: vi.fn(),
  upsertTeamProjects: vi.fn(),
}));

const sharingMocks = vi.hoisted(() => ({
  fetchTeamServerPolicy: vi.fn(),
  saveTeamServerPolicy: vi.fn(),
  fetchTeamManagers: vi.fn(),
  setTeamMemberRole: vi.fn(),
  renameTeam: vi.fn(),
  transferTeamOwnership: vi.fn(),
  fetchScheduledTeamDeletions: vi.fn(),
  restoreTeam: vi.fn(),
  fetchTeamFormerMembers: vi.fn(async () => ({ success: true, data: [], error: null })),
  deleteFormerMemberRecords: vi.fn(),
}));

vi.mock("../../lib/api/trackerClient", () => ({ trackerClient: trackerMocks }));
vi.mock("./teamSharingService", () => sharingMocks);

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
  fetchTeamEmailInvites: teamServiceMocks.fetchTeamEmailInvites,
  fetchOwnEmailInvites: teamServiceMocks.fetchOwnEmailInvites,
  sendTeamEmailInvites: teamServiceMocks.sendTeamEmailInvites,
  cancelTeamEmailInvite: teamServiceMocks.cancelTeamEmailInvite,
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
    teamServiceMocks.fetchTeamEmailInvites.mockReset().mockResolvedValue(ok([]));
    teamServiceMocks.fetchOwnEmailInvites.mockReset().mockResolvedValue(ok([]));
    teamServiceMocks.sendTeamEmailInvites.mockReset();
    teamServiceMocks.cancelTeamEmailInvite.mockReset();
    trackerMocks.getTeamProjects.mockReset().mockResolvedValue([]);
    trackerMocks.upsertTeamProjects.mockReset().mockResolvedValue([]);
    // An older server has no sharing calls: the beta's single-scope settings stay.
    sharingMocks.fetchTeamServerPolicy.mockReset().mockResolvedValue(fail("Could not find the function"));
    sharingMocks.saveTeamServerPolicy.mockReset();
    sharingMocks.fetchTeamManagers.mockReset().mockResolvedValue(ok([]));
    sharingMocks.fetchScheduledTeamDeletions.mockReset().mockResolvedValue(ok([]));
    sharingMocks.setTeamMemberRole.mockReset();
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

  it("shows the link a create response returns without reading the invite list again (2026-10-29)", async () => {
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));
    await waitFor(() => expect(teamServiceMocks.fetchTeamInvites).toHaveBeenCalled());
    teamServiceMocks.fetchTeamInvites.mockClear();

    teamServiceMocks.createTeamInvite.mockResolvedValue(ok({
      ok: true,
      action: "create",
      inviteId: "invite-9",
      organizationId: "team-1",
      organizationName: "Deep Work Crew",
      roleLabel: "Member",
      expiresAt: "2026-11-05T00:00:00.000Z",
      inviteCode: "DRFT-WXYZ-6789",
      inviteUrl: "https://drifty.so/team-invite?token=bearer-token-not-for-display&code=DRFT-WXYZ-6789",
    }));
    await act(async () => {
      await hook.result.current.handleCreateInvite({ organization_id: "team-1" });
    });

    expect(teamServiceMocks.fetchTeamInvites).not.toHaveBeenCalled();
    // The shown link carries the code only, as the list's link does.
    expect(hook.result.current.invites[0]).toMatchObject({ invite_id: "invite-9", invite_code: "DRFT-WXYZ-6789", invite_url: "/team-invite?code=DRFT-WXYZ-6789", status: "pending" });
    expect(hook.result.current.teamActionLoading).toBe(false);
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

  it("sends email invites with the per-address outcomes and refreshes them, leaving the page's error alone (2026-10-29)", async () => {
    const emailInvite = {
      invite_id: "email-1", invited_email: "hana@company.com", status: "pending" as const, expires_at: "2026-11-05T00:00:00Z",
      last_sent_at: "2026-10-29T00:00:00Z", send_count: 1, created_at: "2026-10-29T00:00:00Z", sent_by_me: true,
    };
    const results = [{ email: "hana@company.com", outcome: "sent" as const }, { email: "alex@company.com", outcome: "member" as const }];
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamEmailInvites.mockResolvedValueOnce(ok([])).mockResolvedValue(ok([emailInvite]));
    teamServiceMocks.sendTeamEmailInvites.mockResolvedValue(ok(results));
    const { hook } = renderController();
    await waitFor(() => expect(teamServiceMocks.fetchTeamEmailInvites).toHaveBeenCalledWith({ organization_id: "team-1" }));

    let outcome: unknown;
    await act(async () => {
      outcome = await hook.result.current.handleSendEmailInvites!({ organization_id: "team-1", emails: ["hana@company.com", "alex@company.com"], locale: "ko" });
    });

    expect(teamServiceMocks.sendTeamEmailInvites).toHaveBeenCalledWith({ organization_id: "team-1", emails: ["hana@company.com", "alex@company.com"], locale: "ko" });
    expect(outcome).toEqual({ ok: true, results });
    await waitFor(() => expect(hook.result.current.emailInvites).toEqual([emailInvite]));
    expect(hook.result.current.teamActionError).toBeNull();
  });

  it("keeps the dialog's link alone on a server without email invites (2026-10-29)", async () => {
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamEmailInvites.mockResolvedValue({ success: false, error: "Could not find the function", reason: "unsupported" });
    const { hook } = renderController();
    await waitFor(() => expect(teamServiceMocks.fetchTeamEmailInvites).toHaveBeenCalled());
    await waitFor(() => expect(hook.result.current.handleSendEmailInvites).toBeUndefined());
    expect(hook.result.current.emailInvites).toBeUndefined();
    expect(hook.result.current.teamActionError).toBeNull();
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

describe("useTeamController on a server that stores sharing", () => {
  const serverPolicy = (overrides: Record<string, unknown> = {}) => ({
    organization_id: "team-1", policy: null, tracking_policy: "free", schedule: null,
    seat: "admin", manager_access: "totals", manager_may_narrow: false, updated_at: null,
    ...overrides,
  });

  beforeEach(() => {
    teamServiceMocks.fetchOwnTeams.mockReset();
    teamServiceMocks.fetchTeamInvites.mockReset().mockResolvedValue(ok([]));
    teamServiceMocks.createTeam.mockReset();
    trackerMocks.getTeamProjects.mockReset().mockResolvedValue([]);
    trackerMocks.upsertTeamProjects.mockReset().mockResolvedValue([]);
    sharingMocks.fetchTeamServerPolicy.mockReset().mockResolvedValue(ok(serverPolicy()));
    sharingMocks.saveTeamServerPolicy.mockReset().mockResolvedValue(ok(serverPolicy()));
    sharingMocks.fetchTeamManagers.mockReset().mockResolvedValue(ok([]));
    sharingMocks.fetchScheduledTeamDeletions.mockReset().mockResolvedValue(ok([]));
    sharingMocks.setTeamMemberRole.mockReset().mockResolvedValue(ok(null));
  });

  it("keeps the single-scope settings when the server has no sharing calls", async () => {
    sharingMocks.fetchTeamServerPolicy.mockResolvedValue(fail("Could not find the function"));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));
    expect(hook.result.current.handleSetSharingPolicy).toBeUndefined();
    expect(hook.result.current.handleCreateTeamWithPolicy).toBeUndefined();
  });

  it("shows a team without a saved policy at the beta's sharing and saves hours without dropping the clock", async () => {
    sharingMocks.fetchTeamServerPolicy.mockResolvedValue(ok(serverPolicy({ schedule: { days: [1, 2, 3, 4, 5], start_minute: 540, end_minute: 1080, timezone: "Asia/Seoul", clock: "local" } })));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.handleSetSharingWindow).toBeDefined());
    expect(hook.result.current.selectedTeam?.sharing_policy).toEqual({ projects: "member_daily", tasks: "off", focus: "off", memberSummary: true });
    expect(hook.result.current.selectedTeam?.sharing_window?.timezone).toBe("Asia/Seoul");

    await act(async () => {
      await hook.result.current.handleSetSharingWindow!({ organization_id: "team-1", window: { days: [1, 2, 3, 4], start_minute: 600, end_minute: 1080, timezone: "Asia/Seoul" }, tracking_policy: "managed" });
    });
    expect(sharingMocks.saveTeamServerPolicy).toHaveBeenCalledWith({
      organization_id: "team-1",
      policy: { projects: "member_daily", tasks: "off", focus: "off", memberSummary: true },
      tracking_policy: "managed",
      schedule: { days: [1, 2, 3, 4], start_minute: 600, end_minute: 1080, timezone: "Asia/Seoul", clock: "local" },
    });
  });

  it("reports a refused save and keeps the team as the server has it", async () => {
    sharingMocks.saveTeamServerPolicy.mockResolvedValue(fail("A manager can only narrow this team's sharing."));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.handleSetSharingPolicy).toBeDefined());
    await act(async () => {
      await hook.result.current.handleSetSharingPolicy!({ organization_id: "team-1", policy: { projects: "hourly", tasks: "hourly", focus: "hourly", memberSummary: true } });
    });
    expect(hook.result.current.teamActionError).toBe("A manager can only narrow this team's sharing.");
    expect(hook.result.current.selectedTeam?.sharing_policy?.projects).toBe("member_daily");
  });

  it("takes a manager's seat from the server and never reads the manager list for them", async () => {
    sharingMocks.fetchTeamServerPolicy.mockResolvedValue(ok(serverPolicy({ seat: "manager", manager_access: "detail", manager_may_narrow: true })));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([makeTeam({ membership_role: "lead", role_label: "Member" })]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.viewerAssignment).toBeTruthy());
    expect(hook.result.current.viewerAssignment).toMatchObject({ group_ids: [], access: "detail", sharing: "narrow" });
    expect(sharingMocks.fetchTeamManagers).not.toHaveBeenCalled();
  });

  it("changes only the managers that changed", async () => {
    sharingMocks.fetchTeamManagers.mockResolvedValue(ok([
      { member_key: "key-mina", display_name: "Mina", manager_access: "detail", manager_may_narrow: false },
      { member_key: "key-jun", display_name: "Jun", manager_access: "totals", manager_may_narrow: false },
    ]));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.managers).toHaveLength(2));
    await act(async () => {
      await hook.result.current.handleSetManagers!({
        organization_id: "team-1",
        managers: [
          { member_key: "key-jun", display_name: "Jun", group_ids: [], access: "summary", sharing: "view" },
          { member_key: "key-aria", display_name: "Aria", group_ids: [], access: "summary", sharing: "narrow" },
        ],
      });
    });
    expect(sharingMocks.setTeamMemberRole.mock.calls.map(([call]) => call)).toEqual([
      { organization_id: "team-1", member_key: "key-mina", role: "member" },
      { organization_id: "team-1", member_key: "key-aria", role: "manager", manager_access: "totals", manager_may_narrow: true },
    ]);
  });

  it("makes the first team with its sharing when the server refuses a probe instead of lacking the call", async () => {
    sharingMocks.fetchTeamServerPolicy.mockImplementation(async (input: { organization_id: string }) => (
      input.organization_id === "team-1" ? ok(serverPolicy()) : { success: false, error: "You are not a member of this organization.", reason: "forbidden" }
    ));
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([]));
    teamServiceMocks.createTeam.mockResolvedValue(ok(privateTeam));
    const { hook } = renderController();
    await waitFor(() => expect(hook.result.current.handleCreateTeamWithPolicy).toBeDefined());

    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    let created = false;
    await act(async () => {
      created = await hook.result.current.handleCreateTeamWithPolicy!({
        organizationName: "Deep Work Crew",
        policy: { projects: "team", tasks: "off", focus: "off", memberSummary: false },
        window: { days: [1, 2, 3, 4, 5], start_minute: 540, end_minute: 1080, timezone: "Asia/Seoul" },
        trackingPolicy: "free",
      });
    });
    expect(created).toBe(true);
    expect(sharingMocks.saveTeamServerPolicy).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "team-1",
      policy: { projects: "team", tasks: "off", focus: "off", memberSummary: false },
      schedule: expect.objectContaining({ clock: "team", timezone: "Asia/Seoul" }),
    }));
  });
});
