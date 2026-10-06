import type { CloudAiQuotaWindow } from "./cloudAiRequestBackoff";

/** Internal backoff metadata; paid limits do not create user-facing guidance. */
export type CloudQuotaRecovery = {
  readonly window: CloudAiQuotaWindow | null;
  readonly retryAtMs: number | null;
};
