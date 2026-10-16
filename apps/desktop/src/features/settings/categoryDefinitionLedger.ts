/**
 * When each category-editor definition was last changed on this device, so
 * device sync can merge definitions item by item: the newer edit of an item
 * wins on every device (owner decision 2026-10-16, Category definitions sync).
 *
 * Keys name one definition each: "category:<id>", "productivity:<label or
 * level id>", or "order". An item edited before this ledger existed has no
 * time here and counts as the oldest.
 */
export const CATEGORY_DEFINITION_LEDGER_STORAGE_KEY = "drifty.categoryDefinitionSync.v1";

export type DefinitionLedger = Readonly<Record<string, string>>;

/**
 * Sent after device sync wrote definitions from another device. The app
 * reloads the category and productivity colors it keeps in its own state;
 * the definitions' own readers already follow the customization change event.
 */
export const CATEGORY_DEFINITIONS_SYNCED_EVENT = "drifty:category-definitions-synced";

const DEFINITION_KEY_PATTERN = /^(category:[a-z_]{2,24}|category:custom-[a-z0-9]{4,32}|productivity:(focus|neutral|drift)|productivity:level-[a-z0-9]{4,32}|order)$/;

export function isDefinitionSyncKey(value: unknown): value is string {
  return typeof value === "string" && DEFINITION_KEY_PATTERN.test(value);
}

export function readDefinitionLedger(): DefinitionLedger {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CATEGORY_DEFINITION_LEDGER_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const ledger: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isDefinitionSyncKey(key) && typeof value === "string" && Number.isFinite(Date.parse(value))) ledger[key] = new Date(value).toISOString();
    }
    return ledger;
  } catch {
    return {};
  }
}

/** Records edit times; a later call for the same key replaces its time. */
export function writeDefinitionLedgerTimes(times: Readonly<Record<string, string>>): void {
  if (typeof window === "undefined") return;
  const entries = Object.entries(times).filter(([key]) => isDefinitionSyncKey(key));
  if (entries.length === 0) return;
  const next = { ...readDefinitionLedger(), ...Object.fromEntries(entries) };
  try {
    window.localStorage.setItem(CATEGORY_DEFINITION_LEDGER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full store keeps the older times; the next edit stamps again.
  }
}

/** Marks these definitions as changed now on this device. */
export function stampDefinitions(keys: readonly string[], at: string = new Date().toISOString()): void {
  if (keys.length === 0) return;
  writeDefinitionLedgerTimes(Object.fromEntries(keys.map((key) => [key, at])));
}

/** JSON with sorted object keys, so equal definitions compare equal. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value ?? null);
}

/** The keys of two maps whose entries differ, each with the given prefix. */
export function changedDefinitionKeys(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  prefix: string,
  keyMap: (key: string) => string | null = (key) => key,
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].flatMap((key) => {
    if (stableJson(previous[key]) === stableJson(next[key])) return [];
    const mapped = keyMap(key);
    return mapped === null ? [] : [prefix + mapped];
  }).filter(isDefinitionSyncKey);
}

