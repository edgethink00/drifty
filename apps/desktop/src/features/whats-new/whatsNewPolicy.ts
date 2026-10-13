import { compareReleaseVersions } from "../updates/updatePolicy";
import type { WhatsNewEntry, WhatsNewPlatform } from "./whatsNewChangelog";

/** The newest changelog version this install has been shown. */
export const WHATS_NEW_LAST_SEEN_STORAGE_KEY = "drifty.whatsNew.lastSeenVersion.v1";
/** When What's new last opened by itself. */
export const WHATS_NEW_LAST_AUTO_OPEN_STORAGE_KEY = "drifty.whatsNew.lastAutoOpenAt.v1";

/**
 * Onboarding completed this recently means a new install. New installs learn
 * the app from onboarding, so they record the running version silently.
 */
export const WHATS_NEW_NEW_INSTALL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * drifty.so has a chapter for nearly every stable release, which lately ships
 * every few days. Open by itself at most once a week. Between those opens the
 * Settings link stays in place, with no badge.
 */
export const WHATS_NEW_AUTO_OPEN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const NUMERIC_VERSION = /^\d+\.\d+\.\d+$/;

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export function isWhatsNewVersion(value: string | null | undefined): value is string {
  return typeof value === "string" && NUMERIC_VERSION.test(value);
}

export function toWhatsNewPlatform(hostPlatform: string): WhatsNewPlatform | null {
  return hostPlatform === "macos" || hostPlatform === "windows" ? hostPlatform : null;
}

/** Chapters for this host that the running build already contains, newest first. */
export function entriesForBuild(
  entries: readonly WhatsNewEntry[],
  platform: WhatsNewPlatform | null,
  currentVersion: string,
): readonly WhatsNewEntry[] {
  if (!platform || !isWhatsNewVersion(currentVersion)) return [];
  return entries
    .filter((entry) => entry.platforms.includes(platform))
    .filter((entry) => compareReleaseVersions(entry.fromVersion, currentVersion) <= 0)
    .slice()
    .sort((left, right) => compareReleaseVersions(right.toVersion, left.toVersion) || right.date.localeCompare(left.date));
}

/** The newest version the given chapters cover, capped at the running build. */
export function newestShownVersion(entries: readonly WhatsNewEntry[], currentVersion: string): string | null {
  let newest: string | null = null;
  for (const entry of entries) {
    const covered = compareReleaseVersions(entry.toVersion, currentVersion) > 0 ? currentVersion : entry.toVersion;
    if (!newest || compareReleaseVersions(covered, newest) > 0) newest = covered;
  }
  return newest;
}

export type WhatsNewLaunchInput = {
  /** Already filtered with entriesForBuild; null while the changelog loads. */
  readonly entries: readonly WhatsNewEntry[] | null;
  readonly currentVersion: string;
  readonly lastSeenVersion: string | null;
  readonly lastAutoOpenAt: string | null;
  readonly onboardingCompletedAt: string | null;
  readonly nowMs?: number;
};

export type WhatsNewLaunchDecision = {
  /** Chapters this install has not been shown, newest first. */
  readonly unseen: readonly WhatsNewEntry[];
  /** Open once without a click. */
  readonly autoOpen: boolean;
  /** Store the running version without showing anything (new install). */
  readonly recordSilently: boolean;
};

const NOTHING: WhatsNewLaunchDecision = { unseen: [], autoOpen: false, recordSilently: false };

function isNewInstall(onboardingCompletedAt: string | null, nowMs: number): boolean {
  if (!onboardingCompletedAt) return true;
  const completedAtMs = Date.parse(onboardingCompletedAt);
  if (!Number.isFinite(completedAtMs)) return true;
  return nowMs - completedAtMs < WHATS_NEW_NEW_INSTALL_WINDOW_MS;
}

function autoOpenAllowed(lastAutoOpenAt: string | null, nowMs: number): boolean {
  if (!lastAutoOpenAt) return true;
  const lastMs = Date.parse(lastAutoOpenAt);
  return !Number.isFinite(lastMs) || nowMs - lastMs >= WHATS_NEW_AUTO_OPEN_INTERVAL_MS || nowMs < lastMs;
}

/**
 * Decides whether this launch opens the dialog by itself. The dialog always
 * lists every chapter for the build; unseen drives only this decision.
 *
 * - New install: record the running version, show nothing.
 * - Existing install without a record (installed before this feature): judge
 *   only chapters covering the running version.
 * - Update since the recorded version: judge every newer chapter.
 * - A chapter appears only once drifty.so publishes it, which can be after the
 *   update lands; it is then picked up on a later launch.
 */
export function resolveWhatsNewLaunch({
  entries,
  currentVersion,
  lastSeenVersion,
  lastAutoOpenAt,
  onboardingCompletedAt,
  nowMs = Date.now(),
}: WhatsNewLaunchInput): WhatsNewLaunchDecision {
  if (!isWhatsNewVersion(currentVersion)) return NOTHING;
  if (!isWhatsNewVersion(lastSeenVersion) && isNewInstall(onboardingCompletedAt, nowMs)) {
    return { unseen: [], autoOpen: false, recordSilently: true };
  }
  if (!entries) return NOTHING;

  const unseen = isWhatsNewVersion(lastSeenVersion)
    ? entries.filter((entry) => compareReleaseVersions(entry.toVersion, lastSeenVersion) > 0)
    : entries.filter((entry) => compareReleaseVersions(entry.toVersion, currentVersion) >= 0);

  return {
    unseen,
    autoOpen: unseen.length > 0 && autoOpenAllowed(lastAutoOpenAt, nowMs),
    recordSilently: false,
  };
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readItem(key: string, storage: KeyValueStorage | null): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function readWhatsNewLastSeenVersion(storage: KeyValueStorage | null = defaultStorage()): string | null {
  const value = readItem(WHATS_NEW_LAST_SEEN_STORAGE_KEY, storage);
  return isWhatsNewVersion(value) ? value : null;
}

export function readWhatsNewLastAutoOpenAt(storage: KeyValueStorage | null = defaultStorage()): string | null {
  return readItem(WHATS_NEW_LAST_AUTO_OPEN_STORAGE_KEY, storage);
}

export function markWhatsNewAutoOpened(nowMs = Date.now(), storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(WHATS_NEW_LAST_AUTO_OPEN_STORAGE_KEY, new Date(nowMs).toISOString());
  } catch {
    // Without storage the weekly limit resets on the next launch.
  }
}

/** Records version as seen. Never moves the record backwards. */
export function markWhatsNewSeen(version: string | null, storage: KeyValueStorage | null = defaultStorage()): void {
  if (!storage || !isWhatsNewVersion(version)) return;
  const previous = readWhatsNewLastSeenVersion(storage);
  if (previous && compareReleaseVersions(previous, version) >= 0) return;
  try {
    storage.setItem(WHATS_NEW_LAST_SEEN_STORAGE_KEY, version);
  } catch {
    // Storage can be full or blocked; the dialog may show again next launch.
  }
}
