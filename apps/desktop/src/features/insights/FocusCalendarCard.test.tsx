// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment } from "@drifty/domain";
import type { CompactHistoryLoad } from "../dashboard/compactHistoryCache";
import { alignCalendarTooltip, FOCUS_CALENDAR_TOOLTIP_DELAY_MS, FocusCalendarCard } from "./FocusCalendarCard";

const emptyLoad = { materialized: { segments: [] } } as unknown as CompactHistoryLoad;
const base = { endDay: "2026-09-09", startOfDayMinutes: 0, recentSegments: [], classificationOptions: {}, variant: "year" as const };

function focusSegment(startedAt: string, endedAt: string): ActivitySegment {
  return {
    id: startedAt,
    startedAt,
    endedAt,
    durationSeconds: (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    appName: "Fixture",
    windowTitle: "",
    platform: "macos",
    source: "nsworkspace",
    classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1, reason: "fixture" },
  };
}

const focusedLoad = {
  materialized: {
    segments: [
      focusSegment("2026-09-08T10:00:00", "2026-09-08T11:00:00"),
      focusSegment("2026-09-09T10:00:00", "2026-09-09T12:00:00"),
    ],
  },
} as unknown as CompactHistoryLoad;

describe("FocusCalendarCard", () => {
  afterEach(() => cleanup());
  it("defaults to five months without requiring a review parameter", async () => {
    render(<FocusCalendarCard {...base} variant={undefined} loadHistory={vi.fn().mockResolvedValue(emptyLoad)} />);
    await waitFor(() => expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(153));
    expect(document.querySelector(".focus-calendar")?.getAttribute("data-calendar-variant")).toBe("half");
  });
  it.each(["half", "half-compact", "quarter"] as const)("renders %s without future dates and preserves keyboard navigation", async variant => {
    render(<FocusCalendarCard {...base} variant={variant} loadHistory={vi.fn().mockResolvedValue(emptyLoad)} />);
    const count = variant === "quarter" ? 92 : 153;
    await waitFor(() => expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(count));
    expect(document.querySelectorAll(".focus-calendar__cell:disabled")).toHaveLength(0);
    expect(screen.getAllByText(variant === "quarter" ? "Last 3 months" : "Last 5 months").length).toBeGreaterThanOrEqual(1);
    const finalCell = document.querySelector<HTMLButtonElement>(`[data-day-index="${count - 1}"]`)!;
    fireEvent.keyDown(finalCell, { key: "Home" });
    expect(document.activeElement?.getAttribute("data-day-index")).toBe("0");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.getAttribute("data-day-index")).toBe(String(count - 1));
  });
  it("does not render zero-value dates during a failed load and supports retry", async () => {
    const loadHistory = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(emptyLoad);
    render(<FocusCalendarCard {...base} loadHistory={loadHistory} />);
    expect(screen.getByText("Loading daily focus…")).toBeTruthy();
    expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(0);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(365));
    expect(screen.queryByText("0 days with focus")).toBeNull();
    expect(document.querySelector(".focus-calendar__footer")).toBeNull();
    expect(document.querySelector(".focus-calendar__legend")).toBeNull();
    expect(screen.getByRole("group", { name: /Daily focus time/ }).getAttribute("aria-description")).toContain("under 1 hour");
    expect(document.querySelector(".focus-calendar__detail")).toBeNull();
    expect(document.querySelector(".contribution-grid__day--selected")).toBeNull();
    expect(document.querySelector(".focus-calendar__cell")?.getAttribute("aria-label")).toMatch(/No record/);
    expect(document.querySelector(".focus-calendar__cell")?.getAttribute("title")).toBeNull();
  });
  it("keeps one keyboard stop and replaces old dates with loading on range change", async () => {
    let resolveNext!: (result: CompactHistoryLoad) => void;
    const loadHistory = vi.fn().mockResolvedValueOnce(emptyLoad).mockImplementationOnce(() => new Promise<CompactHistoryLoad>(resolve => { resolveNext = resolve; }));
    const { rerender } = render(<FocusCalendarCard {...base} loadHistory={loadHistory} />);
    await waitFor(() => expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(365));
    const last = document.querySelector<HTMLButtonElement>('[data-day-index="181"]')!;
    fireEvent.keyDown(last, { key: "ArrowLeft" });
    expect(document.activeElement?.getAttribute("data-day-index")).toBe("174");
    expect(document.querySelectorAll('.focus-calendar__cell[tabindex="0"]')).toHaveLength(1);
    rerender(<FocusCalendarCard {...base} endDay="2026-08-09" loadHistory={loadHistory} />);
    expect(screen.getByText("Loading daily focus…")).toBeTruthy();
    expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(0);
    await act(async () => resolveNext(emptyLoad));
    await waitFor(() => expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(365));
    expect(document.querySelectorAll('.focus-calendar__cell:disabled').length).toBeGreaterThan(0);
  });
  it("shows a GitHub-style delayed tooltip and follows neighboring cells immediately", async () => {
    render(<FocusCalendarCard {...base} loadHistory={vi.fn().mockResolvedValue(focusedLoad)} />);
    await waitFor(() => expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(365));
    const first = document.querySelector<HTMLButtonElement>(".contribution-grid__day--2")!;
    const next = document.querySelector<HTMLButtonElement>(".contribution-grid__day--3")!;
    const grid = document.querySelector(".contribution-grid")!;
    vi.useFakeTimers();
    try {
      fireEvent.pointerOver(first);
      expect(document.querySelector(".focus-calendar__tooltip")).toBeNull();
      act(() => { vi.advanceTimersByTime(FOCUS_CALENDAR_TOOLTIP_DELAY_MS - 1); });
      expect(document.querySelector(".focus-calendar__tooltip")).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      const tip = document.querySelector(".focus-calendar__tooltip");
      expect(tip?.textContent).toMatch(/Focus/);
      fireEvent.pointerOver(next);
      expect(document.querySelector(".focus-calendar__tooltip")?.textContent).toMatch(/Focus/);
      fireEvent.pointerLeave(grid);
      expect(document.querySelector(".focus-calendar__tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not show a tooltip on colorless days with no focus", async () => {
    render(<FocusCalendarCard {...base} loadHistory={vi.fn().mockResolvedValue(focusedLoad)} />);
    await waitFor(() => expect(document.querySelectorAll(".focus-calendar__cell")).toHaveLength(365));
    const empty = document.querySelector<HTMLButtonElement>(".contribution-grid__day--0")!;
    vi.useFakeTimers();
    try {
      fireEvent.pointerOver(empty);
      act(() => { vi.advanceTimersByTime(FOCUS_CALENDAR_TOOLTIP_DELAY_MS); });
      expect(document.querySelector(".focus-calendar__tooltip")).toBeNull();
      const focused = document.querySelector<HTMLButtonElement>(".contribution-grid__day--3")!;
      fireEvent.pointerOver(focused);
      act(() => { vi.advanceTimersByTime(FOCUS_CALENDAR_TOOLTIP_DELAY_MS); });
      expect(document.querySelector(".focus-calendar__tooltip")?.textContent).toMatch(/Focus/);
      fireEvent.pointerOver(empty);
      expect(document.querySelector(".focus-calendar__tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("alignCalendarTooltip", () => {
  it("keeps a right-edge cell tooltip inside the window and shifts the caret toward the square", () => {
    expect(alignCalendarTooltip(980, 200, 1000, 12)).toEqual({ left: 888, caretShift: 90 });
  });
  it("keeps a left-edge cell tooltip inside the window", () => {
    expect(alignCalendarTooltip(20, 200, 1000, 12)).toEqual({ left: 112, caretShift: -90 });
  });
  it("leaves a centered cell unshifted", () => {
    expect(alignCalendarTooltip(500, 200, 1000, 12)).toEqual({ left: 500, caretShift: 0 });
  });
});
