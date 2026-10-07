// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryView } from "./HistoryView";
import { readAppStyles, readCssWithImports } from "../../test/readStyles";
import { fireIntersection, installMockIntersectionObserver } from "../../test/intersectionObserverMock";

const styles = `${readAppStyles()}\n${readCssWithImports("src/features/history/history.css")}`;

function cssRule(selector: string): string {
  return [...styles.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[\\s\\S]*?\\}`, "g"))]
    .map(([rule]) => rule)
    .join("\n");
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
    const identity = firstRow.querySelector(".history-row__identity");
    expect(Array.from(identity?.children ?? []).map((child) => child.className)).toEqual([
      "usage-identity-icon usage-identity-icon--sm history-row__identity-icon",
      "history-row__identity-copy",
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
    // The danger fill is a system-level modifier, not a History-only rule: the
    // same class is used elsewhere (e.g. the deferred tab fallback) and used to
    // render with no danger signal at all outside this view.
    expect(cssRule(".app-btn--danger")).toContain("background: var(--button-danger-bg);");
    expect(cssRule(".app-btn--danger")).toContain("color: var(--button-danger-ink);");
  });

  it("toggles history row selection when the row block is clicked", () => {
    render(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /select api reference/i });
    if (!(checkbox instanceof HTMLInputElement)) throw new Error("History row selector was not a checkbox");
    const firstRow = checkbox.closest(".history-row");
    if (!firstRow) throw new Error("History row was not rendered");

    fireEvent.click(firstRow);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: /delete 1 selected/i })).toBeTruthy();

    fireEvent.click(firstRow);
    expect(checkbox.checked).toBe(false);
    // With nothing selected the selection-delete action leaves the toolbar
    // entirely instead of lingering as a disabled button.
    expect(screen.queryByRole("button", { name: /delete selected/i })).toBeNull();
  });

  it("hides row-management controls in the initial empty state", () => {
    const onOpenDeleteHistory = vi.fn();

    const { container } = render(
      <HistoryView
        appIcons={{}}
        deleting={false}
        onDeleteSelected={vi.fn()}
        onOpenDeleteHistory={onOpenDeleteHistory}
        segments={[]}
      />,
    );

    expect(container.querySelector(".history-view__toolbar")).toBeNull();
    expect(screen.queryByRole("searchbox", { name: /search history/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete selected$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete history/i })).toBeNull();
    expect(screen.getByText("No history records found.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "History" }).className).toContain("history-view--empty");
  });

  it("keeps row-management controls when an existing history search has no matches", () => {
    render(
      <HistoryView
        appIcons={{}}
        deleting={false}
        onDeleteSelected={vi.fn()}
        onOpenDeleteHistory={vi.fn()}
        segments={historySegments}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /search history/i }), {
      target: { value: "no matching activity" },
    });

    expect(screen.getByRole("searchbox", { name: /search history/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete selected/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^delete history/i })).toBeTruthy();
    expect(screen.getByText("Try another search.")).toBeTruthy();
  });

  it("shows a failed backend search instead of an empty result and retries it", () => {
    const onLoadMore = vi.fn();

    render(
      <HistoryView
        appIcons={{}}
        deleting={false}
        loadMoreError="tracker_search_timeline failed"
        onDeleteSelected={vi.fn()}
        onLoadMore={onLoadMore}
        searchQuery="backend-only-token"
        searchUsesBackend
        segments={[]}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe("tracker_search_timeline failed");
    expect(screen.queryByText("No history records found.")).toBeNull();
    expect(screen.queryByText("Try another search.")).toBeNull();
    expect(screen.getByRole("searchbox", { name: /search history/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("keeps History search controls fixed while records scroll independently", () => {
    expect(cssRule(".content--history")).toContain("overflow-y: hidden;");
    expect(cssRule(".content--history .page--history")).toMatch(/display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".history-view")).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\);[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".history-groups")).toMatch(/min-height:\s*0;[\s\S]*overflow-y:\s*auto;/);
  });

  it("sizes the search field and its toolbar buttons from one height and one pill shape", () => {
    expect(cssRule(".history-view__toolbar")).toContain("--history-toolbar-height: 2.3125rem;");
    expect(cssRule(".history-view__toolbar .app-btn")).toMatch(/--btn-h:\s*var\(--history-toolbar-height\);[\s\S]*border-radius:\s*var\(--radius-pill\);/);
    expect(cssRule(".history-search")).toMatch(/height:\s*var\(--history-toolbar-height, 2.3125rem\);[\s\S]*border-radius:\s*999px;/);
  });

  it("keeps history identity text styles off the icon slot", () => {
    expect(cssRule(".history-row__identity-copy")).toMatch(/display:\s*grid;[\s\S]*min-width:\s*0;/);
    expect(styles).toContain(".history-row__identity-copy span {\n  color: var(--text-soft);");
    expect(cssRule(".history-row__identity span")).toBe("");
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

    await waitFor(() => expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByRole("dialog", { name: /delete history records/i })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull());
    expect(deleteSelected).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /delete 1 selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete records$/i }));

    await waitFor(() => expect(deleteSelected).toHaveBeenCalledWith(["1"]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull());
  });

  it("owns focus while confirming selected-history deletion", async () => {
    const onDeleteSelected = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={onDeleteSelected}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /select api reference/i }));
    const opener = screen.getByRole("button", { name: /delete 1 selected/i });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: /delete history records/i });
    const cancel = within(dialog).getByRole("button", { name: /^cancel$/i });
    const confirm = within(dialog).getByRole("button", { name: /^delete records$/i });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    rerender(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting
        onDeleteSelected={onDeleteSelected}
      />,
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: /delete history records/i })).toBeTruthy();

    rerender(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={onDeleteSelected}
      />,
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: /delete history records/i })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("keeps the confirmation and selection after a failed deletion, then lets the user retry", async () => {
    const onDeleteSelected = vi.fn().mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValue(undefined);
    render(<HistoryView appIcons={{}} segments={historySegments} deleting={false} onDeleteSelected={onDeleteSelected} />);
    const checkbox = screen.getByRole("checkbox", { name: /select api reference/i });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /delete 1 selected/i }));
    const dialog = screen.getByRole("dialog", { name: /delete history records/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete records$/i }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Storage unavailable");
    expect(checkbox).toHaveProperty("checked", true);
    expect(within(dialog).getByRole("button", { name: /^delete records$/i })).toHaveProperty("disabled", false);
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete records$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull());
    expect(onDeleteSelected).toHaveBeenCalledTimes(2);
    expect(onDeleteSelected).toHaveBeenLastCalledWith(["1"]);
    expect(checkbox).toHaveProperty("checked", false);
  });

  it("shows post-deletion refresh failure and retries the view without another write", async () => {
    const onDeleteSelected = vi.fn().mockResolvedValue({ refreshFailed: true });
    const onRefreshAfterDelete = vi.fn().mockRejectedValueOnce(new Error("Still unavailable")).mockResolvedValue(undefined);
    render(<HistoryView appIcons={{}} segments={historySegments} deleting={false} onDeleteSelected={onDeleteSelected} onRefreshAfterDelete={onRefreshAfterDelete} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /select api reference/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete 1 selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete records$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull());
    expect(screen.getByRole("alert").textContent).toContain("The selected records were deleted");
    fireEvent.click(screen.getByRole("button", { name: "Refresh view" }));
    await waitFor(() => expect(onRefreshAfterDelete).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert").textContent).toContain("The selected records were deleted");
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh view" })).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByRole("button", { name: "Refresh view" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(onRefreshAfterDelete).toHaveBeenCalledTimes(2);
  });

  it("blocks duplicate confirmation and dismissal while the request is pending", async () => {
    let finish!: () => void;
    const onDeleteSelected = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<HistoryView appIcons={{}} segments={historySegments} deleting={false} onDeleteSelected={onDeleteSelected} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /select api reference/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete 1 selected/i }));
    const dialog = screen.getByRole("dialog", { name: /delete history records/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete records$/i }));
    const pending = within(dialog).getByRole("button", { name: "Deleting…" });
    expect(pending).toHaveProperty("disabled", true);
    fireEvent.click(pending);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("status").textContent).toBe("Deleting…");
    await act(async () => finish());
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
