import {
  classifyActivityDetailed,
  type ActivitySegment,
  type LivingSoulPromptContext,
  type RecentEpisodePromptContext,
} from "@drifty/domain";

import {
  contextualPriorPromptPatterns,
  recordLivingSoulPassiveContextEvidence,
  type LivingSoulResolvedContext,
} from "./livingSoul";

const COMMUNICATION_APPS = new Set([
  "discord",
  "gmail",
  "kakaotalk",
  "mail",
  "messages",
  "microsoft teams",
  "slack",
  "telegram",
  "whatsapp",
]);
const COMMUNICATION_DOMAINS = new Set([
  "discord.com",
  "gmail.com",
  "mail.google.com",
  "slack.com",
  "teams.microsoft.com",
  "web.whatsapp.com",
  "whatsapp.com",
]);
const PASSIVE_ANCHOR_SOURCES = new Set(["app-db", "domain-db", "manual", "rule", "youtube"]);
const MAX_MATCHED_CONTEXTUAL_PROMPT_PATTERNS = 4;

export async function communicationSelectorHashes(
  episode: RecentEpisodePromptContext,
): Promise<string[]> {
  return Promise.all(communicationSelectorMaterials(episode).map(sha256));
}

export function communicationSelectorMaterials(
  episode: RecentEpisodePromptContext,
): string[] {
  const preceding = episode.transitions.slice(0, -1);
  return Array.from(new Set(preceding.flatMap((transition) => {
    const appName = normalizeToken(transition.appName);
    const domain = normalizeDomain(transition.domain);
    const title = normalizeTitle(transition.title);
    if (!title || (!COMMUNICATION_APPS.has(appName) && !COMMUNICATION_DOMAINS.has(domain))) return [];
    return [`${appName}|${domain}|${title}`];
  })));
}

export function isIndependentPassiveWorkAnchor(segment: ActivitySegment): boolean {
  const classification = classifyActivityDetailed(segment, { includeAiClassifications: false });
  if (!PASSIVE_ANCHOR_SOURCES.has(classification.source)) return false;
  if (classification.productivity !== "focus" || classification.confidence < 0.8) return false;
  if (classification.source === "manual" || classification.source === "rule") return true;
  return classification.category === "workspace" || classification.category === "learning";
}

export async function observePassiveSoulEpisode(input: {
  readonly soul: LivingSoulResolvedContext;
  readonly current: ActivitySegment;
  readonly episode: RecentEpisodePromptContext;
}): Promise<void> {
  if (!isIndependentPassiveWorkAnchor(input.current)) return;
  const selectorHashes = await communicationSelectorHashes(input.episode);
  if (selectorHashes.length === 0) return;
  await recordLivingSoulPassiveContextEvidence({
    ownerId: input.soul.ownerId,
    selectorHashes,
    observedAt: input.current.endedAt,
  });
}

export async function soulPromptContextForEpisodes(
  soul: LivingSoulResolvedContext,
  episodes: readonly RecentEpisodePromptContext[],
  nowMs = Date.now(),
): Promise<LivingSoulPromptContext> {
  const selectorHashes = Array.from(new Set((await Promise.all(
    episodes.map(communicationSelectorHashes),
  )).flat()));
  const passive = contextualPriorPromptPatterns(soul.document, selectorHashes, nowMs);
  if (passive.length === 0) return soul.promptContext;
  return {
    ...soul.promptContext,
    matchedContextualWorkSupport: passive.slice(0, MAX_MATCHED_CONTEXTUAL_PROMPT_PATTERNS),
  };
}

export async function soulPromptContextForRequest(
  soul: LivingSoulResolvedContext,
  episodeByItemId: Readonly<Record<string, RecentEpisodePromptContext>>,
  nowMs = Date.now(),
): Promise<LivingSoulPromptContext> {
  const episodes = Object.values(episodeByItemId);
  return episodes.length === 1
    ? soulPromptContextForEpisodes(soul, episodes, nowMs)
    : soul.promptContext;
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizeDomain(value: string | null | undefined): string {
  return normalizeToken(value).replace(/^www\./, "").replace(/\.$/, "");
}

function normalizeTitle(value: string | null | undefined): string {
  return normalizeToken(value).replace(/[<>]/g, "").slice(0, 160);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
