/**
 * Your Agents — a sibling of Your Day, built from Your Day's own grammar.
 *
 * An earlier pass composed this page out of the Trends vocabulary (eyebrow
 * panels, a top KPI strip, a segmented range switch in the title row) and it
 * read as a foreign surface. This version reuses the day view's actual
 * skeleton, so the two pages feel like siblings:
 *
 *   - the "Focused for Xh" headline pattern → "Agents ran Xh"
 *   - day-split main column + the shared Breakdown side panel, with the
 *     summary tiles living in the side panel exactly like the day breakdown
 *   - the timeline as a flow-chart-card, sharing the flow chart's axis and
 *     legend chrome
 *   - repositories in the AppUsagePanel list grammar: featured leader, ranked
 *     rows, share meters
 *
 * Signal channels are unchanged: agent time is a hatch (duration), commits
 * are ticks (events), attention is solid fill, wall-clock only next to
 * attention.
 */

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { FLOW_INTERVAL_OPTIONS, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { MetricTile } from "../../components/MetricTile";
import { clockHourForLogicalHour } from "../../lib/formatting";
import { BreakdownSidePanel } from "../dashboard/BreakdownSidePanelChrome";
import { persistDashboardBreakdownOpen, resolveInitialDashboardBreakdownOpen } from "../settings/settingsStorage";
import { FlowChartGrid } from "../flow-chart/FlowChartGrid";
import { FlowChartLegend } from "../flow-chart/FlowChartLegend";
import type { ProjectLegendEntry } from "../flow-chart/projectFlowView";
import { formatHourLabel } from "../flow-chart/flowChartFormat";
import { FOCUS_DRIFT_GRID_PATH } from "../dashboard/focusDriftChart";
import { FOCUS_DRIFT_CHART_BOUNDS, buildSmoothPath } from "../dashboard/focusDriftGeometry";
import {
  buildAgentsDayModel,
  buildAgentsWeekModel,
  buildAgentsGridCells,
  gridRepoLegend,
  repoDominantProviders,
  agentModelRows,
  agentsHourHistogram,
  agentsInsightNumbers,
  formatTokens,
  type AgentsDayModel,
  type AgentsRepoRow,
} from "./agentsPageModel";
import type { AgentsDaySource } from "./agentsPageModel";
import { formatClock, formatHours, mergeForDisplay } from "./devSignalsModel";
import { useAgentsData } from "./useAgentsData";
import { AGENTS_UNKNOWN_COLOR, agentsSeriesColors } from "./agentsPalette";
import {
  AgentsBreakdownComposed,
} from "./AgentsBreakdown";
import "./agents-page.css";

export type AgentsPeriod = "Today" | "Week";
export type AgentsGridColorMode = "intensity" | "repo";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/* FlowChartView's cell-height constants, reproduced exactly so the agents grid
   is dimensionally identical to Your Day's chart at every interval. */
const BASE_FLOW_CELL_INTERVAL_MINUTES = 3;
const FLOW_CELL_BASE_MIN_HEIGHT_REM = 0.5;
const FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM = 0.76;


/* Agent tool identity: display name + glyph colour per provider key.

   These stay literal rather than joining the shared series palette: they are
   brand recognition, not series encoding. An app icon in App usage is the
   product's own colour, and a Codex row should be Codex green on every day
   regardless of how the repos happened to rank. */
const AGENT_TOOLS: Record<string, { name: string; color: string }> = {
  codex: { name: "Codex", color: "#10a37f" },
  claude: { name: "Claude Code", color: "#d97757" },
  opencode: { name: "OpenCode", color: "#5b8def" },
  gemini: { name: "Gemini CLI", color: "#4285f4" },
};

function agentToolName(provider: string): string {
  return AGENT_TOOLS[provider]?.name ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

function agentToolColor(provider: string): string {
  return AGENT_TOOLS[provider]?.color ?? AGENTS_UNKNOWN_COLOR;
}

/** Compact model label: strip vendor prefixes ("anthropic/claude-x" → "claude-x"). */
function shortModelName(model: string): string {
  const tail = model.split("/").pop() ?? model;
  return tail;
}

/**
 * The identity icon for a repo row: the agent tool that worked that repo.
 * Repos have no icon asset of their own (unlike apps), and the agent that ran
 * there is the identity the user recognises — Codex green, Claude terracotta —
 * rendered as the standard app-glyph so it sits exactly where app icons sit.
 */
function AgentToolGlyph({ provider, fallbackName, size }: { readonly provider: string | undefined; readonly fallbackName: string; readonly size: "sm" | "md" }) {
  if (!provider) {
    // No agent ran here (or its worktree is gone): fall back to the repo's own
    // initials, the way apps without icons fall back in App usage.
    return <AppGlyph appName={fallbackName} iconSrc={null} size={size} />;
  }
  return (
    <span className={`app-glyph app-glyph--${size}`} style={{ "--app-glyph-color": agentToolColor(provider) } as CSSProperties} aria-hidden="true">
      <span>{agentToolName(provider).slice(0, 2)}</span>
    </span>
  );
}

/* Concurrency → tone, expressed with the chart's own tokens so both themes
   follow. ×1 is pale, ×5 saturates to the flow chart's focus green. */
function intensityColor(level: number): string {
  const mix = [0, 30, 50, 68, 84, 100][Math.min(5, Math.max(1, level))] ?? 100;
  if (mix >= 100) return "var(--productivity-focus)";
  return `color-mix(in srgb, var(--productivity-focus) ${mix}%, var(--flow-chart-plot-surface))`;
}

type ShareStyle = CSSProperties & { "--app-usage-share": string };

function formatDayLabel(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  if (!year || !month || !dayOfMonth) return day;
  return new Date(year, month - 1, dayOfMonth).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatShortDate(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  if (!year || !month || !dayOfMonth) return day;
  return new Date(year, month - 1, dayOfMonth).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatChurn(insertions: number, deletions: number): string {
  return `+${insertions.toLocaleString()} −${deletions.toLocaleString()}`;
}

function shareOfCommits(repo: AgentsRepoRow, totalCommits: number): number {
  if (totalCommits <= 0) return 0;
  return Math.min(100, (repo.commitCount / totalCommits) * 100);
}

/**
 * The flow chart's own head: the same seg controls (flow-color-mode-control /
 * flow-interval-control) and the same project-legend chips, fed with agent
 * vocabulary. Nothing here introduces a control style the day view lacks.
 */
function AgentsTimelineHead({ colorMode, intervalMinutes, legendEntries, onColorModeChange, onIntervalChange }: {
  readonly colorMode: AgentsGridColorMode;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly legendEntries: readonly ProjectLegendEntry[];
  readonly onColorModeChange: (mode: AgentsGridColorMode) => void;
  readonly onIntervalChange: (interval: FlowIntervalMinutes) => void;
}) {
  const hoveredLegendCardRef = { current: null };
  return (
    <div className="flow-chart-head">
      <div className="flow-chart-head__actions">
        <div className="seg flow-color-mode-control" aria-label="Agents color mode">
          {([["intensity", "Intensity"], ["repo", "Project"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={colorMode === id ? "on" : undefined}
              aria-pressed={colorMode === id}
              onClick={() => onColorModeChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="seg flow-interval-control" aria-label="Timeline interval">
          {FLOW_INTERVAL_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === intervalMinutes ? "on" : undefined}
              aria-pressed={option === intervalMinutes}
              onClick={() => onIntervalChange(option)}
            >
              {option}m
            </button>
          ))}
        </div>
        <FlowChartLegend
          blocks={[]}
          colorMode="project"
          hoveredLegendCardRef={hoveredLegendCardRef}
          setHoveredLegend={() => undefined}
          projectLegend={legendEntries}
        />
      </div>
    </div>
  );
}

/**
 * The 24-hour timeline as a flow-chart-card: same axis row, same gutter token,
 * same card chrome (top border, spacing) the day view's chart uses.
 */
function AgentsDayTimeline({ model, source }: { readonly model: AgentsDayModel; readonly source: AgentsDaySource }) {
  const [colorMode, setColorMode] = useState<AgentsGridColorMode>("intensity");
  const [intervalMinutes, setIntervalMinutes] = useState<FlowIntervalMinutes>(3);
  const gridCells = useMemo(() => buildAgentsGridCells(source, intervalMinutes), [source, intervalMinutes]);
  const repoLegend = useMemo(() => gridRepoLegend(gridCells), [gridCells]);
  // Ranked by grid dominance, coloured from the shared series palette so the
  // same repo carries the same colour into the Breakdown charts.
  const repoColors = useMemo(() => agentsSeriesColors(repoLegend), [repoLegend]);

  // The grid is the real FlowChartGrid: agent cells become FlowBlocks whose
  // projectColor carries the tone (concurrency tone in intensity mode, repo
  // colour in repo mode), rendered in the chart's project colour mode. The
  // chart, not this page, owns cell geometry, seams, axis, and the label rail.
  const gridBlocks = useMemo(() => {
    const byCell = new Map<string, FlowBlock>();
    for (const cell of gridCells.values()) {
      const color = colorMode === "repo"
        ? (cell.topRepo ? repoColors.get(cell.topRepo) ?? AGENTS_UNKNOWN_COLOR : AGENTS_UNKNOWN_COLOR)
        : intensityColor(cell.concurrency);
      byCell.set(`${cell.minuteOfDay}`, {
        id: `agent-${cell.minuteOfDay}`,
        day: model.day,
        hour: Math.floor(cell.minuteOfDay / 60),
        quarter: 0,
        minuteOfDay: cell.minuteOfDay,
        appName: cell.topRepo ?? "Agents",
        category: "workspace",
        productivity: "focus",
        durationSeconds: intervalMinutes * 60,
        projectId: cell.topRepo,
        projectColor: color,
      } as FlowBlock);
    }
    return byCell;
  }, [gridCells, colorMode, repoColors, model.day, intervalMinutes]);

  const legendEntries = useMemo<ProjectLegendEntry[]>(() => {
    if (colorMode === "repo") {
      return repoLegend.slice(0, 5).map((repo) => ({ projectId: repo, name: repo, color: repoColors.get(repo) ?? AGENTS_UNKNOWN_COLOR }));
    }
    return [1, 2, 3, 5].map((level) => ({
      projectId: `x${level}`,
      name: `×${level}${level === 5 ? "+" : ""}`,
      color: intensityColor(level),
    }));
  }, [colorMode, repoLegend, repoColors]);

  return (
    /* Same bordered chart box the day view wraps its flow chart in — without
       it the card reads as cut off at the top and glued to the next panel. */
    <div className="flow-breakdown-layout flow-breakdown-layout--full">
      <div className="flow-breakdown-layout__chart">
        {/* The card carries FlowChartView's exact style contract — all four
            CSS variables plus the data attributes — so every flow-chart.css
            rule (cell heights inside the breakdown box included) applies
            unchanged. */}
        <section
          className="flow-chart-card agents-flow-card"
          aria-label="Agent and attention timeline"
          data-flow-interval={intervalMinutes}
          data-flow-color-mode="project"
          style={{
            "--flow-cell-min-height": `${(FLOW_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
            "--flow-breakdown-cell-min-height": `${(FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
            "--flow-minute-axis-font-size": intervalMinutes === 3 ? "0.52rem" : "0.58rem",
            "--flow-row-count": `${60 / intervalMinutes}`,
          } as CSSProperties}
        >
          <AgentsTimelineHead
            colorMode={colorMode}
            intervalMinutes={intervalMinutes}
            legendEntries={legendEntries}
            onColorModeChange={setColorMode}
            onIntervalChange={setIntervalMinutes}
          />
          <FlowChartGrid
            blockByCell={gridBlocks}
            boundaryMinutes={0}
            colorMode="project"
            currentHourIndex={null}
            currentMinuteOffset={null}
            hoverGroupsByCell={new Map()}
            intervalMinutes={intervalMinutes}
            setFlowGridElement={() => undefined}
          />
        </section>
      </div>
    </div>
  );
}


/**
 * Repositories in the app-usage panel grammar: the leading repo gets the
 * feature treatment, the rest become ranked rows with share meters. Share is
 * share of commits, mirroring how app usage shows share of tracked time.
 */
function RepoUsagePanel({ repos, totalCommits, showActive, periodLabel, repoProviders }: {
  readonly repos: readonly AgentsRepoRow[];
  readonly totalCommits: number;
  readonly showActive: boolean;
  readonly periodLabel: string;
  /** repo → agent provider that dominated it; drives the row icon. */
  readonly repoProviders: ReadonlyMap<string, string>;
}) {
  const [featured, ...rest] = repos;

  if (!featured) {
    return (
      <section className="app-usage-panel editorial-panel editorial-panel--soft" aria-label={`Repository activity for ${periodLabel}`}>
        <div className="app-usage-empty empty-state">
          <span className="eyebrow">No commits</span>
          <strong>No repository activity</strong>
          <p>Commits will appear here once repositories with activity are found.</p>
        </div>
      </section>
    );
  }

  const featuredShare = shareOfCommits(featured, totalCommits);

  return (
    <section className="app-usage-panel editorial-panel editorial-panel--soft" aria-label={`Repository activity for ${periodLabel}`}>
      <div className="app-usage-content">
        <article
          className="app-usage-feature"
          style={{ "--app-usage-share": `${featuredShare}%` } as ShareStyle}
          aria-label={`Most active repository: ${featured.repo}`}
        >
          <div className="app-usage-feature__topline">
            <div className="app-usage-feature__identity">
              <span className="usage-identity-icon usage-identity-icon--md">
                <AgentToolGlyph provider={repoProviders.get(featured.repo)} fallbackName={featured.repo} size="md" />
              </span>
              <div>
                <span className="app-usage-kicker">Most active repo</span>
                <div className="app-usage-feature__title">
                  <span className="app-usage-rank app-usage-rank--inline" aria-label="Rank 1">#1</span>
                  <strong>{featured.repo}</strong>
                </div>
                <p>{showActive ? `Active ${formatClock(featured.firstCommitMin)}–${formatClock(featured.lastCommitMin)}` : `Across ${periodLabel}`}</p>
              </div>
            </div>
            <div className="app-usage-feature__measure">
              <strong>{featured.commitCount} commits</strong>
            </div>
          </div>
          <div className="app-usage-feature__meter-block">
            <div className="app-usage-feature__meter-copy">
              <span>Share</span>
              <strong>{Math.round(featuredShare)}%</strong>
            </div>
            <div className="app-usage-feature__meter" aria-label={`${featured.repo} accounts for ${Math.round(featuredShare)}% of commits`}>
              <span />
            </div>
          </div>
          <dl className="app-usage-feature__stats">
            <div><dt>Commits</dt><dd>{featured.commitCount}</dd></div>
            <div><dt>Added</dt><dd>+{featured.insertions.toLocaleString()}</dd></div>
            <div><dt>Removed</dt><dd>−{featured.deletions.toLocaleString()}</dd></div>
          </dl>
        </article>

        {rest.length > 0 ? (
          <ol className="app-usage-list" aria-label="Ranked repository activity">
            {rest.map((repo, index) => {
              const share = shareOfCommits(repo, totalCommits);
              return (
                <li className="app-usage-row" key={repo.repo}>
                  <div className="app-usage-rank" aria-label={`Rank ${index + 2}`}>
                    {String(index + 2).padStart(2, "0")}
                  </div>
                  <div className="app-usage-row__main">
                    <span className="usage-identity-icon usage-identity-icon--sm">
                      <AgentToolGlyph provider={repoProviders.get(repo.repo)} fallbackName={repo.repo} size="sm" />
                    </span>
                    <div className="app-usage-row__copy">
                      <div className="app-usage-row__title"><strong>{repo.repo}</strong></div>
                      <small>{showActive ? `Active ${formatClock(repo.firstCommitMin)}–${formatClock(repo.lastCommitMin)}` : formatChurn(repo.insertions, repo.deletions)}</small>
                    </div>
                  </div>
                  <div className="app-usage-row__bar" aria-label={`${repo.repo} accounts for ${Math.round(share)}% of commits`}>
                    <span style={{ "--app-usage-share": `${share}%` } as ShareStyle} />
                  </div>
                  <div className="app-usage-row__figures">
                    <strong>{repo.commitCount}</strong>
                    <span>{Math.round(share)}% · {formatChurn(repo.insertions, repo.deletions)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The Week view follows the existing week system: the week-v2 calendar's
 * bordered panel, sticky day head, hour rail, and event blocks — with agent
 * stretches as the events (focus tone) and commit counts in the day head.
 * Geometry classes come from week-dashboard.css untouched; the hour range is
 * fixed 0–24 because agent work does not respect working hours.
 */
const AGENTS_WEEK_HOUR_HEIGHT = 30;

function AgentsWeekCalendar({ models, sources }: {
  readonly models: readonly AgentsDayModel[];
  readonly sources: readonly AgentsDaySource[];
}) {
  const week = useMemo(() => buildAgentsWeekModel(models), [models]);
  const spansByDay = useMemo(() => {
    const map = new Map<string, { start: number; end: number }[]>();
    for (const source of sources) {
      const merged = mergeForDisplay(mergeSpansForDay(source), 10);
      map.set(source.day, merged);
    }
    return map;
  }, [sources]);

  return (
    <section className="week-v2-calendar editorial-panel editorial-panel--soft agents-week-calendar" aria-label="Agent week calendar">
      <div className="week-v2-calendar__legend" aria-label="Agents week legend">
        <div className="flow-chart-head__actions">
          <div className="flow-chart-legend flow-chart-legend--project">
            <span className="flow-chart-legend__group flow-chart-legend__group--project">
              <span className="flow-chart-legend__parent flow-chart-legend__parent--tone">
                <span className="flow-chart-legend__tone-dot" style={{ "--flow-legend-tone": "var(--productivity-focus)" } as CSSProperties} />
                Agent time
              </span>
            </span>
          </div>
        </div>
      </div>
      <div className="week-v2-calendar__scroller agents-week-calendar__scroller">
        <div className="week-v2-calendar__day-head" aria-hidden="true">
          <span />
          {week.days.map((day) => {
            const [, , dayOfMonth] = day.day.split("-").map(Number);
            const isWeekend = day.weekdayLabel === "Sun" || day.weekdayLabel === "Sat";
            return (
              <span className={isWeekend ? "is-weekend" : undefined} key={day.day}>
                <strong>{day.weekdayLabel}</strong>
                <small>{dayOfMonth}</small>
              </span>
            );
          })}
        </div>
        <div className="week-v2-calendar__body" style={{ height: `${24 * AGENTS_WEEK_HOUR_HEIGHT}px` }}>
          <div className="week-v2-calendar__time-rail">
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} style={{ top: `${hour * AGENTS_WEEK_HOUR_HEIGHT}px` }}>{formatHourLabel(clockHourForLogicalHour(hour, 0))}</span>
            ))}
          </div>
          {week.days.map((day) => {
            const spans = spansByDay.get(day.day) ?? [];
            return (
              <div className="week-v2-calendar__day-column" key={day.day}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <span className="week-v2-calendar__line" key={`${day.day}-${hour}`} style={{ top: `${hour * AGENTS_WEEK_HOUR_HEIGHT}px` }} />
                ))}
                {spans.map((span, index) => {
                  const heightPx = Math.max(4, ((span.end - span.start) / 60) * AGENTS_WEEK_HOUR_HEIGHT);
                  const isShort = heightPx < 18;
                  return (
                    <article
                      key={index}
                      className={`week-v2-calendar__event week-v2-calendar__event--focus${isShort ? " week-v2-calendar__event--short week-v2-calendar__event--tiny" : ""}`}
                      style={{
                        top: `${(span.start / 60) * AGENTS_WEEK_HOUR_HEIGHT}px`,
                        height: `${heightPx}px`,
                        left: "4px",
                        width: "calc(100% - 8px)",
                        "--event-tone": "var(--productivity-focus)",
                      } as CSSProperties}
                      title={`${formatClock(span.start)}–${formatClock(span.end)} · ${formatHours(span.end - span.start)} agents`}
                    >
                      {!isShort ? <strong>{formatHours(span.end - span.start)}</strong> : null}
                    </article>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="agents-week-calendar__foot" aria-label="Daily agent totals">
        <span />
        {week.days.map((day) => (
          <span key={day.day} className="agents-week-calendar__foot-cell">
            <strong>{formatHours(day.agentMinutes)}</strong>
            <small>{day.commitCount > 0 ? `${day.commitCount}c` : ""}</small>
          </span>
        ))}
      </div>
    </section>
  );
}

/** Merged agent spans for one day, minutes since midnight. */
function mergeSpansForDay(source: AgentsDaySource): { start: number; end: number }[] {
  return source.turns
    .map((turn) => ({ start: turn[0], end: turn[1] }))
    .filter((span) => span.end > span.start);
}

/** Summary tiles for the Breakdown side panel, like the day breakdown tiles. */
function AgentsBreakdownTiles({ period, dayModel, models }: {
  readonly period: AgentsPeriod;
  readonly dayModel: AgentsDayModel | null;
  readonly models: readonly AgentsDayModel[];
}) {
  if (period === "Today" && dayModel) {
    return (
      <div className="kpi-row kpi-row--insights insight-summary" aria-label="Agent summary">
        <MetricTile label="Agents" value={formatHours(dayModel.agentMinutes)} detail={dayModel.parallelFactor > 1 ? `×${dayModel.parallelFactor} parallel` : "wall-clock"} />
        <MetricTile label="You" value={formatHours(dayModel.attentionMinutes)} detail="attention" />
        <MetricTile label="Unattended" value={formatHours(dayModel.unattendedMinutes)} detail="agents ran alone" />
        <MetricTile label="Commits" value={String(dayModel.commitCount)} detail={`${dayModel.repos.length} repo${dayModel.repos.length === 1 ? "" : "s"}`} />
      </div>
    );
  }
  const week = buildAgentsWeekModel(models);
  const peakDay = week.days.reduce((best, day) => (day.agentMinutes > best.agentMinutes ? day : best), week.days[0] ?? { day: "", weekdayLabel: "—", agentMinutes: 0, attentionMinutes: 0, commitCount: 0 });
  return (
    <div className="kpi-row kpi-row--insights insight-summary" aria-label="Agent week summary">
      <MetricTile label="Agents" value={formatHours(week.agentMinutes)} detail="wall-clock" />
      <MetricTile label="You" value={formatHours(week.attentionMinutes)} detail="attention" />
      <MetricTile label="Commits" value={String(week.commitCount)} detail={`${week.repos.length} repos`} />
      <MetricTile label="Peak day" value={formatHours(peakDay.agentMinutes)} detail={peakDay.weekdayLabel} />
    </div>
  );
}


/**
 * Proposal panel 2 — headline numbers grid, in the FocusDriftSummaryTiles
 * grammar (kpi-row of MetricTiles). Ten agent-specific figures the summary
 * tiles have no room for.
 */
type AgentsStatEntry = {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
};

/**
 * Reference numbers as a mono stat list — one format step below the summary
 * tiles, so the side panel reads headline tiles → models bars → detail rows
 * instead of the same tile grid twice. Rows share the models list's type
 * scale and the label-mono/insight-panel-head chrome.
 */
/**
 * Detail figures in the dashboard's own tile grammar.
 *
 * An earlier pass invented mono rows here to break up two identical tile
 * grids stacked in the panel. The grids are down to one now that the charts
 * carry the visual work, so the invented format has no reason to exist and
 * these go back to MetricTile — which the side panel already lays out two-up
 * at its own reduced padding and type scale.
 */
function AgentsStatList({ entries }: { readonly entries: readonly AgentsStatEntry[] }) {
  return (
    <div className="kpi-row kpi-row--insights insight-summary" aria-label="Agent detail statistics">
      {entries.map((entry) => (
        <MetricTile key={entry.label} label={entry.label} value={entry.value} detail={entry.detail} />
      ))}
    </div>
  );
}

function agentsDayStatEntries(source: AgentsDaySource, model: AgentsDayModel): AgentsStatEntry[] {
  const numbers = agentsInsightNumbers(source, model);
  return [
    // Commits lead: they are the day's output, and the sentence block above
    // deliberately stops at "how much ran" so this grid owns the result side.
    { label: "Commits", value: String(model.commitCount), detail: `${numbers.commitsPerAgentHour.toFixed(1)}/agent-hour` },
    { label: "Net lines", value: `${numbers.netLines >= 0 ? "+" : ""}${numbers.netLines.toLocaleString()}`, detail: `across ${model.repos.length} repo${model.repos.length === 1 ? "" : "s"}` },
    { label: "Sessions", value: String(numbers.sessions), detail: "distinct" },
    { label: "Tokens", value: formatTokens(numbers.tokens), detail: numbers.sessions > 0 ? `${formatTokens(numbers.tokensPerSession)}/session` : undefined },
    { label: "Longest run", value: formatHours(numbers.longestStretchMinutes), detail: `from ${formatClock(numbers.longestStretchStart)}` },
    { label: "Median run", value: `${Math.round(numbers.medianStretchMinutes)}m`, detail: "per stretch" },
    { label: "Active span", value: formatHours(numbers.activeSpanMinutes), detail: numbers.firstActivityMinute !== null && numbers.lastActivityMinute !== null ? `${formatClock(numbers.firstActivityMinute)}–${formatClock(numbers.lastActivityMinute)}` : undefined },
    { label: "Night share", value: `${Math.round(numbers.nightSharePercent)}%`, detail: "12am–6am" },
  ];
}

/**
 * Proposal panel 3 — hour-of-day rhythm, in the FocusDrift panel chrome.
 * When agents run vs when commits land, as a 24-bin histogram.
 */
function AgentsRhythmPanel({ sources }: { readonly sources: readonly AgentsDaySource[] }) {
  return <AgentsRhythmPanelBody sources={sources} />;
}

function agentsWeekStatEntries(sources: readonly AgentsDaySource[], models: readonly AgentsDayModel[]): AgentsStatEntry[] {
  const week = buildAgentsWeekModel(models);
  const tokens = sources.reduce((sum, source) => sum + (source.tokens ?? 0), 0);
  const sessions = sources.reduce((sum, source) => sum + (source.sessions ?? 0), 0);
  const activeDays = week.days.filter((day) => day.agentMinutes > 0).length;
  const netLines = week.insertions - week.deletions;
  const agentHours = week.agentMinutes / 60;
  // The busiest single day gives the week's spread a reference point, and
  // keeps the tile count even so the two-up grid has no orphan cell.
  const peakDay = week.days.reduce(
    (best, day) => (day.agentMinutes > best.agentMinutes ? day : best),
    week.days[0] ?? { day: "", weekdayLabel: "—", agentMinutes: 0, attentionMinutes: 0, commitCount: 0 },
  );
  return [
    { label: "Commits", value: String(week.commitCount), detail: agentHours > 0 ? `${(week.commitCount / agentHours).toFixed(1)}/agent-hour` : undefined },
    { label: "Net lines", value: `${netLines >= 0 ? "+" : ""}${netLines.toLocaleString()}`, detail: `across ${week.repos.length} repos` },
    { label: "Sessions", value: String(sessions), detail: `${activeDays} active days` },
    { label: "Tokens", value: formatTokens(tokens), detail: sessions > 0 ? `${formatTokens(tokens / sessions)}/session` : undefined },
    { label: "Daily avg", value: formatHours(activeDays > 0 ? week.agentMinutes / activeDays : 0), detail: "per active day" },
    { label: "Peak day", value: formatHours(peakDay.agentMinutes), detail: peakDay.weekdayLabel },
    { label: "Churn", value: `+${formatTokens(week.insertions)}`, detail: `−${formatTokens(week.deletions)} removed` },
    { label: "Top repo", value: week.repos[0]?.repo ?? "—", detail: week.repos[0] ? `${week.repos[0].commitCount} commits` : undefined },
  ];
}

/**
 * Agent rhythm as the timeline dashboard's line chart: the focus/drift plot's
 * own SVG coordinate system, smoothing spline, grid, scale, and axis classes,
 * with the agent-minutes curve solid (focus tone) and commits dashed (drift's
 * line treatment in the neutral grey commits already use here).
 */
function AgentsRhythmPanelBody({ sources }: { readonly sources: readonly AgentsDaySource[] }) {
  const histogram = useMemo(() => agentsHourHistogram(sources), [sources]);
  const maxAgent = Math.max(1, ...histogram.agentMinutes);
  const maxCommits = Math.max(1, ...histogram.commits);

  const { agentPath, commitsPath, agentAreaPath, axisTicks } = useMemo(() => {
    const width = FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left;
    const height = FOCUS_DRIFT_CHART_BOUNDS.bottom - FOCUS_DRIFT_CHART_BOUNDS.top;
    const pointAt = (hour: number, ratio: number) => ({
      x: FOCUS_DRIFT_CHART_BOUNDS.left + ((hour + 0.5) / 24) * width,
      y: FOCUS_DRIFT_CHART_BOUNDS.bottom - ratio * height,
    });
    const agentPoints = histogram.agentMinutes.map((minutes, hour) => {
      const point = pointAt(hour, minutes / maxAgent);
      return { x: point.x, focusY: point.y, driftY: point.y } as never;
    });
    const commitPoints = histogram.commits.map((count, hour) => {
      const point = pointAt(hour, count / maxCommits);
      return { x: point.x, focusY: point.y, driftY: point.y } as never;
    });
    const agent = buildSmoothPath(agentPoints, "focusY");
    const first = agentPoints[0] as { x: number } | undefined;
    const last = agentPoints[agentPoints.length - 1] as { x: number } | undefined;
    const area = agent && first && last
      ? `M ${first.x} ${FOCUS_DRIFT_CHART_BOUNDS.bottom} L ${agent.slice(2)} L ${last.x} ${FOCUS_DRIFT_CHART_BOUNDS.bottom} Z`
      : "";
    return {
      agentPath: agent,
      commitsPath: buildSmoothPath(commitPoints, "focusY"),
      agentAreaPath: area,
      axisTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
        hour,
        x: FOCUS_DRIFT_CHART_BOUNDS.left + ((hour + 0.5) / 24) * width,
        label: formatHourLabel(clockHourForLogicalHour(hour, 0)),
      })),
    };
  }, [histogram, maxAgent, maxCommits]);

  return (
    <section className="editorial-panel editorial-panel--soft insight-chart-panel">
      <div className="insight-panel-head">
        <span className="label-mono">Agent rhythm · by hour</span>
        <div className="insight-panel-head__legend">
          <span className="chip green"><span className="sw" style={{ background: "var(--productivity-focus)" }} />Agent time</span>
          <span className="chip"><span className="sw" style={{ background: "var(--text-soft)" }} />Commits</span>
        </div>
      </div>
      <div className="focus-drift agents-rhythm-chart" aria-label="Agent activity and commits by hour of day">
        <div className="focus-drift__plot">
          <svg className="focus-drift__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Agent minutes and commit counts per hour">
            <path className="focus-drift__grid" d={FOCUS_DRIFT_GRID_PATH} />
            <path className="focus-drift__area" d={agentAreaPath} />
            <path className="focus-drift__line focus-drift__line--focus" d={agentPath} />
            <path className="focus-drift__line agents-rhythm-chart__commits-line" d={commitsPath} />
          </svg>
          <div className="focus-drift__scale" aria-hidden="true">
            <span style={{ "--focus-drift-scale-y": `${FOCUS_DRIFT_CHART_BOUNDS.top}%` } as CSSProperties}>{formatHours(maxAgent)}</span>
            <span style={{ "--focus-drift-scale-y": `${FOCUS_DRIFT_CHART_BOUNDS.bottom}%` } as CSSProperties}>0</span>
          </div>
        </div>
        <div className="focus-drift__axis" aria-hidden="true">
          {axisTicks.map((tick) => (
            <span key={tick.hour} style={{ "--focus-drift-axis-x": `${tick.x}%` } as CSSProperties}>{tick.label}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Proposal panel 4 — models, as a compact ranked list in the insight panel
 * chrome. Which LLMs did the day's work, by cumulative turn time.
 */
function AgentsModelsPanel({ sources }: { readonly sources: readonly AgentsDaySource[] }) {
  const rows = useMemo(() => agentModelRows(sources).slice(0, 6), [sources]);
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((row) => row.cumulativeMinutes));
  return (
    <section className="editorial-panel editorial-panel--soft insight-chart-panel">
      <div className="insight-panel-head">
        <span className="label-mono">Models · by turn time</span>
      </div>
      <ol className="agents-models" aria-label="Models ranked by turn time">
        {rows.map((row) => (
          <li className="agents-models__row" key={row.model}>
            <span className="agents-models__name">{shortModelName(row.model)}</span>
            <span className="agents-models__bar"><span style={{ width: `${(row.cumulativeMinutes / max) * 100}%` }} /></span>
            <span className="agents-models__figures">{formatHours(row.cumulativeMinutes)} · {Math.round(row.shareOfCumulative)}%</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AgentsPage() {
  const [period, setPeriod] = useState<AgentsPeriod>("Today");
  // Same persisted preference as the dashboard: the Breakdown panel is one
  // surface across Day, Week, and Agents.
  const [breakdownOpen, setBreakdownOpen] = useState(resolveInitialDashboardBreakdownOpen);
  const toggleBreakdown = () => {
    setBreakdownOpen((open) => {
      persistDashboardBreakdownOpen(!open);
      return !open;
    });
  };
  const { days, live } = useAgentsData();
  const models = useMemo(() => days.map(buildAgentsDayModel), [days]);
  const dayModel = models[models.length - 1] ?? null;
  const daySource = days[days.length - 1] ?? null;

  const headlineMinutes = period === "Today"
    ? dayModel?.agentMinutes ?? 0
    : models.reduce((sum, model) => sum + model.agentMinutes, 0);
  const dateLabel = period === "Today"
    ? (dayModel ? formatDayLabel(dayModel.day) : "")
    : `${formatShortDate(models[0]?.day ?? "")} – ${formatShortDate(models[models.length - 1]?.day ?? "")}`;
  const totalCommits = period === "Today"
    ? dayModel?.commitCount ?? 0
    : models.reduce((sum, model) => sum + model.commitCount, 0);
  const repos = period === "Today"
    ? dayModel?.repos ?? []
    : buildAgentsWeekModel(models).repos;
  const scopedSources = period === "Today" ? (daySource ? [daySource] : []) : days;
  const repoProviders = useMemo(() => repoDominantProviders(scopedSources), [scopedSources]);

  const pageHead = (
    <div className="pg-head dashboard-page-head dashboard-page-head--focus-summary dashboard-page-head--today">
      <div className="dashboard-page-head__row">
        <div className="dashboard-page-head__summary">
          <h1 aria-label={`Agents ran for ${formatHours(headlineMinutes)}`} className="dashboard-page-head__title">
            {headlineMinutes > 0 ? (
              <><span className="dashboard-page-head__focus-word">Agents ran</span><span className="dashboard-page-head__focus-value">{formatHours(headlineMinutes)}</span></>
            ) : (
              <span className="dashboard-page-head__focus-word">No agent activity</span>
            )}
          </h1>
        </div>
        <div className="dashboard-page-head__side">
          {/* In-page Day/Week toggle, ported from studyhall's proven treatment. */}
          <div className="agents-period-toggle" role="group" aria-label="Agents range">
            {([["Today", "Day"], ["Week", "Week"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={period === value ? "on" : undefined}
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="day-nav" aria-label="Agents period">
            <div className="day-nav__current"><strong>{dateLabel}{live ? "" : " · sample"}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page page--agents">
      <div className={`week-v2-grid week-v2-grid--calendar week-v2-grid--day${breakdownOpen ? " week-v2-grid--side-open" : ""}`}>
        <div className="day-split__main">
          {pageHead}
          {period === "Today" && dayModel && daySource ? (
            <AgentsDayTimeline model={dayModel} source={daySource} />
          ) : (
            <AgentsWeekCalendar models={models} sources={scopedSources} />
          )}
          <div className="dashboard-insight-stack">
            <AgentsRhythmPanel sources={scopedSources} />
          </div>
          <RepoUsagePanel
            repos={repos}
            totalCommits={totalCommits}
            showActive={period === "Today"}
            periodLabel={period === "Today" ? "today" : "this week"}
            repoProviders={repoProviders}
          />
        </div>

        <BreakdownSidePanel
          open={breakdownOpen}
          onToggle={toggleBreakdown}
          ariaLabel="Agents breakdown"
          toggleSubject="agents breakdown"
        >
          {/* The time sentence leads, then the charts (models donut, repo
              share bar) in the day view's compact-chart vocabulary, then the
              reference tiles. */}
          <AgentsBreakdownComposed sources={scopedSources} dayModel={dayModel} models={models} period={period} />
          <AgentsStatList entries={period === "Today" && dayModel && daySource
            ? agentsDayStatEntries(daySource, dayModel)
            : agentsWeekStatEntries(scopedSources, models)}
          />
        </BreakdownSidePanel>
      </div>
    </div>
  );
}
