import { useEffect, useRef } from "react";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
import { isCompanionMomentStale } from "./companionMomentFreshness";
import { notifyNativeEndOfDayReviewDisplayed } from "./watcherBridge";

/**
 * The once-a-day review slot must be earned by an actual display, not by the
 * invoke that shipped the payload: a machine asleep with the lid closed
 * "shows" the card to no one, and marking that day as shown used to burn the
 * slot. The surface reports the display only after the card has stayed
 * visible for a short dwell while still fresh; the main window marks the day
 * from there. Mock previews never report — looking at a preview must not
 * consume the real day's slot.
 */
export const END_OF_DAY_REVIEW_DISPLAY_DWELL_MS = 2_500;

export function useEndOfDayReviewDisplayedReporter(event: EndOfDayReviewEvent | null): void {
  const notifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!event || event.isMock) return undefined;
    const identity = `${event.day}:${event.generatedAt}`;
    if (notifiedRef.current === identity) return undefined;

    let dwellTimer: number | null = null;
    const cancelDwell = () => {
      if (dwellTimer === null) return;
      window.clearTimeout(dwellTimer);
      dwellTimer = null;
    };
    const armDwell = () => {
      if (notifiedRef.current === identity || dwellTimer !== null) return;
      if (document.visibilityState !== "visible") return;
      if (isCompanionMomentStale(event)) return;
      dwellTimer = window.setTimeout(() => {
        dwellTimer = null;
        /* The dwell timer freezes while macOS sleeps, so re-validate on
           wake: a card that crossed its freshness during the nap never
           earns the slot. */
        if (notifiedRef.current === identity) return;
        if (document.visibilityState !== "visible") return;
        if (isCompanionMomentStale(event)) return;
        notifiedRef.current = identity;
        void notifyNativeEndOfDayReviewDisplayed(event.day).catch(() => undefined);
      }, END_OF_DAY_REVIEW_DISPLAY_DWELL_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        armDwell();
      } else {
        cancelDwell();
      }
    };

    armDwell();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelDwell();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [event]);
}

/**
 * A deliberate interaction with the card — dismissing it, opening the full
 * day, opening its settings — proves the display even inside the dwell
 * window, so it earns the slot immediately. Auto-dismiss and staleness
 * consumption never call this: they are the machine talking to itself.
 */
export function reportEndOfDayReviewInteraction(event: EndOfDayReviewEvent | null | undefined): void {
  if (!event || event.isMock) return;
  if (isCompanionMomentStale(event)) return;
  void notifyNativeEndOfDayReviewDisplayed(event.day).catch(() => undefined);
}
