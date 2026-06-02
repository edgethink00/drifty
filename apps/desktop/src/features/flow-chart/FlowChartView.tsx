import { useMemo, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { FLOW_INTERVAL_OPTIONS, logicalMinuteOfDay, secondsToLabel, type ActivityCategory, type ClassificationSource, type FlowBlock, type FlowIntervalMinutes, type ProductivityLabel } from "@dtime/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES_PER_DAY = 24 * 60;
const BASE_FLOW_CELL_INTERVAL_MINUTES = 3;
const FLOW_CELL_BASE_MIN_HEIGHT_REM = 0.5;
const FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM = 0.76;

type FlowHoverState = {
  block: FlowBlock;
  x: number;
  y: number;
};

type FlowCategoryGroup = {
  productivity: ProductivityLabel;
  categories: ActivityCategory[];
};

type FlowLegendActivityBreakdown = {
  appName: string;
  bundleId?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  totalSeconds: number;
};

type FlowLegendHoverState = {
  label: string;
  categories: ActivityCategory[];
  appBreakdown: FlowLegendActivityBreakdown[];
  x: number;
  y: number;
};

const FLOW_CATEGORY_GROUPS: FlowCategoryGroup[] = [
  { productivity: "focus", categories: ["workspace", "learning"] },
  { productivity: "neutral", categories: ["communication", "music", "utility", "unknown"] },
  { productivity: "drift", categories: ["entertainment", "social_media", "shopping", "game"] },
];

function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "am" : "pm";
  const displayHour = hour % 12 || 12;
  return `${displayHour}${period}`;
}

function normalizeStartOfDayMinutes(minutes?: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(minutes ?? 0)));
}

function clockHourForLogicalHour(logicalHour: number, startOfDayMinutes: number): number {
  return Math.floor((logicalHour * 60 + startOfDayMinutes) / 60) % 24;
}

function minuteOfDayForCell(logicalHour: number, minuteOffset: number, startOfDayMinutes: number): number {
  return (logicalHour * 60 + minuteOffset + startOfDayMinutes) % MINUTES_PER_DAY;
}

function formatMinuteOfDay(minuteOfDay: number): string {
  const normalized = ((minuteOfDay % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function formatBlockTime(block: FlowBlock): string {
  return formatMinuteOfDay(block.minuteOfDay);
}

function formatBlockEndTime(block: FlowBlock, intervalMinutes: FlowIntervalMinutes): string {
  return formatMinuteOfDay(block.minuteOfDay + intervalMinutes);
}

function flowSubtitle(block: FlowBlock): string {
  if (block.siteTitle) return block.siteTitle;
  if (block.windowTitle) return block.windowTitle;
  if (block.siteDomain) return block.siteDomain;
  return "App focus block without window detail.";
}

function blockDisplayName(block: FlowBlock): string {
  return block.siteDomain ?? block.siteTitle ?? block.appName;
}

function blockContextLabel(block: FlowBlock, intervalMinutes: FlowIntervalMinutes): string {
  const timeLabel = `${formatBlockTime(block)}–${formatBlockEndTime(block, intervalMinutes)} · ${secondsToLabel(block.durationSeconds)}`;
  if (!block.siteDomain) return timeLabel;

  return block.browserName ? `${block.browserName} · ${timeLabel}` : timeLabel;
}

function categoryLabel(category: ActivityCategory): string {
  switch (category) {
    case "workspace": return "Workspace";
    case "learning": return "Learning";
    case "communication": return "Communication";
    case "music": return "Music";
    case "game": return "Game";
    case "social_media": return "Social media";
    case "entertainment": return "Entertainment";
    case "shopping": return "Shopping";
    case "utility": return "Utility";
    case "unknown": return "Unknown";
  }
}

function productivityLabel(productivity: ProductivityLabel): string {
  switch (productivity) { case "focus": return "Focus"; case "neutral": return "Neutral"; case "drift": return "Drift"; }
}

function buildLegendActivityBreakdown(blocks: FlowBlock[], categories: ActivityCategory[]): FlowLegendActivityBreakdown[] {
  const categorySet = new Set<ActivityCategory>(categories);
  const totals = new Map<string, FlowLegendActivityBreakdown>();

  for (const block of blocks) {
    if (!categorySet.has(block.category)) continue;
    const label = blockDisplayName(block);
    const key = block.siteDomain ? `site:${block.siteDomain}` : block.siteTitle ? `title:${block.siteTitle}` : `app:${block.bundleId ?? block.appName}`;
    const existing = totals.get(key) ?? {
      appName: label,
      bundleId: block.siteDomain || block.siteTitle ? null : block.bundleId ?? null,
      browserName: block.browserName ?? null,
      siteDomain: block.siteDomain ?? null,
      siteTitle: block.siteTitle ?? null,
      totalSeconds: 0,
    };
    existing.totalSeconds += block.durationSeconds;
    totals.set(key, existing);
  }

  return Array.from(totals.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds || left.appName.localeCompare(right.appName))
    .slice(0, 4);
}

function cellTitle(block: FlowBlock, intervalMinutes: FlowIntervalMinutes): string {
  const detail = block.siteTitle ?? block.windowTitle ?? block.siteDomain ?? "No window title captured";
  return [
    `${blockDisplayName(block)} · ${categoryLabel(block.category)} · ${productivityLabel(block.productivity)}`,
    detail,
    `Time block: ${formatBlockTime(block)}–${formatBlockEndTime(block, intervalMinutes)}`,
    `Duration: ${secondsToLabel(block.durationSeconds)}`,
  ].join("\n");
}

export function FlowChartView({
  blocks,
  appIcons,
  currentMinuteOfDay,
  intervalMinutes = 3,
  onIntervalChange,
  startOfDayMinutes = 0,
}: {
  blocks: FlowBlock[];
  appIcons: Record<string, string | null>;
  currentMinuteOfDay?: number | null;
  intervalMinutes?: FlowIntervalMinutes;
  onIntervalChange?: (intervalMinutes: FlowIntervalMinutes) => void;
  startOfDayMinutes?: number;
}) {
  const [hoveredBlock, setHoveredBlock] = useState<FlowHoverState | null>(null);
  const [hoveredLegend, setHoveredLegend] = useState<FlowLegendHoverState | null>(null);
  const rowMinuteOffsets = useMemo(
    () => Array.from({ length: 60 / intervalMinutes }, (_, index) => index * intervalMinutes),
    [intervalMinutes],
  );
  const boundaryMinutes = normalizeStartOfDayMinutes(startOfDayMinutes);
  const currentLogicalMinute = currentMinuteOfDay !== null && currentMinuteOfDay !== undefined ? logicalMinuteOfDay(currentMinuteOfDay, boundaryMinutes) : null;
  const currentHourIndex = currentLogicalMinute !== null ? Math.floor(currentLogicalMinute / 60) : null;
  const currentMinuteOffset = currentLogicalMinute !== null
    ? Math.floor((currentLogicalMinute % 60) / intervalMinutes) * intervalMinutes
    : null;
  const blockByCell = useMemo(() => {
    const next = new Map<string, FlowBlock>();
    for (const block of blocks) next.set(`${block.minuteOfDay}`, block);
    return next;
  }, [blocks]);
  const chartStyle: CSSProperties & Record<"--flow-cell-min-height" | "--flow-breakdown-cell-min-height", string> = {
    "--flow-cell-min-height": `${(FLOW_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
    "--flow-breakdown-cell-min-height": `${(FLOW_BREAKDOWN_CELL_BASE_MIN_HEIGHT_REM * intervalMinutes) / BASE_FLOW_CELL_INTERVAL_MINUTES}rem`,
  };
  const showLegendHover = (event: MouseEvent<HTMLElement>, label: string, categories: ActivityCategory[]) => setHoveredLegend({
    label,
    categories,
    appBreakdown: buildLegendActivityBreakdown(blocks, categories),
    x: event.clientX,
    y: event.clientY,
  });
  if (blocks.length === 0) return null;

  return (
    <section className="flow-chart-card" aria-label={`${intervalMinutes}-minute flow chart`} data-flow-interval={intervalMinutes} style={chartStyle}>
      <div className="flow-chart-head">
        <div>
          <span className="label-mono">flow chart</span>
          <p className="flow-chart-copy">{intervalMinutes}-minute cells show the dominant app or site in each block; tracked totals live in Time breakdown.</p>
        </div>
        <div className="flow-chart-head__actions">
          {onIntervalChange ? (
            <div className="seg flow-interval-control" aria-label="Flow chart interval">
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
          ) : null}
          <div className="flow-chart-legend" aria-label="Flow chart tones">
            {FLOW_CATEGORY_GROUPS.map((group) => (
              <span className="flow-chart-legend__group" key={group.productivity}>
                <span
                  className="flow-chart-legend__parent"
                  onMouseEnter={(event) => showLegendHover(event, productivityLabel(group.productivity), group.categories)}
                  onMouseMove={(event) => showLegendHover(event, productivityLabel(group.productivity), group.categories)}
                  onMouseLeave={() => setHoveredLegend(null)}
                  title={`${productivityLabel(group.productivity)} categories`}
                >
                  {productivityLabel(group.productivity)}
                </span>
                <span className="flow-chart-legend__categories" aria-label={`${productivityLabel(group.productivity)} categories`}>
                  {group.categories.map((category) => (
                    <span
                      aria-label={categoryLabel(category)}
                      className={`flow-chart-legend__dot flow-chart-legend__dot--${category}`}
                      key={category}
                      onMouseEnter={(event) => showLegendHover(event, categoryLabel(category), [category])}
                      onMouseMove={(event) => showLegendHover(event, categoryLabel(category), [category])}
                      onMouseLeave={() => setHoveredLegend(null)}
                      title={categoryLabel(category)}
                    />
                  ))}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flow-chart-hours" aria-hidden="true">
        <span />
        {HOURS.map((hour) => {
          const clockHour = clockHourForLogicalHour(hour, boundaryMinutes);
          return (
            <span className={hour === currentHourIndex ? "flow-chart-hour--now" : undefined} key={hour}>
              {hour === currentHourIndex || hour % 3 === 0 ? formatHourLabel(clockHour) : ""}
            </span>
          );
        })}
      </div>
      <div className="flow-chart-grid">
        {rowMinuteOffsets.map((minuteOffset) => {
          const isCurrentMinuteRow = minuteOffset === currentMinuteOffset;
          const nearestLabelMinuteOffset = currentMinuteOffset !== null && currentMinuteOffset + intervalMinutes < 60
            ? currentMinuteOffset + intervalMinutes
            : currentMinuteOffset;
          const isCurrentTimeLabelRow = minuteOffset === nearestLabelMinuteOffset;
          const isTerminalCurrentMinuteRow = isCurrentMinuteRow && minuteOffset + intervalMinutes >= 60;

          return (
          <div
            className={`flow-chart-row${isCurrentMinuteRow ? " flow-chart-row--now" : ""}${isTerminalCurrentMinuteRow ? " flow-chart-row--now-terminal" : ""}${isCurrentTimeLabelRow ? " flow-chart-row--time-label" : ""}`}
            key={minuteOffset}
            style={isCurrentMinuteRow && currentHourIndex !== null ? { "--flow-current-hour": currentHourIndex } as CSSProperties & Record<"--flow-current-hour", number> : undefined}
          >
            <div className="flow-chart-row-label">:{`${minuteOffset}`.padStart(2, "0")}</div>
            {HOURS.map((hour) => {
              const minuteOfDay = minuteOfDayForCell(hour, minuteOffset, boundaryMinutes);
              const block = blockByCell.get(`${minuteOfDay}`);
              const isCurrentHourCell = hour === currentHourIndex && minuteOffset === currentMinuteOffset;
              if (!block) {
                return (
                  <span
                    className={`flow-cell flow-cell--empty${isCurrentHourCell ? " flow-cell--now-hour" : ""}`}
                    key={minuteOfDay}
                    aria-hidden="true"
                  />
                );
              }

              return (
                <button
                  className={`flow-cell flow-cell--${block.category}${isCurrentHourCell ? " flow-cell--now-hour" : ""}`}
                  key={block.minuteOfDay}
                  type="button"
                  aria-label={cellTitle(block, intervalMinutes).replace(/\n/g, ", ")}
                  onMouseEnter={(event: MouseEvent<HTMLButtonElement>) => setHoveredBlock({ block, x: event.clientX, y: event.clientY })}
                  onMouseMove={(event: MouseEvent<HTMLButtonElement>) => setHoveredBlock({ block, x: event.clientX, y: event.clientY })}
                  onMouseLeave={() => setHoveredBlock(null)}
                >
                  <span className="flow-cell__mark" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          );
        })}
      </div>

      {hoveredBlock ? <FlowHoverCard hover={hoveredBlock} appIcons={appIcons} intervalMinutes={intervalMinutes} /> : null}
      {hoveredLegend ? <FlowLegendHoverCard hover={hoveredLegend} appIcons={appIcons} /> : null}
    </section>
  );
}

function ClassificationSourcePill({ source, ai }: { source?: ClassificationSource | null; ai?: boolean | null }) {
  const label = classificationSourceLabel(source, ai);
  return <span className={`classification-source-pill${ai ? " classification-source-pill--ai" : ""}`}>{label}</span>;
}

function classificationSourceLabel(source?: ClassificationSource | null, ai?: boolean | null): string {
  if (ai || source === "llm") return "AI classified";
  if (source === "domain-db" || source === "app-db" || source === "youtube") return "Predefined rule";
  if (source === "context") return "Context rule";
  if (source === "fallback") return "Fallback";
  if (source === "manual") return "Manual";
  if (source === "stored") return "Stored";
  return "Unclassified rule";
}

function FlowLegendHoverCard({ hover, appIcons }: { hover: FlowLegendHoverState; appIcons: Record<string, string | null> }) {
  return (
    <div className="flow-hover-card category-hover-card" style={{ left: hover.x + 16, top: hover.y + 16 }}>
      <div className="category-hover-card__head">
        <strong>{hover.label}</strong>
        <span>{hover.categories.map(categoryLabel).join(", ")}</span>
      </div>
      <div className="category-hover-card__apps">
        {hover.appBreakdown.length > 0 ? hover.appBreakdown.map((item) => {
          const iconSrc = appIcons[item.bundleId ?? item.appName] ?? null;
          const label = item.siteDomain ?? item.siteTitle ?? item.appName;
          return (
            <div className="category-hover-card__app" key={`${item.siteDomain ?? item.siteTitle ?? item.bundleId ?? item.appName}`}>
              <span className="usage-identity-icon usage-identity-icon--sm">
                {item.siteDomain ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={label} iconSrc={item.siteTitle ? null : iconSrc} size="sm" />}
              </span>
              <span>{label}</span>
              <strong>{secondsToLabel(item.totalSeconds)}</strong>
            </div>
          );
        }) : <span className="category-hover-card__empty">No app breakdown yet.</span>}
      </div>
    </div>
  );
}

function FlowHoverCard({ hover, appIcons, intervalMinutes }: { hover: FlowHoverState; appIcons: Record<string, string | null>; intervalMinutes: FlowIntervalMinutes }) {
  const { block } = hover;
  const iconSrc = appIcons[block.bundleId ?? block.appName] ?? null;
  const displayName = blockDisplayName(block);

  return (
    <div className="flow-hover-card" style={{ left: hover.x + 16, top: hover.y + 16 }}>
      <div className="flow-hover-card__top">
        {block.siteDomain ? <SiteFavicon domain={block.siteDomain} size={24} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={displayName} iconSrc={iconSrc} size="sm" />}
        <div>
          <strong>{displayName}</strong>
          <span>{blockContextLabel(block, intervalMinutes)}</span>
        </div>
      </div>
      <p>{categoryLabel(block.category)} · {productivityLabel(block.productivity)} · {flowSubtitle(block)}</p>
      <ClassificationSourcePill source={block.classificationSource as ClassificationSource | null | undefined} ai={block.aiClassification} />
      {block.siteDomain ? (
        <span className="segment-site-pill flow-hover-card__site">
          <SiteFavicon domain={block.siteDomain} size={14} fallbackIconSrc={iconSrc} />
          {block.siteDomain}
        </span>
      ) : null}
    </div>
  );
}
