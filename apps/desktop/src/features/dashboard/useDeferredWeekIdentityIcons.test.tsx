// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeferredWeekIdentityIcons } from "./useDeferredWeekIdentityIcons";

function DeferredIdentityIconProbe({ startDay, endDay }: { readonly startDay: string; readonly endDay: string }) {
  const canMountIdentityIcons = useDeferredWeekIdentityIcons({ startDay, endDay });
  return <span>{canMountIdentityIcons ? "ready" : "pending"}</span>;
}

describe("useDeferredWeekIdentityIcons", () => {
  let frameCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    frameCallbacks = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function runNextFrame() {
    const callbacks = frameCallbacks;
    frameCallbacks = [];
    act(() => {
      for (const callback of callbacks) callback(0);
    });
  }

  it("mounts a week's icons on the frame after its calendar first renders", () => {
    render(<DeferredIdentityIconProbe startDay="2026-05-18" endDay="2026-05-24" />);
    expect(screen.getByText("pending")).toBeTruthy();

    runNextFrame();

    expect(screen.getByText("ready")).toBeTruthy();
  });

  it("keeps icons mounted while the same week re-renders with new data", () => {
    const { rerender } = render(<DeferredIdentityIconProbe startDay="2026-05-18" endDay="2026-05-24" />);
    runNextFrame();

    rerender(<DeferredIdentityIconProbe startDay="2026-05-18" endDay="2026-05-24" />);

    expect(screen.getByText("ready")).toBeTruthy();
    expect(frameCallbacks).toHaveLength(0);
  });

  it("defers again for a different week without first showing the previous week's icons", () => {
    const { rerender } = render(<DeferredIdentityIconProbe startDay="2026-05-18" endDay="2026-05-24" />);
    runNextFrame();

    rerender(<DeferredIdentityIconProbe startDay="2026-05-11" endDay="2026-05-17" />);
    expect(screen.getByText("pending")).toBeTruthy();

    runNextFrame();
    expect(screen.getByText("ready")).toBeTruthy();
  });
});

