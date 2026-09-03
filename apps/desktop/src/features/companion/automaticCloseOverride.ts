import { isTauriRuntime } from "./watcherBridge";
import type { DisplayLanguage } from "../localization/languagePreference";

export const AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY = "drifty.notifications.automaticCloseOverride.v1";

export type AutomaticCloseOverrideKind = "15" | "60" | "today" | "forever";

export type AutomaticCloseOverride = {
  readonly enabled: boolean;
  readonly kind: AutomaticCloseOverrideKind;
  readonly startedAtMs: number;
  readonly endsAtMs: number | null;
};

const MINUTE_MS = 60_000;

function localMidnightAfter(nowMs: number): number {
  const midnight = new Date(nowMs);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

function isAutomaticCloseOverrideKind(value: unknown): value is AutomaticCloseOverrideKind {
  return value === "15" || value === "60" || value === "today" || value === "forever";
}

export function isAutomaticCloseOverride(value: unknown): value is AutomaticCloseOverride {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.enabled !== "boolean"
    || !isAutomaticCloseOverrideKind(record.kind)
    || typeof record.startedAtMs !== "number"
    || !Number.isFinite(record.startedAtMs)
  ) return false;
  if (record.kind === "forever") return record.endsAtMs === null;
  return typeof record.endsAtMs === "number"
    && Number.isFinite(record.endsAtMs)
    && record.endsAtMs > record.startedAtMs;
}

export function resolveInitialAutomaticCloseOverride(nowMs = Date.now()): AutomaticCloseOverride | null {
  try {
    const raw = window.localStorage.getItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      isAutomaticCloseOverride(parsed)
      && !automaticCloseOverrideIsExpired(parsed, nowMs)
    ) return parsed;
    window.localStorage.removeItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY);
  } catch {
    // A corrupt or unavailable store must not override the user's saved setting.
  }
  return null;
}

export function persistAutomaticCloseOverride(override: AutomaticCloseOverride | null): AutomaticCloseOverride | null {
  try {
    if (override) {
      window.localStorage.setItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY, JSON.stringify(override));
    } else {
      window.localStorage.removeItem(AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY);
    }
  } catch {
    // The in-memory override remains usable for this session if storage is unavailable.
  }
  return override;
}

export function buildAutomaticCloseOverride(
  enabled: boolean,
  kind: AutomaticCloseOverrideKind,
  nowMs = Date.now(),
): AutomaticCloseOverride {
  const endsAtMs = kind === "forever"
    ? null
    : kind === "today"
      ? localMidnightAfter(nowMs)
      : nowMs + Number(kind) * MINUTE_MS;
  return { enabled, kind, startedAtMs: nowMs, endsAtMs };
}

export function extendAutomaticCloseOverride(
  current: AutomaticCloseOverride,
  extension: "60" | "today",
  nowMs = Date.now(),
): AutomaticCloseOverride {
  const endsAtMs = extension === "today"
    ? Math.max(current.endsAtMs ?? nowMs, localMidnightAfter(nowMs))
    : Math.max(current.endsAtMs ?? nowMs, nowMs) + 60 * MINUTE_MS;
  return {
    ...current,
    kind: extension,
    endsAtMs,
  };
}

export function automaticCloseOverrideIsExpired(
  override: AutomaticCloseOverride,
  nowMs = Date.now(),
): boolean {
  return override.endsAtMs !== null && override.endsAtMs <= nowMs;
}

export function resolveEffectiveAutomaticCloseEnabled(
  savedEnabled: boolean,
  override: AutomaticCloseOverride | null,
  nowMs = Date.now(),
): boolean {
  if (!override || automaticCloseOverrideIsExpired(override, nowMs)) return savedEnabled;
  return override.enabled;
}

function notificationCopy(
  override: AutomaticCloseOverride,
  restoredEnabled: boolean,
  language: DisplayLanguage,
): { title: string; body: string } {
  if (language === "ko") {
    const period = override.kind === "15"
      ? "15분"
      : override.kind === "60"
        ? "1시간"
        : "자정까지 설정한";
    return {
      title: restoredEnabled ? "자동 닫기가 다시 켜졌어요" : "자동 닫기가 다시 꺼졌어요",
      body: override.enabled
        ? `${period} 임시 켜기가 끝나 저장된 설정으로 돌아왔습니다.`
        : `${period} 일시 중지가 끝나 저장된 설정으로 돌아왔습니다.`,
    };
  }
  const period = override.kind === "15"
    ? "15-minute"
    : override.kind === "60"
      ? "1-hour"
      : "until-midnight";
  return {
    title: restoredEnabled ? "Auto-close is back on" : "Auto-close is back off",
    body: `Your ${period} ${override.enabled ? "temporary activation" : "pause"} ended. Drifty restored your saved setting.`,
  };
}

export async function sendAutomaticCloseOverrideExpiredNotification(
  override: AutomaticCloseOverride,
  restoredEnabled: boolean,
  language: DisplayLanguage,
): Promise<boolean> {
  if (!isTauriRuntime() || override.kind === "forever") return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (getCurrentWindow().label !== "main") return false;
    const {
      isPermissionGranted,
      requestPermission,
      sendNotification,
    } = await import("@tauri-apps/plugin-notification");
    let hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      hasPermission = await requestPermission() === "granted";
    }
    if (!hasPermission) return false;
    sendNotification(notificationCopy(override, restoredEnabled, language));
    return true;
  } catch {
    // Restoring the saved setting must not depend on notification availability.
    return false;
  }
}
