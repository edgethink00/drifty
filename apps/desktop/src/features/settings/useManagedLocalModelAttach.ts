import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";

import { cleanupTauriEventListener, type TauriEventUnlisten } from "../../lib/tauriEventCleanup";
import {
  getManagedLocalAiStatus,
  listManagedLocalAiModels,
  parseManagedLocalAiStatus,
  type ManagedLocalAiStatus,
} from "./managedLocalAiClient";
import { normalizeManagedLocalModelId, type LocalAiSetupState } from "./localAiSetup";
import { isReadyManagedLocalAiStatus, sendManagedLocalAiReadyNotification } from "./useManagedLocalAiSetup";

const MANAGED_LOCAL_AI_STATUS_EVENT = "managed-ai-status";
const ATTACH_POLL_MS = 2_000;

/**
 * Finishes a managed-model setup that onboarding left in flight. Onboarding lets
 * the user move on while the model still downloads; once the modal closes, nothing
 * inside it survives to write the ready model into the AI setup. This app-level
 * watcher fills the managedLocal* fields when the download lands (making local
 * classification available to the first-day gate and the dashboard) and sends the
 * ready notification for downloads it watched finish.
 */
export function useManagedLocalModelAttach(
  enabled: boolean,
  onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>,
): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sawDownloadInFlight = false;
    let pollId: number | null = null;

    const stopPolling = () => {
      if (pollId !== null) {
        window.clearInterval(pollId);
        pollId = null;
      }
    };

    const apply = (status: ManagedLocalAiStatus) => {
      if (cancelled) return;
      if (status.state === "installing" || status.state === "starting") {
        sawDownloadInFlight = true;
        ensurePolling();
        return;
      }
      if (!isReadyManagedLocalAiStatus(status)) {
        // Nothing installing and nothing ready — stop burning polls; the push
        // event listener still catches a download started elsewhere.
        stopPolling();
        return;
      }
      stopPolling();
      onLocalAiSetupChange((current) => {
        const managedLocalModelId = normalizeManagedLocalModelId(status.selectedModelId);
        if (current.managedLocalModelId !== managedLocalModelId) return current;
        if (
          current.managedLocalModelId === managedLocalModelId
          && current.managedLocalBaseUrl === status.baseUrl
          && current.managedLocalModel === status.model
        ) {
          return current;
        }
        return {
          ...current,
          managedLocalModelId,
          managedLocalBaseUrl: status.baseUrl,
          managedLocalModel: status.model,
        };
      });
      if (sawDownloadInFlight) {
        sawDownloadInFlight = false;
        void notifyReady(status.selectedModelId);
      }
    };

    const pollOnce = () => {
      void getManagedLocalAiStatus().then(apply).catch(() => undefined);
    };

    function ensurePolling() {
      if (pollId !== null) return;
      pollId = window.setInterval(pollOnce, ATTACH_POLL_MS);
    }

    pollOnce();

    let unlisten: TauriEventUnlisten | null = null;
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      void listen<unknown>(MANAGED_LOCAL_AI_STATUS_EVENT, ({ payload }) => {
        apply(parseManagedLocalAiStatus(payload));
      }).then((nextUnlisten) => {
        if (cancelled) {
          cleanupTauriEventListener(nextUnlisten);
          return;
        }
        unlisten = nextUnlisten;
      }).catch(() => undefined);
    }

    return () => {
      cancelled = true;
      stopPolling();
      cleanupTauriEventListener(unlisten);
    };
  }, [enabled, onLocalAiSetupChange]);
}

async function notifyReady(modelId: string): Promise<void> {
  let modelLabel = "Local AI model";
  try {
    const catalog = await listManagedLocalAiModels();
    modelLabel = catalog.find((model) => model.id === modelId)?.label ?? modelLabel;
  } catch {
    // best-effort label lookup
  }
  await sendManagedLocalAiReadyNotification(modelLabel);
}
