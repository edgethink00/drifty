// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => false,
}));
vi.mock("./previewData", () => ({
  previewAppIcons: vi.fn(),
  previewHourlySummary: vi.fn(),
  previewStatus: vi.fn(),
  previewTimeline: vi.fn(),
  previewTopSites: vi.fn(),
  previewTimelinePage: vi.fn(),
  previewTimelineSearch: vi.fn(),
  shouldUsePreviewData: () => false,
}));

describe("trackerClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("invokes tracker_delete_activity_segments with selected ids", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({ deleted: 2 });

    const result = await trackerClient.deleteActivitySegments(["42", "43"]);

    expect(result).toEqual({ deleted: 2 });
    expect(invoke).toHaveBeenCalledWith("tracker_delete_activity_segments", {
      query: { ids: ["42", "43"] },
    });
  });

  it("invokes tracker_get_dashboard_week_timeline with the selected range", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce([{ id: "week-segment" }]);

    const result = await trackerClient.getDashboardWeekTimeline({
      start: "2026-04-01T00:00:00",
      end: "2026-04-07T23:59:59",
    });

    expect(result).toEqual([{ id: "week-segment" }]);
    expect(invoke).toHaveBeenCalledWith("tracker_get_dashboard_week_timeline", {
      query: {
        start: "2026-04-01T00:00:00",
        end: "2026-04-07T23:59:59",
      },
    });
  });

  it("invokes tracker_get_timeline_page with the selected range and cursor", async () => {
    const { trackerClient } = await import("./trackerClient");
    const page = {
      items: [{ id: "history-segment" }],
      hasMore: true,
      nextCursor: {
        beforeEndedAt: "2026-04-06T09:05:00+00:00",
        beforeSegmentId: "42",
      },
    };
    invoke.mockResolvedValueOnce(page);

    const result = await trackerClient.getTimelinePage({
      start: "2026-04-01T00:00:00",
      end: "2026-04-07T23:59:59",
      beforeEndedAt: "2026-04-06T09:05:00+00:00",
      beforeSegmentId: "42",
      limit: 200,
    });

    expect(result).toEqual(page);
    expect(invoke).toHaveBeenCalledWith("tracker_get_timeline_page", {
      query: {
        start: "2026-04-01T00:00:00",
        end: "2026-04-07T23:59:59",
        beforeEndedAt: "2026-04-06T09:05:00+00:00",
        beforeSegmentId: "42",
        limit: 200,
      },
    });
  });

  it("invokes tracker_search_timeline with the query and cursor fields", async () => {
    const { trackerClient } = await import("./trackerClient");
    const page = {
      items: [{ id: "matching-history-segment" }],
      hasMore: true,
      nextCursor: {
        beforeEndedAt: "2026-04-06T09:05:00+00:00",
        beforeSegmentId: "42",
      },
    };
    invoke.mockResolvedValueOnce(page);

    const result = await trackerClient.searchTimeline({
      query: "github review",
      beforeEndedAt: "2026-04-06T09:05:00+00:00",
      beforeSegmentId: "42",
      limit: 50,
    });

    expect(result).toEqual(page);
    expect(invoke).toHaveBeenCalledWith("tracker_search_timeline", {
      query: {
        query: "github review",
        beforeEndedAt: "2026-04-06T09:05:00+00:00",
        beforeSegmentId: "42",
        limit: 50,
      },
    });
  });

  it("persists developer diagnostics through the tracker command", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({
      forceChromiumAxCapture: true,
      forceFrontmostFallbackCapture: true,
      forceBrowserHistoryUrlFallback: true,
      enhancedContextEnabled: true,
      enhancedContextCaptureLocal: false,
      enhancedContextSourceFamilies: ["document_knowledge", "calendar_meeting"],
    });

    await trackerClient.setDeveloperDiagnostics({
      forceChromiumAxCapture: true,
      forceFrontmostFallbackCapture: true,
      forceBrowserHistoryUrlFallback: true,
      enhancedContextEnabled: true,
      enhancedContextCaptureLocal: false,
      enhancedContextSourceFamilies: ["document_knowledge", "calendar_meeting"],
    });

    expect(invoke).toHaveBeenCalledWith("tracker_set_developer_diagnostics", {
      query: {
        forceChromiumAxCapture: true,
        forceFrontmostFallbackCapture: true,
        forceBrowserHistoryUrlFallback: true,
        enhancedContextEnabled: true,
        enhancedContextCaptureLocal: false,
        enhancedContextSourceFamilies: ["document_knowledge", "calendar_meeting"],
      },
    });
  });

  it("previews browser history import through the tracker command", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({
      lookbackDays: 7,
      candidateCount: 3,
      segmentCount: 2,
      estimatedSeconds: 780,
      browserCount: 1,
      profileCount: 1,
      databaseCount: 1,
      errorCount: 0,
      windowStart: "2026-05-13T13:15:00.000Z",
      windowEnd: "2026-05-20T13:15:00.000Z",
    });

    const result = await trackerClient.previewBrowserHistoryImport({ lookbackDays: 7 });

    expect(result.segmentCount).toBe(2);
    expect(invoke).toHaveBeenCalledWith("tracker_preview_browser_history_import", {
      query: { lookbackDays: 7 },
    });
  });

  it("imports browser history through the tracker command", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({
      lookbackDays: 7,
      candidateCount: 3,
      segmentCount: 2,
      estimatedSeconds: 780,
      browserCount: 1,
      profileCount: 1,
      databaseCount: 1,
      errorCount: 0,
      insertedCount: 2,
      skippedDuplicateCount: 0,
      windowStart: "2026-05-13T13:15:00.000Z",
      windowEnd: "2026-05-20T13:15:00.000Z",
    });

    const result = await trackerClient.importBrowserHistory({ lookbackDays: 7 });

    expect(result.insertedCount).toBe(2);
    expect(invoke).toHaveBeenCalledWith("tracker_import_browser_history", {
      query: { lookbackDays: 7 },
    });
  });

  it("reads the browser history environment through the tracker command", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({ safariHistoryReadable: true, defaultBrowserIsSafari: true });

    const result = await trackerClient.getBrowserHistoryEnvironment();

    expect(result).toEqual({ safariHistoryReadable: true, defaultBrowserIsSafari: true });
    expect(invoke).toHaveBeenCalledWith("tracker_get_browser_history_environment", undefined);
  });

  it("returns a false browser history environment outside Tauri", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const { trackerClient } = await import("./trackerClient");

    const result = await trackerClient.getBrowserHistoryEnvironment();

    expect(result).toEqual({ safariHistoryReadable: false, defaultBrowserIsSafari: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("defaults empty browser history import results to the 2-day product lookback outside Tauri", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const { trackerClient } = await import("./trackerClient");

    const preview = await trackerClient.previewBrowserHistoryImport();
    const result = await trackerClient.importBrowserHistory();

    expect(invoke).not.toHaveBeenCalled();
    expect(preview.lookbackDays).toBe(2);
    expect(preview.segmentCount).toBe(0);
    expect(result.lookbackDays).toBe(2);
    expect(result.insertedCount).toBe(0);
    expect(result.skippedDuplicateCount).toBe(0);
  });

  it("invokes tray_update_icon_style with the selected style", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce(null);

    await trackerClient.updateTrayIconStyle("expanded");

    expect(invoke).toHaveBeenCalledWith("tray_update_icon_style", { style: "expanded" });
  });

  it("returns an empty dashboard week timeline outside Tauri", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const { trackerClient } = await import("./trackerClient");

    const result = await trackerClient.getDashboardWeekTimeline({
      start: "2026-04-01T00:00:00",
      end: "2026-04-07T23:59:59",
    });

    expect(result).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns an empty search page outside Tauri", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const { trackerClient } = await import("./trackerClient");

    const result = await trackerClient.searchTimeline({
      query: "github",
      beforeEndedAt: "2026-04-06T09:05:00+00:00",
      beforeSegmentId: "42",
      limit: 50,
    });

    expect(result).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(invoke).not.toHaveBeenCalled();
  });
});
