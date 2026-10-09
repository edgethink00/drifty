import {
  logicalDayStartMs,
  type ActivityCategory,
  type ActivitySegment,
  type ClassificationOptions,
  type ProductivityLabel,
} from "@drifty/domain";
import { formatLocalDateTime } from "../../lib/formatting";

/**
 * The sample workday behind the first onboarding screen. Everything here is synthetic: no
 * user, app or site data is read, and nothing leaves the device. The segments go through the
 * dashboard's own aggregation, so the screen shows what the real Today view would draw for
 * such a day: short check-ins, long focus stretches and a few drifts.
 */

/**
 * The demo reads its day from 8 AM, one of the app's hourly start-of-day settings, so the
 * flow chart opens just before the first activity instead of on three empty hours.
 */
export const ENTRY_DEMO_START_OF_DAY_MINUTES = 8 * 60;
/** The virtual clock runs from shortly before the first activity to the end of the sample day. */
export const ENTRY_DEMO_CLOCK_START_MINUTE = 8 * 60 + 48;
export const ENTRY_DEMO_CLOCK_END_MINUTE = 17 * 60 + 24;
/** The Today flow chart's default cell size; the clock advances one cell at a time. */
export const ENTRY_DEMO_CLOCK_STEP_MINUTES = 3;

export const ENTRY_DEMO_CLASSIFICATION_OPTIONS: ClassificationOptions = {
  includeAiClassifications: true,
  includeBuiltInHeuristics: false,
  rules: [],
};

type Blueprint = readonly [
  slug: string,
  start: string,
  minutes: number,
  appName: string,
  category: ActivityCategory,
  productivity: ProductivityLabel,
];

const ENTRY_DEMO_DAY: readonly Blueprint[] = [
  ["standup-chat", "09:00", 11, "Team Chat", "communication", "neutral"],
  ["morning-build", "09:11", 60, "Code Editor", "workspace", "focus"],
  ["video-break", "10:11", 9, "Video Site", "entertainment", "drift"],
  ["feature-build", "10:20", 41, "Code Editor", "workspace", "focus"],
  ["design-review", "11:01", 31, "Video Call", "communication", "neutral"],
  ["reference-docs", "11:32", 33, "Docs", "learning", "focus"],
  ["after-lunch-feed", "13:06", 13, "Social Feed", "social_media", "drift"],
  ["design-pass", "13:19", 50, "Design Tool", "workspace", "focus"],
  ["thread-reply", "14:09", 8, "Team Chat", "communication", "neutral"],
  ["bug-fix", "14:17", 44, "Code Editor", "workspace", "focus"],
  ["video-detour", "15:01", 18, "Video Site", "entertainment", "drift"],
  ["test-pass", "15:19", 39, "Code Editor", "workspace", "focus"],
  ["inbox", "15:58", 11, "Mail", "communication", "neutral"],
  ["planning", "16:09", 34, "Notes", "workspace", "focus"],
  ["shopping-tab", "16:43", 8, "Shop", "shopping", "drift"],
  ["wrap-up", "16:51", 30, "Code Editor", "workspace", "focus"],
];

function minuteOfDay(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

function clockMinuteMs(day: string, clockMinute: number): number {
  return logicalDayStartMs(day, ENTRY_DEMO_START_OF_DAY_MINUTES)
    + (clockMinute - ENTRY_DEMO_START_OF_DAY_MINUTES) * 60_000;
}

/** The sample day's segments on `day`, in local time, classified as the blueprint says. */
export function buildEntryDemoSegments(day: string): ActivitySegment[] {
  return ENTRY_DEMO_DAY.map(([slug, start, minutes, appName, category, productivity], index) => {
    const startedAtMs = clockMinuteMs(day, minuteOfDay(start));
    return {
      id: "entry-demo-" + String(index + 1).padStart(2, "0") + "-" + slug,
      startedAt: formatLocalDateTime(startedAtMs),
      endedAt: formatLocalDateTime(startedAtMs + minutes * 60_000),
      durationSeconds: minutes * 60,
      appName,
      bundleId: null,
      windowTitle: null,
      platform: "macos",
      source: "manual",
      classification: {
        category,
        productivity,
        source: "manual",
        confidence: 1,
        reason: "Synthetic onboarding sample.",
      },
    };
  });
}

/** What the dashboard has recorded by `clockMinute` (minute of the local clock day). */
export function revealEntryDemoSegments(
  segments: readonly ActivitySegment[],
  day: string,
  clockMinute: number,
): ActivitySegment[] {
  const nowMs = clockMinuteMs(day, clockMinute);
  return segments.flatMap((segment) => {
    const startedAtMs = new Date(segment.startedAt).getTime();
    const endedAtMs = Math.min(new Date(segment.endedAt).getTime(), nowMs);
    if (!(endedAtMs > startedAtMs)) return [];
    return [{
      ...segment,
      endedAt: formatLocalDateTime(endedAtMs),
      durationSeconds: Math.round((endedAtMs - startedAtMs) / 1000),
    }];
  });
}

/** The clock minute shown `elapsedMs` into a run of `durationMs`, snapped to whole flow-chart cells. */
export function entryDemoClockMinute(elapsedMs: number, durationMs: number): number {
  const span = ENTRY_DEMO_CLOCK_END_MINUTE - ENTRY_DEMO_CLOCK_START_MINUTE;
  const progress = durationMs > 0 ? Math.min(Math.max(elapsedMs / durationMs, 0), 1) : 1;
  const minute = ENTRY_DEMO_CLOCK_START_MINUTE + span * progress;
  return Math.min(
    ENTRY_DEMO_CLOCK_END_MINUTE,
    Math.floor(minute / ENTRY_DEMO_CLOCK_STEP_MINUTES) * ENTRY_DEMO_CLOCK_STEP_MINUTES,
  );
}
