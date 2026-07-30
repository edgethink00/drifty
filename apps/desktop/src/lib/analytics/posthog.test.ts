import { describe, expect, it } from "vitest";
import {
  POSTHOG_EVENT_NAMES,
  POSTHOG_EVENT_PROPERTY_ALLOWLIST,
  createPostHogAccountIdentityResolver,
  createPostHogDailyActiveRecorder,
  createPostHogEventPayload,
  derivePostHogAccountDistinctId,
  getOrCreatePostHogInstallDistinctId,
  getPostHogReportingDateKey,
  resolvePostHogEventIdentity,
  sanitizePostHogEventProperties,
  shouldEnablePostHog,
  toAnalyticsErrorKind,
  toCountBucket,
  type PostHogIdentity,
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
      identityScope: "install",
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
        "app_active",
        "onboarding_completed",
        "permission_action",
        "tracker_action",
        "cloud_auth_action",
        "billing_action",
        "leaderboard_action",
        "ai_setup_action",
        "ai_classification_run",
        "project_classification_run",
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
    expect(POSTHOG_EVENT_PROPERTY_ALLOWLIST.project_classification_run).toMatchObject({
      trigger: expect.any(Array),
      result: expect.any(Array),
      skip_reason: expect.any(Array),
      assignment_count_bucket: expect.any(Array),
      correction_count_bucket: expect.any(Array),
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
      identityScope: "install",
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
        analytics_schema_version: "v2",
        app_version: "1.3.3",
        identity_scope: "install",
        reporting_time_zone: "Asia/Seoul",
        trigger: "manual",
        provider_kind: "cloud",
        result: "success",
        selected_count_bucket: "2_5",
        saved_count_bucket: "1",
        range: "current_day",
      },
    });
  });

  it("builds a privacy-safe scheduled project classification payload", () => {
    const properties = {
      trigger: "schedule",
      result: "error",
      assignment_count_bucket: "none",
      correction_count_bucket: "none",
      error_kind: "provider_error",
    } satisfies PostHogEventPropertiesByName["project_classification_run"];

    const sanitized = sanitizePostHogEventProperties("project_classification_run", {
      ...properties,
      raw_payload: { window_title: "Sensitive title" },
    });
    const payload = createPostHogEventPayload({
      apiKey: "phc_test",
      distinctId: "launch-session",
      identityScope: "install",
      event: "project_classification_run",
      properties: sanitized,
    });

    expect(payload.properties).toMatchObject(properties);
    expect("raw_payload" in payload.properties).toBe(false);
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
      identityScope: "install",
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

  it("enables production analytics only for the Tauri runtime", () => {
    const base = {
      hasProjectKey: true,
      mode: "production",
      channel: "production",
      hasWindow: true,
      isTauri: true,
    } as const;

    expect(shouldEnablePostHog(base)).toBe(true);
    expect(shouldEnablePostHog({ ...base, isTauri: false })).toBe(false);
    expect(shouldEnablePostHog({ ...base, channel: "development" })).toBe(false);
    expect(shouldEnablePostHog({ ...base, mode: "test" })).toBe(false);
    expect(shouldEnablePostHog({ ...base, hasProjectKey: false })).toBe(false);
  });

  it("persists a dedicated install identity without reusing account or device ids", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    const first = getOrCreatePostHogInstallDistinctId(storage, () => "11111111-1111-4111-8111-111111111111");
    const second = getOrCreatePostHogInstallDistinctId(storage, () => "22222222-2222-4222-8222-222222222222");

    expect(first).toBe("install_11111111-1111-4111-8111-111111111111");
    expect(second).toBe(first);
  });

  it("falls back to a process identity when analytics storage reads or writes fail", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage read blocked");
      },
      setItem: () => {
        throw new Error("storage write blocked");
      },
    };

    expect(() => getOrCreatePostHogInstallDistinctId(storage, () => "fallback-id")).not.toThrow();
    expect(getOrCreatePostHogInstallDistinctId(storage, () => "fallback-id")).toBe("install_fallback-id");
  });

  it("uses the stable account identity only for app_active events", () => {
    const install = { distinctId: "install_test", scope: "install" } satisfies PostHogIdentity;
    const account = { distinctId: "account_test", scope: "account" } satisfies PostHogIdentity;

    expect(resolvePostHogEventIdentity("app_active", install, account)).toBe(account);
    expect(resolvePostHogEventIdentity("app_active", install, null)).toBe(install);
    expect(resolvePostHogEventIdentity("auth_state_changed", install, account)).toBe(install);
    expect(resolvePostHogEventIdentity("billing_action", install, account)).toBe(install);
    expect(resolvePostHogEventIdentity("ai_classification_run", install, account)).toBe(install);
  });

  it("ignores stale account identity resolutions after an account switch or sign-out", async () => {
    const pending = new Map<string, (distinctId: string) => void>();
    const resolver = createPostHogAccountIdentityResolver(
      (userId) => new Promise<string>((resolve) => pending.set(userId, resolve)),
    );

    const first = resolver.resolve("first-user");
    const second = resolver.resolve("second-user");
    pending.get("first-user")?.("account_first");
    await expect(first).resolves.toBeNull();
    pending.get("second-user")?.("account_second");
    await expect(second).resolves.toEqual({ distinctId: "account_second", scope: "account" });

    const signedOut = resolver.resolve("third-user");
    resolver.clear();
    pending.get("third-user")?.("account_third");
    await expect(signedOut).resolves.toBeNull();
  });

  it("deduplicates concurrent daily-active delivery and remembers success without storage", async () => {
    const recordDailyActive = createPostHogDailyActiveRecorder();
    const identity = { distinctId: "account_test", scope: "account" } satisfies PostHogIdentity;
    const storage = {
      getItem: () => {
        throw new Error("storage read blocked");
      },
      setItem: () => {
        throw new Error("storage write blocked");
      },
    };
    let deliverCount = 0;
    let finishDelivery!: (delivered: boolean) => void;
    const pendingDelivery = new Promise<boolean>((resolve) => {
      finishDelivery = resolve;
    });
    const input = {
      identity,
      reportingDate: "2026-07-31",
      storage,
      deliver: () => {
        deliverCount += 1;
        return pendingDelivery;
      },
    };

    const first = recordDailyActive(input);
    await expect(recordDailyActive(input)).resolves.toBe(false);
    expect(deliverCount).toBe(1);
    finishDelivery(true);
    await expect(first).resolves.toBe(true);
    await expect(recordDailyActive(input)).resolves.toBe(false);
    expect(deliverCount).toBe(1);
  });

  it("retries daily-active delivery after a failed request", async () => {
    const recordDailyActive = createPostHogDailyActiveRecorder();
    const identity = { distinctId: "account_test", scope: "account" } satisfies PostHogIdentity;
    let deliverCount = 0;
    const input = {
      identity,
      reportingDate: "2026-07-31",
      storage: null,
      deliver: async () => {
        deliverCount += 1;
        return deliverCount > 1;
      },
    };

    await expect(recordDailyActive(input)).resolves.toBe(false);
    await expect(recordDailyActive(input)).resolves.toBe(true);
    await expect(recordDailyActive(input)).resolves.toBe(false);
    expect(deliverCount).toBe(2);
  });

  it("derives a stable account pseudonym without exposing the Supabase UUID", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const first = await derivePostHogAccountDistinctId(userId);
    const second = await derivePostHogAccountDistinctId(userId);
    const other = await derivePostHogAccountDistinctId("22222222-2222-4222-8222-222222222222");

    expect(first).toMatch(/^account_[0-9a-f]{64}$/);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).not.toContain(userId);
  });

  it("uses the configured KST reporting date for daily active de-duplication", () => {
    expect(getPostHogReportingDateKey(new Date("2026-07-31T14:59:59.000Z"))).toBe("2026-07-31");
    expect(getPostHogReportingDateKey(new Date("2026-07-31T15:00:00.000Z"))).toBe("2026-08-01");
  });
});
