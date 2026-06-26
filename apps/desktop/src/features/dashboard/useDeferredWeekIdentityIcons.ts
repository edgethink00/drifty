import { useEffect, useState } from "react";
import type { WeekCalendarEvent } from "./weekCalendar";

const WEEK_IDENTITY_ICON_IDLE_TIMEOUT_MS = 800;
const WEEK_IDENTITY_ICON_FALLBACK_DELAY_MS = 160;

type DeferredWeekIdentityIconsInput = {
  readonly calendarEvents: Map<string, WeekCalendarEvent[]>;
  readonly endDay: string;
  readonly startDay: string;
};

export function useDeferredWeekIdentityIcons({
  calendarEvents,
  endDay,
  startDay,
}: DeferredWeekIdentityIconsInput): boolean {
  const [canMountIdentityIcons, setCanMountIdentityIcons] = useState(false);

  useEffect(() => {
    setCanMountIdentityIcons(false);

    let animationFrameHandle: number | null = null;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    let isCancelled = false;

    const mountIdentityIcons = () => {
      if (isCancelled) return;
      setCanMountIdentityIcons(true);
    };

    const scheduleAfterFirstFrame = () => {
      if (typeof window.requestIdleCallback === "function" && typeof window.cancelIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(mountIdentityIcons, { timeout: WEEK_IDENTITY_ICON_IDLE_TIMEOUT_MS });
        return;
      }

      timeoutHandle = window.setTimeout(mountIdentityIcons, WEEK_IDENTITY_ICON_FALLBACK_DELAY_MS);
    };

    if (typeof window.requestAnimationFrame === "function") {
      animationFrameHandle = window.requestAnimationFrame(scheduleAfterFirstFrame);
    } else {
      timeoutHandle = window.setTimeout(mountIdentityIcons, WEEK_IDENTITY_ICON_FALLBACK_DELAY_MS);
    }

    return () => {
      isCancelled = true;
      if (animationFrameHandle !== null) window.cancelAnimationFrame(animationFrameHandle);
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [calendarEvents, endDay, startDay]);

  return canMountIdentityIcons;
}
