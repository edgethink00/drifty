import {
  POSTHOG_EVENT_PROPERTY_ALLOWLIST,
  type PostHogEventName,
  type PostHogPropertyRule,
} from "./eventTaxonomy";

const POSTHOG_BLOCKED_PROPERTY_KEYS = [
  "$process_person_profile",
  "$geoip_disable",
  "$identify",
  "$anon_distinct_id",
  "$set",
  "$alias",
  "$merge_dangerously",
  "api_key",
  "distinct_id",
  "event_source",
  "event_surface",
  "app_platform",
  "runtime",
  "channel",
  "analytics_schema_version",
  "app_version",
  "build_commit",
  "build_origin",
  "identity_scope",
  "reporting_time_zone",
  "email",
  "user_id",
  "account_id",
  "supabase_user_id",
  "billing_customer_id",
  "coupon_code",
  "coupon_campaign",
  "profile_public_id",
  "display_name",
  "app_name",
  "bundle_id",
  "site_domain",
  "url",
  "path",
  "query",
  "page_title",
  "window_title",
  "session_id",
  "segment_id",
  "timeline_id",
  "raw_timeline",
  "raw_event",
  "prompt",
  "response_text",
  "provider_api_key",
  "checkout_url",
  "focus_seconds",
] as const;

export type PostHogPropertyValue = string | boolean;
export type SanitizedPostHogProperties = Readonly<Record<string, PostHogPropertyValue>>;

function isBlockedPostHogPropertyKey(key: string): boolean {
  return POSTHOG_BLOCKED_PROPERTY_KEYS.some((blockedKey) => blockedKey === key);
}

function getAllowedPostHogPropertyValue(rule: PostHogPropertyRule, value: unknown): PostHogPropertyValue | undefined {
  if (rule === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  return rule.some((allowedValue) => allowedValue === value) ? value : undefined;
}

export function sanitizePostHogEventProperties(
  event: PostHogEventName,
  properties: Readonly<Record<string, unknown>> | undefined,
): SanitizedPostHogProperties {
  const sanitized: Record<string, PostHogPropertyValue> = {};

  if (!properties) {
    return sanitized;
  }

  const eventAllowlist = POSTHOG_EVENT_PROPERTY_ALLOWLIST[event];

  for (const [key, value] of Object.entries(properties)) {
    if (isBlockedPostHogPropertyKey(key)) {
      continue;
    }

    const rule = eventAllowlist[key];
    if (!rule) {
      continue;
    }

    const sanitizedValue = getAllowedPostHogPropertyValue(rule, value);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }

  return sanitized;
}
