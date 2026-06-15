// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudTrialStartedNotice } from "./CloudTrialStartedNotice";

const notice = {
  trialEndsAt: "2026-06-20T00:00:00.000Z",
  detail: "Hosted Cloud AI is available until Jun 20.",
};

describe("CloudTrialStartedNotice", () => {
  afterEach(() => {
    vi.useRealTimers();
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
    const trialNotice = screen.getByRole("status", { name: /drifty cloud trial started/i });

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
});
