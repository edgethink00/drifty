// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryView } from "./HistoryView";
import { trackerClient } from "../../lib/api/trackerClient";
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
    expect(screen.getByRole("heading", { name: /Jun 10\b/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Jun 9\b/ })).toBeTruthy();
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

  it("puts the selection's delete in the Delete history slot instead of beside it", () => {
    render(
      <HistoryView
        appIcons={{}}
        deleting={false}
        onDeleteSelected={vi.fn()}
        onOpenDeleteHistory={vi.fn()}
        segments={historySegments}
      />,
    );

    const toolbar = document.querySelector(".history-view__toolbar");
    if (!toolbar) throw new Error("History toolbar was not rendered");
    expect(toolbar.querySelectorAll("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: /select api reference/i }));
    expect(toolbar.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Delete 1 selected" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^delete history/i })).toBeNull();
    // The one slot reserves both labels, so neither state narrows the search field.
    const reserved = Array.from(toolbar.querySelectorAll(".action-label__size"), (element) => element.textContent);
    expect(reserved).toEqual(expect.arrayContaining(["Delete history…", "Delete 888 selected"]));
  });

  it("keeps Delete history available when a backend search matches nothing", () => {
    render(
      <HistoryView
        appIcons={{}}
        deleting={false}
        onDeleteSelected={vi.fn()}
        onOpenDeleteHistory={vi.fn()}
        searchQuery="no matching activity"
        searchUsesBackend
        segments={[]}
      />,
    );

    const deleteHistory = screen.getByRole("button", { name: /^delete history/i });
    expect((deleteHistory as HTMLButtonElement).disabled).toBe(false);
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
    expect(cssRule(".history-view__toolbar")).toContain("--history-toolbar-height: 2.14rem;");
    expect(cssRule(".history-view__toolbar .app-btn")).toMatch(/--btn-h:\s*var\(--history-toolbar-height\);[\s\S]*border-radius:\s*var\(--radius-pill\);/);
    expect(cssRule(".history-search")).toMatch(/height:\s*var\(--history-toolbar-height\);[\s\S]*border:\s*0;[\s\S]*border-radius:\s*999px;/);
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
    const alert = await within(dialog).findByRole("alert");
    expect(alert.firstChild?.textContent).toBe("Could not delete. Try again.");
    expect(alert.getAttribute("title")).toBe("Storage unavailable");
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

describe("HistoryView located record", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderLocated(props: Partial<React.ComponentProps<typeof HistoryView>>) {
    return render(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={vi.fn()}
        searchQuery="a"
        searchUsesBackend
        {...props}
      />,
    );
  }

  it("scrolls to the row History comes back to, marks it, then lets the mark go", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    const onLocateSettled = vi.fn();
    try {
      renderLocated({ locateSegmentId: "1", onLocateSettled });

      const located = document.querySelector('[data-located="true"]');
      expect(located?.textContent).toContain("API reference");
      expect(document.querySelectorAll('[data-located="true"]')).toHaveLength(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /select api reference/i }));
      expect(onLocateSettled).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1800);
      });
      expect(onLocateSettled).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("lets go at once when the answered search no longer holds the record", () => {
    const onLocateSettled = vi.fn();
    renderLocated({ locateSegmentId: "deleted-record", onLocateSettled });

    expect(document.querySelector('[data-located="true"]')).toBeNull();
    expect(onLocateSettled).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting while the search is still loading", () => {
    const onLocateSettled = vi.fn();
    renderLocated({ locateSegmentId: "1", onLocateSettled, segments: [], initialLoading: true });

    expect(onLocateSettled).not.toHaveBeenCalled();
  });

  it("fades the mark, and holds it still for reduced motion", () => {
    expect(cssRule('.history-row[data-located="true"]')).toContain("animation: history-row-located");
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.history-row\[data-located="true"\]\s*\{\s*animation: none;/);
  });
});

describe("HistoryView page links", () => {
  afterEach(() => cleanup());

  it("opens from the title while the remaining row still selects records", () => {
    render(<HistoryView appIcons={{}} segments={historySegments} deleting={false} onDeleteSelected={vi.fn()} />);
    const link = screen.getByRole("link", { name: /API reference/ });
    const selection = screen.getByRole("checkbox", { name: /select api reference/i }) as HTMLInputElement;
    fireEvent.click(link);
    expect(selection.checked).toBe(false);
    fireEvent.click(screen.getByText("/api"));
    expect(selection.checked).toBe(true);
    fireEvent.click(selection);
    expect(selection.checked).toBe(false);
    expect(screen.queryByRole("link", { name: /Issue triage/ })).toBeNull();
  });

  it("removes the link when a same-title record adds another destination and preserves calendar context", () => {
    const onOpenRecord = vi.fn();
    const props = { appIcons: {}, deleting: false, onDeleteSelected: vi.fn(), onOpenRecord };
    const { rerender } = render(<HistoryView {...props} segments={[historySegments[0]!]} />);
    expect(screen.getByRole("link", { name: /API reference/ })).toBeTruthy();
    const second = { ...historySegments[0]!, id: "other", startedAt: "2026-06-10T09:10:00+00:00", endedAt: "2026-06-10T09:20:00+00:00", siteUrl: "https://docs.example.com/other" };
    rerender(<HistoryView {...props} segments={[historySegments[0]!, second]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Options for API reference" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in week calendar" }));
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ siteUrl: "https://docs.example.com/api", segmentIds: ["1", "other"] }), "week");
  });
});

describe("HistoryView row menu", () => {
  afterEach(() => cleanup());

  function renderWithMenu(props: Partial<React.ComponentProps<typeof HistoryView>> = {}) {
    const onOpenRecord = vi.fn();
    const onDeleteSelected = vi.fn().mockResolvedValue(undefined);
    render(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={onDeleteSelected}
        onOpenRecord={onOpenRecord}
        {...props}
      />,
    );
    return { onOpenRecord, onDeleteSelected };
  }

  it("opens a record in its week or its day without selecting the row", () => {
    const { onOpenRecord } = renderWithMenu();
    const trigger = screen.getByRole("button", { name: "Options for API reference" });

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Record options" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Show in week calendar", "Show this day", "Delete…"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Show in week calendar" }));
    expect(onOpenRecord).toHaveBeenCalledWith(expect.objectContaining({ segmentIds: ["1"] }), "week");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Show this day" }));
    expect(onOpenRecord).toHaveBeenLastCalledWith(expect.objectContaining({ segmentIds: ["1"] }), "day");
    expect((screen.getByRole("checkbox", { name: /select api reference/i }) as HTMLInputElement).checked).toBe(false);
  });

  it("moves through the menu with the keyboard and returns to its button on Escape", async () => {
    renderWithMenu();
    const trigger = screen.getByRole("button", { name: "Options for API reference" });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0]!, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("deletes only that record after confirmation, keeps the rest of the selection and moves on to the next record", async () => {
    const { onDeleteSelected } = renderWithMenu();
    fireEvent.click(screen.getByRole("checkbox", { name: /select issue triage/i }));
    const trigger = screen.getByRole("button", { name: "Options for API reference" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const dialog = screen.getByRole("dialog", { name: /delete history records/i });
    expect(within(dialog).getByText(/this removes 1 local activity record/i)).toBeTruthy();
    await waitFor(() => expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull());
    expect(onDeleteSelected).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    fireEvent.click(screen.getByRole("button", { name: /^delete records$/i }));
    await waitFor(() => expect(onDeleteSelected).toHaveBeenCalledWith(["1"]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /delete history records/i })).toBeNull());
    expect(screen.getByRole("button", { name: /delete 1 selected/i })).toBeTruthy();
    // Focus continues from the next record instead of falling to the page.
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /select issue triage/i }));
  });

  it("follows its row when a new record pushes the list down while the menu is open", async () => {
    renderWithMenu();
    const trigger = screen.getByRole("button", { name: "Options for API reference" });
    let top = 100;
    trigger.getBoundingClientRect = () => ({ top, bottom: top + 28, left: 900, right: 928, width: 28, height: 28, x: 900, y: top, toJSON: () => ({}) }) as DOMRect;

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Record options" });
    await waitFor(() => expect(menu.style.top).toBe("132px"));

    top = 144;
    await waitFor(() => expect(menu.style.top).toBe("176px"));
  });

  it("offers only delete for excluded activity, which no calendar shows", () => {
    renderWithMenu({ segments: [{ ...historySegments[1]!, id: "excluded", exclusionSource: "user" }] });

    fireEvent.click(screen.getByRole("button", { name: /^Options for / }));

    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Delete…"]);
  });
});

describe("HistoryView row menu: don't record", () => {
  const bankRow: ActivitySegment = {
    id: "bank",
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    browserName: "Google Chrome",
    durationSeconds: 300,
    endedAt: "2026-06-10T10:05:00+00:00",
    platform: "macos",
    siteDomain: "obank.kbstar.com",
    siteTitle: "계좌 조회",
    siteUrl: "https://obank.kbstar.com/quics",
    source: "accessibility",
    startedAt: "2026-06-10T10:00:00+00:00",
    windowTitle: "계좌 조회 - Chrome",
  };
  const newTabRow: ActivitySegment = {
    id: "newtab",
    appName: "Google Chrome",
    bundleId: "com.google.Chrome",
    browserName: "Google Chrome",
    durationSeconds: 60,
    endedAt: "2026-06-10T08:01:00+00:00",
    platform: "macos",
    source: "accessibility",
    startedAt: "2026-06-10T08:00:00+00:00",
    windowTitle: "New Tab",
  };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderExclude(segments: ActivitySegment[], rules: Awaited<ReturnType<typeof trackerClient.getExcludedApps>> = [], count = 4) {
    vi.spyOn(trackerClient, "getExcludedApps").mockResolvedValue(rules);
    const countSpy = vi.spyOn(trackerClient, "getExcludedAppHistoryCount").mockResolvedValue({ count });
    const onExcludeActivity = vi.fn(async ({ deletePast }: { deletePast: boolean }) => ({ deleted: deletePast ? count : 0 }));
    render(
      <HistoryView
        appIcons={{}}
        segments={segments}
        deleting={false}
        onDeleteSelected={vi.fn(async () => {})}
        onOpenRecord={vi.fn()}
        onExcludeActivity={onExcludeActivity}
      />,
    );
    return { onExcludeActivity, countSpy };
  }

  function menuItems(title: RegExp) {
    fireEvent.click(screen.getByRole("button", { name: title }));
    return within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent);
  }

  it("offers the whole site for a site row, the app for an app row, and nothing for a browser row without a site", async () => {
    renderExclude([bankRow, historySegments[1]!, newTabRow]);
    await waitFor(() => expect(trackerClient.getExcludedApps).toHaveBeenCalled());

    expect(menuItems(/^Options for 계좌 조회/)).toEqual(["Show in week calendar", "Show this day", "Don't record kbstar.com…", "Delete…"]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(menuItems(/^Options for Issue triage/)).toEqual(["Show in week calendar", "Show this day", "Don't record Acme Tracker…", "Delete…"]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    // Offering the browser would hide all browsing.
    expect(menuItems(/^Options for New Tab/)).toEqual(["Show in week calendar", "Show this day", "Delete…"]);
  });

  it("asks first, saves the site rule and keeps past records unless their deletion is ticked", async () => {
    const { onExcludeActivity, countSpy } = renderExclude([bankRow]);
    await waitFor(() => expect(trackerClient.getExcludedApps).toHaveBeenCalled());
    menuItems(/^Options for 계좌 조회/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Don't record kbstar.com…" }));

    const dialog = await screen.findByRole("dialog", { name: "Stop recording this site?" });
    expect(within(dialog).getByText("kbstar.com")).toBeTruthy();
    expect(within(dialog).getByText("Includes obank.kbstar.com")).toBeTruthy();
    expect(countSpy).toHaveBeenCalledWith({ name: "kbstar.com", bundleId: null, siteDomain: "kbstar.com" });
    const deletePast = await within(dialog).findByRole("checkbox", { name: /Also delete 4 past records/ });
    expect((deletePast as HTMLInputElement).checked).toBe(false);
    expect(onExcludeActivity).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Don't record" }));
    await waitFor(() => expect(onExcludeActivity).toHaveBeenCalledWith({
      rule: { id: "site:kbstar.com", name: "kbstar.com", bundleId: null, source: "user", kind: "site" },
      save: true,
      deletePast: false,
    }));
    expect(await screen.findByRole("status", { name: "Not recording kbstar.com" })).toBeTruthy();
    expect(screen.getByText("Past records stay. Unblock it in Settings › Privacy & Data.")).toBeTruthy();

    // Now that the site is kept out, the same row offers to delete what was recorded before.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stop recording this site?" })).toBeNull());
    expect(menuItems(/^Options for 계좌 조회/)).toContain("Delete past kbstar.com records…");
  });

  it("names the deletion on the button when past records are ticked, and reports how many went", async () => {
    const { onExcludeActivity } = renderExclude([bankRow, historySegments[1]!]);
    await waitFor(() => expect(trackerClient.getExcludedApps).toHaveBeenCalled());
    menuItems(/^Options for 계좌 조회/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Don't record kbstar.com…" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop recording this site?" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Also delete 4 past records/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Don't record and delete" }));
    await waitFor(() => expect(onExcludeActivity).toHaveBeenCalledWith(expect.objectContaining({ save: true, deletePast: true })));
    expect(await screen.findByText("Deleted 4 past records.")).toBeTruthy();
  });

  it("keeps a failed save in the dialog for a retry", async () => {
    const { onExcludeActivity } = renderExclude([historySegments[1]!], [], 0);
    onExcludeActivity.mockRejectedValueOnce(new Error("storage unavailable"));
    await waitFor(() => expect(trackerClient.getExcludedApps).toHaveBeenCalled());
    menuItems(/^Options for Issue triage/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Don't record Acme Tracker…" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop recording this app?" });
    expect(await within(dialog).findByText("No past records to delete.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Don't record" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Couldn't save");
    fireEvent.click(within(dialog).getByRole("button", { name: "Don't record" }));
    await waitFor(() => expect(onExcludeActivity).toHaveBeenLastCalledWith({
      rule: { id: "com.acme.tracker", name: "Acme Tracker", bundleId: "com.acme.tracker", source: "user", kind: "app" },
      save: true,
      deletePast: false,
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stop recording this app?" })).toBeNull());
  });

  it("only deletes past records for a site that is already kept out, in the Settings confirmation", async () => {
    const rule = { id: "site:kbstar.com", name: "kbstar.com", bundleId: null, source: "user" as const, kind: "site" as const };
    const { onExcludeActivity } = renderExclude([bankRow], [rule], 3);
    await waitFor(() => expect(menuItems(/^Options for 계좌 조회/)).toContain("Delete past kbstar.com records…"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete past kbstar.com records…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete 3 kbstar.com records?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete records" }));
    await waitFor(() => expect(onExcludeActivity).toHaveBeenCalledWith({ rule, save: false, deletePast: true }));
    expect(await screen.findByRole("status", { name: "Deleted past kbstar.com records" })).toBeTruthy();
  });

  it("hides the item when the app gives no way to keep activity out", () => {
    render(<HistoryView appIcons={{}} segments={[bankRow]} deleting={false} onDeleteSelected={vi.fn(async () => {})} onOpenRecord={vi.fn()} />);
    expect(menuItems(/^Options for 계좌 조회/)).toEqual(["Show in week calendar", "Show this day", "Delete…"]);
  });
});

