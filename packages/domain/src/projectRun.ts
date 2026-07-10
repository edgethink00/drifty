import type { ActivityCategory, ActivitySegment, ProductivityLabel, StoredClassificationSource } from "./activity";

/**
 * A "run" is a contiguous span of the same app+site, merged from adjacent
 * segments. Runs are the unit the heavy project pass reasons over — never
 * persisted, only produced for a single inference request.
 */
export interface ProjectRun {
  id: string;
  segmentIds: string[];
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  appName: string;
  domain: string | null;
  context: string | null;
  isShorts: boolean;
  category: ActivityCategory | null;
  productivity: ProductivityLabel | null;
  source: StoredClassificationSource | null;
  minor: boolean;
  minorCount: number;
}

export interface ProjectRunCompactionOptions {
  /** Max seconds of idle/gap between two segments that may still merge into one run. */
  readonly maxGapSeconds?: number;
  /** Runs shorter than this are candidates for coalescing into a "minor activities" line. */
  readonly minRunSeconds?: number;
  /** Privacy: include page/video title + channel context in the run. Off drops it entirely. */
  readonly includeTitleContext?: boolean;
}

const DEFAULT_MAX_GAP_SECONDS = 90;
const DEFAULT_MIN_RUN_SECONDS = 60;

interface MutableRun {
  segments: ActivitySegment[];
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  appName: string;
  domain: string | null;
}

function normalizedApp(segment: ActivitySegment): string {
  return segment.appName.trim().toLowerCase();
}

function normalizedDomain(segment: ActivitySegment): string | null {
  const domain = segment.siteDomain?.trim().toLowerCase();
  return domain ? domain : null;
}

function epochSeconds(iso: string): number | null {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value / 1000;
}

function sameGroup(a: ActivitySegment, b: ActivitySegment): boolean {
  return normalizedApp(a) === normalizedApp(b) && normalizedDomain(a) === normalizedDomain(b);
}

function withinGap(previousEndedAt: string, nextStartedAt: string, maxGapSeconds: number): boolean {
  const end = epochSeconds(previousEndedAt);
  const start = epochSeconds(nextStartedAt);
  if (end === null || start === null) return false;
  return start - end <= maxGapSeconds && start - end >= -maxGapSeconds;
}

function dominantSegment(segments: ActivitySegment[]): ActivitySegment {
  let dominant = segments[0];
  for (const segment of segments) {
    if (segment.durationSeconds > dominant.durationSeconds) dominant = segment;
  }
  return dominant;
}

function runContext(segment: ActivitySegment, includeTitleContext: boolean): string | null {
  if (!includeTitleContext) return null;
  const title = segment.siteTitle?.trim() || segment.youtubeTitle?.trim() || segment.windowTitle?.trim() || null;
  const channel = segment.youtubeChannelName?.trim() || null;
  if (title && channel) return `${title} · ${channel}`;
  return title ?? channel;
}

function toProjectRun(run: MutableRun, includeTitleContext: boolean): Omit<ProjectRun, "id"> {
  const dominant = dominantSegment(run.segments);
  const classification = dominant.classification ?? null;
  return {
    segmentIds: run.segments.map((segment) => segment.id),
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationSeconds: run.durationSeconds,
    appName: dominant.appName,
    domain: run.domain,
    context: runContext(dominant, includeTitleContext),
    isShorts: run.segments.some((segment) => segment.youtubeIsShorts === true),
    category: classification?.category ?? null,
    productivity: classification?.productivity ?? null,
    source: classification?.source ?? null,
    minor: false,
    minorCount: 1,
  };
}

/** Coalesce maximal runs of ≥2 consecutive sub-minimum runs into one "minor activities" line. */
function coalesceMinorRuns(runs: Array<Omit<ProjectRun, "id">>, minRunSeconds: number): Array<Omit<ProjectRun, "id">> {
  const result: Array<Omit<ProjectRun, "id">> = [];
  let index = 0;
  while (index < runs.length) {
    const run = runs[index];
    if (run.durationSeconds >= minRunSeconds) {
      result.push(run);
      index += 1;
      continue;
    }
    let end = index;
    while (end < runs.length && runs[end].durationSeconds < minRunSeconds) end += 1;
    const cluster = runs.slice(index, end);
    if (cluster.length < 2) {
      result.push(run);
      index += 1;
      continue;
    }
    const apps = new Set(cluster.map((item) => item.appName));
    result.push({
      segmentIds: cluster.flatMap((item) => item.segmentIds),
      startedAt: cluster[0].startedAt,
      endedAt: cluster[cluster.length - 1].endedAt,
      durationSeconds: cluster.reduce((total, item) => total + item.durationSeconds, 0),
      appName: apps.size === 1 ? cluster[0].appName : "Multiple apps",
      domain: null,
      context: null,
      isShorts: cluster.some((item) => item.isShorts),
      category: null,
      productivity: null,
      source: null,
      minor: true,
      minorCount: cluster.length,
    });
    index = end;
  }
  return result;
}

/**
 * Merge chronologically-adjacent segments of the same app+site (within maxGap)
 * into runs, then coalesce clusters of tiny runs, and assign stable r{index} ids.
 */
export function compactActivityRuns(
  segments: readonly ActivitySegment[],
  options: ProjectRunCompactionOptions = {},
): ProjectRun[] {
  const maxGapSeconds = options.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS;
  const minRunSeconds = options.minRunSeconds ?? DEFAULT_MIN_RUN_SECONDS;
  const includeTitleContext = options.includeTitleContext ?? true;

  const ordered = [...segments].sort((a, b) => {
    const byStart = a.startedAt.localeCompare(b.startedAt);
    return byStart !== 0 ? byStart : a.id.localeCompare(b.id);
  });

  const merged: MutableRun[] = [];
  for (const segment of ordered) {
    const current = merged[merged.length - 1];
    const lastSegment = current?.segments[current.segments.length - 1];
    if (current && lastSegment && sameGroup(lastSegment, segment) && withinGap(current.endedAt, segment.startedAt, maxGapSeconds)) {
      current.segments.push(segment);
      current.durationSeconds += segment.durationSeconds;
      if (segment.endedAt.localeCompare(current.endedAt) > 0) current.endedAt = segment.endedAt;
    } else {
      merged.push({
        segments: [segment],
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        durationSeconds: segment.durationSeconds,
        appName: segment.appName,
        domain: normalizedDomain(segment),
      });
    }
  }

  const runs = coalesceMinorRuns(
    merged.map((run) => toProjectRun(run, includeTitleContext)),
    minRunSeconds,
  );
  return runs.map((run, index) => ({ ...run, id: `r${index}` }));
}

function isoClock(iso: string): string {
  const timeIndex = iso.indexOf("T");
  if (timeIndex === -1) return iso;
  return iso.slice(timeIndex + 1, timeIndex + 6);
}

export function formatRunDuration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/** Canonical one-line rendering of a run for the project pass prompt. */
export function formatProjectRunLine(run: ProjectRun): string {
  const time = `${isoClock(run.startedAt)}–${isoClock(run.endedAt)} (${formatRunDuration(run.durationSeconds)})`;
  if (run.minor) {
    return `${run.id} | ${time} | ${run.minorCount} short activities`;
  }
  const surface = run.domain ? `${run.appName} · ${run.domain}` : run.appName;
  const parts = [`${run.id}`, time, surface];
  if (run.context) parts.push(run.context);
  if (run.isShorts) parts.push("shorts");
  const label = run.category ? `${run.category}/${run.productivity ?? "?"}${run.source ? ` (${run.source})` : ""}` : "unclassified";
  parts.push(`current: ${label}`);
  return parts.join(" | ");
}
