import type { ManagedLocalAiStatus } from "./managedLocalAiClient";

const BYTES_PER_GB = 1_000_000_000;

export function managedLocalAiProgressText(progress: ManagedLocalAiStatus["progress"]): string | null {
  if (progress === null) return null;
  if (progress.totalBytes <= 0) return `${formatGigabytes(progress.downloadedBytes)} downloaded`;
  return `${formatGigabyteValue(progress.downloadedBytes)}/${formatGigabytes(progress.totalBytes)}`;
}

function formatGigabytes(bytes: number): string {
  return `${formatGigabyteValue(bytes)} GB`;
}

function formatGigabyteValue(bytes: number): string {
  return (bytes / BYTES_PER_GB).toFixed(1);
}
