import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { classifyPetModeNativeSyncError } from "./petModeNativeSyncDiagnostics";

export const PET_MODE_STARTUP_EVENT = "pet-mode-native-startup-state";
export const PET_MODE_STARTUP_READY_TIMEOUT_MS = 20_000;
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
