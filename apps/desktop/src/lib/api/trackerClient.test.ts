// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackerClientInvokeCommands, type TrackerClientCommand } from "@drifty/domain";

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

const trackerClientInvokeCommandLiterals: readonly TrackerClientCommand[] = [
  "tracker_get_status",
  "tracker_start",
  "tracker_stop",
  "tracker_get_timeline",
  "tracker_get_timeline_page",
  "tracker_search_timeline",
  "tracker_get_dashboard_week_timeline",
  "tracker_get_project_trend_timeline",
  "tracker_get_live_tail",
  "tracker_get_current_snapshot",
  "tracker_get_hourly_summary",
  "tracker_get_raw_events",
  "tracker_get_top_sites",
  "tracker_set_developer_diagnostics",
  "tracker_get_app_icons",
  "tracker_get_unclassified_segments",
  "tracker_get_reusable_ai_classifications",
  "tracker_get_classification_rules",
  "tracker_save_classification_rule",
  "tracker_delete_classification_rule",
  "tracker_delete_activity_segments",
  "tracker_delete_history_range",
  "tracker_search_classification_rule_candidates",
  "tracker_apply_classification_rules",
  "tracker_save_classifications",
  "tracker_refresh_non_ai_classifications",
  "tracker_get_classification_metrics",
  "tracker_get_projects",
  "tracker_save_project",
  "tracker_delete_project",
  "tracker_save_project_anchors",
  "tracker_delete_project_anchor",
  "tracker_save_project_assignments",
  "tracker_get_project_assignments",
  "tracker_save_project_window_assignments",
  "tracker_get_project_window_assignments",
  "tracker_get_team_projects",
  "tracker_upsert_team_projects",
  "tracker_save_team_project_assignments",
  "tracker_get_team_project_assignments",
  "tracker_record_project_pass",
  "tracker_get_project_pass_runs",
  "tracker_save_ai_review_events",
  "tracker_get_ai_review_events",
  "tracker_revert_ai_review_event",
  "tracker_preview_browser_history_import",
  "tracker_import_browser_history",
  "tracker_get_browser_history_environment",
  "tracker_get_sync_outbox",
  "tracker_get_sync_state",
  "tracker_set_sync_state",
  "tracker_apply_synced_segments",
  "tracker_get_pending_sync_deletions",
  "tracker_mark_sync_deletions_pushed",
  "tracker_apply_synced_deletions",
  "tracker_purge_remote_segments",
  "tray_update_productivity_icon",
  "tray_update_icon_style",
  "tray_update_display_mode",
  "tray_update_drift_alarm_status",
];

describe("trackerClient command registry", () => {
  it("contains every command invoked by trackerClient", () => {
    expect(trackerClientInvokeCommands).toEqual(trackerClientInvokeCommandLiterals);
  });
});
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

  it("invokes tracker_get_project_trend_timeline with the selected range", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce([{ id: "trend-segment" }]);

    const result = await trackerClient.getProjectTrendTimeline?.({
      start: "2026-04-01T00:00:00",
      end: "2026-04-07T23:59:59",
    });

    expect(result).toEqual([{ id: "trend-segment" }]);
    expect(invoke).toHaveBeenCalledWith("tracker_get_project_trend_timeline", {
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
      start: "2026-04-01T00:00:00",
      end: "2026-04-07T23:59:59",
      beforeEndedAt: "2026-04-06T09:05:00+00:00",
      beforeSegmentId: "42",
      limit: 50,
    });

    expect(result).toEqual(page);
    expect(invoke).toHaveBeenCalledWith("tracker_search_timeline", {
      query: {
        query: "github review",
        start: "2026-04-01T00:00:00",
        end: "2026-04-07T23:59:59",
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

  it("invokes tray_update_display_mode with the focused duration", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce(null);

    await trackerClient.updateTrayDisplayMode("donutFocusTime", 9_660);

    expect(invoke).toHaveBeenCalledWith("tray_update_display_mode", {
      mode: "donutFocusTime",
      focusSeconds: 9_660,
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

  it("returns an empty search page outside Tauri", async () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    const { trackerClient } = await import("./trackerClient");

    const result = await trackerClient.searchTimeline({
      query: "github",
      start: "2026-04-01T00:00:00",
      end: "2026-04-07T23:59:59",
      beforeEndedAt: "2026-04-06T09:05:00+00:00",
      beforeSegmentId: "42",
      limit: 50,
    });

    expect(result).toEqual({ items: [], hasMore: false, nextCursor: null });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("invokes tracker_get_team_projects with no args", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce([{ id: "tp-1" }]);

    const result = await trackerClient.getTeamProjects();

    expect(result).toEqual([{ id: "tp-1" }]);
    expect(invoke).toHaveBeenCalledWith("tracker_get_team_projects", undefined);
  });

  it("invokes tracker_upsert_team_projects with organizationId and projects", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce([{ id: "tp-1" }]);

    const projects = [{ id: "tp-1", name: "A", description: "d" }];
    const result = await trackerClient.upsertTeamProjects("org-1", projects);

    expect(result).toEqual([{ id: "tp-1" }]);
    expect(invoke).toHaveBeenCalledWith("tracker_upsert_team_projects", {
      query: { organizationId: "org-1", projects },
    });
  });

  it("invokes tracker_save_team_project_assignments with assignments", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({ saved: 1, skippedManual: 0 });

    const assignments = [{ segmentId: "42", teamProjectId: "tp-1", source: "ai" as const }];
    const result = await trackerClient.saveTeamProjectAssignments(assignments);

    expect(result).toEqual({ saved: 1, skippedManual: 0 });
    expect(invoke).toHaveBeenCalledWith("tracker_save_team_project_assignments", {
      query: { assignments },
    });
  });

  it("invokes tracker_get_team_project_assignments with the query", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce([{ segmentId: "42", teamProjectId: "tp-1" }]);

    const result = await trackerClient.getTeamProjectAssignments({ day: "2026-04-06" });

    expect(result).toEqual([{ segmentId: "42", teamProjectId: "tp-1" }]);
    expect(invoke).toHaveBeenCalledWith("tracker_get_team_project_assignments", {
      query: { day: "2026-04-06" },
    });
  });
});
