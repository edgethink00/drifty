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

type NativeUpdatePromptResult = {
  readonly autoInstallFutureUpdates: boolean;
  readonly confirmed: boolean;
};

type ActiveUpdateWindow = {
  readonly prompt: Promise<NativeUpdatePromptResult>;
  readonly version: string;
};

let activeUpdateWindow: ActiveUpdateWindow | null = null;

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

function getNativeUpdatePrompt(
  version: string,
  urgent: boolean,
  autoInstallFutureUpdates: boolean,
) {
  if (activeUpdateWindow?.version === version) return activeUpdateWindow.prompt;

  const prompt = showNativeUpdatePrompt(version, urgent, autoInstallFutureUpdates).finally(() => {
    if (activeUpdateWindow?.prompt === prompt) activeUpdateWindow = null;
  });
  activeUpdateWindow = { prompt, version };
  return prompt;
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

    let subscribed = true;

    void getNativeUpdatePrompt(update.version, urgent, autoInstallFutureUpdates).then((result) => {
      if (!subscribed) return;
      onAutoInstallFutureUpdatesChange(result.autoInstallFutureUpdates);
      if (result.confirmed) {
        onInstall();
        onDismiss();
        return;
      }
      onDismiss();
    }).catch((error: unknown) => {
      if (!subscribed) return;
      if (error instanceof Error) {
        console.warn(`Failed to show update window: ${error.message}`);
      } else {
        console.warn("Failed to show update window.");
      }
      onDismiss();
    });

    return () => {
      subscribed = false;
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
