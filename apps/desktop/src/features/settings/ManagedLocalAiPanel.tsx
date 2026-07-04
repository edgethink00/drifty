import { useState } from "react";
import { ManagedModelActionIcon } from "./ManagedModelActionIcon";
import type { LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";
import { managedLocalAiProgressText } from "./managedLocalAiProgressText";
import { managedModelRuntimeMemoryLabel } from "./managedLocalAiMemory";

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
  return (
    <div className="ai-setup-detail ai-setup-detail--local" role="group" aria-label="Local AI settings">
      <div className="ai-managed-status">
        <p>{loading ? "Checking managed runtime..." : status?.message ?? "Choose a local model and Drifty will download it inside the app."}</p>
      </div>

      <div className="ai-managed-model-list" aria-label="Managed local model choices">
        {catalog.map((model) => (
          <ManagedLocalAiModelRow
            key={model.id}
            actionModelId={actionModelId}
            loading={loading}
            localAiSetup={localAiSetup}
            model={model}
            status={status}
            onDeleteModel={onDeleteModel}
            onInstallModel={onInstallModel}
          />
        ))}
      </div>
    </div>
  );
}

function ManagedLocalAiModelRow({
  actionModelId,
  loading,
  localAiSetup,
  model,
  status,
  onDeleteModel,
  onInstallModel,
}: {
  readonly actionModelId: string | null;
  readonly loading: boolean;
  readonly localAiSetup: LocalAiSetupState;
  readonly model: ManagedLocalAiModel;
  readonly status: ManagedLocalAiStatus | null;
  readonly onDeleteModel: (modelId: string) => void | Promise<void>;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
}) {
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
        setFinderError(`Finder unavailable: ${error.message}`);
        return;
      }
      setFinderError("Finder unavailable.");
    } finally {
      setFinderOpening(false);
    }
  };

  return (
    <article className={`ai-managed-model${isSelected ? " is-selected" : ""}`} aria-label={`${model.label} managed local model`}>
      <div className="ai-managed-model__copy">
        <strong>{model.label}</strong>
        <p>{model.detail}</p>
      </div>
      <div className="ai-managed-model__meta">
        <div className="ai-managed-model__badges">
          <span className="ai-managed-model__tier">{model.tier}</span>
          {model.recommended ? <span className="chip green">Recommended</span> : null}
        </div>
        <dl className="ai-managed-model__facts">
          <div><dt>Download</dt><dd>{model.downloadSize}</dd></div>
          {runtimeMemoryLabel ? <div><dt>RAM while running</dt><dd>{runtimeMemoryLabel}</dd></div> : null}
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
              <span>{finderOpening ? "Opening..." : "Show in Finder"}</span>
            </button>
            <button
              type="button"
              className="settings-btn ai-managed-model__delete-action"
              aria-label={`Delete ${model.label} managed local model`}
              disabled={busyThisModel}
              title="Delete model"
              onClick={() => void onDeleteModel(model.id)}
            >
              <ManagedModelActionIcon icon="delete" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`settings-btn ai-managed-model__primary-action ai-managed-model__download-action${errorThisModel ? " is-retry" : ""}`}
            disabled={anyManagedActionRunning}
            onClick={() => void onInstallModel(model.id)}
          >
            <ManagedModelActionIcon icon="download" />
            <span>{managedDownloadButtonLabel(busyThisModel, errorThisModel, downloadProgress?.percent ?? null)}</span>
          </button>
        )}
        {downloadProgressText ? <span className="ai-managed-model__action-note" role="status">{downloadProgressText}</span> : null}
        {finderError ? <span className="ai-managed-model__action-note" role="status">{finderError}</span> : null}
      </div>
    </article>
  );
}

function installedManagedModel(modelId: string, status: ManagedLocalAiStatus | null): { readonly artifactDir: string } | null {
  const installedModel = status?.installedModels.find((item) => item.id === modelId);
  if (installedModel) return installedModel;
  if (status?.selectedModelId === modelId && (status.state === "installed" || status.state === "starting" || status.state === "running") && status.artifactDir) {
    return { artifactDir: status.artifactDir };
  }
  return null;
}

function isRetryableManagedModelError(errorKind: ManagedLocalAiStatus["errorKind"]): boolean {
  return errorKind === "download_failed" || errorKind === "model_artifact_missing";
}

function managedDownloadButtonLabel(isBusy: boolean, isError: boolean, percent: number | null): string {
  if (isBusy) return percent === null ? "Downloading..." : `Downloading ${percent.toFixed(0)}%`;
  if (isError) return "Retry";
  return "Download";
}
