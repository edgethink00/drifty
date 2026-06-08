import { useCallback, useEffect, useState } from "react";
import { DriftAlarm, type DriftAlarmAction, type DriftAlarmEvent } from "./DriftAlarm";
import {
  dismissNativeDriftAlarm,
  getNativeDriftAlarmCurrent,
  listenToNativeDriftAlarmShow,
  triggerNativeDriftAlarmAction,
} from "./driftAlarmBridge";

const DRIFT_ALARM_THEME_STORAGE_KEY = "drifty.theme";
const DRIFT_ALARM_DEFAULT_THEME = "light";

export function DriftAlarmWindowApp() {
  const [event, setEvent] = useState<DriftAlarmEvent | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(DRIFT_ALARM_THEME_STORAGE_KEY);
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
    setEvent(null);
    void triggerNativeDriftAlarmAction(action);
  }, []);

  const handleCancel = useCallback(() => {
    setEvent(null);
    void dismissNativeDriftAlarm();
  }, []);

  return (
    <main className="drift-alarm-window-surface" aria-label="Drifty drift alarm window">
      <div className="drift-alarm-backdrop" aria-hidden="true" />
      <div className="drift-alarm-overlay">
        <DriftAlarm event={event} onAction={handleAction} onCancel={handleCancel} />
      </div>
    </main>
  );
}
