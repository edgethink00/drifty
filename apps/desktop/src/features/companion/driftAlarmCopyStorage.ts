import type { DisplayLanguage } from "../localization/languagePreference";
import {
  DRIFT_ALARM_COPY_FIELDS,
  buildDefaultDriftAlarmCopy,
  type DriftAlarmCopyField,
  type DriftAlarmCopySettingsValue,
} from "./driftAlarmCopy";

/** v1 stored the whole resolved object, so an unedited English default was
 *  indistinguishable from a deliberate choice. Left in place for downgrades. */
export const DRIFT_ALARM_COPY_STORAGE_KEY = "drifty.notifications.driftAlarmCopy";
/** v2 stores only the fields the user changed; everything else follows the
 *  display language. */
export const DRIFT_ALARM_COPY_OVERRIDES_STORAGE_KEY = "drifty.notifications.driftAlarmCopyOverrides.v2";

export type DriftAlarmCopyOverrides = Partial<DriftAlarmCopySettingsValue>;

export function resolveInitialDriftAlarmCopyOverrides(): DriftAlarmCopyOverrides {
  if (typeof window === "undefined") return {};
  const storedOverrides = readJson(DRIFT_ALARM_COPY_OVERRIDES_STORAGE_KEY);
  if (storedOverrides !== null) return sanitizeOverrides(storedOverrides);
  return migrateLegacyDriftAlarmCopy(readJson(DRIFT_ALARM_COPY_STORAGE_KEY));
}

export function persistDriftAlarmCopyOverrides(overrides: DriftAlarmCopyOverrides): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRIFT_ALARM_COPY_OVERRIDES_STORAGE_KEY, JSON.stringify(sanitizeOverrides(overrides)));
}

/** Current-language defaults with the user's edits layered on top. */
export function resolveDriftAlarmCopy(
  overrides: DriftAlarmCopyOverrides,
  language: DisplayLanguage,
): DriftAlarmCopySettingsValue {
  return { ...buildDefaultDriftAlarmCopy(language), ...sanitizeOverrides(overrides) };
}

/**
 * The editor hands back a full draft; only fields that differ from the
 * defaults the user was looking at are kept. A field cleared to blank means
 * "use the default", so it is dropped rather than stored empty.
 */
export function diffDriftAlarmCopyOverrides(
  draft: DriftAlarmCopySettingsValue,
  defaults: DriftAlarmCopySettingsValue,
): DriftAlarmCopyOverrides {
  const overrides: Partial<Record<DriftAlarmCopyField, string>> = {};
  for (const field of DRIFT_ALARM_COPY_FIELDS) {
    const value = draft[field].trim();
    if (value.length > 0 && value !== defaults[field]) overrides[field] = value;
  }
  return overrides;
}

/**
 * The legacy object always carried every field, and only four titles were
 * ever user-editable. Keeping the fields that differ from the English defaults
 * preserves those edits and lets everything else pick up the display language.
 */
function migrateLegacyDriftAlarmCopy(value: unknown): DriftAlarmCopyOverrides {
  if (!value || typeof value !== "object") return {};
  const englishDefaults = buildDefaultDriftAlarmCopy("en");
  const overrides: Partial<Record<DriftAlarmCopyField, string>> = {};
  for (const field of DRIFT_ALARM_COPY_FIELDS) {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0 && trimmed !== englishDefaults[field]) overrides[field] = trimmed;
  }
  return overrides;
}

function sanitizeOverrides(value: unknown): DriftAlarmCopyOverrides {
  if (!value || typeof value !== "object") return {};
  const overrides: Partial<Record<DriftAlarmCopyField, string>> = {};
  for (const field of DRIFT_ALARM_COPY_FIELDS) {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) overrides[field] = trimmed;
  }
  return overrides;
}

function readJson(key: string): unknown {
  const rawValue = window.localStorage.getItem(key);
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
