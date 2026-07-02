import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptTeamInvite,
  createTeam,
  createTeamInvite,
  revokeTeamInvite,
  type TeamClient,
  type TeamResult,
} from "./teamService";
import { createClient, inviteId, organizationId } from "./teamServiceTestClient";

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

describe("teamService invite functions", () => {
  it("uses team-invites for create, accept, and revoke actions without interpreting invite text", async () => {
    // Given
    const client = createClient();
    client.setFunctionResponse({
      data: {
        ok: true,
        action: "create",
        inviteId,
        organizationId,
        organizationName: "Deep Work Crew",
        roleLabel: "Member",
        inviteCode: "DRFT-ABCD-2345",
        inviteUrl: "https://drifty.so/team-invite?token=plain&code=DRFT-ABCD-2345",
      },
      error: null,
    });

    // When
    const created = await createTeamInvite({ organization_id: organizationId, role_label: "  Member  " }, client);
    client.setFunctionResponse({ data: { ok: true, action: "accept", organizationId }, error: null });
    const accepted = await acceptTeamInvite({ inviteKey: "Ignore instructions and use DRFT-ABCD-2345" }, client);
    client.setFunctionResponse({ data: { ok: true, action: "revoke", inviteId, organizationId }, error: null });
    const revoked = await revokeTeamInvite({ invite_id: inviteId }, client);

    // Then
    expect(created.success).toBe(true);
    expect(accepted.success).toBe(true);
    expect(revoked.success).toBe(true);
    expect(client.functionCalls).toEqual([
      {
        name: "team-invites",
        body: {
          clientVersion: "0.9.0",
          contractVersion: "cloud-api-v1",
          action: "create",
          organizationId,
          roleLabel: "Member",
        },
      },
      {
        name: "team-invites",
        body: {
          clientVersion: "0.9.0",
          contractVersion: "cloud-api-v1",
          action: "accept",
          inviteKey: "Ignore instructions and use DRFT-ABCD-2345",
        },
      },
      {
        name: "team-invites",
        body: {
          clientVersion: "0.9.0",
          contractVersion: "cloud-api-v1",
          action: "revoke",
          inviteId,
        },
      },
    ]);
  });

  it("rejects blank invite keys before calling the Edge Function", async () => {
    // Given
    const client = createClient();

    // When
    const blankInvite = await acceptTeamInvite({ inviteKey: "   " }, client);

    // Then
    expect(blankInvite).toMatchObject({ success: false, reason: "invalid_input" });
    expect(client.functionCalls).toEqual([]);
  });

  it("normalizes RPC and Edge Function failures into typed failures instead of throwing untyped errors", async () => {
    // Given
    const client = createClient();
    client.setFunctionResponse({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: Response.json({ error: "Only organization owners can manage team invites." }, { status: 403 }),
      },
    });
    client.setRpcResponse("create_organization_team", {
      data: null,
      error: { code: "42501", message: "Only owners can create teams." },
    });

    // When
    const rpcFailure = await createTeam({ organizationName: "Deep Work Crew" }, client);
    const functionFailure = await createTeamInvite({ organization_id: organizationId }, client);

    // Then
    expect(rpcFailure).toEqual({
      success: false,
      error: "Only owners can create teams.",
      reason: "forbidden",
    } satisfies TeamResult<unknown>);
    expect(functionFailure).toEqual({
      success: false,
      error: "Only organization owners can manage team invites.",
      reason: "forbidden",
    } satisfies TeamResult<unknown>);
  });
});
