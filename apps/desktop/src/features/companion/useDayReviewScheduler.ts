import { useCallback, useEffect, useRef } from "react";
import type { ActivitySegment } from "@drifty/domain";
import { isQuietHoursActiveAt, type QuietHoursSettings } from "./quietHours";
import { isInstallDayReviewEligible } from "../onboarding/initialExperiencePolicy";
import { sumEndOfDayReviewTrackedSeconds } from "./endOfDayReviewData";
import {
  DAY_REVIEW_TICK_INTERVAL_MS,
  createDayReviewRecord,
  writeDayReviewRecord,
  type DayReviewRecord,
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
  | "cancelled"
  | "failed";

export type DayReviewPresentationRequest = {
  readonly day: string;
  readonly segments: ActivitySegment[];
  readonly expiresAt: string;
  /** Check after preparation, immediately before each native/plugin send. Rechecks share one attempt. */
  readonly commitPresentation: () => boolean;
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
  /** Changes to the underlying history invalidate a review still being prepared. */
  readonly readTimelineRevision: () => number;
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
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const evaluateNow = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.active || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await evaluateDayReview(current, () => mountedRef.current ? optionsRef.current : { ...optionsRef.current, active: false });
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
  const timelineRevision = options.readTimelineRevision();
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
        trackedSeconds = sumEndOfDayReviewTrackedSeconds(segments, day, options.startOfDayMinutes);
      } catch {
        segments = null;
        trackedSeconds = null;
      }
      decision = resolveDayReviewDecision({ ...baseInput, userActive, trackedSeconds });
    }
  }

  await applyDayReviewDecision(decision, { day, now, options, latestOptions, timelineRevision, trackedSeconds, segments });
}

async function applyDayReviewDecision(
  decision: DayReviewDecision,
  context: {
    readonly day: string;
    readonly now: Date;
    readonly options: UseDayReviewSchedulerOptions;
    readonly latestOptions: () => UseDayReviewSchedulerOptions;
    readonly timelineRevision: number;
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

  let segments = context.segments;
  if (segments === null) {
    try {
      segments = await options.loadDaySegments(day);
    } catch {
      return;
    }
  }
  const preparedTrackedSeconds = trackedSeconds ?? sumEndOfDayReviewTrackedSeconds(segments, day, options.startOfDayMinutes);
  const expiresAt = resolveDayReviewWindow(day, options.reviewMinute, options.startOfDayMinutes).endMs;
  let committed = false;
  let previousRecord: DayReviewRecord | null = null;
  let reservation: DayReviewRecord | null = null;
  const ownsReservation = (record: DayReviewRecord | null) => reservation !== null && record?.status === "presented"
    && record.lastPresentedAt === reservation.lastPresentedAt && record.presentations === reservation.presentations
    && !record.expiredUnseen;
  const canPresent = () => {
    const latest = context.latestOptions();
    const commitNow = (latest.now ?? defaultNow)();
    if (!latest.active
      || latest.readTimelineRevision() !== context.timelineRevision
      || latest.startOfDayMinutes !== options.startOfDayMinutes
      || dayReviewLogicalDay(commitNow, latest.startOfDayMinutes) !== day
      || commitNow.getTime() >= expiresAt) return false;
    const record = readDayReviewRecord(day);
    const latestDecision = resolveDayReviewDecision({
      nowMs: commitNow.getTime(), day,
      reviewMinute: latest.reviewMinute,
      startOfDayMinutes: latest.startOfDayMinutes,
      enabled: latest.dayReviewEnabled,
      previewSurface: latest.previewSurface,
      installDayEligible: isInstallDayReviewEligible(latest.onboardingCompletedAt, day, latest.startOfDayMinutes),
      quietHoursActive: isQuietHoursActiveAt(commitNow, latest.quietHours),
      userActive: true,
      trackedSeconds: preparedTrackedSeconds,
      record: committed && ownsReservation(record) ? previousRecord : record,
    });
    if (latestDecision.action === "close") closeDayReview(day, latestDecision.reason);
    return latestDecision.action === "present";
  };
  if (!canPresent()) return;
  let result: DayReviewDeliveryResult;
  try {
    result = await options.present({
      day, segments, expiresAt: new Date(expiresAt).toISOString(),
      commitPresentation: () => {
        if (!canPresent()) return false;
        if (committed) return true;
        // Preparation consumes no delivery allowance. Reserve only at the
        // actual send boundary; the in-flight guard already prevents a second build.
        previousRecord = readDayReviewRecord(day);
        committed = true;
        reservation = recordDayReviewPresentation(day, (context.latestOptions().now ?? defaultNow)().toISOString());
        return true;
      },
    });
  } catch {
    result = "failed";
  }
  if (!committed) return;
  switch (result) {
    case "displayed":
      acknowledgeDayReview(day, (context.latestOptions().now ?? defaultNow)().toISOString());
      return;
    case "delivered":
      return;
    case "dropped_surface_disabled":
      closeDayReview(day, "surface_disabled");
      return;
    case "cancelled":
      // The native path was unavailable and the fallback was cancelled before
      // sending. Restore the allowance only while this request still owns it.
      if (ownsReservation(readDayReviewRecord(day))) writeDayReviewRecord(previousRecord ?? createDayReviewRecord(day));
      return;
    case "dropped_expired":
    case "failed":
      revertDayReviewPresentation(day);
      return;
    default:
      return;
  }
}



