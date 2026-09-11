import type { ManagedLocalAiStatus } from "./managedLocalAiClient";

const BYTES_PER_GB = 1_000_000_000;

export function managedLocalAiProgressText(progress: ManagedLocalAiStatus["progress"]): string | null {
  if (progress === null) return null;
  if (progress.totalBytes <= 0) return `${formatGigabytes(progress.downloadedBytes)} downloaded`;
  return `${formatGigabyteValue(progress.downloadedBytes)}/${formatGigabytes(progress.totalBytes)}`;
}

/**
 * 0..1 completion for a remaining-time estimate. Bytes are the honest measure;
 * the reported percentage is the fallback for a source that never sent a
 * content length.
 */
export function managedLocalAiProgressValue(progress: ManagedLocalAiStatus["progress"]): number | null {
  if (progress === null) return null;
  const value = progress.totalBytes > 0
    ? progress.downloadedBytes / progress.totalBytes
    : progress.percent / 100;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

function formatGigabytes(bytes: number): string {
  return `${formatGigabyteValue(bytes)} GB`;
}

function formatGigabyteValue(bytes: number): string {
  return (bytes / BYTES_PER_GB).toFixed(1);
}
