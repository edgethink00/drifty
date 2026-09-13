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
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { CompactRingChart, type CompactRingEntry } from "../dashboard/CompactRingChart";
import { CompactClassificationBar } from "../dashboard/CompactClassificationBar";
import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";
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

function formatAgentDuration(minutes: number, language: DisplayLanguage): string {
  return language === "ko"
    ? formatLocalizedCompactDurationFromSeconds(Math.round(minutes * 60), language)
    : formatHours(minutes);
}

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
 * Slices worth drawing: the ring legend floors to one decimal of an hour, so
 * anything below six cumulative minutes would read "0.0h" and add noise.
 */
function visibleSlices(slices: readonly AgentsModelSlice[]): AgentsModelSlice[] {
  return slices.filter((slice) => slice.minutes >= 6);
}

/**
 * Model slices use cumulative turn time, matching the page's agent-hours
 * headline: four one-hour agents contribute four hours to the ring.
 */
function toRingEntries(slices: readonly AgentsModelSlice[]): CompactRingEntry[] {
  const cumulative = slices.reduce((sum, slice) => sum + slice.minutes, 0);
  return slices.map((slice) => ({
    key: slice.key,
    label: slice.label,
    color: slice.color,
    totalSeconds: Math.round(slice.minutes * 60),
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
  repoColors: ReadonlyMap<string, string>,
): RepoBarEntry[] {
  return useMemo(() => {
    const byRepo = [...agentMinutesByRepo(sources).entries()].sort((a, b) => b[1] - a[1]);
    const cumulative = byRepo.reduce((sum, [, minutes]) => sum + minutes, 0);
    return byRepo.slice(0, 6).map(([repo, minutes], index) => ({
      key: repo,
      label: repo,
      color: repoColors.get(repo) ?? agentsSeriesColor(index),
      totalSeconds: Math.round(minutes * 60),
      ratio: cumulative > 0 ? minutes / cumulative : 0,
    }));
  }, [sources, repoColors]);
}

export function AgentsBreakdownComposed({ sources, dayModel, models, period }: AgentsBreakdownProps) {
  const { effectiveLanguage, t } = useLocalization();
  const week = useMemo(() => buildAgentsWeekModel(models), [models]);
  const cumulativeMinutes = period === "Today" ? dayModel?.cumulativeMinutes ?? 0 : week.cumulativeMinutes;
  const wallClockMinutes = period === "Today" ? dayModel?.wallClockMinutes ?? 0 : week.wallClockMinutes;
  const concurrencyPeak = period === "Today"
    ? dayModel?.concurrencyPeak ?? 0
    : Math.max(0, ...models.map((model) => model.concurrencyPeak));
  const slices = useMemo(() => buildModelSlices(sources), [sources]);
  const ringEntries = useMemo(
    () => toRingEntries(visibleSlices(slices)),
    [slices],
  );
  const ringSeconds = ringEntries.reduce((sum, entry) => sum + entry.totalSeconds, 0);
  const repoColors = useMemo(
    () => agentsSeriesColors([...agentMinutesByRepo(sources).entries()].sort((a, b) => b[1] - a[1]).map(([repo]) => repo)),
    [sources],
  );
  const repoEntries = useRepoEntries(sources, repoColors);
  const repoSeconds = repoEntries.reduce((sum, entry) => sum + entry.totalSeconds, 0);

  const attentionMinutes = period === "Today" ? dayModel?.attentionMinutes ?? 0 : week.attentionMinutes;
  const unattendedMinutes = period === "Today" ? dayModel?.unattendedMinutes ?? 0 : week.unattendedMinutes;
  const ratio = attentionMinutes > 0 ? cumulativeMinutes / attentionMinutes : 0;

  return (
    <>
      <section className="agents-story agents-story--lead">
        <span className="label-mono">{t("agents.breakdown.howMuch")}</span>
        <strong className="agents-story__value">{formatAgentDuration(cumulativeMinutes, effectiveLanguage)}</strong>
        <p className="agents-story__detail">
          {ratio > 0
            ? t(period === "Today" ? "agents.breakdown.attentionDay" : "agents.breakdown.attentionWeek", {
                ratio: ratio.toFixed(1),
                duration: formatAgentDuration(attentionMinutes, effectiveLanguage),
              })
            : t("agents.breakdown.noAttention")}
        </p>
        <p className="agents-story__detail">
          {t("agents.breakdown.elapsed", {
            duration: formatAgentDuration(wallClockMinutes, effectiveLanguage),
            count: concurrencyPeak,
          })}
        </p>
        <div className="agents-story__meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (attentionMinutes / Math.max(1, cumulativeMinutes)) * 100)}%` }} />
        </div>
        {unattendedMinutes > 0 ? (
          <p className="agents-story__detail">{t("agents.breakdown.unattended", { duration: formatAgentDuration(unattendedMinutes, effectiveLanguage) })}</p>
        ) : null}
      </section>

      <CompactRingChart
        title={t("agents.breakdown.models")}
        entries={ringEntries}
        totalSeconds={ringSeconds}
        centerPercent={Math.round(slices[0]?.share ?? 0)}
        flowBlocks={[]}
        appIcons={{}}
        language={effectiveLanguage}
      />
      <CompactClassificationBar
        title={t("agents.breakdown.repos")}
        ariaLabel={t("agents.breakdown.repoShareAria")}
        entries={repoEntries}
        totalSeconds={repoSeconds}
        getKey={(entry) => entry.key}
        getLabel={(entry) => entry.label}
        getColor={(entry) => entry.color}
        getDotClassName={() => ""}
        getAppBreakdown={() => []}
        appIcons={{}}
        visibleLimit={4}
        language={effectiveLanguage}
      />
    </>
  );
}
