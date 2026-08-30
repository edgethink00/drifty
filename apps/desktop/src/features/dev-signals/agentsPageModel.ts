/**
 * Model for the Your Agents tab.
 *
 * The tab owns its own surface, unlike the earlier day-view overlays, but the
 * arithmetic contract is unchanged and inherited from devSignalsModel: agent
 * wall-clock time and attention time measure the same clock and are never
 * added together; cumulative time appears only as a parallelism factor.
 *
 * Sources arrive as compact tuples (see agentsWeekFixture.ts) so a week of
 * real data stays a reviewable file. This module expands them once into the
 * shapes the views render.
 */

import {
  mergeSpans,
  overlapMinutes,
  peakConcurrency,
  type MinuteSpan,
} from "./devSignalsModel";

/** [startMinute, endMinute] */
export type SpanTuple = readonly [number, number];
/** [startMinute, endMinute, provider, repo?, model?, totalTokens?] — repo "" when the cwd did not resolve. */
export type TurnTuple =
  | readonly [number, number, string]
  | readonly [number, number, string, string]
  | readonly [number, number, string, string, string, number];
/** [minute, insertions, deletions, files, sha, repo] */
export type CommitTuple = readonly [number, number, number, number, string, string];

export type AgentsDaySource = {
  readonly day: string;
  /** Total tokens across the day's sessions (cumulative per session, summed). */
  readonly tokens?: number;
  /** Distinct agent sessions that day. */
  readonly sessions?: number;
  readonly attention: readonly SpanTuple[];
  readonly turns: readonly TurnTuple[];
  readonly commits: readonly CommitTuple[];
};

export type AgentsCommit = {
  readonly min: number;
  readonly ins: number;
  readonly del: number;
  readonly files: number;
  readonly sha: string;
  readonly repo: string;
};

export type AgentsRepoRow = {
  readonly repo: string;
  readonly commitCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly firstCommitMin: number;
  readonly lastCommitMin: number;
};

export type AgentsDayModel = {
  readonly day: string;
  /** Overlap-merged attention spans. */
  readonly attention: readonly MinuteSpan[];
  /** Overlap-merged agent wall-clock spans. */
  readonly agent: readonly MinuteSpan[];
  readonly commits: readonly AgentsCommit[];
  readonly repos: readonly AgentsRepoRow[];
  readonly attentionMinutes: number;
  readonly agentMinutes: number;
  /** Agent minutes with no captured attention over them. */
  readonly unattendedMinutes: number;
  readonly commitCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly concurrencyPeak: number;
  /** Cumulative turn minutes over wall-clock minutes; 1 is serial. */
  readonly parallelFactor: number;
  readonly providers: readonly string[];
};

function total(spans: readonly MinuteSpan[]): number {
  return spans.reduce((sum, span) => sum + (span.end - span.start), 0);
}

function toSpans(tuples: readonly (SpanTuple | TurnTuple)[]): MinuteSpan[] {
  return tuples.map(([start, end]) => ({ start, end }));
}

export function buildAgentsDayModel(source: AgentsDaySource): AgentsDayModel {
  const attention = mergeSpans(toSpans(source.attention));
  const turnSpans = toSpans(source.turns);
  const agent = mergeSpans(turnSpans);
  const attentionMinutes = total(attention);
  const agentMinutes = total(agent);
  const cumulative = source.turns.reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0);

  const commits: AgentsCommit[] = source.commits
    .map(([min, ins, del, files, sha, repo]) => ({ min, ins, del, files, sha, repo }))
    .sort((a, b) => a.min - b.min);

  const byRepo = new Map<string, { commitCount: number; insertions: number; deletions: number; firstCommitMin: number; lastCommitMin: number }>();
  for (const commit of commits) {
    const row = byRepo.get(commit.repo) ?? { commitCount: 0, insertions: 0, deletions: 0, firstCommitMin: commit.min, lastCommitMin: commit.min };
    row.commitCount += 1;
    row.insertions += commit.ins;
    row.deletions += commit.del;
    row.firstCommitMin = Math.min(row.firstCommitMin, commit.min);
    row.lastCommitMin = Math.max(row.lastCommitMin, commit.min);
    byRepo.set(commit.repo, row);
  }
  const repos: AgentsRepoRow[] = [...byRepo.entries()]
    .map(([repo, row]) => ({ repo, ...row }))
    .sort((a, b) => b.commitCount - a.commitCount);

  const providers = [...new Set(source.turns.map(([, , provider]) => provider))].sort();

  return {
    day: source.day,
    attention,
    agent,
    commits,
    repos,
    attentionMinutes,
    agentMinutes,
    unattendedMinutes: Math.max(0, agentMinutes - overlapMinutes(agent, attention)),
    commitCount: commits.length,
    insertions: commits.reduce((sum, commit) => sum + commit.ins, 0),
    deletions: commits.reduce((sum, commit) => sum + commit.del, 0),
    concurrencyPeak: peakConcurrency(turnSpans),
    parallelFactor: agentMinutes > 0 ? Number((cumulative / agentMinutes).toFixed(1)) : 0,
    providers,
  };
}

export type AgentsWeekDayColumn = {
  readonly day: string;
  /** Mon, Tue, ... */
  readonly weekdayLabel: string;
  readonly agentMinutes: number;
  readonly attentionMinutes: number;
  readonly commitCount: number;
};

export type AgentsWeekModel = {
  readonly days: readonly AgentsWeekDayColumn[];
  readonly agentMinutes: number;
  readonly attentionMinutes: number;
  readonly commitCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly repos: readonly AgentsRepoRow[];
  /** Max per-day agent minutes, for scaling the columns. */
  readonly peakDayAgentMinutes: number;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function weekdayLabelFor(day: string): string {
  // Parse as local calendar date; the day string is already in the user's zone.
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  if (!year || !month || !dayOfMonth) return "";
  return WEEKDAY_LABELS[new Date(year, month - 1, dayOfMonth).getDay()] ?? "";
}

export function buildAgentsWeekModel(models: readonly AgentsDayModel[]): AgentsWeekModel {
  const days: AgentsWeekDayColumn[] = models.map((model) => ({
    day: model.day,
    weekdayLabel: weekdayLabelFor(model.day),
    agentMinutes: model.agentMinutes,
    attentionMinutes: model.attentionMinutes,
    commitCount: model.commitCount,
  }));

  const byRepo = new Map<string, { commitCount: number; insertions: number; deletions: number; firstCommitMin: number; lastCommitMin: number }>();
  for (const model of models) {
    for (const repo of model.repos) {
      const row = byRepo.get(repo.repo) ?? { commitCount: 0, insertions: 0, deletions: 0, firstCommitMin: repo.firstCommitMin, lastCommitMin: repo.lastCommitMin };
      row.commitCount += repo.commitCount;
      row.insertions += repo.insertions;
      row.deletions += repo.deletions;
      byRepo.set(repo.repo, row);
    }
  }

  return {
    days,
    agentMinutes: models.reduce((sum, model) => sum + model.agentMinutes, 0),
    attentionMinutes: models.reduce((sum, model) => sum + model.attentionMinutes, 0),
    commitCount: models.reduce((sum, model) => sum + model.commitCount, 0),
    insertions: models.reduce((sum, model) => sum + model.insertions, 0),
    deletions: models.reduce((sum, model) => sum + model.deletions, 0),
    repos: [...byRepo.entries()].map(([repo, row]) => ({ repo, ...row })).sort((a, b) => b.commitCount - a.commitCount),
    peakDayAgentMinutes: Math.max(0, ...days.map((day) => day.agentMinutes)),
  };
}

/* ── flow-grid view: per-cell buckets ──────────────────────────────────── */

export type AgentsGridCell = {
  /** Minute of day at the cell start. */
  readonly minuteOfDay: number;
  /** Peak number of concurrent turns inside the cell. 0 = no agent activity. */
  readonly concurrency: number;
  /** Repo with the most turn-minutes inside the cell, or null. */
  readonly topRepo: string | null;
  /** Commits authored inside this cell. */
  readonly commitCount: number;
  /** True when any attention span overlaps the cell. */
  readonly attended: boolean;
};

export type AgentsIntensitySlot = "b0" | "b1" | "b2" | "b3" | "b4" | "b5";

export type AgentsIntensityBand = {
  readonly id: AgentsIntensitySlot;
  readonly label: string;
  readonly min: number;
  readonly max: number | null;
  /** Percentage of the focus tone used by the chart cell. */
  readonly tonePercent: number;
};

export const AGENTS_INTENSITY_LOOKBACK_DAYS = 28;
export const AGENTS_INTENSITY_MAX_BANDS = 6;
export const AGENTS_INTENSITY_GROWTH = 1.65;
export const AGENTS_INTENSITY_SHRINK_RATIO = 0.75;
export const AGENTS_INTENSITY_TONE_START = 30;
export const AGENTS_INTENSITY_TONE_END = 94;

const INTENSITY_SLOTS: readonly AgentsIntensitySlot[] = ["b0", "b1", "b2", "b3", "b4", "b5"];

function intensityLabel(min: number, max: number | null): string {
  if (max === null) return `×${min}+`;
  return min === max ? `×${min}` : `×${min}–${max}`;
}

function intensityTonePercent(index: number, count: number): number {
  if (count <= 1) return AGENTS_INTENSITY_TONE_END;
  const t = index / (count - 1);
  return Math.round(AGENTS_INTENSITY_TONE_START + t * (AGENTS_INTENSITY_TONE_END - AGENTS_INTENSITY_TONE_START));
}

function growingWidths(total: number, parts: number): number[] {
  if (parts <= 0 || total <= 0) return [];
  if (total <= parts) return Array.from({ length: total }, () => 1);
  const raw = Array.from({ length: parts }, (_, index) => AGENTS_INTENSITY_GROWTH ** index);
  const sum = raw.reduce((acc, value) => acc + value, 0);
  const exact = raw.map((weight) => (total * weight) / sum);
  const widths = exact.map((value) => Math.floor(value));
  let remain = total - widths.reduce((acc, value) => acc + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - widths[index]! }))
    .sort((left, right) => right.frac - left.frac || left.index - right.index);
  for (let step = 0; step < remain; step += 1) {
    widths[order[step]!.index] += 1;
  }
  for (let index = 0; index < widths.length; index += 1) {
    if (widths[index] !== 0) continue;
    for (let donor = widths.length - 1; donor >= 0; donor -= 1) {
      if (widths[donor]! > 1) {
        widths[donor]! -= 1;
        widths[index] = 1;
        break;
      }
    }
  }
  return widths.filter((width) => width > 0);
}

/**
 * Personal concurrency bands for Day and Week.
 *
 * Color is relative to this person's recent peak; labels keep the actual
 * concurrent-turn numbers. ×1 stays a singleton so serial work never shares a
 * tone with parallelism. Remaining slots grow toward the locked peak so quiet
 * users keep 1-wide steps and a 50-agent day still reads as a log-like ramp.
 */
export function buildAgentsIntensityBands(
  scalePeak: number,
  options: { readonly overflow?: boolean } = {},
): readonly AgentsIntensityBand[] {
  const peak = Math.max(1, Math.floor(scalePeak));
  const overflow = options.overflow === true;
  const closedSlots = Math.min(AGENTS_INTENSITY_MAX_BANDS, peak);
  const ranges: Array<{ min: number; max: number | null }> = [{ min: 1, max: 1 }];
  if (closedSlots > 1) {
    const widths = growingWidths(peak - 1, closedSlots - 1);
    let cursor = 2;
    for (const width of widths) {
      ranges.push({ min: cursor, max: cursor + width - 1 });
      cursor += width;
    }
  }
  if (overflow) {
    const lastClosed = ranges[Math.min(ranges.length, AGENTS_INTENSITY_MAX_BANDS) - 1]!;
    lastClosed.max = null;
    if (ranges.length > AGENTS_INTENSITY_MAX_BANDS) ranges.length = AGENTS_INTENSITY_MAX_BANDS;
  }
  return ranges.map((range, index) => ({
    id: INTENSITY_SLOTS[index]!,
    label: intensityLabel(range.min, range.max),
    min: range.min,
    max: range.max,
    tonePercent: intensityTonePercent(index, ranges.length),
  }));
}

/** Fallback bands used by tests that do not pass a personal scale. */
export const AGENTS_INTENSITY_BANDS: readonly AgentsIntensityBand[] = buildAgentsIntensityBands(50);

export function agentsIntensityBandFor(
  concurrency: number,
  bands: readonly AgentsIntensityBand[] = AGENTS_INTENSITY_BANDS,
): AgentsIntensityBand {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const fallback = bands[bands.length - 1] ?? buildAgentsIntensityBands(1)[0]!;
  return bands.find((band) => band.max === null || safeConcurrency <= band.max) ?? fallback;
}

export function visibleAgentsIntensityBands(
  peakConcurrency: number,
  bands: readonly AgentsIntensityBand[] = AGENTS_INTENSITY_BANDS,
): readonly AgentsIntensityBand[] {
  if (peakConcurrency <= 0 || bands.length === 0) return [];
  return bands;
}

export function lockAgentsIntensityPeak(args: {
  readonly previousPeak: number;
  readonly observedPeak: number;
  readonly previousLockedOnDay?: string | null;
  readonly todayDay: string;
}): { readonly peak: number; readonly lockedOnDay: string } {
  const previousPeak = Math.max(0, Math.floor(args.previousPeak));
  const observedPeak = Math.max(0, Math.floor(args.observedPeak));
  if (observedPeak <= 0 && previousPeak <= 0) {
    return { peak: 0, lockedOnDay: args.todayDay };
  }
  if (observedPeak > previousPeak) {
    return { peak: observedPeak, lockedOnDay: args.todayDay };
  }
  if (args.previousLockedOnDay === args.todayDay) {
    return { peak: previousPeak, lockedOnDay: args.todayDay };
  }
  const shouldShrink = previousPeak > 0 && observedPeak < previousPeak * AGENTS_INTENSITY_SHRINK_RATIO;
  return {
    peak: shouldShrink ? observedPeak : previousPeak,
    lockedOnDay: args.todayDay,
  };
}

export type AgentsTimelineColorMode = "intensity" | "repo";

export const AGENTS_WEEK_BUCKET_MINUTES = 5;

export type AgentsTimelineSegment = {
  readonly start: number;
  readonly end: number;
  readonly peakConcurrency: number;
  readonly topRepo: string | null;
  readonly providers: readonly string[];
  readonly intensityBand: AgentsIntensityBand;
};

type TimelineTurn = {
  readonly start: number;
  readonly end: number;
  readonly provider: string;
  readonly repo: string;
};

type MutableTimelineSegment = {
  start: number;
  end: number;
  peakConcurrency: number;
  providers: Set<string>;
  repoMinutes: Map<string, number>;
  intensityBand: AgentsIntensityBand;
  visualKey: string;
};

function rankedRepo(
  repoMinutes: ReadonlyMap<string, number>,
  repoPriority: ReadonlyMap<string, number>,
): string | null {
  const winner = [...repoMinutes.entries()]
    .sort((left, right) => (
      right[1] - left[1]
      || (repoPriority.get(left[0]) ?? Number.MAX_SAFE_INTEGER) - (repoPriority.get(right[0]) ?? Number.MAX_SAFE_INTEGER)
      || left[0].localeCompare(right[0])
    ))[0]?.[0];
  return winner?.trim() ? winner : null;
}

/**
 * Build Week calendar stretches from bounded five-minute buckets.
 *
 * Raw agent logs can contain thousands of sub-minute turn boundaries. Drawing
 * each one creates an unreadable barcode and an unnecessarily large DOM. Each
 * bucket therefore records its real peak concurrency and turn-minute-weighted
 * repository, then adjacent buckets coalesce only when their visible state is
 * unchanged: intensity band in Intensity mode, dominant repo in Project mode.
 */
export function buildAgentsTimelineSegments(
  source: AgentsDaySource,
  colorMode: AgentsTimelineColorMode,
  repoOrder: readonly string[] = [],
  bucketMinutes: number = AGENTS_WEEK_BUCKET_MINUTES,
  bands: readonly AgentsIntensityBand[] = AGENTS_INTENSITY_BANDS,
): AgentsTimelineSegment[] {
  const turns: TimelineTurn[] = source.turns
    .map((turn) => {
      const [rawStart, rawEnd, provider, repo] = turn as readonly [number, number, string, string?];
      return {
        start: Math.max(0, Math.min(24 * 60, rawStart)),
        end: Math.max(0, Math.min(24 * 60, rawEnd)),
        provider,
        repo: (repo ?? "").trim(),
      };
    })
    .filter((turn) => turn.end > turn.start);
  if (turns.length === 0) return [];

  const safeBucketMinutes = Number.isFinite(bucketMinutes)
    ? Math.max(1, Math.min(60, Math.floor(bucketMinutes)))
    : AGENTS_WEEK_BUCKET_MINUTES;
  const repoPriority = new Map(repoOrder.map((repo, index) => [repo, index]));
  const segments: AgentsTimelineSegment[] = [];
  let current: MutableTimelineSegment | null = null;

  const finishCurrent = () => {
    if (!current) return;
    segments.push({
      start: current.start,
      end: current.end,
      peakConcurrency: current.peakConcurrency,
      topRepo: rankedRepo(current.repoMinutes, repoPriority),
      providers: [...current.providers].sort(),
      intensityBand: current.intensityBand,
    });
    current = null;
  };

  for (let start = 0; start < 24 * 60; start += safeBucketMinutes) {
    const end = Math.min(24 * 60, start + safeBucketMinutes);
    const activeTurns = turns.filter((turn) => turn.start < end && turn.end > start);
    if (activeTurns.length === 0) {
      finishCurrent();
      continue;
    }

    const atomRepoMinutes = new Map<string, number>();
    for (const turn of activeTurns) {
      const overlap = Math.max(0, Math.min(turn.end, end) - Math.max(turn.start, start));
      if (overlap > 0) atomRepoMinutes.set(turn.repo, (atomRepoMinutes.get(turn.repo) ?? 0) + overlap);
    }
    const atomTopRepo = rankedRepo(atomRepoMinutes, repoPriority);
    const atomPeakConcurrency = peakConcurrency(activeTurns.map((turn) => ({
      start: Math.max(turn.start, start),
      end: Math.min(turn.end, end),
    })));
    const intensityBand = agentsIntensityBandFor(atomPeakConcurrency, bands);
    const visualKey = colorMode === "repo" ? `repo:${atomTopRepo ?? "__unknown__"}` : `intensity:${intensityBand.id}`;

    if (!current || current.end !== start || current.visualKey !== visualKey) {
      finishCurrent();
      current = {
        start,
        end,
        peakConcurrency: atomPeakConcurrency,
        providers: new Set(activeTurns.map((turn) => turn.provider)),
        repoMinutes: atomRepoMinutes,
        intensityBand,
        visualKey,
      };
      continue;
    }

    current.end = end;
    current.peakConcurrency = Math.max(current.peakConcurrency, atomPeakConcurrency);
    activeTurns.forEach((turn) => current?.providers.add(turn.provider));
    for (const [repo, minutes] of atomRepoMinutes) {
      current.repoMinutes.set(repo, (current.repoMinutes.get(repo) ?? 0) + minutes);
    }
  }
  finishCurrent();
  return segments;
}

/**
 * Bucket a day's turns into flow-grid cells of `intervalMinutes`.
 *
 * Concurrency is the peak overlap inside the cell (what "intensity" shows);
 * topRepo is the repo with the most turn-minutes in the cell (what the
 * project colour mode shows). Cells with no agent time are omitted — the
 * grid draws its own empty cells, exactly like the flow chart.
 */
export function buildAgentsGridCells(
  source: AgentsDaySource,
  intervalMinutes: number,
  repoOrder: readonly string[] = [],
): Map<number, AgentsGridCell> {
  const cells = new Map<number, {
    concurrency: number;
    repoMinutes: Map<string, number>;
    commitCount: number;
    attended: boolean;
  }>();
  const cellCount = Math.ceil((24 * 60) / intervalMinutes);
  const repoPriority = new Map(repoOrder.map((repo, index) => [repo, index]));
  const cellIndexFor = (minute: number) => Math.floor(minute / intervalMinutes);
  const ensure = (index: number) => {
    let cell = cells.get(index);
    if (!cell) {
      cell = { concurrency: 0, repoMinutes: new Map(), commitCount: 0, attended: false };
      cells.set(index, cell);
    }
    return cell;
  };

  // Peak concurrency per cell: count overlap of each turn with each cell it
  // crosses, taking the max simultaneous count via a per-cell sweep. A simple
  // per-cell counter over turn coverage over-counts serial turns inside one
  // cell, so sweep boundaries per cell instead.
  const eventsByCell = new Map<number, { at: number; delta: number }[]>();
  for (const turn of source.turns) {
    const [start, end, , repo] = turn as readonly [number, number, string, string?];
    if (end <= start) continue;
    const firstCell = Math.max(0, cellIndexFor(start));
    const lastCell = Math.min(cellCount - 1, cellIndexFor(Math.max(start, end - 0.001)));
    for (let index = firstCell; index <= lastCell; index += 1) {
      const cellStart = index * intervalMinutes;
      const cellEnd = cellStart + intervalMinutes;
      const overlapStart = Math.max(start, cellStart);
      const overlapEnd = Math.min(end, cellEnd);
      if (overlapEnd <= overlapStart) continue;
      const cell = ensure(index);
      const normalizedRepo = repo?.trim() ?? "";
      cell.repoMinutes.set(normalizedRepo, (cell.repoMinutes.get(normalizedRepo) ?? 0) + (overlapEnd - overlapStart));
      let boundaries = eventsByCell.get(index);
      if (!boundaries) {
        boundaries = [];
        eventsByCell.set(index, boundaries);
      }
      boundaries.push({ at: overlapStart, delta: 1 }, { at: overlapEnd, delta: -1 });
    }
  }
  for (const [index, boundaries] of eventsByCell) {
    boundaries.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let current = 0;
    let peak = 0;
    for (const boundary of boundaries) {
      current += boundary.delta;
      peak = Math.max(peak, current);
    }
    ensure(index).concurrency = peak;
  }

  for (const [minute] of source.commits) {
    if (minute < 0 || minute >= 24 * 60) continue;
    ensure(cellIndexFor(minute)).commitCount += 1;
  }

  for (const [start, end] of source.attention) {
    if (end <= start) continue;
    const firstCell = Math.max(0, cellIndexFor(start));
    const lastCell = Math.min(cellCount - 1, cellIndexFor(Math.max(start, end - 0.001)));
    for (let index = firstCell; index <= lastCell; index += 1) {
      const cell = cells.get(index);
      if (cell) cell.attended = true;
    }
  }

  const result = new Map<number, AgentsGridCell>();
  for (const [index, cell] of cells) {
    // Commits remain a Breakdown signal. A commit without overlapping agent
    // time must not paint a fake ×1 activity cell in the Day timeline.
    if (cell.concurrency === 0) continue;
    const topRepo = rankedRepo(cell.repoMinutes, repoPriority);
    result.set(index * intervalMinutes, {
      minuteOfDay: index * intervalMinutes,
      concurrency: cell.concurrency,
      topRepo,
      commitCount: cell.commitCount,
      attended: cell.attended,
    });
  }
  return result;
}

/** Distinct repos that appear as a cell's top repo, most cell-time first. */
export function gridRepoLegend(cells: ReadonlyMap<number, AgentsGridCell>): string[] {
  const counts = new Map<string, number>();
  for (const cell of cells.values()) {
    if (cell.topRepo) counts.set(cell.topRepo, (counts.get(cell.topRepo) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([repo]) => repo);
}

/* ── insight aggregations for the proposal panels ──────────────────────── */

function turnFields(turn: TurnTuple): { start: number; end: number; provider: string; repo: string; model: string } {
  const [start, end, provider, repo, model] = turn as readonly [number, number, string, string?, string?, number?];
  return { start, end, provider, repo: repo ?? "", model: model ?? "" };
}

export type AgentToolRow = {
  readonly provider: string;
  /** Cumulative turn minutes (not overlap-merged; this ranks tools, it is not wall-clock). */
  readonly cumulativeMinutes: number;
  readonly turnCount: number;
  readonly topModel: string | null;
  readonly shareOfCumulative: number;
};

/** Per-tool ranking (codex / claude / …) by cumulative turn time. */
export function agentToolRows(sources: readonly AgentsDaySource[]): AgentToolRow[] {
  const byProvider = new Map<string, { minutes: number; turns: number; modelMinutes: Map<string, number> }>();
  let total = 0;
  for (const source of sources) {
    for (const turn of source.turns) {
      const { start, end, provider, model } = turnFields(turn);
      const minutes = Math.max(0, end - start);
      if (minutes <= 0) continue;
      total += minutes;
      let row = byProvider.get(provider);
      if (!row) {
        row = { minutes: 0, turns: 0, modelMinutes: new Map() };
        byProvider.set(provider, row);
      }
      row.minutes += minutes;
      row.turns += 1;
      if (model) row.modelMinutes.set(model, (row.modelMinutes.get(model) ?? 0) + minutes);
    }
  }
  return [...byProvider.entries()]
    .map(([provider, row]) => {
      let topModel: string | null = null;
      let topMinutes = 0;
      for (const [model, minutes] of row.modelMinutes) {
        if (minutes > topMinutes) {
          topModel = model;
          topMinutes = minutes;
        }
      }
      return {
        provider,
        cumulativeMinutes: row.minutes,
        turnCount: row.turns,
        topModel,
        shareOfCumulative: total > 0 ? (row.minutes / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.cumulativeMinutes - a.cumulativeMinutes);
}

export type AgentModelRow = {
  readonly model: string;
  readonly cumulativeMinutes: number;
  readonly turnCount: number;
  readonly shareOfCumulative: number;
};

/** Per-model ranking by cumulative turn time; unlabelled turns are omitted. */
export function agentModelRows(sources: readonly AgentsDaySource[]): AgentModelRow[] {
  const byModel = new Map<string, { minutes: number; turns: number }>();
  let total = 0;
  for (const source of sources) {
    for (const turn of source.turns) {
      const { start, end, model } = turnFields(turn);
      const minutes = Math.max(0, end - start);
      if (minutes <= 0 || !model) continue;
      total += minutes;
      const row = byModel.get(model) ?? { minutes: 0, turns: 0 };
      row.minutes += minutes;
      row.turns += 1;
      byModel.set(model, row);
    }
  }
  return [...byModel.entries()]
    .map(([model, row]) => ({
      model,
      cumulativeMinutes: row.minutes,
      turnCount: row.turns,
      shareOfCumulative: total > 0 ? (row.minutes / total) * 100 : 0,
    }))
    .sort((a, b) => b.cumulativeMinutes - a.cumulativeMinutes);
}

/** repo → agent provider with the most turn-minutes there. */
export function repoDominantProviders(sources: readonly AgentsDaySource[]): Map<string, string> {
  const byRepo = new Map<string, Map<string, number>>();
  for (const source of sources) {
    for (const turn of source.turns) {
      const { start, end, provider, repo } = turnFields(turn);
      const minutes = Math.max(0, end - start);
      if (minutes <= 0 || !repo) continue;
      let providers = byRepo.get(repo);
      if (!providers) {
        providers = new Map();
        byRepo.set(repo, providers);
      }
      providers.set(provider, (providers.get(provider) ?? 0) + minutes);
    }
  }
  const result = new Map<string, string>();
  for (const [repo, providers] of byRepo) {
    let top: string | null = null;
    let topMinutes = 0;
    for (const [provider, minutes] of providers) {
      if (minutes > topMinutes) {
        top = provider;
        topMinutes = minutes;
      }
    }
    if (top) result.set(repo, top);
  }
  return result;
}

/** repo → cumulative agent turn-minutes spent there. */
export function agentMinutesByRepo(sources: readonly AgentsDaySource[]): Map<string, number> {
  const byRepo = new Map<string, number>();
  for (const source of sources) {
    for (const turn of source.turns) {
      const { start, end, repo } = turnFields(turn);
      const minutes = Math.max(0, end - start);
      if (minutes <= 0 || !repo) continue;
      byRepo.set(repo, (byRepo.get(repo) ?? 0) + minutes);
    }
  }
  return byRepo;
}

export type AgentsHourHistogram = {
  /** 24 values: agent wall-clock minutes with work in that hour. */
  readonly agentMinutes: readonly number[];
  /** 24 values: commits authored in that hour. */
  readonly commits: readonly number[];
  readonly peakAgentHour: number;
  readonly peakCommitHour: number;
};

/** Hour-of-day rhythm across several days: when do agents run, when do commits land. */
export function agentsHourHistogram(sources: readonly AgentsDaySource[]): AgentsHourHistogram {
  const agentMinutes = new Array<number>(24).fill(0);
  const commits = new Array<number>(24).fill(0);
  for (const source of sources) {
    const merged = mergeSpans(source.turns.map((turn) => {
      const { start, end } = turnFields(turn);
      return { start, end };
    }));
    for (const span of merged) {
      for (let hour = 0; hour < 24; hour += 1) {
        const hourStart = hour * 60;
        const overlap = Math.min(span.end, hourStart + 60) - Math.max(span.start, hourStart);
        if (overlap > 0) agentMinutes[hour] += overlap;
      }
    }
    for (const [minute] of source.commits) {
      const hour = Math.floor(minute / 60);
      if (hour >= 0 && hour < 24) commits[hour] += 1;
    }
  }
  const peakAgentHour = agentMinutes.indexOf(Math.max(...agentMinutes));
  const peakCommitHour = commits.indexOf(Math.max(...commits));
  return { agentMinutes, commits, peakAgentHour, peakCommitHour };
}

export type AgentsInsightNumbers = {
  /** Longest unbroken agent stretch (merged spans), minutes, with its start. */
  readonly longestStretchMinutes: number;
  readonly longestStretchStart: number;
  /** Minutes from first agent activity to last, i.e. the agent "workday" span. */
  readonly activeSpanMinutes: number;
  readonly firstActivityMinute: number | null;
  readonly lastActivityMinute: number | null;
  /** Commits per agent wall-clock hour. */
  readonly commitsPerAgentHour: number;
  /** Median merged-turn stretch length, minutes. */
  readonly medianStretchMinutes: number;
  /** Share of agent wall-clock during 0-6h local. */
  readonly nightSharePercent: number;
  readonly tokens: number;
  readonly sessions: number;
  /** Average tokens per session. */
  readonly tokensPerSession: number;
  /** Net line delta across commits. */
  readonly netLines: number;
};

export function agentsInsightNumbers(source: AgentsDaySource, model: AgentsDayModel): AgentsInsightNumbers {
  const merged = model.agent;
  let longest: MinuteSpan | null = null;
  for (const span of merged) {
    if (!longest || span.end - span.start > longest.end - longest.start) longest = span;
  }
  const durations = merged.map((span) => span.end - span.start).sort((a, b) => a - b);
  const median = durations.length > 0 ? durations[Math.floor(durations.length / 2)]! : 0;
  const first = merged[0]?.start ?? null;
  const last = merged[merged.length - 1]?.end ?? null;
  let nightMinutes = 0;
  for (const span of merged) {
    nightMinutes += Math.max(0, Math.min(span.end, 6 * 60) - Math.max(span.start, 0));
  }
  const tokens = source.tokens ?? 0;
  const sessions = source.sessions ?? 0;
  return {
    longestStretchMinutes: longest ? longest.end - longest.start : 0,
    longestStretchStart: longest?.start ?? 0,
    activeSpanMinutes: first !== null && last !== null ? last - first : 0,
    firstActivityMinute: first,
    lastActivityMinute: last,
    commitsPerAgentHour: model.agentMinutes > 0 ? model.commitCount / (model.agentMinutes / 60) : 0,
    medianStretchMinutes: median,
    nightSharePercent: model.agentMinutes > 0 ? (nightMinutes / model.agentMinutes) * 100 : 0,
    tokens,
    sessions,
    tokensPerSession: sessions > 0 ? tokens / sessions : 0,
    netLines: model.insertions - model.deletions,
  };
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(1)}B`;
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(0)}K`;
  return String(tokens);
}
