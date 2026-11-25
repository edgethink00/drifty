import { useEffect, useState } from "react";
import { readProductAnalyticsEnabled } from "../../lib/analytics/productAnalyticsPreference";
import { isSupabaseEnabled, supabase } from "../../lib/supabase/client";
import { ACHIEVEMENT_IDS, type AchievementId } from "./achievementCatalog";
import type { AchievementRarity } from "./achievementRarity";
import type { AchievementStore } from "./achievementStore";

/**
 * The share of Drifty users who hold each achievement.
 *
 * With Usage statistics on (Settings › Privacy, on by default), the app
 * reports which achievements this install holds: only their ids, under a
 * random key made for this purpose alone and never joined with analytics or
 * the account. Nothing about days, times or activity is sent. Drifty's server
 * keeps one row per key, drops keys not seen for 180 days, and hands back only
 * a share per achievement once at least MIN_BASIS installs have reported in
 * the last 90 days. Until then no share shows.
 */
export const RARITY_INSTALL_KEY_STORAGE = "drifty.achievements.rarityKey.v1";
const LAST_REPORT_STORAGE = "drifty.achievements.rarityReported.v1";
const RARITY_CACHE_STORAGE = "drifty.achievements.rarity.v1";

/** Report again after this long even when nothing changed, so the key counts as active. */
export const REPORT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** Shares are recounted daily on the server; read them at most this often. */
export const RARITY_CACHE_MS = 12 * 60 * 60 * 1000;

type RarityRow = { readonly achievement_id: string; readonly percent: number | string; readonly basis_count: number | string };
export type RarityTable = Readonly<Partial<Record<AchievementId, AchievementRarity>>>;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function installKey(store: Storage): string {
  const existing = store.getItem(RARITY_INSTALL_KEY_STORAGE);
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;
  const created = crypto.randomUUID();
  store.setItem(RARITY_INSTALL_KEY_STORAGE, created);
  return created;
}

/** The earned achievement ids, in catalogue order: all that is ever reported. */
export function heldAchievementIds(store: Pick<AchievementStore, "earned">): AchievementId[] {
  return ACHIEVEMENT_IDS.filter((id) => store.earned[id]);
}

/** Whether a report is due: the held set changed, or the last report is a week old. */
export function reportDue(held: readonly AchievementId[], last: { readonly ids: string; readonly at: number } | null, now: number): boolean {
  if (!last) return true;
  return last.ids !== held.join(",") || now - last.at >= REPORT_REFRESH_MS;
}

export function parseRarityRows(rows: readonly RarityRow[]): RarityTable {
  const table: Partial<Record<AchievementId, AchievementRarity>> = {};
  for (const row of rows) {
    const id = row.achievement_id as AchievementId;
    const percent = Number(row.percent);
    const basisCount = Number(row.basis_count);
    if (!ACHIEVEMENT_IDS.includes(id) || !Number.isFinite(percent) || percent < 0 || percent > 100 || !(basisCount > 0)) continue;
    table[id] = { percent, basisCount };
  }
  return table;
}

/** Report the held achievements when due. Does nothing with Usage statistics off, without a server, or before anything is earned. */
export async function reportAchievementHoldings(store: Pick<AchievementStore, "earned">, now = Date.now()): Promise<void> {
  const local = storage();
  if (!local || !supabase || !isSupabaseEnabled() || !readProductAnalyticsEnabled(local)) return;
  const held = heldAchievementIds(store);
  if (held.length === 0) return;
  let last: { ids: string; at: number } | null = null;
  try {
    last = JSON.parse(local.getItem(LAST_REPORT_STORAGE) ?? "null") as { ids: string; at: number } | null;
  } catch {
    last = null;
  }
  if (!reportDue(held, last, now)) return;
  const { error } = await supabase.rpc("report_achievement_holdings", { install_key: installKey(local), achievement_ids: held });
  if (!error) local.setItem(LAST_REPORT_STORAGE, JSON.stringify({ ids: held.join(","), at: now }));
}

/** The shares, from a recent read when there is one. Empty until the server has enough reports. */
export async function readAchievementRarity(now = Date.now()): Promise<RarityTable> {
  const local = storage();
  try {
    const cached = JSON.parse(local?.getItem(RARITY_CACHE_STORAGE) ?? "null") as { at: number; rows: RarityRow[] } | null;
    if (cached && now - cached.at < RARITY_CACHE_MS) return parseRarityRows(cached.rows);
  } catch {
    // A broken cache is read again from the server.
  }
  if (!supabase || !isSupabaseEnabled()) return {};
  const { data, error } = await supabase.rpc("get_achievement_rarity");
  if (error || !Array.isArray(data)) return {};
  local?.setItem(RARITY_CACHE_STORAGE, JSON.stringify({ at: now, rows: data }));
  return parseRarityRows(data as RarityRow[]);
}

/** Report this install's holdings when they change and read the shares; the shares are empty until known. */
export function useAchievementRarity(store: AchievementStore, enabled: boolean): RarityTable {
  const [table, setTable] = useState<RarityTable>({});
  const held = heldAchievementIds(store).join(",");
  useEffect(() => {
    if (!enabled) return;
    void reportAchievementHoldings(store).catch(() => {});
    // Only the held set matters for reporting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, held]);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void readAchievementRarity().then((next) => { if (!cancelled) setTable(next); }).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled]);
  return table;
}
