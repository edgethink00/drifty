import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";

const BYTES_PER_GIB = 1024 * 1024 * 1024;

export function managedModelRuntimeMemoryLabel(
  model: ManagedLocalAiModel,
  status: ManagedLocalAiStatus | null,
): string | null {
  const liveBytes = status?.selectedModelId === model.id && status.state === "running"
    ? status.memoryUsageBytes
    : null;
  if (liveBytes !== null && liveBytes > 0) return formatGigabytes(liveBytes);
  if (model.estimatedRuntimeMemoryBytes === null) return null;
  return `~${formatGigabytes(model.estimatedRuntimeMemoryBytes)}`;
}

function formatGigabytes(bytes: number): string {
  const value = (bytes / BYTES_PER_GIB).toFixed(1).replace(/\.0$/, "");
  return `${value} GB`;
}
