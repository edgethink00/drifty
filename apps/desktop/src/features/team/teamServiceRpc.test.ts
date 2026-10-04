import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTeam,
  fetchOwnTeams,
  fetchTeamInvites,
  setTeamMemberInvites,
  type TeamClient,
} from "./teamService";
import {
  createClient,
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
        member_count: "3",
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
        member_count: 1,
        updated_at: "2026-07-01T09:00:00.000Z",
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
    const invites = await fetchTeamInvites({ organization_id: organizationId }, client);

    // Then
    expect(client.rpcCalls).toEqual([
      { procedure: "get_own_organization_teams", args: { period_name: "monthly" } },
      {
        procedure: "create_organization_team",
        args: { input_organization_name: "Deep Work Crew", input_role_label: "Owner" },
      },
      { procedure: "get_organization_invites", args: { input_organization_id: organizationId } },
    ]);
    expect(teams).toMatchObject({ success: true, data: [{ organization_id: organizationId, member_count: 3 }] });
    expect(created).toMatchObject({ success: true });
    expect(invites).toMatchObject({ success: true, data: [{ invite_id: inviteId, status: "pending" }] });
    expect(JSON.stringify(teams)).not.toContain("app_user_id");
  });

  it("reads the membership role and member invite setting, and stays owner-only on an older server", async () => {
    const client = createClient();
    client.setRpcResponse("get_own_organization_teams", {
      data: [
        {
          organization_id: organizationId,
          organization_name: "Deep Work Crew",
          member_display_name: "Alex",
          role_label: "Focus partner",
          member_count: 3,
          updated_at: "2026-07-07T09:00:00.000Z",
          membership_role: "member",
          members_can_invite: true,
        },
        // A server without the setting reports neither field.
        { organization_id: "org-old-owner", organization_name: "Old", member_display_name: "Alex", role_label: "Owner", member_count: 1, updated_at: "2026-07-01T09:00:00.000Z" },
        { organization_id: "org-old-member", organization_name: "Old", member_display_name: "Alex", role_label: "Member", member_count: 2, updated_at: "2026-07-01T09:00:00.000Z" },
      ],
      error: null,
    });

    const teams = await fetchOwnTeams("weekly", client);

    expect(teams).toMatchObject({
      success: true,
      data: [
        { membership_role: "member", members_can_invite: true },
        { membership_role: "owner", members_can_invite: null },
        { membership_role: "member", members_can_invite: null },
      ],
    });
  });

  it("changes the member invite setting through its owner-only RPC", async () => {
    const client = createClient();
    client.setRpcResponse("set_organization_member_invites", {
      data: [{ organization_id: organizationId, members_can_invite: false }],
      error: null,
    });

    const result = await setTeamMemberInvites({ organization_id: organizationId, enabled: false }, client);

    expect(client.rpcCalls).toEqual([
      { procedure: "set_organization_member_invites", args: { input_organization_id: organizationId, input_enabled: false } },
    ]);
    expect(result).toEqual({ success: true, error: null, data: { organization_id: organizationId, members_can_invite: false } });
  });
});
