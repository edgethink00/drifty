import { useEffect, useState } from "react";
import { trackerClient } from "../../lib/api/trackerClient";

const LIVE_PREVIEW_POLL_MS = 3_000;

/**
 * Live proof that the just-granted Accessibility permission works: polls the
 * tracker's current snapshot while active and returns the frontmost app name.
 * Returns null when tracking has nothing to show (or outside the desktop app),
 * which hides the line entirely.
 */
export function useLiveTrackingPreview(active: boolean): string | null {
  const [appName, setAppName] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setAppName(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const snapshot = await trackerClient.getCurrentSnapshot();
        if (cancelled) return;
        setAppName(snapshot?.appName?.trim() || null);
      } catch {
        if (!cancelled) setAppName(null);
      }
    };
    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, LIVE_PREVIEW_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [active]);

  return appName;
}
