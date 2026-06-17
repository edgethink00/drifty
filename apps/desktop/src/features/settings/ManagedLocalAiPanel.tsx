import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { AiSetupConnectionTestRow } from "./AiSetupConnectionTestRow";
import { ManagedModelActionIcon } from "./ManagedModelActionIcon";
import type { LocalAiSetupState } from "./localAiSetup";
import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "./managedLocalAiClient";

export type ManagedLocalAiPanelProps = {
  readonly actionModelId: string | null;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly connectionTestMessage: string | null;
  readonly connectionTestRunning: boolean;
  readonly loading: boolean;
  readonly localAiSetup: LocalAiSetupState;
  readonly status: ManagedLocalAiStatus | null;
  readonly onDeleteModel: (modelId: string) => void | Promise<void>;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onStartModel: (modelId: string) => void | Promise<void>;
  readonly onTestConnection: () => void | Promise<void>;
};

export function ManagedLocalAiPanel({
  actionModelId,
  catalog,
  connectionTestMessage,
  connectionTestRunning,
  loading,
  localAiSetup,
  status,
  onDeleteModel,
  onInstallModel,
  onLocalAiSetupChange,
  onStartModel,
  onTestConnection,
}: ManagedLocalAiPanelProps) {
  const managedConnectionReady = Boolean(localAiSetup.managedLocalBaseUrl.trim() && localAiSetup.managedLocalModel.trim());
  const managedLocalSelected = localAiSetup.provider === "managed_local" && localAiSetup.driftyRoute === "local";
  const managedMessage = managedLocalSelected ? connectionTestMessage : null;

  return (
    <div className="ai-setup-detail ai-setup-detail--local" role="group" aria-label="Local AI settings">
      <div className="ai-managed-status">
        <div>
          <span className="chip green">Managed Local AI</span>
          <span className="chip gray">{managedStatusLabel(status, loading)}</span>
        </div>
        <p>{loading ? "Checking managed runtime..." : status?.message ?? "Choose a local model and Drifty will download it inside the app."}</p>
      </div>

      <div className="ai-managed-model-list" aria-label="Managed local model choices">
        {catalog.map((model) => (
          <ManagedLocalAiModelRow
            key={model.id}
            actionModelId={actionModelId}
            localAiSetup={localAiSetup}
            model={model}
            status={status}
            onDeleteModel={onDeleteModel}
            onInstallModel={onInstallModel}
            onLocalAiSetupChange={onLocalAiSetupChange}
            onStartModel={onStartModel}
          />
        ))}
      </div>

      <AiSetupConnectionTestRow
        buttonLabel={connectionTestRunning && managedLocalSelected ? "Testing..." : "Managed runtime test"}
        disabled={connectionTestRunning || !managedLocalSelected || !managedConnectionReady}
        message={managedMessage}
        providerLabel="Managed Local AI"
        onTestConnection={onTestConnection}
      />
    </div>
  );
}

function ManagedLocalAiModelRow({
  actionModelId,
  localAiSetup,
  model,
  status,
  onDeleteModel,
  onInstallModel,
  onLocalAiSetupChange,
}: {
  readonly actionModelId: string | null;
  readonly localAiSetup: LocalAiSetupState;
  readonly model: ManagedLocalAiModel;
  readonly status: ManagedLocalAiStatus | null;
  readonly onDeleteModel: (modelId: string) => void | Promise<void>;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onStartModel: (modelId: string) => void | Promise<void>;
}) {
  const [finderOpening, setFinderOpening] = useState(false);
  const [finderError, setFinderError] = useState<string | null>(null);
  const selectable = isSelectableManagedModel(model.id, status);
  const isSelected = selectable && localAiSetup.provider === "managed_local" && localAiSetup.driftyRoute === "local" && localAiSetup.managedLocalModelId === model.id;
  const hasCurrentRuntime = isSelected && (status?.state === "installed" || status?.state === "running");
  const installingThisModel = status?.selectedModelId === model.id && status.state === "installing";
  const errorThisModel = status?.selectedModelId === model.id && status.state === "error";
  const busyThisModel = actionModelId === model.id || installingThisModel;
  const anyManagedActionRunning = Boolean(actionModelId) || status?.state === "installing";
  const downloadProgress = installingThisModel ? status.progress : null;
  const showInFinderDisabled = busyThisModel || finderOpening || !status?.artifactDir;

  const handleShowInFinder = async () => {
    if (!status?.artifactDir || finderOpening) return;
    setFinderError(null);
    setFinderOpening(true);
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(status.artifactDir);
    } catch (error) {
      setFinderError(messageFromFinderError(error));
    } finally {
      setFinderOpening(false);
    }
  };

  return (
    <article className={`ai-managed-model${isSelected ? " is-selected" : ""}`} aria-label={`${model.label} managed local model`}>
      <input
        className="ai-managed-model__selector"
        type="radio"
        name="managed-local-model"
        checked={isSelected}
        disabled={!selectable}
        aria-label={`Select ${model.label} managed local model`}
        onChange={() => onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local", driftyRoute: "local", managedLocalModelId: model.id }))}
      />
      <div className="ai-managed-model__copy">
        <div>
          <span className="ai-managed-model__tier">{model.tier}</span>
          {model.recommended ? <span className="chip green">Recommended</span> : null}
        </div>
        <strong>{model.label}</strong>
        <p>{model.detail}</p>
      </div>
      <dl className="ai-managed-model__facts">
        <div><dt>Download</dt><dd>{model.downloadSize}</dd></div>
        <div><dt>Disk</dt><dd>{model.diskRequired}</dd></div>
        <div><dt>Memory</dt><dd>{model.minimumMemory}</dd></div>
      </dl>
      <div className="ai-managed-model__actions">
        {hasCurrentRuntime ? (
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
            className={`settings-btn ai-managed-model__primary-action${errorThisModel ? " is-retry" : ""}`}
            disabled={anyManagedActionRunning}
            onClick={() => void onInstallModel(model.id)}
          >
            <ManagedModelActionIcon icon="download" />
            <span>{managedDownloadButtonLabel(busyThisModel, errorThisModel, downloadProgress?.percent ?? null)}</span>
          </button>
        )}
        {finderError ? <span className="ai-managed-model__action-note" role="status">{finderError}</span> : null}
      </div>
    </article>
  );
}

function isSelectableManagedModel(modelId: string, status: ManagedLocalAiStatus | null): boolean {
  return status?.selectedModelId === modelId && (status.state === "installed" || status.state === "running");
}

function messageFromFinderError(error: unknown): string {
  return error instanceof Error && error.message ? `Finder unavailable: ${error.message}` : "Finder unavailable.";
}

function managedDownloadButtonLabel(isBusy: boolean, isError: boolean, percent: number | null): string {
  if (isBusy) return percent === null ? "Downloading..." : `Downloading ${percent.toFixed(0)}%`;
  if (isError) return "Retry";
  return "Download";
}

function managedStatusLabel(status: ManagedLocalAiStatus | null, loading: boolean): string {
  if (loading) return "Checking";
  const state = status?.state ?? "not_installed";
  switch (state) {
    case "running":
      return "Running";
    case "installed":
      return "Downloaded";
    case "installing":
      return "Downloading";
    case "error":
      return "Needs runtime";
    case "not_installed":
      return "Download";
    default:
      return assertNever(state);
  }
}

class ManagedLocalAiPanelError extends Error {
  constructor(readonly state: string) {
    super(`Unhandled managed local AI state: ${state}`);
    this.name = "ManagedLocalAiPanelError";
  }
}

function assertNever(value: never): never {
  throw new ManagedLocalAiPanelError(String(value));
}
