// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudTrialStartedNotice } from "./CloudTrialStartedNotice";

const notice = {
  accessSource: "standard_trial" as const,
  trialEndsAt: "2026-06-20T00:00:00.000Z",
};

describe("CloudTrialStartedNotice", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("dismisses itself after the 5-second timer finishes", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(<CloudTrialStartedNotice notice={notice} onDismiss={onDismiss} />);

    expect(screen.getByRole("timer", { name: /closes in 5 seconds/i })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("pauses the timer while the notice is hovered", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(<CloudTrialStartedNotice notice={notice} onDismiss={onDismiss} />);
    const trialNotice = screen.getByRole("status", { name: /drifty pro trial started/i });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    fireEvent.mouseEnter(trialNotice);
    expect(trialNotice.classList.contains("is-paused")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(trialNotice);
    expect(trialNotice.classList.contains("is-paused")).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("holds the timer while keyboard focus is inside the notice, even when the pointer leaves", () => {
    vi.useFakeTimers();
    // jsdom's hasFocus() only reports whether an element is focused, so a
    // blur inside a still-active window would read as an app switch. Model the
    // window's focus explicitly instead.
    const windowHasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const onDismiss = vi.fn();

    render(<CloudTrialStartedNotice notice={notice} onDismiss={onDismiss} onOpenAiSetup={vi.fn()} />);
    const trialNotice = screen.getByRole("status", { name: /drifty pro trial started/i });
    const dismissButton = trialNotice.querySelector<HTMLButtonElement>(".cloud-trial-started-notice__dismiss");
    const actionButton = screen.getByRole("button", { name: /ai setup/i });
    if (!dismissButton) throw new Error("dismiss button did not render");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      actionButton.focus();
    });
    expect(trialNotice.classList.contains("is-paused")).toBe(true);

    // Tabbing between the notice's own buttons keeps it held.
    act(() => {
      dismissButton.focus();
    });
    expect(trialNotice.classList.contains("is-paused")).toBe(true);

    // Switching to another app blurs the button without moving focus out.
    windowHasFocus.mockReturnValue(false);
    act(() => {
      dismissButton.blur();
    });
    expect(trialNotice.classList.contains("is-paused")).toBe(true);
    windowHasFocus.mockReturnValue(true);
    act(() => {
      dismissButton.focus();
    });

    // Hovering and leaving must not resume while focus is still inside.
    fireEvent.mouseEnter(trialNotice);
    fireEvent.mouseLeave(trialNotice);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(trialNotice.classList.contains("is-paused")).toBe(true);

    act(() => {
      dismissButton.blur();
    });
    expect(trialNotice.classList.contains("is-paused")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("labels a promotional pass without calling it a one-week trial", () => {
    render(<CloudTrialStartedNotice
      notice={{
        accessSource: "promotion",
        trialEndsAt: "2026-10-26T00:00:00.000Z",
      }}
      onDismiss={vi.fn()}
    />);

    expect(screen.getByRole("status", { name: /pro pass ready/i })).toBeTruthy();
    expect(screen.getByText("Your Drifty Pro pass is ready")).toBeTruthy();
    expect(screen.queryByText(/1-week free trial/i)).toBeNull();
  });
});
