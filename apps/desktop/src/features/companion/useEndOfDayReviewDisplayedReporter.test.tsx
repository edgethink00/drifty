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
import { END_OF_DAY_REVIEW_STORAGE_KEY } from "./endOfDayReviewData";
import {
  END_OF_DAY_REVIEW_CATCH_UP_STORAGE_KEY,
  END_OF_DAY_REVIEW_LAST_PRESENTATION_DAY_STORAGE_KEY,
} from "./endOfDayReviewSchedule";

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

function ReporterHost({ event, presented = true }: { event: EndOfDayReviewEvent | null; presented?: boolean }) {
  useEndOfDayReviewDisplayedReporter(event, presented);
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
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18", "2026-08-18");
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

  /* The companion panel is a non-activating window that receives its payload
     before the native reveal, and its page may never report itself visible.
     Requiring that flag left the day unacknowledged and re-presented the same
     review all evening. */
  it("reports a card whose page never reports itself visible", () => {
    stubVisibility("hidden");
    render(<ReporterHost event={buildReviewEvent()} />);

    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS + 100);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18", "2026-08-18");
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledTimes(1);
  });

  it("cancels a dwell the page actively interrupts and reports once it returns", () => {
    render(<ReporterHost event={buildReviewEvent()} />);

    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS - 200);
    });
    stubVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS * 2);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).not.toHaveBeenCalled();

    stubVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS + 100);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18", "2026-08-18");
  });

  /* A menu-bar card is prepared and rendered while the native panel is still
     hidden, so the dwell must not start until the reveal handshake completes. */
  it("waits for the surface to report the card presented", () => {
    const event = buildReviewEvent();
    const { rerender } = render(<ReporterHost event={event} presented={false} />);

    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS * 2);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).not.toHaveBeenCalled();

    rerender(<ReporterHost event={event} presented />);
    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS + 100);
    });
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18", "2026-08-18");
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a card presented before its delivery deadline even when the dwell crosses it", () => {
    const event = buildReviewEvent({
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
      presentationDay: "2026-08-19",
    });
    render(<ReporterHost event={event} />);

    act(() => {
      vi.advanceTimersByTime(END_OF_DAY_REVIEW_DISPLAY_DWELL_MS + 100);
    });

    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18", "2026-08-19");
    expect(window.localStorage.getItem(END_OF_DAY_REVIEW_STORAGE_KEY)).toBe("2026-08-18");
    expect(window.localStorage.getItem(END_OF_DAY_REVIEW_LAST_PRESENTATION_DAY_STORAGE_KEY))
      .toBe("2026-08-19");
  });
});

describe("reportEndOfDayReviewInteraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("reports a real fresh event immediately, without the dwell", () => {
    reportEndOfDayReviewInteraction(buildReviewEvent());
    expect(notifyNativeEndOfDayReviewDisplayed).toHaveBeenCalledWith("2026-08-18", "2026-08-18");
  });

  it("ignores mock previews, stale events, and missing events", () => {
    reportEndOfDayReviewInteraction(buildReviewEvent({ isMock: true }));
    reportEndOfDayReviewInteraction(buildReviewEvent({
      generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }));
    reportEndOfDayReviewInteraction(null);
    expect(notifyNativeEndOfDayReviewDisplayed).not.toHaveBeenCalled();
  });

  it("persists the shared acknowledgement before the native handoff settles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 20, 9, 0, 0, 0));
    let resolveNative: (() => void) | undefined;
    vi.mocked(notifyNativeEndOfDayReviewDisplayed).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveNative = resolve; }),
    );

    const reporting = reportEndOfDayReviewInteraction(buildReviewEvent({
      day: "2026-08-19",
      presentationDay: "2026-08-20",
    }));

    expect(window.localStorage.getItem(END_OF_DAY_REVIEW_STORAGE_KEY)).toBe("2026-08-19");
    expect(window.localStorage.getItem(END_OF_DAY_REVIEW_CATCH_UP_STORAGE_KEY)).toBe("2026-08-19");
    expect(window.localStorage.getItem(END_OF_DAY_REVIEW_LAST_PRESENTATION_DAY_STORAGE_KEY)).toBe("2026-08-20");

    resolveNative?.();
    await reporting;
    vi.useRealTimers();
  });
});
