import {
  CUSTOMIZABLE_CATEGORIES,
  CUSTOMIZABLE_PRODUCTIVITY_LABELS,
  isCustomActivityCategory,
  isCustomProductivityLevel,
  normalizeCategoryCustomization,
  normalizeCategoryOrder,
  normalizeCustomCategoryCustomization,
  normalizeProductivityCustomization,
  normalizeProductivityLevelCustomization,
  type ActivityCategory,
  type CategoryCustomization,
  type ProductivityCustomization,
  type ProductivityLabel,
} from "@drifty/domain";
import { supabase } from "../../lib/supabase/client";
import {
  CATEGORY_DEFINITIONS_SYNCED_EVENT,
  isDefinitionSyncKey,
  readDefinitionLedger,
  stableJson,
  writeDefinitionLedgerTimes,
} from "./categoryDefinitionLedger";
import {
  CATEGORY_COLOR_OPTIONS,
  PRODUCTIVITY_THEME_COLOR_KEYS,
  isHexColor,
  persistAppThemeColorOverrides,
  persistCategoryColorOverrides,
  readCategoryCustomizations,
  readCategoryOrder,
  readProductivityCustomizations,
  resolveInitialAppThemeColorOverrides,
  resolveInitialCategoryColorOverrides,
  writeCategoryCustomizations,
  writeCategoryOrder,
  writeProductivityCustomizations,
} from "./settingsStorage";

/**
 * Category-editor definitions across one account's devices (owner decision
 * 2026-10-16, Category definitions sync). Like the excluded-app list, they go
 * to the account only from a device with device sync on: synced activity
 * already carries category and level ids, and without their definitions a
 * user-added category reads as Other on the other device.
 *
 * One row per definition (a category, a productivity label or level, or the
 * order), carrying what the editor saves for it, its color included. The
 * newer edit of a row wins everywhere; a row reset to Drifty's own carries no
 * value. Edits made before this existed count as the oldest, so the first
 * device to sync sets them for the account.
 */
export const CATEGORY_DEFINITIONS_TABLE = "user_category_definitions";

const OLDEST = new Date(0).toISOString();

export type DefinitionValue = Readonly<Record<string, unknown>> | null;

export type DefinitionRecord = {
  readonly key: string;
  readonly value: DefinitionValue;
  readonly updatedAt: string;
};

const COLOR_CATEGORIES = new Set<string>(CATEGORY_COLOR_OPTIONS.map((option) => option.key));
const DEFINED_CATEGORIES = new Set<string>(CUSTOMIZABLE_CATEGORIES);
const PRODUCTIVITY_LABELS = new Set<string>(CUSTOMIZABLE_PRODUCTIVITY_LABELS);

function withColor(entry: object | undefined, color: string | undefined): DefinitionValue {
  const value = { ...(entry ?? {}), ...(color ? { color } : {}) };
  return Object.keys(value).length > 0 ? value : null;
}

/** This device's definitions as sync rows, with the time each was last changed here. */
export function readLocalDefinitionRecords(): DefinitionRecord[] {
  const categories = readCategoryCustomizations() as Readonly<Record<string, CategoryCustomization | undefined>>;
  const productivity = readProductivityCustomizations() as Readonly<Record<string, ProductivityCustomization | undefined>>;
  const categoryColors = resolveInitialCategoryColorOverrides() as Readonly<Record<string, string | undefined>>;
  const themeColors = resolveInitialAppThemeColorOverrides();
  const order = readCategoryOrder();
  const ledger = readDefinitionLedger();

  const values = new Map<string, DefinitionValue>();
  for (const id of new Set([...Object.keys(categories), ...Object.keys(categoryColors)])) {
    if (isCustomActivityCategory(id)) values.set("category:" + id, withColor(categories[id], undefined));
    else if (COLOR_CATEGORIES.has(id)) values.set("category:" + id, withColor(categories[id], categoryColors[id]));
  }
  for (const label of CUSTOMIZABLE_PRODUCTIVITY_LABELS) {
    values.set("productivity:" + label, withColor(productivity[label], themeColors[PRODUCTIVITY_THEME_COLOR_KEYS[label as ProductivityLabel]]));
  }
  for (const id of Object.keys(productivity)) {
    if (isCustomProductivityLevel(id)) values.set("productivity:" + id, withColor(productivity[id], undefined));
  }
  values.set("order", order.length > 0 ? { order } : null);

  const keys = new Set([...values.keys(), ...Object.keys(ledger)]);
  return [...keys].filter(isDefinitionSyncKey).flatMap((key) => {
    const value = values.get(key) ?? null;
    // An untouched default needs no row.
    if (value === null && !ledger[key]) return [];
    return [{ key, value, updatedAt: ledger[key] ?? OLDEST }];
  });
}

/**
 * Which rows this device takes from the account and which it sends. The newer
 * edit wins; on a tie with different values, the copy already in the account
 * wins, so every device settles on the same definitions.
 */
export function mergeDefinitionRecords(
  local: readonly DefinitionRecord[],
  remote: readonly DefinitionRecord[],
): { readonly toLocal: DefinitionRecord[]; readonly toRemote: DefinitionRecord[] } {
  const localByKey = new Map(local.map((record) => [record.key, record]));
  const remoteByKey = new Map(remote.map((record) => [record.key, record]));
  const toLocal: DefinitionRecord[] = [];
  const toRemote: DefinitionRecord[] = [];
  for (const key of new Set([...localByKey.keys(), ...remoteByKey.keys()])) {
    const mine = localByKey.get(key);
    const theirs = remoteByKey.get(key);
    if (!theirs) {
      if (mine) toRemote.push(mine);
    } else if (!mine || theirs.updatedAt > mine.updatedAt) {
      toLocal.push(theirs);
    } else if (mine.updatedAt > theirs.updatedAt) {
      toRemote.push(mine);
    } else if (stableJson(mine.value) !== stableJson(theirs.value)) {
      toLocal.push(theirs);
    }
  }
  return { toLocal, toRemote };
}

function colorOf(value: DefinitionValue): string | null {
  const color = value?.color;
  return typeof color === "string" && isHexColor(color) ? color.toLowerCase() : null;
}

function withoutColor(value: DefinitionValue): Record<string, unknown> | null {
  if (!value) return null;
  const { color: _color, ...rest } = value;
  return rest;
}

/**
 * Writes rows from the account into this device's definitions. Every value is
 * normalized as if the editor had saved it; a row this version cannot read is
 * skipped. The rows keep the account's edit times, so they are not sent back.
 */
export function applyDefinitionRecords(records: readonly DefinitionRecord[]): void {
  if (records.length === 0) return;
  const categories: Record<string, CategoryCustomization> = { ...(readCategoryCustomizations() as Record<string, CategoryCustomization>) };
  const productivity: Record<string, ProductivityCustomization> = { ...(readProductivityCustomizations() as Record<string, ProductivityCustomization>) };
  const categoryColors: Record<string, string> = { ...(resolveInitialCategoryColorOverrides() as Record<string, string>) };
  const themeColors: Record<string, string> = { ...(resolveInitialAppThemeColorOverrides() as Record<string, string>) };
  let order: ActivityCategory[] | null = null;
  const applied: Record<string, string> = {};
  const put = <T,>(map: Record<string, T>, id: string, entry: T | null) => {
    if (entry) map[id] = entry;
    else delete map[id];
  };

  for (const record of records) {
    if (!isDefinitionSyncKey(record.key)) continue;
    const separator = record.key.indexOf(":");
    const group = separator < 0 ? record.key : record.key.slice(0, separator);
    const id = separator < 0 ? "" : record.key.slice(separator + 1);
    const value = record.value;
    if (group === "order") {
      order = Array.isArray(value?.order) ? normalizeCategoryOrder(value.order) : [];
    } else if (group === "category" && isCustomActivityCategory(id)) {
      put(categories, id, value ? normalizeCustomCategoryCustomization(value) : null);
    } else if (group === "category" && COLOR_CATEGORIES.has(id)) {
      if (DEFINED_CATEGORIES.has(id)) put(categories, id, normalizeCategoryCustomization(withoutColor(value)));
      put(categoryColors, id, colorOf(value));
    } else if (group === "productivity" && isCustomProductivityLevel(id)) {
      put(productivity, id, value ? normalizeProductivityLevelCustomization(value) : null);
    } else if (group === "productivity" && PRODUCTIVITY_LABELS.has(id)) {
      put(productivity, id, normalizeProductivityCustomization(withoutColor(value)));
      put(themeColors, PRODUCTIVITY_THEME_COLOR_KEYS[id as ProductivityLabel], colorOf(value));
    } else {
      continue;
    }
    applied[record.key] = record.updatedAt;
  }

  writeCategoryCustomizations(categories);
  writeProductivityCustomizations(productivity);
  if (order) writeCategoryOrder(order);
  persistCategoryColorOverrides(categoryColors);
  persistAppThemeColorOverrides(themeColors);
  writeDefinitionLedgerTimes(applied);
  window.dispatchEvent(new CustomEvent(CATEGORY_DEFINITIONS_SYNCED_EVENT));
}

function asIsoTime(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function remoteRecord(row: { key?: unknown; value?: unknown; updated_at?: unknown }): DefinitionRecord | null {
  const updatedAt = asIsoTime(row.updated_at);
  if (!isDefinitionSyncKey(row.key) || !updatedAt) return null;
  const value = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value as Record<string, unknown> : null;
  return { key: row.key, value, updatedAt };
}

/**
 * One pass for an account: read its rows, merge them with this device's, write
 * the account's newer ones here and send this device's newer ones. Stops if the
 * signed-in account changes on the way, like the excluded-app pass.
 */
export async function syncCategoryDefinitionsForAccount(
  accountId: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!supabase) return;
  const client = supabase;
  const assertCurrentAccount = async () => {
    if (!isCurrent()) throw new Error("Device sync account scope changed.");
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id !== accountId || !isCurrent()) {
      throw new Error("Device sync account scope changed.");
    }
  };
  await assertCurrentAccount();
  const { data, error } = await client
    .from(CATEGORY_DEFINITIONS_TABLE)
    .select("key, value, updated_at")
    .eq("user_id", accountId);
  if (error) throw error;
  await assertCurrentAccount();
  const remote = ((data ?? []) as { key?: unknown; value?: unknown; updated_at?: unknown }[]).flatMap((row) => {
    const record = remoteRecord(row);
    return record ? [record] : [];
  });
  const { toLocal, toRemote } = mergeDefinitionRecords(readLocalDefinitionRecords(), remote);
  applyDefinitionRecords(toLocal);
  if (toRemote.length > 0) {
    await assertCurrentAccount();
    const { error: upsertError } = await client.from(CATEGORY_DEFINITIONS_TABLE).upsert(
      toRemote.map((record) => ({ user_id: accountId, key: record.key, value: record.value, updated_at: record.updatedAt })),
      { onConflict: "user_id,key" },
    );
    if (upsertError) throw upsertError;
  }
  await assertCurrentAccount();
}

