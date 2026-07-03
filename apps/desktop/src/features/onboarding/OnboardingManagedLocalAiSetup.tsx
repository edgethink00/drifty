import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "../settings/managedLocalAiClient";
import { managedModelRuntimeMemoryLabel } from "../settings/managedLocalAiMemory";

type OnboardingManagedLocalAiSetupProps = {
  readonly actionModelId: string | null;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly loading: boolean;
  readonly status: ManagedLocalAiStatus | null;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
};

export function OnboardingManagedLocalAiSetup({
  actionModelId,
  catalog,
  loading,
  status,
  onInstallModel,
}: OnboardingManagedLocalAiSetupProps) {
  const statusMessage = status?.message
    ?? (loading ? "Looking for downloaded local models..." : "Choose a local model and Drifty will download it inside the app.");

  return (
    <div className="onb-managed-local-ai">
      <div className="onb-managed-local-ai__status" role="status">
        {statusMessage}
      </div>
      <div className="onb-managed-local-ai__models" aria-label="Local AI model choices">
        {catalog.map((model) => (
          <OnboardingManagedLocalAiModel
            key={model.id}
            actionModelId={actionModelId}
            loading={loading}
            model={model}
            status={status}
            onInstallModel={onInstallModel}
          />
        ))}
      </div>
    </div>
  );
}

function OnboardingManagedLocalAiModel({
  actionModelId,
  loading,
  model,
  status,
  onInstallModel,
}: {
  readonly actionModelId: string | null;
  readonly loading: boolean;
  readonly model: ManagedLocalAiModel;
  readonly status: ManagedLocalAiStatus | null;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
}) {
  const ready = isReadyManagedModel(model.id, status);
  const installing = status?.selectedModelId === model.id && status.state === "installing";
  const failed = status?.selectedModelId === model.id && status.state === "error";
  const busy = actionModelId === model.id || installing;
  const runtimeMemoryLabel = managedModelRuntimeMemoryLabel(model, status);
  const unsupported = model.fit === "insufficient";
  const actionDisabled = unsupported || ready || (loading && status === null) || Boolean(actionModelId) || status?.state === "installing" || status?.state === "starting";

  return (
    <article className={`onb-managed-model${ready ? " is-ready" : ""}${unsupported ? " is-unsupported" : ""}`} aria-label={`${model.label} local AI model`}>
      <div className="onb-managed-model__copy">
        <strong>{model.label}</strong>
        <span>{model.recommended ? (model.fit ? "Recommended for your Mac" : "Recommended") : model.tier}</span>
        <p>{ready ? "Ready for private local classification." : model.detail}</p>
        {!ready && model.fitDetail ? <p className="onb-managed-model__fit-note">{model.fitDetail}</p> : null}
      </div>
      <dl className="onb-managed-model__facts">
        <div><dt>Download</dt><dd>{model.downloadSize}</dd></div>
        {runtimeMemoryLabel ? <div><dt>RAM while running</dt><dd>{runtimeMemoryLabel}</dd></div> : null}
      </dl>
      <button
        type="button"
        className="onb-button onb-button--ghost onb-managed-model__action"
        disabled={actionDisabled}
        onClick={() => void onInstallModel(model.id)}
      >
        {managedModelActionLabel(ready, busy, failed, status?.progress?.percent ?? null)}
      </button>
    </article>
  );
}

function isReadyManagedModel(modelId: string, status: ManagedLocalAiStatus | null): boolean {
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

function managedModelActionLabel(ready: boolean, busy: boolean, failed: boolean, percent: number | null): string {
  if (ready) return "Ready";
  if (busy) return percent === null ? "Downloading..." : `Downloading ${percent.toFixed(0)}%`;
  if (failed) return "Retry";
  return "Download";
}

class OnboardingManagedLocalAiError extends Error {
  constructor(readonly state: string) {
    super(`Unhandled managed local AI state: ${state}`);
    this.name = "OnboardingManagedLocalAiError";
  }
}

function assertNever(value: never): never {
  throw new OnboardingManagedLocalAiError(String(value));
}
