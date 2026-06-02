import { useCallback, useEffect, useState } from "react";
import { WatcherPeek, type WatcherPeekEvent, type WatcherPeekResponse } from "./WatcherPeek";
import {
  dismissNativeWatcherPeek,
  listenToNativeWatcherShow,
  respondNativeWatcherPeek,
  setNativeWatcherInteractive,
} from "./watcherBridge";

const WATCHER_THEME_STORAGE_KEY = "drifty.theme";
const LEGACY_WATCHER_THEME_STORAGE_KEY = "dtime.theme";
const WATCHER_DEFAULT_THEME = "light";

export function WatcherWindowApp() {
  const [event, setEvent] = useState<WatcherPeekEvent | null>(null);

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

  const handleRespond = useCallback((response: WatcherPeekResponse) => {
    setEvent(null);
    void respondNativeWatcherPeek(response);
  }, []);

  const handlePhaseChange = useCallback(() => {
    void setNativeWatcherInteractive(false);
  }, []);

  return (
    <main className="watcher-window-surface" aria-label="Drifty watcher window">
      <WatcherPeek event={event} onDismiss={handleDismiss} onRespond={handleRespond} onPhaseChange={handlePhaseChange} />
    </main>
  );
}
