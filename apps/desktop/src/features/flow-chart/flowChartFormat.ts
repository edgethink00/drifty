import { secondsToLabel, type FlowBlock, type FlowIntervalMinutes } from "@drifty/domain";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactHourLabel } from "../../lib/formatting";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";

const MINUTES_PER_DAY = 24 * 60;

export function formatHourLabel(hour: number): string {
  return formatCompactHourLabel(hour);
}

export function normalizeStartOfDayMinutes(minutes?: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(minutes ?? 0)));
}

export function clockHourForLogicalHour(logicalHour: number, startOfDayMinutes: number): number {
  return Math.floor((logicalHour * 60 + startOfDayMinutes) / 60) % 24;
}

export function minuteOfDayForCell(logicalHour: number, minuteOffset: number, startOfDayMinutes: number): number {
  return (logicalHour * 60 + minuteOffset + startOfDayMinutes) % MINUTES_PER_DAY;
}

export function formatMinuteOfDay(minuteOfDay: number): string {
  const normalized = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function formatBlockTime(block: FlowBlock): string {
  return formatMinuteOfDay(block.minuteOfDay);
}

export function formatBlockEndTime(block: FlowBlock, intervalMinutes: FlowIntervalMinutes): string {
  return formatMinuteOfDay(block.minuteOfDay + intervalMinutes);
}

export function blockDisplayName(block: FlowBlock): string {
  return block.siteDomain ?? block.siteTitle ?? block.appName;
}

export function blockDetailLabel(block: FlowBlock): string | null {
  const displayName = blockDisplayName(block).trim();
  const candidates = [block.siteTitle, block.windowTitle, block.siteDomain, block.appName];
  const detail = candidates.find((candidate) => {
    const normalized = candidate?.trim();
    return normalized !== undefined && normalized.length > 0 && normalized !== displayName;
  });

  return detail ?? null;
}

export function blockContextLabel(block: FlowBlock, intervalMinutes: FlowIntervalMinutes): string {
  const timeLabel = `${formatBlockTime(block)}–${formatBlockEndTime(block, intervalMinutes)} · ${secondsToLabel(block.durationSeconds)}`;
  if (!block.siteDomain) return timeLabel;

  return block.browserName ? `${block.browserName} · ${timeLabel}` : timeLabel;
}

export function formatGroupTimeRange(group: FlowBlockHoverGroup): string {
  return `${formatMinuteOfDay(group.startMinuteOfDay)}–${formatMinuteOfDay(group.endMinuteOfDay)}`;
}

export function groupContextLabel(group: FlowBlockHoverGroup): string {
  const { block } = group;
  const timeLabel = `${formatGroupTimeRange(group)} · ${secondsToLabel(group.durationSeconds)}`;
  if (!block.siteDomain) return timeLabel;

  return block.browserName ? `${block.browserName} · ${timeLabel}` : timeLabel;
}

export function cellTitle(block: FlowBlock, intervalMinutes: FlowIntervalMinutes): string {
  const detail = blockDetailLabel(block);
  const labels = [
    `${categoryLabel(block.category)} · ${productivityLabel(block.productivity)}`,
    blockDisplayName(block),
  ];

  if (detail) labels.push(detail);
  labels.push(`Time block: ${formatBlockTime(block)}–${formatBlockEndTime(block, intervalMinutes)}`);
  labels.push(`Duration: ${secondsToLabel(block.durationSeconds)}`);
  return labels.join("\n");
}

export function cellGroupTitle(group: FlowBlockHoverGroup): string {
  const { block } = group;
  const detail = blockDetailLabel(block);
  const labels = [
    `${categoryLabel(block.category)} · ${productivityLabel(block.productivity)}`,
    blockDisplayName(block),
  ];

  if (detail) labels.push(detail);
  labels.push(`Time block: ${formatGroupTimeRange(group)}`);
  labels.push(`Duration: ${secondsToLabel(group.durationSeconds)}`);
  return labels.join("\n");
}

export function buildCellGroupAriaLabels(groupsByCell: ReadonlyMap<number, FlowBlockHoverGroup>): Map<number, string> {
  const labelsByGroup = new Map<FlowBlockHoverGroup, string>();
  const labelsByMinute = new Map<number, string>();
  for (const [minute, group] of groupsByCell) {
    let label = labelsByGroup.get(group);
    if (label === undefined) {
      label = cellGroupTitle(group).replace(/\n/g, ", ");
      labelsByGroup.set(group, label);
    }
    labelsByMinute.set(minute, label);
  }
  return labelsByMinute;
}
