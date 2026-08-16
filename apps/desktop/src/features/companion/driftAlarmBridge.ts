import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DriftAlarmAction, DriftAlarmBreakReturnDetails, DriftAlarmEvent, DriftAlarmFocusTarget } from "./DriftAlarm";
import { isTauriRuntime } from "./watcherBridge";

type UnlistenFn = () => void;

export type ExtremeNudgeTarget = {
  readonly appName: string;
  readonly bundleId: string | null;
  readonly browserName: string | null;
  readonly siteDomain: string | null;
  readonly siteUrl: string | null;
  readonly forceChromiumAxTabClose: boolean;
};

export type ExtremeNudgeApplyResult = {
  readonly applied: boolean;
  readonly diagnostic: string | null;
};

type DriftAlarmActionEvent = {
  action: unknown;
};

export async function showNativeDriftAlarm(event: DriftAlarmEvent): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await invoke("drift_alarm_show", { payload: event });
  return true;
}

export async function hideNativeDriftAlarm(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("drift_alarm_hide");
}

export async function dismissNativeDriftAlarm(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("drift_alarm_dismiss");
}

export async function triggerNativeDriftAlarmAction(action: DriftAlarmAction): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("drift_alarm_action", { action });
}

export async function applyNativeExtremeNudge(target: ExtremeNudgeTarget): Promise<ExtremeNudgeApplyResult> {
  if (!isTauriRuntime()) {
    return {
      applied: false,
      diagnostic: "not_tauri_runtime",
    };
  }
  const outcome = await invoke<unknown>("extreme_nudge_apply", { target });
  return {
    applied: true,
    diagnostic: nativeExtremeNudgeDiagnostic(outcome),
  };
}

function nativeExtremeNudgeDiagnostic(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const diagnostic = Reflect.get(value, "diagnostic");
  if (typeof diagnostic !== "string") return null;
  return normalizeExtremeNudgeDiagnostic(diagnostic);
}

function normalizeExtremeNudgeDiagnostic(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export async function getNativeDriftAlarmCurrent(): Promise<DriftAlarmEvent | null> {
  if (!isTauriRuntime()) return null;
  const payload = await invoke<unknown>("drift_alarm_current");
  return isDriftAlarmEvent(payload) ? payload : null;
}

export async function listenToNativeDriftAlarmShow(onShow: (event: DriftAlarmEvent) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<DriftAlarmEvent>("drift-alarm-show", ({ payload }) => {
    if (isDriftAlarmEvent(payload)) onShow(payload);
  });
}

export async function listenToNativeDriftAlarmAction(onAction: (action: DriftAlarmAction) => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<DriftAlarmActionEvent>("drift-alarm-action", ({ payload }) => {
    if (isDriftAlarmActionEvent(payload)) onAction(payload.action);
  });
}

export async function listenToNativeDriftAlarmDismissed(onDismissed: () => void): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen("drift-alarm-dismissed", onDismissed);
}

export function isDriftAlarmAction(value: unknown): value is DriftAlarmAction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "manual_correction" || candidate.type === "settings") return true;
  if (candidate.type === "return_to_focus") return typeof candidate.targetId === "string" && candidate.targetId.trim().length > 0;
  if (candidate.type === "start_break") return typeof candidate.minutes === "number" && Number.isInteger(candidate.minutes) && candidate.minutes > 0 && candidate.minutes <= 60;
  return false;
}

function isDriftAlarmActionEvent(value: unknown): value is { action: DriftAlarmAction } {
  if (!value || typeof value !== "object") return false;
  return isDriftAlarmAction((value as Record<string, unknown>).action);
}

export function isDriftAlarmEvent(value: unknown): value is DriftAlarmEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.contextLabel === "string"
    && typeof candidate.driftDurationLabel === "string"
    && typeof candidate.driftDurationSeconds === "number"
    && typeof candidate.preservedFocusStrikeLabel === "string"
    && typeof candidate.preservedFocusStrikeSeconds === "number"
    && typeof candidate.generatedAt === "string"
    && isBreakOptions(candidate.breakOptions)
    && isFocusTargets(candidate.focusTargets)
    && isNullableString(candidate.sourceSiteDomain)
    && typeof candidate.sourceAppName === "string"
    && isNullableString(candidate.sourceIconSrc)
    && (candidate.copy === undefined || isDriftAlarmRenderedCopy(candidate.copy))
    && (candidate.sourceSegmentId === undefined || isNullableString(candidate.sourceSegmentId))
    && (candidate.decisionClassification === undefined
      || candidate.decisionClassification === null
      || isDecisionClassification(candidate.decisionClassification))
    && isDriftAlarmModePayload(candidate)
  );
}

function isDecisionClassification(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.category === "string"
    && typeof candidate.productivity === "string"
    && typeof candidate.confidence === "number"
    && Number.isFinite(candidate.confidence)
    && candidate.confidence >= 0
    && candidate.confidence <= 1
    && typeof candidate.source === "string";
}

function isDriftAlarmRenderedCopy(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === "string"
    && typeof candidate.summary === "string"
    && isStringArray(candidate.contextPills)
    && typeof candidate.returnToFocusLabel === "string"
    && typeof candidate.breakChoiceLabel === "string"
    && typeof candidate.noFocusTargetLabel === "string"
    && typeof candidate.backToDashboardLabel === "string"
    && typeof candidate.manualCorrectionLabel === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDriftAlarmModePayload(candidate: Record<string, unknown>): boolean {
  if (candidate.mode === "drift") return candidate.breakReturn === null;
  if (candidate.mode === "break_return") return isBreakReturnDetails(candidate.breakReturn);
  return false;
}

function isBreakReturnDetails(value: unknown): value is DriftAlarmBreakReturnDetails {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.breakDurationMinutes === "number"
    && Number.isInteger(candidate.breakDurationMinutes)
    && candidate.breakDurationMinutes > 0
    && candidate.breakDurationMinutes <= 60
    && typeof candidate.breakDurationLabel === "string"
    && candidate.breakDurationLabel.trim().length > 0
    && typeof candidate.pausedFromLabel === "string"
    && candidate.pausedFromLabel.trim().length > 0
    && typeof candidate.nextFocusLabel === "string"
    && candidate.nextFocusLabel.trim().length > 0
  );
}

function isBreakOptions(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((minutes) => typeof minutes === "number" && Number.isInteger(minutes) && minutes > 0 && minutes <= 60);
}

function isFocusTargets(value: unknown): value is DriftAlarmFocusTarget[] {
  return Array.isArray(value) && value.every(isFocusTarget);
}

function isFocusTarget(value: unknown): value is DriftAlarmFocusTarget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.targetId === "string"
    && candidate.targetId.trim().length > 0
    && typeof candidate.label === "string"
    && candidate.label.trim().length > 0
    && typeof candidate.detail === "string"
    && typeof candidate.appName === "string"
    && isNullableString(candidate.bundleId)
    && isOptionalNullableString(candidate.browserName)
    && isNullableString(candidate.siteDomain)
    && isNullableString(candidate.siteTitle)
    && isOptionalNullableString(candidate.siteUrl)
    && isNullableString(candidate.iconSrc)
  );
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
