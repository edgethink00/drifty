import type {
  AI_ROUTES,
  COUNT_BUCKETS,
  ERROR_KINDS,
  FIRST_DAY_PREPARATION_DURATION_BUCKETS,
  FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS,
  FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS,
} from "./eventTaxonomy";
import { cliFailureReasonFromMessage, type CliAiFailureReason } from "../cliFailure";

export type CountBucket = (typeof COUNT_BUCKETS)[number];
export type AnalyticsErrorKind = (typeof ERROR_KINDS)[number];
export type FirstDayPreparationDurationBucket = (typeof FIRST_DAY_PREPARATION_DURATION_BUCKETS)[number];
export type FirstDayPreparationStageDurationBucket = (typeof FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS)[number];
export type FirstDayPreparationSegmentCountBucket = (typeof FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS)[number];
export type AiRoute = (typeof AI_ROUTES)[number];

/** The analytics route for a non-Cloud classification provider; none for Cloud or no provider. */
export function toAiRoute(provider: string | null | undefined): AiRoute | undefined {
  switch (provider) {
    case "managed_local":
    case "openai":
    case "anthropic":
    case "self_hosted":
    case "codex_cli":
    case "claude_cli":
      return provider;
    case "openrouter_byok":
      return "openrouter";
    default:
      return undefined;
  }
}

export function toCountBucket(value: number): CountBucket {
  if (!Number.isFinite(value) || value <= 0) return "none";
  if (value === 1) return "1";
  if (value <= 5) return "2_5";
  if (value <= 20) return "6_20";
  if (value <= 50) return "21_50";
  return "50_plus";
}

/**
 * Builds a daily dedup key from every property an event actually reports.
 *
 * Keying on a subset would be worse than dropping the event outright: the one
 * surviving row's count buckets and error kinds would silently describe whichever
 * occurrence happened first that day. With the full combination as the key, each
 * row keeps a plain meaning — this exact combination occurred at least once today
 * — and daily volume is bounded by how many distinct combinations a person
 * actually produces rather than by how long the app stays open.
 */
export function toDailyDedupKey(properties: Readonly<Record<string, unknown>>): string {
  return Object.keys(properties)
    .sort()
    .map((key) => `${key}=${String(properties[key])}`)
    .join("|");
}

export function toFirstDayPreparationDurationBucket(valueMs: number): FirstDayPreparationDurationBucket {
  if (!Number.isFinite(valueMs) || valueMs < 30_000) return "under_30s";
  if (valueMs < 90_000) return "30_90s";
  if (valueMs < 180_000) return "90_180s";
  if (valueMs < 300_000) return "180_300s";
  return "300s_plus";
}

export function toFirstDayPreparationStageDurationBucket(valueMs: number): FirstDayPreparationStageDurationBucket {
  if (!Number.isFinite(valueMs) || valueMs < 5_000) return "under_5s";
  if (valueMs < 15_000) return "5_15s";
  if (valueMs < 30_000) return "15_30s";
  if (valueMs < 60_000) return "30_60s";
  return "60s_plus";
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
  // A CLI failure says exactly what went wrong; keyword guessing would read its
  // generic "sign-in and usage limit" advice as a rate limit.
  const cliReason = cliFailureReasonFromMessage(message);
  if (cliReason) return cliAnalyticsErrorKind(cliReason);

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

function cliAnalyticsErrorKind(reason: CliAiFailureReason): AnalyticsErrorKind {
  switch (reason) {
    case "not_installed":
      return "not_found";
    case "authentication":
      return "not_authenticated";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "invalid_response":
      return "validation";
    case "unavailable":
      return "provider_error";
    case "cancelled":
      return "unknown";
  }
}
