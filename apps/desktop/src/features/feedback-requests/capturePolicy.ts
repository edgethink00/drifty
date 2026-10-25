import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { trackerClient } from "../../lib/api/trackerClient";
import { WORK_DAYS, clampMinute, type RecordingSchedulePayload } from "./recordingSchedule";

/**
 * What the user asked Drifty not to record (feedback 8 and 15, 2026-10-25):
 * confirmed private windows and the hours outside recording time. The choice
 * lives on this device; the tracker gets a copy because it records while the
 * window is closed.
 */
export type PrivateWindowPolicy = "skip" | "record";

export type RecordingHoursSettings = {
  readonly enabled: boolean;
  readonly days: readonly number[];
  readonly startMinute: number;
  readonly endMinute: number;
};

export type CapturePolicySettings = {
  readonly privateWindows: PrivateWindowPolicy;
  /** Record only on these days and hours (Settings › General). */
  readonly recordingHours: RecordingHoursSettings;
};

export const CAPTURE_POLICY_STORAGE_KEY = "drifty.capturePolicy.v1";

export const DEFAULT_CAPTURE_POLICY: CapturePolicySettings = {
  privateWindows: "skip",
  recordingHours: { enabled: false, days: WORK_DAYS, startMinute: 9 * 60, endMinute: 18 * 60 },
};

function normalizeDays(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return DEFAULT_CAPTURE_POLICY.recordingHours.days;
  return [...new Set(value.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7))].sort();
}

export function normalizeCapturePolicy(value: unknown): CapturePolicySettings {
  const input = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof CapturePolicySettings, unknown>>;
  const hours = (input.recordingHours && typeof input.recordingHours === "object" ? input.recordingHours : {}) as Partial<Record<keyof RecordingHoursSettings, unknown>>;
  return {
    privateWindows: input.privateWindows === "record" ? "record" : "skip",
    recordingHours: {
      enabled: hours.enabled === true,
      days: normalizeDays(hours.days),
      startMinute: typeof hours.startMinute === "number" ? clampMinute(hours.startMinute) : DEFAULT_CAPTURE_POLICY.recordingHours.startMinute,
      endMinute: typeof hours.endMinute === "number" ? clampMinute(hours.endMinute) : DEFAULT_CAPTURE_POLICY.recordingHours.endMinute,
    },
  };
}

const listeners = new Set<() => void>();
let current: CapturePolicySettings | null = null;

function read(): CapturePolicySettings {
  if (current) return current;
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(CAPTURE_POLICY_STORAGE_KEY);
    current = normalizeCapturePolicy(raw ? JSON.parse(raw) : null);
  } catch {
    current = DEFAULT_CAPTURE_POLICY;
  }
  return current;
}

export function updateCapturePolicy(patch: Partial<CapturePolicySettings>): void {
  current = normalizeCapturePolicy({ ...read(), ...patch });
  try {
    window.localStorage.setItem(CAPTURE_POLICY_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // The tracker copy still applies for this session.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCapturePolicy(): CapturePolicySettings {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_CAPTURE_POLICY);
}

export function resetCapturePolicyForTests(): void {
  current = null;
}

/** The schedule the tracker enforces, or null to record at every hour. */
export function recordingSchedulePayload(settings: CapturePolicySettings): RecordingSchedulePayload | null {
  const hours = settings.recordingHours;
  if (!hours.enabled || hours.days.length === 0 || hours.startMinute === hours.endMinute) return null;
  return { enabled: true, mode: "record-within", days: hours.days, startMinute: hours.startMinute, endMinute: hours.endMinute };
}

export type CapturePolicyPayload = {
  readonly privateWindows: PrivateWindowPolicy;
  readonly recordingSchedule: RecordingSchedulePayload | null;
};

export function capturePolicyPayload(settings: CapturePolicySettings): CapturePolicyPayload {
  return { privateWindows: settings.privateWindows, recordingSchedule: recordingSchedulePayload(settings) };
}

/** A failed send is retried after this long, so a choice never waits for the next launch. */
export const CAPTURE_POLICY_RETRY_MS = 15_000;

/** Sends the policy to the tracker whenever it changes, and once per launch. */
export function useCapturePolicySync(): void {
  const settings = useCapturePolicy();
  const sentRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const serialized = JSON.stringify(capturePolicyPayload(settings));
  useEffect(() => {
    if (sentRef.current === serialized) return;
    sentRef.current = serialized;
    let retry: number | undefined;
    void trackerClient.setCapturePolicy?.(JSON.parse(serialized) as CapturePolicyPayload).catch(() => {
      sentRef.current = null;
      retry = window.setTimeout(() => setAttempt((value) => value + 1), CAPTURE_POLICY_RETRY_MS);
    });
    return () => window.clearTimeout(retry);
  }, [attempt, serialized]);
}
