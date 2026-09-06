import { useEffect, useState } from "react";
import {
  AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY,
  resolveInitialAutomaticCloseOverride,
} from "../companion/automaticCloseOverride";
import {
  getNativePetQuickControlsState,
  listenToNativePetQuickControlsState,
  type PetQuickControlsStatePayload,
} from "./petModeBridge";

/** Share the existing pause deadline; never start a second sleep duration. */
function readSleepUntil(): number | null {
  const override = resolveInitialAutomaticCloseOverride();
  return override && !override.enabled && override.kind !== "forever"
    ? override.endsAtMs
    : null;
}

export function usePetTimedPauseSleep(): number | null {
  const [until, setUntil] = useState(readSleepUntil);
  useEffect(() => {
    let timer: number | undefined;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let nativeState: PetQuickControlsStatePayload | null = null;
    let receivedEvent = false;
    const refresh = () => {
      if (disposed) return;
      window.clearTimeout(timer);
      const override = nativeState?.automaticCloseOverride;
      // Native session state is authoritative after the first delivery.
      // Reading stale disk state again would undo a pause whose write failed.
      const next = nativeState === null ? readSleepUntil()
        : override && !override.enabled && override.kind !== "forever"
          && override.endsAtMs !== null && override.endsAtMs > Date.now()
          ? override.endsAtMs : null;
      setUntil(next);
      // Wall-clock corrections can leave the same deadline still pending
      // when a timer fires. Rearm even when React's state value did not change.
      timer = next === null ? undefined : window.setTimeout(
        refresh,
        Math.min(2_147_483_647, Math.max(0, next - Date.now())),
      );
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === AUTOMATIC_CLOSE_OVERRIDE_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    void listenToNativePetQuickControlsState((state) => {
      if (disposed) return;
      receivedEvent = true;
      nativeState = state;
      refresh();
    }).then(async (stop) => {
      if (disposed) { stop?.(); return; }
      unlisten = stop;
      const state = await getNativePetQuickControlsState();
      if (disposed || receivedEvent || state === null) return;
      nativeState = state;
      refresh();
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearTimeout(timer);
    };
  }, []);
  return until;
}
