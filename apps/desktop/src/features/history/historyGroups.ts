import { classifyActivityDetailed, exclusionSourceLabel, isExcludedSegment, logicalDayIsoDateForDate } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ClassificationOptions, ExclusionSource, ProductivityLabel } from "@drifty/domain";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import type { DisplayLanguage } from "../localization/languagePreference";

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
  readonly exclusionSource?: ExclusionSource | null;
  readonly searchText: string;
};

export type HistoryDayGroup = {
  readonly dayKey: string;
  readonly label: string;
  readonly rows: readonly HistoryRow[];
};

export type HistoryRowsWindow = {
  readonly rows: readonly HistoryRow[];
  readonly hasMore: boolean;
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
  exclusionSource?: ExclusionSource | null;
  searchParts: string[];
};

export function buildHistoryRows(segments: readonly ActivitySegment[], classificationOptions?: ClassificationOptions): readonly HistoryRow[] {
  const rows: HistoryRow[] = [];
  let currentRow: MutableHistoryRow | null = null;

  for (const segment of [...segments].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))) {
    if (currentRow === null || !canMergeIntoHistoryRow(currentRow, segment)) {
      if (currentRow !== null) rows.push(finishHistoryRow(currentRow));
      currentRow = startHistoryRow(segment, classificationOptions);
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

export function buildHistoryRowsWindow(segments: readonly ActivitySegment[], limit: number, classificationOptions?: ClassificationOptions): HistoryRowsWindow {
  const rowLimit = Math.max(0, Math.floor(limit));
  if (rowLimit === 0 || segments.length === 0) return { rows: [], hasMore: segments.length > 0 };

  const rows: HistoryRow[] = [];
  let currentRow: MutableHistoryRow | null = null;

  // Tracker timelines arrive in chronological order. Walk backward so History
  // can show the newest rows without materializing the full 90-day archive.
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment) continue;

    if (currentRow === null) {
      currentRow = startHistoryRow(segment, classificationOptions);
      continue;
    }

    if (canPrependIntoHistoryRow(currentRow, segment)) {
      prependIntoHistoryRow(currentRow, segment, classificationOptions);
      continue;
    }

    rows.push(finishHistoryRow(currentRow));
    if (rows.length >= rowLimit) return { rows, hasMore: true };
    currentRow = startHistoryRow(segment, classificationOptions);
  }

  if (currentRow !== null) rows.push(finishHistoryRow(currentRow));

  return {
    rows,
    hasMore: false,
  };
}

export function buildHistoryDayGroups(rows: readonly HistoryRow[], startOfDayMinutes = 0, language: DisplayLanguage = "en"): readonly HistoryDayGroup[] {
  const groups = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const dayKey = logicalDayIsoDateForDate(new Date(row.startedAt), startOfDayMinutes);
    const dayRows = groups.get(dayKey) ?? [];
    dayRows.push(row);
    groups.set(dayKey, dayRows);
  }

  const historyDayFormatter = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    day: "numeric",
    month: language === "ko" ? "long" : "short",
    year: "numeric",
  });

  return Array.from(groups.entries()).map(([dayKey, dayRows]) => ({
    dayKey,
    label: historyDayFormatter.format(new Date(`${dayKey}T12:00:00`)),
    rows: dayRows,
  }));
}

export function historyRowTitle(row: HistoryRow): string {
  if (isExcludedSegment(row)) {
    return exclusionSourceLabel(row.exclusionSource);
  }
  return row.siteTitle ?? row.windowTitle ?? row.siteDomain ?? row.appName;
}

function startHistoryRow(segment: ActivitySegment, classificationOptions?: ClassificationOptions): MutableHistoryRow {
  const classification = historyClassification(segment, classificationOptions);
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
    exclusionSource: segment.exclusionSource,
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
    exclusionSource: row.exclusionSource,
    searchText: row.searchParts.filter(Boolean).join(" ").toLowerCase(),
  };
}

function canMergeIntoHistoryRow(row: MutableHistoryRow, segment: ActivitySegment): boolean {
  return sameApp(row, segment) &&
    (row.windowTitle ?? null) === (segment.windowTitle ?? null) &&
    Date.parse(row.endedAt) === Date.parse(segment.startedAt);
}

function canPrependIntoHistoryRow(row: MutableHistoryRow, segment: ActivitySegment): boolean {
  return sameApp(row, segment) &&
    (row.windowTitle ?? null) === (segment.windowTitle ?? null) &&
    Date.parse(segment.endedAt) === Date.parse(row.startedAt);
}

function prependIntoHistoryRow(row: MutableHistoryRow, segment: ActivitySegment, classificationOptions?: ClassificationOptions): void {
  const classification = historyClassification(segment, classificationOptions);
  row.segmentIds.unshift(segment.id);
  row.startedAt = segment.startedAt;
  row.durationSeconds += segment.durationSeconds;
  row.appName = segment.appName;
  row.bundleId = segment.bundleId;
  row.browserName = segment.browserName;
  row.siteDomain = segment.siteDomain;
  row.siteTitle = segment.siteTitle;
  row.siteUrl = segment.siteUrl;
  row.windowTitle = segment.windowTitle;
  row.classification = classification;
  row.searchParts.push(...historySearchParts(segment), classification.categoryLabel, classification.productivityLabel);
}

function sameApp(row: MutableHistoryRow, segment: ActivitySegment): boolean {
  if (isExcludedSegment(row) && isExcludedSegment(segment)) return true;
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

function historyClassification(segment: ActivitySegment, classificationOptions?: ClassificationOptions): HistoryClassification {
  const classification = segment.classification ?? classifyActivityDetailed(segment, {
    ...classificationOptions,
    includeAiClassifications: false,
  });
  return {
    category: classification.category,
    productivity: classification.productivity,
    categoryLabel: categoryLabel(classification.category),
    productivityLabel: productivityLabel(classification.productivity),
  };
}
