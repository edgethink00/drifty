import { useCallback, useEffect, useState } from "react";
import { DriftAlarm, type DriftAlarmAction, type DriftAlarmEvent } from "./DriftAlarm";
import {
  getNativeDriftAlarmCurrent,
  listenToNativeDriftAlarmShow,
  triggerNativeDriftAlarmAction,
} from "./driftAlarmBridge";

const DRIFT_ALARM_THEME_STORAGE_KEY = "drifty.theme";
const LEGACY_DRIFT_ALARM_THEME_STORAGE_KEY = "dtime.theme";
const DRIFT_ALARM_DEFAULT_THEME = "light";

export function DriftAlarmWindowApp() {
  const [event, setEvent] = useState<DriftAlarmEvent | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(DRIFT_ALARM_THEME_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_DRIFT_ALARM_THEME_STORAGE_KEY);
    if (window.localStorage.getItem(DRIFT_ALARM_THEME_STORAGE_KEY) === null && savedTheme !== null) window.localStorage.setItem(DRIFT_ALARM_THEME_STORAGE_KEY, savedTheme);
    const theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : DRIFT_ALARM_DEFAULT_THEME;
    document.documentElement.dataset.surface = "drift-alarm";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    return () => {
      delete document.documentElement.dataset.surface;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const unlisten = await listenToNativeDriftAlarmShow((nextEvent) => {
        setEvent(nextEvent);
      });

      if (disposed) {
        unlisten?.();
        return;
      }

      if (unlisten) unlisteners.push(unlisten);

      const currentEvent = await getNativeDriftAlarmCurrent();
      if (disposed || !currentEvent) return;
      setEvent(currentEvent);
    })();

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const handleAction = useCallback((action: DriftAlarmAction) => {
    void triggerNativeDriftAlarmAction(action);
  }, []);

  return (
    <main className="watcher-window-surface watcher-window-surface--drift-alarm" aria-label="Drifty drift alarm window">
      <DriftAlarm event={event} onAction={handleAction} />
    </main>
  );
}
