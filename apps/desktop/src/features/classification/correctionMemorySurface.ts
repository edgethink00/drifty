import type { ActivitySegment, LivingSoulPromptContext, LivingSoulPromptPattern, ProductivityLabel } from "@drifty/domain";

/**
 * A correction that Drifty keeps as a deterministic sentence names exactly one
 * app or site ("Using Slack can support work ..."). Such a sentence only goes
 * into requests about that app or site. Measured on 192 real activities
 * (2026-11), sending it with every request did not change accuracy beyond noise
 * but changed the answers for about fifteen unrelated activities per correction
 * and used the small local model's memory budget on unrelated apps. Patterns a
 * model or the user wrote keep going to every request.
 */

const FOCUS_FLOW_RELATED = " when it follows a related work or research flow";
const FOCUS_FLOW_SURROUNDING = " when surrounding intent supports it";
const SURFACE_PATTERNS: readonly RegExp[] = [
  /^Using (.+) can support work when (?:it follows a related work or research flow|surrounding intent supports it)\.$/,
  /^Using (.+) can be drift when the surrounding sequence is leisure\.$/,
  /^(.+) is not always drift; classify it from the surrounding sequence\.$/,
];

export type CorrectionMemorySurfaces = Readonly<Record<string, string>>;

export function correctionMemorySurfaceName(segment: Pick<ActivitySegment, "siteDomain" | "appName">): string | null {
  return cleanSurface(segment.siteDomain, 80) ?? cleanSurface(segment.appName, 80);
}

export function correctionMemorySummary(
  surface: string,
  productivity: ProductivityLabel,
  followsRelatedFlow: boolean,
): string {
  if (productivity === "focus") return `Using ${surface} can support work${followsRelatedFlow ? FOCUS_FLOW_RELATED : FOCUS_FLOW_SURROUNDING}.`;
  if (productivity === "drift") return `Using ${surface} can be drift when the surrounding sequence is leisure.`;
  return `${surface} is not always drift; classify it from the surrounding sequence.`;
}

/** The app or site a deterministic correction sentence is about, or null for any other pattern. */
export function correctionMemorySurfaceOfSummary(summary: string): string | null {
  for (const pattern of SURFACE_PATTERNS) {
    const surface = summary.match(pattern)?.[1]?.trim();
    // A redacted name can no longer be matched to an activity; keep such a
    // sentence where it was before rather than silently dropping it.
    if (surface) return surface.includes("[") ? null : surface;
  }
  return null;
}

export function correctionMemorySurfacesForSegments(
  segments: readonly Pick<ActivitySegment, "id" | "siteDomain" | "appName">[],
): CorrectionMemorySurfaces {
  const surfaces: Record<string, string> = {};
  for (const segment of segments) {
    const surface = correctionMemorySurfaceName(segment);
    if (surface) surfaces[segment.id] = surface;
  }
  return surfaces;
}

/**
 * Drops deterministic correction sentences about apps or sites that none of the
 * given items use. Without a surface map the Soul is returned unchanged.
 */
export function scopeSoulToCorrectionSurfaces(
  soul: LivingSoulPromptContext | null,
  surfacesByItemId: CorrectionMemorySurfaces | undefined,
  segmentIds: readonly string[],
): LivingSoulPromptContext | null {
  if (!soul || !surfacesByItemId) return soul;
  const wanted = new Set(segmentIds.flatMap((id) => {
    const surface = surfacesByItemId[id];
    return surface ? [surfaceKey(surface)] : [];
  }));
  const keep = (pattern: LivingSoulPromptPattern) => {
    const surface = correctionMemorySurfaceOfSummary(pattern.summary);
    return surface === null || wanted.has(surfaceKey(surface));
  };
  const learnedWorkSupport = soul.learnedWorkSupport.filter(keep);
  const learnedDrift = soul.learnedDrift.filter(keep);
  const ambiguities = soul.ambiguities.filter(keep);
  if (learnedWorkSupport.length === soul.learnedWorkSupport.length
    && learnedDrift.length === soul.learnedDrift.length
    && ambiguities.length === soul.ambiguities.length) return soul;
  return { ...soul, learnedWorkSupport, learnedDrift, ambiguities };
}

function surfaceKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function cleanSurface(value: string | null | undefined, maxLength: number): string | null {
  const cleaned = value
    ?.replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maxLength).trim() || null : null;
}
