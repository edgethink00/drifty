import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { classifyPetModeNativeSyncError } from "./petModeNativeSyncDiagnostics";

export const PET_MODE_STARTUP_EVENT = "pet-mode-native-startup-state";
export const PET_MODE_STARTUP_READY_TIMEOUT_MS = 20_000;
/**
 * Backoff before each startup retry after the first request. A busy Windows
 * owner thread can fail one native transaction (2s timeout) and then the
 * immediate retry as well; spacing the attempts gives it time to drain. The
 * last entry is the final reveal attempt, after which recovery stops.
 */
export const PET_MODE_STARTUP_RETRY_DELAYS_MS = [1_000, 3_000, 8_000] as const;
export const PET_MODE_STARTUP_MAX_ATTEMPTS = PET_MODE_STARTUP_RETRY_DELAYS_MS.length + 1;
/** An explicit Show/On request keeps its single immediate retry. */
export const PET_MODE_REVEAL_MAX_ATTEMPTS = 2;
export type PetModeReadinessStatus = "waiting" | "ready" | "failed" | "timed_out" | "cancelled" | "unavailable";
type StartupSnapshot = { readonly phase: "pending" | "ready" | "failed"; readonly revision: number };

function isStartupSnapshot(value: unknown): value is StartupSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<StartupSnapshot>;
  return (snapshot.phase === "pending" || snapshot.phase === "ready" || snapshot.phase === "failed")
    && typeof snapshot.revision === "number" && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0;
}

/** One-shot recovery for the observed startup error, outside the enable queue. */
export function waitForPetModeStartupRetryReadiness(
  error: unknown,
  initialStartup: boolean,
  signal: AbortSignal,
  onStatus: (status: PetModeReadinessStatus) => void,
): Promise<void> {
  if (!initialStartup || classifyPetModeNativeSyncError(error) !== "window_unavailable") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unlisten: UnlistenFn | undefined;
    const finish = (status: Exclude<PetModeReadinessStatus, "waiting">) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
      unlisten?.();
      onStatus(status);
      if (status === "ready") resolve();
      else reject(new Error(`Pet Mode startup readiness ${status}`));
    };
    const accept = (snapshot: StartupSnapshot) => {
      if (snapshot.phase !== "pending") finish(snapshot.phase);
    };
    const abort = () => finish("cancelled");
    // The deadline also bounds a hung listen/snapshot IPC, not just events.
    const deadline = setTimeout(() => finish("timed_out"), PET_MODE_STARTUP_READY_TIMEOUT_MS);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    onStatus("waiting");
    void listen<unknown>(PET_MODE_STARTUP_EVENT, ({ payload }) => {
      if (isStartupSnapshot(payload)) accept(payload);
    }).then((removeListener) => {
      if (settled) {
        // Subscription can finish after cancellation or an early ready event.
        removeListener();
        return;
      }
      unlisten = removeListener;
      // Subscribe first, snapshot second: no lost ready notification race.
      return invoke<unknown>("pet_mode_get_startup_state").then((snapshot) => {
        if (isStartupSnapshot(snapshot)) accept(snapshot);
        else finish("unavailable");
      });
    }).catch(() => finish("unavailable"));
  });
}

function waitForRetryDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Pet Mode sync retry cancelled"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Pet Mode sync retry cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Decides whether a rejected enable request gets another bounded attempt and
 * waits until it may be queued. Resolves false once the attempt budget is
 * spent; rejects when an Off, size change, hide or unmount cancels the wait.
 * Waiting never occupies the serialized enable queue.
 */
export async function waitForPetModeSyncRetry(
  error: unknown,
  initialStartup: boolean,
  retriesSoFar: number,
  signal: AbortSignal,
  onStatus: (status: PetModeReadinessStatus) => void,
): Promise<boolean> {
  if (!initialStartup) return retriesSoFar < PET_MODE_REVEAL_MAX_ATTEMPTS - 1;
  const delayMs = PET_MODE_STARTUP_RETRY_DELAYS_MS[retriesSoFar];
  if (delayMs === undefined) return false;
  if (retriesSoFar === 0 && classifyPetModeNativeSyncError(error) === "window_unavailable") {
    // Assigned from the callback; keep the full union for the checks below.
    let readiness = "waiting" as PetModeReadinessStatus;
    try {
      await waitForPetModeStartupRetryReadiness(error, true, signal, (status) => {
        readiness = status;
        onStatus(status);
      });
      // The native window now exists; retry right away.
      return true;
    } catch (readinessError) {
      // Setup failure means no pet window will exist in this process.
      if (readiness === "cancelled" || readiness === "failed") throw readinessError;
      // A missed or hung readiness signal still gets the backed-off attempts.
    }
  }
  await waitForRetryDelay(delayMs, signal);
  return true;
}
