import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityClassificationRecord,
  ActivitySegment,
  AppIconMap,
  AppIdentity,
  ClassificationMetrics,
  ClassificationQuery,
  ClassificationRule,
  ClassificationRuleApplyResult,
  ClassificationRuleCandidate,
  ClassificationRuleInput,
  CurrentActivitySnapshot,
  ProductivityShareMix,
  RawEventsQuery,
  SiteDuration,
  TimelineQuery,
  TrackerApi,
  TrackerStatus,
} from "@drifty/domain";
import { previewAppIcons, previewHourlySummary, previewStatus, previewTimeline, previewTopSites, shouldUsePreviewData } from "./previewData";

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

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    throw new TrackerInvokeError(cmd, error);
  }
}

export const trackerClient: TrackerApi = {
  async getStatus() {
    if (shouldUsePreviewData()) return previewStatus();
    try {
      const status = await safeInvoke<Record<string, unknown>>("tracker_get_status");
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
    const status = await safeInvoke<Record<string, unknown>>("tracker_start");
    if (!status) {
      throw new Error("Tracker is not available. Please run the desktop app.");
    }
    return normalizeStatus(status);
  },
  async stop() {
    if (shouldUsePreviewData()) return { ...previewStatus(), running: false };
    const status = await safeInvoke<Record<string, unknown>>("tracker_stop");
    if (!status) {
      throw new Error("Tracker is not available. Please run the desktop app.");
    }
    return normalizeStatus(status);
  },
  async getTimeline(query: TimelineQuery) {
    if (shouldUsePreviewData()) return previewTimeline(query);
    const result = await safeInvoke<ActivitySegment[]>("tracker_get_timeline", { query });
    return result ?? [];
  },
  async getCurrentSnapshot() {
    return await safeInvoke<CurrentActivitySnapshot>("tracker_get_current_snapshot");
  },
  async getHourlySummary(query: TimelineQuery) {
    if (shouldUsePreviewData()) return previewHourlySummary(query);
    const buckets = await safeInvoke<
      Array<{
        hour?: string;
        hourLabel?: string;
        totalSeconds?: number;
        durationSeconds?: number;
        appBreakdown?: Array<{ appName: string; totalSeconds: number }>;
        topApps?: Array<{ appName: string; durationSeconds: number }>;
      }>
    >("tracker_get_hourly_summary", { query });

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
    const result = await safeInvoke<ActivitySegment[]>("tracker_get_raw_events", { query });
    return result ?? [];
  },
  async getTopSites(query: import("@drifty/domain").TopSitesQuery) {
    if (shouldUsePreviewData()) return previewTopSites(query);
    const result = await safeInvoke<SiteDuration[]>("tracker_get_top_sites", { query });
    return result ?? [];
  },
  async getAppIcons(apps: AppIdentity[]) {
    if (shouldUsePreviewData()) return previewAppIcons(apps);
    const result = await safeInvoke<AppIconMap>("tracker_get_app_icons", { query: { apps } });
    return result ?? {};
  },
  async getUnclassifiedSegments(query: ClassificationQuery) {
    if (shouldUsePreviewData()) return [];
    const result = await safeInvoke<ActivitySegment[]>("tracker_get_unclassified_segments", { query });
    return result ?? [];
  },
  async getReusableAiClassifications(inputFingerprints: string[]) {
    if (shouldUsePreviewData()) return {};
    const result = await safeInvoke<Record<string, ActivityClassificationRecord>>("tracker_get_reusable_ai_classifications", { query: { inputFingerprints } });
    return result ?? {};
  },
  async getClassificationRules() {
    const result = await safeInvoke<ClassificationRule[]>("tracker_get_classification_rules");
    return result ?? [];
  },
  async saveClassificationRule(input: ClassificationRuleInput) {
    const result = await safeInvoke<ClassificationRule>("tracker_save_classification_rule", { query: { input } });
    return result ?? {
      id: "",
      targetKind: input.targetKind,
      targetValue: input.targetValue,
      category: input.category,
      productivity: input.productivity,
      enabled: input.enabled ?? true,
      confidence: input.confidence ?? null,
    };
  },
  async deleteClassificationRule(id: string) {
    const result = await safeInvoke<{ deleted: number }>("tracker_delete_classification_rule", { query: { id } });
    return result ?? { deleted: 0 };
  },
  async deleteActivitySegments(ids: readonly string[]) {
    const result = await safeInvoke<{ deleted: number }>("tracker_delete_activity_segments", { query: { ids } });
    return result ?? { deleted: 0 };
  },
  async searchClassificationRuleCandidates(query: string) {
    const result = await safeInvoke<ClassificationRuleCandidate[]>("tracker_search_classification_rule_candidates", { query: { query } });
    return result ?? [];
  },
  async applyClassificationRules(query?: ClassificationQuery) {
    const result = await safeInvoke<ClassificationRuleApplyResult>("tracker_apply_classification_rules", { query });
    return result ?? { matchedCount: 0, appliedCount: 0, skippedCount: 0 };
  },
  async saveClassifications(classifications: ActivityClassificationRecord[]) {
    const result = await safeInvoke<{ saved: number }>("tracker_save_classifications", { query: { classifications } });
    return result ?? { saved: 0 };
  },
  async refreshNonAiClassifications(query: ClassificationQuery) {
    const result = await safeInvoke<{ deleted: number }>("tracker_refresh_non_ai_classifications", { query });
    return result ?? { deleted: 0 };
  },
  async getClassificationMetrics(query: ClassificationQuery) {
    const result = await safeInvoke<ClassificationMetrics>("tracker_get_classification_metrics", { query });
    return result ?? {
      totalSegments: 0,
      classifiedSegments: 0,
      unclassifiedSegments: 0,
      aiClassifiedSegments: 0,
      staleClassifications: 0,
    };
  },
  async updateTrayProductivityIcon(mix: ProductivityShareMix) {
    if (shouldUsePreviewData()) return;
    await safeInvoke<void>("tray_update_productivity_icon", {
      focus: mix.focus,
      drift: mix.drift,
      neutral: mix.neutral,
    });
  },
};
