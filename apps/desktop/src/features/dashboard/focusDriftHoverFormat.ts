import { formatLocalizedCompactTimeRange } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import { FOCUS_DRIFT_BUCKET_MINUTES } from "./focusDriftGeometry";

/**
 * The 30-minute slot a Focus/Drift hover card describes, as "8:30 – 9:00 PM".
 *
 * The slot is always the full bucket, not the elapsed part of a live one: the
 * card's "tracked" amount already says how much of it has been recorded, so a
 * half-recorded slot reads "8:30 – 9:00 PM · 12m tracked" instead of a range
 * that changes every minute. The shared compact range formatter writes a common
 * am/pm marker once and keeps both when the slot crosses noon or midnight; it
 * builds its labels itself, so Korean output does not depend on the runtime's
 * locale data.
 */
export function formatFocusDriftWindowRange(
  bucketStartMinute: number,
  startOfDayMinutes: number,
  language: DisplayLanguage,
  bucketMinutes: number = FOCUS_DRIFT_BUCKET_MINUTES,
): string {
  const startMinute = bucketStartMinute + startOfDayMinutes;
  const slotLength = bucketMinutes > 0 ? bucketMinutes : 0;
  return formatLocalizedCompactTimeRange(clockAt(startMinute), clockAt(startMinute + slotLength), language);
}

function clockAt(minuteOfDay: number): Date {
  const minutesPerDay = 24 * 60;
  const normalized = ((minuteOfDay % minutesPerDay) + minutesPerDay) % minutesPerDay;
  return new Date(2026, 0, 1, Math.floor(normalized / 60), normalized % 60, 0, 0);
}
