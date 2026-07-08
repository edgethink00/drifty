import type { AiClassificationSummary } from "../features/classification/aiClassificationService";
import type { DashboardPeriod } from "../features/dashboard/dashboardPeriods";
import {
  capturePostHogEvent,
  toAnalyticsErrorKind,
  toCountBucket,
  type PostHogEventPropertiesByName,
} from "../lib/analytics/posthog";
import type { TabId } from "./navigation";

type AppSurfaceAnalyticsValue = PostHogEventPropertiesByName["app_surface_opened"]["surface"];
type DashboardPeriodAnalyticsValue = NonNullable<PostHogEventPropertiesByName["app_surface_opened"]["dashboard_period"]>;
type TrackerModeAnalyticsValue = NonNullable<PostHogEventPropertiesByName["tracker_action"]["tracker_mode"]>;
type AiProviderAnalyticsValue = PostHogEventPropertiesByName["ai_classification_run"]["provider_kind"];
type AiClassificationResultAnalyticsValue = PostHogEventPropertiesByName["ai_classification_run"]["result"];
type AiClassificationRangeAnalyticsValue = NonNullable<PostHogEventPropertiesByName["ai_classification_run"]["range"]>;
type AiClassificationTriggerAnalyticsValue = PostHogEventPropertiesByName["ai_classification_run"]["trigger"];

export function toDashboardPeriodAnalytics(period: DashboardPeriod): DashboardPeriodAnalyticsValue {
  switch (period) {
    case "Today":
      return "day";
    case "Week":
      return "week";
    case "Month":
      return "month";
    default:
      return assertNever(period);
  }
}

export function toAppSurfaceAnalytics(tabId: TabId): AppSurfaceAnalyticsValue {
  switch (tabId) {
    case "dashboard":
    case "classification":
    case "projects":
    case "history":
    case "trends":
    case "leaderboard":
    case "profile":
    case "team":
    case "settings":
      return tabId;
    default:
      return assertNever(tabId);
  }
}

export function toTrackerModeAnalytics(trackerMode: string | null | undefined): TrackerModeAnalyticsValue {
  switch (trackerMode) {
    case "tracking":
    case "idle":
    case "unavailable":
    case "preview":
    case "demo":
      return trackerMode;
    default:
      return "unknown";
  }
}

export function toAiProviderAnalytics(
  hasLocalProvider: boolean,
  canUseCloudProvider: boolean,
): AiProviderAnalyticsValue {
  if (hasLocalProvider) return "local";
  if (canUseCloudProvider) return "cloud";
  return "none";
}

function toAiClassificationResultAnalytics(summary: AiClassificationSummary): AiClassificationResultAnalyticsValue {
  switch (summary.status) {
    case "saved":
      return "success";
    case "empty":
    case "idle":
    case "running":
      return "skipped";
    case "disabled":
      return "disabled";
    case "error":
      return "error";
    default:
      return assertNever(summary.status);
  }
}

export function captureAiClassificationRun(
  trigger: AiClassificationTriggerAnalyticsValue,
  providerKind: AiProviderAnalyticsValue,
  range: AiClassificationRangeAnalyticsValue,
  summary: AiClassificationSummary,
) {
  capturePostHogEvent("ai_classification_run", {
    trigger,
    provider_kind: providerKind,
    result: toAiClassificationResultAnalytics(summary),
    selected_count_bucket: toCountBucket(summary.selectedSegments),
    saved_count_bucket: toCountBucket(summary.savedRecords),
    range,
    ...(summary.status === "error" ? { error_kind: toAnalyticsErrorKind(summary.message) } : {}),
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled analytics value: ${String(value)}`);
}
