// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryView } from "./HistoryView";
import { readAppStyles } from "../../test/readStyles";
import { fireIntersection, installMockIntersectionObserver } from "../../test/intersectionObserverMock";

const styles = readAppStyles();

function cssRule(selector: string): string {
  return styles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[\\s\\S]*?\\}`))?.[0] ?? "";
}

const historySegments: ActivitySegment[] = [
  {
    id: "1",
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    browserName: "Google Chrome",
    durationSeconds: 600,
    endedAt: "2026-06-10T09:10:00+00:00",
    platform: "macos",
    siteDomain: "docs.example.com",
    siteTitle: "API reference",
    siteUrl: "https://docs.example.com/api",
    source: "accessibility",
    startedAt: "2026-06-10T09:00:00+00:00",
    windowTitle: "API reference - Chrome",
    classification: {
      category: "learning",
      productivity: "focus",
      source: "rule",
      confidence: 1,
    },
  },
  {
    id: "2",
    appName: "Acme Tracker",
    bundleId: "com.acme.tracker",
    durationSeconds: 900,
    endedAt: "2026-06-09T11:15:00+00:00",
    platform: "macos",
    source: "accessibility",
    startedAt: "2026-06-09T11:00:00+00:00",
    windowTitle: "Issue triage",
  },
];

function manyHistorySegments(count: number): ActivitySegment[] {
  const base = Date.UTC(2026, 5, 10, 0, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const startedAt = new Date(base + index * 5 * 60_000).toISOString();
    const endedAt = new Date(base + (index + 1) * 5 * 60_000).toISOString();
    return {
      id: `many-${index}`,
      appName: "cmux",
      bundleId: "com.example.cmux",
      durationSeconds: 300,
      endedAt,
      platform: "macos",
      source: "accessibility",
      startedAt,
      windowTitle: `Window ${index}`,
    };
  });
}

describe("HistoryView", () => {
  beforeEach(() => installMockIntersectionObserver());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders grouped local history and filters by query", () => {
    const { container } = render(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
    expect(screen.queryByText("Local records")).toBeNull();
    const toolbar = container.querySelector<HTMLElement>(".history-view__toolbar");
    expect(toolbar?.firstElementChild?.className).toBe("history-search");
    expect(screen.getByRole("heading", { name: "Jun 10, 2026" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Jun 9, 2026" })).toBeTruthy();
    expect(screen.getByText("docs.example.com")).toBeTruthy();
    expect(screen.getByText("Issue triage")).toBeTruthy();
    expect(screen.getByLabelText("Learning category")).toBeTruthy();
    expect(screen.queryByText("Search history")).toBeNull();

    const firstRow = screen.getByRole("checkbox", { name: /select api reference/i }).closest(".history-row");
    if (!firstRow) throw new Error("History row was not rendered");
    expect(Array.from(firstRow.children).map((child) => child.className)).toEqual([
      "history-row__check",
      "history-row__time",
      "history-row__identity",
      "history-row__category",
    ]);

    fireEvent.change(screen.getByRole("searchbox", { name: /search history/i }), {
      target: { value: "focus" },
    });

    expect(screen.getByText("docs.example.com")).toBeTruthy();
    expect(screen.queryByText("Issue triage")).toBeNull();
  });

  it("uses a neutral tone for selected history rows and danger tone for action buttons", () => {
    render(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={vi.fn()}
      />,
    );

    const firstRow = screen.getByRole("checkbox", { name: /select api reference/i }).closest(".history-row");
    if (!firstRow) throw new Error("History row was not rendered");

    fireEvent.click(screen.getByRole("checkbox", { name: /select api reference/i }));

    expect(firstRow.getAttribute("data-selected")).toBe("true");
    expect(cssRule('.history-row[data-selected="true"]')).toContain("background: color-mix(in srgb, var(--text-soft) 14%, var(--surface));");
    expect(cssRule('.history-row[data-selected="true"]')).not.toContain("var(--warn)");
    expect(cssRule('.history-row[data-selected="true"]')).not.toContain("var(--accent-soft)");
    expect(cssRule(".history-view .settings-btn--danger")).toMatch(/background:\s*var\(--warn\);[\s\S]*color:\s*var\(--canvas\);/);
  });

  it("keeps History search controls fixed while records scroll independently", () => {
    expect(cssRule(".content--history")).toContain("overflow-y: hidden;");
    expect(cssRule(".content--history .page--history")).toMatch(/display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".history-view")).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\);[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".history-groups")).toMatch(/min-height:\s*0;[\s\S]*overflow-y:\s*auto;/);
  });

  it("renders the newest history rows first and reveals older rows when scrolled into view", () => {
    const { container } = render(
      <HistoryView
        appIcons={{}}
        deleting={false}
        onDeleteSelected={vi.fn()}
        segments={manyHistorySegments(205)}
      />,
    );

    expect(screen.getAllByRole("checkbox", { name: /select window/i })).toHaveLength(200);
    expect(screen.getByText("Window 204")).toBeTruthy();
    expect(screen.queryByText("Window 0")).toBeNull();
    expect(container.querySelector(".history-scroll-sentinel")).not.toBeNull();

    act(() => fireIntersection(true));

    expect(screen.getAllByRole("checkbox", { name: /select window/i })).toHaveLength(205);
    expect(screen.getByText("Window 0")).toBeTruthy();
    expect(container.querySelector(".history-scroll-sentinel")).toBeNull();
  });

  it("anchors sparse search results to the top of the scroll region", () => {
    expect(cssRule(".history-groups")).toMatch(/align-content:\s*start;/);
    expect(cssRule(".history-group")).toMatch(/align-content:\s*start;/);
    expect(cssRule(".history-list")).toMatch(/align-content:\s*start;/);
  });

  it("requires confirmation before deleting selected history records", async () => {
    const deleteSelected = vi.fn().mockResolvedValue(undefined);
    render(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={deleteSelected}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /select api reference/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete 1 selected/i }));

    const dialog = screen.getByRole("dialog", { name: /delete history records/i });
    expect(within(dialog).getByText(/this removes 1 local activity record/i)).toBeTruthy();
    expect(deleteSelected).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull();
    expect(deleteSelected).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /delete 1 selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete records$/i }));

    await waitFor(() => expect(deleteSelected).toHaveBeenCalledWith(["1"]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull());
  });

  it("renders adjacent matching app and window records as one selectable row", async () => {
    const deleteSelected = vi.fn().mockResolvedValue(undefined);
    render(
      <HistoryView
        appIcons={{}}
        deleting={false}
        onDeleteSelected={deleteSelected}
        segments={[
          {
            id: "cmux-1",
            appName: "cmux",
            bundleId: "com.example.cmux",
            durationSeconds: 600,
            endedAt: "2026-06-10T09:10:00+00:00",
            platform: "macos",
            source: "accessibility",
            startedAt: "2026-06-10T09:00:00+00:00",
            windowTitle: "drifty_mac",
          },
          {
            id: "cmux-2",
            appName: "cmux",
            bundleId: "com.example.cmux",
            durationSeconds: 1_200,
            endedAt: "2026-06-10T09:30:00+00:00",
            platform: "macos",
            source: "accessibility",
            startedAt: "2026-06-10T09:10:00+00:00",
            windowTitle: "drifty_mac",
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("checkbox", { name: /select drifty_mac/i })).toHaveLength(1);
    expect(screen.getByText("30m")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /select drifty_mac/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete 2 selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete records$/i }));

    await waitFor(() => expect(deleteSelected).toHaveBeenCalledWith(["cmux-1", "cmux-2"]));
  });
});
