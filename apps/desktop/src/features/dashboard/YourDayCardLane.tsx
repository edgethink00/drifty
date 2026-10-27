import { useActivityInspection } from "./ActivityInspectionContext";
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { logicalDayStartMs, logicalMinuteOfDay, type AppIconMap, type ClassificationOptions, type ActivitySegment } from "@drifty/domain";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import { formatLocalizedCalendarMinuteLabel, formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useActivityLabels } from "../activity-labels/ActivityLabelsContext";
import type { FlowColorMode } from "../flow-chart/FlowChartTypes";
import { NO_PROJECT_COLOR, type ProjectLegendEntry } from "../flow-chart/projectFlowView";
import { localizedExcludedIdentityLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";
import { levelFor } from "../productivity-levels/productivityLevelView";
import { useProductivityLevels } from "../settings/categoryCustomizationStore";
import { arrangeWeekCardBlocks, LONE_BLOCK_SHARE, weekNextBlockTopMinutes } from "./weekCardBlocks";
import type { WeekCalendarEvent } from "./weekCalendar";
import { WeekCalendarIdentityIcon } from "./WeekDashboard";
import { buildWeekDashboardDayModel } from "./weekDashboardModel";
import { LaneNotes, type LaneNotesProps, type LaneInteract, type LaneItem, type LaneRange } from "./yourDayLaneNotes";
import type { FlowBlockHoverGroup } from "../flow-chart/flowHoverGroups";
import { buildFlowHoverOverlaySegments } from "../flow-chart/flowHoverOverlay";

/*
 * The day's timeline cards beside the hours-down chart. The blocks are the
 * Week model's canonical blocks arranged by card (weekCardBlocks.ts), so Day
 * and Week show the same blocks with the same names; a block without a card
 * is named by its app, as in Week. Day also keeps a short block that touches
 * nothing once it clears 40% of the short bar, which Week leaves out; the
 * notes column (yourDayLaneNotes.tsx) draws the blocks at their exact times
 * and gives such a block its line where the lane has room. Pointing at an entry lights its cells;
 * clicking it opens the activity through a cell of its time, so the surfaces
 * share one editor.
 */

type LaneHighlightStyle = CSSProperties & { "--flow-hover-hour": number; "--flow-hover-row": number; "--flow-hover-row-span": number };

/** What the lane and its title read: the day's blocks and how to colour them. */
export type YourDayLaneSource = {
  readonly day: string;
  readonly segments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly startOfDayMinutes: number;
  readonly colorMode: FlowColorMode;
  readonly projectBySegmentId: ReadonlyMap<string, string | null>;
  readonly projectLegend?: readonly ProjectLegendEntry[];
  readonly revealSegmentId?: string | null;
};

type YourDayCardLaneProps = YourDayLaneSource & {
  readonly appIcons: AppIconMap;
  readonly highlightedGroup?: FlowBlockHoverGroup | null;
  /** Opens the activity card for the cell at this minute of day, when the chart has one. */
  readonly onOpenMinute: (minuteOfDay: number, target: HTMLElement) => void;
};

/** The chart's cell length; the lane highlights cells in these steps. */
const CELL_MINUTES = 4;
const DAY_MINUTES = 24 * 60;

/** "9:30 AM–11:00 AM" as "9:30–11:00 AM", "오전 9:30–오전 11:00" as "오전 9:30–11:00": a word both ends share is written once. */
export function compactClockRange(start: string, end: string): string {
  const a = start.split(" ");
  const b = end.split(" ");
  const word = (value: string | undefined) => value !== undefined && !/\d/.test(value);
  if (a.length > 1 && b.length > 1 && word(a[a.length - 1]) && a[a.length - 1] === b[b.length - 1]) return a.slice(0, -1).join(" ") + "–" + end;
  if (a.length > 1 && b.length > 1 && word(a[0]) && a[0] === b[0]) return start + "–" + b.slice(1).join(" ");
  return start + "–" + end;
}

function useLaneItems({ day, segments, classificationOptions, startOfDayMinutes, colorMode, projectBySegmentId, projectLegend, revealSegmentId = null }: YourDayLaneSource): LaneItem[] {
  const { effectiveLanguage, t } = useLocalization();
  const productivityLevels = useProductivityLevels();
  const activityLabels = useActivityLabels();
  const events = useMemo(() => {
    const model = buildWeekDashboardDayModel({ day, segments: [...segments], classificationOptions, startOfDayMinutes });
    if (!activityLabels) return { events: model.calendarEvents, names: null };
    const arranged = arrangeWeekCardBlocks(new Map([[day, activityLabels.weekCalendarEvents?.get(day) ?? model.calendarEvents]]), activityLabels.index, { startOfDayMinutes, keepSegmentId: revealSegmentId, loneBlockShare: LONE_BLOCK_SHARE });
    return { events: arranged.eventsByDay.get(day) ?? [], names: arranged.names };
  }, [activityLabels, classificationOptions, day, revealSegmentId, segments, startOfDayMinutes]);
  return useMemo(() => {
    const projectColorById = new Map((projectLegend ?? []).flatMap((entry) => (entry.projectId ? [[entry.projectId, entry.color] as const] : [])));
    const tone = (event: WeekCalendarEvent): string => {
      if (colorMode === "project") {
        const byProject = new Map<string | null, number>();
        for (const id of event.segmentIds) {
          const projectId = projectBySegmentId.get(id) ?? null;
          byProject.set(projectId, (byProject.get(projectId) ?? 0) + 1);
        }
        const [projectId] = [...byProject.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null];
        return (projectId && projectColorById.get(projectId)) || NO_PROJECT_COLOR;
      }
      if (colorMode === "productivity") return levelFor(event.category, event.productivity, productivityLevels)?.color ?? PRODUCTIVITY_COLORS[event.productivity];
      return CATEGORY_COLORS[event.category];
    };
    const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
    const clock = (minute: number) => formatLocalizedCalendarMinuteLabel(day, minute, effectiveLanguage, startOfDayMinutes);
    return events.events.flatMap((event) => {
      const top = event.topMinutes;
      const bottom = top + event.durationMinutes;
      if (bottom <= 0 || top >= DAY_MINUTES) return [];
      // As in Week, a block ends where the next one starts, so blocks never overlap.
      const nextTop = events.names ? weekNextBlockTopMinutes(events.events, event) : null;
      const drawnTop = Math.max(top, 0);
      const drawnBottom = Math.max(drawnTop, Math.min(bottom, nextTop ?? Infinity, DAY_MINUTES));
      const name = events.names?.get(event.id)?.label ?? null;
      const workLabel = name?.display ?? null;
      const title = workLabel?.title ?? event.appName;
      const timeLabel = clock(top) + "–" + clock(bottom);
      const openMinute = name?.block.card ? Math.max(top, Math.floor((name.block.card.startMs - dayStartMs) / 60_000)) : top;
      const item: LaneItem = {
        event,
        top,
        bottom,
        drawnTop,
        drawnBottom,
        title,
        description: workLabel?.description?.trim() || null,
        named: Boolean(workLabel),
        origin: workLabel?.origin,
        tone: tone(event),
        timeLabel,
        clockRange: compactClockRange(clock(drawnTop), clock(drawnBottom)),
        hoverTitle: [timeLabel, title, ...event.identities.slice(0, 3).map((identity) => localizedExcludedIdentityLabel(identity, t))].join("\n"),
        openMinute,
        label: name,
      };
      return [item];
    });
  }, [colorMode, day, effectiveLanguage, events, productivityLevels, projectBySegmentId, projectLegend, startOfDayMinutes, t]);
}

export function YourDayCardLane({ appIcons, onOpenMinute, highlightedGroup = null, ...source }: YourDayCardLaneProps) {
  const { effectiveLanguage } = useLocalization();
  const inspection = useActivityInspection();
  const items = useLaneItems(source);
  const { day, startOfDayMinutes } = source;
  // The entry under the pointer lights its cells, the way the cells' own
  // hover lights a run; the highlight is the chart's. A piece of
  // work lights every range it covers.
  const [hovered, setHovered] = useState<readonly LaneRange[] | null>(null);
  const highlightSegments = useMemo(() => {
    if (!hovered) return [];
    const minutes = new Set<number>();
    for (const range of hovered) {
      const start = Math.max(range.start, 0);
      const end = Math.min(range.end, DAY_MINUTES);
      for (let minute = Math.floor(start / CELL_MINUTES) * CELL_MINUTES; minute < end; minute += CELL_MINUTES) minutes.add((minute + startOfDayMinutes) % DAY_MINUTES);
    }
    return buildFlowHoverOverlaySegments({ blocks: [...minutes].map(minuteOfDay => ({ minuteOfDay })) }, CELL_MINUTES, startOfDayMinutes);
  }, [hovered, startOfDayMinutes]);
  // Cards are placed by the lane's height in pixels, and shed their name when too short for it.
  const laneRef = useRef<HTMLDivElement>(null);
  const [laneHeight, setLaneHeight] = useState(0);
  useLayoutEffect(() => {
    const element = laneRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    // Card positions share the chart's layout pixels, including in the scaled
    // onboarding picture; the visual transform must not shorten them again.
    const measure = () => setLaneHeight(element.clientHeight || element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const scroller = laneRef.current?.closest(".flow-chart-scroll-area");
    if (!scroller) return;
    const clear = () => {
      if (!laneRef.current?.contains(document.activeElement)) setHovered(null);
    };
    scroller.addEventListener("scroll", clear, { passive: true });
    return () => scroller.removeEventListener("scroll", clear);
  }, []);

  const open = (logicalMinute: number, target: HTMLElement, ranges: readonly LaneRange[] = []) => {
    // The panel's log describes the card that was clicked, not just the chart cell it opens through.
    const item = items.find((entry) => ranges.some((range) => range.start === entry.top && range.end === entry.bottom));
    const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
    inspection.laneSelection.current = item ? {
      label: item.label ?? null,
      stretch: { startMs: dayStartMs + item.top * 60_000, endMs: dayStartMs + item.bottom * 60_000, segmentIds: item.event.segmentIds },
      atMs: Date.now(),
    } : null;
    onOpenMinute((((logicalMinute + startOfDayMinutes) % 1440) + 1440) % 1440, target);
  };
  // A card belongs to a chart block when they share records within the card's time.
  const holdsGroup = (item: LaneItem, group: FlowBlockHoverGroup) =>
    item.event.segmentIds.some(id => group.segmentIds.includes(id))
    && group.blocks.some(block => {
      const minute = logicalMinuteOfDay(block.minuteOfDay, startOfDayMinutes);
      return minute < item.bottom && minute + CELL_MINUTES > item.top;
    });
  const interact: LaneInteract = (ranges, openAt) => ({
    "data-flow-highlighted": Boolean(highlightedGroup && items.some(item =>
      ranges.some(range => range.start === item.top && range.end === item.bottom)
      && holdsGroup(item, highlightedGroup)
    )),
    onClick: (click) => open(openAt, click.currentTarget, ranges),
    onMouseEnter: () => setHovered(ranges),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(ranges),
    onBlur: () => setHovered(null),
  });
  const icon = (item: LaneItem, className: string) => {
    const identity = item.event.identities[0];
    return identity ? (
      <span className={className} aria-hidden="true">
        <WeekCalendarIdentityIcon appIcons={appIcons} identity={identity} />
      </span>
    ) : null;
  };
  const notes: LaneNotesProps = {
    items,
    interact,
    duration: (minutes) => formatLocalizedCompactDurationFromSeconds(minutes * 60, effectiveLanguage),
    icon,
    height: laneHeight,
  };

  return (
    <>
      {highlightSegments.map((segment) => {
        const style: LaneHighlightStyle = { "--flow-hover-hour": segment.hourIndex, "--flow-hover-row": segment.rowIndex, "--flow-hover-row-span": segment.rowSpan };
        return <span aria-hidden="true" className="flow-hover-group-highlight" key={segment.hourIndex + ":" + segment.rowIndex} style={style} />;
      })}
      <div ref={laneRef} className="your-day-lane your-day-lane--notes">
        <LaneNotes {...notes} />
      </div>
    </>
  );
}

/** Name the activity column without turning its block count into a metric. */
export function YourDayLaneTitle() {
  const { t } = useLocalization();
  return <span className="your-day-lane-title">{t("dashboard.today.laneActivity")}</span>;
}
