import type { DeleteHistoryRangeResult } from "@drifty/domain";
import type { LocalizationController } from "../localization/LocalizationContext";

export function summarizeHistoryDeletion(result: DeleteHistoryRangeResult, language: "en" | "ko", t: LocalizationController["t"]): string {
  const parts: string[] = [];
  const locale = language === "ko" ? "ko-KR" : "en-US";
  if (result.activitySegments > 0) parts.push(t(result.activitySegments === 1 ? "settings.deleteHistory.activitySingle" : "settings.deleteHistory.activityPlural", { count: result.activitySegments.toLocaleString(locale) }));
  if (result.classifications > 0) parts.push(t(result.classifications === 1 ? "settings.deleteHistory.classificationSingle" : "settings.deleteHistory.classificationPlural", { count: result.classifications.toLocaleString(locale) }));
  if (result.youtubeMetadata > 0) parts.push(t(result.youtubeMetadata === 1 ? "settings.deleteHistory.youtubeSingle" : "settings.deleteHistory.youtubePlural", { count: result.youtubeMetadata.toLocaleString(locale) }));
  return parts.length > 0 ? parts.join(" · ") : t("settings.deleteHistory.noRows");
}
