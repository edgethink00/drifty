import { beforeEach, describe, expect, it, vi } from "vitest";

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
  upsert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

type MockLeaderboardClient = {
  auth: { getUser: ReturnType<typeof vi.fn> };
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  __mocks: {
    upsert: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
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
  fetchOwnLeaderboardEntry,
  fetchGlobalLeaderboard,
  optOutLeaderboard,
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
    expect(profilePayload).toEqual({
      user_id: "user-1",
      display_name: "Alex Kim",
      timezone: "Asia/Seoul",
      is_public: true,
      updated_at: profilePayload.updated_at,
    });

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
