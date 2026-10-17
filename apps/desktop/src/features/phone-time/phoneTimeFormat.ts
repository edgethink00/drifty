import type { DisplayLanguage } from "../localization/languagePreference";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactTimeRange, formatLocalizedTimeLabel } from "../../lib/formatting";
import type { PhoneTimeBlock } from "./phoneFlowCells";

export function phoneTimeRangeLabel(block: PhoneTimeBlock, language: DisplayLanguage): string {
  if (language === "es") {
    return `${formatLocalizedTimeLabel(block.startedAt, language)} – ${formatLocalizedTimeLabel(block.endedAt, language)}`;
  }
  return formatLocalizedCompactTimeRange(block.startedAt, block.endedAt, language);
}

export function phoneTimeDurationLabel(block: PhoneTimeBlock, language: DisplayLanguage): string {
  return formatLocalizedCompactDurationFromSeconds(Math.max(1, Math.round(block.minutes)) * 60, language);
}
