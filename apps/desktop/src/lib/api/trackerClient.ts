import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityClassificationRecord,
  ActivitySegment,
  AppIconMap,
  AppIdentity,
  BrowserHistoryEnvironment,
  BrowserHistoryImportPreview,
  BrowserHistoryImportQuery,
  BrowserHistoryImportResult,
  ClassificationMetrics,
  ClassificationQuery,
  UnclassifiedSegmentsQuery,
  ClassificationRule,
  ClassificationRuleApplyResult,
  ClassificationRuleCandidate,
  ClassificationRuleCandidateQuery,
  ClassificationRuleInput,
  DeleteHistoryRangeQuery,
  DeleteHistoryRangeResult,
  DeveloperDiagnosticsSettings,
  DriftAlarmTrayStatus,
  CurrentActivitySnapshot,
  LiveTailQuery,
  Project,
  ProjectAnchor,
  ProjectAnchorKind,
  ProjectAssignmentRecord,
  ProjectAssignmentsSaveResult,
  ProjectInput,
  ProjectPassRun,
  ProjectPassRunInput,
  ProjectPassRunRecord,
  ProjectWindowAssignmentRecord,
  AiReviewEvent,
  AiReviewEventInput,
  AiReviewEventRevertResult,
  ProductivityShareMix,
  RawEventsQuery,
  SiteDuration,
  SyncApplyResult,
  SyncDeletionRecord,
  SyncDeletionsApplyResult,
  SyncedSegmentInput,
  SyncOutboxPage,
  SyncOutboxQuery,
  SyncStateSnapshot,
  TimelinePage,
  TimelinePageQuery,
  TimelineSearchQuery,
  TimelineQuery,
  TeamProject,
  TeamProjectInput,
  TeamProjectAssignmentRecord,
  TrackerApi,
  TrackerClientCommand,
  TrackerClientCommandArgs,
  TrackerClientCommandResult,
  TrackerLiveTail,
  TrackerStatus,
  TrayDisplayMode,
  TrayIconStyle,
} from "@drifty/domain";
import { previewAppIcons, previewHourlySummary, previewStatus, previewTimeline, previewTimelinePage, previewTimelineSearch, previewTopSites, shouldUsePreviewData } from "./previewData";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeStatus(status: Record<string, unknown>): TrackerStatus {
  return {
    running: Boolean(status.running ?? status.isRunning),
    accessibilityGranted: Boolean(status.accessibilityGranted),
    lastEventAt: (status.lastEventAt as string | null | undefined) ?? null,
    databasePath:
      (status.databasePath as string | null | undefined) ??
      (status.dbPath as string | null | undefined) ??
      null,
    trackerMode:
      (status.trackerMode as string | null | undefined) ??
      (status.sidecarMode as string | null | undefined) ??
      undefined,
    idleSeconds: typeof status.idleSeconds === "number" ? status.idleSeconds : null,
    idleDetectionAvailable: typeof status.idleDetectionAvailable === "boolean" ? status.idleDetectionAvailable : null,
    message: (status.message as string | null | undefined) ?? undefined,
  };
}

class TrackerInvokeError extends Error {
  constructor(command: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`${command} failed: ${message}`);
    this.name = "TrackerInvokeError";
  }
}

function getTrackerUnavailableStatus(message: string): TrackerStatus {
  return {
    running: false,
    accessibilityGranted: false,
    lastEventAt: null,
    databasePath: null,
    trackerMode: "unavailable",
    message,
  };
}

function emptyBrowserHistoryImportPreview(query?: BrowserHistoryImportQuery): BrowserHistoryImportPreview {
  // Mirrors the Rust-side default lookback window (unwrap_or(2)).
  const lookbackDays = query?.lookbackDays ?? 2;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return {
    lookbackDays,
    candidateCount: 0,
    segmentCount: 0,
    estimatedSeconds: 0,
    browserCount: 0,
    profileCount: 0,
    databaseCount: 0,
    errorCount: 0,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}

function emptyBrowserHistoryImportResult(query?: BrowserHistoryImportQuery): BrowserHistoryImportResult {
  return {
    ...emptyBrowserHistoryImportPreview(query),
    insertedCount: 0,
    skippedDuplicateCount: 0,
  };
}

async function safeInvoke<C extends TrackerClientCommand>(
  cmd: C,
  ...args: TrackerClientCommandArgs<C> extends undefined ? [] : [args: TrackerClientCommandArgs<C>]
): Promise<TrackerClientCommandResult<C> | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    return await invoke<TrackerClientCommandResult<C>>(cmd, args[0] as Record<string, unknown> | undefined);
  } catch (error) {
    throw new TrackerInvokeError(cmd, error);
  }
}

export const trackerClient: TrackerApi = {
  async getStatus() {
    if (shouldUsePreviewData()) return previewStatus();
    try {
      const status = await safeInvoke("tracker_get_status");
      if (!status) {
        return getTrackerUnavailableStatus("Tracker not available in this environment");
      }
      return normalizeStatus(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tracker status unavailable";
      return getTrackerUnavailableStatus(message);
    }
  },
  async start() {
    if (shouldUsePreviewData()) return previewStatus();
    const status = await safeInvoke("tracker_start");
    if (!status) {
      throw new Error("Tracker is not available. Please run the desktop app.");
    }
    return normalizeStatus(status);
  },
  async stop() {
    if (shouldUsePreviewData()) return { ...previewStatus(), running: false };
    const status = await safeInvoke("tracker_stop");
    if (!status) {
      throw new Error("Tracker is not available. Please run the desktop app.");
    }
    return normalizeStatus(status);
  },
  async getTimeline(query: TimelineQuery) {
    if (shouldUsePreviewData()) return previewTimeline(query);
    const result = await safeInvoke("tracker_get_timeline", { query });
    return result ?? [];
  },
  async getTimelinePage(query: TimelinePageQuery) {
    if (shouldUsePreviewData()) return previewTimelinePage(query);
    const result = await safeInvoke("tracker_get_timeline_page", { query });
    return result ?? { items: [], hasMore: false, nextCursor: null };
  },
  async searchTimeline(query: TimelineSearchQuery) {
    if (shouldUsePreviewData()) return previewTimelineSearch(query);
    const result = await safeInvoke("tracker_search_timeline", { query });
    return result ?? { items: [], hasMore: false, nextCursor: null };
  },
  async getDashboardWeekTimeline(query) {
    if (shouldUsePreviewData()) return previewTimeline(query);
    const result = await safeInvoke("tracker_get_dashboard_week_timeline", { query });
    return result ?? [];
  },
  async getProjectTrendTimeline(query) {
    if (shouldUsePreviewData()) return previewTimeline(query);
    const result = await safeInvoke("tracker_get_project_trend_timeline", { query });
    return result ?? [];
  },
  async getLiveTail(query: LiveTailQuery) {
    if (shouldUsePreviewData()) {
      const status = previewStatus();
      const timelineQuery: TimelineQuery = query.start && query.end
        ? { start: query.start, end: query.end }
        : { day: new Date().toISOString().slice(0, 10) };
      const afterEndedAtMs = query.afterEndedAt ? new Date(query.afterEndedAt).getTime() : Number.NEGATIVE_INFINITY;
      const afterSegmentId = query.afterSegmentId ? Number(query.afterSegmentId) : null;
      const limit = query.limit ?? 8;
      const segments = previewTimeline(timelineQuery)
        .filter((segment) => {
          const endedAtMs = new Date(segment.endedAt).getTime();
          const segmentId = Number(segment.id);
          return (
            (Number.isFinite(endedAtMs) && endedAtMs > afterEndedAtMs) ||
            (afterSegmentId !== null && Number.isFinite(segmentId) && segmentId > afterSegmentId)
          );
        })
        .slice(-limit);
      return {
        running: Boolean(status.running ?? status.isRunning),
        trackerMode: status.trackerMode ?? null,
        lastEventAt: status.lastEventAt ?? null,
        segments,
      };
    }
    const result = await safeInvoke("tracker_get_live_tail", { query });
    return result ?? {
      running: false,
      trackerMode: "unavailable",
      lastEventAt: null,
      segments: [],
    };
  },
  async getCurrentSnapshot() {
    return await safeInvoke("tracker_get_current_snapshot");
  },
  async getHourlySummary(query: TimelineQuery) {
    if (shouldUsePreviewData()) return previewHourlySummary(query);
    const buckets = await safeInvoke("tracker_get_hourly_summary", { query });

    if (!buckets) return [];

    return buckets.map((bucket) => ({
      hour: bucket.hour ?? bucket.hourLabel ?? "00:00",
      totalSeconds: bucket.totalSeconds ?? bucket.durationSeconds ?? 0,
      appBreakdown:
        bucket.appBreakdown ??
        (bucket.topApps ?? []).map((entry) => ({
          appName: entry.appName,
          totalSeconds: entry.durationSeconds,
        })),
    }));
  },
  async getRawEvents(query: RawEventsQuery) {
    const result = await safeInvoke("tracker_get_raw_events", { query });
    return result ?? [];
  },
  async getTopSites(query: import("@drifty/domain").TopSitesQuery) {
    if (shouldUsePreviewData()) return previewTopSites(query);
    const result = await safeInvoke("tracker_get_top_sites", { query });
    return result ?? [];
  },
  async setDeveloperDiagnostics(settings: DeveloperDiagnosticsSettings) {
    if (shouldUsePreviewData()) return;
    await safeInvoke("tracker_set_developer_diagnostics", { query: settings });
  },
  async getAppIcons(apps: AppIdentity[]) {
    if (shouldUsePreviewData()) return previewAppIcons(apps);
    const result = await safeInvoke("tracker_get_app_icons", { query: { apps } });
    return result ?? {};
  },
  async getUnclassifiedSegments(query: UnclassifiedSegmentsQuery) {
    if (shouldUsePreviewData()) return [];
    const result = await safeInvoke("tracker_get_unclassified_segments", { query });
    return result ?? [];
  },
  async getReusableAiClassifications(inputFingerprints: string[]) {
    if (shouldUsePreviewData()) return {};
    const result = await safeInvoke("tracker_get_reusable_ai_classifications", { query: { inputFingerprints } });
    return result ?? {};
  },
  async getClassificationRules() {
    const result = await safeInvoke("tracker_get_classification_rules");
    return result ?? [];
  },
  async saveClassificationRule(input: ClassificationRuleInput) {
    const result = await safeInvoke("tracker_save_classification_rule", { query: { input } });
    return result ?? {
      id: "",
      targetKind: input.targetKind,
      targetValue: input.targetValue,
      matchScope: input.matchScope ?? "surface",
      detailKind: input.detailKind ?? null,
      detailValue: input.detailValue ?? null,
      category: input.category,
      productivity: input.productivity,
      enabled: input.enabled ?? true,
      confidence: input.confidence ?? null,
    };
  },
  async deleteClassificationRule(id: string) {
    const result = await safeInvoke("tracker_delete_classification_rule", { query: { id } });
    return result ?? { deleted: 0 };
  },
  async deleteActivitySegments(ids: readonly string[]) {
    const result = await safeInvoke("tracker_delete_activity_segments", { query: { ids } });
    return result ?? { deleted: 0 };
  },
  async deleteHistoryRange(query: DeleteHistoryRangeQuery) {
    const result = await safeInvoke("tracker_delete_history_range", { query });
    return result ?? {
      activitySegments: 0,
      classifications: 0,
      youtubeMetadata: 0,
      dryRun: query.dryRun ?? false,
    };
  },
  async searchClassificationRuleCandidates(query: ClassificationRuleCandidateQuery) {
    const result = await safeInvoke("tracker_search_classification_rule_candidates", { query });
    return result ?? [];
  },
  async applyClassificationRules(query?: ClassificationQuery) {
    const result = await safeInvoke("tracker_apply_classification_rules", { query });
    return result ?? { matchedCount: 0, appliedCount: 0, skippedCount: 0 };
  },
  async saveClassifications(classifications: ActivityClassificationRecord[]) {
    const result = await safeInvoke("tracker_save_classifications", { query: { classifications } });
    return result ?? { saved: 0 };
  },
  async refreshNonAiClassifications(query: ClassificationQuery) {
    const result = await safeInvoke("tracker_refresh_non_ai_classifications", { query });
    return result ?? { deleted: 0 };
  },
  async getClassificationMetrics(query: ClassificationQuery) {
    const result = await safeInvoke("tracker_get_classification_metrics", { query });
    return result ?? {
      totalSegments: 0,
      classifiedSegments: 0,
      unclassifiedSegments: 0,
      aiClassifiedSegments: 0,
      staleClassifications: 0,
    };
  },
  async getProjects() {
    const result = await safeInvoke("tracker_get_projects");
    return result ?? [];
  },
  async saveProject(input: ProjectInput) {
    const result = await safeInvoke("tracker_save_project", { query: { input } });
    return result ?? {
      id: input.id ?? "",
      name: input.name,
      description: input.description,
      color: input.color ?? "",
      status: input.status ?? "active",
      anchors: [],
      createdAt: "",
      updatedAt: "",
    };
  },
  async deleteProject(id: string) {
    const result = await safeInvoke("tracker_delete_project", { query: { id } });
    return result ?? { deleted: 0 };
  },
  async saveProjectAnchors(projectId: string, anchors: ProjectAnchor[]) {
    const result = await safeInvoke("tracker_save_project_anchors", { query: { projectId, anchors } });
    return result ?? [];
  },
  async deleteProjectAnchor(projectId: string, kind: ProjectAnchorKind, value: string) {
    const result = await safeInvoke("tracker_delete_project_anchor", { query: { projectId, kind, value } });
    return result ?? { deleted: 0 };
  },
  async saveProjectAssignments(assignments: ProjectAssignmentRecord[]) {
    const result = await safeInvoke("tracker_save_project_assignments", { query: { assignments } });
    return result ?? { saved: 0, skippedManual: 0 };
  },
  async getProjectAssignments(query: TimelineQuery) {
    const result = await safeInvoke("tracker_get_project_assignments", { query });
    return result ?? [];
  },
  async saveProjectWindowAssignments(assignments: ProjectWindowAssignmentRecord[]) {
    const result = await safeInvoke("tracker_save_project_window_assignments", { query: { assignments } });
    return result ?? { saved: 0, skippedManual: 0 };
  },
  async getProjectWindowAssignments(query: TimelineQuery) {
    const result = await safeInvoke("tracker_get_project_window_assignments", { query });
    return result ?? [];
  },
  async getTeamProjects() {
    const result = await safeInvoke("tracker_get_team_projects");
    return result ?? [];
  },
  async upsertTeamProjects(organizationId: string, projects: TeamProjectInput[]) {
    const result = await safeInvoke("tracker_upsert_team_projects", { query: { organizationId, projects } });
    return result ?? [];
  },
  async saveTeamProjectAssignments(assignments: TeamProjectAssignmentRecord[]) {
    const result = await safeInvoke("tracker_save_team_project_assignments", { query: { assignments } });
    return result ?? { saved: 0, skippedManual: 0 };
  },
  async getTeamProjectAssignments(query: TimelineQuery) {
    const result = await safeInvoke("tracker_get_team_project_assignments", { query });
    return result ?? [];
  },
  async recordProjectPass(input: ProjectPassRunInput) {
    const result = await safeInvoke("tracker_record_project_pass", { query: { input } });
    return result ?? { id: 0, ranAt: "" };
  },
  async getProjectPassRuns(query: TimelineQuery) {
    const result = await safeInvoke("tracker_get_project_pass_runs", { query });
    return result ?? [];
  },
  async saveAiReviewEvents(events: AiReviewEventInput[]) {
    const result = await safeInvoke("tracker_save_ai_review_events", { query: { events } });
    return result ?? { saved: 0 };
  },
  async getAiReviewEvents(query: TimelineQuery) {
    const result = await safeInvoke("tracker_get_ai_review_events", { query });
    return result ?? [];
  },
  async revertAiReviewEvent(id: number) {
    const result = await safeInvoke("tracker_revert_ai_review_event", { query: { id } });
    return result ?? { reverted: false, restored: false };
  },
  async previewBrowserHistoryImport(query?: BrowserHistoryImportQuery) {
    if (shouldUsePreviewData()) return emptyBrowserHistoryImportPreview(query);
    const result = await safeInvoke("tracker_preview_browser_history_import", { query: query ?? {} });
    return result ?? emptyBrowserHistoryImportPreview(query);
  },
  async importBrowserHistory(query?: BrowserHistoryImportQuery) {
    if (shouldUsePreviewData()) return emptyBrowserHistoryImportResult(query);
    const result = await safeInvoke("tracker_import_browser_history", { query: query ?? {} });
    return result ?? emptyBrowserHistoryImportResult(query);
  },
  async getBrowserHistoryEnvironment(): Promise<BrowserHistoryEnvironment> {
    const fallback: BrowserHistoryEnvironment = { safariHistoryReadable: false, defaultBrowserIsSafari: false };
    if (shouldUsePreviewData()) return fallback;
    const result = await safeInvoke("tracker_get_browser_history_environment");
    return result ?? fallback;
  },
  async getSyncOutbox(query: SyncOutboxQuery): Promise<SyncOutboxPage> {
    const fallback: SyncOutboxPage = { items: [], batchMaxSeq: query.afterSeq, counterSeq: query.afterSeq, pendingCount: 0 };
    if (shouldUsePreviewData()) return fallback;
    const result = await safeInvoke("tracker_get_sync_outbox", { query });
    return result ?? fallback;
  },
  async getSyncState(): Promise<SyncStateSnapshot> {
    const fallback: SyncStateSnapshot = { state: {}, counterSeq: 0, pendingDeletions: 0 };
    if (shouldUsePreviewData()) return fallback;
    const result = await safeInvoke("tracker_get_sync_state");
    return result ?? fallback;
  },
  async setSyncState(entries: Record<string, string | null>) {
    if (shouldUsePreviewData()) return { written: 0 };
    const result = await safeInvoke("tracker_set_sync_state", { query: { entries } });
    return result ?? { written: 0 };
  },
  async applySyncedSegments(segments: SyncedSegmentInput[]): Promise<SyncApplyResult> {
    const fallback: SyncApplyResult = { inserted: 0, updated: 0, skipped: segments.length };
    if (shouldUsePreviewData()) return fallback;
    const result = await safeInvoke("tracker_apply_synced_segments", { query: { segments } });
    return result ?? fallback;
  },
  async getPendingSyncDeletions(limit?: number): Promise<SyncDeletionRecord[]> {
    if (shouldUsePreviewData()) return [];
    const result = await safeInvoke("tracker_get_pending_sync_deletions", { query: { limit } });
    return result ?? [];
  },
  async markSyncDeletionsPushed(deletionUids: readonly string[]) {
    if (shouldUsePreviewData()) return { marked: 0 };
    const result = await safeInvoke("tracker_mark_sync_deletions_pushed", { query: { deletionUids } });
    return result ?? { marked: 0 };
  },
  async applySyncedDeletions(deletions: SyncDeletionRecord[]): Promise<SyncDeletionsApplyResult> {
    const fallback: SyncDeletionsApplyResult = { applied: 0, skipped: deletions.length };
    if (shouldUsePreviewData()) return fallback;
    const result = await safeInvoke("tracker_apply_synced_deletions", { query: { deletions } });
    return result ?? fallback;
  },
  async purgeRemoteSegments() {
    if (shouldUsePreviewData()) return { purged: 0 };
    const result = await safeInvoke("tracker_purge_remote_segments");
    return result ?? { purged: 0 };
  },
  async updateTrayProductivityIcon(mix: ProductivityShareMix) {
    if (shouldUsePreviewData()) return;
    await safeInvoke("tray_update_productivity_icon", {
      focus: mix.focus,
      drift: mix.drift,
      neutral: mix.neutral,
    });
  },
  async updateTrayIconStyle(style: TrayIconStyle) {
    if (shouldUsePreviewData()) return;
    await safeInvoke("tray_update_icon_style", { style });
  },
  async updateTrayDisplayMode(mode: TrayDisplayMode, focusSeconds: number) {
    if (shouldUsePreviewData()) return;
    await safeInvoke("tray_update_display_mode", { mode, focusSeconds });
  },
  async updateTrayDriftAlarmStatus(status: DriftAlarmTrayStatus) {
    if (shouldUsePreviewData()) return;
    await safeInvoke("tray_update_drift_alarm_status", { status });
  },
};
