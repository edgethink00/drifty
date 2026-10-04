import { loadShareCardRank, peekShareCardRank, setShareCardRankAccountScope } from "../share/shareCardRankCache";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { LeaderboardRow } from "./leaderboardService";

type AuthUser = {
  id: string;
  email?: string | null;
};

type UpsertPayload = {
  user_id: string | undefined;
  period?: string;
  display_name: string;
  focus_seconds?: number;
  focus_seconds_7d?: number;
  window_start_date?: string;
  window_end_date?: string;
  timezone: string;
  opted_in?: boolean;
  is_public?: boolean;
  updated_at: string;
};

type LeaderboardTableQuery = {
  upsert: Mock;
  select: Mock;
};

type MockLeaderboardClient = {
  auth: { getUser: Mock };
  from: Mock;
  rpc: Mock;
  __mocks: {
    upsert: Mock;
    select: Mock;
    eq: Mock;
    maybeSingle: Mock;
  };
};

const clientState: { enabled: boolean; supabase: MockLeaderboardClient | null } = {
  enabled: false,
  supabase: null,
};

vi.mock("../../lib/supabase/client", () => ({
  get supabase() {
    return clientState.supabase;
  },
  isSupabaseEnabled: () => clientState.enabled,
}));

import {
  fetchCommunityFocusPercentileModel,
  fetchOwnLeaderboardCheckpoint,
  fetchOwnLeaderboardEntry,
  fetchGlobalLeaderboard,
  optOutLeaderboard,
  publishOwnLeaderboardCheckpoint,
  publishOwnFocusTotal,
} from "./leaderboardService";

function createClient(): MockLeaderboardClient {
  const upsert = vi.fn();
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const query: LeaderboardTableQuery = { upsert, select };
  const from = vi.fn((table: string) => {
    if (table !== "leaderboard_focus_totals" && table !== "profiles") {
      throw new Error(`Unexpected table: ${table}`);
    }

    return query;
  });
  const rpc = vi.fn();
  const auth = {
    getUser: vi.fn(),
  };

  return {
    auth,
    from,
    rpc,
    __mocks: { upsert, select, eq, maybeSingle },
  };
}

beforeEach(() => {
  clientState.enabled = false;
  clientState.supabase = null;
  vi.clearAllMocks();
});

describe("leaderboardService", () => {
  it("rejects a share preparation request if auth has changed before the RPC", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "b" } }, error: null });
    expect((await fetchOwnLeaderboardEntry("daily", client, "a")).success).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("invalidates prepared share ranks after a successful opt-out but preserves them after failure", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "a" } }, error: null });
    setShareCardRankAccountScope("a");
    await loadShareCardRank("a", "day", "daily", async () => ({ success: true, error: null, data: null }));
    client.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    await optOutLeaderboard("daily", client);
    expect(peekShareCardRank("a", "day", "daily")).toBeDefined();
    client.rpc.mockResolvedValue({ data: [], error: null });
    await optOutLeaderboard("daily", client);
    expect(peekShareCardRank("a", "day", "daily")).toBeUndefined();
    setShareCardRankAccountScope(null);
  });

  it("returns disabled when Supabase is not configured", async () => {
    const result = await fetchGlobalLeaderboard();

    expect(result).toEqual({ success: false, error: "Supabase is not configured" });
  });

  it("rejects publish when the caller is signed out", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await publishOwnFocusTotal(
      {
        profileDisplayName: "Alex",
        focus_seconds_7d: 3600,
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
      },
      client,
    );

    expect(result).toEqual({ success: false, error: "Not authenticated" });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("trims the caller-provided profileDisplayName and publishes only aggregates", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "alex@example.com",
        } satisfies AuthUser,
      },
      error: null,
    });
    client.__mocks.upsert.mockResolvedValue({ error: null });

    const result = await publishOwnFocusTotal(
      {
        profileDisplayName: "  Alex Kim  ",
        focus_seconds_7d: 5400,
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
      },
      client,
    );

    expect(result).toEqual({ success: true, error: null });
    expect(client.__mocks.upsert).toHaveBeenCalledTimes(2);

    const [profilePayload, profileOptions] = client.__mocks.upsert.mock.calls[0] as [UpsertPayload, { onConflict: string }];
    expect(profileOptions).toEqual({ onConflict: "user_id" });
    // is_public is intentionally absent: publishing a score must not flip a private profile
    // back to public (existing rows keep their value; first insert uses the schema default).
    expect(profilePayload).toEqual({
      user_id: "user-1",
      display_name: "Alex Kim",
      timezone: "Asia/Seoul",
      updated_at: profilePayload.updated_at,
    });
    expect(profilePayload).not.toHaveProperty("is_public");

    const [payload, options] = client.__mocks.upsert.mock.calls[1] as [UpsertPayload, { onConflict: string }];
    expect(options).toEqual({ onConflict: "user_id,period" });
    expect(payload).toEqual({
      user_id: "user-1",
      period: "weekly",
      display_name: "Alex Kim",
      focus_seconds: 5400,
      focus_seconds_7d: 5400,
      window_start_date: "2026-04-01",
      window_end_date: "2026-04-07",
      timezone: "Asia/Seoul",
      opted_in: true,
      updated_at: payload.updated_at,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "display_name",
        "focus_seconds",
        "focus_seconds_7d",
        "opted_in",
        "period",
        "timezone",
        "updated_at",
        "user_id",
        "window_end_date",
        "window_start_date",
      ].sort(),
    );
    expect(payload).not.toHaveProperty("segments");
    expect(payload).not.toHaveProperty("app_name");
    expect(payload).not.toHaveProperty("site_domain");
    expect(payload).not.toHaveProperty("window_title");
  });

  it("falls back to the email handle when profileDisplayName is empty", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-2",
          email: "no-name@example.com",
        } satisfies AuthUser,
      },
      error: null,
    });
    client.__mocks.upsert.mockResolvedValue({ error: null });

    await publishOwnFocusTotal(
      {
        profileDisplayName: "   ",
        focus_seconds_7d: 1200,
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
      },
      client,
    );

    const [payload] = client.__mocks.upsert.mock.calls[1] as [UpsertPayload, { onConflict: string }];
    expect(payload.display_name).toBe("no-name");
  });

  it("uses a stable member alias instead of a shared brand name for email-less users", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          email: null,
        } satisfies AuthUser,
      },
      error: null,
    });
    client.__mocks.upsert.mockResolvedValue({ error: null });

    await publishOwnFocusTotal(
      {
        profileDisplayName: "",
        focus_seconds_7d: 1200,
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
      },
      client,
    );

    const [payload] = client.__mocks.upsert.mock.calls[1] as [UpsertPayload, { onConflict: string }];
    expect(payload.display_name).toBe("member-lqwovz");
  });

  it("can publish an aggregate without touching the public profile", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-2",
          email: "alex@example.com",
        } satisfies AuthUser,
      },
      error: null,
    });
    client.__mocks.upsert.mockResolvedValue({ error: null });

    const result = await publishOwnFocusTotal(
      {
        profileDisplayName: "Alex",
        period: "daily",
        focus_seconds_7d: 1200,
        window_start_date: "2026-04-07",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
      },
      client,
      { updateProfile: false },
    );

    expect(result).toEqual({ success: true, error: null });
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith("leaderboard_focus_totals");
    expect(client.__mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it("reads the current user's own leaderboard row truthfully", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-2",
          email: "no-name@example.com",
        } satisfies AuthUser,
      },
      error: null,
    });
    client.rpc.mockResolvedValue({
      data: [{
        rank: 3,
        participant_count: 120,
        display_name: "no-name",
        period: "weekly",
        focus_seconds: 1200,
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
        opted_in: true,
        updated_at: "2026-04-07T09:00:00.000Z",
      }],
      error: null,
    });

    const result = await fetchOwnLeaderboardEntry(client);

    expect(result).toEqual({
      success: true,
      error: null,
      data: {
        rank: 3,
        participant_count: 120,
        display_name: "no-name",
        period: "weekly",
        focus_seconds: 1200,
        focus_seconds_7d: 1200,
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
        opted_in: true,
        updated_at: "2026-04-07T09:00:00.000Z",
      },
    });
    expect(result.data).not.toHaveProperty("publicly_valid");
  });

  it("does not claim a failed validation when own-entry omits validation_version", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "no-name@example.com" } satisfies AuthUser },
      error: null,
    });
    client.rpc.mockResolvedValue({
      data: [{
        rank: 3,
        participant_count: 120,
        display_name: "no-name",
        period: "weekly",
        focus_seconds: 1200,
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
        opted_in: true,
        updated_at: "2026-04-07T09:00:00.000Z",
        validation_version: null,
      }],
      error: null,
    });

    const result = await fetchOwnLeaderboardEntry(client);
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("publicly_valid");
  });

  it("ignores unknown own-entry columns from a newer RPC", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "no-name@example.com" } satisfies AuthUser },
      error: null,
    });
    client.rpc.mockResolvedValue({
      data: [{
        rank: 3,
        participant_count: 120,
        display_name: "no-name",
        period: "weekly",
        focus_seconds: 1200,
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
        opted_in: true,
        updated_at: "2026-04-07T09:00:00.000Z",
        validation_version: 1,
        unexpected_column: "keep-going",
      }],
      error: null,
    });

    const result = await fetchOwnLeaderboardEntry(client);
    expect(result.success).toBe(true);
    expect(result.data?.publicly_valid).toBe(true);
    expect(result.data).not.toHaveProperty("unexpected_column");
  });

  it("exposes public validity from own-entry validation_version", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "no-name@example.com" } satisfies AuthUser },
      error: null,
    });
    const row = {
      rank: 3,
      participant_count: 120,
      display_name: "no-name",
      period: "weekly",
      focus_seconds: 1200,
      window_start_date: "2026-04-01",
      window_end_date: "2026-04-07",
      timezone: "Asia/Seoul",
      opted_in: true,
      updated_at: "2026-04-07T09:00:00.000Z",
    };
    client.rpc.mockResolvedValueOnce({
      data: [{ ...row, validation_version: 0 }],
      error: null,
    });
    const invalid = await fetchOwnLeaderboardEntry(client);
    expect(invalid.data?.publicly_valid).toBe(false);

    client.rpc.mockResolvedValueOnce({
      data: [{ ...row, validation_version: 1 }],
      error: null,
    });
    const valid = await fetchOwnLeaderboardEntry(client);
    expect(valid.data?.publicly_valid).toBe(true);
  });

  it("returns null when the current user has never joined the leaderboard", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "no-name@example.com" } satisfies AuthUser },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: [], error: null });

    const result = await fetchOwnLeaderboardEntry(client);

    expect(client.rpc).toHaveBeenCalledWith("get_own_leaderboard_entry", { period_name: "weekly" });
    expect(result).toEqual({ success: true, error: null, data: null });
  });

  it("reads a real-account-only exact-window checkpoint", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "alex@example.com" } satisfies AuthUser },
      error: null,
    });
    client.rpc.mockResolvedValue({
      data: [{
        rank: 2,
        participant_count: 14,
        display_name: "Alex",
        period: "daily",
        focus_seconds: 12_600,
        window_start_date: "2026-08-17",
        window_end_date: "2026-08-17",
        timezone: "Asia/Seoul",
        opted_in: true,
        updated_at: "2026-08-17T11:00:00.000Z",
      }],
      error: null,
    });

    const result = await fetchOwnLeaderboardCheckpoint("daily", "2026-08-17", client);

    expect(client.rpc).toHaveBeenCalledWith("get_own_leaderboard_checkpoint", {
      period_name: "daily",
      window_end_day: "2026-08-17",
    });
    expect(result).toEqual({
      success: true,
      error: null,
      data: {
        rank: 2,
        participant_count: 14,
        display_name: "Alex",
        period: "daily",
        focus_seconds: 12_600,
        focus_seconds_7d: 12_600,
        window_start_date: "2026-08-17",
        window_end_date: "2026-08-17",
        timezone: "Asia/Seoul",
        opted_in: true,
        updated_at: "2026-08-17T11:00:00.000Z",
      },
    });
  });

  it("publishes an exact aggregate checkpoint through the owner RPC", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "alex@example.com" } satisfies AuthUser },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: [{ published: true }], error: null });

    const result = await publishOwnLeaderboardCheckpoint({
      period: "weekly",
      focusSeconds: 12_600.4,
      windowStartDay: "2026-08-10",
      windowEndDay: "2026-08-16",
      timezone: "Asia/Seoul",
    }, client);

    expect(client.rpc).toHaveBeenCalledWith("publish_own_leaderboard_checkpoint", {
      period_name: "weekly",
      checkpoint_focus_seconds: 12_600,
      window_start_day: "2026-08-10",
      window_end_day: "2026-08-16",
      timezone_name: "Asia/Seoul",
    });
    expect(result).toEqual({ success: true, error: null, data: true });
  });

  it("opts out by zeroing the aggregate and clearing opted_in", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-3",
          email: "alex@example.com",
        } satisfies AuthUser,
      },
      error: null,
    });
    client.rpc.mockResolvedValue({
      data: [{
        display_name: "Alex Kim",
        period: "weekly",
        window_start_date: "2026-04-01",
        window_end_date: "2026-04-07",
        timezone: "Asia/Seoul",
      }],
      error: null,
    });
    client.__mocks.upsert.mockResolvedValue({ error: null });

    const result = await optOutLeaderboard(client);

    expect(result).toEqual({ success: true, error: null });
    const [payload, options] = client.__mocks.upsert.mock.calls[0] as [UpsertPayload, { onConflict: string }];
    expect(options).toEqual({ onConflict: "user_id,period" });
    expect(payload).toEqual({
      user_id: "user-3",
      period: "weekly",
      display_name: "Alex Kim",
      focus_seconds: 0,
      focus_seconds_7d: 0,
      window_start_date: "2026-04-01",
      window_end_date: "2026-04-07",
      timezone: "Asia/Seoul",
      opted_in: false,
      updated_at: payload.updated_at,
    });
  });

  it("treats opt-out as complete when a period row is already absent", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-3",
          email: "alex@example.com",
        } satisfies AuthUser,
      },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: [], error: null });

    const result = await optOutLeaderboard("daily", client);

    expect(client.rpc).toHaveBeenCalledWith("get_own_leaderboard_entry", { period_name: "daily" });
    expect(client.__mocks.upsert).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, error: null });
  });

  it("maps the leaderboard RPC into public-safe rows", async () => {
    const client = createClient();
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "user-4" } }, error: null });
    client.rpc.mockResolvedValue({
      data: [
        {
          rank: 1,
          participant_count: 2_858,
          public_id: "profile-1",
          display_name: "Alex",
          avatar_url: "https://cdn.example.com/alex.png",
          period: "weekly",
          focus_seconds: 7200,
          window_start_date: "2026-04-01",
          window_end_date: "2026-04-07",
          updated_at: "2026-04-07T12:00:00.000Z",
          user_id: "hidden",
        },
      ],
      error: null,
    });

    const result = await fetchGlobalLeaderboard(25, client);

    expect(client.rpc).toHaveBeenCalledWith("get_global_focus_leaderboard", { period_name: "weekly", limit_count: 25 });
    expect(result).toEqual({
      success: true,
      error: null,
      data: [
        {
          rank: 1,
          participant_count: 2_858,
          public_id: "profile-1",
          display_name: "Alex",
          avatar_url: "https://cdn.example.com/alex.png",
          period: "weekly",
          focus_seconds: 7200,
          focus_seconds_7d: 7200,
          window_start_date: "2026-04-01",
          window_end_date: "2026-04-07",
          updated_at: "2026-04-07T12:00:00.000Z",
        },
      ] satisfies LeaderboardRow[],
    });
    expect(result.data?.[0]).not.toHaveProperty("user_id");
  });

  it("reads aggregate-only real-account percentile parameters anonymously", async () => {
    const client = createClient();
    client.rpc.mockResolvedValue({
      data: [{
        period: "daily",
        sample_size: "150",
        participant_count: "150",
        log_mean_minutes: "5.19",
        log_standard_deviation_minutes: "0.61",
        generated_at: "2026-08-28T12:00:00.000Z",
        user_id: "must-not-survive",
      }],
      error: null,
    });

    const result = await fetchCommunityFocusPercentileModel("daily", client);

    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith("get_community_focus_percentile_model", {
      period_name: "daily",
    });
    expect(result).toEqual({
      success: true,
      error: null,
      data: {
        period: "daily",
        sample_size: 150,
        participant_count: 150,
        log_mean_minutes: 5.19,
        log_standard_deviation_minutes: 0.61,
        generated_at: "2026-08-28T12:00:00.000Z",
      },
    });
    expect(result.data).not.toHaveProperty("user_id");
  });

  it("turns a missing schema-cache RPC error into an actionable setup message", async () => {
    const client = createClient();
    client.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_global_focus_leaderboard(limit_count) in the schema cache",
      },
    });

    const result = await fetchGlobalLeaderboard(25, client);

    expect(result).toEqual({
      success: false,
      error: "Leaderboard RPC is missing in Supabase. Re-run apps/desktop/supabase/schema.sql in your Supabase SQL Editor, then refresh the app.",
    });
  });
});
