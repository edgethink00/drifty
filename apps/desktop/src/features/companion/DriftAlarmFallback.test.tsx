// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriftAlarm, buildDriftAlarmEvent, type DriftAlarmAction } from "./DriftAlarm";

describe("DriftAlarm fallback states", () => {
  it("uses fallback context text and hour labels for long preview events", () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildDriftAlarmEvent({
      id: "alarm-no-context",
      contextLabel: "",
      driftDurationSeconds: 60 * 60,
      preservedFocusStrikeSeconds: 2 * 60 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
    });

    render(<DriftAlarm event={event} onAction={onAction} />);

    expect(screen.getByText("Let's get you back in flow.")).toBeTruthy();
    expect(screen.getAllByText(/this drift/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("(now drifting)")).toBeNull();
    expect(screen.queryByText(/1 hour drift/i)).toBeNull();
    expect(screen.queryByText(/streak/i)).toBeNull();
  });

  it("caps custom break options at one hour and falls back when focus targets are empty", async () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildDriftAlarmEvent({
      id: "alarm-empty-focus",
      contextLabel: "x.com",
      driftDurationSeconds: 8 * 60,
      preservedFocusStrikeSeconds: 45 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
      breakOptions: [5, 90],
      focusTargets: [],
    });

    render(<DriftAlarm event={event} onAction={onAction} />);

    expect(screen.getByText(/no recent focus destination yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take a break" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    expect(screen.getByRole("button", { name: "1h" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "90m" })).toBeNull();

    vi.useFakeTimers();
    try {
      const fallbackTarget = screen.getByRole("button", { name: "Back to dashboard" });
      fireEvent.click(fallbackTarget);
      expect(fallbackTarget.classList.contains("is-pending")).toBe(true);
      expect(fallbackTarget.getAttribute("aria-busy")).toBe("true");
      expect(onAction).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(onAction).toHaveBeenCalledWith({ type: "return_to_focus", targetId: "dashboard" });
  });
});
