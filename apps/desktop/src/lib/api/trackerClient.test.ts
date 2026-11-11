// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackerClientInvokeCommands, type ActivitySegment, type TrackerClientCommand } from "@drifty/domain";
import { buildLiveWatcherSnapshot, buildWatcherSnapshot } from "../../features/companion/watcherData";
import { isTrackerDatabaseUnavailable } from "./trackerErrors";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));
const previewDataMocks = vi.hoisted(() => ({
  previewAppIcons: vi.fn(),
  previewDeleteActivitySegments: vi.fn(),
  previewDeleteProject: vi.fn(),
  previewHourlySummary: vi.fn(),
  previewProjectAssignments: vi.fn(),
  previewProjects: vi.fn(),
  previewSaveClassifications: vi.fn(),
  previewSaveProject: vi.fn(),
  previewSaveProjectAssignments: vi.fn(),
  previewStatus: vi.fn(),
  previewTimeline: vi.fn(),
  previewTopSites: vi.fn(),
  previewTimelinePage: vi.fn(),
  previewTimelineSearch: vi.fn(),
  shouldUsePreviewData: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => false,
}));
vi.mock("./previewData", () => previewDataMocks);

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
  "tracker_set_capture_policy",
  "tracker_get_app_icons",
  "tracker_get_site_icons",
  "tracker_clear_icon_caches",
  "tracker_get_unclassified_segments",
  "tracker_get_reusable_ai_classifications",
  "tracker_get_classification_rules",
  "tracker_save_classification_rule",
  "tracker_delete_classification_rule",
  "tracker_get_excluded_apps",
  "tracker_save_excluded_app",
  "tracker_delete_excluded_app",
  "tracker_get_excluded_app_history_count",
  "tracker_delete_excluded_app_history",
  "tracker_get_recent_apps",
  "tracker_delete_activity_segments",
  "tracker_delete_history_range",
  "tracker_search_classification_rule_candidates",
  "tracker_preview_classification_rule",
  "tracker_apply_classification_rules",
  "tracker_save_classifications",
  "tracker_refresh_non_ai_classifications",
  "tracker_get_classification_metrics",
  "tracker_get_projects",
  "tracker_get_dev_signals",
  "tracker_get_agent_concurrency_peak",
  "tracker_get_dev_repos",
  "tracker_sync_dev_signals",
  "tracker_list_ssh_agent_sources",
  "tracker_test_ssh_agent_source",
  "tracker_collect_ssh_agent_source",
  "tracker_save_project",
  "tracker_delete_project",
  "tracker_save_project_anchors",
  "tracker_delete_project_anchor",
  "tracker_save_project_assignments",
  "tracker_get_project_assignments",
  "tracker_save_project_window_assignments",
  "tracker_get_project_window_assignments",
  "tracker_get_activity_block_labels",
  "tracker_get_activity_timeline_cards",
  "tracker_save_activity_timeline_window",
  "tracker_save_activity_block_user_label",
  "tracker_delete_activity_block_user_label",
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
  "tracker_set_team_pause_lock",
  "tracker_apply_synced_definition",
  "tracker_apply_synced_segments",
  "tracker_get_pending_sync_deletions",
  "tracker_mark_sync_deletions_pushed",
  "tracker_apply_synced_deletions",
  "tracker_purge_remote_segments",
  "tray_update_productivity_icon",
  "tray_update_icon_style",
  "tray_update_display_mode",
  "tray_update_drift_alarm_status",
  "tray_set_language",
  "tray_update_trial_status",
];

describe("database availability boundary", () => {
  it("preserves the native status issue and recognizes only the exact activity error code", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    try {
      const { trackerClient } = await import("./trackerClient");
      invoke.mockResolvedValueOnce({
        running: false, trackerMode: "unavailable", statusIssue: "databaseUnavailable",
      });
      expect((await trackerClient.getStatus()).statusIssue).toBe("databaseUnavailable");
      invoke.mockRejectedValueOnce("tracker_database_unavailable");
      await expect(trackerClient.getTimeline({ day: "2026-11-09" }).catch(isTrackerDatabaseUnavailable)).resolves.toBe(true);
      invoke.mockRejectedValueOnce("tracker_database_unavailable extra text");
      await expect(trackerClient.getLiveTail({}).catch(isTrackerDatabaseUnavailable)).resolves.toBe(false);
    } finally {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });
});

describe("trackerClient command registry", () => {
  it("contains every command invoked by trackerClient", () => {
    expect(trackerClientInvokeCommands).toEqual(trackerClientInvokeCommandLiterals);
  });
});
describe("trackerClient", () => {
  it("clears rendered screen generations before activity deletion, while preview and metadata-only reads stay intact", async () => {
    const { trackerClient } = await import("./trackerClient");
    const { SCREEN_CONTEXT_POLICY_CHANGING } = await import("./screenContextPolicyEvents");
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const cleared = vi.fn();
    window.addEventListener(SCREEN_CONTEXT_POLICY_CHANGING, cleared);
    try {
      for (const operation of [
        () => trackerClient.deleteActivitySegments(["42"]),
        () => trackerClient.deleteExcludedAppHistory({ name: "Owned" }),
        () => trackerClient.deleteHistoryRange({ scopes: { activity: true, aiClassifications: false, youtubeMetadata: false } }),
      ]) {
        cleared.mockClear();
        invoke.mockImplementationOnce(async () => { expect(cleared).toHaveBeenCalledOnce(); return { deleted: 1 }; });
        await operation();
      }
      for (const query of [
        { scopes: { activity: true, aiClassifications: false, youtubeMetadata: false }, dryRun: true },
        { scopes: { activity: false, aiClassifications: true, youtubeMetadata: true } },
      ]) {
        cleared.mockClear();
        invoke.mockResolvedValueOnce({ activitySegments: 0, classifications: 1, youtubeMetadata: 0, dryRun: query.dryRun ?? false });
        await trackerClient.deleteHistoryRange(query);
        expect(cleared).not.toHaveBeenCalled();
      }
    } finally {
      window.removeEventListener(SCREEN_CONTEXT_POLICY_CHANGING, cleared);
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });
  it.each(["save", "delete"] as const)("clears screen evidence synchronously before the native exclusion %s starts", async (operation) => {
    const { trackerClient } = await import("./trackerClient");
    const { SCREEN_CONTEXT_POLICY_CHANGING } = await import("./screenContextPolicyEvents");
    const cleared = vi.fn();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    window.addEventListener(SCREEN_CONTEXT_POLICY_CHANGING, cleared);
    try {
      invoke.mockImplementationOnce(async () => {
        expect(cleared).toHaveBeenCalledOnce();
        return operation === "save" ? { id: "owned", name: "Owned", source: "user" } : { deleted: true };
      });
      if (operation === "save") await trackerClient.saveExcludedApp({ id: "owned", name: "Owned", source: "user" });
      else await trackerClient.deleteExcludedApp("owned");
      expect(cleared).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(SCREEN_CONTEXT_POLICY_CHANGING, cleared);
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    previewDataMocks.shouldUsePreviewData.mockReturnValue(false);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("preserves native persisted-pause state in normalized status", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({
      running: false,
      trackingPaused: true,
      accessibilityGranted: true,
      trackerMode: "stopped",
    });

    await expect(trackerClient.getStatus()).resolves.toMatchObject({
      running: false,
      trackingPaused: true,
      trackerMode: "stopped",
    });
  });

  it.each([
    [52_428_800, 52_428_800],
    [0, 0],
    [-1, null],
    [Number.NaN, null],
    ["52428800", null],
    [undefined, null],
  ])("keeps only a real byte count for the tracker volume's free space (%s)", async (reported, expected) => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({ running: true, accessibilityGranted: true, trackerMode: "tracking", storageFreeBytes: reported });
    await expect(trackerClient.getStatus()).resolves.toMatchObject({ storageFreeBytes: expected });
  });

  it.each(["focus", "drift"] as const)("treats a failed Windows current capture as a gap even with an Unavailable %s rule", async (productivity) => {
    const { trackerClient } = await import("./trackerClient");
    const recordedFocus: ActivitySegment = {
      id: "recorded-focus",
      startedAt: "2026-09-30T09:00:00.000Z",
      endedAt: "2026-09-30T09:05:00.000Z",
      durationSeconds: 300,
      appName: "Code",
      bundleId: "C:\\Code.exe",
      platform: "windows",
      source: "win32-foreground",
      classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 },
    };
    const options = {
      rules: [{
        targetKind: "app" as const,
        targetValue: "Unavailable",
        category: productivity === "focus" ? "workspace" as const : "entertainment" as const,
        productivity,
      }, {
        targetKind: "app" as const,
        targetValue: "Browser",
        category: "entertainment" as const,
        productivity: "drift" as const,
      }],
    };
    invoke.mockResolvedValueOnce({
      observedAt: "2026-09-30T09:05:05.000Z",
      appName: "Unavailable",
      bundleId: null,
      source: "unknown",
      frontmostCaptureSource: "unavailable",
    });

    const current = await trackerClient.getCurrentSnapshot();
    const companion = current
      ? buildLiveWatcherSnapshot(current, [recordedFocus], options)
      : buildWatcherSnapshot([recordedFocus], options);

    expect(current).toBeNull();
    expect(companion).toMatchObject({
      productivity: "focus",
      contextLabel: "Code",
      focusSecondsToday: 300,
      focusStrikeSeconds: 300,
    });
    expect(buildWatcherSnapshot([], options)).toMatchObject({ productivity: "neutral", focusSecondsToday: 0 });

    invoke.mockResolvedValueOnce({
      observedAt: "2026-09-30T09:05:10.000Z",
      appName: "Browser",
      bundleId: "C:\\Browser.exe",
      source: "win32-foreground",
      frontmostCaptureSource: "win32-foreground",
    });
    const recovered = await trackerClient.getCurrentSnapshot();
    expect(recovered?.appName).toBe("Browser");
    expect(recovered && buildLiveWatcherSnapshot(recovered, [recordedFocus], options)).toMatchObject({
      productivity: "drift",
      focusStrikeSeconds: null,
      focusSecondsToday: 300,
    });
  });

  it("filters a legacy failed capture but accepts a verified app named Unavailable", async () => {
    const { trackerClient } = await import("./trackerClient");
    const legacy = {
      observedAt: "2026-09-30T09:05:05.000Z",
      appName: "Unavailable",
      bundleId: null,
      source: "unknown",
    };
    invoke.mockResolvedValueOnce(legacy).mockResolvedValueOnce({
      ...legacy,
      source: "win32-foreground-untitled",
    }).mockResolvedValueOnce({
      ...legacy,
      source: "win32-foreground-untitled",
      frontmostCaptureSource: "win32-foreground",
    }).mockResolvedValueOnce({
      ...legacy,
      source: "nsworkspace",
      frontmostCaptureSource: "unavailable",
    });

    await expect(trackerClient.getCurrentSnapshot()).resolves.toBeNull();
    await expect(trackerClient.getCurrentSnapshot()).resolves.toMatchObject({
      appName: "Unavailable",
      source: "win32-foreground-untitled",
    });
    await expect(trackerClient.getCurrentSnapshot()).resolves.toMatchObject({
      appName: "Unavailable",
      frontmostCaptureSource: "win32-foreground",
    });
    await expect(trackerClient.getCurrentSnapshot()).resolves.toMatchObject({
      appName: "Unavailable",
      source: "nsworkspace",
    });
  });

  it("keeps a still-running tracker visible while a persisted pause is being enforced", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce({
      running: true,
      trackingPaused: true,
      accessibilityGranted: true,
      trackerMode: "degraded",
      message: "Pause requested, but tracking is still running. Drifty is retrying.",
    });

    await expect(trackerClient.getStatus()).resolves.toMatchObject({
      running: true,
      trackingPaused: true,
      trackerMode: "degraded",
    });
  });

  it("marks only explicit tracker resumes as able to clear a pause", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValue({ running: true, accessibilityGranted: true });

    await trackerClient.start();
    await trackerClient.start({ resumePaused: true });

    expect(invoke).toHaveBeenNthCalledWith(1, "tracker_start", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "tracker_start", { resumePaused: true });
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

  it("forwards atomic definition imports and rejects a missing native acknowledgement", async () => {
    const { trackerClient } = await import("./trackerClient");
    const input = { accountId: "qa-account", kind: "project" as const, key: "p-qa", value: null, updatedAt: "2026-10-20T00:00:00.000Z", expected: null };
    const result = { applied: true, value: null, ledger: "{}" };
    invoke.mockResolvedValueOnce(result);
    await expect(trackerClient.applySyncedDefinition(input)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("tracker_apply_synced_definition", { query: { input } });
    invoke.mockResolvedValueOnce(undefined);
    await expect(trackerClient.applySyncedDefinition(input)).rejects.toThrow("did not acknowledge");
  });

  it("routes review edits to preview memory without invoking native commands", async () => {
    const { trackerClient } = await import("./trackerClient");
    const assignments = [{ segmentId: "preview-t1", projectId: "preview-project-drifty", source: "manual" as const }];
    const classifications = [{
      segmentId: "preview-t1",
      category: "workspace" as const,
      productivity: "focus" as const,
      source: "manual" as const,
      confidence: 1,
      inputFingerprint: "preview-review-test",
    }];
    previewDataMocks.shouldUsePreviewData.mockReturnValue(true);
    previewDataMocks.previewProjects.mockReturnValue([{ id: "preview-project-drifty" }]);
    previewDataMocks.previewProjectAssignments.mockReturnValue(assignments);
    previewDataMocks.previewSaveProjectAssignments.mockReturnValue({ saved: 1, skippedManual: 0 });
    previewDataMocks.previewSaveClassifications.mockReturnValue({ saved: 1 });
    previewDataMocks.previewDeleteActivitySegments.mockReturnValue({ deleted: 1 });
    const projectInput = { name: "Q3 launch", description: "", color: "#2f8b83" };
    const savedProject = { id: "preview-project-new-1", ...projectInput, status: "active", anchors: [], createdAt: "", updatedAt: "" };
    previewDataMocks.previewSaveProject.mockReturnValue(savedProject);
    previewDataMocks.previewDeleteProject.mockReturnValue({ deleted: 1 });

    await expect(trackerClient.getProjects()).resolves.toEqual([{ id: "preview-project-drifty" }]);
    await expect(trackerClient.getProjectAssignments({ day: "2026-09-02" })).resolves.toEqual(assignments);
    await expect(trackerClient.saveProjectAssignments(assignments)).resolves.toEqual({ saved: 1, skippedManual: 0 });
    await expect(trackerClient.saveClassifications(classifications)).resolves.toEqual({ saved: 1 });
    await expect(trackerClient.deleteActivitySegments(["preview-t1"])).resolves.toEqual({ deleted: 1 });
    await expect(trackerClient.saveProject(projectInput)).resolves.toEqual(savedProject);
    await expect(trackerClient.deleteProject("preview-project-new-1")).resolves.toEqual({ deleted: 1 });

    expect(previewDataMocks.previewSaveProjectAssignments).toHaveBeenCalledWith(assignments);
    expect(previewDataMocks.previewSaveClassifications).toHaveBeenCalledWith(classifications);
    expect(previewDataMocks.previewDeleteActivitySegments).toHaveBeenCalledWith(["preview-t1"]);
    expect(previewDataMocks.previewSaveProject).toHaveBeenCalledWith(projectInput);
    expect(previewDataMocks.previewDeleteProject).toHaveBeenCalledWith("preview-project-new-1");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("preserves passive engagement evidence from the native timeline response", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce([{
      id: "42",
      engagementEvidence: "foreground-audio",
    }]);

    const result = await trackerClient.getTimeline({ day: "2026-08-24" });

    expect(result).toEqual([{
      id: "42",
      engagementEvidence: "foreground-audio",
    }]);
    expect(invoke).toHaveBeenCalledWith("tracker_get_timeline", {
      query: { day: "2026-08-24" },
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

  it("invokes tray_set_language with the selected language", async () => {
    const { trackerClient } = await import("./trackerClient");
    invoke.mockResolvedValueOnce(null);

    await trackerClient.updateTrayLanguage("ko");

    expect(invoke).toHaveBeenCalledWith("tray_set_language", { language: "ko" });
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
