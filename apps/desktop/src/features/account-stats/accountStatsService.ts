// Supabase client for the account activity summary (web account dashboard). Writes to the
// user-private `account_activity_summaries` table — owner-only RLS, no RPC, no anon access.
// Only the derived aggregate is stored; raw activity never leaves the device.
import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import type { AccountStatsPayload } from "./accountStatsPayload";

export interface AccountStatsResult {
  success: boolean;
  error: string | null;
  readonly accountChanged?: true;
}

export interface AccountStatsPublishOptions {
  readonly expectedUserId?: string;
}

type AccountStatsClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: "account_activity_summaries") => {
    upsert: (payload: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
  };
};

function resolveClient(client?: AccountStatsClient | null): AccountStatsClient | null {
  if (client) return client;
  if (!isSupabaseEnabled() || !supabase) return null;
  return supabase as unknown as AccountStatsClient;
}

/** Upsert the full account summary for the signed-in user (one row per user). */
export async function publishAccountStats(
  payload: AccountStatsPayload, client?: AccountStatsClient | null, options: AccountStatsPublishOptions = {},
): Promise<AccountStatsResult> {
  const resolved = resolveClient(client);
  if (!resolved) return { success: false, error: "Supabase is not configured" };
  const { data } = await resolved.auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return { success: false, error: "Not authenticated" };
  if (options.expectedUserId !== undefined && userId !== options.expectedUserId) {
    return { success: false, error: "The signed-in account changed before stats publication", accountChanged: true };
  }

  try {
    const { error } = await resolved.from("account_activity_summaries").upsert({
      user_id: userId,
      focus_seconds_today: payload.focusSecondsToday,
      drift_seconds_today: payload.driftSecondsToday,
      neutral_seconds_today: payload.neutralSecondsToday,
      category_breakdown_today: payload.categoryBreakdownToday,
      focus_seconds_7d: payload.focusSeconds7d,
      drift_seconds_7d: payload.driftSeconds7d,
      neutral_seconds_7d: payload.neutralSeconds7d,
      focus_share_7d: payload.focusShare7d,
      category_breakdown_7d: payload.categoryBreakdown7d,
      hourly_pattern_7d: payload.hourlyPattern7d,
      top_apps_7d: payload.topApps7d,
      daily_series_30d: payload.dailySeries30d,
      window_end_date: payload.windowEndDate,
      timezone: payload.timezone,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
