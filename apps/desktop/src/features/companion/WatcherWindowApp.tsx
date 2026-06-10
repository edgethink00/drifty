import { useCallback, useEffect, useState } from "react";
import { EndOfDayReview, type EndOfDayReviewEvent } from "./EndOfDayReview";
import { ExtremeNudgeToast, type ExtremeNudgeToastEvent } from "./ExtremeNudgeToast";
import { WatcherPeek, type WatcherPeekEvent, type WatcherPhase } from "./WatcherPeek";
import {
  dismissNativeWatcherPeek,
  hideNativeWatcherPeek,
  listenToNativeWatcherShow,
  setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction,
  type WatcherWindowEvent,
} from "./watcherBridge";

const WATCHER_THEME_STORAGE_KEY = "drifty.theme";
const WATCHER_DEFAULT_THEME = "light";

export function WatcherWindowApp() {
  const [event, setEvent] = useState<WatcherWindowEvent | null>(null);

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

    void listenToNativeWatcherShow((nextEvent) => {
      setEvent(nextEvent);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten?.();
        return;
      }
      unlisten = nextUnlisten;
    }).catch(ignoreWatcherBridgeRejection);

    return () => {
      disposed = true;
      unlisten?.();
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

  const isReviewEvent = isEndOfDayReviewEvent(event);
  const isExtremeNudgeToastEvent = isExtremeNudgeToast(event);

  useEffect(() => {
    if (isReviewEvent) ignoreWatcherBridgePromise(setNativeWatcherInteractive(true));
  }, [isReviewEvent]);

  return (
    <main className="watcher-window-surface" aria-label="Drifty watcher window">
      {isReviewEvent ? (
        <EndOfDayReview
          event={event}
          onOpenDashboard={handleOpenDashboard}
          onViewDetails={handleViewDetails}
          onOpenNotificationSettings={handleOpenNotificationSettings}
          onClose={handleDismiss}
        />
      ) : isExtremeNudgeToastEvent ? (
        <ExtremeNudgeToast event={event} onDismiss={handleToastDismiss} />
      ) : (
        <WatcherPeek event={event} onDismiss={handleDismiss} onPhaseChange={handlePhaseChange} />
      )}
    </main>
  );
}

function isEndOfDayReviewEvent(event: WatcherWindowEvent | null): event is EndOfDayReviewEvent {
  return event !== null && "kind" in event && event.kind === "endOfDayReview";
}

function isExtremeNudgeToast(event: WatcherWindowEvent | null): event is ExtremeNudgeToastEvent {
  return event !== null && "kind" in event && event.kind === "extremeNudgeToast";
}

function ignoreWatcherBridgePromise(promise: Promise<unknown>) {
  void promise.catch(ignoreWatcherBridgeRejection);
}

function ignoreWatcherBridgeRejection() {
  return undefined;
}
