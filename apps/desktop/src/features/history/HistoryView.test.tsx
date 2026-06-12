// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryView } from "./HistoryView";

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

describe("HistoryView", () => {
  afterEach(() => cleanup());

  it("renders grouped local history and filters by query", () => {
    render(
      <HistoryView
        appIcons={{}}
        segments={historySegments}
        deleting={false}
        onDeleteSelected={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "History" })).toBeTruthy();
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
});
