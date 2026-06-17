import type { UserOnboardingState } from "../onboarding/onboardingState";

const MAX_WORK_PROFILE_TEXT_LENGTH = 100;

export function normalizeOnboardingWorkProfile(state: UserOnboardingState | null): string | null {
  if (!state) return null;
  const workType = normalizeWorkProfileActivities(state.jobType, state.jobTypeOther)
    ?? normalizeWorkProfilePart(state.workType, state.workTypeOther);
  const workDomain = normalizeWorkProfilePart(state.workDomain, state.workDomainOther);
  if (!workType && !workDomain) return null;
  if (workType && workDomain) return `${workType} in ${workDomain}`;
  return workType ?? workDomain;
}

function normalizeWorkProfileActivities(value: string | null, otherValue: string): string | null {
  const normalizedValue = sanitizeWorkProfileText(value);
  if (!normalizedValue) return null;
  const activities = normalizedValue
    .split(",")
    .map((activity) => normalizeWorkProfilePart(activity, otherValue))
    .filter((activity): activity is string => Boolean(activity));
  if (activities.length === 0) return null;
  return Array.from(new Set(activities)).join(", ");
}

function normalizeWorkProfilePart(value: string | null, otherValue: string): string | null {
  const normalizedValue = sanitizeWorkProfileText(value);
  if (normalizedValue === "Other") {
    const normalizedOther = sanitizeWorkProfileText(otherValue);
    return normalizedOther ? `Other: ${normalizedOther}` : null;
  }
  return normalizedValue;
}

function sanitizeWorkProfileText(value: string | null | undefined): string | null {
  const normalized = value
    ?.replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_WORK_PROFILE_TEXT_LENGTH).trim() || null;
}
