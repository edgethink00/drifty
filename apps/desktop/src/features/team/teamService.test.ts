import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TEAM_PERIOD,
  TEAM_PERIODS,
  createTeam,
  createTeamInvite,
  fetchOwnTeams,
  fetchTeamInvites,
  type TeamClient,
  type TeamResult,
} from "./teamService";
import {
  createClient,
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

  it("rejects blank organization ids before remote calls", async () => {
    // Given
    const client = createClient();

    // When
    const blankInvites = await fetchTeamInvites({ organization_id: "   " }, client);
    const blankCreateInvite = await createTeamInvite({ organization_id: "   " }, client);

    // Then
    for (const result of [blankInvites, blankCreateInvite]) {
      expect(result).toMatchObject({ success: false, reason: "invalid_input" });
    }
    expect(client.rpcCalls).toEqual([]);
    expect(client.functionCalls).toEqual([]);
  });
});
