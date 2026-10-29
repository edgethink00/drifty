/**
 * The one PostHog path that carries who a signed-in person is.
 *
 * Product events stay personless ("$process_person_profile": false) and keep
 * the privacy guard. Only these two payloads create or update a person profile,
 * so monthly update email can reach an account: "$identify" links the install
 * identity to the account pseudonym and sets the contact fields, and "$set"
 * updates the plan. Both are sent only while product analytics is on.
 */
import type { HostPlatform } from "../api/accessibilityClient";

export type PostHogPersonPlan = "free" | "trial" | "pro";
export type PostHogPersonPlatform = "mac" | "windows";

export type PostHogAccountProfileUser = {
  readonly email?: string | null;
  readonly created_at?: string | null;
  readonly user_metadata?: Readonly<Record<string, unknown>> | null;
};

export type PostHogPersonPayload = {
  readonly api_key: string;
  readonly event: "$identify" | "$set";
  readonly distinct_id: string;
  readonly properties: Readonly<Record<string, unknown>>;
};

const MAX_NAME_LENGTH = 100;

export function toPostHogPersonPlatform(platform: HostPlatform): PostHogPersonPlatform | null {
  if (platform === "macos") return "mac";
  if (platform === "windows") return "windows";
  return null;
}

export function toPostHogPersonPlan(entitlement: { readonly status: "trialing" | "active" | "locked" }): PostHogPersonPlan {
  if (entitlement.status === "active") return "pro";
  if (entitlement.status === "trialing") return "trial";
  return "free";
}

function readEmail(user: PostHogAccountProfileUser): string | null {
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  return email.includes("@") ? email : null;
}

function readName(user: PostHogAccountProfileUser): string | null {
  const metadata = user.user_metadata ?? {};
  for (const key of ["full_name", "name", "display_name"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, MAX_NAME_LENGTH);
  }
  return null;
}

function readTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** Returns null for an account without an email address; nothing is sent then. */
export function createPostHogIdentifyPayload(input: {
  readonly apiKey: string;
  readonly accountDistinctId: string;
  readonly installDistinctId: string;
  readonly user: PostHogAccountProfileUser;
  readonly platform: HostPlatform;
  readonly plan: PostHogPersonPlan | null;
  readonly appVersion: string;
  readonly now: Date;
}): PostHogPersonPayload | null {
  const email = readEmail(input.user);
  if (!email) return null;
  const name = readName(input.user);
  const platform = toPostHogPersonPlatform(input.platform);
  const signupAt = readTimestamp(input.user.created_at);

  return {
    api_key: input.apiKey,
    event: "$identify",
    distinct_id: input.accountDistinctId,
    properties: {
      $anon_distinct_id: input.installDistinctId,
      $set: {
        email,
        ...(name ? { name } : {}),
        ...(platform ? { platform } : {}),
        ...(input.plan ? { plan: input.plan } : {}),
        last_active_at: input.now.toISOString(),
        app_version: input.appVersion,
      },
      ...(signupAt ? { $set_once: { signup_at: signupAt } } : {}),
      $geoip_disable: true,
    },
  };
}

export function createPostHogPlanPayload(input: {
  readonly apiKey: string;
  readonly accountDistinctId: string;
  readonly plan: PostHogPersonPlan;
}): PostHogPersonPayload {
  return {
    api_key: input.apiKey,
    event: "$set",
    distinct_id: input.accountDistinctId,
    properties: { $set: { plan: input.plan }, $geoip_disable: true },
  };
}
