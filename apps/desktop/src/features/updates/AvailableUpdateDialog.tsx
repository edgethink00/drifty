import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UpdatePolicy } from "./updatePolicy";

type AvailableUpdateDialogUpdate = {
  body?: string | null;
  date?: string | null;
  version: string;
};

export type AvailableUpdateDialogProps = {
  autoInstallFutureUpdates: boolean;
  policy: UpdatePolicy | null;
  update: AvailableUpdateDialogUpdate;
  updaterChecking: boolean;
  updaterError: string | null;
  updaterInstalling: boolean;
  onAutoInstallFutureUpdatesChange: (enabled: boolean) => void;
  onDismiss: () => void;
  onInstall: () => void;
};

let activeUpdateWindowVersion: string | null = null;

type NativeUpdatePromptResult = {
  readonly autoInstallFutureUpdates: boolean;
  readonly confirmed: boolean;
};

function showNativeUpdatePrompt(
  version: string,
  urgent: boolean,
  autoInstallFutureUpdates: boolean,
) {
  return invoke<NativeUpdatePromptResult>("update_prompt_show_native", {
    autoInstallFutureUpdates,
    version,
    urgent,
  });
}

export function AvailableUpdateDialog({
  autoInstallFutureUpdates,
  policy,
  update,
  updaterChecking,
  updaterError,
  updaterInstalling,
  onAutoInstallFutureUpdatesChange,
  onDismiss,
  onInstall,
}: AvailableUpdateDialogProps) {
  const urgent = policy?.urgency === "urgent" || updaterError !== null;

  useEffect(() => {
    if (updaterChecking || updaterInstalling) return;
    if (activeUpdateWindowVersion === update.version) return;

    activeUpdateWindowVersion = update.version;
    let disposed = false;

    void showNativeUpdatePrompt(update.version, urgent, autoInstallFutureUpdates).then((result) => {
      if (disposed) return;
      activeUpdateWindowVersion = null;
      onAutoInstallFutureUpdatesChange(result.autoInstallFutureUpdates);
      if (result.confirmed) {
        onInstall();
        onDismiss();
        return;
      }
      onDismiss();
    }).catch((error: unknown) => {
      activeUpdateWindowVersion = null;
      if (disposed) return;
      if (error instanceof Error) {
        console.warn(`Failed to show update window: ${error.message}`);
      } else {
        console.warn("Failed to show update window.");
      }
      onDismiss();
    });

    return () => {
      disposed = true;
      activeUpdateWindowVersion = null;
    };
  }, [
    autoInstallFutureUpdates,
    onAutoInstallFutureUpdatesChange,
    onDismiss,
    onInstall,
    update.version,
    urgent,
    updaterChecking,
    updaterInstalling,
  ]);

  return null;
}
