// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowChartScrollArea } from "./FlowChartScrollArea";

describe("reading a scrollable day", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 1152 } as DOMRect);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("keeps the same hour spacing and reading position inside a scaled preview", () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(1152);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ height: 1152 * 0.86 } as DOMRect);
    render(<FlowChartScrollArea scale={{ zoomPercent: 150, dayKey: "preview", initialMinute: 352 }} label="Day">timeline</FlowChartScrollArea>);
    const region = screen.getByRole("region", { name: "Day" });
    expect(region.style.getPropertyValue("--flow-scroll-hour-height")).toBe("72px");
    expect(region.scrollTop).toBeCloseTo(378.4);
  });
  it("waits for the first activity, then preserves the reader's position as data arrives", () => {
    const scale = { zoomPercent: 200, dayKey: "2026-10-16", initialMinute: null as number | null };
    const { rerender } = render(<FlowChartScrollArea scale={scale} label="Day">timeline</FlowChartScrollArea>);
    const region = screen.getByRole("region", { name: "Day" });
    expect(region.scrollTop).toBe(0);
    rerender(<FlowChartScrollArea scale={{ ...scale, initialMinute: 352 }} label="Day">timeline</FlowChartScrollArea>);
    expect(region.scrollTop).toBeCloseTo(507.2);
    region.scrollTop = 1000;
    rerender(<FlowChartScrollArea scale={{ ...scale, initialMinute: 400 }} label="Day">new timeline</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(1000);
    rerender(<FlowChartScrollArea scale={{ ...scale, dayKey: "2026-10-17", initialMinute: 180 }} label="Day">next date</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(232);
  });
  it("keeps the same viewed time when the relative zoom changes", () => {
    const scale = { zoomPercent: 150, dayKey: "2026-10-16", initialMinute: 352 };
    const { rerender } = render(<FlowChartScrollArea scale={scale} label="Day">timeline</FlowChartScrollArea>);
    const region = screen.getByRole("region", { name: "Day" });
    region.scrollTop = 600;
    fireEvent.scroll(region);
    rerender(<FlowChartScrollArea scale={{ ...scale, zoomPercent: 200 }} label="Day">timeline</FlowChartScrollArea>);
    expect(region.scrollTop).toBeCloseTo(800);
  });

  it("restores a revisited day but an explicit Now request overrides its saved position only once", () => {
    const onReadMinuteChange = vi.fn();
    const scale = { zoomPercent: 200, dayKey: "yesterday", initialMinute: 300, initialScrollMinute: 120, onReadMinuteChange };
    const { rerender } = render(<FlowChartScrollArea scale={scale} label="Day">timeline</FlowChartScrollArea>);
    const region = screen.getByRole("region", { name: "Day" });
    expect(region.scrollTop).toBe(192);
    const today = { ...scale, dayKey: "today", initialMinute: 300, nowMinute: 900, initialScrollMinute: 240, positionRequest: 0 };
    rerender(<FlowChartScrollArea scale={today} label="Day">today</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(384);
    rerender(<FlowChartScrollArea scale={{ ...today, positionRequest: 1 }} label="Day">now</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(1384);
    expect(onReadMinuteChange).toHaveBeenCalledWith(865);
    rerender(<FlowChartScrollArea scale={scale} label="Day">yesterday</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(192);
    rerender(<FlowChartScrollArea scale={{ ...today, positionRequest: 1 }} label="Day">today again</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(384);
  });

  it("opens today at its first record and moves down only to keep now in view", () => {
    // 200% of a 1152px view is 96px an hour, 12 hours on screen.
    const scale = { zoomPercent: 200, dayKey: "today", initialMinute: null as number | null, nowMinute: 317 };
    const { rerender } = render(<FlowChartScrollArea scale={scale} label="Day">loading</FlowChartScrollArea>);
    const region = screen.getByRole("region", { name: "Day" });
    // Today waits for its records instead of opening on the current hour.
    expect(region.scrollTop).toBe(0);
    rerender(<FlowChartScrollArea scale={{ ...scale, initialMinute: 300 }} label="Day">records from 300</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(424);
    // A day longer than the screen keeps now 30 minutes (48px) above the bottom.
    rerender(<FlowChartScrollArea scale={{ ...scale, dayKey: "long", initialMinute: 300, nowMinute: 1140 }} label="Day">long day</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(720);
    expect(1140 / 60 * 96 - region.scrollTop).toBe(1152 - 48);
    rerender(<FlowChartScrollArea scale={{ ...scale, dayKey: "morning", initialMinute: 0 }} label="Day">records from the start</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(0);
  });
});


it("preserves the last read minute when a shorter canvas clamps scrollTop before the layout effect", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 1152 } as DOMRect);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  try {
    const scale = { zoomPercent: 300, dayKey: "2026-10-16", initialMinute: 352 };
    const { rerender } = render(<FlowChartScrollArea scale={scale} label="Day">timeline</FlowChartScrollArea>);
    const region = screen.getByRole("region", { name: "Day" });
    region.scrollTop = 1500;
    fireEvent.scroll(region);
    // Simulate the browser's clamp after DOM size changes, before layout effects.
    region.scrollTop = 576;
    rerender(<FlowChartScrollArea scale={{ ...scale, zoomPercent: 150 }} label="Day">timeline</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(750);
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it("keeps a reader's chosen hour on an empty day when data arrives and when zoom changes", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 1152 } as DOMRect);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  try {
    const scale = { zoomPercent: 150, dayKey: "2026-10-16", initialMinute: null as number | null };
    const { rerender } = render(<FlowChartScrollArea scale={scale} label="Day">timeline</FlowChartScrollArea>);
    const region = screen.getByRole("region", { name: "Day" });
    region.scrollTop = 500;
    fireEvent.scroll(region);
    rerender(<FlowChartScrollArea scale={{ ...scale, initialMinute: 600 }} label="Day">loaded timeline</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(500);
    rerender(<FlowChartScrollArea scale={{ ...scale, initialMinute: 600, zoomPercent: 300 }} label="Day">loaded timeline</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(1000);
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
