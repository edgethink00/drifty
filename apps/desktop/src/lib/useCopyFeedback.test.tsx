// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { COPY_FEEDBACK_VISIBLE_MS, useCopyFeedback } from "./useCopyFeedback";

describe("useCopyFeedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a second confirmation for its full window instead of inheriting the first countdown", () => {
    const { result } = renderHook(() => useCopyFeedback<"html" | "markdown">());

    act(() => result.current.showCopied("html"));
    act(() => vi.advanceTimersByTime(COPY_FEEDBACK_VISIBLE_MS - 400));
    act(() => result.current.showCopied("markdown"));

    // The first copy's deadline passes; the newer confirmation must stay.
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.copiedKey).toBe("markdown");

    act(() => vi.advanceTimersByTime(COPY_FEEDBACK_VISIBLE_MS - 400));
    expect(result.current.copiedKey).toBeNull();
  });

  it("drops the confirmation immediately when cleared", () => {
    const { result } = renderHook(() => useCopyFeedback<string>());

    act(() => result.current.showCopied("link"));
    act(() => result.current.clearCopied());

    expect(result.current.copiedKey).toBeNull();
  });
});
