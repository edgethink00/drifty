import { describe, expect, it } from "vitest";
import {
  createPostHogIdentifyPayload,
  createPostHogPlanPayload,
  toPostHogPersonPlan,
  toPostHogPersonPlatform,
} from "./accountProfile";

const base = {
  apiKey: "phc_test",
  accountDistinctId: "account_abc",
  installDistinctId: "install_xyz",
  platform: "macos",
  plan: null,
  appVersion: "1.2.3",
  now: new Date("2026-10-30T01:00:00.000Z"),
} as const;

describe("PostHog account profile payloads", () => {
  it("links the install to the account and sets only the contact fields used for update email", () => {
    const payload = createPostHogIdentifyPayload({
      ...base,
      plan: "trial",
      user: {
        email: " Person@Example.com ",
        created_at: "2026-09-01T00:00:00Z",
        user_metadata: { full_name: "Ari Kim", avatar_url: "https://private" },
      },
    });

    expect(payload).toEqual({
      api_key: "phc_test",
      event: "$identify",
      distinct_id: "account_abc",
      properties: {
        $anon_distinct_id: "install_xyz",
        $set: {
          email: "person@example.com",
          name: "Ari Kim",
          platform: "mac",
          plan: "trial",
          last_active_at: "2026-10-30T01:00:00.000Z",
          app_version: "1.2.3",
        },
        $set_once: { signup_at: "2026-09-01T00:00:00.000Z" },
        $geoip_disable: true,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("avatar_url");
  });

  it("sends nothing for an account without an email address", () => {
    expect(createPostHogIdentifyPayload({ ...base, user: { email: null } })).toBeNull();
    expect(createPostHogIdentifyPayload({ ...base, user: { email: "" } })).toBeNull();
  });

  it("omits fields the account does not have", () => {
    const payload = createPostHogIdentifyPayload({ ...base, platform: "other", user: { email: "a@b.co" } });
    expect(payload?.properties.$set).toEqual({
      email: "a@b.co",
      last_active_at: "2026-10-30T01:00:00.000Z",
      app_version: "1.2.3",
    });
    expect(payload?.properties).not.toHaveProperty("$set_once");
  });

  it("maps entitlement status and host platform to the targeting values", () => {
    expect(toPostHogPersonPlan({ status: "active" })).toBe("pro");
    expect(toPostHogPersonPlan({ status: "trialing" })).toBe("trial");
    expect(toPostHogPersonPlan({ status: "locked" })).toBe("free");
    expect(toPostHogPersonPlatform("macos")).toBe("mac");
    expect(toPostHogPersonPlatform("windows")).toBe("windows");
    expect(toPostHogPersonPlatform("other")).toBeNull();
    expect(createPostHogPlanPayload({ apiKey: "phc_test", accountDistinctId: "account_abc", plan: "pro" })).toEqual({
      api_key: "phc_test",
      event: "$set",
      distinct_id: "account_abc",
      properties: { $set: { plan: "pro" }, $geoip_disable: true },
    });
  });
});
