import { formatRoundedDuration } from "../../lib/formatting";
import type { LocalizationController } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import type { TeamProjectTotalsEntry } from "./teamTypes";

// The sharing hook writes these English notes and the Teams page localizes them.
// Both sides live here so the produced and the recognized formats cannot drift.
export function sharedProjectTimeNote(entries: readonly TeamProjectTotalsEntry[]): string {
  const seconds = entries.reduce((total, entry) => total + entry.seconds, 0);
  const projects = new Set(entries.map((entry) => entry.project_id)).size;
  return `Shared ${formatRoundedDuration(seconds)} across ${projects} ${projects === 1 ? "project" : "projects"} for this window.`;
}

export function localizedPublishNote(message: string | null, language: DisplayLanguage, t: LocalizationController["t"]): string | null {
  if (!message || language === "en") return message;
  if (message.startsWith("No classified team-project time yet")) return t("team.notice.noClassifiedTime");
  if (message === "Stopped sharing your project time.") return t("team.notice.stopped");
  if (message.startsWith("Stopped sharing —")) return t("team.notice.stoppedAndRemoved");
  const sharedMatch = /^Shared (.+) across (\d+) projects? for this window\.$/u.exec(message);
  if (sharedMatch) {
    return t("team.notice.shared", {
      duration: localizedEnglishDuration(sharedMatch[1]!),
      count: sharedMatch[2]!,
    });
  }
  return t("team.notice.withDetail", { detail: message });
}

function localizedEnglishDuration(duration: string): string {
  return duration
    .replace(/(\d+)h\b/gu, "$1시간")
    .replace(/(\d+)m\b/gu, "$1분");
}
