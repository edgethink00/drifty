export const POST_ONBOARDING_SIDEBAR_GUIDE_STORAGE_KEY_PREFIX = "drifty.postOnboardingSidebarGuide.v1";
export const POST_ONBOARDING_SIDEBAR_GUIDE_REVIEW_QUERY_PARAM = "driftySidebarGuideReview";
export const POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export const POST_ONBOARDING_SIDEBAR_GUIDE_STEPS = ["dashboard", "activity", "tracking", "account"] as const;

export type PostOnboardingSidebarGuideStep = typeof POST_ONBOARDING_SIDEBAR_GUIDE_STEPS[number];
export type PostOnboardingSidebarGuideStatus = "active" | "completed" | "dismissed" | "expired";

export type PostOnboardingSidebarGuideRecord = {
  readonly version: 1;
  readonly status: PostOnboardingSidebarGuideStatus;
  readonly step: PostOnboardingSidebarGuideStep;
  readonly startedAt: string;
  readonly updatedAt: string;
};

export function postOnboardingSidebarGuideStorageKey(userId: string): string {
  return `${POST_ONBOARDING_SIDEBAR_GUIDE_STORAGE_KEY_PREFIX}:${userId || "local"}`;
}

export function isPostOnboardingSidebarGuideReviewEnabled(search: string, isDevelopment: boolean): boolean {
  if (!isDevelopment) return false;
  return new URLSearchParams(search).get(POST_ONBOARDING_SIDEBAR_GUIDE_REVIEW_QUERY_PARAM) === "1";
}

export function parsePostOnboardingSidebarGuideRecord(value: string | null): PostOnboardingSidebarGuideRecord | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<PostOnboardingSidebarGuideRecord>;
    if (
      candidate.version !== 1
      || !POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.includes(candidate.step as PostOnboardingSidebarGuideStep)
      || (candidate.status !== "active"
        && candidate.status !== "completed"
        && candidate.status !== "dismissed"
        && candidate.status !== "expired")
      || typeof candidate.startedAt !== "string"
      || !Number.isFinite(Date.parse(candidate.startedAt))
      || typeof candidate.updatedAt !== "string"
      || !Number.isFinite(Date.parse(candidate.updatedAt))
    ) return null;
    return candidate as PostOnboardingSidebarGuideRecord;
  } catch {
    return null;
  }
}

export function readPostOnboardingSidebarGuideRecord(userId: string): PostOnboardingSidebarGuideRecord | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePostOnboardingSidebarGuideRecord(
      window.localStorage.getItem(postOnboardingSidebarGuideStorageKey(userId)),
    );
  } catch {
    return null;
  }
}

export function persistPostOnboardingSidebarGuideRecord(
  userId: string,
  record: PostOnboardingSidebarGuideRecord,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(postOnboardingSidebarGuideStorageKey(userId), JSON.stringify(record));
  } catch {
    // A storage failure must never block the app after onboarding.
  }
}

export function resolvePostOnboardingSidebarGuideRecord(
  record: PostOnboardingSidebarGuideRecord | null,
  now = new Date(),
): PostOnboardingSidebarGuideRecord | null {
  if (!record || record.status !== "active") return record;
  if (now.getTime() - Date.parse(record.startedAt) < POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS) return record;
  return { ...record, status: "expired", updatedAt: now.toISOString() };
}

export function beginPostOnboardingSidebarGuide(
  existing: PostOnboardingSidebarGuideRecord | null,
  now = new Date(),
): PostOnboardingSidebarGuideRecord {
  const resolved = resolvePostOnboardingSidebarGuideRecord(existing, now);
  if (resolved) return resolved;
  const timestamp = now.toISOString();
  return {
    version: 1,
    status: "active",
    step: "dashboard",
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function restartPostOnboardingSidebarGuide(now = new Date()): PostOnboardingSidebarGuideRecord {
  return beginPostOnboardingSidebarGuide(null, now);
}

export function advancePostOnboardingSidebarGuide(
  record: PostOnboardingSidebarGuideRecord,
  now = new Date(),
): PostOnboardingSidebarGuideRecord {
  if (record.status !== "active") return record;
  const index = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.indexOf(record.step);
  const next = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS[index + 1];
  if (!next) return completePostOnboardingSidebarGuide(record, now);
  return { ...record, step: next, updatedAt: now.toISOString() };
}

export function retreatPostOnboardingSidebarGuide(
  record: PostOnboardingSidebarGuideRecord,
  now = new Date(),
): PostOnboardingSidebarGuideRecord {
  if (record.status !== "active") return record;
  const index = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS.indexOf(record.step);
  const previous = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS[index - 1];
  return previous ? { ...record, step: previous, updatedAt: now.toISOString() } : record;
}

export function completePostOnboardingSidebarGuide(
  record: PostOnboardingSidebarGuideRecord,
  now = new Date(),
): PostOnboardingSidebarGuideRecord {
  if (record.status !== "active") return record;
  return { ...record, status: "completed", updatedAt: now.toISOString() };
}

export function dismissPostOnboardingSidebarGuide(
  record: PostOnboardingSidebarGuideRecord,
  now = new Date(),
): PostOnboardingSidebarGuideRecord {
  if (record.status !== "active") return record;
  return { ...record, status: "dismissed", updatedAt: now.toISOString() };
}
