import type { SettingsSelectOption } from "./SettingsSelect";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";

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
): readonly SettingsSelectOption<string>[] {
  return [
    {
      value: DRIFTY_CLOUD_MODEL_ID,
      label: DRIFTY_CLOUD_MODEL_LABEL,
      actionLabel: cloudSubscribeActionLabel ?? undefined,
      actionAriaLabel: cloudSubscribeActionLabel ? "Subscribe to Drifty Individual Cloud" : undefined,
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
        actionLabel: modelActionLabel(actionModelId === model.id || installing, failed, status?.progress?.percent ?? null),
        actionAriaLabel: `Download ${model.label} managed local model`,
        actionDisabled: Boolean(actionModelId) || status?.state === "installing" || status?.state === "starting",
        onAction: (modelId: string) => {
          void onInstallModel(modelId);
        },
      };
    }),
  ];
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

function modelActionLabel(isBusy: boolean, failed: boolean, percent: number | null): string {
  if (isBusy) return percent === null ? "Downloading..." : `Downloading ${percent.toFixed(0)}%`;
  if (failed) return "Retry";
  return "Download";
}

function isRetryableManagedModelError(errorKind: ManagedLocalAiStatus["errorKind"]): boolean {
  return errorKind === "download_failed" || errorKind === "model_artifact_missing";
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
