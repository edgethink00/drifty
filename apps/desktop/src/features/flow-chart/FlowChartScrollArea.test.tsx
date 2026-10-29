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
    // Now lands where opening today does: 15:00 at 58% of the 1152px view.
    expect(region.scrollTop).toBeCloseTo(771.84);
    expect(onReadMinuteChange).toHaveBeenCalledWith(expect.closeTo(482.4));
    rerender(<FlowChartScrollArea scale={scale} label="Day">yesterday</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(192);
    rerender(<FlowChartScrollArea scale={{ ...today, positionRequest: 1 }} label="Day">today again</FlowChartScrollArea>);
    expect(region.scrollTop).toBe(384);
  });

  it("opens today with now where Your Week puts it, keeping a morning's hours in view", () => {
    // 200% of a 1152px view is 96px an hour; now sits 668.16px (58%) down the view.
    const scale = { zoomPercent: 200, dayKey: "today", initialMinute: null as number | null, nowMinute: 900 };
    const { rerender } = render(<FlowChartScrollArea scale={scale} label="Day">timeline</FlowChartScrollArea>);
    const region = screen.getByRole("region", { name: "Day" });
    // Today does not wait for its records, and their first run does not move it.
    expect(region.scrollTop + 668.16).toBeCloseTo(900 / 60 * 96);
    rerender(<FlowChartScrollArea scale={{ ...scale, initialMinute: 60 }} label="Day">loaded</FlowChartScrollArea>);
    expect(region.scrollTop).toBeCloseTo(771.84);
    // Early in the day everything since the day began fits above now.
    rerender(<FlowChartScrollArea scale={{ ...scale, dayKey: "early", initialMinute: 0, nowMinute: 317 }} label="Day">morning</FlowChartScrollArea>);
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
