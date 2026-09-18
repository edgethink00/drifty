import type { SettingsSelectOption, SettingsSelectRowAction } from "./SettingsSelect";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";
import { isRetryableManagedModelError } from "./managedLocalAiLabels";
import { managedLocalAiProgressText } from "./managedLocalAiProgressText";
import type { LocalizationController } from "../localization/LocalizationContext";
import { managedModelChoiceTitle, managedModelResourceDescription } from "./managedModelPresentation";

export const DRIFTY_CLOUD_MODEL_ID = "drifty_cloud";
/**
 * The model dropdown picks where inference runs, not which plan you own, so the
 * cloud route keeps its infrastructure name here. "Drifty Pro" is reserved for
 * the surfaces that actually sell or manage the plan.
 */
export const DRIFTY_CLOUD_MODEL_LABEL = "Drifty Cloud";

export type DriftyModelOptionsParams = {
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly status: ManagedLocalAiStatus | null;
  readonly actionModelId: string | null;
  readonly cloudSubscribeActionDisabled: boolean;
  readonly cloudSubscribeActionLabel: string | null;
  /** Whether the cloud option can be selected as the active model (active OR trialing). */
  readonly cloudSelectable: boolean;
  /** True only for a fully-active plan whose billing can be managed. */
  readonly canManageBilling: boolean;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
  readonly onStartModel: (modelId: string) => void | Promise<void>;
  readonly onStartCloudSetup: () => void | Promise<void>;
  readonly onManageCloudBilling: () => void | Promise<void>;
  readonly onDeleteModel: (modelId: string) => void | Promise<void>;
  readonly onRevealArtifact: (artifactDir: string) => void | Promise<void>;
  /**
   * Coarse remaining-time copy for the model currently downloading, when the
   * transfer rate is measurable. Resolved by the caller because the estimate
   * needs a hook and this builder is pure.
   */
  readonly downloadRemainingLabel?: string | null;
  readonly t: LocalizationController["t"];
};

/**
 * Options for the Drifty provider's model dropdown, which is now the single place
 * to manage Drifty AI (there is no separate provider card): the cloud entry
 * carries an Upgrade or hover-revealed Manage-billing action, not-installed local
 * models carry a Download action (with % progress / Retry), and installed local
 * models show their management actions, plus a direct runtime retry when the
 * downloaded model is intact but its execution layer needs recovery.
 */
export function driftyModelOptions({
  catalog,
  status,
  actionModelId,
  cloudSubscribeActionDisabled,
  cloudSubscribeActionLabel,
  cloudSelectable,
  canManageBilling,
  onInstallModel,
  onStartModel,
  onStartCloudSetup,
  onManageCloudBilling,
  onDeleteModel,
  onRevealArtifact,
  downloadRemainingLabel = null,
  t,
}: DriftyModelOptionsParams): readonly SettingsSelectOption<string>[] {
  const cloudActionAriaLabel = cloudSubscribeActionLabel === null
    ? undefined
    : cloudSubscribeActionLabel === t("settings.ai.opening")
      ? t("settings.ai.openingCloudCheckoutAria")
      : t("settings.ai.upgradeCloudAria");
  const cloudNeedsUpgrade = cloudSubscribeActionLabel !== null;

  const cloudOption: SettingsSelectOption<string> = cloudNeedsUpgrade
    ? {
      value: DRIFTY_CLOUD_MODEL_ID,
      label: DRIFTY_CLOUD_MODEL_LABEL,
      // Trialing plans keep the cloud model selectable while still showing Upgrade.
      disabled: !cloudSelectable,
      actionLabel: cloudSubscribeActionLabel ?? undefined,
      actionAriaLabel: cloudActionAriaLabel,
      actionDisabled: cloudSubscribeActionDisabled,
      actionTone: "primary",
      onAction: () => {
        void onStartCloudSetup();
      },
    }
    : canManageBilling
      ? {
        value: DRIFTY_CLOUD_MODEL_ID,
        label: DRIFTY_CLOUD_MODEL_LABEL,
        // Active plan → selectable, Manage billing is a secondary hover action.
        // Locked plan (device limit / payment) → not selectable, Manage billing is the
        // primary recovery action so it stays visible.
        disabled: !cloudSelectable,
        actionLabel: t("settings.account.manageBilling"),
        actionAriaLabel: t("settings.account.manageBilling"),
        actionOnHover: cloudSelectable,
        actionTone: cloudSelectable ? undefined : "primary",
        onAction: () => {
          void onManageCloudBilling();
        },
      }
      : { value: DRIFTY_CLOUD_MODEL_ID, label: DRIFTY_CLOUD_MODEL_LABEL };

  return [
    { ...cloudOption, description: t("ai.resources.cloudModelSummary") },
    ...catalog.map((model) => {
      const presentation = {
        displayLabel: `${model.label} · ${managedModelChoiceTitle(model, t)}`,
        description: managedModelResourceDescription(model, t),
      };
      const selectable = isSelectableManagedModel(model.id, status);
      if (selectable) {
        const busy = Boolean(actionModelId) || status?.state === "installing" || status?.state === "starting";
        const preparingRuntime = status?.selectedModelId === model.id
          && status.state === "installing"
          && Boolean(status.artifactDir);
        const artifactDir = installedArtifactDir(model.id, status);
        const actions: SettingsSelectRowAction[] = [];
        const retryRuntime = status?.selectedModelId === model.id
          && status.state === "error"
          && canRetryInstalledRuntime(status.errorKind);
        if (retryRuntime) {
          actions.push({
            key: "retry-runtime",
            label: t("settings.ai.retryManagedModelStartAria", { model: model.label }),
            text: t("settings.ai.retry"),
            tone: "primary",
            disabled: busy,
            busy: actionModelId === model.id,
            onAction: () => {
              void onStartModel(model.id);
            },
          });
        }
        if (artifactDir) {
          actions.push({
            key: "reveal",
            label: t("settings.ai.showManagedModelInFinderAria", { model: model.label }),
            icon: <FolderIcon />,
            onAction: () => {
              void onRevealArtifact(artifactDir);
            },
          });
        }
        actions.push({
          key: "delete",
          label: t("settings.ai.deleteManagedModelAria", { model: model.label }),
          icon: <TrashIcon />,
          tone: "danger",
          disabled: busy,
          onAction: () => {
            void onDeleteModel(model.id);
          },
        });
        return {
          value: model.id,
          label: model.label,
          ...presentation,
          statusLabel: t(
            preparingRuntime
              ? "ai.resources.modelPreparing"
              : status?.selectedModelId === model.id && status.state === "running"
                ? "ai.resources.modelInUse"
                : "ai.resources.modelInstalled",
          ),
          // The managed action hook deliberately ignores overlapping work. Keep a
          // second model selection from changing the persisted identity while the
          // current install/start still owns that action slot.
          disabled: busy || model.fit === "insufficient",
          actions,
        } satisfies SettingsSelectOption<string>;
      }
      const installing = status?.selectedModelId === model.id && status.state === "installing";
      const failed = status?.selectedModelId === model.id && status.state === "error" && isRetryableManagedModelError(status.errorKind);
      const busy = actionModelId === model.id || installing;
      // While the transfer runs, the row's static memory-and-size blurb is the
      // least useful thing it could say. Spend the line on live progress.
      const downloadingDescription = installing
        ? [managedLocalAiProgressText(status?.progress ?? null), downloadRemainingLabel].filter(Boolean).join(" · ")
        : "";
      return {
        value: model.id,
        label: model.label,
        ...presentation,
        ...(downloadingDescription ? { description: downloadingDescription } : {}),
        disabled: true,
        actionLabel: localizedDownloadButtonLabel(busy, failed, status?.progress?.percent ?? null, t),
        actionAriaLabel: t("settings.ai.downloadManagedModelAria", { model: model.label }),
        // Keep idle setup actions quiet; progress and errors stay visible.
        actionOnHover: !busy && !failed,
        actionBusy: busy,
        actionDisabled: model.fit === "insufficient" || Boolean(actionModelId) || status?.state === "installing" || status?.state === "starting",
        onAction: (modelId: string) => {
          void onInstallModel(modelId);
        },
      } satisfies SettingsSelectOption<string>;
    }),
  ];
}

/** Resolve the on-disk artifact directory for an installed managed model, if any. */
function installedArtifactDir(modelId: string, status: ManagedLocalAiStatus | null): string | null {
  const installed = status?.installedModels.find((item) => item.id === modelId);
  if (installed?.artifactDir) return installed.artifactDir;
  if (
    status?.selectedModelId === modelId
    && (status.state === "installed" || status.state === "starting" || status.state === "running")
    && status.artifactDir
  ) {
    return status.artifactDir;
  }
  return null;
}

function canRetryInstalledRuntime(errorKind: ManagedLocalAiStatus["errorKind"]): boolean {
  return errorKind === "runtime_missing"
    || errorKind === "runtime_download_failed"
    || errorKind === "runtime_port_conflict"
    || errorKind === "runtime_failed"
    || errorKind === "insufficient_storage";
}

function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h3.6l1.9 2.1h8A1.5 1.5 0 0 1 20 9.6V17.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 7h15M9.5 7V5.6A1.6 1.6 0 0 1 11.1 4h1.8a1.6 1.6 0 0 1 1.6 1.6V7M7 7l.7 11a1.6 1.6 0 0 0 1.6 1.5h5.4a1.6 1.6 0 0 0 1.6-1.5L17 7" />
    </svg>
  );
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
