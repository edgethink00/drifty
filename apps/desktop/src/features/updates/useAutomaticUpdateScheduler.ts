import { useEffect, useRef } from "react";

export const AUTO_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const AUTO_UPDATE_CHECK_RETRY_MS = 60 * 60 * 1000;
export const AUTO_UPDATE_CHECK_BUSY_RETRY_MS = 15 * 60 * 1000;
export const AUTO_UPDATE_CHECK_STARTUP_DELAY_MS = 2500;
export const UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY = "drifty.updates.nextAutomaticCheckAt.v1";

type ScheduledUpdateCheckResult = {
  readonly kind: "available" | "none" | "error";
};

type UseAutomaticUpdateSchedulerOptions = {
  readonly enabled: boolean;
  readonly checkForUpdates: () => Promise<ScheduledUpdateCheckResult | void>;
};

export function parseNextAutomaticCheckAt(savedValue: string | null): number | null {
  if (!savedValue) return null;
  const parsed = Number(savedValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function readNextAutomaticCheckAt(): number | null {
  if (typeof window === "undefined") return null;
  return parseNextAutomaticCheckAt(window.localStorage.getItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY));
}

export function persistNextAutomaticCheckAt(nextCheckAtMs: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UPDATE_NEXT_AUTOMATIC_CHECK_STORAGE_KEY, String(nextCheckAtMs));
}

export function nextAutomaticCheckDelayMs(input: {
  readonly nextCheckAtMs: number | null;
  readonly nowMs: number;
  readonly startupNotBeforeMs: number;
}): number {
  const scheduledAtMs = input.nextCheckAtMs ?? input.nowMs;
  return Math.max(0, Math.max(scheduledAtMs, input.startupNotBeforeMs) - input.nowMs);
}

export function nextAutomaticCheckAtAfterResult(
  result: ScheduledUpdateCheckResult | void,
  nowMs: number,
): number {
  if (!result) return nowMs + AUTO_UPDATE_CHECK_BUSY_RETRY_MS;
  return nowMs + (result.kind === "error" ? AUTO_UPDATE_CHECK_RETRY_MS : AUTO_UPDATE_CHECK_INTERVAL_MS);
}

export function useAutomaticUpdateScheduler({
  enabled,
  checkForUpdates,
}: UseAutomaticUpdateSchedulerOptions): void {
  const checkForUpdatesRef = useRef(checkForUpdates);
  checkForUpdatesRef.current = checkForUpdates;

  useEffect(() => {
    if (!enabled) return undefined;

    let disposed = false;
    let checkInFlight = false;
    let timeoutId: number | null = null;
    const startupNotBeforeMs = Date.now() + AUTO_UPDATE_CHECK_STARTUP_DELAY_MS;

    const clearScheduledCheck = () => {
      if (timeoutId === null) return;
      window.clearTimeout(timeoutId);
      timeoutId = null;
    };

    const scheduleNextCheck = () => {
      if (disposed || checkInFlight) return;
      clearScheduledCheck();
      const nowMs = Date.now();
      const delayMs = nextAutomaticCheckDelayMs({
        nextCheckAtMs: readNextAutomaticCheckAt(),
        nowMs,
        startupNotBeforeMs,
      });
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        void runScheduledCheck();
      }, delayMs);
    };

    const runScheduledCheck = async () => {
      if (disposed || checkInFlight) return;
      const nowMs = Date.now();
      if (nowMs < startupNotBeforeMs) {
        scheduleNextCheck();
        return;
      }
      const nextCheckAtMs = readNextAutomaticCheckAt();
      if (nextCheckAtMs !== null && nowMs < nextCheckAtMs) {
        scheduleNextCheck();
        return;
      }

      checkInFlight = true;
      let result: ScheduledUpdateCheckResult | void;
      try {
        result = await checkForUpdatesRef.current();
      } catch {
        result = { kind: "error" };
      } finally {
        checkInFlight = false;
      }
      if (disposed) return;
      persistNextAutomaticCheckAt(nextAutomaticCheckAtAfterResult(result, Date.now()));
      scheduleNextCheck();
    };

    const reconsiderSchedule = () => {
      if (disposed || checkInFlight) return;
      scheduleNextCheck();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reconsiderSchedule();
    };

    window.addEventListener("focus", reconsiderSchedule);
    window.addEventListener("online", reconsiderSchedule);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleNextCheck();

    return () => {
      disposed = true;
      clearScheduledCheck();
      window.removeEventListener("focus", reconsiderSchedule);
      window.removeEventListener("online", reconsiderSchedule);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled]);
}
