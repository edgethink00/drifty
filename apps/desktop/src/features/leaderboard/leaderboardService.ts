import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import { shouldUseLeaderboardPreview, shouldUsePreviewData } from "../../lib/api/previewData";
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
  publicly_valid?: boolean | null;
}

/**
 * Real-account rank for one exact leaderboard window.
 */
export type LeaderboardCheckpointEntry = OwnLeaderboardEntry & {
  rank: number;
  participant_count: number;
};

/** Aggregate-only, real-account model parameters for community estimates. */
export type CommunityFocusPercentileModelRow = {
  readonly period: "daily" | "weekly";
  readonly sample_size: number;
  readonly participant_count: number;
  readonly log_mean_minutes: number;
  readonly log_standard_deviation_minutes: number;
  readonly generated_at: string;
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
  readonly requireOptIn?: boolean;
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

export { shouldUseLeaderboardPreview };

export function previewLeaderboardRows(period: LeaderboardPeriod, limit: number): LeaderboardRow[] {
  const today = localDateKey(new Date());
  const windowStart = period === "daily" ? today : shiftDay(today, period === "monthly" ? -29 : -6);
  const names = ["Testing1", "arishin220", "minji_kim", "junseo", "haruka", "drifty", "soonjae", "yuki"];
  const focusSeconds = [141_540, 9_960, 8_520, 6_240, 4_520, 3_120, 2_400, 1_830];
  const nameSeeds = ["alex", "seoyeon", "taeho", "hyejin", "daniel", "mika", "jiwoo", "ren", "soomin", "kai", "eunji", "noah"];
  const rows: LeaderboardRow[] = [];
  const total = Math.max(limit, names.length);
  for (let i = 0; i < total && i < 50; i++) {
    const rank = i + 1;
    let name: string;
    let focus: number;
    if (i < names.length) {
      name = names[i];
      focus = focusSeconds[i] ?? 0;
    } else {
      const baseSeed = nameSeeds[(rank - 9) % nameSeeds.length];
      name = rank > 20 ? `${baseSeed}_${rank}` : baseSeed;
      const minutes = Math.max(1, 37 - rank);
      focus = minutes * 60;
    }
    rows.push({
      rank,
      public_id: `preview-${rank}`,
      display_name: name,
      avatar_url: "",
      period,
      focus_seconds: focus,
      focus_seconds_7d: focus,
      window_start_date: windowStart,
      window_end_date: today,
      updated_at: `${today}T09:05:00`,
    });
  }
  return rows.slice(0, limit);
}

type LeaderboardWriteResult = { error: { message: string } | null };
type LeaderboardUpdateQuery = PromiseLike<LeaderboardWriteResult> & {
  eq: (column: string, value: string | boolean) => LeaderboardUpdateQuery;
};

type LeaderboardClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: unknown;
    }>;
  };
  from: (table: LeaderboardTable) => {
    update: (payload: Record<string, unknown>) => LeaderboardUpdateQuery;
    upsert: (payload: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: { display_name?: string | null; focus_seconds_7d?: number | null; window_start_date?: string | null; window_end_date?: string | null; timezone?: string | null; opted_in?: boolean | null; updated_at?: string | null } | null; error: { message: string } | null }> };
    };
  };
  rpc: (
    procedure: "get_global_focus_leaderboard" | "get_community_focus_percentile_model" | "get_own_leaderboard_entry" | "get_own_leaderboard_checkpoint" | "publish_own_leaderboard_checkpoint",
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
  validation_version?: number | string | null;
};

type CommunityFocusPercentileModelRpcRow = {
  period?: string | null;
  sample_size?: number | string | null;
  participant_count?: number | string | null;
  log_mean_minutes?: number | string | null;
  log_standard_deviation_minutes?: number | string | null;
  generated_at?: string | null;
};

function resolveClient(client?: LeaderboardClient | null): LeaderboardClient | null {
  if (client) return client;
  if (!isSupabaseEnabled() || !supabase) return null;
  return supabase as unknown as LeaderboardClient;
}

function toDisplayName(user: { id?: string | null; email?: string | null } | null, profileDisplayName?: string | null) {
  const trimmedFallback = profileDisplayName?.trim();
  if (trimmedFallback) return trimmedFallback;

  return fallbackDisplayName(user?.email, user?.id);
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
      || message.includes("get_community_focus_percentile_model")
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

function normalizeCommunityFocusPercentileModelRow(
  row: CommunityFocusPercentileModelRpcRow,
): CommunityFocusPercentileModelRow | null {
  const period = row.period === "daily" || row.period === "weekly" ? row.period : null;
  if (!period) return null;
  return {
    period,
    sample_size: Number(row.sample_size),
    participant_count: Number(row.participant_count),
    log_mean_minutes: Number(row.log_mean_minutes),
    log_standard_deviation_minutes: Number(row.log_standard_deviation_minutes),
    generated_at: String(row.generated_at ?? ""),
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
    ...(row.validation_version === null || row.validation_version === undefined || row.validation_version === ""
      ? {}
      : { publicly_valid: Number(row.validation_version) === 1 }),
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
  if (shouldUseLeaderboardPreview()) return { success: true, error: null, data: previewLeaderboardRows(period, limit) };
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

/**
 * Read anonymous aggregate-only model parameters. The backing RPC never returns
 * participant identities or rows.
 */
export async function fetchCommunityFocusPercentileModel(
  period: "daily" | "weekly",
  client?: LeaderboardClient | null,
): Promise<LeaderboardResult<CommunityFocusPercentileModelRow | null>> {
  if (shouldUsePreviewData()) return { success: true, error: null, data: null };
  const resolvedClient = resolveClient(client);
  if (!resolvedClient) return { success: false, error: "Supabase is not configured" };

  try {
    const { data, error } = await resolvedClient.rpc("get_community_focus_percentile_model", {
      period_name: period,
    });
    if (error) return { success: false, error: toLeaderboardErrorMessage(error) };

    const row = data?.[0] as CommunityFocusPercentileModelRpcRow | undefined;
    return {
      success: true,
      error: null,
      data: row ? normalizeCommunityFocusPercentileModelRow(row) : null,
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
  if (shouldUseLeaderboardPreview()) return { success: true, error: null, data: null };
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

    // Automatic publication may only update an existing, still opted-in row.
    // The final SQL predicate preserves opt-out even across renderers/devices.
    const { error } = options.requireOptIn
      ? await resolvedClient.from("leaderboard_focus_totals").update(payload)
        .eq("user_id", user.id).eq("period", payload.period).eq("opted_in", true)
      : await resolvedClient.from("leaderboard_focus_totals").upsert(payload, {
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
