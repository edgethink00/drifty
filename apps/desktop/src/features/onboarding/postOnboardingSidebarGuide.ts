export const POST_ONBOARDING_SIDEBAR_GUIDE_STORAGE_KEY_PREFIX = "drifty.postOnboardingSidebarGuide.v1";
export const POST_ONBOARDING_SIDEBAR_GUIDE_REVIEW_QUERY_PARAM = "driftySidebarGuideReview";
export const POST_ONBOARDING_SIDEBAR_GUIDE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * A centered introduction with two six-card sequences of the same shape. The story sequence opens on
 * the user's own first day (its focus, then its largest drift) when the first-day preparation produced
 * enough classified time; otherwise the sample sequence opens on the drawn welcome and Today cards.
 * Both continue with the drift decision ("account", the former Automatic close card, so saved records
 * stay valid), correcting the day, the menu bar ring, and last the handoff to the dashboard.
 */
export const POST_ONBOARDING_SIDEBAR_GUIDE_STEPS = ["welcome", "day", "account", "activity", "tracking", "handoff"] as const;
export const POST_ONBOARDING_STORY_GUIDE_STEPS = ["recap", "drift", "account", "activity", "tracking", "handoff"] as const;
const ALL_GUIDE_STEPS = ["welcome", "day", "recap", "drift", "account", "activity", "tracking", "handoff"] as const;
export type PostOnboardingGuideSequence = readonly PostOnboardingSidebarGuideStep[];
/**
 * Cards everyone sees once, even after Skip: the drift decision ("account": the desktop cat and
 * Automatic close) and the menu bar ring ("tracking": where Drifty keeps running and pauses).
 */
export const POST_ONBOARDING_MUST_SEE_STEPS: readonly PostOnboardingSidebarGuideStep[] = ["account", "tracking"];

/** Keep existing records and completed/dismissed choices compatible. */
const RETIRED_GUIDE_STEPS: Readonly<Record<string, PostOnboardingSidebarGuideStep>> = {
  dashboard: "day",
};

export type PostOnboardingSidebarGuideStep = typeof ALL_GUIDE_STEPS[number];

/**
 * The step to show for a saved step in the given sequence. The two sequences have the same length,
 * so a step saved under the other one (the day's data arrived or went away) keeps its position.
 */
export function postOnboardingGuideStepInSequence(
  step: PostOnboardingSidebarGuideStep,
  sequence: PostOnboardingGuideSequence,
): PostOnboardingSidebarGuideStep {
  if (sequence.includes(step)) return step;
  const sampleIndex = (POST_ONBOARDING_SIDEBAR_GUIDE_STEPS as readonly PostOnboardingSidebarGuideStep[]).indexOf(step);
  const storyIndex = (POST_ONBOARDING_STORY_GUIDE_STEPS as readonly PostOnboardingSidebarGuideStep[]).indexOf(step);
  const index = Math.max(sampleIndex, storyIndex, 0);
  return sequence[Math.min(index, sequence.length - 1)] ?? sequence[0];
}
export type PostOnboardingSidebarGuideStatus = "active" | "completed" | "dismissed" | "expired";

export type PostOnboardingSidebarGuideRecord = {
  readonly version: 1;
  readonly status: PostOnboardingSidebarGuideStatus;
  readonly step: PostOnboardingSidebarGuideStep;
  readonly startedAt: string;
  readonly updatedAt: string;
  /** Set after Skip: the intro then shows only the remaining must-see cards. */
  readonly skipped?: boolean;
  /** The card Skip was first pressed on, so Back from the skipped path returns there. */
  readonly skippedFrom?: PostOnboardingSidebarGuideStep;
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
    const stored = parsed as Partial<PostOnboardingSidebarGuideRecord>;
    const retiredStep = typeof stored.step === "string" ? RETIRED_GUIDE_STEPS[stored.step] : undefined;
    const candidate = retiredStep ? { ...stored, step: retiredStep } : stored;
    if (
      candidate.version !== 1
      || !(ALL_GUIDE_STEPS as readonly string[]).includes(candidate.step as string)
      || (candidate.status !== "active"
        && candidate.status !== "completed"
        && candidate.status !== "dismissed"
        && candidate.status !== "expired")
      || typeof candidate.startedAt !== "string"
      || !Number.isFinite(Date.parse(candidate.startedAt))
      || typeof candidate.updatedAt !== "string"
      || !Number.isFinite(Date.parse(candidate.updatedAt))
      || (candidate.skipped !== undefined && typeof candidate.skipped !== "boolean")
      || (candidate.skippedFrom !== undefined && !(ALL_GUIDE_STEPS as readonly string[]).includes(candidate.skippedFrom as string))
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
    step: "welcome",
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
  sequence: PostOnboardingGuideSequence = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS,
): PostOnboardingSidebarGuideRecord {
  if (record.status !== "active") return record;
  const current = postOnboardingGuideStepInSequence(record.step, sequence);
  const next = record.skipped ? nextPostOnboardingMustSeeStep(current, sequence) : sequence[sequence.indexOf(current) + 1];
  if (!next) return completePostOnboardingSidebarGuide(record, now);
  return { ...record, step: next, updatedAt: now.toISOString() };
}

/** The first must-see card after the given one, or null when none is left. */
export function nextPostOnboardingMustSeeStep(
  step: PostOnboardingSidebarGuideStep,
  sequence: PostOnboardingGuideSequence = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS,
): PostOnboardingSidebarGuideStep | null {
  const index = sequence.indexOf(postOnboardingGuideStepInSequence(step, sequence));
  return sequence.find((candidate, candidateIndex) => candidateIndex > index && POST_ONBOARDING_MUST_SEE_STEPS.includes(candidate)) ?? null;
}

/** The cards a skipped intro walks: those up to the one Skip was pressed on, then the must-see cards. */
export function postOnboardingSkipPath(
  sequence: PostOnboardingGuideSequence,
  skippedFrom: PostOnboardingSidebarGuideStep,
): PostOnboardingSidebarGuideStep[] {
  const fromIndex = sequence.indexOf(postOnboardingGuideStepInSequence(skippedFrom, sequence));
  return sequence.filter((candidate, index) => index <= fromIndex || POST_ONBOARDING_MUST_SEE_STEPS.includes(candidate));
}

/** Whether the card ends the intro: the last card, or after Skip the last must-see card. */
export function isPostOnboardingGuideLastStep(
  step: PostOnboardingSidebarGuideStep,
  sequence: PostOnboardingGuideSequence,
  skipped: boolean,
): boolean {
  if (skipped) return nextPostOnboardingMustSeeStep(step, sequence) === null;
  return sequence.indexOf(postOnboardingGuideStepInSequence(step, sequence)) === sequence.length - 1;
}

/**
 * Skip (and Escape) jumps to the next must-see card instead of closing, so everyone sees the desktop
 * cat and Automatic close choices and the menu bar ring once; the last of them ends the intro. With no
 * must-see card left, Skip closes the intro as before.
 */
export function skipPostOnboardingSidebarGuide(
  record: PostOnboardingSidebarGuideRecord,
  now = new Date(),
  sequence: PostOnboardingGuideSequence = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS,
): PostOnboardingSidebarGuideRecord {
  if (record.status !== "active") return record;
  const current = postOnboardingGuideStepInSequence(record.step, sequence);
  const next = nextPostOnboardingMustSeeStep(current, sequence);
  if (!next) return dismissPostOnboardingSidebarGuide(record, now);
  const skippedFrom = record.skipped && record.skippedFrom ? record.skippedFrom : current;
  return { ...record, step: next, skipped: true, skippedFrom, updatedAt: now.toISOString() };
}

export function retreatPostOnboardingSidebarGuide(
  record: PostOnboardingSidebarGuideRecord,
  now = new Date(),
  sequence: PostOnboardingGuideSequence = POST_ONBOARDING_SIDEBAR_GUIDE_STEPS,
): PostOnboardingSidebarGuideRecord {
  if (record.status !== "active") return record;
  const current = postOnboardingGuideStepInSequence(record.step, sequence);
  // After Skip, Back walks the must-see cards backwards and then returns to the card Skip was pressed
  // on, resuming the normal tour, instead of opening a card the user never saw.
  if (record.skipped) {
    const origin = postOnboardingGuideStepInSequence(record.skippedFrom ?? sequence[0], sequence);
    const path = postOnboardingSkipPath(sequence, origin);
    const previous = path[path.indexOf(current) - 1];
    if (previous && sequence.indexOf(previous) > sequence.indexOf(origin)) return { ...record, step: previous, updatedAt: now.toISOString() };
    return { ...record, step: origin, skipped: undefined, skippedFrom: undefined, updatedAt: now.toISOString() };
  }
  const index = sequence.indexOf(current);
  const previous = sequence[index - 1];
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
