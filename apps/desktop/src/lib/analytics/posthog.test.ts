import { describe, expect, it } from "vitest";
import {
  POSTHOG_EVENT_NAMES,
  POSTHOG_EVENT_PROPERTY_ALLOWLIST,
  createPostHogEventPayload,
  sanitizePostHogEventProperties,
  toAnalyticsErrorKind,
  toCountBucket,
  type PostHogEventPropertiesByName,
} from "./posthog";

describe("PostHog desktop analytics privacy boundary", () => {
  it("keeps identity fields out of event properties", () => {
    const sanitized = sanitizePostHogEventProperties("auth_state_changed", {
      auth_state: "signed_in",
      account_kind: "account",
      api_key: "phc_leaked",
      distinct_id: "account-123",
      "$identify": "account-123",
      "$anon_distinct_id": "anonymous-123",
      "$set": { email: "person@example.com" },
      email: "person@example.com",
      user_id: "user-123",
    });
    const payload = createPostHogEventPayload({
      apiKey: "phc_test",
      distinctId: "launch-session",
      event: "auth_state_changed",
      properties: sanitized,
    });

    expect(payload.api_key).toBe("phc_test");
    expect(payload.distinct_id).toBe("launch-session");
    expect(payload.properties).toMatchObject({
      "$process_person_profile": false,
      auth_state: "signed_in",
      account_kind: "account",
    });
    expect("api_key" in payload.properties).toBe(false);
    expect("distinct_id" in payload.properties).toBe(false);
    expect("$identify" in payload.properties).toBe(false);
    expect("$anon_distinct_id" in payload.properties).toBe(false);
    expect("$set" in payload.properties).toBe(false);
    expect("email" in payload.properties).toBe(false);
    expect("user_id" in payload.properties).toBe(false);
  });

  it("keeps every desktop event behind an explicit property allowlist", () => {
    const allowlistedEventNames = Object.keys(POSTHOG_EVENT_PROPERTY_ALLOWLIST).sort();

    expect([...POSTHOG_EVENT_NAMES].sort()).toEqual(allowlistedEventNames);
    expect(new Set(POSTHOG_EVENT_NAMES).size).toBe(POSTHOG_EVENT_NAMES.length);
    expect(POSTHOG_EVENT_NAMES).toEqual(
      expect.arrayContaining([
        "app_surface_opened",
        "onboarding_completed",
        "permission_action",
        "tracker_action",
        "cloud_auth_action",
        "billing_action",
        "leaderboard_action",
        "ai_setup_action",
        "ai_classification_run",
        "app_error",
      ]),
    );
    expect(POSTHOG_EVENT_PROPERTY_ALLOWLIST.ai_classification_run).toMatchObject({
      trigger: expect.any(Array),
      provider_kind: expect.any(Array),
      result: expect.any(Array),
      selected_count_bucket: expect.any(Array),
      saved_count_bucket: expect.any(Array),
      range: expect.any(Array),
      error_kind: expect.any(Array),
    });
  });

  it("maps counts and errors to bounded analytics values", () => {
    expect(toCountBucket(0)).toBe("none");
    expect(toCountBucket(1)).toBe("1");
    expect(toCountBucket(5)).toBe("2_5");
    expect(toCountBucket(20)).toBe("6_20");
    expect(toCountBucket(50)).toBe("21_50");
    expect(toCountBucket(51)).toBe("50_plus");

    expect(toAnalyticsErrorKind(new Error("Network request failed"))).toBe("network");
    expect(toAnalyticsErrorKind(new Error("Permission denied"))).toBe("permission_denied");
    expect(toAnalyticsErrorKind(new Error("Not authenticated"))).toBe("not_authenticated");
    expect(toAnalyticsErrorKind(new Error("Provider model returned an error"))).toBe("provider_error");
    expect(toAnalyticsErrorKind(new Error("Unexpected failure"))).toBe("unknown");
  });

  it("builds a privacy-safe AI classification payload with typed properties", () => {
    const properties = {
      trigger: "manual",
      provider_kind: "cloud",
      result: "success",
      selected_count_bucket: "2_5",
      saved_count_bucket: "1",
      range: "current_day",
    } satisfies PostHogEventPropertiesByName["ai_classification_run"];

    const payload = createPostHogEventPayload({
      apiKey: "phc_test",
      distinctId: "launch-session",
      event: "ai_classification_run",
      properties,
    });

    expect(payload).toEqual({
      api_key: "phc_test",
      event: "ai_classification_run",
      distinct_id: "launch-session",
      properties: {
        "$process_person_profile": false,
        event_source: "mac_app",
        event_surface: "desktop_app",
        app_platform: "macos",
        runtime: "web",
        channel: "development",
        trigger: "manual",
        provider_kind: "cloud",
        result: "success",
        selected_count_bucket: "2_5",
        saved_count_bucket: "1",
        range: "current_day",
      },
    });
  });

  it("forces person profile opt-out and omits sensitive or unsupported caller properties", () => {
    const untrustedProperties: Readonly<Record<string, unknown>> = {
      "$process_person_profile": true,
      trigger: "manual",
      provider_kind: "cloud",
      result: "success",
      selected_count_bucket: "2_5",
      saved_count_bucket: "1",
      range: "current_day",
      email: "person@example.com",
      user_id: "user-123",
      site_domain: "example.com",
      window_title: "Quarterly plan",
      segment_id: "segment-123",
      raw_payload: { window_title: "Nested title" },
      invalid_bucket: 42,
      error_kind: "raw provider stack trace",
    };

    const sanitized = sanitizePostHogEventProperties("ai_classification_run", untrustedProperties);
    const payload = createPostHogEventPayload({
      apiKey: "phc_test",
      distinctId: "launch-session",
      event: "ai_classification_run",
      properties: sanitized,
    });

    expect(payload.properties["$process_person_profile"]).toBe(false);
    expect(payload.properties).toMatchObject({
      trigger: "manual",
      provider_kind: "cloud",
      result: "success",
      selected_count_bucket: "2_5",
      saved_count_bucket: "1",
      range: "current_day",
    });
    expect("email" in payload.properties).toBe(false);
    expect("user_id" in payload.properties).toBe(false);
    expect("site_domain" in payload.properties).toBe(false);
    expect("window_title" in payload.properties).toBe(false);
    expect("segment_id" in payload.properties).toBe(false);
    expect("raw_payload" in payload.properties).toBe(false);
    expect("invalid_bucket" in payload.properties).toBe(false);
    expect("error_kind" in payload.properties).toBe(false);
  });
});
