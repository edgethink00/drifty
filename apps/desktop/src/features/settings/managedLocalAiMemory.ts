import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";

const BYTES_PER_GIB = 1024 * 1024 * 1024;
const BYTES_PER_MIB = 1024 * 1024;

export function managedModelRuntimeMemoryLabel(
  model: ManagedLocalAiModel,
  status: ManagedLocalAiStatus | null,
): string | null {
  const liveBytes = status?.selectedModelId === model.id && status.state === "running"
    ? status.memoryUsageBytes
    : null;
  if (liveBytes !== null && liveBytes > 0) return formatLiveMemory(liveBytes);
  if (model.estimatedRuntimeMemoryBytes === null) return null;
  return `~${formatGigabytes(model.estimatedRuntimeMemoryBytes)}`;
}

function formatLiveMemory(bytes: number): string {
  if (bytes < BYTES_PER_GIB) return `${Math.max(1, Math.round(bytes / BYTES_PER_MIB))} MB`;
  return formatGigabytes(bytes);
}

function formatGigabytes(bytes: number): string {
  const value = (bytes / BYTES_PER_GIB).toFixed(1).replace(/\.0$/, "");
  return `${value} GB`;
}
