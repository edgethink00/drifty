/**
 * The Breakdown side panel.
 *
 * Four layouts were built and compared before this one; the captures live in
 * .qa-captures/20260823-agents-breakdown-variants. What survived: the time
 * sentence leads, because it states the comparison the page exists for, then
 * the charts answer what ran it and where it landed, then the reference tiles.
 *
 * Everything is assembled from pieces the dashboard already ships, so this
 * panel inherits the day view's donut, stacked bar, and tile chrome rather
 * than defining its own.
 */

import { useMemo } from "react";

import type { FlowBlock } from "@drifty/domain";
import { CompactRingChart, type CompactRingEntry } from "../dashboard/CompactRingChart";
import { CompactClassificationBar } from "../dashboard/CompactClassificationBar";
import {
  agentModelRows,
  agentMinutesByRepo,
  buildAgentsWeekModel,
  type AgentsDayModel,
  type AgentsDaySource,
} from "./agentsPageModel";
import { formatHours } from "./devSignalsModel";
import { agentsSeriesColor, agentsSeriesColors } from "./agentsPalette";

type AgentsBreakdownProps = {
  readonly sources: readonly AgentsDaySource[];
  readonly dayModel: AgentsDayModel | null;
  readonly models: readonly AgentsDayModel[];
  readonly period: "Today" | "Week";
};

type AgentsModelSlice = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly minutes: number;
  readonly share: number;
};

type RepoBarEntry = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly totalSeconds: number;
  readonly ratio: number;
};

function buildModelSlices(sources: readonly AgentsDaySource[], limit = 6): AgentsModelSlice[] {
  return agentModelRows(sources).slice(0, limit).map((row, index) => ({
    key: row.model,
    label: row.model.split("/").pop() ?? row.model,
    color: agentsSeriesColor(index),
    minutes: row.cumulativeMinutes,
    share: row.shareOfCumulative,
  }));
}

/**
 * Slices worth drawing: anything that would render as "0.0h" after the
 * wall-clock rescale is legend noise, since its arc is invisible anyway. The
 * ring legend floors to one decimal of an hour, so the threshold is six
 * minutes — below that the row reads "0.0h" and says nothing.
 */
function visibleSlices(slices: readonly AgentsModelSlice[], wallClockMinutes: number): AgentsModelSlice[] {
  const cumulative = slices.reduce((sum, slice) => sum + slice.minutes, 0);
  if (cumulative <= 0) return [];
  const scale = wallClockMinutes / cumulative;
  return slices.filter((slice) => slice.minutes * scale >= 6);
}

/**
 * Model slices as ring entries, rescaled to wall-clock.
 *
 * Turn minutes are cumulative — parallel sessions double-count — so their sum
 * is several times the wall-clock hours the page headline states. Showing that
 * raw sum beside "Agents ran 12.7h" would put the two incomparable measures
 * side by side, which this feature's arithmetic contract forbids. Shares are
 * preserved; the durations are projected onto wall-clock so the donut's total
 * matches the headline.
 */
function toRingEntries(slices: readonly AgentsModelSlice[], wallClockMinutes: number): CompactRingEntry[] {
  const cumulative = slices.reduce((sum, slice) => sum + slice.minutes, 0);
  const scale = cumulative > 0 ? wallClockMinutes / cumulative : 0;
  return slices.map((slice) => ({
    key: slice.key,
    label: slice.label,
    color: slice.color,
    totalSeconds: Math.round(slice.minutes * scale * 60),
    ratio: cumulative > 0 ? slice.minutes / cumulative : 0,
    // Agent cells are synthesised, so there is no per-block drill-down.
    matchesBlock: (_block: FlowBlock) => false,
  }));
}

/**
 * Repo entries measured in agent time, not commits, so the bar splits the same
 * quantity the donut does — "where did the 12.7h go" from two angles. Colours
 * come from the shared palette by the same ranking the flow grid uses, so a
 * repo looks identical on the timeline and here.
 */
function useRepoEntries(
  sources: readonly AgentsDaySource[],
  wallClockMinutes: number,
  repoColors: ReadonlyMap<string, string>,
): RepoBarEntry[] {
  return useMemo(() => {
    const byRepo = [...agentMinutesByRepo(sources).entries()].sort((a, b) => b[1] - a[1]);
    const cumulative = byRepo.reduce((sum, [, minutes]) => sum + minutes, 0);
    const scale = cumulative > 0 ? wallClockMinutes / cumulative : 0;
    return byRepo.slice(0, 6).map(([repo, minutes], index) => ({
      key: repo,
      label: repo,
      color: repoColors.get(repo) ?? agentsSeriesColor(index),
      totalSeconds: Math.round(minutes * scale * 60),
      ratio: cumulative > 0 ? minutes / cumulative : 0,
    }));
  }, [sources, wallClockMinutes, repoColors]);
}

export function AgentsBreakdownComposed({ sources, dayModel, models, period }: AgentsBreakdownProps) {
  const week = useMemo(() => buildAgentsWeekModel(models), [models]);
  const agentMinutes = period === "Today" ? dayModel?.agentMinutes ?? 0 : week.agentMinutes;
  const slices = useMemo(() => buildModelSlices(sources), [sources]);
  const ringEntries = useMemo(
    () => toRingEntries(visibleSlices(slices, agentMinutes), agentMinutes),
    [slices, agentMinutes],
  );
  const ringSeconds = ringEntries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  const repoColors = useMemo(
    () => agentsSeriesColors([...agentMinutesByRepo(sources).entries()].sort((a, b) => b[1] - a[1]).map(([repo]) => repo)),
    [sources],
  );
  const repoEntries = useRepoEntries(sources, agentMinutes, repoColors);
  const repoSeconds = repoEntries.reduce((sum, entry) => sum + entry.totalSeconds, 0);

  const attentionMinutes = period === "Today" ? dayModel?.attentionMinutes ?? 0 : week.attentionMinutes;
  const unattendedMinutes = period === "Today" ? dayModel?.unattendedMinutes ?? 0 : 0;
  const ratio = attentionMinutes > 0 ? agentMinutes / attentionMinutes : 0;
  const keyboardLabel = period === "Today" ? "at the keyboard" : "at the keyboard this week";

  return (
    <>
      <section className="agents-story agents-story--lead">
        <span className="label-mono">How much ran</span>
        <strong className="agents-story__value">{formatHours(agentMinutes)}</strong>
        <p className="agents-story__detail">
          {ratio > 0 ? `${ratio.toFixed(1)}× your ${formatHours(attentionMinutes)} ${keyboardLabel}` : "No captured attention to compare"}
        </p>
        <div className="agents-story__meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (attentionMinutes / Math.max(1, agentMinutes)) * 100)}%` }} />
        </div>
        {unattendedMinutes > 0 ? (
          <p className="agents-story__detail">{formatHours(unattendedMinutes)} ran with nobody watching</p>
        ) : null}
      </section>

      <CompactRingChart
        title="Models"
        entries={ringEntries}
        totalSeconds={ringSeconds}
        centerPercent={Math.round(slices[0]?.share ?? 0)}
        flowBlocks={[]}
        appIcons={{}}
      />
      <CompactClassificationBar
        title="Repos"
        ariaLabel="Repository share of agent time"
        entries={repoEntries}
        totalSeconds={repoSeconds}
        getKey={(entry) => entry.key}
        getLabel={(entry) => entry.label}
        getColor={(entry) => entry.color}
        getDotClassName={() => ""}
        getAppBreakdown={() => []}
        appIcons={{}}
        visibleLimit={4}
      />
    </>
  );
}
