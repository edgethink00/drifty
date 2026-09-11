import type { ActivityCategory, ProductivityLabel } from "@drifty/domain";

export type WatcherFocusSessionKind = "just_started" | "settled" | "deep" | "recovered";
export type WatcherDriftPattern = "first" | "repeated" | "after_snooze" | "long";

export type WatcherPeekEvent = {
  id: number;
  productivity: ProductivityLabel;
  category: ActivityCategory;
  contextLabel: string;
  durationLabel: string;
  durationSeconds: number;
  slotIndex: number;
  focusSessionKind: WatcherFocusSessionKind;
  driftPattern: WatcherDriftPattern;
  driftReminderElapsedSeconds: number | null;
  recentWatcherResponse: WatcherPeekResponse | null;
  minutesSinceLastWatcher: number | null;
  focusSecondsToday: number;
  currentHourFocusSeconds: number;
  /** Continuous Focus classification across app/site switches. */
  focusStrikeSeconds?: number | null;
  preservedFocusStrikeSeconds?: number | null;
  /** Present on the resident surface so pause/resume stays in sync with the app. */
  trackingPaused?: boolean;
};

export type WatcherPeekResponse = "return" | "snooze" | "dismiss";
