import { classifyActivityDetailed } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ProductivityLabel } from "@drifty/domain";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";

export type HistoryClassification = {
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
  readonly categoryLabel: string;
  readonly productivityLabel: string;
};

export type HistoryRow = {
  readonly id: string;
  readonly segmentIds: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly appName: string;
  readonly bundleId?: string | null;
  readonly browserName?: string | null;
  readonly siteDomain?: string | null;
  readonly siteTitle?: string | null;
  readonly siteUrl?: string | null;
  readonly windowTitle?: string | null;
  readonly classification: HistoryClassification;
  readonly searchText: string;
};

export type HistoryDayGroup = {
  readonly dayKey: string;
  readonly label: string;
  readonly rows: readonly HistoryRow[];
};

type MutableHistoryRow = {
  id: string;
  segmentIds: string[];
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  appName: string;
  bundleId?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  siteUrl?: string | null;
  windowTitle?: string | null;
  classification: HistoryClassification;
  searchParts: string[];
};

const historyDayFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function buildHistoryRows(segments: readonly ActivitySegment[]): readonly HistoryRow[] {
  const rows: HistoryRow[] = [];
  let currentRow: MutableHistoryRow | null = null;

  for (const segment of [...segments].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))) {
    if (currentRow === null || !canMergeIntoHistoryRow(currentRow, segment)) {
      if (currentRow !== null) rows.push(finishHistoryRow(currentRow));
      currentRow = startHistoryRow(segment);
      continue;
    }

    currentRow.endedAt = segment.endedAt;
    currentRow.durationSeconds += segment.durationSeconds;
    currentRow.segmentIds.push(segment.id);
    currentRow.searchParts.push(...historySearchParts(segment));
  }

  if (currentRow !== null) rows.push(finishHistoryRow(currentRow));

  return rows.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

export function buildHistoryDayGroups(rows: readonly HistoryRow[]): readonly HistoryDayGroup[] {
  const groups = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const dayKey = row.startedAt.slice(0, 10);
    const dayRows = groups.get(dayKey) ?? [];
    dayRows.push(row);
    groups.set(dayKey, dayRows);
  }

  return Array.from(groups.entries()).map(([dayKey, dayRows]) => ({
    dayKey,
    label: historyDayFormatter.format(new Date(`${dayKey}T12:00:00`)),
    rows: dayRows,
  }));
}

export function historyRowTitle(row: HistoryRow): string {
  return row.siteTitle ?? row.windowTitle ?? row.siteDomain ?? row.appName;
}

function startHistoryRow(segment: ActivitySegment): MutableHistoryRow {
  const classification = historyClassification(segment);
  return {
    id: `history-row-${segment.id}-${segment.id}`,
    segmentIds: [segment.id],
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    durationSeconds: segment.durationSeconds,
    appName: segment.appName,
    bundleId: segment.bundleId,
    browserName: segment.browserName,
    siteDomain: segment.siteDomain,
    siteTitle: segment.siteTitle,
    siteUrl: segment.siteUrl,
    windowTitle: segment.windowTitle,
    classification,
    searchParts: [...historySearchParts(segment), classification.categoryLabel, classification.productivityLabel],
  };
}

function finishHistoryRow(row: MutableHistoryRow): HistoryRow {
  const firstId = row.segmentIds[0];
  const lastId = row.segmentIds[row.segmentIds.length - 1];
  return {
    id: firstId === undefined || lastId === undefined ? row.id : `history-row-${firstId}-${lastId}`,
    segmentIds: [...row.segmentIds],
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    appName: row.appName,
    bundleId: row.bundleId,
    browserName: row.browserName,
    siteDomain: row.siteDomain,
    siteTitle: row.siteTitle,
    siteUrl: row.siteUrl,
    windowTitle: row.windowTitle,
    classification: row.classification,
    searchText: row.searchParts.filter(Boolean).join(" ").toLowerCase(),
  };
}

function canMergeIntoHistoryRow(row: MutableHistoryRow, segment: ActivitySegment): boolean {
  return sameApp(row, segment) &&
    (row.windowTitle ?? null) === (segment.windowTitle ?? null) &&
    Date.parse(row.endedAt) === Date.parse(segment.startedAt);
}

function sameApp(row: MutableHistoryRow, segment: ActivitySegment): boolean {
  const rowBundleId = row.bundleId ?? null;
  const segmentBundleId = segment.bundleId ?? null;
  if (rowBundleId !== null && segmentBundleId !== null) return rowBundleId === segmentBundleId;
  return row.appName === segment.appName;
}

function historySearchParts(segment: ActivitySegment): readonly string[] {
  return [
    segment.appName,
    segment.browserName,
    segment.siteDomain,
    segment.siteTitle,
    segment.siteUrl,
    segment.windowTitle,
  ].filter((part): part is string => Boolean(part));
}

function historyClassification(segment: ActivitySegment): HistoryClassification {
  const classification = segment.classification ?? classifyActivityDetailed(segment, { includeAiClassifications: false });
  return {
    category: classification.category,
    productivity: classification.productivity,
    categoryLabel: categoryLabel(classification.category),
    productivityLabel: productivityLabel(classification.productivity),
  };
}
