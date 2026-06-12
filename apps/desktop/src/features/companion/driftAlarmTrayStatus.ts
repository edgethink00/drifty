import type { DriftAlarmTrayStatus } from "@drifty/domain";
import { formatCompactDurationFromSeconds, formatTimeLabel } from "../../lib/formatting";

export type DriftAlarmTrayResult =
  | { readonly kind: "disabled" }
  | { readonly kind: "not_today" }
  | { readonly kind: "tracker_paused" }
  | { readonly kind: "no_candidate" }
  | { readonly kind: "snoozed"; readonly detail?: string | null }
  | { readonly kind: "checking"; readonly candidateDetail?: string | null }
  | { readonly kind: "delivered"; readonly candidateDetail?: string | null }
  | { readonly kind: "already_delivered"; readonly candidateDetail?: string | null }
  | { readonly kind: "suppressed"; readonly reason: string; readonly candidateDetail?: string | null }
  | { readonly kind: "error"; readonly reason: string };

export type DriftAlarmTrayStatusInput = {
  readonly enabled: boolean;
  readonly checkedAt: Date | null;
  readonly result: DriftAlarmTrayResult;
};

export function buildDriftAlarmTrayStatus(input: DriftAlarmTrayStatusInput): DriftAlarmTrayStatus {
  const checkedAt = checkedAtOrNull(input.checkedAt);

  return {
    enabled: input.enabled,
    lastCheckedAt: checkedAt?.toISOString() ?? null,
    lastCheckedLabel: checkedAt ? formatDriftAlarmTrayCheckTime(checkedAt) : input.enabled ? "Never" : "Off",
    resultLabel: resultLabel(input.result),
    detailLabel: resultDetailLabel(input.result),
  };
}

export function buildDriftAlarmTrayCandidateDetail(contextLabel: string, durationSeconds: number): string {
  const context = compactMenuLabel(contextLabel) ?? "Current drift";
  const duration = formatCompactDurationFromSeconds(Math.max(0, durationSeconds));
  return `${context} - ${duration}`;
}

export function formatDriftAlarmTrayCheckTime(value: Date): string {
  return formatTimeLabel(value);
}

function checkedAtOrNull(value: Date | null): Date | null {
  if (!value) return null;
  return Number.isFinite(value.getTime()) ? value : null;
}

function resultLabel(result: DriftAlarmTrayResult): string {
  switch (result.kind) {
    case "disabled":
      return "Alerts disabled";
    case "not_today":
      return "Not checking selected day";
    case "tracker_paused":
      return "Tracker paused";
    case "no_candidate":
      return "No eligible drift";
    case "snoozed":
      return "Snoozed";
    case "checking":
      return "Checking drift candidate";
    case "delivered":
      return "Alarm delivered";
    case "already_delivered":
      return "Alarm already shown";
    case "suppressed":
      return `Suppressed: ${suppressionReasonLabel(result.reason)}`;
    case "error":
      return "Check failed";
    default:
      return assertNever(result);
  }
}

function resultDetailLabel(result: DriftAlarmTrayResult): string | null {
  switch (result.kind) {
    case "disabled":
    case "not_today":
    case "tracker_paused":
    case "no_candidate":
      return null;
    case "snoozed":
      return compactMenuLabel(result.detail ?? null);
    case "checking":
    case "delivered":
    case "already_delivered":
    case "suppressed":
      return compactMenuLabel(result.candidateDetail ?? null);
    case "error":
      return compactMenuLabel(result.reason);
    default:
      return assertNever(result);
  }
}

function suppressionReasonLabel(reason: string): string {
  const normalized = reason.trim();
  if (normalized === "ai-low-confidence") return "AI low confidence";
  if (normalized === "ai-timeout") return "AI gate timed out";
  if (normalized === "ai-classified-focus") return "AI classified focus";
  if (normalized === "ai-classified-neutral") return "AI classified neutral";
  if (normalized.startsWith("ai-unavailable:")) return "AI unavailable";
  return compactMenuLabel(normalized.replace(/[-_]+/g, " ")) ?? "suppressed";
}

function compactMenuLabel(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return null;
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected drift alarm tray status: ${JSON.stringify(value)}`);
}
