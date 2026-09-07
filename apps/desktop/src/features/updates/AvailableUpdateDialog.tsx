import { useLocalization, type DisplayLanguage } from "../localization/LocalizationContext";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UpdatePolicy } from "./updatePolicy";

type AvailableUpdateDialogUpdate = {
  body?: string | null;
  date?: string | null;
  version: string;
};

type UpdateChannel = "stable" | "developer";

export type AvailableUpdateDialogProps = {
  updateChannel: UpdateChannel;
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
  readonly owner: UpdateChannel;
  readonly prompt: Promise<NativeUpdatePromptResult | null>;
  readonly version: string;
};

let activeUpdateWindow: ActiveUpdateWindow | null = null;

function showNativeUpdatePrompt(
  version: string,
  urgent: boolean,
  message: string | null,
  backgroundUpdatesEnabled: boolean,
  language: DisplayLanguage,
) {
  return invoke<NativeUpdatePromptResult | null>("update_prompt_show_native", {
    backgroundUpdatesEnabled,
    language,
    message,
    version,
    urgent,
  });
}

function getNativeUpdatePrompt(
  owner: UpdateChannel,
  version: string,
  urgent: boolean,
  message: string | null,
  backgroundUpdatesEnabled: boolean,
  language: DisplayLanguage,
) {
  // The channel survives auth/onboarding shell remounts and StrictMode.
  // Another updater must never share its confirmation or open a competing window.
  if (activeUpdateWindow) {
    return activeUpdateWindow.owner === owner && activeUpdateWindow.version === version
      ? activeUpdateWindow.prompt
      : Promise.resolve(null);
  }

  const prompt = showNativeUpdatePrompt(version, urgent, message, backgroundUpdatesEnabled, language).finally(() => {
    if (activeUpdateWindow?.prompt === prompt) activeUpdateWindow = null;
  });
  activeUpdateWindow = { owner, prompt, version };
  return prompt;
}

export function AvailableUpdateDialog({
  updateChannel,
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
  const { effectiveLanguage } = useLocalization();
  const urgent = policy?.urgency === "urgent" || updaterError !== null;
  const message = policy?.message ?? update.body ?? null;

  useEffect(() => {
    if (updaterChecking || updaterInstalling) return;

    let subscribed = true;

    void getNativeUpdatePrompt(updateChannel, update.version, urgent, message, backgroundUpdatesEnabled, effectiveLanguage).then((result) => {
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
    updateChannel,
    effectiveLanguage,
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
