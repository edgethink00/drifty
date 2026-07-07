// Supabase client for the public focus card (Phase 2 embed feature). Writes to the
// card-only `public_focus_cards` table — SEPARATE from the leaderboard, with its own opt-in
// (`enabled`). Only the opt-in aggregate is stored; raw activity never leaves the device.
import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import type { FocusCardPayload } from "./focusCardPublisher";

export interface FocusCardStatus {
  enabled: boolean;
  updatedAt: string | null;
}

export interface FocusCardResult<T = undefined> {
  success: boolean;
  error: string | null;
  data?: T;
}

type FocusCardRow = { enabled?: boolean | null; updated_at?: string | null };

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
    const { data, error } = await resolved.from("public_focus_cards").select("enabled, updated_at").eq("user_id", userId).maybeSingle();
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      error: null,
      data: data ? { enabled: Boolean(data.enabled), updatedAt: data.updated_at ?? null } : null,
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
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
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
