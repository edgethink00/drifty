// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_DELETE_STYLE_REVIEW_READY,
  ACTIVITY_DELETE_STYLE_REVIEW_MESSAGE,
  ACTIVITY_DELETE_STYLE_KEY,
  ACTIVITY_DELETE_STYLE_OPTIONS,
  DEFAULT_ACTIVITY_DELETE_STYLE,
  readActivityDeleteStyle,
  resolveActivityDeleteStyle,
  resolveActivityDeleteStyleReviewOverride,
  useActivityDeleteStyleReviewOverride,
  useStoredActivityDeleteStyle,
  writeActivityDeleteStyle,
} from "./activityDeleteStyle";

afterEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

function frameWindow(): Window {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  return frame.contentWindow!;
}

function post(source: Window, style: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: ACTIVITY_DELETE_STYLE_REVIEW_MESSAGE, style }, source }));
  });
}

describe("activity delete confirmation candidates", () => {
  it("offers the default first and stores only a non-default Dev choice", () => {
    expect(ACTIVITY_DELETE_STYLE_OPTIONS[0]?.id).toBe(DEFAULT_ACTIVITY_DELETE_STYLE);
    expect(new Set(ACTIVITY_DELETE_STYLE_OPTIONS.map((option) => option.id)).size).toBe(ACTIVITY_DELETE_STYLE_OPTIONS.length);
    expect(readActivityDeleteStyle()).toBe("note");
    const { result } = renderHook(() => useStoredActivityDeleteStyle());
    act(() => writeActivityDeleteStyle("hold"));
    expect(result.current).toBe("hold");
    expect(window.localStorage.getItem(ACTIVITY_DELETE_STYLE_KEY)).toBe("hold");
    act(() => writeActivityDeleteStyle("note"));
    expect(result.current).toBe("note");
    expect(window.localStorage.getItem(ACTIVITY_DELETE_STYLE_KEY)).toBeNull();
    window.localStorage.setItem(ACTIVITY_DELETE_STYLE_KEY, "unknown");
    expect(readActivityDeleteStyle()).toBe("note");
  });

  it("applies a stored candidate only in Dev mode, and a review link only on a development server", () => {
    expect(resolveActivityDeleteStyle({ devModeActive: false, stored: "undo", reviewOverride: null })).toBe("note");
    expect(resolveActivityDeleteStyle({ devModeActive: true, stored: "undo", reviewOverride: null })).toBe("undo");
    expect(resolveActivityDeleteStyle({ devModeActive: false, stored: "undo", reviewOverride: "popover" })).toBe("popover");
    expect(resolveActivityDeleteStyleReviewOverride("?deleteStyle=hold", true)).toBe("hold");
    expect(resolveActivityDeleteStyleReviewOverride("?deleteStyle=hold", false)).toBeNull();
    expect(resolveActivityDeleteStyleReviewOverride("?deleteStyle=bogus", true)).toBeNull();
  });

  it("lets only the framing review page switch the candidate, and only on a development server", async () => {
    const reviewPage = frameWindow();
    const stranger = frameWindow();
    const ready = vi.fn();
    reviewPage.addEventListener("message", (event) => ready((event as MessageEvent).data));
    const { result } = renderHook(() => useActivityDeleteStyleReviewOverride(true, reviewPage));
    expect(result.current).toBeNull();
    // The page learns the frame listens, so it can send its current choice.
    await vi.waitFor(() => expect(ready).toHaveBeenCalledWith({ type: ACTIVITY_DELETE_STYLE_REVIEW_READY }));
    post(reviewPage, "hold");
    expect(result.current).toBe("hold");
    post(stranger, "undo");
    post(reviewPage, "bogus");
    expect(result.current).toBe("hold");
    const release = renderHook(() => useActivityDeleteStyleReviewOverride(false, reviewPage));
    post(reviewPage, "panel");
    expect(release.result.current).toBeNull();
  });
});
