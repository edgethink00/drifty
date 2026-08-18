// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EndOfDayReviewEvent } from "./EndOfDayReview";
import { CompanionPillMoment } from "./CompanionPillMoment";
import { COMPANION_MOMENT_STALE_AFTER_MS } from "./companionMomentFreshness";

afterEach(cleanup);

function reviewEvent(generatedAt: string): EndOfDayReviewEvent {
  return {
    kind: "endOfDayReview",
    day: "2026-08-18",
    generatedAt,
    trackedLabel: "6:34 tracked",
    focusLabel: "4:12 focus",
    driftLabel: "0:58 drift",
    totalSeconds: 23_640,
    focusSeconds: 15_120,
    driftSeconds: 3_480,
    topSource: null,
  };
}

describe("companion moment staleness", () => {
  it("consumes a moment that is already stale at activation", () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(
        <CompanionPillMoment
          event={reviewEvent(new Date(Date.now() - COMPANION_MOMENT_STALE_AFTER_MS - 60_000).toISOString())}
          isActive
          onDismiss={onDismiss}
          onOpenDashboard={vi.fn()}
        />,
      );
      expect(onDismiss).toHaveBeenCalledWith("auto");
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes a moment that crosses the stale window while the machine was asleep", () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      // Fresh at activation: only the wall-clock re-check can catch it after
      // the budget froze through a sleep cycle.
      render(
        <CompanionPillMoment
          event={reviewEvent(new Date(Date.now() - COMPANION_MOMENT_STALE_AFTER_MS + 30_000).toISOString())}
          isActive
          /* Hover-style hold keeps the pauseable budget frozen, so only the
             wall-clock staleness re-check can dismiss this card — exactly the
             shape of a machine asleep through the budget. */
          isPointerInside
          onDismiss={onDismiss}
          onOpenDashboard={vi.fn()}
        />,
      );
      expect(onDismiss).not.toHaveBeenCalled();

      // Simulate the wake: wall time jumps far past the stale window while
      // the pauseable budget barely ticked.
      act(() => vi.advanceTimersByTime(60_000));
      expect(onDismiss).toHaveBeenCalledWith("auto");
    } finally {
      vi.useRealTimers();
    }
  });
});
