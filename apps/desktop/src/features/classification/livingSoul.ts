import { invoke } from "@tauri-apps/api/core";
import type {
  LivingSoulPatternConfidence,
  LivingSoulPromptContext,
  LivingSoulPromptPattern,
} from "@drifty/domain";

import { supabase } from "../../lib/supabase/client";
import {
  readUserOnboardingState,
  type OnboardingPurpose,
  type UserOnboardingState,
} from "../onboarding/onboardingState";

const LIVING_SOUL_SCHEMA = "drifty.soul/v1";
const BROWSER_STORAGE_PREFIX = "drifty:living-soul:v1:";
const MAX_MARKDOWN_CHARACTERS = 16_000;
const MAX_PATTERN_SUMMARY_CHARACTERS = 240;
const MAX_WORK_SUPPORT_PATTERNS = 6;
const MAX_DRIFT_PATTERNS = 4;
const MAX_AMBIGUITY_PATTERNS = 4;
const MAX_CONTEXTUAL_PRIORS = 12;
const MAX_CONTEXTUAL_PRIOR_DAYS = 6;
const PASSIVE_PRIOR_PROMOTION_DAYS = 3;
const PASSIVE_PRIOR_MEDIUM_CONFIDENCE_DAYS = 5;
const PASSIVE_PRIOR_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const SHA_256 = /^[a-f0-9]{64}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The refinement prompt instructs the model never to store raw URLs, account
 * names, or private titles, but a prompt is guidance rather than a guarantee.
 * Learned summaries are shown verbatim in Settings and sent back to the
 * provider on later refinements, so the host redacts identifiers instead of
 * trusting the model to have followed instructions.
 *
 * A bare site domain is deliberately not redacted: Drifty's own fallback
 * learning states rules like "example.com is not always drift", where the
 * domain is the subject of the rule and is already visible in the timeline.
 * What must never survive is anything that identifies a specific page,
 * account, or person: full URLs with paths, emails, and social handles.
 */
const REDACTED_IDENTIFIER = "[removed]";
const RAW_IDENTIFIER_PATTERNS: readonly RegExp[] = [
  // Any URI with a scheme, including file:// paths.
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\bwww\.[^\s,;]+/gi,
  // Email addresses, before bare-host matching can split them.
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi,
  // Absolute POSIX paths under a user or volume directory.
  /(?:^|[\s("'])(?:\/(?:Users|home|Volumes|var|tmp|private|mnt|media)\/)\S+/gi,
  // Windows paths such as C:\\Users\\name\\file.docx.
  /\b[A-Za-z]:\\[^\s,;]+/g,
  // Bare IPv4 hosts, with an optional port and path.
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/\S*)?/g,
  // Hostnames carrying a path, which point at one specific document.
  /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|co|dev|app|gg|tv|me|kr|jp|cn|uk|us|edu|gov|xyz)\/\S+/gi,
  // Internal or deep subdomains such as mail.internal.acme.com. A plain
  // second-level domain like example.com stays readable.
  /\b(?:[a-z0-9-]+\.){2,}(?:com|net|org|io|ai|co|dev|app|gg|tv|me|kr|jp|cn|uk|us|edu|gov|xyz)\b/gi,
  // Social handles. CSS at-rules and scoped package names are ordinary
  // technical vocabulary, not identities, so they stay readable.
  /(?:^|[\s("'])@(?!media\b|import\b|supports\b|keyframes\b|font-face\b|charset\b|layer\b|container\b|property\b|scope\b|page\b|namespace\b)[A-Za-z0-9_-]{2,}(?![\w-]*\/)/g,
];
const PASSIVE_COMMUNICATION_PRIOR_SUMMARY = "For this item only, the exact preceding communication selector is work-associated: on distinct days, communication with this same selector was followed by non-LLM work anchors.";

const PURPOSE_LABELS: Record<OnboardingPurpose, string> = {
  protect_focus: "Protect focus",
  understand_day: "Understand the day",
  plan_review: "Plan and review work",
  accountability: "Stay accountable",
  exploring: "Explore Drifty",
};

export type LivingSoulPattern = LivingSoulPromptPattern & {
  readonly lastObservedAt: string;
};

export type LivingSoulLearnedState = {
  readonly workSupport: readonly LivingSoulPattern[];
  readonly drift: readonly LivingSoulPattern[];
  readonly ambiguities: readonly LivingSoulPattern[];
};

export type LivingSoulDeclaredContext = LivingSoulPromptContext["declared"];

export type LivingSoulContextualPrior = {
  readonly selectorHash: string;
  readonly observedDays: readonly string[];
  readonly lastObservedAt: string;
  readonly summary: string;
};

export type LivingSoulDocument = {
  readonly schema: typeof LIVING_SOUL_SCHEMA;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastFeedbackAt: string | null;
  readonly declared: LivingSoulDeclaredContext;
  readonly learned: LivingSoulLearnedState;
  readonly contextualPriors: readonly LivingSoulContextualPrior[];
  /** Local controls and provenance never enter the provider prompt. */
  readonly memoryControls?: LivingSoulMemoryControls;
};

export type LivingSoulPatternKind = keyof LivingSoulLearnedState;
export type LivingSoulPatternOrigin = {
  readonly source: "correction" | "user" | "suggestion";
  readonly recordedAt: string;
  readonly feedbackKind?: "not_drift" | "manual_correction";
  readonly activity?: string;
  readonly productivity?: "focus" | "neutral" | "drift";
};
export type LivingSoulRejectedPattern = {
  readonly kind: LivingSoulPatternKind;
  readonly pattern: LivingSoulPattern;
  readonly rejectedAt: string;
  readonly origin?: LivingSoulPatternOrigin;
  readonly confirmed?: boolean;
};
export type LivingSoulMemoryControls = {
  readonly dismissedHashes: readonly string[];
  readonly origins: Readonly<Record<string, LivingSoulPatternOrigin>>;
  readonly confirmedHashes?: readonly string[];
  readonly rejectedPatterns?: Readonly<Record<string, LivingSoulRejectedPattern>>;
  /** Confidence a pattern had before the user confirmed it; restored when the confirmation is removed. */
  readonly confirmedPriorConfidence?: Readonly<Record<string, LivingSoulPatternConfidenceLevel>>;
};
type LivingSoulPatternConfidenceLevel = LivingSoulPattern["confidence"];
/** A user confirmation is the strongest signal Memory has, so a confirmed pattern is sent as high confidence. */
const CONFIRMED_CONFIDENCE: LivingSoulPatternConfidenceLevel = "high";

export async function livingSoulPatternHash(summary: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizedPatternText(summary));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedPatternText(summary: string): string {
  return summary.trim().toLowerCase().replace(/\s+/g, " ");
}

export type LivingSoulResolvedContext = {
  readonly ownerId: string;
  readonly scope: string;
  readonly document: LivingSoulDocument;
  readonly promptContext: LivingSoulPromptContext;
};

const writeQueues = new Map<string, Promise<unknown>>();

export async function resolveLivingSoulForClassification(
  useLocalFallback: boolean,
  resolvedOwnerId?: string | null,
): Promise<LivingSoulResolvedContext | null> {
  const ownerId = resolvedOwnerId === undefined
    ? await resolveLivingSoulOwnerId(useLocalFallback)
    : resolvedOwnerId;
  if (!ownerId) return null;
  const state = readUserOnboardingState(ownerId);
  return loadOrCreateLivingSoul(ownerId, state);
}

/**
 * Reads an existing Living Soul for display without creating one. Settings
 * only observes state, so it must never materialize a Soul document as a side
 * effect of opening a tab. The read joins the owner's serialization queue so
 * it cannot settle on the revision an in-flight write is replacing.
 *
 * The three outcomes are deliberately distinct: an absent Soul is a legitimate
 * "nothing learned yet" state, while stored-but-unreadable markdown means saved
 * learning exists and cannot be used. Collapsing the second case into the first
 * would tell the user their Memory is simply empty.
 */
export async function readLivingSoulForUser(
  ownerId: string,
): Promise<
  | { readonly state: "absent" }
  | { readonly state: "unreadable" }
  | { readonly state: "ready"; readonly context: LivingSoulResolvedContext }
> {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) return { state: "absent" };
  const scope = await livingSoulScopeForOwner(normalizedOwnerId);
  // Queue this read behind any in-flight write for the same owner so the panel
  // cannot settle on the pre-write revision after a correction or a profile
  // save. The queued operation only reads; it never creates or mutates a Soul.
  return queueSoulWrite(normalizedOwnerId, async () => {
    const markdown = await readSoulMarkdown(scope);
    if (markdown === null || markdown.trim().length === 0) return { state: "absent" as const };
    const document = parseLivingSoulMarkdown(markdown);
    if (!document) return { state: "unreadable" as const };
    return { state: "ready" as const, context: resolvedContext(normalizedOwnerId, scope, document) };
  });
}

export async function synchronizeLivingSoulDeclaredContextForUser(
  ownerId: string,
  state: UserOnboardingState | null = readUserOnboardingState(ownerId),
): Promise<LivingSoulResolvedContext> {
  return loadOrCreateLivingSoul(ownerId, state);
}

export async function updateLivingSoulLearnedState(input: {
  readonly ownerId: string;
  readonly learned: LivingSoulLearnedState;
  readonly feedbackAt: string;
  readonly expectedRevision?: number;
  readonly feedbackKind?: "not_drift" | "manual_correction";
  readonly feedbackActivity?: string;
  readonly feedbackProductivity?: "focus" | "neutral" | "drift";
}): Promise<LivingSoulResolvedContext> {
  const feedbackAt = validIsoTimestamp(input.feedbackAt);
  if (!feedbackAt) throw new Error("Living Soul feedback timestamp must be valid ISO-8601.");
  return queueSoulWrite(input.ownerId, async () => {
    const state = readUserOnboardingState(input.ownerId);
    const current = await loadOrCreateLivingSoulUnqueued(input.ownerId, state);
    // A response based on an older file must not undo an edit or forgotten
    // memory. Do not retry against fresh user intent with the stale response.
    if (input.expectedRevision !== undefined && current.document.revision !== input.expectedRevision) return current;
    const controls = current.document.memoryControls;
    const dismissed = new Set(controls?.dismissedHashes ?? []);
    const origins = { ...controls?.origins };
    const normalized = normalizeLearnedState(input.learned);
    const learned = { workSupport: [...normalized.workSupport], drift: [...normalized.drift], ambiguities: [...normalized.ambiguities] };
    for (const kind of ["workSupport", "drift", "ambiguities"] as const) {
      const kept: LivingSoulPattern[] = [];
      for (const pattern of learned[kind]) {
        const hash = await livingSoulPatternHash(pattern.summary);
        if (dismissed.has(hash) || origins[hash]?.source === "user" || controls?.confirmedHashes?.includes(hash)) continue;
        kept.push(pattern);
        if (input.feedbackKind && !origins[hash]
          && !Object.values(current.document.learned).flat().some((previous) => previous.summary === pattern.summary)) origins[hash] = {
          source: "correction", recordedAt: feedbackAt, feedbackKind: input.feedbackKind,
          ...(input.feedbackActivity ? { activity: cleanText(redactRawIdentifiers(input.feedbackActivity), 120) ?? "Unknown" } : {}),
          ...(input.feedbackProductivity ? { productivity: input.feedbackProductivity } : {}),
        };
      }
      const pinned: LivingSoulPattern[] = [];
      for (const previous of current.document.learned[kind]) {
        const hash = await livingSoulPatternHash(previous.summary);
        if (origins[hash]?.source === "user" || controls?.confirmedHashes?.includes(hash)) pinned.push(previous);
      }
      const limits = { workSupport: 6, drift: 4, ambiguities: 4 };
      learned[kind] = [...pinned, ...kept.filter((p) => !pinned.some((saved) => saved.summary === p.summary))].slice(0, limits[kind]);
    }
    const activeHashes = new Set(await Promise.all(Object.values(learned).flat().map((p) => livingSoulPatternHash(p.summary))));
    const now = new Date().toISOString();
    const next: LivingSoulDocument = {
      ...current.document,
      revision: current.document.revision + 1,
      updatedAt: now,
      lastFeedbackAt: feedbackAt,
      learned,
      ...((controls || input.feedbackKind) ? { memoryControls: {
        ...controls,
        dismissedHashes: [...dismissed],
        ...(controls?.confirmedHashes ? { confirmedHashes: controls.confirmedHashes.filter((hash) => activeHashes.has(hash)) } : {}),
        origins: Object.fromEntries(Object.entries(origins).filter(([hash]) => activeHashes.has(hash))),
      } } : {}),
    };
    await writeSoulMarkdown(current.scope, renderLivingSoulMarkdown(next));
    return resolvedContext(input.ownerId, current.scope, next);
  });
}

/** Changes an existing memory only; opening or editing never creates a Soul. */
export async function changeLivingSoulPattern(input: {
  readonly ownerId: string;
  readonly expectedRevision: number;
  readonly kind: LivingSoulPatternKind;
  readonly summary: string;
  readonly replacement?: string;
}): Promise<LivingSoulResolvedContext> {
  const scope = await livingSoulScopeForOwner(input.ownerId);
  return queueSoulWrite(input.ownerId, async () => {
    const markdown = await readSoulMarkdown(scope);
    const current = markdown ? parseLivingSoulMarkdown(markdown) : null;
    if (!current || current.revision !== input.expectedRevision) throw new Error("memory_changed");
    const index = current.learned[input.kind].findIndex((p) => p.summary === input.summary);
    if (index < 0) throw new Error("memory_changed");
    const hash = await livingSoulPatternHash(input.summary);
    const dismissed = new Set(current.memoryControls?.dismissedHashes ?? []);
    const origins = { ...current.memoryControls?.origins };
    const patterns = [...current.learned[input.kind]];
    const now = new Date().toISOString();
    if (input.replacement !== undefined) {
      const replacement = normalizeLivingSoulPattern({ ...patterns[index], summary: input.replacement });
      if (!replacement) throw new Error("memory_invalid");
      const nextHash = await livingSoulPatternHash(replacement.summary);
      if (nextHash !== hash) {
        if (Object.values(current.learned).flat().some((p) => normalizedPatternText(p.summary) === normalizedPatternText(replacement.summary))) throw new Error("memory_duplicate");
        dismissed.add(hash);
        delete origins[hash];
      }
      dismissed.delete(nextHash);
      origins[nextHash] = { source: "user", recordedAt: now };
      patterns[index] = replacement;
    } else {
      dismissed.add(hash);
      patterns.splice(index, 1);
      delete origins[hash];
    }
    // Never silently evict a user's rejection to make room.
    if (dismissed.size > 64) throw new Error("memory_limit");
    const next: LivingSoulDocument = {
      ...current, revision: current.revision + 1, updatedAt: now,
      learned: {
        workSupport: current.learned.workSupport.filter((p) => normalizedPatternText(p.summary) !== normalizedPatternText(input.summary)),
        drift: current.learned.drift.filter((p) => normalizedPatternText(p.summary) !== normalizedPatternText(input.summary)),
        ambiguities: current.learned.ambiguities.filter((p) => normalizedPatternText(p.summary) !== normalizedPatternText(input.summary)),
        [input.kind]: patterns,
      },
      memoryControls: {
        ...current.memoryControls, dismissedHashes: [...dismissed], origins,
        confirmedHashes: (current.memoryControls?.confirmedHashes ?? []).filter((value) => value !== hash),
        rejectedPatterns: Object.fromEntries(Object.entries(current.memoryControls?.rejectedPatterns ?? {})
          .filter(([value]) => value !== hash && !Object.keys(origins).includes(value))),
      },
    };
    await writeSoulMarkdown(scope, renderLivingSoulMarkdown(next));
    return resolvedContext(input.ownerId, scope, next);
  });
}

/** Sentence-level feedback is local control, not a new activity observation. */
export async function reviewLivingSoulPattern(input: {
  readonly ownerId: string;
  readonly expectedRevision: number;
  readonly kind: LivingSoulPatternKind;
  readonly summary: string;
  readonly action: "confirm" | "unconfirm" | "reject" | "restore" | "forgetRejected";
}): Promise<LivingSoulResolvedContext> {
  const scope = await livingSoulScopeForOwner(input.ownerId);
  return queueSoulWrite(input.ownerId, async () => {
    const markdown = await readSoulMarkdown(scope);
    const current = markdown ? parseLivingSoulMarkdown(markdown) : null;
    if (!current || current.revision !== input.expectedRevision) throw new Error("memory_changed");
    const hash = await livingSoulPatternHash(input.summary);
    const controls = current.memoryControls;
    const confirmed = new Set(controls?.confirmedHashes ?? []);
    const dismissed = new Set(controls?.dismissedHashes ?? []);
    const origins = { ...controls?.origins };
    const rejected = { ...controls?.rejectedPatterns };
    const priors: Record<string, LivingSoulPatternConfidenceLevel> = { ...controls?.confirmedPriorConfidence };
    const learned = { workSupport: [...current.learned.workSupport], drift: [...current.learned.drift], ambiguities: [...current.learned.ambiguities] };
    const patterns = learned[input.kind];
    const index = patterns.findIndex((p) => p.summary === input.summary);
    const now = new Date().toISOString();
    if (input.action === "restore" || input.action === "forgetRejected") {
      const saved = rejected[hash];
      if (!saved || saved.kind !== input.kind || saved.pattern.summary !== input.summary) throw new Error("memory_changed");
      if (input.action === "restore") {
        if (Object.values(learned).flat().some((p) => normalizedPatternText(p.summary) === normalizedPatternText(input.summary))) throw new Error("memory_duplicate");
        const limit = { workSupport: 6, drift: 4, ambiguities: 4 }[input.kind];
        if (patterns.length >= limit) throw new Error("memory_restore_limit");
        dismissed.delete(hash);
        if (saved.origin) origins[hash] = saved.origin;
        if (saved.confirmed) {
          // The stored copy keeps its pre-confirmation confidence; re-apply the confirmation.
          confirmed.add(hash);
          priors[hash] = saved.pattern.confidence;
          patterns.push({ ...saved.pattern, confidence: CONFIRMED_CONFIDENCE });
        } else {
          patterns.push(saved.pattern);
        }
      }
      delete rejected[hash];
    } else {
      if (index < 0) throw new Error("memory_changed");
      if (input.action === "confirm") {
        if (!confirmed.has(hash)) priors[hash] = patterns[index].confidence;
        confirmed.add(hash);
        patterns[index] = { ...patterns[index], confidence: CONFIRMED_CONFIDENCE };
      } else if (input.action === "unconfirm") {
        if (confirmed.has(hash)) patterns[index] = { ...patterns[index], confidence: priors[hash] ?? "low" };
        confirmed.delete(hash);
        delete priors[hash];
      } else {
        if (Object.keys(rejected).length >= 14 && !rejected[hash]) throw new Error("memory_limit");
        const stashed = confirmed.has(hash) ? { ...patterns[index], confidence: priors[hash] ?? "low" } : patterns[index];
        delete priors[hash];
        rejected[hash] = { kind: input.kind, pattern: stashed, rejectedAt: now,
          ...(origins[hash] ? { origin: origins[hash] } : {}), ...(confirmed.has(hash) ? { confirmed: true } : {}) };
        for (const kind of ["workSupport", "drift", "ambiguities"] as const) {
          learned[kind] = learned[kind].filter((p) => normalizedPatternText(p.summary) !== normalizedPatternText(input.summary));
        }
        dismissed.add(hash);
        confirmed.delete(hash);
        delete origins[hash];
      }
    }
    if (dismissed.size > 64) throw new Error("memory_limit");
    const next: LivingSoulDocument = { ...current, revision: current.revision + 1, updatedAt: now, learned,
      memoryControls: { dismissedHashes: [...dismissed], origins, confirmedHashes: [...confirmed], rejectedPatterns: rejected,
        ...(Object.keys(priors).length > 0 ? { confirmedPriorConfidence: priors } : {}) } };
    let output: string;
    try { output = renderLivingSoulMarkdown(next); } catch { throw new Error("memory_limit"); }
    await writeSoulMarkdown(scope, output);
    return resolvedContext(input.ownerId, scope, next);
  });
}

/**
 * Adds a confirmed memory that the user accepted from a suggestion. The sentence
 * is pinned like any confirmed memory; its only evidence is the number of days
 * the activity recurred. Refuses blocked wording, duplicates and full groups
 * instead of evicting another memory.
 */
export async function adoptLivingSoulSuggestion(input: {
  readonly ownerId: string;
  readonly expectedRevision: number;
  readonly kind: LivingSoulPatternKind;
  readonly summary: string;
  readonly evidenceDays: number;
  readonly observedAt: string;
  readonly activity: string;
  /** How the place was filed. Omitted for a place filed both ways, which has no single label. */
  readonly productivity?: "focus" | "neutral" | "drift";
}): Promise<LivingSoulResolvedContext> {
  const scope = await livingSoulScopeForOwner(input.ownerId);
  return queueSoulWrite(input.ownerId, async () => {
    const markdown = await readSoulMarkdown(scope);
    const current = markdown ? parseLivingSoulMarkdown(markdown) : null;
    if (!current || current.revision !== input.expectedRevision) throw new Error("memory_changed");
    const pattern = normalizeLivingSoulPattern({
      summary: input.summary, confidence: CONFIRMED_CONFIDENCE, evidenceCount: input.evidenceDays, lastObservedAt: input.observedAt,
    });
    if (!pattern) throw new Error("memory_invalid");
    const hash = await livingSoulPatternHash(pattern.summary);
    const controls = current.memoryControls;
    const dismissed = new Set(controls?.dismissedHashes ?? []);
    const confirmed = new Set(controls?.confirmedHashes ?? []);
    const origins = { ...controls?.origins };
    if (dismissed.has(hash)
      || Object.values(current.learned).flat().some((p) => normalizedPatternText(p.summary) === normalizedPatternText(pattern.summary))) {
      throw new Error("memory_duplicate");
    }
    const limit = { workSupport: MAX_WORK_SUPPORT_PATTERNS, drift: MAX_DRIFT_PATTERNS, ambiguities: MAX_AMBIGUITY_PATTERNS }[input.kind];
    if (current.learned[input.kind].length >= limit) throw new Error("memory_group_full");
    const now = new Date().toISOString();
    origins[hash] = { source: "suggestion", recordedAt: now,
      activity: cleanText(redactRawIdentifiers(input.activity), 120) ?? "Unknown",
      ...(input.productivity ? { productivity: input.productivity } : {}) };
    confirmed.add(hash);
    const learned = { ...current.learned, [input.kind]: [...current.learned[input.kind], pattern] };
    const next: LivingSoulDocument = { ...current, revision: current.revision + 1, updatedAt: now, learned,
      memoryControls: { ...controls, dismissedHashes: [...dismissed], origins, confirmedHashes: [...confirmed],
        confirmedPriorConfidence: { ...controls?.confirmedPriorConfidence, [hash]: "low" } } };
    let output: string;
    try { output = renderLivingSoulMarkdown(next); } catch { throw new Error("memory_limit"); }
    await writeSoulMarkdown(scope, output);
    return resolvedContext(input.ownerId, scope, next);
  });
}

export async function recordLivingSoulPassiveContextEvidence(input: {
  readonly ownerId: string;
  readonly selectorHashes: readonly string[];
  readonly observedAt: string;
}): Promise<LivingSoulResolvedContext> {
  const observedAt = validIsoTimestamp(input.observedAt);
  if (!observedAt) throw new Error("Passive Soul evidence timestamp must be valid ISO-8601.");
  const selectorHashes = Array.from(new Set(input.selectorHashes.filter((value) => SHA_256.test(value))));
  if (selectorHashes.length === 0) throw new Error("Passive Soul evidence requires a valid selector hash.");
  return queueSoulWrite(input.ownerId, async () => {
    const state = readUserOnboardingState(input.ownerId);
    const current = await loadOrCreateLivingSoulUnqueued(input.ownerId, state);
    const nextPriors = mergeLivingSoulPassiveEvidence(
      current.document.contextualPriors,
      selectorHashes,
      observedAt,
    );
    if (sameContextualPriors(current.document.contextualPriors, nextPriors)) return current;
    const next: LivingSoulDocument = {
      ...current.document,
      revision: current.document.revision + 1,
      updatedAt: new Date().toISOString(),
      contextualPriors: nextPriors,
    };
    await writeSoulMarkdown(current.scope, renderLivingSoulMarkdown(next));
    return resolvedContext(input.ownerId, current.scope, next);
  });
}

export function renderLivingSoulMarkdown(document: LivingSoulDocument): string {
  const markdown = [
    "---",
    `schema: ${document.schema}`,
    `revision: ${document.revision}`,
    `created_at: ${document.createdAt}`,
    `updated_at: ${document.updatedAt}`,
    `last_feedback_at: ${document.lastFeedbackAt ?? "null"}`,
    "---",
    "# Living Soul",
    "",
    "## Declared work context",
    declaredLine("Work activities", document.declared.workActivities.join(", ") || "Not provided"),
    declaredLine("Work domain", document.declared.workDomain ?? "Not provided"),
    declaredLine("Work description", document.declared.workDescription ?? "Not provided"),
    declaredLine("Drifty purpose", document.declared.purpose ?? "Not provided"),
    "",
    "## Learned work-support patterns",
    ...renderPatternList(document.learned.workSupport),
    "",
    "## Learned drift patterns",
    ...renderPatternList(document.learned.drift),
    "",
    "## Ambiguities",
    ...renderPatternList(document.learned.ambiguities),
    "",
    "## Passive contextual priors",
    ...renderContextualPriorList(document.contextualPriors),
    ...(document.memoryControls ? ["", "## Memory controls", JSON.stringify(document.memoryControls)] : []),
    "",
  ].join("\n");

  if (markdown.length > MAX_MARKDOWN_CHARACTERS) {
    throw new Error("Living Soul exceeds its bounded document limit.");
  }
  return markdown;
}

export function parseLivingSoulMarkdown(
  markdown: string,
): LivingSoulDocument | null {
  if (!markdown || markdown.length > MAX_MARKDOWN_CHARACTERS) return null;
  const metadata = parseFrontmatter(markdown);
  if (!metadata || metadata.schema !== LIVING_SOUL_SCHEMA) return null;
  const revision = Number(metadata.revision);
  if (!Number.isInteger(revision) || revision < 1) return null;
  const createdAt = validIsoTimestamp(metadata.created_at);
  const updatedAt = validIsoTimestamp(metadata.updated_at);
  const lastFeedbackAt = metadata.last_feedback_at === "null"
    ? null
    : validIsoTimestamp(metadata.last_feedback_at);
  if (!createdAt || !updatedAt || (metadata.last_feedback_at !== "null" && !lastFeedbackAt)) return null;

  const declared = parseDeclaredContext(markdown);
  const workSupport = parsePatternSection(markdown, "Learned work-support patterns", MAX_WORK_SUPPORT_PATTERNS);
  const drift = parsePatternSection(markdown, "Learned drift patterns", MAX_DRIFT_PATTERNS);
  const ambiguities = parsePatternSection(markdown, "Ambiguities", MAX_AMBIGUITY_PATTERNS);
  const contextualPriors = parseContextualPriorSection(markdown);
  if (!declared || !workSupport || !drift || !ambiguities || !contextualPriors) return null;
  const controlsSection = markdown.match(/^## Memory controls\n([^\n]+)(?:\n|$)/m)?.[1];
  const memoryControls = controlsSection ? parseMemoryControls(controlsSection) : undefined;
  if (markdown.includes("## Memory controls")
    && (!memoryControls || markdown.split("## Memory controls").length !== 2)) return null;

  return {
    schema: LIVING_SOUL_SCHEMA,
    revision,
    createdAt,
    updatedAt,
    lastFeedbackAt,
    declared,
    learned: { workSupport, drift, ambiguities },
    contextualPriors,
    ...(memoryControls ? { memoryControls } : {}),
  };
}

function parseMemoryOrigin(origin: LivingSoulPatternOrigin): LivingSoulPatternOrigin | null {
  if (!origin || (origin.source !== "user" && origin.source !== "correction" && origin.source !== "suggestion") || !validIsoTimestamp(origin.recordedAt)
    || (origin.feedbackKind !== undefined && origin.feedbackKind !== "not_drift" && origin.feedbackKind !== "manual_correction")
    || (origin.activity !== undefined && (typeof origin.activity !== "string" || origin.activity.length > 120))
    || (origin.productivity !== undefined && !["focus", "neutral", "drift"].includes(origin.productivity))) return null;
  return { source: origin.source, recordedAt: new Date(origin.recordedAt).toISOString(),
    ...(origin.feedbackKind ? { feedbackKind: origin.feedbackKind } : {}),
    ...(origin.activity ? { activity: cleanText(redactRawIdentifiers(origin.activity), 120) ?? "Unknown" } : {}),
    ...(origin.productivity ? { productivity: origin.productivity } : {}) };
}

function parseMemoryControls(text: string): LivingSoulMemoryControls | null {
  try {
    const value = JSON.parse(text) as LivingSoulMemoryControls;
    if (!Array.isArray(value.dismissedHashes) || value.dismissedHashes.length > 64
      || !value.dismissedHashes.every((hash) => typeof hash === "string" && SHA_256.test(hash))
      || !value.origins || typeof value.origins !== "object" || Array.isArray(value.origins)
      || Object.keys(value.origins).length > 14) return null;
    const origins: Record<string, LivingSoulPatternOrigin> = {};
    for (const [hash, origin] of Object.entries(value.origins)) {
      const parsed = parseMemoryOrigin(origin);
      if (!SHA_256.test(hash) || !parsed) return null;
      origins[hash] = parsed;
    }
    if (value.confirmedHashes !== undefined && (!Array.isArray(value.confirmedHashes) || value.confirmedHashes.length > 14
      || !value.confirmedHashes.every((hash) => typeof hash === "string" && SHA_256.test(hash) && !value.dismissedHashes.includes(hash)))) return null;
    const rejected: Record<string, LivingSoulRejectedPattern> = {};
    if (value.rejectedPatterns !== undefined) {
      if (!value.rejectedPatterns || typeof value.rejectedPatterns !== "object" || Array.isArray(value.rejectedPatterns)
        || Object.keys(value.rejectedPatterns).length > 14) return null;
      for (const [hash, entry] of Object.entries(value.rejectedPatterns)) {
        if (!SHA_256.test(hash) || !value.dismissedHashes.includes(hash) || !entry
          || !["workSupport", "drift", "ambiguities"].includes(entry.kind) || !validIsoTimestamp(entry.rejectedAt)
          || !entry.pattern || typeof entry.pattern.summary !== "string" || entry.pattern.summary.length > 240
          || !Number.isFinite(entry.pattern.evidenceCount) || (entry.confirmed !== undefined && typeof entry.confirmed !== "boolean")) return null;
        const pattern = normalizeLivingSoulPattern(entry.pattern);
        const origin = entry.origin ? parseMemoryOrigin(entry.origin) : undefined;
        if (!pattern || (entry.origin !== undefined && !origin)) return null;
        rejected[hash] = { kind: entry.kind, pattern, rejectedAt: new Date(entry.rejectedAt).toISOString(),
          ...(origin ? { origin } : {}), ...(entry.confirmed ? { confirmed: true } : {}) };
      }
    }
    let priors: Record<string, LivingSoulPatternConfidenceLevel> | undefined;
    if (value.confirmedPriorConfidence !== undefined) {
      const raw = value.confirmedPriorConfidence;
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 14) return null;
      priors = {};
      for (const [hash, level] of Object.entries(raw)) {
        if (!SHA_256.test(hash) || !value.confirmedHashes?.includes(hash) || !["low", "medium", "high"].includes(level)) return null;
        priors[hash] = level;
      }
    }
    return { dismissedHashes: [...new Set(value.dismissedHashes)], origins,
      ...(value.confirmedHashes !== undefined ? { confirmedHashes: [...new Set(value.confirmedHashes)] } : {}),
      ...(value.rejectedPatterns !== undefined ? { rejectedPatterns: rejected } : {}),
      ...(priors ? { confirmedPriorConfidence: priors } : {}) };
  } catch { return null; }
}

export function livingSoulPromptContext(document: LivingSoulDocument): LivingSoulPromptContext {
  return {
    revision: document.revision,
    declared: document.declared,
    learnedWorkSupport: byConfidence(document.learned.workSupport).map(promptPattern),
    learnedDrift: byConfidence(document.learned.drift).map(promptPattern),
    ambiguities: byConfidence(document.learned.ambiguities).map(promptPattern),
  };
}

export function contextualPriorPromptPatterns(
  document: LivingSoulDocument,
  selectorHashes: readonly string[],
  nowMs = Date.now(),
): LivingSoulPromptPattern[] {
  const wanted = new Set(selectorHashes);
  const asOfDay = Number.isFinite(nowMs) ? new Date(nowMs).toISOString().slice(0, 10) : null;
  if (!asOfDay) return [];
  return document.contextualPriors
    .filter((prior) => wanted.has(prior.selectorHash))
    .map((prior) => ({
      prior,
      eligibleDays: prior.observedDays.filter((day) => day <= asOfDay),
    }))
    .filter(({ eligibleDays }) => eligibleDays.length >= PASSIVE_PRIOR_PROMOTION_DAYS)
    .filter(({ eligibleDays }) => {
      const latestEligibleDay = eligibleDays[eligibleDays.length - 1];
      return latestEligibleDay !== undefined
        && Date.parse(`${asOfDay}T00:00:00.000Z`) - Date.parse(`${latestEligibleDay}T00:00:00.000Z`) <= PASSIVE_PRIOR_MAX_AGE_MS;
    })
    .sort((a, b) => (b.eligibleDays[b.eligibleDays.length - 1] ?? "")
      .localeCompare(a.eligibleDays[a.eligibleDays.length - 1] ?? ""))
    .slice(0, 4)
    .map(({ eligibleDays }) => ({
      summary: PASSIVE_COMMUNICATION_PRIOR_SUMMARY,
      confidence: eligibleDays.length >= PASSIVE_PRIOR_MEDIUM_CONFIDENCE_DAYS ? "medium" : "low",
      evidenceCount: eligibleDays.length,
    }));
}

export function declaredContextFromOnboarding(
  state: UserOnboardingState | null,
): LivingSoulDeclaredContext {
  if (!state) {
    return { workActivities: [], workDomain: null, purpose: null };
  }
  const workActivities = (state.jobType ?? state.workType ?? "")
    .split(",")
    .map((value) => cleanText(value === "Other" ? state.jobTypeOther || state.workTypeOther : value, 180))
    .filter((value): value is string => Boolean(value))
    .slice(0, 4);
  const rawDomain = cleanText(state.workDomain === "Other" ? state.workDomainOther : state.workDomain, 180);
  const existingDescription = cleanText(state.workDescription, 240);
  const migratedDescription = existingDescription
    ?? (rawDomain ? `Works in ${rawDomain}.` : null);
  return normalizeDeclaredContext({
    workActivities,
    workDomain: null,
    workDescription: migratedDescription,
    purpose: state.purpose ? PURPOSE_LABELS[state.purpose] : null,
  });
}

export function normalizeLivingSoulPattern(value: LivingSoulPattern): LivingSoulPattern | null {
  const summary = cleanText(redactRawIdentifiers(value.summary), MAX_PATTERN_SUMMARY_CHARACTERS);
  const confidence = normalizeConfidence(value.confidence);
  const evidenceCount = Math.min(99, Math.max(1, Math.round(value.evidenceCount)));
  const lastObservedAt = validIsoTimestamp(value.lastObservedAt);
  if (!summary || !confidence || !lastObservedAt) return null;
  return { summary, confidence, evidenceCount, lastObservedAt };
}

async function loadOrCreateLivingSoul(
  ownerId: string,
  state: UserOnboardingState | null,
): Promise<LivingSoulResolvedContext> {
  return queueSoulWrite(ownerId, () => loadOrCreateLivingSoulUnqueued(ownerId, state));
}

async function loadOrCreateLivingSoulUnqueued(
  ownerId: string,
  state: UserOnboardingState | null,
): Promise<LivingSoulResolvedContext> {
  const scope = await livingSoulScopeForOwner(ownerId);
  const declared = declaredContextFromOnboarding(state);
  const markdown = await readSoulMarkdown(scope);
  if (!markdown) {
    const created = createLivingSoul(declared);
    await writeSoulMarkdown(scope, renderLivingSoulMarkdown(created));
    return resolvedContext(ownerId, scope, created);
  }

  const parsed = parseLivingSoulMarkdown(markdown);
  if (!parsed) {
    throw new Error("Living Soul is invalid; the previous file was left untouched.");
  }
  if (sameDeclaredContext(parsed.declared, declared)) {
    return resolvedContext(ownerId, scope, parsed);
  }

  const now = new Date().toISOString();
  const synchronized: LivingSoulDocument = {
    ...parsed,
    revision: parsed.revision + 1,
    updatedAt: now,
    declared,
  };
  await writeSoulMarkdown(scope, renderLivingSoulMarkdown(synchronized));
  return resolvedContext(ownerId, scope, synchronized);
}

function createLivingSoul(declared: LivingSoulDeclaredContext): LivingSoulDocument {
  const now = new Date().toISOString();
  return {
    schema: LIVING_SOUL_SCHEMA,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    lastFeedbackAt: null,
    declared: normalizeDeclaredContext(declared),
    learned: { workSupport: [], drift: [], ambiguities: [] },
    contextualPriors: [],
  };
}

function resolvedContext(ownerId: string, scope: string, document: LivingSoulDocument): LivingSoulResolvedContext {
  return { ownerId, scope, document, promptContext: livingSoulPromptContext(document) };
}

function normalizeLearnedState(learned: LivingSoulLearnedState): LivingSoulLearnedState {
  return {
    workSupport: normalizePatterns(learned.workSupport, MAX_WORK_SUPPORT_PATTERNS),
    drift: normalizePatterns(learned.drift, MAX_DRIFT_PATTERNS),
    ambiguities: normalizePatterns(learned.ambiguities, MAX_AMBIGUITY_PATTERNS),
  };
}

function normalizePatterns(patterns: readonly LivingSoulPattern[], limit: number): LivingSoulPattern[] {
  const normalized = patterns.flatMap((pattern) => {
    const value = normalizeLivingSoulPattern(pattern);
    return value ? [value] : [];
  });
  const deduplicated = new Map<string, LivingSoulPattern>();
  for (const pattern of normalized) {
    const key = pattern.summary.toLocaleLowerCase();
    const previous = deduplicated.get(key);
    if (!previous || pattern.evidenceCount >= previous.evidenceCount) deduplicated.set(key, pattern);
  }
  return Array.from(deduplicated.values())
    .sort((a, b) => Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt))
    .slice(0, limit);
}

function parsePatternSection(markdown: string, heading: string, limit: number): LivingSoulPattern[] | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^## ${escapedHeading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"));
  if (!match) return null;
  const lines = match[1].split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0] === "- None yet.") return [];
  const patterns: LivingSoulPattern[] = [];
  for (const line of lines) {
    const patternMatch = line.match(/^- \[confidence=(low|medium|high); evidence=(\d+); last=([^\]]+)\] (.+)$/);
    if (!patternMatch) return null;
    const pattern = normalizeLivingSoulPattern({
      confidence: patternMatch[1] as LivingSoulPatternConfidence,
      evidenceCount: Number(patternMatch[2]),
      lastObservedAt: patternMatch[3],
      summary: patternMatch[4],
    });
    if (!pattern) return null;
    patterns.push(pattern);
  }
  return normalizePatterns(patterns, limit);
}

function parseDeclaredContext(markdown: string): LivingSoulDeclaredContext | null {
  const section = markdown.match(/^## Declared work context\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  if (!section) return null;
  const values = new Map<string, string>();
  for (const line of section.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const match = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!match) return null;
    values.set(match[1], match[2]);
  }
  const activities = values.get("Work activities");
  const domain = values.get("Work domain");
  const description = values.get("Work description");
  const purpose = values.get("Drifty purpose");
  if (activities === undefined || domain === undefined || purpose === undefined) return null;
  return normalizeDeclaredContext({
    workActivities: activities === "Not provided" ? [] : activities.split(","),
    workDomain: domain === "Not provided" ? null : domain,
    ...(description === undefined || description === "Not provided" ? {} : { workDescription: description }),
    purpose: purpose === "Not provided" ? null : purpose,
  });
}

function renderPatternList(patterns: readonly LivingSoulPattern[]): string[] {
  if (patterns.length === 0) return ["- None yet."];
  return patterns.map((pattern) => {
    const normalized = normalizeLivingSoulPattern(pattern);
    if (!normalized) throw new Error("Living Soul contains an invalid learned pattern.");
    return `- [confidence=${normalized.confidence}; evidence=${normalized.evidenceCount}; last=${normalized.lastObservedAt}] ${normalized.summary}`;
  });
}

function renderContextualPriorList(priors: readonly LivingSoulContextualPrior[]): string[] {
  if (priors.length === 0) return ["- None yet."];
  return normalizeContextualPriors(priors).map((prior) => (
    `- [selector=${prior.selectorHash}; days=${prior.observedDays.join(",")}; last=${prior.lastObservedAt}] ${prior.summary}`
  ));
}

function parseContextualPriorSection(markdown: string): LivingSoulContextualPrior[] | null {
  const section = markdown.match(/^## Passive contextual priors\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  // Existing v1 documents predate passive learning. Missing means a clean migration.
  if (!section) return [];
  const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0] === "- None yet.") return [];
  const priors: LivingSoulContextualPrior[] = [];
  for (const line of lines) {
    const match = line.match(/^- \[selector=([a-f0-9]{64}); days=([0-9,-]+); last=([^\]]+)\] (.+)$/);
    if (!match) return null;
    const observedDays = match[2].split(",");
    if (observedDays.length === 0 || observedDays.some((day) => !ISO_DAY.test(day))) return null;
    priors.push({
      selectorHash: match[1],
      observedDays,
      lastObservedAt: match[3],
      summary: match[4],
    });
  }
  return normalizeContextualPriors(priors);
}

function declaredLine(label: string, value: string): string {
  return `- ${label}: ${cleanText(value, 500) ?? "Not provided"}`;
}

function parseFrontmatter(markdown: string): Record<string, string> | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const metadata: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) return null;
    metadata[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return metadata;
}

const CONFIDENCE_RANK: Record<LivingSoulPatternConfidenceLevel, number> = { high: 0, medium: 1, low: 2 };

/** Confirmed (high) patterns lead their group; ties keep the stored order. */
function byConfidence(patterns: readonly LivingSoulPattern[]): LivingSoulPattern[] {
  return [...patterns].sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);
}

function promptPattern(pattern: LivingSoulPattern): LivingSoulPromptPattern {
  return {
    summary: pattern.summary,
    confidence: pattern.confidence,
    evidenceCount: pattern.evidenceCount,
  };
}

function normalizeDeclaredContext(declared: LivingSoulDeclaredContext): LivingSoulDeclaredContext {
  const workDescription = cleanText(declared.workDescription, 240);
  return {
    workActivities: Array.from(new Set(declared.workActivities.flatMap((value) => {
      const cleaned = cleanText(value, 180);
      return cleaned ? [cleaned] : [];
    }))).slice(0, 4),
    workDomain: cleanText(declared.workDomain, 180),
    ...(workDescription ? { workDescription } : {}),
    purpose: cleanText(declared.purpose, 120),
  };
}

function sameDeclaredContext(a: LivingSoulDeclaredContext, b: LivingSoulDeclaredContext): boolean {
  return JSON.stringify(normalizeDeclaredContext(a)) === JSON.stringify(normalizeDeclaredContext(b));
}

export function mergeLivingSoulPassiveEvidence(
  priors: readonly LivingSoulContextualPrior[],
  selectorHashes: readonly string[],
  observedAt: string,
): LivingSoulContextualPrior[] {
  const observedDay = observedAt.slice(0, 10);
  const bySelector = new Map(normalizeContextualPriors(priors).map((prior) => [prior.selectorHash, prior]));
  for (const selectorHash of selectorHashes) {
    const existing = bySelector.get(selectorHash);
    if (existing?.observedDays.includes(observedDay)) continue;
    const observedDays = Array.from(new Set([...(existing?.observedDays ?? []), observedDay]))
      .sort()
      .slice(-MAX_CONTEXTUAL_PRIOR_DAYS);
    bySelector.set(selectorHash, {
      selectorHash,
      observedDays,
      lastObservedAt: observedAt,
      summary: existing?.summary ?? PASSIVE_COMMUNICATION_PRIOR_SUMMARY,
    });
  }
  return normalizeContextualPriors([...bySelector.values()]);
}

function normalizeContextualPriors(priors: readonly LivingSoulContextualPrior[]): LivingSoulContextualPrior[] {
  const normalized = priors.flatMap((prior) => {
    if (!SHA_256.test(prior.selectorHash)) return [];
    const lastObservedAt = validIsoTimestamp(prior.lastObservedAt);
    const summary = cleanText(prior.summary, MAX_PATTERN_SUMMARY_CHARACTERS);
    const observedDays = Array.from(new Set(prior.observedDays.filter((day) => ISO_DAY.test(day))))
      .sort()
      .slice(-MAX_CONTEXTUAL_PRIOR_DAYS);
    return lastObservedAt && summary && observedDays.length > 0
      ? [{ selectorHash: prior.selectorHash, observedDays, lastObservedAt, summary }]
      : [];
  });
  const deduplicated = new Map<string, LivingSoulContextualPrior>();
  for (const prior of normalized) {
    const previous = deduplicated.get(prior.selectorHash);
    if (!previous || prior.observedDays.length > previous.observedDays.length
      || Date.parse(prior.lastObservedAt) > Date.parse(previous.lastObservedAt)) {
      deduplicated.set(prior.selectorHash, prior);
    }
  }
  return [...deduplicated.values()]
    .sort((a, b) => Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt))
    .slice(0, MAX_CONTEXTUAL_PRIORS);
}

function sameContextualPriors(
  a: readonly LivingSoulContextualPrior[],
  b: readonly LivingSoulContextualPrior[],
): boolean {
  return JSON.stringify(normalizeContextualPriors(a)) === JSON.stringify(normalizeContextualPriors(b));
}

function normalizeConfidence(value: unknown): LivingSoulPatternConfidence | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function cleanText(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = value
    ?.replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maxLength).trim() || null : null;
}

/**
 * Replaces raw identifiers with a neutral marker so a learned pattern stays a
 * generalization. Leading whitespace captured by the handle pattern is
 * preserved so words do not run together after redaction.
 */
function redactRawIdentifiers(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  return RAW_IDENTIFIER_PATTERNS.reduce<string>(
    (text, pattern) => text.replace(pattern, (match) => {
      const leading = /^[\s(]/.test(match) ? match[0] : "";
      return `${leading}${REDACTED_IDENTIFIER}`;
    }),
    value,
  );
}

function validIsoTimestamp(value: string | null | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

async function resolveLivingSoulOwnerId(useLocalFallback: boolean): Promise<string | null> {
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id?.trim();
      if (userId) return userId;
    } catch {
      // Local-provider users can continue with the device-local identity.
    }
  }
  return useLocalFallback ? "local" : null;
}

async function livingSoulScopeForOwner(ownerId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`drifty-living-soul:${ownerId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readSoulMarkdown(scope: string): Promise<string | null> {
  if (isTauriRuntime()) {
    const value: unknown = await invoke("living_soul_read", { scope });
    return typeof value === "string" ? value : null;
  }
  try {
    return window.localStorage.getItem(`${BROWSER_STORAGE_PREFIX}${scope}`);
  } catch {
    return null;
  }
}

async function writeSoulMarkdown(scope: string, markdown: string): Promise<void> {
  if (markdown.length > MAX_MARKDOWN_CHARACTERS) throw new Error("Living Soul is too large.");
  if (isTauriRuntime()) {
    await invoke("living_soul_write", { scope, markdown });
    return;
  }
  window.localStorage.setItem(`${BROWSER_STORAGE_PREFIX}${scope}`, markdown);
}

function queueSoulWrite<T>(ownerId: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(ownerId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  writeQueues.set(ownerId, next);
  void next.finally(() => {
    if (writeQueues.get(ownerId) === next) writeQueues.delete(ownerId);
  }).catch(() => undefined);
  return next;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const livingSoulLimits = {
  maxWorkSupportPatterns: MAX_WORK_SUPPORT_PATTERNS,
  maxDriftPatterns: MAX_DRIFT_PATTERNS,
  maxAmbiguityPatterns: MAX_AMBIGUITY_PATTERNS,
  maxContextualPriors: MAX_CONTEXTUAL_PRIORS,
  maxContextualPriorDays: MAX_CONTEXTUAL_PRIOR_DAYS,
  passivePriorPromotionDays: PASSIVE_PRIOR_PROMOTION_DAYS,
  passivePriorMediumConfidenceDays: PASSIVE_PRIOR_MEDIUM_CONFIDENCE_DAYS,
} as const;
