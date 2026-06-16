import type { Dispatch, SetStateAction } from "react";

import { AiSetupConnectionTestRow } from "./AiSetupConnectionTestRow";
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
  const managedMessage = localAiSetup.provider === "managed_local" ? connectionTestMessage : null;

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
        buttonLabel={connectionTestRunning && localAiSetup.provider === "managed_local" ? "Testing..." : "Managed runtime test"}
        disabled={connectionTestRunning || !managedConnectionReady}
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
  onStartModel,
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
  const isSelected = localAiSetup.provider === "managed_local" && localAiSetup.managedLocalModelId === model.id;
  const hasCurrentRuntime = isSelected && (status?.state === "installed" || status?.state === "running");
  const actionRunning = actionModelId === model.id;
  const deleteDisabled = actionRunning || !hasCurrentRuntime;
  const startDisabled = actionRunning || !hasCurrentRuntime || status?.state === "running";

  return (
    <article className={`ai-managed-model${isSelected ? " is-selected" : ""}`} aria-label={`${model.label} managed local model`}>
      <input
        className="ai-managed-model__selector"
        type="radio"
        name="managed-local-model"
        checked={isSelected}
        aria-label={`Select ${model.label} managed local model`}
        onChange={() => onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local", managedLocalModelId: model.id }))}
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
        <button type="button" className="settings-btn" disabled={actionRunning || hasCurrentRuntime} onClick={() => void onInstallModel(model.id)}>
          {actionRunning ? "Downloading..." : hasCurrentRuntime ? "Downloaded" : "Download"}
        </button>
        <button type="button" className="settings-btn" disabled={deleteDisabled} onClick={() => void onDeleteModel(model.id)}>
          Delete
        </button>
        <button type="button" className="settings-btn" disabled={startDisabled} onClick={() => void onStartModel(model.id)}>
          {status?.state === "running" && isSelected ? "Running" : "Start"}
        </button>
      </div>
    </article>
  );
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
