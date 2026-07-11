import type { SettingsSelectOption } from "./SettingsSelect";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";
import { isRetryableManagedModelError } from "./managedLocalAiLabels";
import type { LocalizationController } from "../localization/LocalizationContext";

export const DRIFTY_CLOUD_MODEL_ID = "drifty_cloud";
export const DRIFTY_CLOUD_MODEL_LABEL = "Drifty Individual (Cloud)";

export function driftyModelOptions(
  catalog: readonly ManagedLocalAiModel[],
  status: ManagedLocalAiStatus | null,
  actionModelId: string | null,
  cloudSubscribeActionDisabled: boolean,
  cloudSubscribeActionLabel: string | null,
  onInstallModel: (modelId: string) => void | Promise<void>,
  onStartCloudSetup: () => void | Promise<void>,
  t: LocalizationController["t"],
): readonly SettingsSelectOption<string>[] {
  const cloudActionAriaLabel = cloudSubscribeActionLabel === null
    ? undefined
    : cloudSubscribeActionLabel === t("settings.ai.opening")
      ? t("settings.ai.openingCloudCheckoutAria")
      : t("settings.ai.upgradeCloudAria");

  return [
    {
      value: DRIFTY_CLOUD_MODEL_ID,
      label: DRIFTY_CLOUD_MODEL_LABEL,
      disabled: cloudSubscribeActionLabel !== null,
      actionLabel: cloudSubscribeActionLabel ?? undefined,
      actionAriaLabel: cloudActionAriaLabel,
      actionDisabled: cloudSubscribeActionDisabled,
      onAction: cloudSubscribeActionLabel
        ? () => {
          void onStartCloudSetup();
        }
        : undefined,
    },
    ...catalog.map((model) => {
      const selectable = isSelectableManagedModel(model.id, status);
      if (selectable) return { value: model.id, label: model.label };
      const installing = status?.selectedModelId === model.id && status.state === "installing";
      const failed = status?.selectedModelId === model.id && status.state === "error" && isRetryableManagedModelError(status.errorKind);
      return {
        value: model.id,
        label: model.label,
        disabled: true,
        actionLabel: localizedDownloadButtonLabel(actionModelId === model.id || installing, failed, status?.progress?.percent ?? null, t),
        actionAriaLabel: t("settings.ai.downloadManagedModelAria", { model: model.label }),
        actionDisabled: Boolean(actionModelId) || status?.state === "installing" || status?.state === "starting",
        onAction: (modelId: string) => {
          void onInstallModel(modelId);
        },
      };
    }),
  ];
}

function localizedDownloadButtonLabel(isBusy: boolean, isError: boolean, percent: number | null, t: LocalizationController["t"]): string {
  if (isBusy) return percent === null ? t("settings.ai.downloading") : t("settings.ai.downloadingPercent", { percent: percent.toFixed(0) });
  if (isError) return t("settings.ai.retry");
  return t("settings.ai.download");
}

export function isSelectableManagedModel(modelId: string, status: ManagedLocalAiStatus | null): boolean {
  if (status?.installedModels.some((item) => item.id === modelId)) return true;
  if (status?.selectedModelId !== modelId) return false;
  switch (status.state) {
    case "installed":
    case "starting":
    case "running":
      return true;
    case "installing":
    case "error":
    case "not_installed":
      return false;
    default:
      return assertNever(status.state);
  }
}

class AiSetupDriftyModelOptionsError extends Error {
  constructor(readonly state: string) {
    super(`Unhandled managed local AI status: ${state}`);
    this.name = "AiSetupDriftyModelOptionsError";
  }
}

function assertNever(value: never): never {
  throw new AiSetupDriftyModelOptionsError(String(value));
}
