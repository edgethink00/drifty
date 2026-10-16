import type { DriftAlarmTrayStatus, SystemTransientActivity } from "@drifty/domain";
import { formatCompactDurationFromSeconds, formatLocalizedTimeLabel, formatTimeLabel } from "../../lib/formatting";

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
  readonly locale?: "en" | "ko" | "es";
};

/**
 * The language-independent part of a tray publication. Keeping this separate from
 * the rendered {@link DriftAlarmTrayStatus} lets the labels be rebuilt whenever the
 * display language changes, instead of freezing the language of the last check.
 */
export type DriftAlarmTrayState = {
  readonly checkedAt: Date | null;
  readonly result: DriftAlarmTrayResult;
};

export function buildDriftAlarmTrayStatus(input: DriftAlarmTrayStatusInput): DriftAlarmTrayStatus {
  const checkedAt = input.result.kind === "tracker_paused" ? null : checkedAtOrNull(input.checkedAt);
  const ko = input.locale === "ko";
  const es = input.locale === "es";
  const baseStatus = {
    enabled: input.enabled,
    statusLabel: es ? spanishStatusLabel(input.enabled, input.result) : statusLabel(input.enabled, input.result, ko),
    lastCheckedAt: checkedAt?.toISOString() ?? null,
    lastCheckedLabel: input.result.kind === "tracker_paused"
      ? (ko ? "확인 안 함" : es ? "Sin comprobar" : "Not checking")
      : checkedAt
        ? es ? formatLocalizedTimeLabel(checkedAt, "es") : formatDriftAlarmTrayCheckTime(checkedAt)
        : input.enabled ? (ko ? "없음" : es ? "Nunca" : "Never") : (ko ? "꺼짐" : es ? "Desactivadas" : "Off"),
    resultLabel: es ? spanishResultLabel(input.result) : resultLabel(input.result, ko),
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

function statusLabel(enabled: boolean, result: DriftAlarmTrayResult, ko: boolean): string {
  if (!enabled) return ko ? "딴짓 알림: 꺼짐" : "Drift alerts: Off";

  switch (result.kind) {
    case "disabled":
      return ko ? "딴짓 알림: 꺼짐" : "Drift alerts: Off";
    case "not_today":
      return ko ? "딴짓 알림: 대기" : "Drift alerts: Idle";
    case "tracker_paused":
      return ko ? "딴짓 알림: 일시 정지됨" : "Drift alerts: Paused";
    case "no_candidate":
      return ko ? "딴짓 알림: 감지 중" : "Drift alerts: Monitoring";
    case "snoozed":
      return ko ? "딴짓 알림: 다시 알림" : "Drift alerts: Snoozed";
    case "checking":
      return ko ? "딴짓 알림: 분석 중" : "Drift alerts: Checking";
    case "delivered":
      return ko ? "딴짓 알림: 전달됨" : "Drift alerts: Delivered";
    case "already_delivered":
      return ko ? "딴짓 알림: 이미 표시됨" : "Drift alerts: Already shown";
    case "suppressed":
      return suppressionStatusLabel(result.reason, ko);
    case "deferred":
      return ko ? "딴짓 알림: 대기 중" : "Drift alerts: Deferred";
    case "error":
      return ko ? "딴짓 알림: 확인 실패" : "Drift alerts: Check failed";
    default:
      return assertNever(result);
  }
}

function spanishStatusLabel(enabled: boolean, result: DriftAlarmTrayResult): string {
  if (!enabled) return "Alertas de distracción: desactivadas";
  const prefix = "Alertas de distracción: ";
  switch (result.kind) {
    case "disabled": return `${prefix}desactivadas`;
    case "not_today": return `${prefix}en espera`;
    case "tracker_paused": return `${prefix}en pausa`;
    case "no_candidate": return `${prefix}activas`;
    case "snoozed": return `${prefix}pospuestas`;
    case "checking": return `${prefix}comprobando`;
    case "delivered": return `${prefix}enviadas`;
    case "already_delivered": return `${prefix}ya mostradas`;
    case "suppressed": return `${prefix}${spanishSuppressionReason(result.reason)}`;
    case "deferred": return `${prefix}en espera`;
    case "error": return `${prefix}error al comprobar`;
    default: return assertNever(result);
  }
}

function spanishSuppressionReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized === "quiet-hours") return "horario de silencio";
  if (normalized.startsWith("ai-unavailable:")) return "IA no disponible";
  if (normalized === "ai-timeout" || normalized === "ai-deadline") return "tiempo de IA agotado";
  if (normalized === "ai-low-confidence") return "baja confianza de IA";
  if (normalized === "ai-classified-focus") return "IA clasificó concentración";
  if (normalized === "ai-classified-neutral") return "IA clasificó neutral";
  return "suprimidas";
}

function spanishResultLabel(result: DriftAlarmTrayResult): string {
  switch (result.kind) {
    case "disabled": return "Alertas desactivadas";
    case "not_today": return "No se comprueba este día";
    case "tracker_paused": return "Registro en pausa";
    case "no_candidate": return "Sin distracciones aptas";
    case "snoozed": return "Pospuestas";
    case "checking": return "Comprobando distracción";
    case "delivered": return "Alerta enviada";
    case "already_delivered": return "Alerta ya mostrada";
    case "suppressed": return `Suprimidas: ${spanishSuppressionReason(result.reason)}`;
    case "deferred": return `Esperando a ${spanishSystemActivity(result.reason)}`;
    case "error": return "Error al comprobar";
    default: return assertNever(result);
  }
}

function spanishSystemActivity(reason: DriftAlarmDeferredReason): string {
  switch (reason) {
    case "mission_control": return "Mission Control";
    case "app_switcher": return "cambio de app";
    case "launchpad": return "Launchpad";
    case "spotlight": return "Spotlight";
    case "system_overlay": return "ventana del sistema";
    default: return assertNever(reason);
  }
}

function resultLabel(result: DriftAlarmTrayResult, ko: boolean): string {
  switch (result.kind) {
    case "disabled":
      return ko ? "알림 꺼짐" : "Alerts disabled";
    case "not_today":
      return ko ? "선택한 요일 확인 안 함" : "Not checking selected day";
    case "tracker_paused":
      return ko ? "트래커 일시 정지됨" : "Tracker paused";
    case "no_candidate":
      return ko ? "알림 대상 없음" : "No eligible drift";
    case "snoozed":
      return ko ? "다시 알림 중" : "Snoozed";
    case "checking":
      return ko ? "딴짓 후보 분석 중" : "Checking drift candidate";
    case "delivered":
      return ko ? "알림 전달됨" : "Alarm delivered";
    case "already_delivered":
      return ko ? "이미 알림 표시됨" : "Alarm already shown";
    case "suppressed":
      return ko
        ? `억제됨: ${suppressionReasonLabel(result.reason, ko)}`
        : `Suppressed: ${suppressionReasonLabel(result.reason, ko)}`;
    case "deferred":
      return ko
        ? `${systemTransientActivityLabel(result.reason)} 대기 중`
        : `Waiting for ${systemTransientActivityLabel(result.reason)}`;
    case "error":
      return ko ? "확인 실패" : "Check failed";
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

function suppressionReasonLabel(reason: string, ko: boolean = false): string {
  const normalized = reason.trim();
  if (normalized === "automatic-close-recovery") return ko ? "자동 닫기 복구 유예" : "Automatic close recovery";
  if (normalized === "quiet-hours") return ko ? "조용한 시간" : "Quiet hours";
  if (normalized === "ai-low-confidence") return ko ? "AI 신뢰도 낮음" : "AI low confidence";
  if (normalized === "ai-timeout") return ko ? "AI 시간 초과" : "AI gate timed out";
  if (normalized === "ai-deadline") return ko ? "AI 시간 초과" : "AI gate timed out";
  if (normalized === "ai-classified-focus") return ko ? "AI가 집중으로 분류" : "AI classified focus";
  if (normalized === "ai-classified-neutral") return ko ? "AI가 중립으로 분류" : "AI classified neutral";
  if (normalized.startsWith("ai-unavailable:")) return ko ? "AI 사용 불가" : "AI unavailable";
  return compactMenuLabel(normalized.replace(/[-_]+/g, " ")) ?? (ko ? "억제됨" : "suppressed");
}

function suppressionStatusLabel(reason: string, ko: boolean): string {
  const normalized = reason.trim();
  if (normalized === "quiet-hours") return ko ? "딴짓 알림: 조용한 시간" : "Drift alerts: Quiet hours";
  if (normalized.startsWith("ai-unavailable:")) return ko ? "딴짓 알림: AI 사용 불가" : "Drift alerts: AI unavailable";
  if (normalized === "ai-timeout") return ko ? "딴짓 알림: AI 시간 초과" : "Drift alerts: AI timed out";
  if (normalized === "ai-deadline") return ko ? "딴짓 알림: AI 시간 초과" : "Drift alerts: AI timed out";
  return ko ? "딴짓 알림: 억제됨" : "Drift alerts: Suppressed";
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
