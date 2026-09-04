import { useCallback, useEffect, useState } from "react";
import { ExtremeNudgeToast, type ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import {
  buildMilestoneSparks,
  CompanionPillMoment,
  type CompanionPillDismissReason,
  type CompanionPillMilestoneEvent,
} from "./CompanionPillMoment";
import type { CompanionReentryEvent } from "./companionReentry";
import { WatcherPeek, type WatcherPeekEvent, type WatcherPhase } from "./WatcherPeek";
import { isCompanionMomentStale } from "./companionMomentFreshness";
import {
  isInformationalMomentEvent,
  isInformationalMomentSuppressedNow,
  refreshInformationalMomentSuppression,
} from "./informationalMomentSuppression";
import {
  dismissNativeWatcherPeek,
  hideNativeWatcherPeek,
  listenToNativeWatcherShow,
  setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction,
  triggerNativeExtremeNudgeAction,
  type CompanionPillWindowEvent,
} from "./watcherBridge";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";

const WATCHER_THEME_STORAGE_KEY = "drifty.theme";
const WATCHER_DEFAULT_THEME = "light";

export function WatcherWindowApp() {
  const [event, setEvent] = useState<CompanionPillWindowEvent | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(WATCHER_THEME_STORAGE_KEY);
    const theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : WATCHER_DEFAULT_THEME;
    document.documentElement.dataset.surface = "watcher";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    return () => {
      delete document.documentElement.dataset.surface;
    };
  }, []);

  /* Informational moments never pop over a fullscreen app; on this legacy
     surface a suppressed moment is dropped (the main window re-presents a
     due review after its cooldown), while interventions always go through. */
  const handleNativeShow = useCallback((nextEvent: CompanionPillWindowEvent) => {
    /* Day Review belongs exclusively to the current Companion surface. Ignore
       a stale legacy-routed payload instead of reconnecting Summary - Today. */
    if ("kind" in nextEvent && nextEvent.kind === "endOfDayReview") return;
    if (!("kind" in nextEvent) || !isInformationalMomentEvent(nextEvent)) {
      setEvent(nextEvent);
      return;
    }
    /* Never queue what is already stale; it would flash for a frame before
       the surface's own freshness check consumed it. */
    if (isCompanionMomentStale(nextEvent)) return;
    /* Decide on the last known suppression state so the show path stays
       synchronous; the background refresh keeps the next read honest. */
    void refreshInformationalMomentSuppression();
    if (!isInformationalMomentSuppressedNow()) setEvent(nextEvent);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listenToNativeWatcherShow(handleNativeShow).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(ignoreWatcherBridgeRejection);

    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [handleNativeShow]);

  const handleDismiss = useCallback(() => {
    setEvent(null);
    ignoreWatcherBridgePromise(dismissNativeWatcherPeek());
  }, []);

  /* The auto-dismiss budget freezes while macOS sleeps, so without a
     wall-clock expiry a card fired seconds before sleep would greet the user
     the next morning as if it had just happened. Consume stale moments
     silently; producers rebuild them on the next evaluation. */
  useEffect(() => {
    const moment = event && "kind" in event
      ? (event.kind === "companionDriftAlarm" ? event.alarm : event)
      : null;
    if (!moment) return undefined;
    const consumeIfStale = () => {
      if (!isCompanionMomentStale(moment)) return;
      setEvent(null);
      ignoreWatcherBridgePromise(hideNativeWatcherPeek());
    };
    consumeIfStale();
    const interval = window.setInterval(consumeIfStale, 30_000);
    return () => window.clearInterval(interval);
  }, [event]);

  const handleToastDismiss = useCallback(() => {
    setEvent(null);
    ignoreWatcherBridgePromise(hideNativeWatcherPeek());
  }, []);

  const handlePhaseChange = useCallback((_phase: WatcherPhase, _currentEvent: WatcherPeekEvent | null) => {
    ignoreWatcherBridgePromise(setNativeWatcherInteractive(false));
  }, []);

  const handleOpenDashboard = useCallback(() => {
    ignoreWatcherBridgePromise(triggerNativeEndOfDayReviewAction("openDashboard"));
  }, []);

  const handleExtremeNudgeAction = useCallback((action: Parameters<typeof triggerNativeExtremeNudgeAction>[0]) => {
    if (action.type === "manual_correction") {
      setEvent((current) => isExtremeNudgeToast(current)
        ? { ...current, correctionStatus: "acknowledged" }
        : current);
      ignoreWatcherBridgePromise(triggerNativeExtremeNudgeAction(action));
      return;
    }
    setEvent(null);
    ignoreWatcherBridgePromise(triggerNativeExtremeNudgeAction(action));
  }, []);

  const handleMilestoneDismiss = useCallback((_reason: CompanionPillDismissReason) => {
    setEvent(null);
    ignoreWatcherBridgePromise(hideNativeWatcherPeek());
  }, []);

  const handleOpenMilestoneDestination = useCallback((destination: NonNullable<CompanionPillMilestoneEvent["destination"]>) => {
    setEvent(null);
    const action = destination === "leaderboard"
      ? "openLeaderboard"
      : destination === "insights"
        ? "openTrends"
        : "openDashboard";
    ignoreWatcherBridgePromise(triggerNativeEndOfDayReviewAction(action));
  }, []);

  const handleOpenReentry = useCallback((reentry: CompanionReentryEvent) => {
    setEvent(null);
    ignoreWatcherBridgePromise(triggerNativeEndOfDayReviewAction("openActivityDay", reentry.lastActiveAt));
  }, []);

  const isExtremeNudgeToastEvent = isExtremeNudgeToast(event);
  const isMilestone = isMilestoneEvent(event);
  const isReentry = isReentryEvent(event);

  useEffect(() => {
    if (isExtremeNudgeToastEvent || isMilestone || isReentry) {
      ignoreWatcherBridgePromise(setNativeWatcherInteractive(true));
    }
  }, [isExtremeNudgeToastEvent, isMilestone, isReentry]);

  return (
    <main
      className={`watcher-window-surface${isMilestone || isReentry ? " companion-pill-surface" : ""}`}
      data-state={isMilestone ? "milestone" : isReentry ? "reentry" : undefined}
      aria-label="Drifty watcher window"
    >
      {isMilestone ? (
        <StandaloneMilestone
          event={event}
          onDismiss={handleMilestoneDismiss}
          onOpenDashboard={handleOpenDashboard}
          onOpenDestination={handleOpenMilestoneDestination}
        />
      ) : isReentry ? (
        <StandaloneReentry
          event={event}
          onDismiss={handleMilestoneDismiss}
          onOpenDashboard={handleOpenDashboard}
          onOpenReentry={handleOpenReentry}
        />
      ) : isExtremeNudgeToastEvent ? (
        <ExtremeNudgeToast event={event} onAction={handleExtremeNudgeAction} onDismiss={handleToastDismiss} />
      ) : (
        <WatcherPeek
          event={isWatcherPeekEvent(event) ? event : null}
          onDismiss={handleDismiss}
          onPhaseChange={handlePhaseChange}
        />
      )}
    </main>
  );
}

function isExtremeNudgeToast(event: CompanionPillWindowEvent | null): event is ExtremeNudgeToastEvent {
  return event !== null && "kind" in event && event.kind === "extremeNudgeToast";
}

function isMilestoneEvent(event: CompanionPillWindowEvent | null): event is CompanionPillMilestoneEvent {
  return event !== null && "kind" in event && event.kind === "milestone";
}

function isReentryEvent(event: CompanionPillWindowEvent | null): event is CompanionReentryEvent {
  return event !== null && "kind" in event && event.kind === "reentry";
}

function isWatcherPeekEvent(event: CompanionPillWindowEvent | null): event is WatcherPeekEvent {
  return event !== null && !("kind" in event);
}

function ignoreWatcherBridgePromise(promise: Promise<unknown>) {
  void promise.catch(ignoreWatcherBridgeRejection);
}

function ignoreWatcherBridgeRejection() {
  return undefined;
}

function StandaloneMilestone({
  event,
  onDismiss,
  onOpenDashboard,
  onOpenDestination,
}: {
  readonly event: CompanionPillMilestoneEvent;
  readonly onDismiss: (reason: CompanionPillDismissReason) => void;
  readonly onOpenDashboard: () => void;
  readonly onOpenDestination: (destination: NonNullable<CompanionPillMilestoneEvent["destination"]>) => void;
}) {
  return (
    <div
      className="pill"
      data-state="milestone"
      data-mood="focus"
      data-tier={String(event.tier)}
      data-mile-kind={event.milestoneKind}
    >
      <div className="pill__clip">
        <CompanionPillMoment
          event={event}
          onDismiss={onDismiss}
          onOpenDashboard={onOpenDashboard}
          onOpenDestination={onOpenDestination}
        />
      </div>
      <span className="sparks" aria-hidden="true">
        {buildMilestoneSparks(event.tier, event.id).map((style, index) => (
          <i key={index} style={style} />
        ))}
      </span>
    </div>
  );
}

function StandaloneReentry({
  event,
  onDismiss,
  onOpenDashboard,
  onOpenReentry,
}: {
  readonly event: CompanionReentryEvent;
  readonly onDismiss: (reason: CompanionPillDismissReason) => void;
  readonly onOpenDashboard: () => void;
  readonly onOpenReentry: (event: CompanionReentryEvent) => void;
}) {
  return (
    <div className="pill" data-state="reentry" data-mood="neutral">
      <div className="pill__clip">
        <CompanionPillMoment
          event={event}
          onDismiss={onDismiss}
          onOpenDashboard={onOpenDashboard}
          onOpenReentry={onOpenReentry}
        />
      </div>
    </div>
  );
}
