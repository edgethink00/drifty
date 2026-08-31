import { useCallback, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from "react";
import { BreakDurationPicker } from "./BreakDurationPicker";
import { FlagIcon } from "./DriftAlarmIcons";
import {
  DRIFT_ALARM_CORRECTION_FEEDBACK_COPY,
  DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS,
  type DriftAlarmAction,
  type DriftAlarmCorrectionStatus,
} from "./driftAlarmEvent";
import { EXTREME_NUDGE_TOAST_VISIBLE_MS } from "./extremeNudgeTiming";
import { useDelayedDriftAlarmAction } from "./useDelayedDriftAlarmAction";
import { isNativeWatcherCursorInside } from "./watcherBridge";
import { PillFeedbackCheckIcon } from "./CompanionPillIcons";

export type ExtremeNudgeToastEvent = {
  kind: "extremeNudgeToast";
  placement: "top-right";
  id: string;
  generatedAt: string;
  title: string;
  closedLabel: string;
  focusLabel: string | null;
  breakOptions?: readonly number[];
  correctionStatus?: DriftAlarmCorrectionStatus;
};

type ToastPhase = "visible" | "leaving";

const EXTREME_NUDGE_TOAST_EXIT_MS = 280;
const EXTREME_NUDGE_HOVER_WATCHDOG_MS = 250;

export function ExtremeNudgeToast({
  event,
  onDismiss,
  onAction,
  isPreview = false,
}: {
  event: ExtremeNudgeToastEvent;
  onDismiss?: () => void;
  onAction?: (action: DriftAlarmAction) => void;
  isPreview?: boolean;
}) {
  const [phase, setPhase] = useState<ToastPhase>("visible");
  const [selectedBreakMinutes, setSelectedBreakMinutes] = useState<number | null>(null);
  const [isFocusHoldingTimer, setIsFocusHoldingTimer] = useState(false);
  const [isHoverHoldingTimer, setIsHoverHoldingTimer] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);
  const isPointerOriginFocusRef = useRef(false);
  const remainingVisibleMsRef = useRef(EXTREME_NUDGE_TOAST_VISIBLE_MS);
  const toastRef = useRef<HTMLElement | null>(null);
  const visibleTimerRef = useRef<number | null>(null);
  const visibleTimerStartedAtMsRef = useRef<number | null>(null);
  const breakOptions = event.breakOptions ?? [];
  const visibleDurationMs = correctionVisibleDurationMs(event.correctionStatus);
  const feedbackCopy = correctionFeedbackCopy(event.correctionStatus);
  /* The result state has no decision left to protect. Keep its promised short
     dwell even if the pointer remains where the Not a drift button was. */
  const isTimerPaused = event.correctionStatus === undefined
    && (isFocusHoldingTimer || isHoverHoldingTimer);
  const handleAction = useCallback((action: DriftAlarmAction) => {
    onAction?.(action);
  }, [onAction]);
  const { clearPendingDriftAlarmAction, isBreakActionPending, runDriftAlarmAction } = useDelayedDriftAlarmAction(handleAction, isPreview || !onAction);

  const clearToastTimers = useCallback(() => {
    if (visibleTimerRef.current !== null) {
      window.clearTimeout(visibleTimerRef.current);
      visibleTimerRef.current = null;
    }
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    visibleTimerStartedAtMsRef.current = null;
  }, []);

  const pauseVisibleTimer = useCallback(() => {
    if (visibleTimerRef.current !== null) {
      window.clearTimeout(visibleTimerRef.current);
      visibleTimerRef.current = null;
    }
    if (visibleTimerStartedAtMsRef.current !== null) {
      const elapsedMs = Date.now() - visibleTimerStartedAtMsRef.current;
      remainingVisibleMsRef.current = Math.max(0, remainingVisibleMsRef.current - elapsedMs);
      visibleTimerStartedAtMsRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearToastTimers();
    remainingVisibleMsRef.current = visibleDurationMs;
    setPhase("visible");
    setSelectedBreakMinutes(null);
    setIsFocusHoldingTimer(false);
    setIsHoverHoldingTimer(false);
    isPointerOriginFocusRef.current = false;
    clearPendingDriftAlarmAction();
    return clearToastTimers;
  }, [clearPendingDriftAlarmAction, clearToastTimers, event.id, event.correctionStatus, visibleDurationMs]);

  useEffect(() => {
    if (isPreview || phase !== "visible" || isTimerPaused) {
      pauseVisibleTimer();
      return undefined;
    }

    visibleTimerStartedAtMsRef.current = Date.now();
    visibleTimerRef.current = window.setTimeout(() => {
      remainingVisibleMsRef.current = 0;
      visibleTimerRef.current = null;
      visibleTimerStartedAtMsRef.current = null;
      setPhase("leaving");
      dismissTimerRef.current = window.setTimeout(() => onDismiss?.(), EXTREME_NUDGE_TOAST_EXIT_MS);
    }, remainingVisibleMsRef.current);

    return pauseVisibleTimer;
  }, [isPreview, isTimerPaused, onDismiss, pauseVisibleTimer, phase, visibleDurationMs]);

  const selectBreakMinutes = (minutes: number) => {
    setSelectedBreakMinutes(minutes);
    runDriftAlarmAction({ type: "start_break", minutes });
  };

  const markAsNotDrift = () => {
    runDriftAlarmAction({ type: "manual_correction" });
  };

  const pauseHoverTimer = useCallback(() => {
    setIsHoverHoldingTimer(true);
  }, []);

  const resumeHoverTimer = useCallback(() => {
    setIsHoverHoldingTimer(false);
  }, []);

  useEffect(() => {
    const toast = toastRef.current;
    if (!isHoverHoldingTimer || phase !== "visible" || isPreview || !toast) return undefined;

    let disposed = false;
    const watchdog = window.setInterval(() => {
      void isNativeWatcherCursorInside().then((isCursorInside) => {
        if (disposed) return;
        if (isCursorInside === true) return;
        if (isCursorInside === false) {
          resumeHoverTimer();
          return;
        }
        if (isElementHovered(toast)) return;
        resumeHoverTimer();
      });
    }, EXTREME_NUDGE_HOVER_WATCHDOG_MS);

    return () => {
      disposed = true;
      window.clearInterval(watchdog);
    };
  }, [isHoverHoldingTimer, isPreview, phase, resumeHoverTimer, event.id]);

  const markPointerOriginFocus = useCallback(() => {
    isPointerOriginFocusRef.current = true;
  }, []);

  const handleFocus = () => {
    if (isPointerOriginFocusRef.current) return;
    setIsFocusHoldingTimer(true);
  };

  const handleBlur = (focusEvent: FocusEvent<HTMLElement>) => {
    const nextTarget = focusEvent.relatedTarget;
    if (nextTarget instanceof Node && focusEvent.currentTarget.contains(nextTarget)) return;
    isPointerOriginFocusRef.current = false;
    setIsFocusHoldingTimer(false);
  };

  const handleKeyDownCapture = (keyboardEvent: KeyboardEvent<HTMLElement>) => {
    if (keyboardEvent.key === "Tab") isPointerOriginFocusRef.current = false;
  };

  return (
    <aside
      ref={toastRef}
      className="extreme-nudge-toast"
      data-phase={phase}
      data-correction-state={event.correctionStatus}
      data-timer-paused={isTimerPaused ? "true" : undefined}
      style={{ "--extreme-toast-visible-duration": `${visibleDurationMs}ms` } as CSSProperties}
      role={isPreview ? "group" : "status"}
      aria-live={isPreview ? undefined : "polite"}
      aria-atomic={isPreview ? undefined : "true"}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onKeyDownCapture={handleKeyDownCapture}
      onMouseDownCapture={markPointerOriginFocus}
      onMouseEnter={pauseHoverTimer}
      onMouseLeave={resumeHoverTimer}
      onPointerDownCapture={markPointerOriginFocus}
      onPointerEnter={pauseHoverTimer}
      onPointerLeave={resumeHoverTimer}
    >
      <div className="extreme-nudge-toast__mark" aria-hidden="true">
        {event.correctionStatus === "acknowledged" ? <PillFeedbackCheckIcon /> : null}
        {!event.correctionStatus ? <ExtremeNudgeScissorsIcon /> : null}
      </div>
      <div className="extreme-nudge-toast__copy">
        {!feedbackCopy ? <p className="extreme-nudge-toast__eyebrow">Automatic close</p> : null}
        <h2>{feedbackCopy?.title ?? event.title}</h2>
        <p>{feedbackCopy?.subtitle ?? (event.focusLabel ? `Focus switched to ${event.focusLabel}` : "Focus target was not available")}</p>
      </div>
      {!event.correctionStatus && onAction ? (
        <div className="extreme-nudge-toast__actions">
          {breakOptions.length > 0 ? (
            <BreakDurationPicker
              isPending={isBreakActionPending}
              label="Take a break"
              options={breakOptions}
              selectedMinutes={selectedBreakMinutes}
              onSelect={selectBreakMinutes}
            />
          ) : null}
          <button className="da__correct" type="button" onClick={markAsNotDrift}>
            <FlagIcon />
            Not a drift
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function correctionVisibleDurationMs(status: DriftAlarmCorrectionStatus | undefined): number {
  if (status === "acknowledged") return DRIFT_ALARM_CORRECTION_FEEDBACK_DURATION_MS;
  return EXTREME_NUDGE_TOAST_VISIBLE_MS;
}

function correctionFeedbackCopy(status: DriftAlarmCorrectionStatus | undefined) {
  if (status === "acknowledged") return DRIFT_ALARM_CORRECTION_FEEDBACK_COPY;
  return null;
}

function ExtremeNudgeScissorsIcon() {
  return (
    <svg className="extreme-nudge-toast__icon" viewBox="0 0 24 24" fill="none" focusable="false">
      <circle cx="6.4" cy="7.2" r="2.25" />
      <circle cx="6.4" cy="16.8" r="2.25" />
      <path d="M8.25 8.45 19 19.2" />
      <path d="M8.25 15.55 19 4.8" />
    </svg>
  );
}

function isElementHovered(element: HTMLElement): boolean {
  try {
    return element.matches(":hover");
  } catch (error: unknown) {
    if (error instanceof Error) return true;
    throw error;
  }
}
