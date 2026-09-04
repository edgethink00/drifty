// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndOfDayReviewEvent } from "./endOfDayReviewModel";
import {
  END_OF_DAY_REVIEW_DISPLAY_DWELL_MS,
  reportEndOfDayReviewInteraction,
  useEndOfDayReviewDisplayedReporter,
} from "./useEndOfDayReviewDisplayedReporter";
import { notifyNativeEndOfDayReviewDisplayed } from "./watcherBridge";

vi.mock("./watcherBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./watcherBridge")>()),
  notifyNativeEndOfDayReviewDisplayed: vi.fn().mockResolvedValue(undefined),
}));

function buildReviewEvent(overrides: Partial<EndOfDayReviewEvent> = {}): EndOfDayReviewEvent {
  return {
    kind: "endOfDayReview",
    placement: "top-right",
    day: "2026-08-18",
    generatedAt: new Date().toISOString(),
    trackedLabel: "5h 27m tracked",
    focusLabel: "3h 28m focus",
    driftLabel: "58m drift",
    totalSeconds: 5 * 3600 + 27 * 60,
    focusSeconds: 3 * 3600 + 28 * 60,
    driftSeconds: 58 * 60,
    ...overrides,
  } as EndOfDayReviewEvent;
}

function ReporterHost({ event }: { event: EndOfDayReviewEvent | null }) {
  useEndOfDayReviewDisplayedReporter(event);
  return null;
}

function stubVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("useEndOfDayReviewDisplayedReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    stubVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    stubVisibility("visible");
  });

  it("reports a fresh visible display only after the dwell", () => {
    render(<ReporterHost event={buildReviewEvent()} />);

    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS - 100);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18");
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledTimes(1);
  });

  it("never reports a mock preview, so previews cannot consume the day's slot", () => {
    render(<ReporterHost event={buildReviewEvent({ isMock: true })} />);

    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS * 4);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).not.toHaveBeenCalled();
  });

  it("never reports a stale event", () => {
    render(<ReporterHost event={buildReviewEvent({ generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })} />);

    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS * 4);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).not.toHaveBeenCalled();
  });

  it("waits out a hidden document and reports once the card stays visible", () => {
    stubVisibility("hidden");
    render(<ReporterHost event={buildReviewEvent()} />);

    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS * 4);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).not.toHaveBeenCalled();

    stubVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS + 100);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18");
  });
});

describe("reportEndOfDayReviewInteraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a real fresh event immediately, without the dwell", () => {
    reportEndOfDayReviewInteraction(buildReviewEvent());
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18");
  });

  it("ignores mock previews, stale events, and missing events", () => {
    reportEndOfDayReviewInteraction(buildReviewEvent({ isMock: true }));
    reportEndOfDayReviewInteraction(buildReviewEvent({
      generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }));
    reportEndOfDayReviewInteraction(null);
    expect(notifyNativeEndOfDayReviewDisplayed).not.toHaveBeenCalled();
  });
});
