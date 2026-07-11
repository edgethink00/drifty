import { useState } from "react";
import { ManagedModelActionIcon } from "./ManagedModelActionIcon";
import type { LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";
import { isRetryableManagedModelError } from "./managedLocalAiLabels";
import { managedLocalAiProgressText } from "./managedLocalAiProgressText";
import { managedModelRuntimeMemoryLabel } from "./managedLocalAiMemory";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizedManagedModelDetail, localizedManagedModelFitDetail, localizedManagedModelTier } from "../localization/managedModelTranslations";

export type ManagedLocalAiPanelProps = {
  readonly actionModelId: string | null;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly loading: boolean;
  readonly localAiSetup: LocalAiSetupState;
  readonly status: ManagedLocalAiStatus | null;
  readonly onDeleteModel: (modelId: string) => void | Promise<void>;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
};

export function ManagedLocalAiPanel({
  actionModelId,
  catalog,
  loading,
  localAiSetup,
  status,
  onDeleteModel,
  onInstallModel,
}: ManagedLocalAiPanelProps) {
  const { effectiveLanguage, t } = useLocalization();
  const statusMessage = loading
    ? t("settings.ai.checkingManagedRuntime")
    : normalizeManagedLocalStatusMessage(status?.message, t) ?? t("settings.ai.chooseLocalModel");

  return (
    <div className="ai-setup-detail ai-setup-detail--local" role="group" aria-label={t("settings.ai.localSettingsAria")}>
      <div className="ai-managed-status">
        <p>{statusMessage}</p>
      </div>

      <div className="ai-managed-model-list" aria-label={t("settings.ai.localModelChoicesAria")}>
        {catalog.map((model) => (
          <ManagedLocalAiModelRow
            key={model.id}
            actionModelId={actionModelId}
            loading={loading}
            localAiSetup={localAiSetup}
            model={model}
            effectiveLanguage={effectiveLanguage}
            status={status}
            onDeleteModel={onDeleteModel}
            onInstallModel={onInstallModel}
          />
        ))}
      </div>
    </div>
  );
}

function normalizeManagedLocalStatusMessage(message: string | null | undefined, t: LocalizationController["t"]): string | null {
  const trimmed = message?.trim();
  if (!trimmed) return null;
  if (/cannot read properties of undefined/i.test(trimmed) || /invoke/i.test(trimmed)) {
    return t("settings.ai.desktopRuntimeRequired");
  }
  return trimmed;
}

function ManagedLocalAiModelRow({
  actionModelId,
  loading,
  localAiSetup,
  model,
  effectiveLanguage,
  status,
  onDeleteModel,
  onInstallModel,
}: {
  readonly actionModelId: string | null;
  readonly loading: boolean;
  readonly localAiSetup: LocalAiSetupState;
  readonly model: ManagedLocalAiModel;
  readonly effectiveLanguage: "en" | "ko";
  readonly status: ManagedLocalAiStatus | null;
  readonly onDeleteModel: (modelId: string) => void | Promise<void>;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
}) {
  const { t } = useLocalization();
  const [finderOpening, setFinderOpening] = useState(false);
  const [finderError, setFinderError] = useState<string | null>(null);
  const installedModel = installedManagedModel(model.id, status);
  const isSelected = Boolean(installedModel) && localAiSetup.provider === "managed_local" && localAiSetup.driftyRoute === "local" && localAiSetup.managedLocalModelId === model.id;
  const installingThisModel = status?.selectedModelId === model.id && status.state === "installing";
  const startingThisModel = status?.selectedModelId === model.id && status.state === "starting";
  const errorThisModel = status?.selectedModelId === model.id && status.state === "error" && isRetryableManagedModelError(status.errorKind);
  const busyThisModel = actionModelId === model.id || installingThisModel || startingThisModel;
  const anyManagedActionRunning = loading || Boolean(actionModelId) || status?.state === "installing" || status?.state === "starting";
  const downloadProgress = installingThisModel ? status.progress : null;
  const downloadProgressText = managedLocalAiProgressText(downloadProgress);
  const artifactDir = installedModel?.artifactDir ?? null;
  const runtimeMemoryLabel = managedModelRuntimeMemoryLabel(model, status);
  const unsupported = model.fit === "insufficient";
  const showInFinderDisabled = busyThisModel || finderOpening || !artifactDir;

  const handleShowInFinder = async () => {
    if (!artifactDir || finderOpening) return;
    setFinderError(null);
    setFinderOpening(true);
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(artifactDir);
    } catch (error) {
      if (error instanceof Error) {
        setFinderError(t("settings.ai.finderUnavailableWithError", { error: error.message }));
        return;
      }
      setFinderError(t("settings.ai.finderUnavailable"));
    } finally {
      setFinderOpening(false);
    }
  };

  return (
    <article className={`ai-managed-model${isSelected ? " is-selected" : ""}${unsupported ? " is-unsupported" : ""}`} aria-label={t("settings.ai.managedModelAria", { model: model.label })}>
      <div className="ai-managed-model__copy">
        <strong>{model.label}</strong>
        <p>{localizedManagedModelDetail(model, effectiveLanguage, t)}</p>
        {model.fitDetail ? <p className="ai-managed-model__fit-note">{localizedManagedModelFitDetail(model, effectiveLanguage, t)}</p> : null}
      </div>
      <div className="ai-managed-model__meta">
        <div className="ai-managed-model__badges">
          <span className="ai-managed-model__tier">{localizedManagedModelTier(model.tier, effectiveLanguage, t)}</span>
          {model.recommended ? <span className="chip green">{model.fit ? t("settings.ai.recommendedForMac") : t("common.recommended")}</span> : null}
          {model.fit === "tight" ? <span className="chip gold">{t("settings.ai.mayBeSlow")}</span> : null}
          {unsupported ? <span className="chip gray">{t("settings.ai.notEnoughMemory")}</span> : null}
        </div>
        <dl className="ai-managed-model__facts">
          <div><dt>{t("settings.ai.download")}</dt><dd>{model.downloadSize}</dd></div>
          {runtimeMemoryLabel ? <div><dt>{t("settings.ai.ramWhileRunning")}</dt><dd>{runtimeMemoryLabel}</dd></div> : null}
        </dl>
      </div>
      <div className="ai-managed-model__actions">
        {installedModel ? (
          <>
            <button
              type="button"
              className="settings-btn ai-managed-model__primary-action"
              disabled={showInFinderDisabled}
              onClick={() => void handleShowInFinder()}
            >
              <ManagedModelActionIcon icon="finder" />
              <span>{finderOpening ? t("settings.ai.opening") : t("settings.ai.showInFinder")}</span>
            </button>
            <button
              type="button"
              className="settings-btn ai-managed-model__delete-action"
              aria-label={t("settings.ai.deleteManagedModelAria", { model: model.label })}
              disabled={busyThisModel}
              title={t("settings.ai.deleteModel")}
              onClick={() => void onDeleteModel(model.id)}
            >
              <ManagedModelActionIcon icon="delete" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`settings-btn ai-managed-model__primary-action ai-managed-model__download-action${errorThisModel ? " is-retry" : ""}`}
            disabled={anyManagedActionRunning || unsupported}
            onClick={() => void onInstallModel(model.id)}
          >
            <ManagedModelActionIcon icon="download" />
            <span>{managedDownloadButtonLabel(busyThisModel, errorThisModel, downloadProgress?.percent ?? null, t)}</span>
          </button>
        )}
        {downloadProgressText ? <span className="ai-managed-model__action-note" role="status">{downloadProgressText}</span> : null}
        {finderError ? <span className="ai-managed-model__action-note" role="status">{finderError}</span> : null}
      </div>
    </article>
  );
}

function managedDownloadButtonLabel(isBusy: boolean, isError: boolean, percent: number | null, t: LocalizationController["t"]): string {
  if (isBusy) return percent === null ? t("settings.ai.downloading") : t("settings.ai.downloadingPercent", { percent: percent.toFixed(0) });
  if (isError) return t("settings.ai.retry");
  return t("settings.ai.download");
}

function installedManagedModel(modelId: string, status: ManagedLocalAiStatus | null): { readonly artifactDir: string } | null {
  const installedModel = status?.installedModels.find((item) => item.id === modelId);
  if (installedModel) return installedModel;
  if (status?.selectedModelId === modelId && (status.state === "installed" || status.state === "starting" || status.state === "running") && status.artifactDir) {
    return { artifactDir: status.artifactDir };
  }
  return null;
}
