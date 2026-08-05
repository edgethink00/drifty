// @vitest-environment jsdom
import type { ActivitySegment } from "@drifty/domain";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANION_REENTRY_STORAGE_KEY } from "./companionReentry";
import {
  COMPANION_REENTRY_CONFIRMATION_DELAY_MS,
  useCompanionReentryMoment,
} from "./useCompanionReentryMoment";

const mocks = vi.hoisted(() => ({
  getTimelinePage: vi.fn(),
  showReentry: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../lib/api/trackerClient", () => ({
  trackerClient: { getTimelinePage: mocks.getTimelinePage },
}));

vi.mock("./watcherBridge", () => ({
  isTauriRuntime: () => true,
  showNativeCompanionReentry: mocks.showReentry,
}));

const NOW = new Date(2026, 7, 5, 9, 30).getTime();

function Harness({
  announcementsEnabled = true,
  activitySignal = new Date(NOW - 10_000).toISOString(),
}: {
  announcementsEnabled?: boolean;
  activitySignal?: string;
}) {
  useCompanionReentryMoment({
    ready: true,
    announcementsEnabled,
    activitySignal,
    locale: "en-US",
  });
  return null;
}

describe("useCompanionReentryMoment", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("shows a newly observed return once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.getTimelinePage.mockResolvedValue({
      items: eligibleSegments(),
      hasMore: false,
      nextCursor: null,
    });

    const { rerender } = render(<Harness />);
    await act(async () => undefined);

    expect(mocks.showReentry).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPANION_REENTRY_CONFIRMATION_DELAY_MS);
    });

    expect(mocks.showReentry).toHaveBeenCalledOnce();
    expect(mocks.showReentry.mock.calls[0]?.[0]).toMatchObject({
      kind: "reentry",
      title: "Back after 8h 10m",
    });
    expect(window.localStorage.getItem(COMPANION_REENTRY_STORAGE_KEY)).toContain("companion-reentry:");

    rerender(<Harness activitySignal={new Date(NOW - 5_000).toISOString()} />);
    await act(async () => undefined);
    expect(mocks.showReentry).toHaveBeenCalledOnce();
  });

  it("keeps the ten-second confirmation delay across activity refreshes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.getTimelinePage.mockResolvedValue({
      items: eligibleSegments(),
      hasMore: false,
      nextCursor: null,
    });

    const { rerender } = render(<Harness />);
    await act(async () => undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPANION_REENTRY_CONFIRMATION_DELAY_MS / 2);
    });

    rerender(<Harness activitySignal={new Date(NOW - 5_000).toISOString()} />);
    await act(async () => undefined);
    expect(mocks.showReentry).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPANION_REENTRY_CONFIRMATION_DELAY_MS / 2);
    });
    expect(mocks.showReentry).toHaveBeenCalledOnce();
  });

  it("consumes a return while Companion is quiet so it never replays later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.getTimelinePage.mockResolvedValue({
      items: eligibleSegments(),
      hasMore: false,
      nextCursor: null,
    });

    const { rerender } = render(<Harness announcementsEnabled={false} />);
    await act(async () => undefined);
    expect(mocks.showReentry).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(COMPANION_REENTRY_STORAGE_KEY)).toContain("companion-reentry:");

    rerender(<Harness announcementsEnabled />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPANION_REENTRY_CONFIRMATION_DELAY_MS);
    });
    expect(mocks.showReentry).not.toHaveBeenCalled();
  });

  it("stays quiet when Companion is turned off during the confirmation delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.getTimelinePage.mockResolvedValue({
      items: eligibleSegments(),
      hasMore: false,
      nextCursor: null,
    });

    const { rerender } = render(<Harness />);
    await act(async () => undefined);
    rerender(<Harness announcementsEnabled={false} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPANION_REENTRY_CONFIRMATION_DELAY_MS);
    });
    expect(mocks.showReentry).not.toHaveBeenCalled();
  });

  it("drops a confirmation timer that became stale while the Mac was asleep", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.getTimelinePage.mockResolvedValue({
      items: eligibleSegments(),
      hasMore: false,
      nextCursor: null,
    });

    render(<Harness />);
    await act(async () => undefined);
    vi.setSystemTime(NOW + 16 * 60 * 1000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPANION_REENTRY_CONFIRMATION_DELAY_MS);
    });

    expect(mocks.showReentry).not.toHaveBeenCalled();
  });
});

function eligibleSegments(): ActivitySegment[] {
  return [
    segment("night", new Date(2026, 7, 5, 0, 55).getTime(), new Date(2026, 7, 5, 1, 18).getTime()),
    segment("morning", new Date(2026, 7, 5, 9, 28).getTime(), new Date(2026, 7, 5, 9, 29).getTime()),
  ];
}

function segment(id: string, startedAtMs: number, endedAtMs: number): ActivitySegment {
  return {
    id,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationSeconds: Math.max(1, Math.floor((endedAtMs - startedAtMs) / 1000)),
    appName: "Example",
    platform: "macos",
    source: "accessibility",
  };
}
