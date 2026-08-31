import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UpdatePolicy } from "./updatePolicy";

type AvailableUpdateDialogUpdate = {
  body?: string | null;
  date?: string | null;
  version: string;
};

export type AvailableUpdateDialogProps = {
  backgroundUpdatesEnabled: boolean;
  policy: UpdatePolicy | null;
  update: AvailableUpdateDialogUpdate;
  updaterChecking: boolean;
  updaterError: string | null;
  updaterInstalling: boolean;
  onBackgroundUpdatesEnabledChange: (enabled: boolean) => void;
  onDismiss: () => void;
  onInstall: () => void;
};

type NativeUpdatePromptResult = {
  readonly backgroundUpdatesEnabled: boolean;
  readonly confirmed: boolean;
};

type ActiveUpdateWindow = {
  readonly prompt: Promise<NativeUpdatePromptResult | null>;
  readonly version: string;
};

let activeUpdateWindow: ActiveUpdateWindow | null = null;

function showNativeUpdatePrompt(
  version: string,
  urgent: boolean,
  message: string | null,
  backgroundUpdatesEnabled: boolean,
) {
  return invoke<NativeUpdatePromptResult | null>("update_prompt_show_native", {
    backgroundUpdatesEnabled,
    message,
    version,
    urgent,
  });
}

function getNativeUpdatePrompt(
  version: string,
  urgent: boolean,
  message: string | null,
  backgroundUpdatesEnabled: boolean,
) {
  if (activeUpdateWindow?.version === version) return activeUpdateWindow.prompt;

  const prompt = showNativeUpdatePrompt(version, urgent, message, backgroundUpdatesEnabled).finally(() => {
    if (activeUpdateWindow?.prompt === prompt) activeUpdateWindow = null;
  });
  activeUpdateWindow = { prompt, version };
  return prompt;
}

export function AvailableUpdateDialog({
  backgroundUpdatesEnabled,
  policy,
  update,
  updaterChecking,
  updaterError,
  updaterInstalling,
  onBackgroundUpdatesEnabledChange,
  onDismiss,
  onInstall,
}: AvailableUpdateDialogProps) {
  const urgent = policy?.urgency === "urgent" || updaterError !== null;
  const message = policy?.message ?? update.body ?? null;

  useEffect(() => {
    if (updaterChecking || updaterInstalling) return;

    let subscribed = true;

    void getNativeUpdatePrompt(update.version, urgent, message, backgroundUpdatesEnabled).then((result) => {
      if (!subscribed) return;
      if (!result) {
        onDismiss();
        return;
      }
      onBackgroundUpdatesEnabledChange(result.backgroundUpdatesEnabled);
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
    backgroundUpdatesEnabled,
    message,
    onBackgroundUpdatesEnabledChange,
    onDismiss,
    onInstall,
    update.version,
    urgent,
    updaterChecking,
    updaterInstalling,
  ]);

  return null;
}
