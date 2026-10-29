import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptTeamInvite,
  cancelTeamEmailInvite,
  createTeam,
  createTeamInvite,
  fetchOwnEmailInvites,
  fetchTeamEmailInvites,
  revokeTeamInvite,
  sendTeamEmailInvites,
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
        context: Response.json({ error: "You do not have permission to manage invites for this team." }, { status: 403 }),
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
      error: "You do not have permission to manage invites for this team.",
      reason: "forbidden",
    } satisfies TeamResult<unknown>);
  });

  it("sends email invites as lower-cased, de-duplicated addresses and reads each address's outcome (2026-10-29)", async () => {
    const client = createClient();
    client.setFunctionResponse({
      data: { ok: true, action: "send", organizationId, results: [
        { email: "hana@company.com", outcome: "sent", inviteId },
        { email: "alex@company.com", outcome: "member" },
        { email: "jun@company.com", outcome: "something-new" },
      ] },
      error: null,
    });

    const sent = await sendTeamEmailInvites({ organization_id: organizationId, emails: [" Hana@Company.com ", "hana@company.com", "alex@company.com", "jun@company.com"], locale: "ko" }, client);
    const tooMany = await sendTeamEmailInvites({ organization_id: organizationId, emails: Array.from({ length: 21 }, (_, index) => "p" + index + "@company.com"), locale: "en" }, client);

    expect(client.functionCalls).toEqual([{
      name: "team-invites",
      body: { clientVersion: "0.9.0", contractVersion: "cloud-api-v1", action: "send", organizationId, emails: ["hana@company.com", "alex@company.com", "jun@company.com"], locale: "ko" },
    }]);
    expect(sent).toEqual({ success: true, error: null, data: [
      { email: "hana@company.com", outcome: "sent" },
      { email: "alex@company.com", outcome: "member" },
      { email: "jun@company.com", outcome: "failed" },
    ] });
    expect(tooMany).toMatchObject({ success: false, reason: "invalid_input" });
  });

  it("lists, cancels and finds one's own email invites, and names a server without them unsupported (2026-10-29)", async () => {
    const client = createClient();
    client.setRpcResponse("get_organization_email_invites", {
      data: [{ invite_id: inviteId, invited_email: "hana@company.com", status: "pending", expires_at: "2026-11-05T00:00:00Z", last_sent_at: null, send_count: "2", created_at: "2026-10-29T00:00:00Z", sent_by_me: true, token_hash: "must-not-leak" }],
      error: null,
    });
    client.setRpcResponse("cancel_organization_email_invite", { data: [{ invite_id: inviteId, organization_id: organizationId, status: "revoked" }], error: null });
    client.setRpcResponse("get_own_pending_email_invites", {
      data: [{ invite_id: inviteId, organization_id: organizationId, organization_name: "Deep Work Crew", invite_code: "DRFT-ABCD-2345", invited_email: "hana@company.com", expires_at: "2026-11-05T00:00:00Z" }],
      error: null,
    });

    const listed = await fetchTeamEmailInvites({ organization_id: organizationId }, client);
    const cancelled = await cancelTeamEmailInvite({ invite_id: inviteId }, client);
    const own = await fetchOwnEmailInvites(client);

    expect(listed).toEqual({ success: true, error: null, data: [{ invite_id: inviteId, invited_email: "hana@company.com", status: "pending", expires_at: "2026-11-05T00:00:00Z", last_sent_at: null, send_count: 2, created_at: "2026-10-29T00:00:00Z", sent_by_me: true }] });
    expect(cancelled).toEqual({ success: true, error: null, data: null });
    expect(own.success && own.data[0]?.invite_code).toBe("DRFT-ABCD-2345");
    expect(client.rpcCalls.map((call) => [call.procedure, call.args])).toEqual([
      ["get_organization_email_invites", { input_organization_id: organizationId }],
      ["cancel_organization_email_invite", { input_invite_id: inviteId }],
      ["get_own_pending_email_invites", {}],
    ]);

    client.setRpcResponse("get_organization_email_invites", { data: null, error: { code: "PGRST202", message: "Could not find the function public.get_organization_email_invites" } });
    expect(await fetchTeamEmailInvites({ organization_id: organizationId }, client)).toMatchObject({ success: false, reason: "unsupported" });
  });
});
