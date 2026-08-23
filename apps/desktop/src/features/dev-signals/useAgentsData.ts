/**
 * Data loading for the Your Agents tab.
 *
 * In the Tauri app the tab reads the tracker: one get_dev_signals call per day
 * (commits + agent turns) and one timeline call per day (attention), with a
 * sync_dev_signals pass first so the numbers are fresh. Outside Tauri, or when
 * the tracker returns nothing at all, the real-week fixture keeps the surface
 * reviewable in a browser.
 *
 * Times land as minutes since local midnight because that is the unit both
 * views draw in; conversion happens here once, not in the components.
 */

import { useEffect, useMemo, useState } from "react";

import type { DevRepoRecord, DevSignalsDayPayload } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import type { AgentsDaySource, CommitTuple, SpanTuple, TurnTuple } from "./agentsPageModel";
import { AGENTS_WEEK_FIXTURE } from "./agentsWeekFixture";

const WEEK_DAYS = 7;

function isoDayString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

function lastNDays(count: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    days.push(isoDayString(date));
  }
  return days;
}

/** Minutes since local midnight of `day`, clamped to the day. */
function minuteOfDay(iso: string, day: string): number | null {
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return null;
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  if (!year || !month || !dayOfMonth) return null;
  const midnight = new Date(year, month - 1, dayOfMonth);
  return (stamp.getTime() - midnight.getTime()) / 60000;
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
): AgentsDaySource {
  const attentionSpans: SpanTuple[] = [];
  for (const segment of attention) {
    const span = clampSpan(minuteOfDay(segment.startedAt, day), minuteOfDay(segment.endedAt, day));
    if (span) attentionSpans.push(span);
  }

  const turns: TurnTuple[] = [];
  const tokensBySession = new Map<string, number>();
  for (const turn of payload.agentTurns) {
    const span = clampSpan(minuteOfDay(turn.startedAt, day), minuteOfDay(turn.endedAt, day));
    // Unlike commits (whose repo is always registered), a turn's cwd may be a
    // deleted worktree or a non-repo directory; those stay unlabelled rather
    // than showing a hash prefix.
    const turnRepo = turn.cwdKey ? reposByKey.get(turn.cwdKey) : undefined;
    if (span) turns.push([span[0], span[1], turn.provider, turnRepo ? (turnRepo.split("/").filter(Boolean).pop() ?? "") : "", turn.model ?? "", turn.totalTokens ?? 0]);
    // totalTokens is cumulative within a session; the session's figure is its max.
    tokensBySession.set(turn.sessionKey, Math.max(tokensBySession.get(turn.sessionKey) ?? 0, turn.totalTokens ?? 0));
  }

  const commits: CommitTuple[] = [];
  for (const commit of payload.commits) {
    const minute = minuteOfDay(commit.authoredAt, day);
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
  /** True while the first tracker read is in flight. */
  readonly loading: boolean;
  /** True when the tracker answered; false means the fixture is on screen. */
  readonly live: boolean;
};

export function useAgentsData(): AgentsDataState {
  const [state, setState] = useState<AgentsDataState>({ days: AGENTS_WEEK_FIXTURE, loading: true, live: false });
  const days = useMemo(() => lastNDays(WEEK_DAYS), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Refresh ingestion first so today's turns and commits are included.
        // Fail-soft: a sync error must not block reading what is already there.
        await trackerClient.syncDevSignals().catch(() => null);

        const repos: DevRepoRecord[] = await trackerClient.getDevRepos().catch(() => []);
        const reposByKey = new Map(repos.map((repo) => [repo.repo_key, repo.repo_path]));

        const payloads = await Promise.all(days.map(async (day) => {
          const [signals, attention] = await Promise.all([
            trackerClient.getDevSignals({ day }),
            trackerClient.getTimeline({ day }).catch(() => []),
          ]);
          return { day, signals, attention };
        }));

        if (cancelled) return;

        // No tracker bridge (browser dev server) answers null for every day;
        // keep the fixture so the surface stays reviewable.
        if (payloads.every((entry) => entry.signals === null)) {
          setState({ days: AGENTS_WEEK_FIXTURE, loading: false, live: false });
          return;
        }

        const sources = payloads.map(({ day, signals, attention }) => toDaySource(
          day,
          signals ?? { commits: [], agentTurns: [], agentSummary: { wallClockSeconds: 0, cumulativeSeconds: 0, concurrencyPeak: 0, parallelFactor: 0, spans: [] } },
          attention,
          reposByKey,
        ));
        setState({ days: sources, loading: false, live: true });
      } catch {
        if (!cancelled) setState({ days: AGENTS_WEEK_FIXTURE, loading: false, live: false });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return state;
}
