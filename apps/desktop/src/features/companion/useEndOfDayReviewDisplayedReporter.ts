import { useEffect, useRef } from "react";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import type { CompanionPillMomentEvent } from "./CompanionPillMoment";
import { isCompanionMomentAgedOut, isCompanionMomentStale } from "./companionMomentFreshness";
import { acknowledgeDayReview } from "./dayReviewScheduler";
import { notifyNativeEndOfDayReviewDisplayed, notifyNativeEndOfDayReviewDropped } from "./watcherBridge";

/**
 * The once-a-day review slot must be earned by an actual display, not by the
 * invoke that shipped the payload: a machine asleep with the lid closed
 * "shows" the card to no one, and marking that day as shown used to burn the
 * slot. The surface reports the display only after the card has stayed on
 * screen for a short dwell while still fresh. The surface first marks the day
 * in shared webview storage, then mirrors the acknowledgement through native
 * events for the main window. Mock previews never report — looking at a
 * preview must not consume the real day's slot.
 *
 * The dwell waits for the surface's own `presented` signal rather than for
 * `document.visibilityState`. The companion panel is a non-activating
 * always-on-top window that receives its payload while still hidden and is
 * revealed only by the later native handshake, so a page visibility that never
 * flips to "visible" left the day permanently unacknowledged and re-presented
 * the same review for the rest of the evening. Sleep is still covered by the
 * freshness re-check below: the timer freezes with the machine and a card that
 * aged past its window on the way back never earns the slot. A page that
 * actively goes hidden mid-dwell still cancels.
 */
export const END_OF_DAY_REVIEW_DISPLAY_DWELL_MS = 2_500;

function reviewPresentationDay(event: EndOfDayReviewEvent): string {
  return event.presentationDay && /^\d{4}-\d{2}-\d{2}$/.test(event.presentationDay)
    ? event.presentationDay
    : event.day;
}

function persistDisplayedReview(event: EndOfDayReviewEvent): void {
  acknowledgeDayReview(event.day, new Date().toISOString());
}

/**
 * `presented` is the surface's answer to "is this card on screen now". Surfaces
 * that render the card as soon as they receive it pass the default; the
 * menu-bar path passes the completed native reveal handshake.
 */
export function useEndOfDayReviewDisplayedReporter(
  event: EndOfDayReviewEvent | null,
  presented: boolean = true,
): void {
  const notifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!event || event.isMock) return undefined;
    if (!presented) return undefined;
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
      if (isCompanionMomentStale(event)) return;
      dwellTimer = window.setTimeout(() => {
        dwellTimer = null;
        /* The dwell timer freezes while macOS sleeps, so re-validate on
           wake: a card that crossed its freshness during the nap never
           earns the slot. */
        if (notifiedRef.current === identity) return;
        /* The producer deadline controls whether presentation may begin. Once
           this dwell has started, crossing that deadline must still count the
           already-visible card; only a sleep-length age-out invalidates it. */
        if (isCompanionMomentAgedOut(event)) return;
        notifiedRef.current = identity;
        persistDisplayedReview(event);
        void notifyNativeEndOfDayReviewDisplayed(event.day, reviewPresentationDay(event)).catch(() => undefined);
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
  }, [event, presented]);
}

/**
 * A deliberate interaction with the card — dismissing it, opening the full
 * day, opening its settings — proves the display even inside the dwell
 * window, so it earns the slot immediately. Auto-dismiss and staleness
 * consumption never call this: they are the machine talking to itself.
 */
export async function reportEndOfDayReviewInteraction(
  event: EndOfDayReviewEvent | null | undefined,
): Promise<void> {
  if (!event || event.isMock) return;
  /* This helper is called only for the currently visible card. Its producer
     deadline may pass while the user is reading it, but its age window may not. */
  if (isCompanionMomentAgedOut(event)) return;
  persistDisplayedReview(event);
  try {
    await notifyNativeEndOfDayReviewDisplayed(event.day, reviewPresentationDay(event));
  } catch {
    // Closing the surface must remain available even if the native bridge is
    // shutting down; the bounded presentation ledger remains the fallback.
  }
}

/**
 * The surface consumed a Day Review without ever showing it (it expired in a
 * queue, behind a fullscreen app, or across a sleep). The scheduler in the
 * main window may rebuild that day's card once; a card that was already
 * acknowledged is unaffected because the record no longer waits for it.
 */
export function reportEndOfDayReviewUnseen(event: CompanionPillMomentEvent | null | undefined): void {
  if (!event || event.kind !== "endOfDayReview" || event.isMock) return;
  void notifyNativeEndOfDayReviewDropped(event.day, "expired_unseen").catch(() => undefined);
}
