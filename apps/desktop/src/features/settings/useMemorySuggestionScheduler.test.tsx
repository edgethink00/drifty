// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUGGESTION_SCHEDULER_FIRST_CHECK_MS, SUGGESTION_SCHEDULER_INTERVAL_MS, useMemorySuggestionScheduler } from "./useMemorySuggestionScheduler";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn(async () => "not_due") }));
vi.mock("../classification/memorySuggestionJob", () => ({ runMemorySuggestionJobIfDue: runMock }));

const provider = { kind: "cloud" } as const;

describe("useMemorySuggestionScheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); runMock.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it("checks shortly after launch and then every interval with the latest settings", () => {
    const { rerender, unmount } = renderHook((props: { language: "ko" | "en" }) => useMemorySuggestionScheduler({ ownerId: "u1", provider, language: props.language, enabled: true }), { initialProps: { language: "ko" as "ko" | "en" } });
    vi.advanceTimersByTime(SUGGESTION_SCHEDULER_FIRST_CHECK_MS - 1);
    expect(runMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(runMock).toHaveBeenLastCalledWith({ ownerId: "u1", provider, language: "ko", isCurrent: expect.any(Function) });
    rerender({ language: "en" });
    vi.advanceTimersByTime(SUGGESTION_SCHEDULER_INTERVAL_MS);
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock).toHaveBeenLastCalledWith({ ownerId: "u1", provider, language: "en", isCurrent: expect.any(Function) });
    unmount();
    vi.advanceTimersByTime(SUGGESTION_SCHEDULER_INTERVAL_MS * 3);
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it("stays idle without a provider or while disabled", () => {
    renderHook(() => useMemorySuggestionScheduler({ ownerId: "u1", provider: null, language: "ko", enabled: true }));
    renderHook(() => useMemorySuggestionScheduler({ ownerId: "u1", provider, language: "ko", enabled: false }));
    vi.advanceTimersByTime(SUGGESTION_SCHEDULER_INTERVAL_MS * 2);
    expect(runMock).not.toHaveBeenCalled();
  });
});

