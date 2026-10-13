import { compareReleaseVersions } from "../updates/updatePolicy";
import type { WhatsNewEntry, WhatsNewPlatform } from "./whatsNewChangelog";

const NUMERIC_VERSION = /^\d+\.\d+\.\d+$/;

function isWhatsNewVersion(value: string | null | undefined): value is string {
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
