import { useCallback, useEffect, useState } from "react";
import { EndOfDayReview, type EndOfDayReviewEvent } from "./EndOfDayReview";
import { ExtremeNudgeToast, type ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import {
  buildMilestoneSparks,
  CompanionPillMoment,
  type CompanionPillDismissReason,
  type CompanionPillMilestoneEvent,
} from "./CompanionPillMoment";
import type { CompanionReentryEvent } from "./companionReentry";
import { WatcherPeek, type WatcherPeekEvent, type WatcherPhase } from "./WatcherPeek";
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

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listenToNativeWatcherShow(setEvent).then((nextUnlisten) => {
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
  }, []);

  const handleDismiss = useCallback(() => {
    setEvent(null);
    ignoreWatcherBridgePromise(dismissNativeWatcherPeek());
  }, []);

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

  const handleViewDetails = useCallback(() => {
    ignoreWatcherBridgePromise(triggerNativeEndOfDayReviewAction("viewDetails"));
  }, []);

  const handleOpenNotificationSettings = useCallback(() => {
    ignoreWatcherBridgePromise(triggerNativeEndOfDayReviewAction("openNotificationSettings"));
  }, []);

  const handleExtremeNudgeAction = useCallback((action: Parameters<typeof triggerNativeExtremeNudgeAction>[0]) => {
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

  const isReviewEvent = isEndOfDayReviewEvent(event);
  const isExtremeNudgeToastEvent = isExtremeNudgeToast(event);
  const isMilestone = isMilestoneEvent(event);
  const isReentry = isReentryEvent(event);

  useEffect(() => {
    if (isReviewEvent || isExtremeNudgeToastEvent || isMilestone || isReentry) {
      ignoreWatcherBridgePromise(setNativeWatcherInteractive(true));
    }
  }, [isExtremeNudgeToastEvent, isMilestone, isReentry, isReviewEvent]);

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
      ) : isReviewEvent ? (
        <EndOfDayReview
          event={event}
          onOpenDashboard={handleOpenDashboard}
          onViewDetails={handleViewDetails}
          onOpenNotificationSettings={handleOpenNotificationSettings}
          onClose={handleDismiss}
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

function isEndOfDayReviewEvent(event: CompanionPillWindowEvent | null): event is EndOfDayReviewEvent {
  return event !== null && "kind" in event && event.kind === "endOfDayReview";
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
