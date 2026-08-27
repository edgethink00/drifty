export const EXTREME_NUDGE_FAILURE_CODES = [
  "browser_target_missing",
  "protected_target",
  "app_target_missing",
  "app_not_running",
  "app_close_failed",
  "permission_denied",
  "automation_timed_out",
  "browser_tab_not_found",
  "automation_failed",
  "internal_error",
] as const;

export type ExtremeNudgeFailureCode = typeof EXTREME_NUDGE_FAILURE_CODES[number];

export type ExtremeNudgeFailure = {
  readonly code: ExtremeNudgeFailureCode;
  readonly diagnostic: string | null;
};

export class ExtremeNudgeApplyError extends Error {
  readonly failure: ExtremeNudgeFailure;

  constructor(failure: ExtremeNudgeFailure) {
    super(`Automatic close failed: ${failure.code}`);
    this.name = "ExtremeNudgeApplyError";
    this.failure = failure;
  }
}

export function normalizeExtremeNudgeFailure(value: unknown): ExtremeNudgeFailure {
  const candidate = errorRecord(value);
  const code = isExtremeNudgeFailureCode(candidate?.code)
    ? candidate.code
    : classifyLegacyExtremeNudgeFailure(errorText(value));
  return {
    code,
    diagnostic: normalizeExtremeNudgeDiagnostic(candidate?.diagnostic),
  };
}

export function getExtremeNudgeFailure(value: unknown): ExtremeNudgeFailure {
  if (value instanceof ExtremeNudgeApplyError) return value.failure;
  return normalizeExtremeNudgeFailure(value);
}

export function isExtremeNudgeFailureCode(value: unknown): value is ExtremeNudgeFailureCode {
  return typeof value === "string"
    && EXTREME_NUDGE_FAILURE_CODES.some((code) => code === value);
}

export function normalizeExtremeNudgeDiagnostic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[a-z0-9_]{1,96}$/.test(normalized) ? normalized : null;
}

function classifyLegacyExtremeNudgeFailure(message: string | null): ExtremeNudgeFailureCode {
  const normalized = message?.toLowerCase() ?? "";
  if (normalized.includes("timed out")) return "automation_timed_out";
  if (
    normalized.includes("-1743")
    || normalized.includes("not authorized to send apple events")
    || normalized.includes("not allowed assistive access")
  ) return "permission_denied";
  if (normalized.includes("browser tab was not found")) return "browser_tab_not_found";
  if (normalized.includes("captured page url or domain")) return "browser_target_missing";
  if (normalized.includes("protected app")) return "protected_target";
  if (normalized.includes("app identity is required") || normalized.includes("bundle id is required")) {
    return "app_target_missing";
  }
  if (normalized.includes("no running app found")) return "app_not_running";
  if (normalized.includes("unable to terminate")) return "app_close_failed";
  if (normalized.includes("osascript failed") || normalized.includes("browser automation failed")) {
    return "automation_failed";
  }
  return "internal_error";
}

function errorRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (value instanceof ExtremeNudgeApplyError) return value.failure;
  return value as Record<string, unknown>;
}

function errorText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  const candidate = errorRecord(value);
  if (typeof candidate?.message === "string") return candidate.message;
  return null;
}
