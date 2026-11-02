import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { cleanupTauriEventListener, type TauriEventUnlisten } from "../../lib/tauriEventCleanup";
import {
  getManagedLocalAiStatus,
  parseManagedLocalAiStatus,
  type ManagedLocalAiStatus,
} from "./managedLocalAiClient";

const MANAGED_LOCAL_AI_STATUS_EVENT = "managed-ai-status";
const TRANSIENT_STATUS_POLL_MS = 500;
const RUNNING_STATUS_POLL_MS = 5_000;

/**
 * App-level view of the managed-local runtime.
 *
 * Settings and onboarding own their action state, but both can unmount while a
 * Rust-side model download keeps running. This observer lets persistent shell
 * surfaces show that transient progress without coupling them to either flow.
 */
export function useManagedLocalAiStatusObserver(enabled: boolean): ManagedLocalAiStatus | null {
  const [status, setStatus] = useState<ManagedLocalAiStatus | null>(null);
  const observerRunRef = useRef(0);
  const statusRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const observerRun = observerRunRef.current;
    const statusRequest = statusRequestRef.current + 1;
    statusRequestRef.current = statusRequest;
    try {
      const nextStatus = await getManagedLocalAiStatus();
      if (
        observerRun === observerRunRef.current
        && statusRequest === statusRequestRef.current
      ) {
        setStatus(nextStatus);
      }
    } catch {
      // The sidebar status is best-effort. Settings remains the recovery surface.
    }
  }, []);

  useEffect(() => {
    const observerRun = observerRunRef.current + 1;
    observerRunRef.current = observerRun;
    statusRequestRef.current += 1;
    if (!enabled || !isTauriRuntime()) {
      setStatus(null);
      return;
    }

    let cancelled = false;
    let unlisten: TauriEventUnlisten | null = null;
    void refresh();
    void listen<unknown>(MANAGED_LOCAL_AI_STATUS_EVENT, ({ payload }) => {
      if (cancelled || observerRun !== observerRunRef.current) return;
      // A push event is newer than every status request already in flight.
      // Invalidating those requests prevents a late poll from restoring an
      // older `installing` state after Rust has emitted `installed`.
      statusRequestRef.current += 1;
      setStatus(parseManagedLocalAiStatus(payload));
    }).then((nextUnlisten) => {
      if (cancelled) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      if (observerRunRef.current === observerRun) observerRunRef.current += 1;
      statusRequestRef.current += 1;
      cleanupTauriEventListener(unlisten);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !status || !isObservedRuntimeState(status)) return;
    const pollMs = status.state === "installing" || status.state === "starting" ? TRANSIENT_STATUS_POLL_MS : RUNNING_STATUS_POLL_MS;
    const intervalId = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(intervalId);
  }, [enabled, refresh, status?.state, status?.errorKind]);

  return status;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isObservedRuntimeState(status: ManagedLocalAiStatus): boolean {
  // A failed health observation can recover on the same native child. Keep
  // reading its status so the shell does not retain "Start failed" after a
  // successful reconnect or classification; this never starts the runtime.
  return status.state === "installing" || status.state === "starting" || status.state === "running"
    || (status.state === "error" && status.errorKind === "runtime_failed");
}
