import { isExcludedSegment, type ActivitySegment } from "@drifty/domain";
import type { HistoryRow } from "./historyGroups";

/** Only ordinary web destinations can be opened from a recorded page. */
export function historyWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Display rows can merge different URLs with the same title. Never choose one arbitrarily. */
export function historyPageDestination(row: HistoryRow, segmentsById: ReadonlyMap<string, ActivitySegment>): string | null {
  if (isExcludedSegment(row) || !row.siteDomain || row.segmentIds.length === 0) return null;
  let destination: string | null = null;
  for (const id of row.segmentIds) {
    const url = historyWebUrl(segmentsById.get(id)?.siteUrl);
    if (!url || (destination !== null && destination !== url)) return null;
    destination = url;
  }
  return destination;
}
