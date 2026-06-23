// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./previewData", () => ({
  previewAppIcons: vi.fn(),
  previewHourlySummary: vi.fn(),
  previewStatus: vi.fn(),
  previewTimeline: vi.fn(),
  previewTopSites: vi.fn(),
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

  it("persists developer diagnostics through the tracker command", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({ forceChromiumAxCapture: true, forceFrontmostFallbackCapture: true });

    await trackerClient.setDeveloperDiagnostics({ forceChromiumAxCapture: true, forceFrontmostFallbackCapture: true });

    expect(invoke).toHaveBeenCalledWith("tracker_set_developer_diagnostics", {
      query: { forceChromiumAxCapture: true, forceFrontmostFallbackCapture: true },
    });
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
});
