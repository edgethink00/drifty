import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTeam,
  fetchOwnTeams,
  fetchTeamFocusSummary,
  fetchTeamInvites,
  fetchTeamLiveStatus,
  stopTeamFocusSharing,
  type TeamClient,
} from "./teamService";
import {
  createClient,
  expectLastRpcCall,
  expectNoForbiddenPayloadKeys,
  expectRecord,
  inviteId,
  organizationId,
} from "./teamServiceTestClient";

const clientState: { enabled: boolean; supabase: TeamClient | null } = {
  enabled: false,
  supabase: null,
};

vi.mock("../../lib/supabase/client", () => ({
  get supabase() {
    return clientState.supabase;
  },
  isSupabaseEnabled: () => clientState.enabled,
}));

beforeEach(() => {
  clientState.enabled = false;
  clientState.supabase = null;
  vi.clearAllMocks();
});

describe("teamService RPC mapping", () => {
  it("calls organization team RPCs and maps safe rows without app-user identifiers", async () => {
    // Given
    const client = createClient();
    client.setRpcResponse("get_own_organization_teams", {
      data: [{
        organization_id: organizationId,
        organization_name: "Deep Work Crew",
        member_display_name: "Alex",
        role_label: "Owner",
        focus_share_scope: "private",
        member_count: "3",
        focus_seconds: "7200",
        focus_score: "66.67",
        private_rank: "2",
        window_start_date: "2026-07-01",
        window_end_date: "2026-07-07",
        updated_at: "2026-07-07T09:00:00.000Z",
        app_user_id: "must-not-leak",
      }],
      error: null,
    });
    client.setRpcResponse("create_organization_team", {
      data: [{
        organization_id: organizationId,
        organization_name: "Deep Work Crew",
        member_display_name: "Alex",
        role_label: "Owner",
        focus_share_scope: "private",
        member_count: 1,
        updated_at: "2026-07-01T09:00:00.000Z",
      }],
      error: null,
    });
    client.setRpcResponse("get_organization_focus_summary", {
      data: [{
        organization_id: organizationId,
        organization_name: "Deep Work Crew",
        member_display_name: "Sam",
        role_label: "Member",
        focus_share_scope: "focus_only",
        focus_seconds: 5400,
        focus_score: 52.5,
        private_rank: 1,
        window_start_date: "2026-07-01",
        window_end_date: "2026-07-07",
        updated_at: "2026-07-07T10:00:00.000Z",
        app_user_id: "must-not-leak",
      }],
      error: null,
    });
    client.setRpcResponse("get_organization_live_status", {
      data: [{
        organization_id: organizationId,
        organization_name: "Deep Work Crew",
        member_display_name: "Sam",
        profile_avatar_url: "https://drifty.so/sam.png",
        role_label: "Member",
        focus_share_scope: "focus_only",
        presence_state: "recent",
        focus_seconds: 5400,
        focus_score: 52.5,
        window_start_date: "2026-07-01",
        window_end_date: "2026-07-07",
        last_shared_at: "2026-07-07T10:00:00.000Z",
        app_user_id: "must-not-leak",
      }],
      error: null,
    });
    client.setRpcResponse("get_organization_invites", {
      data: [{
        invite_id: inviteId,
        organization_id: organizationId,
        organization_name: "Deep Work Crew",
        invite_code: "DRFT-ABCD-2345",
        invite_url: "/team-invite?code=DRFT-ABCD-2345",
        role_label: "Member",
        status: "pending",
        expires_at: "2026-07-09T00:00:00.000Z",
        created_at: "2026-07-02T00:00:00.000Z",
        updated_at: "2026-07-02T00:00:00.000Z",
      }],
      error: null,
    });

    // When
    const teams = await fetchOwnTeams("monthly", client);
    const created = await createTeam({ organizationName: "  Deep Work Crew  ", roleLabel: "  Owner  " }, client);
    const summary = await fetchTeamFocusSummary({ organization_id: organizationId, period: "daily" }, client);
    const liveStatus = await fetchTeamLiveStatus({ organization_id: organizationId, period: "daily" }, client);
    const invites = await fetchTeamInvites({ organization_id: organizationId }, client);

    // Then
    expect(client.rpcCalls).toEqual([
      { procedure: "get_own_organization_teams", args: { period_name: "monthly" } },
      {
        procedure: "create_organization_team",
        args: { input_organization_name: "Deep Work Crew", input_role_label: "Owner" },
      },
      {
        procedure: "get_organization_focus_summary",
        args: { input_organization_id: organizationId, period_name: "daily" },
      },
      {
        procedure: "get_organization_live_status",
        args: { input_organization_id: organizationId, period_name: "daily" },
      },
      { procedure: "get_organization_invites", args: { input_organization_id: organizationId } },
    ]);
    expect(teams).toMatchObject({ success: true, data: [{ focus_seconds: 7200, private_rank: 2 }] });
    expect(created).toMatchObject({ success: true });
    expect(summary).toMatchObject({ success: true, data: [{ focus_share_scope: "focus_only" }] });
    expect(liveStatus).toMatchObject({ success: true, data: [{ presence_state: "recent", profile_avatar_url: "https://drifty.so/sam.png", last_shared_at: "2026-07-07T10:00:00.000Z" }] });
    expect(invites).toMatchObject({ success: true, data: [{ invite_id: inviteId, status: "pending" }] });
    expect(JSON.stringify(teams)).not.toContain("app_user_id");
    expect(JSON.stringify(summary)).not.toContain("app_user_id");
    expect(JSON.stringify(liveStatus)).not.toContain("app_user_id");
  });

  it("stops sharing through the all-period stop RPC without client-side deletion semantics", async () => {
    // Given
    const client = createClient();
    client.setRpcResponse("stop_organization_focus_sharing", {
      data: [{
        organization_id: organizationId,
        focus_share_scope: "private",
        deleted_focus_total_count: 3,
        updated_at: "2026-07-07T13:00:00.000Z",
      }],
      error: null,
    });

    // When
    const result = await stopTeamFocusSharing({ organization_id: organizationId }, client);

    // Then
    const call = expectLastRpcCall(client);
    expect(result).toMatchObject({ success: true, data: { deleted_focus_total_count: 3 } });
    expect(call).toEqual({
      procedure: "stop_organization_focus_sharing",
      args: { input_organization_id: organizationId },
    });
    expect(Object.keys(expectRecord(call.args))).toEqual(["input_organization_id"]);
    expect(call.args).not.toHaveProperty("organization_id");
    expect(call.args).not.toHaveProperty("period");
    expect(call.args).not.toHaveProperty("delete");
    expectNoForbiddenPayloadKeys(expectRecord(call.args));
  });
});
