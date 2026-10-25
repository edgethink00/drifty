import type { TrackerStatus } from "@drifty/domain";

/**
 * Free space on the tracker database's volume below which recording is about
 * to stop. SQLite capture writes fail with "database or disk is full" at zero
 * (DRIFTY-MAC-NATIVE-81, 1.14.0); this leaves headroom for the WAL and the
 * daily backup while the person frees space. Owner-review default.
 */
export const TRACKER_STORAGE_LOW_BYTES = 256 * 1024 * 1024;

/** One judgment for every surface that reports low tracker storage. */
export function isTrackerStorageLow(status: Pick<TrackerStatus, "storageFreeBytes"> | null | undefined): boolean {
  const free = status?.storageFreeBytes;
  return typeof free === "number" && Number.isFinite(free) && free >= 0 && free < TRACKER_STORAGE_LOW_BYTES;
}

