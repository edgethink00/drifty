import { useState } from "react";
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
  const isSelected = selectable && localAiSetup.provider === "managed_local" && localAiSetup.managedLocalModelId === model.id;
  const hasCurrentRuntime = isSelected && (status?.state === "installed" || status?.state === "running");
  const actionRunning = actionModelId === model.id;
  const showInFinderDisabled = actionRunning || finderOpening || !status?.artifactDir;

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
        onChange={() => onLocalAiSetupChange((current) => ({ ...current, provider: "managed_local", managedLocalModelId: model.id }))}
      />
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
          <div><dt>Memory</dt><dd>{model.minimumMemory}</dd></div>
        </dl>
      </div>
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
              disabled={actionRunning}
              title="Delete model"
              onClick={() => void onDeleteModel(model.id)}
            >
              <ManagedModelActionIcon icon="delete" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="settings-btn ai-managed-model__primary-action"
            disabled={actionRunning}
            onClick={() => void onInstallModel(model.id)}
          >
            <ManagedModelActionIcon icon="download" />
            <span>{actionRunning ? "Downloading..." : "Download"}</span>
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

function ManagedModelActionIcon({ icon }: { readonly icon: "download" | "finder" | "delete" }) {
  switch (icon) {
    case "download":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M10 3.5v8" />
          <path d="M6.8 8.6 10 11.8l3.2-3.2" />
          <path d="M4.5 14.5h11" />
        </svg>
      );
    case "finder":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M4.2 5.4h4.2l1.3 1.4h6.1v7.8H4.2z" />
          <path d="M4.2 8.2h11.6" />
        </svg>
      );
    case "delete":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M6.2 7.3h7.6" />
          <path d="M8.2 7.3V5.5h3.6v1.8" />
          <path d="M7.1 9.2v5.1M10 9.2v5.1M12.9 9.2v5.1" />
          <path d="M6.8 7.3 7.5 16h5l0.7-8.7" />
        </svg>
      );
    default:
      return assertNever(icon);
  }
}

function messageFromFinderError(error: unknown): string {
  return error instanceof Error && error.message ? `Finder unavailable: ${error.message}` : "Finder unavailable.";
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
