import type { COUNT_BUCKETS, ERROR_KINDS } from "./eventTaxonomy";

export type CountBucket = (typeof COUNT_BUCKETS)[number];
export type AnalyticsErrorKind = (typeof ERROR_KINDS)[number];

export function toCountBucket(value: number): CountBucket {
  if (!Number.isFinite(value) || value <= 0) return "none";
  if (value === 1) return "1";
  if (value <= 5) return "2_5";
  if (value <= 20) return "6_20";
  if (value <= 50) return "21_50";
  return "50_plus";
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
