import { classifyActivityDetailed, isExcludedSegment, logicalDayIsoDateForDate } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, ClassificationOptions, ExclusionSource, ProductivityLabel } from "@drifty/domain";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import type { DisplayLanguage } from "../localization/languagePreference";
import { localeForDisplayLanguage } from "../../lib/formatting";

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

export type HistoryTitleSource = {
  readonly appName: string;
  readonly siteDomain?: string | null;
  readonly siteTitle?: string | null;
  readonly windowTitle?: string | null;
  readonly exclusionSource?: ExclusionSource | null;
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

/**
 * One continuous stretch on the same page still arrives as several segments: the
 * browser rewrites its window title while audio plays, the URL picks up a
 * timestamp parameter, or the tracker simply opens a new sample after a short
 * capture gap. History shows the page title, so those segments read as identical
 * rows stacked on top of each other. Rows therefore merge on what the row
 * actually displays, and a gap up to the tracker's passive-capture grace counts
 * as the same stretch of activity.
 */
const HISTORY_ROW_MERGE_GAP_MS = 15_000;

export function buildHistoryRows(segments: readonly ActivitySegment[], classificationOptions?: ClassificationOptions): readonly HistoryRow[] {
  const rows: HistoryRow[] = [];
  let currentRow: MutableHistoryRow | null = null;

  for (const segment of [...segments].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))) {
    const classification = historyClassification(segment, classificationOptions);
    if (currentRow !== null && canAppendIntoHistoryRow(currentRow, segment, classification)) {
      appendIntoHistoryRow(currentRow, segment);
      continue;
    }

    if (currentRow !== null) rows.push(finishHistoryRow(currentRow));
    currentRow = startHistoryRow(segment, classification);
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

    const classification = historyClassification(segment, classificationOptions);
    if (currentRow === null) {
      currentRow = startHistoryRow(segment, classification);
      continue;
    }

    if (canPrependIntoHistoryRow(currentRow, segment, classification)) {
      prependIntoHistoryRow(currentRow, segment, classification);
      continue;
    }

    rows.push(finishHistoryRow(currentRow));
    if (rows.length >= rowLimit) return { rows, hasMore: true };
    currentRow = startHistoryRow(segment, classification);
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

  const historyDayFormatter = new Intl.DateTimeFormat(localeForDisplayLanguage(language), {
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

export function historyRowTitle(row: HistoryTitleSource): string {
  if (isExcludedSegment(row)) {
    return "";
  }
  return row.siteTitle ?? row.windowTitle ?? row.siteDomain ?? row.appName;
}

function startHistoryRow(segment: ActivitySegment, classification: HistoryClassification): MutableHistoryRow {
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
    searchParts: [...historySearchParts(segment)],
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
    // Built here rather than per merge step so a row reads the same whether it
    // was assembled forward (search) or backward (the newest-first window).
    searchText: [...row.searchParts, row.classification.categoryLabel, row.classification.productivityLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

function canAppendIntoHistoryRow(row: MutableHistoryRow, segment: ActivitySegment, classification: HistoryClassification): boolean {
  return sameHistorySurface(row, segment, classification) && withinHistoryMergeGap(row, segment);
}

function canPrependIntoHistoryRow(row: MutableHistoryRow, segment: ActivitySegment, classification: HistoryClassification): boolean {
  return sameHistorySurface(row, segment, classification) && withinHistoryMergeGap(segment, row);
}

function appendIntoHistoryRow(row: MutableHistoryRow, segment: ActivitySegment): void {
  row.segmentIds.push(segment.id);
  row.durationSeconds += segment.durationSeconds;
  if (Date.parse(segment.endedAt) > Date.parse(row.endedAt)) row.endedAt = segment.endedAt;
  row.searchParts.push(...historySearchParts(segment));
}

function prependIntoHistoryRow(row: MutableHistoryRow, segment: ActivitySegment, classification: HistoryClassification): void {
  row.segmentIds.unshift(segment.id);
  row.durationSeconds += segment.durationSeconds;
  if (Date.parse(segment.startedAt) < Date.parse(row.startedAt)) row.startedAt = segment.startedAt;
  row.appName = segment.appName;
  row.bundleId = segment.bundleId;
  row.browserName = segment.browserName;
  row.siteDomain = segment.siteDomain;
  row.siteTitle = segment.siteTitle;
  row.siteUrl = segment.siteUrl;
  row.windowTitle = segment.windowTitle;
  row.classification = classification;
  row.searchParts.unshift(...historySearchParts(segment));
}

/**
 * Rows merge on the identity History actually renders: the same app, the same
 * site, the same displayed title, and the same classification badge. Raw window
 * titles and URLs are deliberately left out, because those churn while a single
 * page stays open.
 */
function sameHistorySurface(row: MutableHistoryRow, segment: ActivitySegment, classification: HistoryClassification): boolean {
  return sameApp(row, segment) &&
    (row.exclusionSource ?? null) === (segment.exclusionSource ?? null) &&
    (row.siteDomain ?? null) === (segment.siteDomain ?? null) &&
    historyRowTitle(row) === historyRowTitle(segment) &&
    row.classification.category === classification.category &&
    row.classification.productivity === classification.productivity;
}

function withinHistoryMergeGap(
  earlier: { readonly startedAt: string; readonly endedAt: string },
  later: { readonly startedAt: string },
): boolean {
  const earlierStartMs = Date.parse(earlier.startedAt);
  const earlierEndMs = Date.parse(earlier.endedAt);
  const laterStartMs = Date.parse(later.startedAt);
  if (!Number.isFinite(earlierStartMs) || !Number.isFinite(earlierEndMs) || !Number.isFinite(laterStartMs)) return false;
  return laterStartMs >= earlierStartMs && laterStartMs - earlierEndMs <= HISTORY_ROW_MERGE_GAP_MS;
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
