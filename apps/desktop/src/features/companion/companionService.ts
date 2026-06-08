import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";

export interface CompanionSummaryCode {
  deviceId: string;
  deviceName: string;
  pairingCode: string;
  focusMinutesToday: number;
  sessionsCompletedToday: number;
  currentFocusMode: "active" | "idle";
  lastFocusAt: string | null;
}

export interface CompanionDevice extends CompanionSummaryCode {
  platform: "ios";
  pairingCode: string;
  lastSyncedAt: string;
}

export interface CompanionResult<T = undefined> {
  success: boolean;
  error: string | null;
  data?: T;
}

type CompanionRow = {
  device_id: string;
  device_name: string;
  platform: "ios";
  pairing_code: string;
  focus_minutes_today: number;
  sessions_completed_today: number;
  current_focus_mode: "active" | "idle";
  last_focus_at: string | null;
  last_synced_at: string;
};

const COMPANION_SUMMARY_CODE_PREFIX = "DRIFTY-IOS-V1";

export function parseCompanionSummaryCode(value: string): CompanionSummaryCode | null {
  const parts = value.trim().split("|");
  if (parts.length !== 8 || parts[0] !== COMPANION_SUMMARY_CODE_PREFIX) return null;

  const focusMinutesToday = Number(parts[4]);
  const sessionsCompletedToday = Number(parts[5]);
  const currentFocusMode = parts[6] === "active" ? "active" : parts[6] === "idle" ? "idle" : null;
  if (!Number.isInteger(focusMinutesToday) || !Number.isInteger(sessionsCompletedToday) || focusMinutesToday < 0 || sessionsCompletedToday < 0 || !currentFocusMode) return null;

  return {
    deviceId: parts[1],
    deviceName: parts[2] || "iPhone",
    pairingCode: parts[3].trim().toUpperCase(),
    focusMinutesToday,
    sessionsCompletedToday,
    currentFocusMode,
    lastFocusAt: parts[7] === "none" ? null : parts[7],
  };
}

export function generateCompanionPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export async function fetchCompanionDevices(): Promise<CompanionResult<CompanionDevice[]>> {
  if (!isSupabaseEnabled() || !supabase) return { success: false, error: "Supabase is not configured" };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to use Mac companion sync" };

  const { data, error } = await supabase
    .from("companion_devices")
    .select("device_id, device_name, platform, pairing_code, focus_minutes_today, sessions_completed_today, current_focus_mode, last_focus_at, last_synced_at")
    .eq("user_id", user.id)
    .order("last_synced_at", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, error: null, data: (data ?? []).map(mapRow) };
}

export async function saveCompanionSummary(pairingCode: string, summaryCode: string): Promise<CompanionResult<CompanionDevice>> {
  if (!isSupabaseEnabled() || !supabase) return { success: false, error: "Supabase is not configured" };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to use Mac companion sync" };

  const parsed = parseCompanionSummaryCode(summaryCode);
  if (!parsed) return { success: false, error: "That does not look like a Drifty iOS summary code" };
  const normalizedPairingCode = pairingCode.trim().toUpperCase();
  if (!normalizedPairingCode || parsed.pairingCode !== normalizedPairingCode) {
    return { success: false, error: "Pairing code mismatch. Enter the Mac code on iPhone, then copy a fresh iOS summary." };
  }

  const now = new Date().toISOString();
  const row = {
    user_id: user.id,
    device_id: parsed.deviceId,
    device_name: parsed.deviceName,
    platform: "ios",
    pairing_code: normalizedPairingCode,
    focus_minutes_today: parsed.focusMinutesToday,
    sessions_completed_today: parsed.sessionsCompletedToday,
    current_focus_mode: parsed.currentFocusMode,
    last_focus_at: parsed.lastFocusAt,
    last_synced_at: now,
  };

  const { data, error } = await supabase
    .from("companion_devices")
    .upsert(row, { onConflict: "user_id,device_id" })
    .select("device_id, device_name, platform, pairing_code, focus_minutes_today, sessions_completed_today, current_focus_mode, last_focus_at, last_synced_at")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, error: null, data: mapRow(data as CompanionRow) };
}

function mapRow(row: CompanionRow): CompanionDevice {
  return {
    deviceId: row.device_id,
    deviceName: row.device_name,
    platform: row.platform,
    pairingCode: row.pairing_code,
    focusMinutesToday: row.focus_minutes_today,
    sessionsCompletedToday: row.sessions_completed_today,
    currentFocusMode: row.current_focus_mode,
    lastFocusAt: row.last_focus_at,
    lastSyncedAt: row.last_synced_at,
  };
}
