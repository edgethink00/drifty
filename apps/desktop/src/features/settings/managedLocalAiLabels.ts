import type { ManagedLocalAiStatus } from "./managedLocalAiClient";

export function isRetryableManagedModelError(errorKind: ManagedLocalAiStatus["errorKind"]): boolean {
  return errorKind === "download_failed" || errorKind === "model_artifact_missing";
}

export function managedDownloadButtonLabel(isBusy: boolean, isError: boolean, percent: number | null): string {
  if (isBusy) return percent === null ? "Downloading..." : `Downloading ${percent.toFixed(0)}%`;
  if (isError) return "Retry";
  return "Download";
}
