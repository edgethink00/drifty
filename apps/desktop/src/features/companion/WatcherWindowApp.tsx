import { useCallback, useEffect, useState } from "react";
import { EndOfDayReview, type EndOfDayReviewEvent } from "./EndOfDayReview";
import { WatcherPeek, type WatcherPeekEvent, type WatcherPhase } from "./WatcherPeek";
import {
  dismissNativeWatcherPeek,
  listenToNativeWatcherShow,
  setNativeWatcherInteractive,
  triggerNativeEndOfDayReviewAction,
  type WatcherWindowEvent,
} from "./watcherBridge";

const WATCHER_THEME_STORAGE_KEY = "drifty.theme";
const LEGACY_WATCHER_THEME_STORAGE_KEY = "dtime.theme";
const WATCHER_DEFAULT_THEME = "light";

export function WatcherWindowApp() {
  const [event, setEvent] = useState<WatcherWindowEvent | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(WATCHER_THEME_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_WATCHER_THEME_STORAGE_KEY);
    if (window.localStorage.getItem(WATCHER_THEME_STORAGE_KEY) === null && savedTheme !== null) window.localStorage.setItem(WATCHER_THEME_STORAGE_KEY, savedTheme);
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
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setEvent(null);
    void dismissNativeWatcherPeek();
  }, []);

  const handlePhaseChange = useCallback((_phase: WatcherPhase, _currentEvent: WatcherPeekEvent | null) => {
    void setNativeWatcherInteractive(false);
  }, []);

  const handleOpenDashboard = useCallback(() => {
    void triggerNativeEndOfDayReviewAction("openDashboard");
  }, []);

  const handleViewDetails = useCallback(() => {
    void triggerNativeEndOfDayReviewAction("viewDetails");
  }, []);

  const handleOpenNotificationSettings = useCallback(() => {
    void triggerNativeEndOfDayReviewAction("openNotificationSettings");
  }, []);

  const isReviewEvent = isEndOfDayReviewEvent(event);

  useEffect(() => {
    if (isReviewEvent) void setNativeWatcherInteractive(true);
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
      ) : (
        <WatcherPeek event={event} onDismiss={handleDismiss} onPhaseChange={handlePhaseChange} />
      )}
    </main>
  );
}

function isEndOfDayReviewEvent(event: WatcherWindowEvent | null): event is EndOfDayReviewEvent {
  return event !== null && "kind" in event && event.kind === "endOfDayReview";
}
