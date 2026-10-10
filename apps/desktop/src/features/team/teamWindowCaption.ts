import { formatLocalizedDateRangeLabel, formatLocalizedDayLabel } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import type { LocalizationController } from "../localization/LocalizationContext";
import type { TeamProjectsWindow } from "./useTeamProjects";

export function teamWindowDayCount(window: TeamProjectsWindow): number {
  const start = Date.parse(`${window.start_date}T00:00:00Z`);
  const end = Date.parse(`${window.end_date}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Short caption for the selected team window. "Today" and "Last N days" are only
 * true for the latest window; an earlier window names its own dates instead.
 */
export function teamWindowCaption(
  window: TeamProjectsWindow,
  isLatestWindow: boolean,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): string {
  const dayCount = teamWindowDayCount(window);
  if (dayCount <= 1) {
    return isLatestWindow ? t("team.projects.today") : formatLocalizedDayLabel(window.start_date, language);
  }
  return isLatestWindow
    ? t("team.projects.lastDays", { count: dayCount })
    : formatLocalizedDateRangeLabel(window.start_date, window.end_date, language);
}
