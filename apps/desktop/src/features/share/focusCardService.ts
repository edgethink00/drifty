// Supabase client for the public focus card (Phase 2 embed feature). Writes to the
// card-only `public_focus_cards` table — SEPARATE from the leaderboard, with its own opt-in
// (`enabled`). Only the opt-in aggregate is stored; raw activity never leaves the device.
import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import type { FocusCardPayload } from "./focusCardPublisher";

/** Per-detail consent flags. The SERVER row is the single source of truth for these — the
 * hook reads them back from `public_focus_cards` so the RPC gate and the publisher always
 * agree on what is shared. */
export interface FocusCardDetailFlags {
  readonly shareCategoryBreakdown: boolean;
  readonly shareHourlyPattern: boolean;
  readonly shareTopApps: boolean;
}

export const DEFAULT_FOCUS_CARD_DETAIL_FLAGS: FocusCardDetailFlags = {
  shareCategoryBreakdown: false,
  shareHourlyPattern: false,
  shareTopApps: false,
};

export interface FocusCardStatus {
  enabled: boolean;
  detailFlags: FocusCardDetailFlags;
  updatedAt: string | null;
}

export interface FocusCardResult<T = undefined> {
  success: boolean;
  error: string | null;
  data?: T;
}

type FocusCardRow = {
  enabled?: boolean | null;
  share_category_breakdown?: boolean | null;
  share_hourly_pattern?: boolean | null;
  share_top_apps?: boolean | null;
  updated_at?: string | null;
};

type FocusCardClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: "public_focus_cards") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: FocusCardRow | null; error: { message: string } | null }>;
      };
    };
    upsert: (payload: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
  };
};

function resolveClient(client?: FocusCardClient | null): FocusCardClient | null {
  if (client) return client;
  if (!isSupabaseEnabled() || !supabase) return null;
  return supabase as unknown as FocusCardClient;
}

async function currentUserId(client: FocusCardClient): Promise<string | null> {
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

export async function fetchOwnFocusCard(client?: FocusCardClient | null): Promise<FocusCardResult<FocusCardStatus | null>> {
  const resolved = resolveClient(client);
  if (!resolved) return { success: false, error: "Supabase is not configured" };
  const userId = await currentUserId(resolved);
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const { data, error } = await resolved
      .from("public_focus_cards")
      .select("enabled, share_category_breakdown, share_hourly_pattern, share_top_apps, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      error: null,
      data: data
        ? {
            enabled: Boolean(data.enabled),
            detailFlags: {
              shareCategoryBreakdown: data.share_category_breakdown === true,
              shareHourlyPattern: data.share_hourly_pattern === true,
              shareTopApps: data.share_top_apps === true,
            },
            updatedAt: data.updated_at ?? null,
          }
        : null,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Upsert the full card aggregate and set its enabled flag (used when publishing/enabling). */
export async function publishFocusCard(payload: FocusCardPayload, enabled: boolean, client?: FocusCardClient | null): Promise<FocusCardResult> {
  const resolved = resolveClient(client);
  if (!resolved) return { success: false, error: "Supabase is not configured" };
  const userId = await currentUserId(resolved);
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const { error } = await resolved.from("public_focus_cards").upsert({
      user_id: userId,
      enabled,
      focus_seconds_today: payload.focus_seconds_today,
      focus_seconds_7d: payload.focus_seconds_7d,
      drift_seconds_7d: payload.drift_seconds_7d,
      neutral_seconds_7d: payload.neutral_seconds_7d,
      focus_share: payload.focus_share,
      daily_focus: payload.daily_focus,
      window_start_date: payload.window_start_date,
      window_end_date: payload.window_end_date,
      // Detail opt-ins: the flags land with the data in one write. A flag that is off has
      // no payload field, and its stored column is actively cleared (not left stale) so a
      // withdrawn consent also removes the data at rest, not just at the RPC gate.
      share_category_breakdown: payload.share_category_breakdown,
      share_hourly_pattern: payload.share_hourly_pattern,
      share_top_apps: payload.share_top_apps,
      category_breakdown_7d: payload.category_breakdown_7d ?? [],
      hourly_focus_pattern: payload.hourly_focus_pattern ?? [],
      top_apps_7d: payload.top_apps_7d ?? [],
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Persist only the per-detail consent flags (used while the card itself is off, so there is
 * no fresh aggregate to publish). Any flag that is off also clears its stored data column.
 */
export async function setFocusCardDetailFlags(flags: FocusCardDetailFlags, client?: FocusCardClient | null): Promise<FocusCardResult> {
  const resolved = resolveClient(client);
  if (!resolved) return { success: false, error: "Supabase is not configured" };
  const userId = await currentUserId(resolved);
  if (!userId) return { success: false, error: "Not authenticated" };

  const payload: Record<string, unknown> = {
    user_id: userId,
    share_category_breakdown: flags.shareCategoryBreakdown,
    share_hourly_pattern: flags.shareHourlyPattern,
    share_top_apps: flags.shareTopApps,
    updated_at: new Date().toISOString(),
  };
  if (!flags.shareCategoryBreakdown) payload.category_breakdown_7d = [];
  if (!flags.shareHourlyPattern) payload.hourly_focus_pattern = [];
  if (!flags.shareTopApps) payload.top_apps_7d = [];

  try {
    const { error } = await resolved.from("public_focus_cards").upsert(payload, { onConflict: "user_id" });
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Flip only the opt-in flag (e.g. making a public card private again) without recomputing. */
export async function setFocusCardEnabled(enabled: boolean, client?: FocusCardClient | null): Promise<FocusCardResult> {
  const resolved = resolveClient(client);
  if (!resolved) return { success: false, error: "Supabase is not configured" };
  const userId = await currentUserId(resolved);
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const { error } = await resolved.from("public_focus_cards").upsert({
      user_id: userId,
      enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
