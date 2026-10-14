import { useAppTheme } from "../settings/useAppTheme";
import { useCallback, useEffect, useState } from "react";
import type { ExtremeNudgeToastEvent } from "./extremeNudgeData";
import type { DriftAlarmAction } from "./driftAlarmEvent";
import {
  buildMilestoneSparks,
  CompanionPillMoment,
  type CompanionPillDismissReason,
  type CompanionPillMilestoneEvent,
} from "./CompanionPillMoment";
import { isCompanionMomentStale } from "./companionMomentFreshness";
import {
  isInformationalMomentEvent,
  isInformationalMomentSuppressedNow,
  refreshInformationalMomentSuppression,
} from "./informationalMomentSuppression";
import {
  hideNativeWatcherPeek,
  listenToNativeWatcherShow,
  setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction,
  triggerNativeExtremeNudgeAction,
  type CompanionPillWindowEvent,
} from "./watcherBridge";
import { companionEventIdentity } from "./companionEventIdentity";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";


export function WatcherWindowApp() {
  useAppTheme();
  const [event, setEvent] = useState<CompanionPillWindowEvent | null>(null);

  useEffect(() => {
    document.documentElement.dataset.surface = "watcher";
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
    /* The old watcher orb is retired. Peek snapshots belong to Companion. */
    if (!("kind" in nextEvent)) return;
    if (!isInformationalMomentEvent(nextEvent)) {
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
      ignoreWatcherBridgePromise(hideNativeWatcherPeek(event ? companionEventIdentity(event) : undefined));
    };
    consumeIfStale();
    const interval = window.setInterval(consumeIfStale, 30_000);
    return () => window.clearInterval(interval);
  }, [event]);

  const handleToastDismiss = useCallback(() => {
    if (!event) return;
    setEvent(null);
    ignoreWatcherBridgePromise(hideNativeWatcherPeek(event ? companionEventIdentity(event) : undefined));
  }, [event]);

  const handleOpenDashboard = useCallback(() => {
    ignoreWatcherBridgePromise(triggerNativeEndOfDayReviewAction("openDashboard", event ? companionEventIdentity(event) : undefined));
  }, [event]);

  const handleExtremeNudgeAction = useCallback((action: Parameters<typeof triggerNativeExtremeNudgeAction>[0]) => {
    if (action.type === "manual_correction") {
      setEvent((current) => isExtremeNudgeToast(current)
        ? { ...current, correctionStatus: "acknowledged" }
        : current);
      ignoreWatcherBridgePromise(triggerNativeExtremeNudgeAction(action, event ? companionEventIdentity(event) : undefined));
      return;
    }
    setEvent(null);
    ignoreWatcherBridgePromise(triggerNativeExtremeNudgeAction(action, event ? companionEventIdentity(event) : undefined));
  }, [event]);

  const handleMilestoneDismiss = useCallback((_reason: CompanionPillDismissReason) => {
    if (!event) return;
    setEvent(null);
    ignoreWatcherBridgePromise(hideNativeWatcherPeek(event ? companionEventIdentity(event) : undefined));
  }, [event]);

  const handleOpenMilestoneDestination = useCallback((destination: NonNullable<CompanionPillMilestoneEvent["destination"]>) => {
    setEvent(null);
    const action = destination === "leaderboard"
      ? "openLeaderboard"
      : destination === "insights"
        ? "openTrends"
        : "openDashboard";
    ignoreWatcherBridgePromise(triggerNativeEndOfDayReviewAction(action, event ? companionEventIdentity(event) : undefined));
  }, [event]);

  const isExtremeNudgeToastEvent = isExtremeNudgeToast(event);
  const isMilestone = isMilestoneEvent(event);

  useEffect(() => {
    if (isExtremeNudgeToastEvent || isMilestone) {
      ignoreWatcherBridgePromise(setNativeWatcherInteractive(true));
    }
  }, [isExtremeNudgeToastEvent, isMilestone]);

  return (
    <main
      className={`watcher-window-surface${isMilestone || isExtremeNudgeToastEvent ? " companion-pill-surface" : ""}`}
      data-state={isMilestone ? "milestone" : isExtremeNudgeToastEvent ? "nudge" : undefined}
      aria-label="Drifty watcher window"
    >
      {isMilestone ? (
        <StandaloneMilestone
          event={event}
          onDismiss={handleMilestoneDismiss}
          onOpenDashboard={handleOpenDashboard}
          onOpenDestination={handleOpenMilestoneDestination}
        />
      ) : isExtremeNudgeToastEvent ? (
        <StandaloneNudge event={event} onAction={handleExtremeNudgeAction} onDismiss={handleToastDismiss} />
      ) : null}
    </main>
  );
}

function isExtremeNudgeToast(event: CompanionPillWindowEvent | null): event is ExtremeNudgeToastEvent {
  return event !== null && "kind" in event && event.kind === "extremeNudgeToast";
}

function isMilestoneEvent(event: CompanionPillWindowEvent | null): event is CompanionPillMilestoneEvent {
  return event !== null && "kind" in event && event.kind === "milestone";
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

function StandaloneNudge({
  event,
  onAction,
  onDismiss,
}: {
  readonly event: ExtremeNudgeToastEvent;
  readonly onAction: (action: DriftAlarmAction) => void;
  readonly onDismiss: () => void;
}) {
  return (
    <div className="pill" data-state="nudge" data-card-state="nudge">
      <div className="pill__clip">
        <CompanionPillMoment
          event={event}
          onDismiss={() => onDismiss()}
          onOpenDashboard={() => undefined}
          onAction={onAction}
        />
      </div>
    </div>
  );
}
