// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriftAlarm, buildDriftAlarmEvent, type DriftAlarmAction } from "./DriftAlarm";

describe("DriftAlarm break pending state", () => {
  it("keeps start break pending for 300ms before sending the action", async () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildDriftAlarmEvent({
      id: "alarm-break-pending",
      contextLabel: "youtube.com",
      driftDurationSeconds: 2 * 60,
      preservedFocusStrikeSeconds: 32 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
      focusTargets: [],
    });

    render(<DriftAlarm event={event} onAction={onAction} />);

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
      fireEvent.click(screen.getByRole("button", { name: "15m" }));

      expect(screen.getByRole("status", { name: "Starting break" })).toBeTruthy();
      expect(onAction).not.toHaveBeenCalled();

      await advanceBreakActionDelay(299);
      expect(onAction).not.toHaveBeenCalled();

      await advanceBreakActionDelay(1);
      expect(onAction).toHaveBeenCalledWith({ type: "start_break", minutes: 15 });
    } finally {
      vi.useRealTimers();
    }
  });
});

async function advanceBreakActionDelay(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
}
