import type { PetModeReadinessStatus } from "./petModeNativeReadiness";

export type PetModeNativeSyncErrorCategory =
  | "window_unavailable"
  | "native_timeout"
  | "presentation_mismatch"
  | "native_error";

export type PetModeNativeSyncDiagnostic = {
  readonly token: number;
  readonly enabled: boolean;
  readonly width: number;
  readonly height: number;
  readonly forceReveal: boolean;
  readonly attempt: number;
  readonly requestedAtMs: number;
  readonly settledAtMs?: number;
  readonly outcome: "pending" | "resolved" | "rejected" | "cancelled";
  readonly errorCategory?: PetModeNativeSyncErrorCategory;
  readonly readiness?: PetModeReadinessStatus;
};

export function classifyPetModeNativeSyncError(error: unknown): PetModeNativeSyncErrorCategory {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.includes("Pet Mode window is not available")) return "window_unavailable";
  if (message.includes("pet_mode::") && message.includes("did not finish on the native thread")) return "native_timeout";
  if (message.includes("Pet Mode enable presentation did not complete:")) return "presentation_mismatch";
  return "native_error";
}

export function beginPetModeNativeSyncDiagnostic(
  records: readonly PetModeNativeSyncDiagnostic[],
  request: PetModeNativeSyncDiagnostic,
): readonly PetModeNativeSyncDiagnostic[] {
  // Only the last two requests of this renderer mount are retained. This is
  // enough to distinguish both bounded startup attempts without persisting logs.
  return [...records, request].slice(-2);
}

export function settlePetModeNativeSyncDiagnostic(
  records: readonly PetModeNativeSyncDiagnostic[],
  token: number,
  outcome: "resolved" | "rejected" | "cancelled",
  settledAtMs: number,
  errorCategory?: PetModeNativeSyncErrorCategory,
): readonly PetModeNativeSyncDiagnostic[] {
  const latest = records[records.length - 1];
  // An off/size replacement or cleanup owns the display immediately. A late
  // response cannot overwrite its pending/resolved state or amend old history.
  if (!latest || latest.token !== token || latest.outcome !== "pending") return records;
  return [...records.slice(0, -1), { ...latest, outcome, settledAtMs, errorCategory }];
}

export function formatPetModeNativeSyncDiagnostic(record: PetModeNativeSyncDiagnostic): string {
  const time = (ms: number) => `${new Date(ms).toISOString().slice(11, 23)}Z`;
  const result = record.outcome === "resolved"
    ? "resolved (invoke only)"
    : `${record.outcome}${record.errorCategory ? ` ${record.errorCategory}` : ""}`;
  return `Native pet sync · ${record.enabled ? "enabled" : "disabled"} · requested body ${record.width}×${record.height}`
    + ` · force reveal ${record.forceReveal} · attempt ${record.attempt}/2 · ${result}`
    + ` · requested ${time(record.requestedAtMs)}`
    + (record.settledAtMs !== undefined ? ` · settled ${time(record.settledAtMs)}` : "")
    + (record.readiness ? ` · readiness ${record.readiness} (startup only)` : "");
}

export function updatePetModeNativeSyncReadiness(
  records: readonly PetModeNativeSyncDiagnostic[], token: number, readiness: PetModeReadinessStatus,
): readonly PetModeNativeSyncDiagnostic[] {
  const latest = records[records.length - 1];
  if (!latest || latest.token !== token || latest.outcome !== "rejected") return records;
  return [...records.slice(0, -1), { ...latest, readiness }];
}
