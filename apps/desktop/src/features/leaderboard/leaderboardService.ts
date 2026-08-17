import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { localDateKey } from "../../lib/formatting";
import { fallbackDisplayName } from "../profile/profileService";

export const LEADERBOARD_PERIODS = ["daily", "weekly", "monthly"] as const;
export type LeaderboardPeriod = typeof LEADERBOARD_PERIODS[number];
export const DEFAULT_LEADERBOARD_PERIOD: LeaderboardPeriod = "weekly";

export interface LeaderboardRow {
  rank: number;
  /** Number of fresh, opted-in participants in this leaderboard window. */
  participant_count?: number | null;
  public_id: string | null;
  display_name: string;
  avatar_url: string;
  period: LeaderboardPeriod;
  focus_seconds: number;
  focus_seconds_7d: number;
  window_start_date: string;
  window_end_date: string;
  updated_at: string;
}

export interface OwnLeaderboardEntry {
  rank: number | null;
  /** Number of fresh, opted-in participants in this leaderboard window. */
  participant_count?: number | null;
  display_name: string;
  period: LeaderboardPeriod;
  focus_seconds: number;
  focus_seconds_7d: number;
  window_start_date: string;
  window_end_date: string;
  timezone: string;
  opted_in: boolean;
  updated_at: string;
}

/**
 * Real-account rank for one exact leaderboard window.
 */
export type LeaderboardCheckpointEntry = OwnLeaderboardEntry & {
  rank: number;
  participant_count: number;
};

export interface LeaderboardPayload {
  profileDisplayName?: string | null;
  period?: LeaderboardPeriod;
  focus_seconds?: number;
  focus_seconds_7d?: number;
  window_start_date: string;
  window_end_date: string;
  timezone: string;
}

export interface LeaderboardResult<T = undefined> {
  success: boolean;
  error: string | null;
  data?: T;
}

export type PublishOwnFocusTotalOptions = {
  readonly updateProfile?: boolean;
};

export type LeaderboardCheckpointPayload = {
  readonly period: "daily" | "weekly";
  readonly focusSeconds: number;
  readonly windowStartDay: string;
  readonly windowEndDay: string;
  readonly timezone: string;
};

type LeaderboardTable = "leaderboard_focus_totals" | "profiles";

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function previewLeaderboardRows(period: LeaderboardPeriod, limit: number): LeaderboardRow[] {
  const today = localDateKey(new Date());
  const windowStart = period === "daily" ? today : shiftDay(today, period === "monthly" ? -29 : -6);
  const names = ["Testing1", "arishin220", "minji_kim", "junseo", "haruka", "drifty", "soonjae", "yuki"];
  const focusSeconds = [141_540, 9_960, 8_520, 6_240, 4_520, 3_120, 2_400, 1_830];
  return names.slice(0, limit).map((name, index) => ({
    rank: index + 1,
    public_id: `preview-${index + 1}`,
    display_name: name,
    avatar_url: "",
    period,
    focus_seconds: focusSeconds[index] ?? 0,
    focus_seconds_7d: focusSeconds[index] ?? 0,
    window_start_date: windowStart,
    window_end_date: today,
    updated_at: `${today}T09:05:00`,
  }));
}

type LeaderboardClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
  from: (table: LeaderboardTable) => {
    upsert: (payload: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: { display_name?: string | null; focus_seconds_7d?: number | null; window_start_date?: string | null; window_end_date?: string | null; timezone?: string | null; opted_in?: boolean | null; updated_at?: string | null } | null; error: { message: string } | null }> };
    };
  };
  rpc: (
    procedure: "get_global_focus_leaderboard" | "get_own_leaderboard_entry" | "get_own_leaderboard_checkpoint" | "publish_own_leaderboard_checkpoint",
    args?: {
      period_name?: LeaderboardPeriod;
      limit_count?: number;
      window_end_day?: string;
      checkpoint_focus_seconds?: number;
      window_start_day?: string;
      timezone_name?: string;
    },
  ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
};
type LeaderboardRpcRow = {
  rank: number | string;
  participant_count?: number | string | null;
  public_id?: string | null;
  display_name: string;
  avatar_url?: string | null;
  period?: string | null;
  focus_seconds?: number | string | null;
  focus_seconds_7d?: number | string | null;
  window_start_date: string;
  window_end_date: string;
  updated_at: string;
};

type OwnLeaderboardRpcRow = LeaderboardRpcRow & {
  rank: number | string | null;
  timezone: string;
  opted_in: boolean | string;
};

function resolveClient(client?: LeaderboardClient | null): LeaderboardClient | null {
  if (client) return client;
  if (!isSupabaseEnabled() || !supabase) return null;
  return supabase as unknown as LeaderboardClient;
}

function toDisplayName(user: { email?: string | null } | null, profileDisplayName?: string | null) {
  const trimmedFallback = profileDisplayName?.trim();
  if (trimmedFallback) return trimmedFallback;

  return fallbackDisplayName(user?.email);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePeriod(value: string | null | undefined): LeaderboardPeriod {
  return LEADERBOARD_PERIODS.includes(value as LeaderboardPeriod) ? value as LeaderboardPeriod : DEFAULT_LEADERBOARD_PERIOD;
}

function getPayloadFocusSeconds(input: LeaderboardPayload) {
  return input.focus_seconds ?? input.focus_seconds_7d ?? 0;
}

function getRowFocusSeconds(row: { focus_seconds?: number | string | null; focus_seconds_7d?: number | string | null }) {
  return Number(row.focus_seconds ?? row.focus_seconds_7d ?? 0);
}

function getParticipantCount(row: { participant_count?: number | string | null }): number | null {
  const value = Number(row.participant_count);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function toLeaderboardErrorMessage(error: { message: string } | Error | unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error && typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message
      : error instanceof Error
        ? error.message
        : String(error);

  if (
    (
      message.includes("get_global_focus_leaderboard")
      || message.includes("get_own_leaderboard_entry")
      || message.includes("get_own_leaderboard_checkpoint")
      || message.includes("publish_own_leaderboard_checkpoint")
    ) &&
    message.toLowerCase().includes("schema cache")
  ) {
    return "Leaderboard RPC is missing in Supabase. Re-run apps/desktop/supabase/schema.sql in your Supabase SQL Editor, then refresh the app.";
  }

  return message;
}

function buildAggregatePayload(
  user: { id: string; email?: string | null } | null,
  input: LeaderboardPayload,
  opted_in: boolean,
  updated_at = nowIso(),
) {
  return {
    user_id: user?.id,
    period: input.period ?? DEFAULT_LEADERBOARD_PERIOD,
    display_name: toDisplayName(user, input.profileDisplayName),
    focus_seconds: getPayloadFocusSeconds(input),
    focus_seconds_7d: getPayloadFocusSeconds(input),
    window_start_date: input.window_start_date,
    window_end_date: input.window_end_date,
    timezone: input.timezone,
    opted_in,
    updated_at,
  };
}

function normalizeLeaderboardRow(row: LeaderboardRpcRow): LeaderboardRow {
  const participantCount = getParticipantCount(row);
  return {
    rank: Number(row.rank),
    ...(participantCount === null ? {} : { participant_count: participantCount }),
    public_id: row.public_id ? String(row.public_id) : null,
    display_name: String(row.display_name),
    avatar_url: String(row.avatar_url ?? ""),
    period: normalizePeriod(row.period),
    focus_seconds: getRowFocusSeconds(row),
    focus_seconds_7d: getRowFocusSeconds(row),
    window_start_date: String(row.window_start_date),
    window_end_date: String(row.window_end_date),
    updated_at: String(row.updated_at),
  };
}

function normalizeOwnLeaderboardRow(row: OwnLeaderboardRpcRow): OwnLeaderboardEntry {
  const participantCount = getParticipantCount(row);
  return {
    rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
    ...(participantCount === null ? {} : { participant_count: participantCount }),
    display_name: String(row.display_name ?? ""),
    period: normalizePeriod(row.period),
    focus_seconds: getRowFocusSeconds(row),
    focus_seconds_7d: getRowFocusSeconds(row),
    window_start_date: String(row.window_start_date ?? ""),
    window_end_date: String(row.window_end_date ?? ""),
    timezone: String(row.timezone ?? ""),
    opted_in: row.opted_in === true || row.opted_in === "true",
    updated_at: String(row.updated_at ?? ""),
  };
}

async function getCurrentUser(client: LeaderboardClient) {
  const { data, error } = await client.auth.getUser();
  return { user: data.user ?? null, error };
}

export async function fetchGlobalLeaderboard(
  periodOrLimit: LeaderboardPeriod | number = DEFAULT_LEADERBOARD_PERIOD,
  limitOrClient: number | LeaderboardClient | null = 50,
  maybeClient?: LeaderboardClient | null,
): Promise<LeaderboardResult<LeaderboardRow[]>> {
  const period = typeof periodOrLimit === "number" ? DEFAULT_LEADERBOARD_PERIOD : periodOrLimit;
  const limit = typeof periodOrLimit === "number"
    ? periodOrLimit
    : typeof limitOrClient === "number"
      ? limitOrClient
      : 50;
  const client = typeof periodOrLimit === "number"
    ? limitOrClient as LeaderboardClient | null | undefined
    : maybeClient ?? (typeof limitOrClient === "number" ? undefined : limitOrClient);
  if (shouldUsePreviewData()) return { success: true, error: null, data: previewLeaderboardRows(period, limit) };
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) {
    return { success: false, error: "Supabase is not configured" };
  }

  try {
    const { data, error } = await resolvedClient.rpc("get_global_focus_leaderboard", {
      period_name: period,
      limit_count: limit,
    });

    if (error) {
      return { success: false, error: toLeaderboardErrorMessage(error) };
    }

    return {
      success: true,
      error: null,
      data: (data ?? []).map((row) => normalizeLeaderboardRow(row as LeaderboardRpcRow)),
    };
  } catch (err) {
    return { success: false, error: toLeaderboardErrorMessage(err) };
  }
}

export async function fetchOwnLeaderboardEntry(
  periodOrClient: LeaderboardPeriod | LeaderboardClient | null = DEFAULT_LEADERBOARD_PERIOD,
  maybeClient?: LeaderboardClient | null,
): Promise<LeaderboardResult<OwnLeaderboardEntry | null>> {
  const period = typeof periodOrClient === "string" ? periodOrClient : DEFAULT_LEADERBOARD_PERIOD;
  const client = typeof periodOrClient === "string" ? maybeClient : periodOrClient;
  if (shouldUsePreviewData()) return { success: true, error: null, data: null };
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) {
    return { success: false, error: "Supabase is not configured" };
  }

  const { user } = await getCurrentUser(resolvedClient);
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const { data, error } = await resolvedClient.rpc("get_own_leaderboard_entry", { period_name: period });

    if (error) {
      return { success: false, error: toLeaderboardErrorMessage(error) };
    }

    const row = data?.[0] as OwnLeaderboardRpcRow | undefined;
    if (!row) {
      return { success: true, error: null, data: null };
    }

    return {
      success: true,
      error: null,
      data: normalizeOwnLeaderboardRow(row),
    };
  } catch (err) {
    return { success: false, error: toLeaderboardErrorMessage(err) };
  }
}

export async function fetchOwnLeaderboardCheckpoint(
  period: Extract<LeaderboardPeriod, "daily" | "weekly">,
  windowEndDay: string,
  client?: LeaderboardClient | null,
): Promise<LeaderboardResult<LeaderboardCheckpointEntry | null>> {
  if (shouldUsePreviewData()) return { success: true, error: null, data: null };
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) {
    return { success: false, error: "Supabase is not configured" };
  }

  const { user } = await getCurrentUser(resolvedClient);
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const { data, error } = await resolvedClient.rpc("get_own_leaderboard_checkpoint", {
      period_name: period,
      window_end_day: windowEndDay,
    });

    if (error) {
      return { success: false, error: toLeaderboardErrorMessage(error) };
    }

    const row = data?.[0] as OwnLeaderboardRpcRow | undefined;
    if (!row) return { success: true, error: null, data: null };

    const normalized = normalizeOwnLeaderboardRow(row);
    const participantCount = normalized.participant_count ?? null;
    if (normalized.rank === null || participantCount === null) {
      return { success: true, error: null, data: null };
    }

    return {
      success: true,
      error: null,
      data: {
        ...normalized,
        rank: normalized.rank,
        participant_count: participantCount,
      },
    };
  } catch (err) {
    return { success: false, error: toLeaderboardErrorMessage(err) };
  }
}

export async function publishOwnLeaderboardCheckpoint(
  payload: LeaderboardCheckpointPayload,
  client?: LeaderboardClient | null,
): Promise<LeaderboardResult<boolean>> {
  if (shouldUsePreviewData()) return { success: true, error: null, data: false };
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) {
    return { success: false, error: "Supabase is not configured" };
  }

  const { user } = await getCurrentUser(resolvedClient);
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const { data, error } = await resolvedClient.rpc("publish_own_leaderboard_checkpoint", {
      period_name: payload.period,
      checkpoint_focus_seconds: Math.max(0, Math.round(payload.focusSeconds)),
      window_start_day: payload.windowStartDay,
      window_end_day: payload.windowEndDay,
      timezone_name: payload.timezone,
    });
    if (error) return { success: false, error: toLeaderboardErrorMessage(error) };

    const row = data?.[0] as { published?: boolean | string } | undefined;
    return {
      success: true,
      error: null,
      data: row?.published === true || row?.published === "true",
    };
  } catch (err) {
    return { success: false, error: toLeaderboardErrorMessage(err) };
  }
}

export async function publishOwnFocusTotal(
  input: LeaderboardPayload,
  client?: LeaderboardClient | null,
  options: PublishOwnFocusTotalOptions = {},
): Promise<LeaderboardResult> {
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) {
    return { success: false, error: "Supabase is not configured" };
  }

  const { user } = await getCurrentUser(resolvedClient);
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const payload = buildAggregatePayload(user, input, true);
    if (options.updateProfile !== false) {
      // is_public is deliberately OMITTED: publishing a score must not flip a user's profile
      // back to public. Existing rows keep their value; a first-time insert uses the schema
      // default (true).
      const { error: profileError } = await resolvedClient.from("profiles").upsert({
        user_id: user.id,
        display_name: payload.display_name,
        timezone: input.timezone,
        updated_at: payload.updated_at,
      }, { onConflict: "user_id" });

      if (profileError) {
        return { success: false, error: profileError.message };
      }
    }

    const { error } = await resolvedClient.from("leaderboard_focus_totals").upsert(payload, {
      onConflict: "user_id,period",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function optOutLeaderboard(
  periodOrClient: LeaderboardPeriod | LeaderboardClient | null = DEFAULT_LEADERBOARD_PERIOD,
  maybeClient?: LeaderboardClient | null,
): Promise<LeaderboardResult> {
  const period = typeof periodOrClient === "string" ? periodOrClient : DEFAULT_LEADERBOARD_PERIOD;
  const client = typeof periodOrClient === "string" ? maybeClient : periodOrClient;
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) {
    return { success: false, error: "Supabase is not configured" };
  }

  const { user } = await getCurrentUser(resolvedClient);
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const { data, error: readError } = await resolvedClient.rpc("get_own_leaderboard_entry", { period_name: period });

    if (readError) {
      return { success: false, error: readError.message };
    }

    const currentRow = data?.[0] as OwnLeaderboardRpcRow | undefined;

    if (!currentRow) {
      return { success: true, error: null };
    }

    const payload = buildAggregatePayload(
      user,
      {
        profileDisplayName: currentRow?.display_name ?? null,
        period,
        focus_seconds: 0,
        window_start_date: String(currentRow?.window_start_date),
        window_end_date: String(currentRow?.window_end_date),
        timezone: String(currentRow?.timezone),
      },
      false,
    );

    const { error } = await resolvedClient.from("leaderboard_focus_totals").upsert(payload, {
      onConflict: "user_id,period",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
