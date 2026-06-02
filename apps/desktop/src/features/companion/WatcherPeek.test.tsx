// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WatcherPeek, type WatcherPeekEvent } from "./WatcherPeek";

function buildEvent(overrides: Partial<WatcherPeekEvent>): WatcherPeekEvent {
  return {
    id: 1,
    productivity: "neutral",
    category: "unknown",
    contextLabel: "your current workspace",
    durationLabel: "a moment",
    durationSeconds: 0,
    slotIndex: 0,
    focusSessionKind: "settled",
    driftPattern: "first",
    driftReminderElapsedSeconds: null,
    recentWatcherResponse: null,
    minutesSinceLastWatcher: null,
    focusSecondsToday: 0,
    currentHourFocusSeconds: 0,
    ...overrides,
  };
}

const neutralEvent = buildEvent({
  id: 1,
  productivity: "neutral",
  category: "unknown",
  contextLabel: "your current workspace",
  durationLabel: "a moment",
  slotIndex: 0,
});

const focusEvent = buildEvent({
  id: 2,
  productivity: "focus",
  category: "workspace",
  contextLabel: "Code",
  durationLabel: "42m",
  slotIndex: 1,
  focusSessionKind: "deep",
});

const driftEvent = buildEvent({
  id: 3,
  productivity: "drift",
  category: "entertainment",
  contextLabel: "Videos",
  durationLabel: "12m",
  durationSeconds: 720,
  slotIndex: 2,
  driftPattern: "after_snooze",
  recentWatcherResponse: "snooze",
});

describe("WatcherPeek", () => {
  it("peeks first, then reveals a passive check-in", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onRespond = vi.fn();

    render(<WatcherPeek event={neutralEvent} onDismiss={onDismiss} onRespond={onRespond} />);

    const watcher = screen.getByLabelText("Drifty watcher check-in");
    expect(watcher.getAttribute("data-phase")).toBe("peeking");
    expect(watcher.querySelector(".watcher-peek__orb")).toBeTruthy();
    expect(watcher.querySelector(".watcher-peek__visitor")).toBeNull();
    expect(watcher.querySelector("button")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2_400);
    });

    expect(watcher.getAttribute("data-phase")).toBe("speaking");
    expect(watcher.querySelector("button")).toBeNull();
    expect(onRespond).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("briefly encourages focused work and leaves on its own", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(<WatcherPeek event={focusEvent} onDismiss={onDismiss} onRespond={vi.fn()} />);

    const watcher = screen.getByLabelText("Drifty watcher check-in");
    expect(watcher.getAttribute("data-presence")).toBe("encouraging");

    act(() => {
      vi.advanceTimersByTime(2_200);
    });

    expect(screen.getByText(/화이팅\. Don’t break this\./i)).toBeTruthy();
    expect(watcher.getAttribute("data-phase")).toBe("speaking");
    expect(watcher.querySelector("button")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(6_300);
    });

    expect(watcher.getAttribute("data-phase")).toBe("leaving");

    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("interrupts drift sooner and keeps the card active longer", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(<WatcherPeek event={driftEvent} onDismiss={onDismiss} onRespond={vi.fn()} />);

    const watcher = screen.getByLabelText("Drifty watcher check-in");
    expect(watcher.getAttribute("data-presence")).toBe("interrupting");

    act(() => {
      vi.advanceTimersByTime(2_300);
    });

    expect(watcher.getAttribute("data-phase")).toBe("speaking");
    expect(screen.getByText(/You asked for 5/i)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(watcher.getAttribute("data-phase")).toBe("speaking");
    expect(onDismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("names elapsed time for drift-only reminders", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(<WatcherPeek event={buildEvent({ ...driftEvent, driftReminderElapsedSeconds: 30 * 60 })} onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(2_300);
    });

    expect(screen.getByText(/30 minutes passed\./i)).toBeTruthy();
    expect(screen.getByText(/30 minutes around Videos/i)).toBeTruthy();
    vi.useRealTimers();
  });

  it("supports the first 10 second drift-only reminder", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(<WatcherPeek event={buildEvent({ ...driftEvent, driftReminderElapsedSeconds: 10 })} onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(2_300);
    });

    expect(screen.getByText(/10 seconds passed\./i)).toBeTruthy();
    expect(screen.getByText(/10 seconds around Videos/i)).toBeTruthy();
    vi.useRealTimers();
  });
});
