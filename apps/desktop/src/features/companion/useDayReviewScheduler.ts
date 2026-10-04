import { useCallback, useEffect, useRef } from "react";
import type { ActivitySegment } from "@drifty/domain";
import { isQuietHoursActiveAt, type QuietHoursSettings } from "./quietHours";
import { isInstallDayReviewEligible } from "../onboarding/initialExperiencePolicy";
import { sumEndOfDayReviewTrackedSeconds } from "./endOfDayReviewData";
import {
  DAY_REVIEW_TICK_INTERVAL_MS,
  acknowledgeDayReview,
  appendDayReviewDecision,
  closeDayReview,
  dayReviewLogicalDay,
  readDayReviewRecord,
  recordDayReviewUnseen,
  recordDayReviewPresentation,
  resolveDayReviewDecision,
  resolveDayReviewWindow,
  revertDayReviewPresentation,
  type DayReviewDecision,
  type DayReviewDecisionInput,
} from "./dayReviewScheduler";

/**
 * What became of a card handed to the presentation layer.
 *
 * - `displayed`: the surface rendered it in a window the user can see right
 *   now (the browser fallback), so the day is acknowledged immediately.
 * - `delivered`: the native layer accepted it; the Companion reports the real
 *   display later and the record waits for that report.
 * - `dropped_*`: the native layer discarded it. A disabled surface closes
 *   the day; an expired payload leaves it pending inside the bounded
 *   presentation allowance.
 */
export type DayReviewDeliveryResult =
  | "displayed"
  | "delivered"
  | "dropped_expired"
  | "dropped_surface_disabled"
  | "failed";

export type DayReviewPresentationRequest = {
  readonly day: string;
  readonly segments: ActivitySegment[];
  readonly expiresAt: string;
};

export type UseDayReviewSchedulerOptions = {
  /** The scheduler runs only while the app is in a state to review (loaded, tracker running, not blocked). */
  readonly active: boolean;
  readonly previewSurface: boolean;
  readonly dayReviewEnabled: boolean;
  readonly reviewMinute: number;
  readonly startOfDayMinutes: number;
  readonly quietHours: QuietHoursSettings;
  readonly onboardingCompletedAt: string | null;
  readonly loadDaySegments: (day: string) => Promise<ActivitySegment[]>;
  readonly readUserActive: () => Promise<boolean>;
  readonly present: (request: DayReviewPresentationRequest) => Promise<DayReviewDeliveryResult>;
  readonly now?: () => Date;
};

export type DayReviewSchedulerHandle = {
  readonly evaluateNow: () => Promise<void>;
  readonly acknowledge: (day: string) => void;
  readonly reportUnseen: (day: string) => void;
};

/**
 * One scheduler, one clock. The tick runs once a minute and on every return
 * to the window (visibility, focus), and it reads every input through a ref so
 * the interval never sees stale settings. It does not depend on which tab or
 * day the dashboard is showing: the previous design evaluated the review only
 * while the dashboard rendered "today", so a user on another tab, or on a
 * Week view across the 4 AM rollover, received the card hours late or never.
 */
export function useDayReviewScheduler(options: UseDayReviewSchedulerOptions): DayReviewSchedulerHandle {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const inFlightRef = useRef(false);

  const evaluateNow = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.active || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await evaluateDayReview(current, () => optionsRef.current);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const acknowledge = useCallback((day: string) => {
    acknowledgeDayReview(day, (optionsRef.current.now ?? defaultNow)().toISOString());
  }, []);

  const reportUnseen = useCallback((day: string) => {
    recordDayReviewUnseen(day);
    void evaluateNow();
  }, [evaluateNow]);

  const { active, dayReviewEnabled, reviewMinute, startOfDayMinutes } = options;
  useEffect(() => {
    if (!active) return undefined;
    void evaluateNow();
    const intervalId = window.setInterval(() => {
      void evaluateNow();
    }, DAY_REVIEW_TICK_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void evaluateNow();
    };
    const handleFocus = () => {
      void evaluateNow();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
    /* Settings that move the window re-run the evaluation at once, so a review
       time moved into the past delivers immediately instead of on the next tick. */
  }, [active, dayReviewEnabled, evaluateNow, reviewMinute, startOfDayMinutes]);

  return { evaluateNow, acknowledge, reportUnseen };
}

function defaultNow(): Date {
  return new Date();
}

async function evaluateDayReview(
  options: UseDayReviewSchedulerOptions,
  latestOptions: () => UseDayReviewSchedulerOptions,
): Promise<void> {
  const now = (options.now ?? defaultNow)();
  const day = dayReviewLogicalDay(now, options.startOfDayMinutes);
  const baseInput: Omit<DayReviewDecisionInput, "trackedSeconds" | "userActive"> = {
    nowMs: now.getTime(),
    day,
    reviewMinute: options.reviewMinute,
    startOfDayMinutes: options.startOfDayMinutes,
    enabled: options.dayReviewEnabled,
    previewSurface: options.previewSurface,
    installDayEligible: isInstallDayReviewEligible(options.onboardingCompletedAt, day, options.startOfDayMinutes),
    quietHoursActive: isQuietHoursActiveAt(now, options.quietHours),
    record: readDayReviewRecord(day),
  };

  /* Cheap gates first; the idle probe and the timeline read happen only when
     the decision can still become "present". */
  let decision = resolveDayReviewDecision({ ...baseInput, userActive: true, trackedSeconds: null });
  let segments: ActivitySegment[] | null = null;
  let trackedSeconds: number | null = null;
  const needsUserProbe = decision.action === "present"
    || (decision.action === "wait" && decision.reason === "tracked_unknown");
  if (needsUserProbe) {
    const userActive = await options.readUserActive();
    decision = resolveDayReviewDecision({ ...baseInput, userActive, trackedSeconds: null });
    if (decision.action === "wait" && decision.reason === "tracked_unknown") {
      try {
        segments = await options.loadDaySegments(day);
        trackedSeconds = sumEndOfDayReviewTrackedSeconds(segments);
      } catch {
        segments = null;
        trackedSeconds = null;
      }
      decision = resolveDayReviewDecision({ ...baseInput, userActive, trackedSeconds });
    }
  }

  await applyDayReviewDecision(decision, { day, now, options, latestOptions, trackedSeconds, segments });
}

async function applyDayReviewDecision(
  decision: DayReviewDecision,
  context: {
    readonly day: string;
    readonly now: Date;
    readonly options: UseDayReviewSchedulerOptions;
    readonly latestOptions: () => UseDayReviewSchedulerOptions;
    readonly trackedSeconds: number | null;
    readonly segments: ActivitySegment[] | null;
  },
): Promise<void> {
  const { day, now, options, trackedSeconds } = context;
  appendDayReviewDecision({
    at: now.toISOString(),
    day,
    action: decision.action,
    reason: decision.reason,
    trackedSeconds,
  });
  if (decision.action === "close") {
    closeDayReview(day, decision.reason);
    return;
  }
  if (decision.action !== "present") return;

  /* Mark the attempt before handing the card over so a tick that lands during
     the asynchronous build cannot queue a second card for the same day. */
  recordDayReviewPresentation(day, now.toISOString());
  let segments = context.segments;
  if (segments === null) {
    try {
      segments = await options.loadDaySegments(day);
    } catch {
      revertDayReviewPresentation(day);
      return;
    }
  }
  /* The build is asynchronous. Re-read the live settings at the commit
     boundary so a review switched off, a moved day boundary, or a window
     that closed meanwhile cannot hand a stale card to the surface. */
  const latest = context.latestOptions();
  const window = resolveDayReviewWindow(day, latest.reviewMinute, latest.startOfDayMinutes);
  const commitNow = (latest.now ?? defaultNow)();
  if (!latest.active
    || !latest.dayReviewEnabled
    || latest.startOfDayMinutes !== options.startOfDayMinutes
    || dayReviewLogicalDay(commitNow, latest.startOfDayMinutes) !== day
    || commitNow.getTime() >= window.endMs) {
    revertDayReviewPresentation(day);
    return;
  }
  let result: DayReviewDeliveryResult;
  try {
    result = await options.present({ day, segments, expiresAt: new Date(window.endMs).toISOString() });
  } catch {
    result = "failed";
  }
  switch (result) {
    case "displayed":
      acknowledgeDayReview(day, (options.now ?? defaultNow)().toISOString());
      return;
    case "delivered":
      return;
    case "dropped_surface_disabled":
      closeDayReview(day, "surface_disabled");
      return;
    case "dropped_expired":
    case "failed":
      revertDayReviewPresentation(day);
      return;
    default:
      return;
  }
}



