import { useEffect, useState } from "react";
import type { CurrentActivitySnapshot } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";

const LIVE_PREVIEW_POLL_MS = 3_000;

export type LiveTrackingPreview =
  /** Another app is frontmost right now — the strongest proof. */
  | { readonly kind: "current"; readonly appName: string }
  /** Drifty itself is frontmost, but we saw another app earlier (e.g. System Settings). */
  | { readonly kind: "recent"; readonly appName: string }
  /** Tracking works but has only ever seen Drifty itself so far. */
  | { readonly kind: "waiting" };

/**
 * Live proof that the just-granted Accessibility permission works: polls the
 * tracker's current snapshot while active. Drifty itself is never used as the
 * example — during onboarding the user is inside Drifty, so "I can see drifty"
 * proves nothing. Returns null while inactive, before the first snapshot, or
 * when frontmost capture is unavailable.
 */
export function useLiveTrackingPreview(active: boolean): LiveTrackingPreview | null {
  const [preview, setPreview] = useState<LiveTrackingPreview | null>(null);

  useEffect(() => {
    if (!active) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    let lastOtherApp: string | null = null;
    const poll = async () => {
      try {
        const snapshot = await trackerClient.getCurrentSnapshot();
        if (cancelled) return;
        if (isUnavailableCapture(snapshot)) {
          lastOtherApp = null;
          setPreview(null);
          return;
        }
        const appName = snapshot?.appName?.trim() || null;
        if (appName && !isDriftyItself(appName)) {
          lastOtherApp = appName;
          setPreview({ kind: "current", appName });
          return;
        }
        if (!appName) {
          setPreview(lastOtherApp ? { kind: "recent", appName: lastOtherApp } : null);
          return;
        }
        setPreview(lastOtherApp ? { kind: "recent", appName: lastOtherApp } : { kind: "waiting" });
      } catch {
        if (!cancelled) setPreview(null);
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

  return preview;
}

function isDriftyItself(appName: string): boolean {
  return appName.toLowerCase() === "drifty";
}

/**
 * Failed frontmost capture reports `frontmostCaptureSource: "unavailable"` and
 * fills `appName: "Unavailable"`. Older payloads may omit the source and keep
 * only that sentinel name. Neither is proof that tracking can see another app.
 */
function isUnavailableCapture(snapshot: CurrentActivitySnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  if (snapshot.frontmostCaptureSource === "unavailable") return true;
  return snapshot.frontmostCaptureSource == null && snapshot.appName.trim() === "Unavailable";
}
