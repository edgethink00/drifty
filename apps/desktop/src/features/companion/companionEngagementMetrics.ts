export const COMPANION_ENGAGEMENT_METRICS_STORAGE_KEY =
  "drifty.companion.engagementMetrics.v1";

export const COMPANION_ENGAGEMENT_METRIC_KEYS = [
  "companion_enabled",
  "companion_disabled",
  "companion_hidden_one_hour",
  "companion_shown_now",
  "milestone_shown",
  "reentry_shown",
  "reentry_opened",
  "drift_alarm_shown",
  "extreme_nudge_shown",
  "day_review_shown",
  "moment_auto_dismissed",
  "moment_dismissed",
  "moment_preempted",
  "dashboard_opened",
  "settings_opened",
  "leaderboard_opened",
  "trends_opened",
  "return_to_focus",
  "start_break",
  "manual_correction",
] as const;

export type CompanionEngagementMetricKey =
  (typeof COMPANION_ENGAGEMENT_METRIC_KEYS)[number];
export type CompanionEngagementMetrics = Partial<Record<CompanionEngagementMetricKey, number>>;

const METRIC_KEY_SET = new Set<string>(COMPANION_ENGAGEMENT_METRIC_KEYS);
const MAX_LOCAL_METRIC_COUNT = 1_000_000_000;

/** Local aggregate counters only: no app, site, title, timestamp, or event id. */
export function recordCompanionEngagementMetric(
  key: CompanionEngagementMetricKey,
  storage = browserStorage(),
): CompanionEngagementMetrics {
  if (!storage) return {};
  const current = readCompanionEngagementMetrics(storage);
  const next = {
    ...current,
    [key]: Math.min(MAX_LOCAL_METRIC_COUNT, (current[key] ?? 0) + 1),
  };
  try {
    storage.setItem(COMPANION_ENGAGEMENT_METRICS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Metrics must never interfere with the Companion experience.
  }
  return next;
}

export function readCompanionEngagementMetrics(
  storage = browserStorage(),
): CompanionEngagementMetrics {
  if (!storage) return {};
  try {
    const raw = storage.getItem(COMPANION_ENGAGEMENT_METRICS_STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return {};
    const metrics: CompanionEngagementMetrics = {};
    for (const [key, count] of Object.entries(value)) {
      if (!METRIC_KEY_SET.has(key) || !isValidCount(count)) continue;
      metrics[key as CompanionEngagementMetricKey] = count;
    }
    return metrics;
  } catch {
    return {};
  }
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_LOCAL_METRIC_COUNT;
}
