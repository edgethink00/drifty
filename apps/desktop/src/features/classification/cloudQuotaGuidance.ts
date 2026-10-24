import type { CloudAiQuotaWindow } from "./cloudAiRequestBackoff";

/** Server-backed quota wait; refill waits show their automatic resume time. */
export type CloudQuotaRecovery = {
  readonly policy?: "refill" | "legacy" | null;
  readonly window: CloudAiQuotaWindow | null;
  readonly retryAtMs: number | null;
};
