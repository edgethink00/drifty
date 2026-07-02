// @vitest-environment jsdom

import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, makeActivity, makeTeam, ok, ownSummaryRow, pendingInvite, privateTeam, renderController, sharedTeam, teammateSummaryRow } from "./useTeamControllerTestFixtures";

const teamServiceMocks = vi.hoisted(() => ({
  fetchOwnTeams: vi.fn(),
  fetchTeamFocusSummary: vi.fn(),
  fetchTeamInvites: vi.fn(),
  createTeam: vi.fn(),
  acceptTeamInvite: vi.fn(),
  createTeamInvite: vi.fn(),
  revokeTeamInvite: vi.fn(),
  publishTeamFocusTotal: vi.fn(),
  stopTeamFocusSharing: vi.fn(),
}));

const trackerMocks = vi.hoisted(() => ({
  getTimeline: vi.fn(),
}));

vi.mock("./teamService", () => ({
  DEFAULT_TEAM_PERIOD: "weekly",
  TEAM_PERIODS: ["daily", "weekly", "monthly"],
  fetchOwnTeams: teamServiceMocks.fetchOwnTeams,
  fetchTeamFocusSummary: teamServiceMocks.fetchTeamFocusSummary,
  fetchTeamInvites: teamServiceMocks.fetchTeamInvites,
  createTeam: teamServiceMocks.createTeam,
  acceptTeamInvite: teamServiceMocks.acceptTeamInvite,
  createTeamInvite: teamServiceMocks.createTeamInvite,
  revokeTeamInvite: teamServiceMocks.revokeTeamInvite,
  publishTeamFocusTotal: teamServiceMocks.publishTeamFocusTotal,
  stopTeamFocusSharing: teamServiceMocks.stopTeamFocusSharing,
}));

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: {
    getTimeline: trackerMocks.getTimeline,
  },
}));

describe("useTeamController", () => {
  beforeEach(() => {
    teamServiceMocks.fetchOwnTeams.mockReset();
    teamServiceMocks.fetchTeamFocusSummary.mockReset();
    teamServiceMocks.fetchTeamInvites.mockReset();
    teamServiceMocks.createTeam.mockReset();
    teamServiceMocks.acceptTeamInvite.mockReset();
    teamServiceMocks.createTeamInvite.mockReset();
    teamServiceMocks.revokeTeamInvite.mockReset();
    teamServiceMocks.publishTeamFocusTotal.mockReset();
    teamServiceMocks.stopTeamFocusSharing.mockReset();
    trackerMocks.getTimeline.mockReset();
    teamServiceMocks.fetchTeamInvites.mockResolvedValue(ok([]));
  });

  it("Given a non-team tab When the hook renders Then it does not call team services until the team tab is active", async () => {
    // Given
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamFocusSummary.mockResolvedValue(ok([]));

    // When
    const { hook, initialProps } = renderController({ activeTab: "dashboard" });

    // Then
    expect(teamServiceMocks.fetchOwnTeams).not.toHaveBeenCalled();
    expect(teamServiceMocks.fetchTeamFocusSummary).not.toHaveBeenCalled();

    // When
    hook.rerender({
      ...initialProps,
      activeTab: "team",
    });

    // Then
    await waitFor(() => expect(hook.result.current.teams).toEqual([privateTeam]));
    expect(teamServiceMocks.fetchOwnTeams).toHaveBeenCalledWith("weekly");
    expect(teamServiceMocks.fetchTeamFocusSummary).toHaveBeenCalledWith({
      organization_id: "team-1",
      period: "weekly",
    });
    await waitFor(() => expect(teamServiceMocks.fetchTeamInvites).toHaveBeenCalledWith({ organization_id: "team-1" }));
  });

  it("Given a non-team tab When refresh runs directly Then it does not call team services", async () => {
    // Given
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamFocusSummary.mockResolvedValue(ok([]));
    const { hook } = renderController({ activeTab: "dashboard" });

    // When
    await act(async () => {
      await hook.result.current.refreshTeamData();
    });

    // Then
    expect(teamServiceMocks.fetchOwnTeams).not.toHaveBeenCalled();
    expect(teamServiceMocks.fetchTeamFocusSummary).not.toHaveBeenCalled();
    expect(teamServiceMocks.fetchTeamInvites).not.toHaveBeenCalled();
  });

  it("Given loaded team rows When invite actions run Then it calls team services and refreshes invite state", async () => {
    // Given
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamFocusSummary.mockResolvedValue(ok([teammateSummaryRow]));
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
    teamServiceMocks.fetchTeamFocusSummary.mockResolvedValue(ok([]));
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
    teamServiceMocks.fetchTeamFocusSummary.mockResolvedValueOnce(ok([teammateSummaryRow]));

    // When
    const { hook } = renderController();

    // Then
    await waitFor(() => expect(hook.result.current.rows).toEqual([teammateSummaryRow]));

    // When
    await act(async () => {
      await hook.result.current.refreshTeamData();
    });

    // Then
    expect(hook.result.current.teams).toEqual([privateTeam]);
    expect(hook.result.current.rows).toEqual([teammateSummaryRow]);
    expect(hook.result.current.teamError).toBeNull();
    expect(hook.result.current.teamStatusMessage).toBe("Network unavailable");
    expect(hook.result.current.teamStatusTone).toBe("error");
  });

  it("Given a private selected team When the page loads Then publish is not called until the explicit share action", async () => {
    // Given
    const localActivity = [
      makeActivity({
        id: "focus",
        startedAt: "2026-07-01T10:00:00",
        endedAt: "2026-07-01T11:00:00",
        durationSeconds: 60 * 60,
      }),
      makeActivity({
        id: "neutral",
        startedAt: "2026-07-01T11:00:00",
        endedAt: "2026-07-01T11:30:00",
        durationSeconds: 30 * 60,
        classification: {
          category: "utility",
          productivity: "neutral",
          source: "manual",
          confidence: 1,
        },
      }),
    ];
    teamServiceMocks.fetchOwnTeams.mockResolvedValue(ok([privateTeam]));
    teamServiceMocks.fetchTeamFocusSummary.mockResolvedValue(ok([]));
    trackerMocks.getTimeline.mockResolvedValue(localActivity);
    teamServiceMocks.publishTeamFocusTotal.mockResolvedValue(ok({
      organization_id: "team-1",
      period: "weekly",
      focus_share_scope: "focus_only",
      focus_seconds: 3600,
      focus_score: 66.67,
      window_start_date: "2026-06-26",
      window_end_date: "2026-07-02",
      updated_at: "2026-07-02T12:00:00.000Z",
    }));

    // When
    const { hook } = renderController();

    // Then
    await waitFor(() => expect(hook.result.current.selectedTeam?.organization_id).toBe("team-1"));
    expect(teamServiceMocks.publishTeamFocusTotal).not.toHaveBeenCalled();
    expect(trackerMocks.getTimeline).not.toHaveBeenCalled();

    // When
    await act(async () => {
      await hook.result.current.handlePublishTeamFocus();
    });

    // Then
    expect(trackerMocks.getTimeline).toHaveBeenCalledWith({
      start: "2026-06-26T04:00:00",
      end: "2026-07-03T03:59:59",
    });
    expect(teamServiceMocks.publishTeamFocusTotal).toHaveBeenCalledWith({
      organization_id: "team-1",
      period: "weekly",
      display_name: "Alex",
      role_label: "Owner",
      focus_seconds: 3600,
      focus_score: 66.67,
      window_start_date: "2026-06-26",
      window_end_date: "2026-07-02",
      timezone: "Asia/Seoul",
    });
  });

  it("Given shared local state When stop sharing succeeds Then it calls the stop RPC and refreshes summary without the current user row", async () => {
    // Given
    teamServiceMocks.fetchOwnTeams.mockResolvedValueOnce(ok([sharedTeam])).mockResolvedValueOnce(ok([privateTeam]));
    teamServiceMocks.fetchTeamFocusSummary.mockResolvedValueOnce(ok([ownSummaryRow, teammateSummaryRow])).mockResolvedValueOnce(ok([teammateSummaryRow]));
    teamServiceMocks.stopTeamFocusSharing.mockResolvedValue(ok({
      organization_id: "team-1",
      focus_share_scope: "private",
      deleted_focus_total_count: 3,
      updated_at: "2026-07-02T12:00:00.000Z",
    }));

    // When
    const { hook } = renderController();

    // Then
    await waitFor(() => expect(hook.result.current.rows).toEqual([ownSummaryRow, teammateSummaryRow]));

    // When
    await act(async () => {
      await hook.result.current.handleStopTeamFocusSharing();
    });

    // Then
    expect(teamServiceMocks.stopTeamFocusSharing).toHaveBeenCalledWith({ organization_id: "team-1" });
    await waitFor(() => expect(hook.result.current.rows).toEqual([teammateSummaryRow]));
    expect(hook.result.current.selectedTeam?.focus_share_scope).toBe("private");
    expect(hook.result.current.selectedTeam?.focus_seconds).toBe(0);
  });

  it("Given disabled or insufficient account states When load and actions run Then team services are not called", async () => {
    // Given
    const disabled = renderController({ isSupabaseConfigured: false });
    const signedOut = renderController({ user: null });
    const fullAccountRequired = renderController({ hasRequiredAccountAuth: false });

    // When
    await act(async () => {
      await disabled.hook.result.current.handlePublishTeamFocus();
      await signedOut.hook.result.current.handlePublishTeamFocus();
      await fullAccountRequired.hook.result.current.handleStopTeamFocusSharing();
    });

    // Then
    expect(teamServiceMocks.fetchOwnTeams).not.toHaveBeenCalled();
    expect(teamServiceMocks.fetchTeamFocusSummary).not.toHaveBeenCalled();
    expect(teamServiceMocks.fetchTeamInvites).not.toHaveBeenCalled();
    expect(teamServiceMocks.createTeam).not.toHaveBeenCalled();
    expect(teamServiceMocks.acceptTeamInvite).not.toHaveBeenCalled();
    expect(teamServiceMocks.createTeamInvite).not.toHaveBeenCalled();
    expect(teamServiceMocks.revokeTeamInvite).not.toHaveBeenCalled();
    expect(teamServiceMocks.publishTeamFocusTotal).not.toHaveBeenCalled();
    expect(teamServiceMocks.stopTeamFocusSharing).not.toHaveBeenCalled();
    expect(trackerMocks.getTimeline).not.toHaveBeenCalled();
    expect(signedOut.onAuthRequired).toHaveBeenCalledTimes(1);
    expect(fullAccountRequired.onAuthRequired).toHaveBeenCalledTimes(1);
  });
});
