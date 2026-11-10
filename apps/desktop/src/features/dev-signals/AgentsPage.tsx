/**
 * Your Agents — a sibling of Your Day, built from Your Day's own grammar.
 *
 * An earlier pass composed this page out of the Trends vocabulary (eyebrow
 * panels, a top KPI strip, a segmented range switch in the title row) and it
 * read as a foreign surface. This version reuses the day view's actual
 * skeleton, so the two pages feel like siblings:
 *
 *   - the "Focused for Xh" headline pattern → cumulative agent work
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
import type { CSSProperties, FocusEvent, MouseEvent, ReactNode } from "react";

import {
  logicalMinuteOfDay,
  normalizeStartOfDayMinutes,
  type FlowBlock,
  type FlowIntervalMinutes,
} from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { DateNavigator } from "../../components/DateNavigator";
import { DayWeekToggle } from "../../components/DayWeekToggle";
import { getViewportSafeHoverPosition } from "../../components/hoverCardPosition";
import { MetricTile } from "../../components/MetricTile";
import { ModalPresence } from "../../components/ModalPresence";
import {
  clockHourForLogicalHour,
  formatLocalizedCalendarMinuteLabel,
  formatLocalizedCompactDurationFromSeconds,
  formatLocalizedCompactHourLabel,
  formatLocalizedDateRangeLabel,
  formatLocalizedHourLabel,
  formatLocalizedQuarterHourLabel,
  localeForDisplayLanguage,
} from "../../lib/formatting";
import { BreakdownSidePanel } from "../dashboard/BreakdownSidePanelChrome";
import { getDashboardPeriodRange, shiftDashboardPeriodDay } from "../dashboard/dashboardPeriods";
import { WEEK_DASHBOARD_AXIS_SCALE_DEFAULT_PERCENT, formatWeekDashboardAxisPixelValue, weekDashboardAxisScalePercentToHourHeight } from "../dashboard/weekDashboardAxisScale";
import { WeekCalendarBoard } from "../dashboard/weekCalendarBoard";
import { persistDashboardBreakdownOpen, resolveInitialDashboardBreakdownOpen, type StartOfWeek } from "../settings/settingsStorage";
import { FlowDetailSelect } from "../flow-chart/FlowDetailSelect";
import { FlowChartGrid } from "../flow-chart/FlowChartGrid";
import { FlowChartLegend } from "../flow-chart/FlowChartLegend";
import type { FlowBlockHoverGroup } from "../flow-chart/flowHoverGroups";
import type { ProjectLegendEntry } from "../flow-chart/projectFlowView";
import { useLocalization, type DisplayLanguage, type LocalizationController } from "../localization/LocalizationContext";
import { FOCUS_DRIFT_GRID_PATH } from "../dashboard/focusDriftChart";
import { FOCUS_DRIFT_CHART_BOUNDS, buildSmoothPath, getSmoothPathPointAtX } from "../dashboard/focusDriftGeometry";
import {
  buildAgentsDayModel,
  buildAgentsDayCellGroups,
  buildAgentsGridCells,
  buildAgentsRunSegments,
  buildAgentsRunStretches,
  buildAgentsWeekModel,
  agentMinutesByRepo,
  agentsIntensityBandFor,
  AGENTS_SEGMENT_MINUTES,
  agentsRhythmScaleMax,
  gridRepoLegend,
  repoDominantProviders,
  agentsHourHistogram,
  agentsInsightNumbers,
  formatTokens,
  visibleAgentsIntensityBands,
  type AgentsDayModel,
  type AgentsIntensityBand,
  type AgentsRepoRow,
  type AgentsRunStretch,
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
import { AgentsHoverLayer, type AgentsHoverDetails } from "./AgentsHoverLayer";
import { SshAgentSourcesModal } from "./SshAgentSourcesModal";
import {
  INACTIVE_SSH_AGENT_SOURCE_SYNC_STATUS,
  type SshAgentSourceSyncController,
  type SshAgentSourceSyncStatus,
} from "./useSshAgentSourceSyncController";
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

function formatLogicalClock(logicalMinute: number, startOfDayMinutes: number, language: DisplayLanguage): string {
  const minuteOfDay = clockMinuteForLogicalMinute(logicalMinute, startOfDayMinutes);
  return language !== "en" ? formatLocalizedQuarterHourLabel(minuteOfDay, language) : formatClock(minuteOfDay);
}

function formatAgentDuration(minutes: number, language: DisplayLanguage): string {
  if (minutes > 0 && minutes < 1) return language === "ko" ? "1분 미만" : language === "es" ? "menos de 1 min" : "<1m";
  return language !== "en"
    ? formatLocalizedCompactDurationFromSeconds(Math.round(minutes * 60), language)
    : formatHours(minutes);
}

function localizedWeekday(day: string, language: DisplayLanguage): string {
  return new Intl.DateTimeFormat(localeForDisplayLanguage(language), { weekday: "short" })
    .format(new Date(`${day}T12:00:00`));
}

function formatAgentRunTimeRange(
  start: number,
  end: number,
  startOfDayMinutes: number,
  language: DisplayLanguage,
): string {
  // Agent turns can be shorter than a minute. Floor the opening edge and ceil
  // the closing edge so a real run never reads as a zero-length clock range.
  return `${formatLogicalClock(Math.floor(start), startOfDayMinutes, language)}–${formatLogicalClock(Math.ceil(end), startOfDayMinutes, language)}`;
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

function buildAgentsHoverDetails(
  stretch: AgentsRunStretch,
  id: string,
  boundaryMinutes: number,
  tone: string,
  language: DisplayLanguage,
  flowGroup?: FlowBlockHoverGroup,
): AgentsHoverDetails {
  return {
    id,
    repo: stretch.topRepo,
    timeRangeLabel: formatAgentRunTimeRange(stretch.start, stretch.end, boundaryMinutes, language),
    activeSeconds: Math.round(stretch.activeMinutes * 60),
    peakConcurrency: stretch.peakConcurrency,
    providerLabels: stretch.providers.map(agentToolName),
    modelLabels: stretch.models.map(shortModelName),
    commitCount: stretch.commitCount,
    tone,
    ...(flowGroup ? { flowGroup } : {}),
  };
}

function agentsHoverAriaLabel(details: AgentsHoverDetails, language: DisplayLanguage, t: LocalizationController["t"]): string {
  const repo = details.cellSummary
    ? details.cellSummary.repos.map((entry) => entry.repo ?? t("agents.generic.noRepo")).join(" + ")
    : details.repo ?? t("agents.generic.noRepo");
  const tools = details.providerLabels.join(" + ") || t("agents.generic.unknownProvider");
  return t(details.cellSummary ? "agents.hover.cellAria" : "agents.hover.runAria", {
    repo,
    range: details.timeRangeLabel,
    duration: formatAgentDuration(details.activeSeconds / 60, language),
    peak: details.peakConcurrency,
    tools,
  });
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
  noRepoLabel: string,
): ProjectLegendEntry[] {
  const repoLimit = hasUnlabelled ? 4 : 5;
  const entries: ProjectLegendEntry[] = repoOrder.slice(0, repoLimit).map((repo) => ({
    projectId: repo,
    name: repo,
    color: repoColors.get(repo) ?? AGENTS_UNKNOWN_COLOR,
  }));
  if (hasUnlabelled) entries.push({ projectId: null, name: noRepoLabel, color: AGENTS_UNKNOWN_COLOR });
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
  const { t } = useLocalization();
  return (
    <div className="seg flow-color-mode-control" role="group" aria-label={t("agents.colorMode.aria")}>
      {(["intensity", "repo"] as const).map((id) => (
        <button
          key={id}
          type="button"
          className={colorMode === id ? "on" : undefined}
          aria-pressed={colorMode === id}
          onClick={() => onColorModeChange(id)}
        >
          {t(id === "intensity" ? "agents.colorMode.intensity" : "agents.colorMode.project")}
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
  const { effectiveLanguage, t } = useLocalization();
  const [flowGridElement, setFlowGridElement] = useState<HTMLDivElement | null>(null);
  const [activeKeyboardCellId, setActiveKeyboardCellId] = useState<string | null>(null);
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
        appName: cell.topRepo ?? t("agents.generic.agents"),
        windowTitle: t("agents.generic.peak", { count: cell.concurrency }),
        category: "workspace",
        productivity: "focus",
        durationSeconds: intervalMinutes * 60,
        projectId: cell.topRepo,
        projectColor: color,
        colorKey: cell.topRepo ?? "agents",
      } as FlowBlock);
    }
    return byCell;
  }, [boundaryMinutes, gridCells, colorMode, intensityBands, repoColors, model.day, intervalMinutes, t]);
  const runStretches = useMemo(
    () => buildAgentsRunStretches(source, repoOrder, undefined, intensityBands),
    [intensityBands, repoOrder, source],
  );
  const dayHover = useMemo(() => {
    const groupsByCell = new Map<number, FlowBlockHoverGroup>();
    const detailsById = new Map<string, AgentsHoverDetails>();
    const idsByCell = new Map<number, string>();
    const ariaLabelsById = new Map<string, string>();
    const cellGroups = buildAgentsDayCellGroups(gridCells, intervalMinutes);

    for (const group of cellGroups) {
      const start = group.startMinute;
      const end = group.endMinute;
      const blocks = group.cells.flatMap((cell) => {
        const block = gridBlocks.get(`${clockMinuteForLogicalMinute(cell.minuteOfDay, boundaryMinutes)}`);
        return block ? [block] : [];
      });
      if (blocks.length === 0) continue;
      const block = blocks[0]!;
      const id = `${model.day}:cell:${start}:${end - start}`;
      const activeSeconds = Math.round(group.activeMinutes * 60);
      const flowGroup: FlowBlockHoverGroup = {
        block,
        blocks,
        segmentIds: [],
        startMinuteOfDay: block.minuteOfDay,
        endMinuteOfDay: clockMinuteForLogicalMinute(end, boundaryMinutes),
        durationSeconds: activeSeconds,
      };
      const overlappingStretches = runStretches.filter((stretch) => start < stretch.end && end > stretch.start);
      const surrounding = overlappingStretches.length === 1 ? overlappingStretches[0] : undefined;
      // A coarse cell or sub-run can sit inside a larger multi-stage run.
      const surroundingRangeLabel = surrounding && (surrounding.start < start || surrounding.end > end)
        ? formatAgentRunTimeRange(surrounding.start, surrounding.end, boundaryMinutes, effectiveLanguage)
        : undefined;
      const details: AgentsHoverDetails = {
        id,
        repo: group.topRepo,
        timeRangeLabel: formatAgentRunTimeRange(start, end, boundaryMinutes, effectiveLanguage),
        activeSeconds,
        peakConcurrency: group.concurrency,
        providerLabels: [...new Set(group.repos.flatMap((repo) => repo.providers).map(agentToolName))],
        modelLabels: group.models.map(shortModelName),
        commitCount: group.commitCount,
        tone: block.projectColor ?? AGENTS_UNKNOWN_COLOR,
        flowGroup,
        cellSummary: {
          repos: group.repos.map(({ repo, providers }) => ({
            repo,
            providerLabels: [...new Set(providers.map(agentToolName))],
          })),
          ...(surroundingRangeLabel ? { surroundingRangeLabel } : {}),
        },
      };
      detailsById.set(id, details);
      ariaLabelsById.set(id, agentsHoverAriaLabel(details, effectiveLanguage, t));
      for (const groupedBlock of blocks) {
        groupsByCell.set(groupedBlock.minuteOfDay, flowGroup);
        idsByCell.set(groupedBlock.minuteOfDay, id);
      }
    }

    return {
      groupsByCell,
      detailsById,
      readOnlyPreview: { idsByCell, ariaLabelsById },
    };
  }, [boundaryMinutes, effectiveLanguage, gridBlocks, gridCells, intervalMinutes, model.day, runStretches, t]);
  const keyboardCellIds = useMemo(() => [...dayHover.detailsById.keys()], [dayHover.detailsById]);
  const keyboardTabStopId = activeKeyboardCellId && dayHover.detailsById.has(activeKeyboardCellId)
    ? activeKeyboardCellId
    : keyboardCellIds[0];
  const readOnlyPreview = useMemo(() => ({ ...dayHover.readOnlyPreview, tabStopId: keyboardTabStopId }), [dayHover.readOnlyPreview, keyboardTabStopId]);

  const legendEntries = useMemo<ProjectLegendEntry[]>(() => {
    if (colorMode === "repo") {
      return repoLegendEntries(
        repoLegend,
        repoColors,
        Array.from(gridCells.values()).some((cell) => cell.topRepo === null),
        t("agents.generic.noRepo"),
      );
    }
    const peakConcurrency = Math.max(0, ...Array.from(gridCells.values(), (cell) => cell.concurrency));
    return visibleAgentsIntensityBands(peakConcurrency, intensityBands).map((band) => ({
      projectId: band.id,
      name: band.label,
      color: intensityBandColor(band),
    }));
  }, [colorMode, gridCells, intensityBands, repoLegend, repoColors, t]);

  return (
    /* Same chart box the day view wraps its flow chart in. Inside
       .day-split__main it follows Your Day's unframed flow chart. */
    <div className="flow-breakdown-layout flow-breakdown-layout--full">
      <div className="flow-breakdown-layout__chart">
        {/* The card carries FlowChartView's exact style contract — all four
            CSS variables plus the data attributes — so every flow-chart.css
            rule (cell heights inside the breakdown box included) applies
            unchanged. */}
        <section
          className="flow-chart-card agents-flow-card"
          aria-label={t("agents.timeline.aria")}
          data-flow-interval={intervalMinutes}
          data-flow-color-mode="project"
          onFocusCapture={(event) => {
            const id = (event.target as HTMLElement).dataset.agentHoverId;
            if (id) setActiveKeyboardCellId(id);
          }}
          onKeyDown={(event) => {
            const id = (event.target as HTMLElement).dataset.agentHoverId;
            if (!id || event.altKey || event.ctrlKey || event.metaKey) return;
            const index = keyboardCellIds.indexOf(id);
            if (index < 0) return;
            const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? keyboardCellIds.length - 1
              : event.key === "ArrowDown" || event.key === "ArrowRight" ? Math.min(index + 1, keyboardCellIds.length - 1)
                : event.key === "ArrowUp" || event.key === "ArrowLeft" ? Math.max(index - 1, 0) : null;
            if (nextIndex === null) return;
            event.preventDefault();
            const nextId = keyboardCellIds[nextIndex];
            const target = Array.from(flowGridElement?.querySelectorAll<HTMLElement>("[data-agent-hover-id]") ?? [])
              .find((element) => element.dataset.agentHoverId === nextId);
            target?.focus();
          }}
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
            hoverGroupsByCell={dayHover.groupsByCell}
            intervalMinutes={intervalMinutes}
            readOnlyPreview={readOnlyPreview}
            setFlowGridElement={setFlowGridElement}
          />
          <AgentsHoverLayer
            bodyElement={flowGridElement}
            detailsById={dayHover.detailsById}
            highlight={{ gridElement: flowGridElement, intervalMinutes, boundaryMinutes }}
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
function RepoUsagePanel({ repos, totalCommits, showActive, periodLabel, repoProviders, startOfDayMinutes, topAgentRepo }: {
  readonly repos: readonly AgentsRepoRow[];
  readonly totalCommits: number;
  readonly showActive: boolean;
  readonly periodLabel: string;
  /** repo → agent provider that dominated it; drives the row icon. */
  readonly repoProviders: ReadonlyMap<string, string>;
  readonly startOfDayMinutes: number;
  readonly topAgentRepo?: { readonly repo: string; readonly duration: string } | null;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const [featured, ...rest] = repos.slice(0, 6);
  const activityAria = t("agents.repo.activityAria", { period: periodLabel });

  if (!featured) {
    return (
      <section className="app-usage-panel app-usage-panel--short-compact editorial-panel editorial-panel--soft" aria-label={activityAria}>
        <div className="app-usage-empty empty-state">
          <span className="eyebrow">{t("agents.repo.noCommits")}</span>
          <strong>{topAgentRepo ? t("agents.repo.activeWithoutCommits", { repo: topAgentRepo.repo, duration: topAgentRepo.duration }) : t("agents.repo.noActivity")}</strong>
          <p>{topAgentRepo ? t("agents.repo.activeWithoutCommitsDetail") : t("agents.repo.noActivityDetail")}</p>
        </div>
      </section>
    );
  }

  const featuredShare = shareOfCommits(featured, totalCommits);

  return (
    <section className="app-usage-panel app-usage-panel--short-compact editorial-panel editorial-panel--soft" aria-label={activityAria}>
      <div className="app-usage-content">
        <article
          className="app-usage-feature"
          style={{ "--app-usage-share": `${featuredShare}%` } as ShareStyle}
          aria-label={t("agents.repo.mostActiveAria", { repo: featured.repo })}
        >
          <div className="app-usage-feature__topline">
            <div className="app-usage-feature__identity">
              <span className="usage-identity-icon usage-identity-icon--md">
                <AgentToolGlyph provider={repoProviders.get(featured.repo)} fallbackName={featured.repo} size="md" />
              </span>
              <div>
                <span className="app-usage-kicker">{t("agents.repo.mostActive")}</span>
                <div className="app-usage-feature__title">
                  <span className="app-usage-rank app-usage-rank--inline" aria-label={t("agents.repo.rank", { rank: 1 })}>#1</span>
                  <strong>{featured.repo}</strong>
                </div>
                <p>{showActive
                  ? t("agents.repo.activeRange", { range: `${formatLogicalClock(featured.firstCommitMin, startOfDayMinutes, effectiveLanguage)}–${formatLogicalClock(featured.lastCommitMin, startOfDayMinutes, effectiveLanguage)}` })
                  : t("agents.repo.acrossPeriod", { period: periodLabel })}</p>
              </div>
            </div>
            <div className="app-usage-feature__measure">
              <strong>{t("agents.repo.commitCount", { count: featured.commitCount })}</strong>
            </div>
          </div>
          <div className="app-usage-feature__meter-block">
            <div className="app-usage-feature__meter-copy">
              <span>{t("agents.repo.share")}</span>
              <strong>{Math.round(featuredShare)}%</strong>
            </div>
            <div className="app-usage-feature__meter" aria-label={t("agents.repo.shareAria", { repo: featured.repo, percent: Math.round(featuredShare) })}>
              <span />
            </div>
          </div>
          <dl className="app-usage-feature__stats">
            <div><dt>{t("agents.repo.commits")}</dt><dd>{featured.commitCount}</dd></div>
            <div><dt>{t("agents.repo.added")}</dt><dd>+{featured.insertions.toLocaleString()}</dd></div>
            <div><dt>{t("agents.repo.removed")}</dt><dd>−{featured.deletions.toLocaleString()}</dd></div>
          </dl>
        </article>

        {rest.length > 0 ? (
          <ol className="app-usage-list" aria-label={t("agents.repo.rankedAria")}>
            {rest.map((repo, index) => {
              const share = shareOfCommits(repo, totalCommits);
              return (
                <li className="app-usage-row" key={repo.repo}>
                  <div className="app-usage-rank" aria-label={t("agents.repo.rank", { rank: index + 2 })}>
                    {String(index + 2).padStart(2, "0")}
                  </div>
                  <div className="app-usage-row__main">
                    <span className="usage-identity-icon usage-identity-icon--sm">
                      <AgentToolGlyph provider={repoProviders.get(repo.repo)} fallbackName={repo.repo} size="sm" />
                    </span>
                    <div className="app-usage-row__copy">
                      <div className="app-usage-row__title"><strong>{repo.repo}</strong></div>
                      <small>{showActive
                        ? t("agents.repo.activeRange", { range: `${formatLogicalClock(repo.firstCommitMin, startOfDayMinutes, effectiveLanguage)}–${formatLogicalClock(repo.lastCommitMin, startOfDayMinutes, effectiveLanguage)}` })
                        : formatChurn(repo.insertions, repo.deletions)}</small>
                    </div>
                  </div>
                  <div className="app-usage-row__bar" aria-label={t("agents.repo.shareAria", { repo: repo.repo, percent: Math.round(share) })}>
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
  const { effectiveLanguage, t } = useLocalization();
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
      return repoLegendEntries(repoOrder, repoColors, hasUnlabelled, t("agents.generic.noRepo"));
    }
    const peakConcurrency = Math.max(0, ...models.map((model) => model.concurrencyPeak));
    return visibleAgentsIntensityBands(peakConcurrency, intensityBands).map((band) => ({
      projectId: band.id,
      name: band.label,
      color: intensityBandColor(band),
    }));
  }, [colorMode, hasUnlabelled, intensityBands, models, repoColors, repoOrder, t]);
  const { eventsByDay, hoverDetailsById } = useMemo(() => {
    const nextEventsByDay = new Map<string, {
      id: string;
      start: number;
      end: number;
      activeMinutes: number;
      label: string;
      peakConcurrency: number;
      providerLabel: string;
      intensityBandId: AgentsIntensityBand["id"];
      intensityBand: AgentsIntensityBand;
      tone: string;
      segments: {
        id: string;
        start: number;
        end: number;
        tone: string;
        intensityBandId: AgentsIntensityBand["id"];
        intensityBand: AgentsIntensityBand;
      }[];
      foreground?: string;
    }[]>();
    const nextHoverDetailsById = new Map<string, AgentsHoverDetails>();
    for (const source of sources) {
      const stretches = buildAgentsRunStretches(source, repoOrder, undefined, intensityBands);
      // The Week paints the same cells the Day view uses, so one run reads as
      // the shape of its hours instead of a single block of its peak.
      const cells = buildAgentsGridCells(source, AGENTS_SEGMENT_MINUTES, repoOrder);
      const events = stretches.map((stretch) => {
        // A run keeps the same identity across Intensity and Project. Colour
        // changes presentation only; it never replaces the focused node.
        const id = `${source.day}:run:${stretch.start}`;
        const providerLabels = stretch.providers.map(agentToolName);
        const providerLabel = providerLabels.join(" + ");
        const label = stretch.topRepo ?? (providerLabels.length === 1 ? providerLabels[0]! : t("agents.hover.agentRun"));
        const tone = colorMode === "repo"
          ? (stretch.topRepo ? repoColors.get(stretch.topRepo) ?? AGENTS_UNKNOWN_COLOR : AGENTS_UNKNOWN_COLOR)
          : intensityBandColor(stretch.intensityBand);
        nextHoverDetailsById.set(id, buildAgentsHoverDetails(
          stretch,
          id,
          boundaryMinutes,
          tone,
          effectiveLanguage,
        ));
        const segments = buildAgentsRunSegments(stretch, cells, AGENTS_SEGMENT_MINUTES, intensityBands).map((segment) => {
          const segmentId = id + ":seg:" + segment.start;
          const segmentTone = colorMode === "repo"
            ? (segment.topRepo ? repoColors.get(segment.topRepo) ?? AGENTS_UNKNOWN_COLOR : AGENTS_UNKNOWN_COLOR)
            : intensityBandColor(segment.intensityBand);
          nextHoverDetailsById.set(segmentId, buildAgentsHoverDetails(
            segment,
            segmentId,
            boundaryMinutes,
            segmentTone,
            effectiveLanguage,
          ));
          return {
            id: segmentId,
            start: segment.start,
            end: segment.end,
            tone: segmentTone,
            intensityBandId: segment.intensityBand.id,
            intensityBand: segment.intensityBand,
          };
        });
        return {
          id,
          start: stretch.start,
          end: stretch.end,
          activeMinutes: stretch.activeMinutes,
          label,
          peakConcurrency: stretch.peakConcurrency,
          providerLabel,
          intensityBandId: stretch.intensityBand.id,
          intensityBand: stretch.intensityBand,
          tone,
          segments,
          ...(colorMode === "repo" ? { foreground: readableForeground(tone) } : {}),
        };
      });
      nextEventsByDay.set(source.day, events);
    }
    return { eventsByDay: nextEventsByDay, hoverDetailsById: nextHoverDetailsById };
  }, [boundaryMinutes, colorMode, effectiveLanguage, intensityBands, repoColors, repoOrder, sources, t]);
  const orderedEventIds = useMemo(
    () => week.days.flatMap((day) => (eventsByDay.get(day.day) ?? []).map((event) => event.id)),
    [eventsByDay, week.days],
  );
  const keyboardTabStopId = activeKeyboardEventId && hoverDetailsById.has(activeKeyboardEventId)
    ? activeKeyboardEventId
    : (orderedEventIds[0] ?? null);
  const todayIndex = week.days.findIndex((day) => day.day === todayDay);
  const isCurrentWeek = todayIndex >= 0;
  const currentLogicalMinute = logicalMinuteOfDay(currentMinuteOfDay, boundaryMinutes);
  const currentCalendarOffset = isCurrentWeek ? (currentLogicalMinute / 60) * AGENTS_WEEK_HOUR_HEIGHT : null;
  const currentCalendarLabel = isCurrentWeek
    ? formatLocalizedCalendarMinuteLabel(todayDay, currentLogicalMinute, effectiveLanguage, boundaryMinutes)
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
      <section className="week-v2-calendar editorial-panel editorial-panel--soft agents-week-calendar" aria-label={t("agents.week.calendarAria")}>
        {header}
        <div className="week-v2-calendar__legend" aria-label={t("agents.week.legendAria")}>
          <div className="flow-chart-head__actions">
            <div className="flow-chart-head__controls">
              <AgentsColorModeControl colorMode={colorMode} onColorModeChange={onColorModeChange} />
            </div>
            <AgentsTimelineLegend entries={legendEntries} />
          </div>
        </div>
        <WeekCalendarBoard scrollerRef={calendarScrollerRef}>
          <div className="week-v2-calendar__day-head" aria-hidden="true">
            <span />
            {week.days.map((day) => {
              const [, , dayOfMonth] = day.day.split("-").map(Number);
              const weekday = new Date(`${day.day}T12:00:00`).getDay();
              const isWeekend = weekday === 0 || weekday === 6;
              return (
                <span className={`${isWeekend ? "is-weekend" : ""}${day.day === todayDay ? " is-today" : ""}`.trim() || undefined} key={day.day}>
                  <strong>{localizedWeekday(day.day, effectiveLanguage)}</strong>
                  <small>{dayOfMonth}</small>
                </span>
              );
            })}
          </div>
          <div className="week-v2-calendar__scroller" ref={calendarScrollerRef}>
          <div className="week-v2-calendar__body" ref={setCalendarBodyElement} style={{ height: formatWeekDashboardAxisPixelValue(24 * AGENTS_WEEK_HOUR_HEIGHT) }}>
            <div className="week-v2-calendar__time-rail">
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour} style={{ top: formatWeekDashboardAxisPixelValue(hour * AGENTS_WEEK_HOUR_HEIGHT) }}>{formatLocalizedCompactHourLabel(clockHourForLogicalHour(hour, boundaryMinutes), effectiveLanguage)}</span>
              ))}
              <span className="week-v2-calendar__time-rail-endpoint" style={{ top: formatWeekDashboardAxisPixelValue(24 * AGENTS_WEEK_HOUR_HEIGHT) }}>
                {formatLocalizedCompactHourLabel(clockHourForLogicalHour(24, boundaryMinutes), effectiveLanguage)}
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
                        className={`week-v2-calendar__event week-v2-calendar__event--focus agents-week-calendar__event${event.segments.length ? " agents-week-calendar__event--segmented" : ""}${isShort ? " week-v2-calendar__event--short week-v2-calendar__event--tiny" : ""}`}
                        style={{
                          top: formatWeekDashboardAxisPixelValue((event.start / 60) * AGENTS_WEEK_HOUR_HEIGHT),
                          height: formatWeekDashboardAxisPixelValue(heightPx),
                          left: "1px",
                          width: "calc(100% - 7px)",
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
                        aria-label={t("agents.week.runAria", {
                          weekday: localizedWeekday(day.day, effectiveLanguage),
                          day: day.day,
                          label: event.label,
                          provider: event.providerLabel || t("agents.generic.unknownProvider"),
                          peak: event.peakConcurrency,
                          range: formatAgentRunTimeRange(event.start, event.end, boundaryMinutes, effectiveLanguage),
                          duration: formatAgentDuration(event.activeMinutes, effectiveLanguage),
                        })}
                      >
                        {event.segments.map((segment) => (
                          <span
                            key={segment.id}
                            className="agents-week-calendar__segment"
                            style={{
                              top: formatWeekDashboardAxisPixelValue(((segment.start - event.start) / 60) * AGENTS_WEEK_HOUR_HEIGHT),
                              height: formatWeekDashboardAxisPixelValue(Math.max(1, ((segment.end - segment.start) / 60) * AGENTS_WEEK_HOUR_HEIGHT)),
                              "--segment-tone": segment.tone,
                            } as CSSProperties}
                            data-agent-hover-id={segment.id}
                            data-agent-intensity-band={segment.intensityBandId}
                            aria-hidden="true"
                          />
                        ))}
                        {!isShort ? <strong>{formatAgentDuration(event.activeMinutes, effectiveLanguage)}</strong> : null}
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
                aria-label={t("agents.week.currentTime", { time: currentCalendarLabel })}
              >
                <span className="week-v2-calendar__now-label">{currentCalendarLabel}</span>
              </div>
            ) : null}
          </div>
          </div>
        </WeekCalendarBoard>
      </section>
      <AgentsHoverLayer bodyElement={calendarBodyElement} detailsById={hoverDetailsById} />
    </>
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
  const { t } = useLocalization();
  return (
    <div className="kpi-row kpi-row--insights insight-summary" aria-label={t("agents.stats.detailAria")}>
      {entries.map((entry) => (
        <MetricTile key={entry.label} label={entry.label} value={entry.value} detail={entry.detail} />
      ))}
    </div>
  );
}

function repoCountDetail(count: number, t: LocalizationController["t"]): string {
  return count === 1 ? t("agents.stats.acrossOneRepo") : t("agents.stats.acrossRepos", { count });
}

function agentsDayStatEntries(
  source: AgentsDaySource,
  model: AgentsDayModel,
  startOfDayMinutes: number,
  language: DisplayLanguage,
  t: LocalizationController["t"],
): AgentsStatEntry[] {
  const numbers = agentsInsightNumbers(source, model, startOfDayMinutes);
  return [
    // Commits lead: they are the day's output, and the sentence block above
    // deliberately stops at "how much ran" so this grid owns the result side.
    { label: t("agents.stats.commits"), value: String(model.commitCount), detail: t("agents.stats.perAgentHour", { value: numbers.commitsPerAgentHour.toFixed(1) }) },
    { label: t("agents.stats.netLines"), value: `${numbers.netLines >= 0 ? "+" : ""}${numbers.netLines.toLocaleString()}`, detail: repoCountDetail(model.repos.length, t) },
    { label: t("agents.stats.sessions"), value: String(numbers.sessions), detail: t("agents.stats.distinct") },
    { label: t("agents.stats.tokens"), value: formatTokens(numbers.tokens), detail: numbers.sessions > 0 ? t("agents.stats.perSession", { value: formatTokens(numbers.tokensPerSession) }) : undefined },
    { label: t("agents.stats.longestRun"), value: formatAgentDuration(numbers.longestStretchMinutes, language), detail: t("agents.stats.fromTime", { time: formatLogicalClock(numbers.longestStretchStart, startOfDayMinutes, language) }) },
    { label: t("agents.stats.medianRun"), value: language === "ko" ? `${Math.round(numbers.medianStretchMinutes)}분` : language === "es" ? `${Math.round(numbers.medianStretchMinutes)} min` : `${Math.round(numbers.medianStretchMinutes)}m`, detail: t("agents.stats.perStretch") },
    { label: t("agents.stats.activeSpan"), value: formatAgentDuration(numbers.activeSpanMinutes, language), detail: numbers.firstActivityMinute !== null && numbers.lastActivityMinute !== null ? `${formatLogicalClock(numbers.firstActivityMinute, startOfDayMinutes, language)}–${formatLogicalClock(numbers.lastActivityMinute, startOfDayMinutes, language)}` : undefined },
    { label: t("agents.stats.nightShare"), value: `${Math.round(numbers.nightSharePercent)}%`, detail: t("agents.stats.nightHours") },
  ];
}

/**
 * Proposal panel 3 — hour-of-day rhythm, in the FocusDrift panel chrome.
 * When agents run vs when commits land, as a 24-bin histogram.
 */
function AgentsRhythmPanel({ sources, startOfDayMinutes }: { readonly sources: readonly AgentsDaySource[]; readonly startOfDayMinutes: number }) {
  return <AgentsRhythmPanelBody sources={sources} startOfDayMinutes={startOfDayMinutes} />;
}

function agentsWeekStatEntries(
  sources: readonly AgentsDaySource[],
  models: readonly AgentsDayModel[],
  language: DisplayLanguage,
  t: LocalizationController["t"],
): AgentsStatEntry[] {
  const week = buildAgentsWeekModel(models);
  const tokens = sources.reduce((sum, source) => sum + (source.tokens ?? 0), 0);
  const sessions = sources.reduce((sum, source) => sum + (source.sessions ?? 0), 0);
  const activeDays = week.days.filter((day) => day.cumulativeMinutes > 0).length;
  const netLines = week.insertions - week.deletions;
  const agentHours = week.cumulativeMinutes / 60;
  // The busiest single day gives the week's spread a reference point, and
  // keeps the tile count even so the two-up grid has no orphan cell.
  const peakDay = week.days.reduce(
    (best, day) => (day.cumulativeMinutes > best.cumulativeMinutes ? day : best),
    week.days[0] ?? { day: "", weekdayLabel: "—", wallClockMinutes: 0, cumulativeMinutes: 0, attentionMinutes: 0, commitCount: 0 },
  );
  return [
    { label: t("agents.stats.commits"), value: String(week.commitCount), detail: agentHours > 0 ? t("agents.stats.perAgentHour", { value: (week.commitCount / agentHours).toFixed(1) }) : undefined },
    { label: t("agents.stats.netLines"), value: `${netLines >= 0 ? "+" : ""}${netLines.toLocaleString()}`, detail: repoCountDetail(week.repos.length, t) },
    { label: t("agents.stats.sessions"), value: String(sessions), detail: t("agents.stats.activeDays", { count: activeDays }) },
    { label: t("agents.stats.tokens"), value: formatTokens(tokens), detail: sessions > 0 ? t("agents.stats.perSession", { value: formatTokens(tokens / sessions) }) : undefined },
    { label: t("agents.stats.dailyAverage"), value: formatAgentDuration(activeDays > 0 ? week.cumulativeMinutes / activeDays : 0, language), detail: t("agents.stats.perActiveDay") },
    { label: t("agents.stats.peakDay"), value: formatAgentDuration(peakDay.cumulativeMinutes, language), detail: peakDay.day ? localizedWeekday(peakDay.day, language) : "—" },
    { label: t("agents.stats.churn"), value: `+${formatTokens(week.insertions)}`, detail: t("agents.stats.removed", { count: formatTokens(week.deletions) }) },
    { label: t("agents.stats.topRepo"), value: week.repos[0]?.repo ?? "—", detail: week.repos[0] ? t("agents.repo.commitCount", { count: week.repos[0].commitCount }) : undefined },
  ];
}

type AgentsRhythmHoverKind = "agent" | "commits";

type AgentsRhythmHoverState = {
  readonly hour: number;
  readonly kind: AgentsRhythmHoverKind;
  readonly workMinutes: number;
  readonly commits: number;
  readonly markerX: number;
  readonly markerY: number;
  readonly x: number;
  readonly y: number;
};

const AGENTS_RHYTHM_HOVER_CARD_ID = "agents-rhythm-hover-card";
const AGENTS_RHYTHM_HOUR_HALF_WIDTH = (
  (FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left) / (24 * 2)
);
const AGENTS_RHYTHM_HOVER_MAX_Y_DISTANCE = 24;

function hasUsableRhythmBounds(bounds: DOMRect | null): bounds is DOMRect {
  return Boolean(
    bounds
    && Number.isFinite(bounds.left)
    && Number.isFinite(bounds.top)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0,
  );
}

function formatAgentsRhythmHourRange(
  hour: number,
  startOfDayMinutes: number,
  language: DisplayLanguage,
): string {
  const start = formatLocalizedHourLabel(clockHourForLogicalHour(hour, startOfDayMinutes), language);
  const end = formatLocalizedHourLabel(clockHourForLogicalHour(hour + 1, startOfDayMinutes), language);
  return `${start}–${end}`;
}

function AgentsRhythmHoverCard({
  hover,
  startOfDayMinutes,
}: {
  readonly hover: AgentsRhythmHoverState;
  readonly startOfDayMinutes: number;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const workDuration = formatAgentDuration(hover.workMinutes, effectiveLanguage);
  const timeRange = formatAgentsRhythmHourRange(hover.hour, startOfDayMinutes, effectiveLanguage);
  const position = getViewportSafeHoverPosition(hover.x, hover.y, cardSize.width, cardSize.height);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const currentCard = card;

    function updateCardSize() {
      const bounds = currentCard.getBoundingClientRect();
      setCardSize((current) => (
        current.width === bounds.width && current.height === bounds.height
          ? current
          : { width: bounds.width, height: bounds.height }
      ));
    }

    updateCardSize();
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(updateCardSize) : null;
    resizeObserver?.observe(currentCard);
    window.addEventListener("resize", updateCardSize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateCardSize);
    };
  }, [effectiveLanguage, hover.commits, hover.hour, hover.workMinutes]);

  return (
    <div
      id={AGENTS_RHYTHM_HOVER_CARD_ID}
      ref={cardRef}
      className={`focus-drift-hover-card agents-rhythm-hover-card agents-rhythm-hover-card--${hover.kind}`}
      role="tooltip"
      style={position}
    >
      <div className="focus-drift-hover-card__head">
        <div className="focus-drift-hover-card__when">
          <strong>{timeRange}</strong>
          <span className="focus-drift-hover-card__verdict">{t("agents.rhythm.hoverTitle")}</span>
        </div>
        <span className="focus-drift-hover-card__tracked">{t("agents.rhythm.hoverWindow")}</span>
      </div>
      <span className="sr-only">
        {t("agents.rhythm.hoverPointAria", {
          series: t(hover.kind === "agent" ? "agents.rhythm.agentTime" : "agents.rhythm.commits"),
          time: timeRange,
          duration: workDuration,
          count: hover.commits,
        })}
      </span>
      <div className="focus-drift-hover-card__duo" aria-hidden="true">
        <div className={`focus-drift-hover-card__col agents-rhythm-hover-card__col--agent${hover.kind === "agent" ? " is-active" : ""}`}>
          <span className="focus-drift-hover-card__label">
            <span className="agents-rhythm-hover-card__dot" />
            {t("agents.rhythm.agentTime")}
          </span>
          <div className="focus-drift-hover-card__value"><strong>{workDuration}</strong></div>
        </div>
        <div className={`focus-drift-hover-card__col agents-rhythm-hover-card__col--commits${hover.kind === "commits" ? " is-active" : ""}`}>
          <span className="focus-drift-hover-card__label">
            <span className="agents-rhythm-hover-card__dot agents-rhythm-hover-card__dot--commits" />
            {t("agents.rhythm.commits")}
          </span>
          <div className="focus-drift-hover-card__value"><strong>{hover.commits}</strong></div>
        </div>
      </div>
    </div>
  );
}

/**
 * Agent rhythm as the timeline dashboard's line chart: the focus/drift plot's
 * own SVG coordinate system, smoothing spline, grid, scale, and axis classes,
 * with the agent-minutes curve solid (focus tone) and commits dashed (drift's
 * line treatment in the neutral grey commits already use here).
 */
function AgentsRhythmPanelBody({ sources, startOfDayMinutes }: { readonly sources: readonly AgentsDaySource[]; readonly startOfDayMinutes: number }) {
  const { effectiveLanguage, t } = useLocalization();
  const histogram = useMemo(() => agentsHourHistogram(sources), [sources]);
  const [rhythmHover, setRhythmHover] = useState<AgentsRhythmHoverState | null>(null);
  const agentWorkPeakMinutes = Math.max(0, ...histogram.agentWorkMinutes);
  const agentWorkScaleMaxMinutes = agentsRhythmScaleMax(agentWorkPeakMinutes);
  const commitPeak = Math.max(0, ...histogram.commits);
  const commitScaleMax = Math.max(1, commitPeak);

  useEffect(() => setRhythmHover(null), [histogram]);

  const { agentPath, commitsPath, agentAreaPath, agentPoints, commitPoints, axisTicks } = useMemo(() => {
    const width = FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left;
    const height = FOCUS_DRIFT_CHART_BOUNDS.bottom - FOCUS_DRIFT_CHART_BOUNDS.top;
    const pointAt = (hour: number, ratio: number) => ({
      x: FOCUS_DRIFT_CHART_BOUNDS.left + ((hour + 0.5) / 24) * width,
      y: FOCUS_DRIFT_CHART_BOUNDS.bottom - ratio * height,
    });
    const agentPoints = histogram.agentWorkMinutes.map((minutes, hour) => {
      const point = pointAt(hour, minutes / agentWorkScaleMaxMinutes);
      return { x: point.x, focusY: point.y, driftY: point.y };
    });
    const commitPoints = histogram.commits.map((count, hour) => {
      const point = pointAt(hour, count / commitScaleMax);
      return { x: point.x, focusY: point.y, driftY: point.y };
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
      agentPoints,
      commitPoints,
      axisTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
        hour,
        x: FOCUS_DRIFT_CHART_BOUNDS.left + ((hour + 0.5) / 24) * width,
        label: formatLocalizedHourLabel(clockHourForLogicalHour(hour, startOfDayMinutes), effectiveLanguage),
      })),
    };
  }, [agentWorkScaleMaxMinutes, commitScaleMax, effectiveLanguage, histogram, startOfDayMinutes]);

  const hoverHours = histogram.agentWorkMinutes
    .map((workMinutes, hour) => ({ hour, workMinutes, commits: histogram.commits[hour] ?? 0 }))
    .filter(({ workMinutes, commits }) => workMinutes > 0 || commits > 0);

  function hoverStateFor(
    hour: number,
    kind: AgentsRhythmHoverKind,
    x: number,
    y: number,
  ): AgentsRhythmHoverState | null {
    const sourcePoint = kind === "agent" ? agentPoints[hour] : commitPoints[hour];
    const points = kind === "agent" ? agentPoints : commitPoints;
    if (!sourcePoint) return null;
    const marker = getSmoothPathPointAtX(points, "focusY", sourcePoint.x);
    return {
      hour,
      kind,
      workMinutes: histogram.agentWorkMinutes[hour] ?? 0,
      commits: histogram.commits[hour] ?? 0,
      markerX: marker?.x ?? sourcePoint.x,
      markerY: marker?.y ?? sourcePoint.focusY,
      x,
      y,
    };
  }

  function updatePointerHover(event: MouseEvent<SVGRectElement>) {
    const svgBounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? null;
    if (
      !hasUsableRhythmBounds(svgBounds)
      || !Number.isFinite(event.clientX)
      || !Number.isFinite(event.clientY)
      || hoverHours.length === 0
    ) {
      setRhythmHover(null);
      return;
    }

    const chartX = ((event.clientX - svgBounds.left) / svgBounds.width) * 100;
    const chartY = ((event.clientY - svgBounds.top) / svgBounds.height) * 100;
    const nearest = hoverHours.reduce((best, candidate) => {
      const bestPoint = agentPoints[best.hour];
      const candidatePoint = agentPoints[candidate.hour];
      if (!bestPoint || !candidatePoint) return best;
      return Math.abs(candidatePoint.x - chartX) < Math.abs(bestPoint.x - chartX) ? candidate : best;
    });
    const nearestPoint = agentPoints[nearest.hour];
    if (!nearestPoint || Math.abs(nearestPoint.x - chartX) > AGENTS_RHYTHM_HOUR_HALF_WIDTH) {
      setRhythmHover(null);
      return;
    }

    const candidates = ([
      nearest.workMinutes > 0 ? hoverStateFor(nearest.hour, "agent", event.clientX, event.clientY) : null,
      nearest.commits > 0 ? hoverStateFor(nearest.hour, "commits", event.clientX, event.clientY) : null,
    ] as const).filter((candidate): candidate is AgentsRhythmHoverState => candidate !== null);
    const closest = candidates.reduce<AgentsRhythmHoverState | null>((best, candidate) => (
      !best || Math.abs(candidate.markerY - chartY) < Math.abs(best.markerY - chartY) ? candidate : best
    ), null);
    if (!closest || Math.abs(closest.markerY - chartY) > AGENTS_RHYTHM_HOVER_MAX_Y_DISTANCE) {
      setRhythmHover(null);
      return;
    }
    setRhythmHover(closest);
  }

  function updateKeyboardHover(
    hour: number,
    kind: AgentsRhythmHoverKind,
    event: FocusEvent<SVGCircleElement>,
  ) {
    const marker = hoverStateFor(hour, kind, 0, 0);
    if (!marker) return;
    const svgBounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect() ?? null;
    if (hasUsableRhythmBounds(svgBounds)) {
      setRhythmHover({
        ...marker,
        x: svgBounds.left + (marker.markerX / 100) * svgBounds.width,
        y: svgBounds.top + (marker.markerY / 100) * svgBounds.height,
      });
      return;
    }
    const targetBounds = event.currentTarget.getBoundingClientRect();
    setRhythmHover({
      ...marker,
      x: targetBounds.left + targetBounds.width / 2,
      y: targetBounds.top + targetBounds.height / 2,
    });
  }

  function pointAriaLabel(hour: number, kind: AgentsRhythmHoverKind): string {
    return t("agents.rhythm.hoverPointAria", {
      series: t(kind === "agent" ? "agents.rhythm.agentTime" : "agents.rhythm.commits"),
      time: formatAgentsRhythmHourRange(hour, startOfDayMinutes, effectiveLanguage),
      duration: formatAgentDuration(histogram.agentWorkMinutes[hour] ?? 0, effectiveLanguage),
      count: histogram.commits[hour] ?? 0,
    });
  }

  return (
    <section className="editorial-panel editorial-panel--soft insight-chart-panel">
      <div className="insight-panel-head">
        <span className="label-mono">{t("agents.rhythm.title")}</span>
        <div className="insight-panel-head__legend">
          <span className="chip green"><span className="sw" style={{ background: "var(--productivity-focus)" }} />{t("agents.rhythm.agentTime")}</span>
          <span className="chip"><span className="sw" style={{ background: "var(--text-soft)" }} />{t("agents.rhythm.commits")}{commitPeak > 0 ? ` · ${t("agents.rhythm.peakCount", { count: commitPeak })}` : ""}</span>
        </div>
      </div>
      <div className="focus-drift agents-rhythm-chart" aria-label={t("agents.rhythm.aria")}>
        <div className="focus-drift__plot">
          <svg className="focus-drift__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="group" aria-label={t("agents.rhythm.graphicAria")}>
            <path className="focus-drift__grid" d={FOCUS_DRIFT_GRID_PATH} />
            <path className="focus-drift__area" d={agentAreaPath} />
            <path className="focus-drift__line focus-drift__line--focus" d={agentPath} />
            <path className="focus-drift__line agents-rhythm-chart__commits-line" d={commitsPath} />
            <rect
              className="focus-drift__line-target agents-rhythm-chart__hover-target"
              x={FOCUS_DRIFT_CHART_BOUNDS.left}
              y={FOCUS_DRIFT_CHART_BOUNDS.top}
              width={FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left}
              height={100 - FOCUS_DRIFT_CHART_BOUNDS.top}
              aria-label={t("agents.rhythm.hoverTarget")}
              onMouseEnter={updatePointerHover}
              onMouseMove={updatePointerHover}
              onMouseLeave={() => setRhythmHover(null)}
            />
            {hoverHours.map(({ hour, workMinutes, commits }) => {
              const agentPoint = agentPoints[hour];
              const commitPoint = commitPoints[hour];
              return (
                <g key={`agents-rhythm-hour-${hour}`}>
                  {workMinutes > 0 && agentPoint ? (
                    <circle
                      className="focus-drift__target focus-drift__target--focus agents-rhythm-chart__target--agent"
                      cx={agentPoint.x}
                      cy={agentPoint.focusY}
                      r="3"
                      role="img"
                      tabIndex={0}
                      aria-label={pointAriaLabel(hour, "agent")}
                      aria-describedby={rhythmHover?.hour === hour && rhythmHover.kind === "agent" ? AGENTS_RHYTHM_HOVER_CARD_ID : undefined}
                      onFocus={(event) => updateKeyboardHover(hour, "agent", event)}
                      onBlur={() => setRhythmHover(null)}
                    />
                  ) : null}
                  {commits > 0 && commitPoint ? (
                    <circle
                      className="focus-drift__target agents-rhythm-chart__target--commits"
                      cx={commitPoint.x}
                      cy={commitPoint.focusY}
                      r="3"
                      role="img"
                      tabIndex={0}
                      aria-label={pointAriaLabel(hour, "commits")}
                      aria-describedby={rhythmHover?.hour === hour && rhythmHover.kind === "commits" ? AGENTS_RHYTHM_HOVER_CARD_ID : undefined}
                      onFocus={(event) => updateKeyboardHover(hour, "commits", event)}
                      onBlur={() => setRhythmHover(null)}
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
          {rhythmHover ? (
            <div
              className={`focus-drift__hover-dot${rhythmHover.kind === "commits" ? " focus-drift__hover-dot--commits" : ""}`}
              style={{ left: `${rhythmHover.markerX}%`, top: `${rhythmHover.markerY}%` }}
              aria-hidden="true"
            />
          ) : null}
          <div className="focus-drift__scale" aria-hidden="true">
            <span style={{ "--focus-drift-scale-y": `${FOCUS_DRIFT_CHART_BOUNDS.top}%` } as CSSProperties}>{formatAgentDuration(agentWorkScaleMaxMinutes, effectiveLanguage)}</span>
            <span style={{ "--focus-drift-scale-y": `${FOCUS_DRIFT_CHART_BOUNDS.bottom}%` } as CSSProperties}>0</span>
          </div>
        </div>
        {rhythmHover ? <AgentsRhythmHoverCard hover={rhythmHover} startOfDayMinutes={startOfDayMinutes} /> : null}
        <div className="focus-drift__axis" aria-hidden="true">
          {axisTicks.map((tick) => (
            <span key={tick.hour} style={{ "--focus-drift-axis-x": `${tick.x}%` } as CSSProperties}>{tick.label}</span>
          ))}
        </div>
      </div>
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
  sshSyncStatus = INACTIVE_SSH_AGENT_SOURCE_SYNC_STATUS,
  syncSshHost,
}: {
  readonly flowIntervalMinutes: FlowIntervalMinutes;
  readonly onFlowIntervalChange: (intervalMinutes: FlowIntervalMinutes) => void;
  readonly onSelectDay: (day: string) => void;
  readonly selectedDay: string;
  readonly startOfDayMinutes: number;
  readonly startOfWeek: StartOfWeek;
  readonly todayDay: string;
  readonly sshSyncStatus?: SshAgentSourceSyncStatus;
  readonly syncSshHost?: SshAgentSourceSyncController["syncHostNow"];
}) {
  const { effectiveLanguage, t } = useLocalization();
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const liveMinuteOfDay = useLiveMinuteOfDay();
  const [period, setPeriod] = useState<AgentsPeriod>("Today");
  const [colorMode, setColorMode] = useState<AgentsGridColorMode>("intensity");
  const [sshModalOpen, setSshModalOpen] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
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
  const { days, loading, live, error } = useAgentsData(
    range.startDay,
    range.endDay,
    boundaryMinutes,
    dataRefreshKey + sshSyncStatus.revision,
  );
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
    ? dayModel?.cumulativeMinutes ?? 0
    : models.reduce((sum, model) => sum + model.cumulativeMinutes, 0);
  const headlineDuration = headlineMinutes > 0 ? formatAgentDuration(headlineMinutes, effectiveLanguage) : null;
  const titleAriaLabel = loading
    ? t("agents.headline.loadingAria")
    : error
      ? t("agents.headline.ranLead")
      : headlineDuration === null
        ? t("agents.headline.noActivity")
        : t("agents.headline.ranAria", { duration: headlineDuration });
  const dateLabel = formatLocalizedDateRangeLabel(range.startDay, range.endDay, effectiveLanguage);
  const totalCommits = period === "Today"
    ? dayModel?.commitCount ?? 0
    : models.reduce((sum, model) => sum + model.commitCount, 0);
  const repos = period === "Today"
    ? dayModel?.repos ?? []
    : buildAgentsWeekModel(models).repos;
  const scopedSources = period === "Today" ? (daySource ? [daySource] : []) : days;
  const repoProviders = useMemo(() => repoDominantProviders(scopedSources), [scopedSources]);
  const topAgentRepo = useMemo(() => {
    const byRepo = [...agentMinutesByRepo(scopedSources).entries()].sort((a, b) => b[1] - a[1]);
    const top = byRepo[0];
    if (!top || top[1] <= 0) return null;
    return { repo: top[0], duration: formatAgentDuration(top[1], effectiveLanguage) };
  }, [effectiveLanguage, scopedSources]);
  const isCurrentPeriod = range.startDay <= todayDay && todayDay <= range.endDay;
  const nextSelectedDay = shiftDashboardPeriodDay(selectedDay, period, 1);
  const nextRange = getDashboardPeriodRange(nextSelectedDay, period, boundaryMinutes, startOfWeek);
  const canShiftForward = period === "Week" ? nextRange.startDay <= todayDay : nextSelectedDay <= todayDay;
  const isSshSyncing = sshSyncStatus.syncing && sshSyncStatus.activeHosts.length > 0;
  const failedSshHost = !isSshSyncing
    && sshSyncStatus.lastErrorHost
    && sshSyncStatus.sourceHosts.includes(sshSyncStatus.lastErrorHost)
    ? sshSyncStatus.lastErrorHost
    : null;
  const isSshSyncError = failedSshHost !== null;
  const visibleSshHosts = isSshSyncing
    ? sshSyncStatus.activeHosts
    : failedSshHost
      ? [failedSshHost, ...sshSyncStatus.sourceHosts.filter((host) => host !== failedSshHost)]
      : sshSyncStatus.sourceHosts;
  const visibleSshHost = visibleSshHosts[0] ?? null;
  const additionalVisibleSshHosts = Math.max(0, visibleSshHosts.length - 1);
  const hasSshSources = (sshSyncStatus.autoSyncEnabled || isSshSyncing) && visibleSshHost !== null;
  const sshStatusAriaKey = isSshSyncing
    ? additionalVisibleSshHosts > 0 ? "agents.ssh.syncingHostsAria" : "agents.ssh.syncingHostAria"
    : isSshSyncError
      ? additionalVisibleSshHosts > 0 ? "agents.ssh.errorHostsAria" : "agents.ssh.errorHostAria"
      : additionalVisibleSshHosts > 0 ? "agents.ssh.autoSyncHostsAria" : "agents.ssh.autoSyncHostAria";
  const shiftPeriod = (direction: -1 | 1) => {
    if (direction === 1 && !canShiftForward) return;
    onSelectDay(shiftDashboardPeriodDay(selectedDay, period, direction));
  };

  const pageHead = (
    <div className="pg-head dashboard-page-head dashboard-page-head--focus-summary dashboard-page-head--today">
      <div className="dashboard-page-head__row">
        <div className="dashboard-page-head__primary">
          <div className="dashboard-page-head__summary">
            <h1 aria-label={titleAriaLabel} className="dashboard-page-head__title">
              {loading ? (
                <><span className="dashboard-page-head__focus-word">{t("agents.headline.ranLead")}</span><span className="loading-skeleton-line loading-skeleton-line--metric" aria-hidden="true" /></>
              ) : error ? (
                <span className="dashboard-page-head__focus-word">{t("agents.headline.ranLead")}</span>
              ) : headlineDuration === null ? (
                <span className="dashboard-page-head__focus-word">{t("agents.headline.noActivity")}</span>
              ) : (
                <><span className="dashboard-page-head__focus-word">{t("agents.headline.ranLead")}</span><span className="dashboard-page-head__focus-value">{headlineDuration}</span></>
              )}
            </h1>
          </div>
          <div className="agents-ssh-controls">
            <button
              type="button"
              className="agents-ssh-trigger"
              aria-label={hasSshSources ? t("agents.ssh.manage") : t("agents.ssh.add")}
              onClick={() => setSshModalOpen(true)}
            >
              <span>SSH</span>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
            </button>
            {/* Host names and sync state live inside the SSH sources dialog; the
                header button stays a plain entry point. Assistive tech still
                hears the background sync state. */}
            <span className="sr-only" role="status" aria-live="polite">
              {hasSshSources && visibleSshHost
                ? t(sshStatusAriaKey, { host: visibleSshHost, count: additionalVisibleSshHosts })
                : ""}
            </span>
          </div>
        </div>
        <div className="dashboard-page-head__side">
                      <DayWeekToggle
              ariaLabel={t("agents.range.aria")}
              dayLabel={t("agents.range.day")}
              period={period}
              weekLabel={t("agents.range.week")}
              onChange={setPeriod}
            />
          <DateNavigator
            ariaLabel={t(period === "Week" ? "agents.date.weekSelector" : "agents.date.daySelector")}
            label={`${dateLabel}${!loading && !error && !live ? ` · ${t("agents.date.sample")}` : ""}`}
            todayLabel={t(period === "Week" ? "agents.date.currentWeek" : "agents.date.currentDay")}
            isTodayDisabled={isCurrentPeriod}
            isNextDisabled={!canShiftForward}
            onPrevious={() => shiftPeriod(-1)}
            onNext={() => shiftPeriod(1)}
            onToday={() => onSelectDay(todayDay)}
            previousLabel={t(period === "Week" ? "agents.date.previousWeek" : "agents.date.previousDay")}
            nextLabel={t(period === "Week" ? "agents.date.nextWeek" : "agents.date.nextDay")}
          />
        </div>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="page page--agents">
        {pageHead}
        <section className="agents-data-error" role="alert">
          <div>
            <h2>{t("agents.data.errorTitle")}</h2>
            <p>{t("agents.data.errorDescription")}</p>
          </div>
          <button type="button" className="app-btn app-btn--secondary" onClick={() => setDataRefreshKey((key) => key + 1)}>
            {t("agents.data.retry")}
          </button>
        </section>
        <ModalPresence>
          {sshModalOpen ? (
            <SshAgentSourcesModal
              onClose={() => setSshModalOpen(false)}
              onCollected={() => setDataRefreshKey((key) => key + 1)}
              collectSource={syncSshHost}
              syncStatus={sshSyncStatus}
            />
          ) : null}
        </ModalPresence>
      </div>
    );
  }

  const breakdownPanel = (
    <BreakdownSidePanel
      open={breakdownOpen}
      onToggle={toggleBreakdown}
      ariaLabel={t("agents.breakdown.aria")}
      toggleSubject={t("agents.breakdown.aria")}
      title={t("agents.breakdown.title")}
      showLabel={t("agents.breakdown.show")}
      collapseLabel={t("agents.breakdown.collapse")}
    >
      {/* The time sentence leads, then the charts (models donut, repo
          share bar) in the day view's compact-chart vocabulary, then the
          reference tiles. */}
      <AgentsBreakdownComposed sources={scopedSources} dayModel={dayModel} models={models} period={period} />
      <AgentsStatList entries={period === "Today" && dayModel && daySource
        ? agentsDayStatEntries(daySource, dayModel, boundaryMinutes, effectiveLanguage, t)
        : agentsWeekStatEntries(scopedSources, models, effectiveLanguage, t)}
      />
    </BreakdownSidePanel>
  );

  if (period === "Week") {
    return (
      <div className="page page--agents page--week-dashboard" aria-busy={loading}>
        <section className="week-v2" aria-label={t("agents.week.overviewAria")}>
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
        <ModalPresence>
          {sshModalOpen ? (
          <SshAgentSourcesModal
            onClose={() => setSshModalOpen(false)}
            onCollected={() => setDataRefreshKey((key) => key + 1)}
            collectSource={syncSshHost}
            syncStatus={sshSyncStatus}
          />
          ) : null}
        </ModalPresence>
      </div>
    );
  }

  return (
    <div className={`page page--agents${repos.length === 0 ? " page--agents-empty-day" : ""}`} aria-busy={loading}>
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
            periodLabel={t("agents.period.today")}
            repoProviders={repoProviders}
            startOfDayMinutes={boundaryMinutes}
            topAgentRepo={topAgentRepo}
          />
        </div>
        {breakdownPanel}
      </div>
      <ModalPresence>
        {sshModalOpen ? (
        <SshAgentSourcesModal
          onClose={() => setSshModalOpen(false)}
          onCollected={() => setDataRefreshKey((key) => key + 1)}
          collectSource={syncSshHost}
          syncStatus={sshSyncStatus}
        />
        ) : null}
      </ModalPresence>
    </div>
  );
}
