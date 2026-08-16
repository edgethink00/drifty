import type {
  ActivitySegment,
  LiveClassificationMemoryContext,
  RecentEpisodePromptContext,
} from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import type { AiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import { resolveLivingSoulForClassification } from "./livingSoul";
import { observePassiveSoulEpisode, soulPromptContextForRequest } from "./passiveSoulLearning";
import { buildRecentEpisodeContext, episodeContextDigestMaterial } from "./recentEpisodeContext";

const MAX_BATCH_MEMORY_CONTEXT_BYTES = 12_000;

export async function buildClassificationMemoryContext(input: {
  readonly items: readonly ActivitySegment[];
  readonly privacySettings: AiPrivacyRequestSettings;
  readonly useLocalFallback: boolean;
  readonly soulOwnerId?: string | null;
  readonly contextSegments?: readonly ActivitySegment[];
}): Promise<LiveClassificationMemoryContext> {
  const resolvedSoul = input.privacySettings.optional.workProfile
    ? await resolveLivingSoulForClassification(input.useLocalFallback, input.soulOwnerId).catch(() => null)
    : null;
  const contextSegments = input.contextSegments
    ? input.contextSegments
    : await loadEpisodeSegments(input.items);
  const episodeByItemId: Record<string, RecentEpisodePromptContext> = {};
  for (const item of input.items) {
    episodeByItemId[item.id] = buildRecentEpisodeContext({
      current: item,
      segments: contextSegments,
      privacySettings: input.privacySettings,
    });
  }
  // Passive selectors are item-specific. The current prompt contract carries
  // one shared Soul per request, so only a single-item live classification may
  // receive a retrieved prior; batch injection could leak one item's match to
  // unrelated items in the same request.
  const soul = resolvedSoul
    ? await soulPromptContextForRequest(
        resolvedSoul,
        episodeByItemId,
        input.items.length === 1 ? Date.parse(input.items[0].endedAt) : Date.now(),
      )
    : null;
  if (resolvedSoul) {
    input.items.forEach((current) => {
      const episode = episodeByItemId[current.id];
      if (!episode) return;
      void observePassiveSoulEpisode({ soul: resolvedSoul, current, episode })
        .catch((error) => console.warn("Unable to learn passive Soul context.", error));
    });
  }
  return { soul, episodeByItemId };
}

export function classificationMemoryFingerprintMaterial(
  context: LiveClassificationMemoryContext,
  segmentId: string,
): Record<string, unknown> {
  return {
    soulRevision: context.soul?.revision ?? null,
    soulState: context.soul ?? null,
    episode: episodeContextDigestMaterial(context.episodeByItemId[segmentId] ?? null),
  };
}

export function memoryContextForItems(
  context: LiveClassificationMemoryContext,
  segmentIds: readonly string[],
  maxBytes = MAX_BATCH_MEMORY_CONTEXT_BYTES,
): LiveClassificationMemoryContext {
  const wantedIds = new Set(segmentIds);
  const selected: LiveClassificationMemoryContext = {
    soul: context.soul,
    episodeByItemId: Object.fromEntries(
      Object.entries(context.episodeByItemId).filter(([segmentId]) => wantedIds.has(segmentId)),
    ),
  };
  if (utf8ByteLength(selected) <= maxBytes) return selected;

  const withTwoSurfaceTransitions = compactBatchMemoryContext(selected, 2);
  if (utf8ByteLength(withTwoSurfaceTransitions) <= maxBytes) return withTwoSurfaceTransitions;
  const withOneSurfaceTransition = compactBatchMemoryContext(selected, 1);
  if (utf8ByteLength(withOneSurfaceTransition) <= maxBytes) return withOneSurfaceTransition;
  const withoutTransitions = compactBatchMemoryContext(selected, 0);
  if (utf8ByteLength(withoutTransitions) <= maxBytes) return withoutTransitions;

  const soulOnly = { soul: withoutTransitions.soul, episodeByItemId: {} };
  const episodeOnly = { soul: null, episodeByItemId: withoutTransitions.episodeByItemId };
  const prioritized = segmentIds.length <= 1 ? [episodeOnly, soulOnly] : [soulOnly, episodeOnly];
  return prioritized.find((candidate) => utf8ByteLength(candidate) <= maxBytes)
    ?? { soul: null, episodeByItemId: {} };
}

function compactBatchMemoryContext(
  context: LiveClassificationMemoryContext,
  transitionLimit: number,
): LiveClassificationMemoryContext {
  return {
    soul: context.soul ? {
      ...context.soul,
      declared: {
        workActivities: context.soul.declared.workActivities.flatMap((value) => {
          const truncated = truncateText(value, 80);
          return truncated ? [truncated] : [];
        }),
        workDomain: truncateText(context.soul.declared.workDomain, 80),
        purpose: truncateText(context.soul.declared.purpose, 80),
      },
      learnedWorkSupport: compactSoulPatterns(context.soul.learnedWorkSupport),
      ...(context.soul.matchedContextualWorkSupport
        ? { matchedContextualWorkSupport: compactSoulPatterns(context.soul.matchedContextualWorkSupport) }
        : {}),
      learnedDrift: compactSoulPatterns(context.soul.learnedDrift),
      ambiguities: compactSoulPatterns(context.soul.ambiguities),
    } : null,
    episodeByItemId: Object.fromEntries(Object.entries(context.episodeByItemId).map(([segmentId, episode]) => [
      segmentId,
      {
        ...episode,
        dominantSurface: truncateText(episode.dominantSurface, 80),
        transitions: (transitionLimit === 0 ? [] : episode.transitions.slice(-transitionLimit)).map((transition) => ({
          appName: truncateText(transition.appName, 80) ?? "Unknown",
          ...(transition.domain ? { domain: truncateText(transition.domain, 80) ?? undefined } : {}),
          durationSeconds: transition.durationSeconds,
        })),
      },
    ])),
  };
}

function compactSoulPatterns<T extends { readonly summary: string }>(patterns: readonly T[]): Array<T & { summary: string }> {
  return patterns.map((pattern) => ({
    ...pattern,
    summary: truncateText(pattern.summary, 120) ?? "Context pattern",
  }));
}

function utf8ByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function truncateText(value: string | null | undefined, maxLength: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

async function loadEpisodeSegments(items: readonly ActivitySegment[]): Promise<ActivitySegment[]> {
  if (items.length === 0) return [];
  const starts = items.map((item) => Date.parse(item.startedAt)).filter(Number.isFinite);
  const ends = items.map((item) => Date.parse(item.endedAt)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return [...items];
  const start = new Date(Math.min(...starts) - 30 * 60 * 1000).toISOString();
  const end = new Date(Math.max(...ends) + 1_000).toISOString();
  try {
    const timeline = await trackerClient.getTimeline({ start, end });
    return timeline.length > 0 ? timeline : [...items];
  } catch {
    return [...items];
  }
}
