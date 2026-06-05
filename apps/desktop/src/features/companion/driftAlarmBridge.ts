import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DriftAlarmAction, DriftAlarmEvent, DriftAlarmFocusTarget } from "./DriftAlarm";
import { isTauriRuntime } from "./watcherBridge";

type UnlistenFn = () => void;

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

function isDriftAlarmEvent(value: unknown): value is DriftAlarmEvent {
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
    && isNullableString(candidate.siteDomain)
    && isNullableString(candidate.siteTitle)
    && isNullableString(candidate.iconSrc)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
