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
};

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
}): Promise<LivingSoulResolvedContext> {
  const feedbackAt = validIsoTimestamp(input.feedbackAt);
  if (!feedbackAt) throw new Error("Living Soul feedback timestamp must be valid ISO-8601.");
  return queueSoulWrite(input.ownerId, async () => {
    const state = readUserOnboardingState(input.ownerId);
    const current = await loadOrCreateLivingSoulUnqueued(input.ownerId, state);
    const now = new Date().toISOString();
    const next: LivingSoulDocument = {
      ...current.document,
      revision: current.document.revision + 1,
      updatedAt: now,
      lastFeedbackAt: feedbackAt,
      learned: normalizeLearnedState(input.learned),
    };
    await writeSoulMarkdown(current.scope, renderLivingSoulMarkdown(next));
    return resolvedContext(input.ownerId, current.scope, next);
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

  return {
    schema: LIVING_SOUL_SCHEMA,
    revision,
    createdAt,
    updatedAt,
    lastFeedbackAt,
    declared,
    learned: { workSupport, drift, ambiguities },
    contextualPriors,
  };
}

export function livingSoulPromptContext(document: LivingSoulDocument): LivingSoulPromptContext {
  return {
    revision: document.revision,
    declared: document.declared,
    learnedWorkSupport: document.learned.workSupport.map(promptPattern),
    learnedDrift: document.learned.drift.map(promptPattern),
    ambiguities: document.learned.ambiguities.map(promptPattern),
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
  const summary = cleanText(value.summary, MAX_PATTERN_SUMMARY_CHARACTERS);
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
