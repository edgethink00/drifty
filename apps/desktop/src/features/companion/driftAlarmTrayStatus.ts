import type { DriftAlarmTrayStatus, SystemTransientActivity } from "@drifty/domain";
import { formatCompactDurationFromSeconds, formatTimeLabel } from "../../lib/formatting";

type DriftAlarmDeferredReason = Exclude<SystemTransientActivity, null>;

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
  | { readonly kind: "deferred"; readonly reason: DriftAlarmDeferredReason; readonly candidateDetail?: string | null }
  | { readonly kind: "error"; readonly reason: string };

export type DriftAlarmTrayStatusInput = {
  readonly enabled: boolean;
  readonly checkedAt: Date | null;
  readonly result: DriftAlarmTrayResult;
  readonly trackerRunning?: boolean | null;
};

export function buildDriftAlarmTrayStatus(input: DriftAlarmTrayStatusInput): DriftAlarmTrayStatus {
  const checkedAt = input.result.kind === "tracker_paused" ? null : checkedAtOrNull(input.checkedAt);
  const baseStatus = {
    enabled: input.enabled,
    statusLabel: statusLabel(input.enabled, input.result),
    lastCheckedAt: checkedAt?.toISOString() ?? null,
    lastCheckedLabel: input.result.kind === "tracker_paused"
      ? "Not checking"
      : checkedAt
        ? formatDriftAlarmTrayCheckTime(checkedAt)
        : input.enabled ? "Never" : "Off",
    resultLabel: resultLabel(input.result),
    detailLabel: resultDetailLabel(input.result),
  };

  return input.trackerRunning === undefined
    ? baseStatus
    : { ...baseStatus, trackerRunning: input.trackerRunning };
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

function statusLabel(enabled: boolean, result: DriftAlarmTrayResult): string {
  if (!enabled) return "Drift alerts: Off";

  switch (result.kind) {
    case "disabled":
      return "Drift alerts: Off";
    case "not_today":
      return "Drift alerts: Idle";
    case "tracker_paused":
      return "Drift alerts: Paused";
    case "no_candidate":
      return "Drift alerts: Monitoring";
    case "snoozed":
      return "Drift alerts: Snoozed";
    case "checking":
      return "Drift alerts: Checking";
    case "delivered":
      return "Drift alerts: Delivered";
    case "already_delivered":
      return "Drift alerts: Already shown";
    case "suppressed":
      return suppressionStatusLabel(result.reason);
    case "deferred":
      return "Drift alerts: Deferred";
    case "error":
      return "Drift alerts: Check failed";
    default:
      return assertNever(result);
  }
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
    case "deferred":
      return `Waiting for ${systemTransientActivityLabel(result.reason)}`;
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
    case "deferred":
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

function suppressionStatusLabel(reason: string): string {
  const normalized = reason.trim();
  if (normalized.startsWith("ai-unavailable:")) return "Drift alerts: AI unavailable";
  if (normalized === "ai-timeout") return "Drift alerts: AI timed out";
  return "Drift alerts: Suppressed";
}

function systemTransientActivityLabel(reason: DriftAlarmDeferredReason): string {
  switch (reason) {
    case "mission_control":
      return "Mission Control";
    case "app_switcher":
      return "app switcher";
    case "launchpad":
      return "Launchpad";
    case "spotlight":
      return "Spotlight";
    case "system_overlay":
      return "system overlay";
    default:
      return assertNever(reason);
  }
}

function compactMenuLabel(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return null;
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected drift alarm tray status: ${JSON.stringify(value)}`);
}
