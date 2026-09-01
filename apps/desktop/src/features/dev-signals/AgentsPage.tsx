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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  logicalMinuteOfDay,
  normalizeStartOfDayMinutes,
  type FlowBlock,
  type FlowIntervalMinutes,
} from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { DateNavigator } from "../../components/DateNavigator";
import { MetricTile } from "../../components/MetricTile";
import { clockHourForLogicalHour, formatCalendarMinuteLabel, formatDateRangeLabel } from "../../lib/formatting";
import { BreakdownSidePanel } from "../dashboard/BreakdownSidePanelChrome";
import { getDashboardCurrentPeriodLabel, getDashboardPeriodRange, shiftDashboardPeriodDay } from "../dashboard/dashboardPeriods";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT, formatWeekDashboardAxisPixelValue, weekDashboardAxisScalePercentToHourHeight } from "../dashboard/weekDashboardAxisScale";
import { persistDashboardBreakdownOpen, resolveInitialDashboardBreakdownOpen, type StartOfWeek } from "../settings/settingsStorage";
import { FlowDetailSelect } from "../flow-chart/FlowDetailSelect";
import { FlowChartGrid } from "../flow-chart/FlowChartGrid";
import { FlowChartLegend } from "../flow-chart/FlowChartLegend";
import { FlowHoverLayer } from "../flow-chart/FlowHoverLayer";
import { buildFlowBlockHoverGroups, type FlowBlockHoverGroup } from "../flow-chart/flowHoverGroups";
import type { ProjectLegendEntry } from "../flow-chart/projectFlowView";
import { formatHourLabel } from "../flow-chart/flowChartFormat";
import { FOCUS_DRIFT_GRID_PATH } from "../dashboard/focusDriftChart";
import { FOCUS_DRIFT_CHART_BOUNDS, buildSmoothPath } from "../dashboard/focusDriftGeometry";
import {
  buildAgentsDayModel,
  buildAgentsGridCells,
  buildAgentsTimelineSegments,
  buildAgentsWeekModel,
  AGENTS_WEEK_BUCKET_MINUTES,
  agentMinutesByRepo,
  agentsIntensityBandFor,
  gridRepoLegend,
  repoDominantProviders,
  agentModelRows,
  agentsHourHistogram,
  agentsInsightNumbers,
  formatTokens,
  visibleAgentsIntensityBands,
  type AgentsDayModel,
  type AgentsIntensityBand,
  type AgentsRepoRow,
  type AgentsTimelineColorMode,
} from "./agentsPageModel";
import type { AgentsDaySource } from "./agentsPageModel";
import { formatClock, formatHours } from "./devSignalsModel";
import { useAgentsData } from "./useAgentsData";
import { useAgentsIntensityScale } from "./useAgentsIntensityScale";
import { AGENTS_UNKNOWN_COLOR, agentsSeriesColors } from "./agentsPalette";
import {
  AgentsBreakdownComposed,
} from "./AgentsBreakdown";
import { AgentsWeekHoverLayer } from "./AgentsWeekHoverLayer";
import "./agents-page.css";

export type AgentsPeriod = "Today" | "Week";
export type AgentsGridColorMode = AgentsTimelineColorMode;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES_PER_DAY = 24 * 60;

function clockMinuteForLogicalMinute(logicalMinute: number, startOfDayMinutes: number): number {
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const roundedMinute = Math.round(logicalMinute);
  return ((roundedMinute + boundaryMinutes) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function formatLogicalClock(logicalMinute: number, startOfDayMinutes: number): string {
  return formatClock(clockMinuteForLogicalMinute(logicalMinute, startOfDayMinutes));
}

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
  claude_code: { name: "Claude Code", color: "#d97757" },
  aside: { name: "Aside", color: "#7c5cff" },
  opencode: { name: "OpenCode", color: "#5b8def" },
  gemini: { name: "Gemini CLI", color: "#4285f4" },
  hermes: { name: "Hermes", color: "#c45c26" },
  openclaw: { name: "OpenClaw", color: "#3b82f6" },
  kimi: { name: "Kimi", color: "#111111" },
  pi: { name: "Pi", color: "#0f766e" },
  droid: { name: "Droid", color: "#ea580c" },
  amp: { name: "Amp", color: "#7c3aed" },
  copilot: { name: "Copilot CLI", color: "#24292f" },
  cline: { name: "Cline", color: "#2563eb" },
  roo: { name: "Roo / Kilo", color: "#db2777" },
  goose: { name: "Goose", color: "#ca8a04" },
  zed: { name: "Zed", color: "#84cc16" },
  qwen: { name: "Qwen CLI", color: "#8b5cf6" },
  kiro: { name: "Kiro", color: "#f59e0b" },
  cursor_cli: { name: "Cursor CLI", color: "#111827" },
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

/* Concurrency → personal intensity tone. The same slot is one color across
   Day and Week; labels keep the actual concurrent-turn count. */
function intensityColor(level: number, bands: readonly AgentsIntensityBand[]): string {
  return intensityBandColor(agentsIntensityBandFor(level, bands));
}

function intensityBandColor(band: AgentsIntensityBand): string {
  return `color-mix(in srgb, var(--productivity-focus) ${band.tonePercent}%, var(--flow-chart-plot-surface))`;
}

function intensityContrast(band: AgentsIntensityBand): "light" | "dark" {
  return band.tonePercent >= 70 ? "light" : "dark";
}

function rankedAgentRepos(sources: readonly AgentsDaySource[]): string[] {
  return [...agentMinutesByRepo(sources).entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([repo]) => repo);
}

function hasUnlabelledAgentTime(sources: readonly AgentsDaySource[]): boolean {
  return sources.some((source) => source.turns.some((turn) => !(turn[3]?.trim())));
}

function repoLegendEntries(
  repoOrder: readonly string[],
  repoColors: ReadonlyMap<string, string>,
  hasUnlabelled: boolean,
): ProjectLegendEntry[] {
  const repoLimit = hasUnlabelled ? 4 : 5;
  const entries: ProjectLegendEntry[] = repoOrder.slice(0, repoLimit).map((repo) => ({
    projectId: repo,
    name: repo,
    color: repoColors.get(repo) ?? AGENTS_UNKNOWN_COLOR,
  }));
  if (hasUnlabelled) entries.push({ projectId: null, name: "No repo", color: AGENTS_UNKNOWN_COLOR });
  return entries;
}

function readableForeground(background: string): string {
  // Week project tones come from the fixed #RRGGBB agent series palette.
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(background);
  if (!match) return "var(--text)";
  const channels = match.slice(1).map((channel) => Number.parseInt(channel, 16) / 255);
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
  const darkContrast = (luminance + 0.05) / 0.055;
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? "#10100e" : "#ffffff";
}

type ShareStyle = CSSProperties & { "--app-usage-share": string };

function formatChurn(insertions: number, deletions: number): string {
  return `+${insertions.toLocaleString()} −${deletions.toLocaleString()}`;
}

function shareOfCommits(repo: AgentsRepoRow, totalCommits: number): number {
  if (totalCommits <= 0) return 0;
  return Math.min(100, (repo.commitCount / totalCommits) * 100);
}

/**
 * The flow chart's own head: the shared detail selector, the same color-mode
 * segmented control, and the same project-legend chips, fed with agent
 * vocabulary. Nothing here introduces a control style the day view lacks.
 */
function AgentsColorModeControl({ colorMode, onColorModeChange }: {
  readonly colorMode: AgentsGridColorMode;
  readonly onColorModeChange: (mode: AgentsGridColorMode) => void;
}) {
  return (
    <div className="seg flow-color-mode-control" role="group" aria-label="Agents color mode">
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
  );
}

function AgentsTimelineLegend({ entries }: { readonly entries: readonly ProjectLegendEntry[] }) {
  const hoveredLegendCardRef = { current: null };
  return (
    <FlowChartLegend
      blocks={[]}
      colorMode="project"
      hoveredLegendCardRef={hoveredLegendCardRef}
      setHoveredLegend={() => undefined}
      projectLegend={entries}
    />
  );
}

function AgentsTimelineHead({ colorMode, intervalMinutes, legendEntries, onColorModeChange, onIntervalChange }: {
  readonly colorMode: AgentsGridColorMode;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly legendEntries: readonly ProjectLegendEntry[];
  readonly onColorModeChange: (mode: AgentsGridColorMode) => void;
  readonly onIntervalChange: (interval: FlowIntervalMinutes) => void;
}) {
  return (
    <div className="flow-chart-head">
      <div className="flow-chart-head__actions">
        <div className="flow-chart-head__controls">
          <FlowDetailSelect intervalMinutes={intervalMinutes} onIntervalChange={onIntervalChange} />
          <AgentsColorModeControl colorMode={colorMode} onColorModeChange={onColorModeChange} />
        </div>
        <AgentsTimelineLegend entries={legendEntries} />
      </div>
    </div>
  );
}

/**
 * The 24-hour timeline as a flow-chart-card: same axis row, same gutter token,
 * same card chrome (top border, spacing) the day view's chart uses.
 */
function AgentsDayTimeline({ model, source, colorMode, intervalMinutes, intensityBands, onColorModeChange, onIntervalChange, startOfDayMinutes, currentMinuteOfDay }: {
  readonly model: AgentsDayModel;
  readonly source: AgentsDaySource;
  readonly colorMode: AgentsGridColorMode;
  readonly intervalMinutes: FlowIntervalMinutes;
  readonly intensityBands: readonly AgentsIntensityBand[];
  readonly onColorModeChange: (mode: AgentsGridColorMode) => void;
  readonly onIntervalChange: (intervalMinutes: FlowIntervalMinutes) => void;
  readonly startOfDayMinutes: number;
  readonly currentMinuteOfDay: number | null;
}) {
  const [flowGridElement, setFlowGridElement] = useState<HTMLDivElement | null>(null);
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const currentLogicalMinute = currentMinuteOfDay === null
    ? null
    : logicalMinuteOfDay(currentMinuteOfDay, boundaryMinutes);
  const currentHourIndex = currentLogicalMinute === null ? null : Math.floor(currentLogicalMinute / 60);
  const currentMinuteOffset = currentLogicalMinute === null
    ? null
    : Math.floor((currentLogicalMinute % 60) / intervalMinutes) * intervalMinutes;
  const repoOrder = useMemo(() => rankedAgentRepos([source]), [source]);
  const gridCells = useMemo(() => buildAgentsGridCells(source, intervalMinutes, repoOrder), [source, intervalMinutes, repoOrder]);
  const gridRepos = useMemo(() => gridRepoLegend(gridCells), [gridCells]);
  const repoLegend = useMemo(() => {
    const visibleRepos = new Set(gridRepos);
    return [...repoOrder.filter((repo) => visibleRepos.has(repo)), ...gridRepos.filter((repo) => !repoOrder.includes(repo))];
  }, [gridRepos, repoOrder]);
  // Ranked by cumulative agent time, matching the Breakdown chart so a repo
  // keeps one color throughout the page.
  const repoColors = useMemo(() => agentsSeriesColors(repoOrder), [repoOrder]);

  // The grid is the real FlowChartGrid: agent cells become FlowBlocks whose
  // projectColor carries the tone (concurrency tone in intensity mode, repo
  // colour in repo mode), rendered in the chart's project colour mode. The
  // chart, not this page, owns cell geometry, seams, axis, and the label rail.
  const gridBlocks = useMemo(() => {
    const byCell = new Map<string, FlowBlock>();
    for (const cell of gridCells.values()) {
      const minuteOfDay = clockMinuteForLogicalMinute(cell.minuteOfDay, boundaryMinutes);
      const color = colorMode === "repo"
        ? (cell.topRepo ? repoColors.get(cell.topRepo) ?? AGENTS_UNKNOWN_COLOR : AGENTS_UNKNOWN_COLOR)
        : intensityColor(cell.concurrency, intensityBands);
      byCell.set(`${minuteOfDay}`, {
        id: `agent-${cell.minuteOfDay}`,
        day: model.day,
        hour: Math.floor(minuteOfDay / 60),
        quarter: 0,
        minuteOfDay,
        appName: cell.topRepo ?? "Agents",
        windowTitle: `Peak ×${cell.concurrency}`,
        category: "workspace",
        productivity: "focus",
        durationSeconds: intervalMinutes * 60,
        projectId: cell.topRepo,
        projectColor: color,
        colorKey: cell.topRepo ?? "agents",
      } as FlowBlock);
    }
    return byCell;
  }, [boundaryMinutes, gridCells, colorMode, intensityBands, repoColors, model.day, intervalMinutes]);
  const gridBlockList = useMemo(() => Array.from(gridBlocks.values()), [gridBlocks]);
  const hoverGroupsByCell = useMemo(
    () => buildFlowBlockHoverGroups(gridBlockList, intervalMinutes, boundaryMinutes),
    [boundaryMinutes, gridBlockList, intervalMinutes],
  );

  const legendEntries = useMemo<ProjectLegendEntry[]>(() => {
    if (colorMode === "repo") {
      return repoLegendEntries(repoLegend, repoColors, Array.from(gridCells.values()).some((cell) => cell.topRepo === null));
    }
    const peakConcurrency = Math.max(0, ...Array.from(gridCells.values(), (cell) => cell.concurrency));
    return visibleAgentsIntensityBands(peakConcurrency, intensityBands).map((band) => ({
      projectId: band.id,
      name: band.label,
      color: intensityBandColor(band),
    }));
  }, [colorMode, gridCells, intensityBands, repoLegend, repoColors]);

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
            onColorModeChange={onColorModeChange}
            onIntervalChange={onIntervalChange}
          />
          <FlowChartGrid
            blockByCell={gridBlocks}
            boundaryMinutes={boundaryMinutes}
            colorMode="project"
            currentHourIndex={currentHourIndex}
            currentMinuteOffset={currentMinuteOffset}
            hoverGroupsByCell={hoverGroupsByCell}
            intervalMinutes={intervalMinutes}
            setFlowGridElement={setFlowGridElement}
          />
          <FlowHoverLayer
            gridElement={flowGridElement}
            hoverGroupsByCell={hoverGroupsByCell}
            intervalMinutes={intervalMinutes}
            boundaryMinutes={boundaryMinutes}
            appIcons={{}}
            showClassificationSource={false}
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
function RepoUsagePanel({ repos, totalCommits, showActive, periodLabel, repoProviders, startOfDayMinutes }: {
  readonly repos: readonly AgentsRepoRow[];
  readonly totalCommits: number;
  readonly showActive: boolean;
  readonly periodLabel: string;
  /** repo → agent provider that dominated it; drives the row icon. */
  readonly repoProviders: ReadonlyMap<string, string>;
  readonly startOfDayMinutes: number;
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
                <p>{showActive ? `Active ${formatLogicalClock(featured.firstCommitMin, startOfDayMinutes)}–${formatLogicalClock(featured.lastCommitMin, startOfDayMinutes)}` : `Across ${periodLabel}`}</p>
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
                      <small>{showActive ? `Active ${formatLogicalClock(repo.firstCommitMin, startOfDayMinutes)}–${formatLogicalClock(repo.lastCommitMin, startOfDayMinutes)}` : formatChurn(repo.insertions, repo.deletions)}</small>
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
 * stretches as the events (focus tone). Commit output stays in Breakdown so
 * the calendar remains the single signal in the main Week surface.
 * Geometry classes come from week-dashboard.css untouched; the full 24-hour
 * range is rotated from the user's configured logical day start.
 */
const AGENTS_WEEK_HOUR_HEIGHT = weekDashboardAxisScalePercentToHourHeight(WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT);

function minuteOfDayNow(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function useLiveMinuteOfDay(): number {
  const [minute, setMinute] = useState(minuteOfDayNow);

  useEffect(() => {
    const update = () => setMinute(minuteOfDayNow());
    const interval = window.setInterval(update, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return minute;
}

type AgentsWeekNowMarkerStyle = CSSProperties & {
  "--week-calendar-now-offset": string;
  "--week-calendar-now-line-end": string;
};

function AgentsWeekCalendar({ colorMode, header, loading, models, intensityBands, onColorModeChange, sources, todayDay, startOfDayMinutes, currentMinuteOfDay }: {
  readonly colorMode: AgentsGridColorMode;
  readonly header: ReactNode;
  readonly loading: boolean;
  readonly models: readonly AgentsDayModel[];
  readonly intensityBands: readonly AgentsIntensityBand[];
  readonly onColorModeChange: (mode: AgentsGridColorMode) => void;
  readonly sources: readonly AgentsDaySource[];
  readonly todayDay: string;
  readonly startOfDayMinutes: number;
  readonly currentMinuteOfDay: number;
}) {
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const [calendarBodyElement, setCalendarBodyElement] = useState<HTMLDivElement | null>(null);
  const [activeKeyboardEventId, setActiveKeyboardEventId] = useState<string | null>(null);
  const calendarScrollerRef = useRef<HTMLDivElement>(null);
  const eventElementsRef = useRef(new Map<string, HTMLElement>());
  const autoScrolledRangeRef = useRef<string | null>(null);
  const week = useMemo(() => buildAgentsWeekModel(models), [models]);
  const repoOrder = useMemo(() => rankedAgentRepos(sources), [sources]);
  const repoColors = useMemo(() => agentsSeriesColors(repoOrder), [repoOrder]);
  const hasUnlabelled = useMemo(() => hasUnlabelledAgentTime(sources), [sources]);
  const legendEntries = useMemo<ProjectLegendEntry[]>(() => {
    if (colorMode === "repo") {
      return repoLegendEntries(repoOrder, repoColors, hasUnlabelled);
    }
    const peakConcurrency = Math.max(0, ...models.map((model) => model.concurrencyPeak));
    return visibleAgentsIntensityBands(peakConcurrency, intensityBands).map((band) => ({
      projectId: band.id,
      name: band.label,
      color: intensityBandColor(band),
    }));
  }, [colorMode, hasUnlabelled, intensityBands, models, repoColors, repoOrder]);
  const { eventsByDay, hoverGroupsById } = useMemo(() => {
    const nextEventsByDay = new Map<string, {
      id: string;
      start: number;
      end: number;
      label: string;
      peakConcurrency: number;
      providerLabel: string;
      intensityBandId: AgentsIntensityBand["id"];
      intensityBand: AgentsIntensityBand;
      tone: string;
      foreground?: string;
    }[]>();
    const nextGroupsById = new Map<string, FlowBlockHoverGroup>();
    for (const source of sources) {
      const segments = buildAgentsTimelineSegments(source, colorMode, repoOrder, AGENTS_WEEK_BUCKET_MINUTES, intensityBands);
      const events = segments.map((segment) => {
        // Start bucket is the segment's durable identity. Live refreshes may
        // extend the end or change its dominant tone without replacing the
        // focused DOM node and resetting roving keyboard navigation.
        const id = `${source.day}:${colorMode}:${segment.start}`;
        const providerLabels = segment.providers.map(agentToolName);
        const providerLabel = providerLabels.join(" + ");
        const label = segment.topRepo ?? (providerLabels.length === 1 ? providerLabels[0]! : "Agents");
        const hoverStartMinute = clockMinuteForLogicalMinute(segment.start, boundaryMinutes);
        const hoverEndMinute = clockMinuteForLogicalMinute(segment.end, boundaryMinutes);
        const tone = colorMode === "repo"
          ? (segment.topRepo ? repoColors.get(segment.topRepo) ?? AGENTS_UNKNOWN_COLOR : AGENTS_UNKNOWN_COLOR)
          : intensityBandColor(segment.intensityBand);
        const detail = [
          `Peak ×${segment.peakConcurrency}`,
          providerLabel,
          `${AGENTS_WEEK_BUCKET_MINUTES}m resolution`,
        ].filter(Boolean).join(" · ");
        const block: FlowBlock = {
          id: `agent-week-${id}`,
          day: source.day,
          hour: Math.floor(hoverStartMinute / 60),
          quarter: 0,
          minuteOfDay: hoverStartMinute,
          appName: label,
          windowTitle: detail,
          category: "workspace",
          productivity: "focus",
          projectId: segment.topRepo,
          projectColor: tone,
          colorKey: segment.topRepo ?? "agents",
          durationSeconds: Math.round((segment.end - segment.start) * 60),
        };
        nextGroupsById.set(id, {
          block,
          blocks: [block],
          segmentIds: [],
          startMinuteOfDay: hoverStartMinute,
          endMinuteOfDay: hoverEndMinute,
          durationSeconds: block.durationSeconds,
        });
        return {
          id,
          start: segment.start,
          end: segment.end,
          label,
          peakConcurrency: segment.peakConcurrency,
          providerLabel,
          intensityBandId: segment.intensityBand.id,
          intensityBand: segment.intensityBand,
          tone,
          ...(colorMode === "repo" ? { foreground: readableForeground(tone) } : {}),
        };
      });
      nextEventsByDay.set(source.day, events);
    }
    return { eventsByDay: nextEventsByDay, hoverGroupsById: nextGroupsById };
  }, [boundaryMinutes, colorMode, intensityBands, repoColors, repoOrder, sources]);
  const orderedEventIds = useMemo(
    () => week.days.flatMap((day) => (eventsByDay.get(day.day) ?? []).map((event) => event.id)),
    [eventsByDay, week.days],
  );
  const keyboardTabStopId = activeKeyboardEventId && hoverGroupsById.has(activeKeyboardEventId)
    ? activeKeyboardEventId
    : (orderedEventIds[0] ?? null);
  const todayIndex = week.days.findIndex((day) => day.day === todayDay);
  const isCurrentWeek = todayIndex >= 0;
  const currentLogicalMinute = logicalMinuteOfDay(currentMinuteOfDay, boundaryMinutes);
  const currentCalendarOffset = isCurrentWeek ? (currentLogicalMinute / 60) * AGENTS_WEEK_HOUR_HEIGHT : null;
  const currentCalendarLabel = isCurrentWeek
    ? formatCalendarMinuteLabel(todayDay, currentLogicalMinute, boundaryMinutes)
    : null;
  const currentMarkerStyle: AgentsWeekNowMarkerStyle | null = currentCalendarOffset === null
    ? null
    : {
        "--week-calendar-now-offset": formatWeekDashboardAxisPixelValue(currentCalendarOffset),
        "--week-calendar-now-line-end": String(todayIndex + 3),
      };
  const autoScrollTargetMinute = useMemo(() => {
    if (isCurrentWeek) return currentLogicalMinute;
    let earliest: number | null = null;
    for (const events of eventsByDay.values()) {
      for (const event of events) earliest = earliest === null ? event.start : Math.min(earliest, event.start);
    }
    return earliest ?? 0;
  }, [currentLogicalMinute, eventsByDay, isCurrentWeek]);
  const autoScrollRangeKey = `${week.days[0]?.day ?? ""}:${week.days[week.days.length - 1]?.day ?? ""}`;

  useLayoutEffect(() => {
    if (loading) return;
    if (autoScrolledRangeRef.current === autoScrollRangeKey) return;
    const scroller = calendarScrollerRef.current;
    const body = calendarBodyElement;
    if (!scroller || !body) return;
    const bodyTop = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const targetOffset = (autoScrollTargetMinute / 60) * AGENTS_WEEK_HOUR_HEIGHT;
    const viewportAnchor = Math.max(96, scroller.clientHeight * 0.58);
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(maxScrollTop, Math.max(0, bodyTop + targetOffset - viewportAnchor));
    autoScrolledRangeRef.current = autoScrollRangeKey;
  }, [autoScrollRangeKey, autoScrollTargetMinute, calendarBodyElement, loading]);

  return (
    <>
      <section className="week-v2-calendar editorial-panel editorial-panel--soft agents-week-calendar" aria-label="Agent week calendar">
        {header}
        <div className="week-v2-calendar__legend" aria-label="Agents week legend">
          <div className="flow-chart-head__actions">
            <div className="flow-chart-head__controls">
              <AgentsColorModeControl colorMode={colorMode} onColorModeChange={onColorModeChange} />
            </div>
            <AgentsTimelineLegend entries={legendEntries} />
          </div>
        </div>
        <div className="week-v2-calendar__scroller" ref={calendarScrollerRef}>
          <div className="week-v2-calendar__day-head" aria-hidden="true">
            <span />
            {week.days.map((day) => {
              const [, , dayOfMonth] = day.day.split("-").map(Number);
              const isWeekend = day.weekdayLabel === "Sun" || day.weekdayLabel === "Sat";
              return (
                <span className={`${isWeekend ? "is-weekend" : ""}${day.day === todayDay ? " is-today" : ""}`.trim() || undefined} key={day.day}>
                  <strong>{day.weekdayLabel}</strong>
                  <small>{dayOfMonth}</small>
                </span>
              );
            })}
          </div>
          <div className="week-v2-calendar__body" ref={setCalendarBodyElement} style={{ height: formatWeekDashboardAxisPixelValue(24 * AGENTS_WEEK_HOUR_HEIGHT) }}>
            <div className="week-v2-calendar__time-rail">
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour} style={{ top: formatWeekDashboardAxisPixelValue(hour * AGENTS_WEEK_HOUR_HEIGHT) }}>{formatHourLabel(clockHourForLogicalHour(hour, boundaryMinutes))}</span>
              ))}
              <span className="week-v2-calendar__time-rail-endpoint" style={{ top: formatWeekDashboardAxisPixelValue(24 * AGENTS_WEEK_HOUR_HEIGHT) }}>
                {formatHourLabel(clockHourForLogicalHour(24, boundaryMinutes))}
              </span>
            </div>
            {currentMarkerStyle ? (
              <div className="week-v2-calendar__now-marker week-v2-calendar__now-marker--line" style={currentMarkerStyle} aria-hidden="true">
                <span className="week-v2-calendar__now-line" />
                <span className="week-v2-calendar__now-cap" aria-hidden="true" />
              </div>
            ) : null}
            {week.days.map((day) => {
              const events = eventsByDay.get(day.day) ?? [];
              return (
                <div className={`week-v2-calendar__day-column${day.day === todayDay ? " is-today" : ""}`} key={day.day}>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <span className="week-v2-calendar__line" key={`${day.day}-${hour}`} style={{ top: formatWeekDashboardAxisPixelValue(hour * AGENTS_WEEK_HOUR_HEIGHT) }} />
                  ))}
                  {events.map((event) => {
                    const heightPx = Math.max(4, ((event.end - event.start) / 60) * AGENTS_WEEK_HOUR_HEIGHT);
                    const isShort = heightPx < 18;
                    return (
                      <article
                        key={event.id}
                        ref={(element) => {
                          if (element) eventElementsRef.current.set(event.id, element);
                          else eventElementsRef.current.delete(event.id);
                        }}
                        className={`week-v2-calendar__event week-v2-calendar__event--focus agents-week-calendar__event${isShort ? " week-v2-calendar__event--short week-v2-calendar__event--tiny" : ""}`}
                        style={{
                          top: formatWeekDashboardAxisPixelValue((event.start / 60) * AGENTS_WEEK_HOUR_HEIGHT),
                          height: formatWeekDashboardAxisPixelValue(heightPx),
                          left: "4px",
                          width: "calc(100% - 8px)",
                          "--event-tone": event.tone,
                          ...(event.foreground ? { "--agent-event-foreground": event.foreground } : {}),
                        } as CSSProperties}
                        data-agent-hover-id={event.id}
                        data-agent-intensity-band={event.intensityBandId}
                        data-agent-intensity-contrast={colorMode === "intensity" ? intensityContrast(event.intensityBand) : undefined}
                        tabIndex={keyboardTabStopId === event.id ? 0 : -1}
                        onFocus={() => setActiveKeyboardEventId(event.id)}
                        onKeyDown={(keyEvent) => {
                          const currentIndex = orderedEventIds.indexOf(event.id);
                          let nextIndex = currentIndex;
                          if (keyEvent.key === "ArrowDown" || keyEvent.key === "ArrowRight") nextIndex += 1;
                          else if (keyEvent.key === "ArrowUp" || keyEvent.key === "ArrowLeft") nextIndex -= 1;
                          else if (keyEvent.key === "Home") nextIndex = 0;
                          else if (keyEvent.key === "End") nextIndex = orderedEventIds.length - 1;
                          else return;
                          keyEvent.preventDefault();
                          const nextId = orderedEventIds[Math.max(0, Math.min(orderedEventIds.length - 1, nextIndex))];
                          if (nextId) eventElementsRef.current.get(nextId)?.focus();
                        }}
                        aria-label={`Agent run on ${day.weekdayLabel}, ${day.day}, ${event.label}, ${event.providerLabel || "unknown provider"}, peak ×${event.peakConcurrency}, ${formatLogicalClock(event.start, boundaryMinutes)}–${formatLogicalClock(event.end, boundaryMinutes)}, approximately ${formatHours(event.end - event.start)} at ${AGENTS_WEEK_BUCKET_MINUTES}-minute resolution`}
                      >
                        {!isShort ? <strong>≈{formatHours(event.end - event.start)}</strong> : null}
                      </article>
                    );
                  })}
                </div>
              );
            })}
            {currentMarkerStyle && currentCalendarLabel ? (
              <div
                className="week-v2-calendar__now-marker week-v2-calendar__now-marker--overlay"
                style={currentMarkerStyle}
                aria-label={`Current time ${currentCalendarLabel}`}
              >
                <span className="week-v2-calendar__now-label">{currentCalendarLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>
      <AgentsWeekHoverLayer bodyElement={calendarBodyElement} groupsById={hoverGroupsById} />
    </>
  );
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

function agentsDayStatEntries(source: AgentsDaySource, model: AgentsDayModel, startOfDayMinutes: number): AgentsStatEntry[] {
  const numbers = agentsInsightNumbers(source, model, startOfDayMinutes);
  return [
    // Commits lead: they are the day's output, and the sentence block above
    // deliberately stops at "how much ran" so this grid owns the result side.
    { label: "Commits", value: String(model.commitCount), detail: `${numbers.commitsPerAgentHour.toFixed(1)}/agent-hour` },
    { label: "Net lines", value: `${numbers.netLines >= 0 ? "+" : ""}${numbers.netLines.toLocaleString()}`, detail: `across ${model.repos.length} repo${model.repos.length === 1 ? "" : "s"}` },
    { label: "Sessions", value: String(numbers.sessions), detail: "distinct" },
    { label: "Tokens", value: formatTokens(numbers.tokens), detail: numbers.sessions > 0 ? `${formatTokens(numbers.tokensPerSession)}/session` : undefined },
    { label: "Longest run", value: formatHours(numbers.longestStretchMinutes), detail: `from ${formatLogicalClock(numbers.longestStretchStart, startOfDayMinutes)}` },
    { label: "Median run", value: `${Math.round(numbers.medianStretchMinutes)}m`, detail: "per stretch" },
    { label: "Active span", value: formatHours(numbers.activeSpanMinutes), detail: numbers.firstActivityMinute !== null && numbers.lastActivityMinute !== null ? `${formatLogicalClock(numbers.firstActivityMinute, startOfDayMinutes)}–${formatLogicalClock(numbers.lastActivityMinute, startOfDayMinutes)}` : undefined },
    { label: "Night share", value: `${Math.round(numbers.nightSharePercent)}%`, detail: "12am–6am" },
  ];
}

/**
 * Proposal panel 3 — hour-of-day rhythm, in the FocusDrift panel chrome.
 * When agents run vs when commits land, as a 24-bin histogram.
 */
function AgentsRhythmPanel({ sources, startOfDayMinutes }: { readonly sources: readonly AgentsDaySource[]; readonly startOfDayMinutes: number }) {
  return <AgentsRhythmPanelBody sources={sources} startOfDayMinutes={startOfDayMinutes} />;
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
function AgentsRhythmPanelBody({ sources, startOfDayMinutes }: { readonly sources: readonly AgentsDaySource[]; readonly startOfDayMinutes: number }) {
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
        label: formatHourLabel(clockHourForLogicalHour(hour, startOfDayMinutes)),
      })),
    };
  }, [histogram, maxAgent, maxCommits, startOfDayMinutes]);

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

export function AgentsPage({
  flowIntervalMinutes,
  onFlowIntervalChange,
  onSelectDay,
  selectedDay,
  startOfDayMinutes,
  startOfWeek,
  todayDay,
}: {
  readonly flowIntervalMinutes: FlowIntervalMinutes;
  readonly onFlowIntervalChange: (intervalMinutes: FlowIntervalMinutes) => void;
  readonly onSelectDay: (day: string) => void;
  readonly selectedDay: string;
  readonly startOfDayMinutes: number;
  readonly startOfWeek: StartOfWeek;
  readonly todayDay: string;
}) {
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const liveMinuteOfDay = useLiveMinuteOfDay();
  const [period, setPeriod] = useState<AgentsPeriod>("Today");
  const [colorMode, setColorMode] = useState<AgentsGridColorMode>("intensity");
  // Same persisted preference as the dashboard: the Breakdown panel is one
  // surface across Day, Week, and Agents.
  const [breakdownOpen, setBreakdownOpen] = useState(resolveInitialDashboardBreakdownOpen);
  const toggleBreakdown = () => {
    setBreakdownOpen((open) => {
      persistDashboardBreakdownOpen(!open);
      return !open;
    });
  };
  const range = useMemo(
    () => getDashboardPeriodRange(selectedDay, period, boundaryMinutes, startOfWeek),
    [boundaryMinutes, period, selectedDay, startOfWeek],
  );
  const { days, loading, live } = useAgentsData(range.startDay, range.endDay, boundaryMinutes);
  const models = useMemo(() => days.map(buildAgentsDayModel), [days]);
  const visiblePeak = useMemo(
    () => Math.max(0, ...models.map((model) => model.concurrencyPeak)),
    [models],
  );
  const intensityScale = useAgentsIntensityScale({
    visiblePeak,
    todayDay,
    live,
    startOfDayMinutes: boundaryMinutes,
  });
  const dayModel = models[models.length - 1] ?? null;
  const daySource = days[days.length - 1] ?? null;

  const headlineMinutes = period === "Today"
    ? dayModel?.agentMinutes ?? 0
    : models.reduce((sum, model) => sum + model.agentMinutes, 0);
  const headlineDuration = headlineMinutes >= 1 ? formatHours(headlineMinutes) : null;
  const titleAriaLabel = loading
    ? "Loading agent activity"
    : headlineDuration === null
      ? "No agent activity"
      : `Agents ran for ${headlineDuration}`;
  const dateLabel = formatDateRangeLabel(range.startDay, range.endDay);
  const totalCommits = period === "Today"
    ? dayModel?.commitCount ?? 0
    : models.reduce((sum, model) => sum + model.commitCount, 0);
  const repos = period === "Today"
    ? dayModel?.repos ?? []
    : buildAgentsWeekModel(models).repos;
  const scopedSources = period === "Today" ? (daySource ? [daySource] : []) : days;
  const repoProviders = useMemo(() => repoDominantProviders(scopedSources), [scopedSources]);
  const isCurrentPeriod = range.startDay <= todayDay && todayDay <= range.endDay;
  const nextSelectedDay = shiftDashboardPeriodDay(selectedDay, period, 1);
  const nextRange = getDashboardPeriodRange(nextSelectedDay, period, boundaryMinutes, startOfWeek);
  const canShiftForward = period === "Week" ? nextRange.startDay <= todayDay : nextSelectedDay <= todayDay;
  const shiftPeriod = (direction: -1 | 1) => {
    if (direction === 1 && !canShiftForward) return;
    onSelectDay(shiftDashboardPeriodDay(selectedDay, period, direction));
  };

  const pageHead = (
    <div className="pg-head dashboard-page-head dashboard-page-head--focus-summary dashboard-page-head--today">
      <div className="dashboard-page-head__row">
        <div className="dashboard-page-head__summary">
          <h1 aria-label={titleAriaLabel} className="dashboard-page-head__title">
            {loading ? (
              <><span className="dashboard-page-head__focus-word">Agents ran</span><span className="loading-skeleton-line loading-skeleton-line--metric" aria-hidden="true" /></>
            ) : headlineDuration === null ? (
              <span className="dashboard-page-head__focus-word">No agent activity</span>
            ) : (
              <><span className="dashboard-page-head__focus-word">Agents ran</span><span className="dashboard-page-head__focus-value">{headlineDuration}</span></>
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
          <DateNavigator
            ariaLabel={`Agents ${period.toLowerCase()} selector`}
            label={`${dateLabel}${!loading && !live ? " · sample" : ""}`}
            todayLabel={getDashboardCurrentPeriodLabel(period)}
            isTodayDisabled={isCurrentPeriod}
            isNextDisabled={!canShiftForward}
            onPrevious={() => shiftPeriod(-1)}
            onNext={() => shiftPeriod(1)}
            onToday={() => onSelectDay(todayDay)}
            previousLabel={period === "Week" ? "Show previous agents week" : "Show previous agents day"}
            nextLabel={period === "Week" ? "Show next agents week" : "Show next agents day"}
          />
        </div>
      </div>
    </div>
  );

  const breakdownPanel = (
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
        ? agentsDayStatEntries(daySource, dayModel, boundaryMinutes)
        : agentsWeekStatEntries(scopedSources, models)}
      />
    </BreakdownSidePanel>
  );

  if (period === "Week") {
    return (
      <div className="page page--agents page--week-dashboard" aria-busy={loading}>
        <section className="week-v2" aria-label="Your agents week overview">
          <div className={`week-v2-grid week-v2-grid--calendar${breakdownOpen ? " week-v2-grid--side-open" : ""}`}>
            <AgentsWeekCalendar
              colorMode={colorMode}
              header={pageHead}
              loading={loading}
              models={models}
              intensityBands={intensityScale.bands}
              onColorModeChange={setColorMode}
              sources={scopedSources}
              todayDay={todayDay}
              startOfDayMinutes={boundaryMinutes}
              currentMinuteOfDay={liveMinuteOfDay}
            />
            {breakdownPanel}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page page--agents" aria-busy={loading}>
      <div className={`week-v2-grid week-v2-grid--calendar week-v2-grid--day${breakdownOpen ? " week-v2-grid--side-open" : ""}`}>
        <div className="day-split__main">
          {pageHead}
          {dayModel && daySource ? (
            <AgentsDayTimeline
              colorMode={colorMode}
              model={dayModel}
              source={daySource}
              intervalMinutes={flowIntervalMinutes}
              intensityBands={intensityScale.bands}
              onColorModeChange={setColorMode}
              onIntervalChange={onFlowIntervalChange}
              startOfDayMinutes={boundaryMinutes}
              currentMinuteOfDay={isCurrentPeriod ? liveMinuteOfDay : null}
            />
          ) : null}
          <div className="dashboard-insight-stack">
            <AgentsRhythmPanel sources={scopedSources} startOfDayMinutes={boundaryMinutes} />
          </div>
          <RepoUsagePanel
            repos={repos}
            totalCommits={totalCommits}
            showActive
            periodLabel="today"
            repoProviders={repoProviders}
            startOfDayMinutes={boundaryMinutes}
          />
        </div>
        {breakdownPanel}
      </div>
    </div>
  );
}
