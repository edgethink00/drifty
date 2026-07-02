import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TEAM_PERIOD,
  TEAM_PERIODS,
  createTeam,
  createTeamInvite,
  fetchOwnTeams,
  fetchTeamFocusSummary,
  fetchTeamInvites,
  publishTeamFocusTotal,
  stopTeamFocusSharing,
  type TeamClient,
  type TeamResult,
} from "./teamService";
import {
  createClient,
  expectLastRpcCall,
  expectNoForbiddenPayloadKeys,
  expectRecord,
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

describe("teamService contract and inputs", () => {
  it("exports the stable period contract and typed disabled failure", async () => {
    // Given
    clientState.enabled = false;
    clientState.supabase = null;

    // When
    const result = await fetchOwnTeams();

    // Then
    expect(TEAM_PERIODS).toEqual(["daily", "weekly", "monthly"]);
    expect(DEFAULT_TEAM_PERIOD).toBe("weekly");
    expect(result).toEqual({
      success: false,
      error: "Supabase is not configured",
      reason: "supabase_disabled",
    } satisfies TeamResult<unknown>);
  });

  it("rejects signed-out and anonymous users before RPC or function calls", async () => {
    // Given
    const signedOutClient = createClient();
    signedOutClient.setUser(null);
    const anonymousClient = createClient();
    anonymousClient.setUser({ id: "anonymous-user", is_anonymous: true });

    // When
    const signedOut = await createTeam({ organizationName: "Deep Work Crew" }, signedOutClient);
    const anonymous = await createTeamInvite({ organization_id: organizationId }, anonymousClient);

    // Then
    expect(signedOut).toEqual({
      success: false,
      error: "Not authenticated",
      reason: "not_authenticated",
    } satisfies TeamResult<unknown>);
    expect(anonymous).toEqual({
      success: false,
      error: "Use a full account for Teams.",
      reason: "full_account_required",
    } satisfies TeamResult<unknown>);
    expect(signedOutClient.rpcCalls).toEqual([]);
    expect(anonymousClient.functionCalls).toEqual([]);
  });

  it("publishes aggregate focus through the organization RPC with the exact privacy payload", async () => {
    // Given
    const client = createClient();
    client.setRpcResponse("publish_organization_focus_total", {
      data: [{
        organization_id: organizationId,
        period: "weekly",
        focus_share_scope: "focus_only",
        focus_seconds: 8100,
        focus_score: 75.25,
        window_start_date: "2026-07-01",
        window_end_date: "2026-07-07",
        updated_at: "2026-07-07T12:00:00.000Z",
      }],
      error: null,
    });

    // When
    const result = await publishTeamFocusTotal({
      organization_id: organizationId,
      period: "weekly",
      display_name: "Alex",
      role_label: "Focus partner",
      focus_seconds: 8100,
      focus_score: 75.25,
      window_start_date: "2026-07-01",
      window_end_date: "2026-07-07",
      timezone: "Asia/Seoul",
    }, client);

    // Then
    const call = expectLastRpcCall(client);
    expect(result).toMatchObject({ success: true });
    expect(call.procedure).toBe("publish_organization_focus_total");
    expect(call.args).toEqual({
      input_organization_id: organizationId,
      period_name: "weekly",
      input_display_name: "Alex",
      input_role_label: "Focus partner",
      input_focus_seconds: 8100,
      input_focus_score: 75.25,
      input_window_start_date: "2026-07-01",
      input_window_end_date: "2026-07-07",
      input_timezone: "Asia/Seoul",
    });
    expect(Object.keys(expectRecord(call.args)).sort()).toEqual([
      "input_display_name",
      "input_focus_score",
      "input_focus_seconds",
      "input_organization_id",
      "input_role_label",
      "input_timezone",
      "input_window_end_date",
      "input_window_start_date",
      "period_name",
    ].sort());
    expect(call.args).not.toHaveProperty("organization_id");
    expect(call.args).not.toHaveProperty("period");
    expect(call.args).not.toHaveProperty("display_name");
    expectNoForbiddenPayloadKeys(expectRecord(call.args));
  });

  it("rejects malformed publish inputs and blank organization ids before remote calls", async () => {
    // Given
    const client = createClient();
    const validPublishInput = {
      organization_id: organizationId,
      period: "weekly",
      display_name: "Alex",
      role_label: "Member",
      focus_seconds: 1200,
      focus_score: 60,
      window_start_date: "2026-07-01",
      window_end_date: "2026-07-07",
      timezone: "Asia/Seoul",
    } as const;

    // When
    const invalidPeriod = await publishTeamFocusTotal({ ...validPublishInput, period: "quarterly" }, client);
    const negativeFocus = await publishTeamFocusTotal({
      ...validPublishInput,
      focus_seconds: -1,
      focus_score: Number.NaN,
    }, client);
    const blankSummary = await fetchTeamFocusSummary({ organization_id: "   ", period: "weekly" }, client);
    const blankPublish = await publishTeamFocusTotal({ ...validPublishInput, organization_id: "   " }, client);
    const blankStop = await stopTeamFocusSharing({ organization_id: "   " }, client);
    const blankInvites = await fetchTeamInvites({ organization_id: "   " }, client);
    const blankCreateInvite = await createTeamInvite({ organization_id: "   " }, client);

    // Then
    for (const result of [invalidPeriod, negativeFocus, blankSummary, blankPublish, blankStop, blankInvites, blankCreateInvite]) {
      expect(result).toMatchObject({ success: false, reason: "invalid_input" });
    }
    expect(client.rpcCalls).toEqual([]);
    expect(client.functionCalls).toEqual([]);
  });
});
