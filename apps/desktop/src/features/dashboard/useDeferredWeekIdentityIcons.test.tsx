// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeferredWeekIdentityIcons } from "./useDeferredWeekIdentityIcons";
import type { WeekCalendarEvent } from "./weekCalendar";

function DeferredIdentityIconProbe({ calendarEvents }: { readonly calendarEvents: Map<string, WeekCalendarEvent[]> }) {
  const canMountIdentityIcons = useDeferredWeekIdentityIcons({
    calendarEvents,
    endDay: "2026-05-24",
    startDay: "2026-05-18",
  });

  return <span>{canMountIdentityIcons ? "ready" : "pending"}</span>;
}

describe("useDeferredWeekIdentityIcons", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("waits for idle time after the first frame before mounting week identity icons", () => {
    vi.useFakeTimers();
    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;
    let frameCallback: FrameRequestCallback | null = null;
    let idleCallback: IdleRequestCallback | null = null;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 7;
      }),
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: vi.fn(),
    });

    try {
      render(<DeferredIdentityIconProbe calendarEvents={new Map()} />);

      expect(screen.getByText("pending")).toBeTruthy();

      act(() => {
        if (frameCallback) frameCallback(0);
      });
      expect(screen.getByText("pending")).toBeTruthy();

      act(() => {
        if (idleCallback) {
          idleCallback({
            didTimeout: false,
            timeRemaining: () => 10,
          });
        }
      });
      expect(screen.getByText("ready")).toBeTruthy();
    } finally {
      if (originalRequestIdleCallback) {
        Object.defineProperty(window, "requestIdleCallback", {
          configurable: true,
          value: originalRequestIdleCallback,
        });
      } else {
        Reflect.deleteProperty(window, "requestIdleCallback");
      }
      if (originalCancelIdleCallback) {
        Object.defineProperty(window, "cancelIdleCallback", {
          configurable: true,
          value: originalCancelIdleCallback,
        });
      } else {
        Reflect.deleteProperty(window, "cancelIdleCallback");
      }
    }
  });
});
