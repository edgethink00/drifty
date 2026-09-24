// A local resume marker, not a copy of activity. The tracker remains the source
// of truth for which segments still need classification.
export type FirstDayCloudBacklog = {
  readonly version: 1;
  readonly runId: string;
  readonly day: string;
  readonly importPending: boolean;
};

// A run started by this renderer already owns the foreground/background pass.
// This set intentionally disappears on process restart; the persisted marker does not.
const activeRunIds = new Set<string>();

export function isFirstDayCloudBacklogActive(runId: string): boolean {
  return activeRunIds.has(runId);
}

export function releaseFirstDayCloudBacklog(runId: string): void {
  activeRunIds.delete(runId);
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function key(ownerId: string): string {
  return `drifty:first-day-cloud-backlog:v1:${ownerId}`;
}

export function readFirstDayCloudBacklog(ownerId: string): FirstDayCloudBacklog | null {
  const target = storage();
  if (!target || !ownerId) return null;
  try {
    const raw = target.getItem(key(ownerId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const marker = value as Record<string, unknown>;
    if (marker.version !== 1
      || typeof marker.runId !== "string" || marker.runId.length < 8
      || typeof marker.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(marker.day)
      || typeof marker.importPending !== "boolean") return null;
    return marker as FirstDayCloudBacklog;
  } catch {
    return null;
  }
}

export function beginFirstDayCloudBacklog(ownerId: string, day: string, importPending: boolean): FirstDayCloudBacklog | null {
  const target = storage();
  if (!target || !ownerId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const marker: FirstDayCloudBacklog = {
    version: 1,
    runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    day,
    importPending,
  };
  try {
    target.setItem(key(ownerId), JSON.stringify(marker));
    activeRunIds.add(marker.runId);
    return marker;
  } catch {
    return null;
  }
}

export function updateFirstDayCloudBacklog(
  ownerId: string,
  runId: string,
  changes: Partial<Pick<FirstDayCloudBacklog, "day" | "importPending">>,
): FirstDayCloudBacklog | null {
  const current = readFirstDayCloudBacklog(ownerId);
  if (!current || current.runId !== runId) return null;
  const next = { ...current, ...changes };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.day)) return null;
  try {
    storage()?.setItem(key(ownerId), JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

export function clearFirstDayCloudBacklog(ownerId: string, runId: string): boolean {
  const current = readFirstDayCloudBacklog(ownerId);
  if (!current || current.runId !== runId) return false;
  try {
    storage()?.removeItem(key(ownerId));
    activeRunIds.delete(runId);
    return true;
  } catch {
    return false;
  }
}

export async function resumeFirstDayCloudBacklog({
  ownerId,
  importHistory,
  resolveTargetDay,
  runClassification,
  hasRemainingCandidates,
}: {
  readonly ownerId: string;
  readonly importHistory: () => Promise<void>;
  readonly resolveTargetDay: (day: string) => Promise<string>;
  readonly runClassification: (day: string) => Promise<unknown | null>;
  readonly hasRemainingCandidates: (day: string) => Promise<boolean>;
}): Promise<"none" | "pending" | "completed"> {
  const marker = readFirstDayCloudBacklog(ownerId);
  if (!marker) return "none";
  if (isFirstDayCloudBacklogActive(marker.runId)) return "pending";

  activeRunIds.add(marker.runId);
  try {

    if (marker.importPending) {
      try {
        await importHistory();
        if (!updateFirstDayCloudBacklog(ownerId, marker.runId, { importPending: false })) return "none";
      } catch {
        // Browser reconstruction is optional. Classify existing local segments,
        // but retain the marker so a later pass can retry the import.
      }
    }

    const day = await resolveTargetDay(marker.day);
    if (!updateFirstDayCloudBacklog(ownerId, marker.runId, { day })) return "none";
    const result = await runClassification(day);
    if (result === null) return "pending";
    if (await hasRemainingCandidates(day) || readFirstDayCloudBacklog(ownerId)?.importPending) return "pending";
    return clearFirstDayCloudBacklog(ownerId, marker.runId) ? "completed" : "none";
  } finally {
    releaseFirstDayCloudBacklog(marker.runId);
  }
}
