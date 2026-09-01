/**
 * Data loading for the Your Agents tab.
 *
 * In the Tauri app the tab reads the tracker: one get_dev_signals call per day
 * (commits + agent turns) and one timeline call per day (attention), with a
 * sync_dev_signals pass first so the numbers are fresh. Outside Tauri, or when
 * the tracker returns nothing at all, the real-week fixture keeps the surface
 * reviewable in a browser.
 *
 * Times land as minutes since the configured logical day start because that
 * is the unit both views draw in; conversion happens here once, not in the
 * components.
 */

import { useEffect, useMemo, useState } from "react";

import {
  logicalDayIsoDateForDate,
  logicalDayStartMs,
  normalizeStartOfDayMinutes,
  shiftIsoDate,
  type DevRepoRecord,
  type DevSignalsDayPayload,
} from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { getLogicalDayRange } from "../../lib/formatting";
import type { AgentsDaySource, CommitTuple, SpanTuple, TurnTuple } from "./agentsPageModel";
import { AGENTS_WEEK_FIXTURE } from "./agentsWeekFixture";

const DEFAULT_BACKFILL_DAYS = 30;
/** Ceiling on one ingest request. Navigating years back must not ask the
 *  tracker to rescan an unbounded session corpus on every arrow press. */
const MAX_BACKFILL_DAYS = 400;

function isoDayString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

export function buildAgentsRangeDays(startDay: string, endDay: string): string[] {
  if (startDay > endDay) return [];
  const days: string[] = [];
  let day = startDay;
  // Your Agents currently supports Day and Week. The bound keeps malformed
  // input from turning a date loop into unbounded work.
  while (day <= endDay && days.length < 7) {
    days.push(day);
    day = shiftIsoDate(day, 1);
  }
  return days;
}

export function agentsBackfillDays(startDay: string, today = isoDayString(new Date())): number {
  // Count whole calendar days in UTC. A local-clock subtraction gains or loses
  // an hour across a DST boundary, which `Math.ceil` then turns into a whole
  // extra day; the dates here are calendar days, so they carry no local time.
  const start = Date.parse(`${startDay}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  const elapsedDays = Number.isNaN(start) || Number.isNaN(end)
    ? 0
    : Math.max(0, Math.round((end - start) / 86_400_000));
  return Math.min(MAX_BACKFILL_DAYS, Math.max(DEFAULT_BACKFILL_DAYS, elapsedDays + 1));
}

/**
 * Whether the range's ingest pass must finish before the range is drawn.
 *
 * Ingestion re-scans every registered repository with `git log --since`, and
 * commit collection has no watermark, so its cost scales with the window:
 * measured on 37 repositories, 30 days took 10s and 400 days took 46s.
 *
 * Only the current range needs freshly ingested data — that is where today's
 * still-running sessions and just-made commits live. A past range is already
 * settled in the database, so waiting on a full rescan before drawing it buys
 * nothing and blocks the view for as long as the scan runs. Past ranges read
 * what is stored and let the refresh land on a later visit.
 */
export function shouldAwaitBackfill(endDay: string, today = isoDayString(new Date())): boolean {
  return endDay >= today;
}

function sampleDaysFor(days: readonly string[]): readonly AgentsDaySource[] {
  const fallback = AGENTS_WEEK_FIXTURE[AGENTS_WEEK_FIXTURE.length - 1];
  if (!fallback) return days.map((day) => ({ day, attention: [], turns: [], commits: [] }));
  const fixtureStart = Math.max(0, AGENTS_WEEK_FIXTURE.length - days.length);
  return days.map((day, index) => ({
    ...(AGENTS_WEEK_FIXTURE[fixtureStart + index] ?? fallback),
    day,
  }));
}

export function buildAgentsLoadingDays(days: readonly string[]): readonly AgentsDaySource[] {
  return days.map((day) => ({ day, attention: [], turns: [], commits: [] }));
}

/** Minutes since the configured start of logical `day`. */
function minuteOfLogicalDay(iso: string, day: string, startOfDayMinutes: number): number | null {
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return null;
  const dayStart = logicalDayStartMs(day, startOfDayMinutes);
  if (Number.isNaN(dayStart)) return null;
  return (stamp.getTime() - dayStart) / 60000;
}

function clampSpan(start: number | null, end: number | null): SpanTuple | null {
  if (start === null || end === null) return null;
  const from = Math.max(0, start);
  const to = Math.min(24 * 60, end);
  if (to <= from) return null;
  return [Math.round(from * 10) / 10, Math.round(to * 10) / 10];
}

function repoLabelFor(repoKey: string, reposByKey: ReadonlyMap<string, string>): string {
  const path = reposByKey.get(repoKey);
  if (!path) return repoKey.slice(0, 8);
  const name = path.split("/").filter(Boolean).pop();
  return name ?? repoKey.slice(0, 8);
}

function toDaySource(
  day: string,
  payload: DevSignalsDayPayload,
  attention: readonly { startedAt: string; endedAt: string }[],
  reposByKey: ReadonlyMap<string, string>,
  startOfDayMinutes: number,
): AgentsDaySource {
  const attentionSpans: SpanTuple[] = [];
  for (const segment of attention) {
    const span = clampSpan(
      minuteOfLogicalDay(segment.startedAt, day, startOfDayMinutes),
      minuteOfLogicalDay(segment.endedAt, day, startOfDayMinutes),
    );
    if (span) attentionSpans.push(span);
  }

  const turns: TurnTuple[] = [];
  const tokensBySession = new Map<string, number>();
  for (const turn of payload.agentTurns) {
    const span = clampSpan(
      minuteOfLogicalDay(turn.startedAt, day, startOfDayMinutes),
      minuteOfLogicalDay(turn.endedAt, day, startOfDayMinutes),
    );
    // Unlike commits (whose repo is always registered), a turn's cwd may be a
    // deleted worktree or a non-repo directory; those stay unlabelled rather
    // than showing a hash prefix.
    const turnRepo = turn.cwdKey ? reposByKey.get(turn.cwdKey) : undefined;
    if (span) {
      turns.push([span[0], span[1], turn.provider, turnRepo ? (turnRepo.split("/").filter(Boolean).pop() ?? "") : "", turn.model ?? "", turn.totalTokens ?? 0]);
      // totalTokens is cumulative within a session; the session's figure is its max.
      tokensBySession.set(turn.sessionKey, Math.max(tokensBySession.get(turn.sessionKey) ?? 0, turn.totalTokens ?? 0));
    }
  }

  const commits: CommitTuple[] = [];
  for (const commit of payload.commits) {
    const minute = minuteOfLogicalDay(commit.authoredAt, day, startOfDayMinutes);
    if (minute === null || minute < 0 || minute >= 24 * 60) continue;
    commits.push([
      Math.round(minute * 10) / 10,
      commit.insertions,
      commit.deletions,
      commit.filesChanged,
      commit.commitSha,
      repoLabelFor(commit.repoKey, reposByKey),
    ]);
  }

  let tokens = 0;
  for (const value of tokensBySession.values()) tokens += value;
  return { day, attention: attentionSpans, turns, commits, tokens, sessions: tokensBySession.size };
}

export type AgentsDataState = {
  readonly days: readonly AgentsDaySource[];
  /** True while the requested range's tracker read is in flight. */
  readonly loading: boolean;
  /** True when the tracker answered; false means the fixture is on screen. */
  readonly live: boolean;
};

type StoredAgentsDataState = AgentsDataState & {
  /** Range that produced this state; prevents a prior range leaking into a new render. */
  readonly rangeKey: string;
};

export function useAgentsData(startDay: string, endDay: string, startOfDayMinutes = 0): AgentsDataState {
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const days = useMemo(() => buildAgentsRangeDays(startDay, endDay), [endDay, startDay]);
  const rangeKey = `${startDay}:${endDay}:${boundaryMinutes}`;
  const [state, setState] = useState<StoredAgentsDataState>(() => ({
    days: buildAgentsLoadingDays(days),
    loading: true,
    live: false,
    rangeKey,
  }));

  useEffect(() => {
    let cancelled = false;
    // Loading is its own state. Rendering the browser fixture here makes real
    // data briefly appear as `sample` every time the tab or range changes.
    setState({ days: buildAgentsLoadingDays(days), loading: true, live: false, rangeKey });

    async function load() {
      try {
        // Refresh ingestion so today's turns and commits are included. For a
        // past range the scan is started but not awaited: those days are
        // already stored, and blocking on a wide rescan would leave the user
        // staring at the previous range for the length of the scan.
        // Fail-soft either way: a sync error must not block reading what is
        // already in the tracker database.
        const sync = trackerClient.syncDevSignals(agentsBackfillDays(startDay)).catch(() => null);
        const logicalToday = logicalDayIsoDateForDate(new Date(), boundaryMinutes);
        if (shouldAwaitBackfill(endDay, logicalToday)) await sync;

        const repos: DevRepoRecord[] = await trackerClient.getDevRepos().catch(() => []);
        const reposByKey = new Map(repos.map((repo) => [repo.repo_key, repo.repo_path]));

        const payloads = await Promise.all(days.map(async (day) => {
          const query = getLogicalDayRange(day, day, boundaryMinutes);
          const [signals, attention] = await Promise.all([
            trackerClient.getDevSignals(query),
            trackerClient.getTimeline(query).catch(() => []),
          ]);
          return { day, signals, attention };
        }));

        if (cancelled) return;

        // No tracker bridge (browser dev server) answers null for every day;
        // date-shift the fixture so navigation remains reviewable and honest
        // about the selected range (the header marks it as sample data).
        if (payloads.every((entry) => entry.signals === null)) {
          setState({ days: sampleDaysFor(days), loading: false, live: false, rangeKey });
          return;
        }

        const sources = payloads.map(({ day, signals, attention }) => toDaySource(
          day,
          signals ?? { commits: [], agentTurns: [], agentSummary: { wallClockSeconds: 0, cumulativeSeconds: 0, concurrencyPeak: 0, parallelFactor: 0, spans: [] } },
          attention,
          reposByKey,
          boundaryMinutes,
        ));
        setState({ days: sources, loading: false, live: true, rangeKey });
      } catch {
        if (!cancelled) setState({ days: sampleDaysFor(days), loading: false, live: false, rangeKey });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [boundaryMinutes, days, endDay, rangeKey, startDay]);

  if (state.rangeKey !== rangeKey) {
    return { days: buildAgentsLoadingDays(days), loading: true, live: false };
  }
  return { days: state.days, loading: state.loading, live: state.live };
}
