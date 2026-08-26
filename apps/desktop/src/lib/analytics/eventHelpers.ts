import type {
  COUNT_BUCKETS,
  ERROR_KINDS,
  FIRST_DAY_PREPARATION_DURATION_BUCKETS,
  FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS,
} from "./eventTaxonomy";

export type CountBucket = (typeof COUNT_BUCKETS)[number];
export type AnalyticsErrorKind = (typeof ERROR_KINDS)[number];
export type FirstDayPreparationDurationBucket = (typeof FIRST_DAY_PREPARATION_DURATION_BUCKETS)[number];
export type FirstDayPreparationSegmentCountBucket = (typeof FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS)[number];

export function toCountBucket(value: number): CountBucket {
  if (!Number.isFinite(value) || value <= 0) return "none";
  if (value === 1) return "1";
  if (value <= 5) return "2_5";
  if (value <= 20) return "6_20";
  if (value <= 50) return "21_50";
  return "50_plus";
}

export function toFirstDayPreparationDurationBucket(valueMs: number): FirstDayPreparationDurationBucket {
  if (!Number.isFinite(valueMs) || valueMs < 30_000) return "under_30s";
  if (valueMs < 90_000) return "30_90s";
  if (valueMs < 180_000) return "90_180s";
  if (valueMs < 300_000) return "180_300s";
  return "300s_plus";
}

export function toFirstDayPreparationSegmentCountBucket(value: number): FirstDayPreparationSegmentCountBucket {
  if (!Number.isFinite(value) || value <= 0) return "none";
  if (value <= 20) return "1_20";
  if (value <= 50) return "21_50";
  if (value <= 100) return "51_100";
  return "100_plus";
}

export function toAnalyticsErrorKind(error: unknown): AnalyticsErrorKind {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (normalized.includes("not authenticated") || normalized.includes("sign in") || normalized.includes("auth")) {
    return "not_authenticated";
  }
  if (normalized.includes("permission") || normalized.includes("accessibility") || normalized.includes("denied")) {
    return "permission_denied";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return "timeout";
  }
  if (normalized.includes("rate") || normalized.includes("quota") || normalized.includes("limit")) {
    return "rate_limited";
  }
  if (normalized.includes("network") || normalized.includes("fetch") || normalized.includes("offline")) {
    return "network";
  }
  if (normalized.includes("supabase")) {
    return "supabase_error";
  }
  if (normalized.includes("provider") || normalized.includes("model") || normalized.includes("openai")) {
    return "provider_error";
  }
  if (normalized.includes("config") || normalized.includes("not configured")) {
    return "configuration";
  }
  if (normalized.includes("validation") || normalized.includes("invalid")) {
    return "validation";
  }
  if (normalized.includes("unavailable")) {
    return "unavailable";
  }
  if (normalized.includes("not found")) {
    return "not_found";
  }
  if (normalized.includes("tracker")) {
    return "tracker_unavailable";
  }

  return "unknown";
}
