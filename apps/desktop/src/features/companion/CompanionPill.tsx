import { useCallback, useEffect, useRef, useState } from "react";
import {
  dragNativeCompanion,
  type NativeCompanionTransitionEvent,
} from "./watcherBridge";
import type { WatcherPeekEvent } from "./watcherPeekTypes";
import {
  CompanionPillCollapsedView,
  resolveCollapsedState,
} from "./CompanionPillCollapsed";
import {
  buildMilestoneSparks,
  CompanionPillMoment,
  type CompanionPillDismissReason,
  type CompanionPillMomentEvent,
} from "./CompanionPillMoment";
import type { DriftAlarmAction } from "./driftAlarmEvent";
import type { CompanionHorizontalAnchor, CompanionPillState } from "./companionPillLayout";

/**
 * The resident companion pill.
 *
 * Unlike the watcher card, which appears for a moment and leaves, the pill is
 * always on screen. Its useful measure and controls stay visible without a
 * hover mode; it only grows when the tracker raises a real moment.
 */

export type CompanionPillProps = {
  peekEvent: WatcherPeekEvent | null;
  momentEvent: CompanionPillMomentEvent | null;
  anchor?: CompanionHorizontalAnchor;
  nativeTransition?: NativeCompanionTransitionEvent | null;
  usesNativeTransitionPhases?: boolean;
  presentsMomentImmediately?: boolean;
  directEntryAnimationReady?: boolean;
  menuAnchorX?: number | null;
  isPointerInside?: boolean;
  isTrackingPaused?: boolean;
  onDismissMoment: (reason: CompanionPillDismissReason) => void;
  onOpenDashboard: () => void;
  onOpenDayReviewAiSettings?: () => void;
  onOpenReentry?: (event: Extract<CompanionPillMomentEvent, { kind: "reentry" }>) => void;
  onOpenMilestoneDestination?: (destination: "leaderboard" | "insights" | "dashboard") => void;
  onOpenSettings: () => void;
  onOpenMenu?: () => Promise<unknown> | unknown;
  onToggleTracking?: () => void;
  onMomentAction?: (action: DriftAlarmAction) => void;
  onStateChange?: (state: CompanionPillState) => void;
};

/* The native AppKit frame runs for 280ms. Content changes around the safe
   portion of that symmetric geometry transition instead of competing with its
   first frames:

   - resident controls leave promptly, before the capsule can stretch them;
   - the incoming card waits until the capsule is wide enough to reveal it;
   - resident controls return only once their resting width fits again;
   - the outgoing card stays mounted until the native frame has settled.

   Content only fades. Native code owns the window rectangle; at a right edge,
   the capsule width follows the same 280ms curve inside that rectangle so the
   rendered boundary and WindowServer cannot drift into separate frames. */
const MOMENT_ENTER_DELAY_MS = 180;
const COLLAPSED_RETURN_DELAY_MS = 40;
const MOMENT_EXIT_MS = 300;
/* A resident card folds back into the always-on capsule, so only its content
   needs to clear before AppKit begins the geometry transition. A menu-bar/off
   alert has no resident destination and therefore plays the complete inverse
   of its 340ms entrance before the native panel is hidden. */
const RESIDENT_MOMENT_VISUAL_EXIT_MS = 160;
const DIRECT_MOMENT_VISUAL_EXIT_MS = 340;
const CARD_DRAG_THRESHOLD_PX = 4;

type PendingCardDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  surface: HTMLDivElement;
};

function resolvePillState(
  momentEvent: CompanionPillMomentEvent | null,
): CompanionPillState {
  if (momentEvent) {
    if (momentEvent.kind === "endOfDayReview") {
      if (momentEvent.assessment?.state === "pending") return "eodPending";
      if (momentEvent.layout === "full") return "eod";
      return momentEvent.layout === "compact" ? "eodCompact" : "eodMinimal";
    }
    if (momentEvent.kind === "extremeNudgeToast") return "nudge";
    if (momentEvent.kind === "milestone") return "milestone";
    if (momentEvent.kind === "reentry") return "reentry";
    return "drift";
  }
  return "collapsed";
}

export function CompanionPill({
  peekEvent,
  momentEvent,
  anchor = "center",
  nativeTransition = null,
  usesNativeTransitionPhases = false,
  presentsMomentImmediately = false,
  directEntryAnimationReady = true,
  menuAnchorX = null,
  isPointerInside = false,
  isTrackingPaused = false,
  onDismissMoment,
  onOpenDashboard,
  onOpenDayReviewAiSettings,
  onOpenReentry,
  onOpenMilestoneDestination,
  onOpenSettings,
  onOpenMenu,
  onToggleTracking,
  onMomentAction,
  onStateChange,
}: CompanionPillProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [presentMomentEvent, setPresentMomentEvent] =
    useState<CompanionPillMomentEvent | null>(momentEvent);
  const [isMomentPainted, setIsMomentPainted] = useState(false);
  const [isCollapsedPainted, setIsCollapsedPainted] = useState(momentEvent === null);
  const [isMomentExiting, setIsMomentExiting] = useState(false);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const momentExitTimerRef = useRef<number | null>(null);
  const momentEnterTimerRef = useRef<number | null>(null);
  const collapsedReturnTimerRef = useRef<number | null>(null);
  const pendingCardDragRef = useRef<PendingCardDrag | null>(null);
  const activeNativeDragRef = useRef(false);
  const suppressNextCardClickRef = useRef(false);
  const suppressClickResetTimerRef = useRef<number | null>(null);
  const momentVisualExitTimerRef = useRef<number | null>(null);
  const exitingMomentKeyRef = useRef<string | null>(null);
  const activeMomentKey = momentEvent ? companionMomentKey(momentEvent) : null;

  useEffect(() => {
    if (momentExitTimerRef.current !== null) {
      window.clearTimeout(momentExitTimerRef.current);
      momentExitTimerRef.current = null;
    }
    if (collapsedReturnTimerRef.current !== null) {
      window.clearTimeout(collapsedReturnTimerRef.current);
      collapsedReturnTimerRef.current = null;
    }

    if (momentEvent) {
      const nextKey = companionMomentKey(momentEvent);
      if (exitingMomentKeyRef.current && exitingMomentKeyRef.current !== nextKey) {
        if (momentVisualExitTimerRef.current !== null) {
          window.clearTimeout(momentVisualExitTimerRef.current);
          momentVisualExitTimerRef.current = null;
        }
        exitingMomentKeyRef.current = null;
        setIsMomentExiting(false);
      }
      setPresentMomentEvent(momentEvent);
      return undefined;
    }
    if (!presentMomentEvent) {
      setIsCollapsedPainted(true);
      return undefined;
    }

    const nativeClosingStarted = nativeTransition?.state === "collapsed"
      && nativeTransition.phase === "started";
    const nativeClosingCompleted = nativeTransition?.state === "collapsed"
      && nativeTransition.phase === "completed";
    if (usesNativeTransitionPhases && nativeClosingCompleted) {
      setIsMomentPainted(false);
      setIsCollapsedPainted(true);
      setPresentMomentEvent(null);
      setIsMomentExiting(false);
      exitingMomentKeyRef.current = null;
      return undefined;
    }
    if (usesNativeTransitionPhases && !nativeClosingStarted) return undefined;

    const reducedMotion = prefersReducedCompanionMotion();
    setIsMomentPainted(false);
    if (reducedMotion) {
      setIsCollapsedPainted(true);
      setPresentMomentEvent(null);
      return undefined;
    }

    collapsedReturnTimerRef.current = window.setTimeout(() => {
      collapsedReturnTimerRef.current = null;
      setIsCollapsedPainted(true);
    }, COLLAPSED_RETURN_DELAY_MS);

    momentExitTimerRef.current = window.setTimeout(() => {
      momentExitTimerRef.current = null;
      setPresentMomentEvent(null);
      setIsMomentExiting(false);
      exitingMomentKeyRef.current = null;
    }, MOMENT_EXIT_MS);
    return () => {
      if (momentExitTimerRef.current !== null) {
        window.clearTimeout(momentExitTimerRef.current);
        momentExitTimerRef.current = null;
      }
      if (collapsedReturnTimerRef.current !== null) {
        window.clearTimeout(collapsedReturnTimerRef.current);
        collapsedReturnTimerRef.current = null;
      }
    };
  }, [momentEvent, nativeTransition, presentMomentEvent, usesNativeTransitionPhases]);

  useEffect(() => {
    if (momentEnterTimerRef.current !== null) {
      window.clearTimeout(momentEnterTimerRef.current);
      momentEnterTimerRef.current = null;
    }
    if (!momentEvent) {
      if (!usesNativeTransitionPhases) setIsMomentPainted(false);
      return undefined;
    }
    const targetState = resolvePillState(momentEvent);
    const nativeOpeningStarted = nativeTransition?.state === targetState
      && nativeTransition.phase === "started";
    const nativeOpeningCompleted = nativeTransition?.state === targetState
      && nativeTransition.phase === "completed";
    if (usesNativeTransitionPhases && nativeOpeningCompleted) {
      setIsMomentPainted(true);
      setIsCollapsedPainted(false);
      return undefined;
    }
    if (usesNativeTransitionPhases && !nativeOpeningStarted) return undefined;
    setIsMomentPainted(false);
    if (prefersReducedCompanionMotion()) {
      setIsMomentPainted(true);
      setIsCollapsedPainted(false);
      return undefined;
    }
    momentEnterTimerRef.current = window.setTimeout(() => {
      momentEnterTimerRef.current = null;
      setIsMomentPainted(true);
      setIsCollapsedPainted(false);
    }, MOMENT_ENTER_DELAY_MS);
    return () => {
      if (momentEnterTimerRef.current !== null) {
        window.clearTimeout(momentEnterTimerRef.current);
        momentEnterTimerRef.current = null;
      }
    };
  }, [activeMomentKey, nativeTransition, usesNativeTransitionPhases]);

  useEffect(() => () => {
    if (momentEnterTimerRef.current !== null) {
      window.clearTimeout(momentEnterTimerRef.current);
    }
    if (collapsedReturnTimerRef.current !== null) {
      window.clearTimeout(collapsedReturnTimerRef.current);
    }
    if (suppressClickResetTimerRef.current !== null) {
      window.clearTimeout(suppressClickResetTimerRef.current);
    }
    if (momentVisualExitTimerRef.current !== null) {
      window.clearTimeout(momentVisualExitTimerRef.current);
    }
  }, []);

  const renderedMomentEvent = momentEvent ?? presentMomentEvent;
  const renderedMomentState = renderedMomentEvent
    ? resolvePillState(renderedMomentEvent)
    : undefined;
  /* The live event still starts the native frame immediately. Content gets a
     short staged entrance/exit inside that frame, so no resident controls are
     visibly dragged through the changing viewport. */
  const state = resolvePillState(momentEvent);
  const visualState = state === "eodPending" || state === "eodCompact" || state === "eodMinimal" ? "eod" : state;
  const isClosingMoment = momentEvent === null && presentMomentEvent !== null;
  const nativeOpeningCompleted = momentEvent !== null
    && (presentsMomentImmediately
      || (nativeTransition?.state === state
        && nativeTransition.phase === "completed"));
  const transitionPhase = isClosingMoment
    ? "closing"
    : momentEvent && (usesNativeTransitionPhases
      ? !nativeOpeningCompleted
      : !isMomentPainted)
      ? "opening"
      : undefined;
  const isCollapsedActive = (state === "collapsed"
      && (!presentMomentEvent || isCollapsedPainted))
    || (transitionPhase === "opening" && isCollapsedPainted);
  const isMomentActive = (isMomentPainted || presentsMomentImmediately)
    && (momentEvent !== null || isClosingMoment);
  const mood = peekEvent?.productivity ?? "neutral";
  const collapsedState = resolveCollapsedState(peekEvent, isTrackingPaused);
  const tier = renderedMomentEvent?.kind === "milestone" ? renderedMomentEvent.tier : undefined;
  const milestoneKind = renderedMomentEvent?.kind === "milestone"
    ? renderedMomentEvent.milestoneKind
    : undefined;

  const finishMomentAfterVisualExit = useCallback((finish: () => void) => {
    if (!renderedMomentEvent || prefersReducedCompanionMotion()) {
      finish();
      return;
    }
    if (momentVisualExitTimerRef.current !== null) return;
    exitingMomentKeyRef.current = companionMomentKey(renderedMomentEvent);
    setIsMomentExiting(true);
    momentVisualExitTimerRef.current = window.setTimeout(() => {
      momentVisualExitTimerRef.current = null;
      finish();
    }, presentsMomentImmediately
      ? DIRECT_MOMENT_VISUAL_EXIT_MS
      : RESIDENT_MOMENT_VISUAL_EXIT_MS);
  }, [presentsMomentImmediately, renderedMomentEvent]);

  const handleDismissMoment = useCallback((reason: CompanionPillDismissReason) => {
    finishMomentAfterVisualExit(() => onDismissMoment(reason));
  }, [finishMomentAfterVisualExit, onDismissMoment]);

  const handleOpenMomentDashboard = useCallback(() => {
    finishMomentAfterVisualExit(onOpenDashboard);
  }, [finishMomentAfterVisualExit, onOpenDashboard]);

  const handleOpenReentry = useCallback((event: Extract<CompanionPillMomentEvent, { kind: "reentry" }>) => {
    if (!onOpenReentry) return;
    finishMomentAfterVisualExit(() => onOpenReentry(event));
  }, [finishMomentAfterVisualExit, onOpenReentry]);

  const handleOpenMomentDestination = useCallback((destination: "leaderboard" | "insights" | "dashboard") => {
    if (!onOpenMilestoneDestination) return;
    finishMomentAfterVisualExit(() => onOpenMilestoneDestination(destination));
  }, [finishMomentAfterVisualExit, onOpenMilestoneDestination]);

  const handleMomentAction = useCallback((action: DriftAlarmAction) => {
    if (!onMomentAction) return;
    /* Not a drift changes the current card into a save/result state. Let the
       action through without playing the ordinary card-exit animation first. */
    if (action.type === "manual_correction") {
      onMomentAction(action);
      return;
    }
    finishMomentAfterVisualExit(() => onMomentAction(action));
  }, [finishMomentAfterVisualExit, onMomentAction]);

  const startNativeDrag = useCallback((
    dragSurface: HTMLDivElement,
    startClientX: number,
    startClientY: number,
  ) => {
    if (activeNativeDragRef.current) return;
    activeNativeDragRef.current = true;
    setIsDragging(true);
    dragSurface.classList.add("is-dragging");
    void dragNativeCompanion(startClientX, startClientY).catch(() => undefined).finally(() => {
      dragSurface.classList.remove("is-dragging");
      activeNativeDragRef.current = false;
      setIsDragging(false);
      if (!suppressNextCardClickRef.current) return;
      suppressClickResetTimerRef.current = window.setTimeout(() => {
        suppressClickResetTimerRef.current = null;
        suppressNextCardClickRef.current = false;
      }, 150);
    });
  }, []);

  const releasePendingCardDrag = useCallback((surface: HTMLDivElement, pointerId: number) => {
    pendingCardDragRef.current = null;
    if (typeof surface.hasPointerCapture !== "function"
      || typeof surface.releasePointerCapture !== "function"
      || !surface.hasPointerCapture(pointerId)) return;
    surface.releasePointerCapture(pointerId);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || activeNativeDragRef.current) return;
    /* Every state is draggable from its quiet background, cards included: a
       drift alarm or the day review can land over whatever you were reading,
       and with no title bar there was no way to move it aside.

       Controls keep priority. The one exception is the milestone's full-card
       destination hit area: it waits for a short movement threshold, becoming
       a drag only when the gesture is clearly not a click. */
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest("button");
    const cardDragSurface = control?.hasAttribute("data-companion-drag-surface") === true;
    if (control && !cardDragSurface) return;

    if (cardDragSurface) {
      pendingCardDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        surface: event.currentTarget,
      };
      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }

    event.preventDefault();
    /* AppKit owns the gesture from the original mouse-down until release. Its
       native drag loop keeps the grabbed point attached without WebKit IPC or
       frame-by-frame React work. */
    startNativeDrag(event.currentTarget, event.clientX, event.clientY);
  }, [startNativeDrag]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pending = pendingCardDragRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - pending.startClientX,
      event.clientY - pending.startClientY,
    );
    if (distance < CARD_DRAG_THRESHOLD_PX) return;

    event.preventDefault();
    suppressNextCardClickRef.current = true;
    releasePendingCardDrag(pending.surface, pending.pointerId);
    startNativeDrag(pending.surface, pending.startClientX, pending.startClientY);
  }, [releasePendingCardDrag, startNativeDrag]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pending = pendingCardDragRef.current;
    if (!pending || pending.pointerId !== event.pointerId) return;
    releasePendingCardDrag(pending.surface, pending.pointerId);
  }, [releasePendingCardDrag]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressNextCardClickRef.current) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-companion-drag-surface]")) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextCardClickRef.current = false;
  }, []);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state, activeMomentKey]);

  return (
    <div
      ref={pillRef}
      className={`pill${isDragging ? " is-dragging" : ""}`}
      data-state={visualState}
      data-transition={transitionPhase}
      data-anchor={anchor}
      data-card-state={renderedMomentState}
      data-eod-layout={renderedMomentEvent?.kind === "endOfDayReview"
        ? (renderedMomentEvent.layout === "full" ? "full" : "compact")
        : undefined}
      data-eod-version={renderedMomentEvent?.kind === "endOfDayReview"
        ? (renderedMomentEvent.layout ?? "minimal")
        : undefined}
      data-eod-assessment={renderedMomentEvent?.kind === "endOfDayReview"
        ? renderedMomentEvent.assessment?.state
        : undefined}
      data-mood={mood}
      data-collapsed-kind={collapsedState.kind}
      data-tier={tier ? String(tier) : undefined}
      data-mile-kind={milestoneKind}
      data-tracking={isTrackingPaused ? "paused" : undefined}
      data-moment-exiting={isMomentExiting ? "true" : undefined}
      data-direct-entry={presentsMomentImmediately
        ? (directEntryAnimationReady ? "true" : "pending")
        : undefined}
      style={presentsMomentImmediately && menuAnchorX !== null
        ? ({ "--menu-anchor-x": `${menuAnchorX}px` } as React.CSSProperties)
        : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={handleClickCapture}
    >
      <div className="pill__clip">
        <CompanionPillCollapsedView
          state={collapsedState}
          isActive={isCollapsedActive}
          isTrackingPaused={isTrackingPaused}
          onToggleTracking={onToggleTracking ?? (() => undefined)}
          onOpenMenu={onOpenMenu ?? (() => undefined)}
        />
        {renderedMomentEvent ? (
          <CompanionPillMoment
            key={companionMomentKey(renderedMomentEvent)}
            event={renderedMomentEvent}
            isActive={isMomentActive}
            autoDismissEnabled={!presentsMomentImmediately || directEntryAnimationReady}
            isPointerInside={isPointerInside}
            isDragging={isDragging}
            onDismiss={handleDismissMoment}
            onOpenDashboard={handleOpenMomentDashboard}
            onOpenAiSettings={onOpenDayReviewAiSettings}
            onOpenReentry={handleOpenReentry}
            onOpenDestination={handleOpenMomentDestination}
            onAction={handleMomentAction}
          />
        ) : null}
      </div>
      {/* Confetti sits outside `.pill__clip` so it can fly past the capsule's
          rounded edge, exactly as the prototype lays it out. The surrounding
          panel grows by a transparent gutter for the milestone state so the
          burst has somewhere to land. */}
      {renderedMomentEvent?.kind === "milestone" && isMomentActive ? (
        <span className="sparks" aria-hidden="true">
          {buildMilestoneSparks(renderedMomentEvent.tier, renderedMomentEvent.id).map(
            (style, index) => <i key={index} style={style} />,
          )}
        </span>
      ) : null}
    </div>
  );
}

function prefersReducedCompanionMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function companionMomentKey(event: CompanionPillMomentEvent): string {
  if (event.kind === "endOfDayReview") return `${event.kind}:${event.generatedAt}`;
  return `${event.kind}:${event.id}`;
}
