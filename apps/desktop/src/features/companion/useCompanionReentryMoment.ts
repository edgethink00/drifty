import { useEffect, useRef } from "react";
import { trackerClient } from "../../lib/api/trackerClient";
import {
  buildCompanionReentryEvent,
  COMPANION_REENTRY_FRESHNESS_MS,
  COMPANION_REENTRY_LOOKBACK_MS,
  persistHandledCompanionReentry,
  readHandledCompanionReentry,
} from "./companionReentry";
import { isTauriRuntime, showNativeCompanionReentry } from "./watcherBridge";

const REENTRY_TIMELINE_PAGE_SIZE = 64;
export const COMPANION_REENTRY_CONFIRMATION_DELAY_MS = 10_000;

export function useCompanionReentryMoment({
  ready,
  announcementsEnabled,
  activitySignal,
  locale,
}: {
  readonly ready: boolean;
  readonly announcementsEnabled: boolean;
  readonly activitySignal: string | null;
  readonly locale?: string;
}) {
  const requestRef = useRef(0);
  const announcementsEnabledRef = useRef(announcementsEnabled);
  const pendingEventIdRef = useRef<string | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  announcementsEnabledRef.current = announcementsEnabled;

  useEffect(() => () => {
    if (pendingTimeoutRef.current !== null) clearTimeout(pendingTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!ready || !activitySignal || !isTauriRuntime()) return;

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let cancelled = false;
    const nowMs = Date.now();
    void trackerClient.getTimelinePage({
      start: new Date(nowMs - COMPANION_REENTRY_LOOKBACK_MS).toISOString(),
      end: new Date(nowMs + 60_000).toISOString(),
      limit: REENTRY_TIMELINE_PAGE_SIZE,
    }).then((page) => {
      if (cancelled || requestRef.current !== requestId) return;
      const event = buildCompanionReentryEvent({ segments: page.items, nowMs, locale });
      if (!event || readHandledCompanionReentry() === event.id) return;

      /* Consume the return even while Companion is hidden or turned off. Like
         milestones, a re-entry is about now and must never replay later. */
      persistHandledCompanionReentry(event.id);
      if (!announcementsEnabled) return;
      if (pendingEventIdRef.current === event.id) return;

      pendingEventIdRef.current = event.id;
      pendingTimeoutRef.current = setTimeout(() => {
        pendingTimeoutRef.current = null;
        pendingEventIdRef.current = null;
        if (!announcementsEnabledRef.current) return;
        const returnedAtMs = Date.parse(event.returnedAt);
        /* Browser timers pause while the Mac sleeps. Without revalidation, a
           ten-second confirmation started before sleep can fire hours later on
           the next wake and replay stale context immediately. */
        if (!Number.isFinite(returnedAtMs)
          || Date.now() - returnedAtMs > COMPANION_REENTRY_FRESHNESS_MS) return;
        void showNativeCompanionReentry(event).catch((error: unknown) => {
          console.warn("Failed to show a Companion re-entry moment", error);
        });
      }, COMPANION_REENTRY_CONFIRMATION_DELAY_MS);
    }).catch((error: unknown) => {
      if (cancelled || requestRef.current !== requestId) return;
      console.warn("Failed to inspect recent activity for Companion re-entry", error);
    });
    return () => {
      cancelled = true;
    };
  }, [activitySignal, announcementsEnabled, locale, ready]);
}
