import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "../../../settings/managedLocalAiClient";
import { managedLocalAiProgressText } from "../../../settings/managedLocalAiProgressText";
import { managedModelRuntimeMemoryLabel } from "../../../settings/managedLocalAiMemory";
import { isManagedLocalReady } from "../../onboardingManagedLocalStatus";
import type { SetupChoice } from "../../onboardingFlow";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { SpinnerIcon, SuccessIcon } from "./shared";
import { useLocalization, type LocalizationController } from "../../../localization/LocalizationContext";
import { localizedManagedModelDetail, localizedManagedModelFitDetail, localizedManagedModelTier } from "../../../localization/managedModelTranslations";

const DEFAULT_LOCAL_MODEL_ID = "drifty-qwen3-5-4b-default";

export function ConnectServerStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  return (
    <>
      <p className="dc-onb-copy dc-onb-server-copy">{serverDescriptionForSetup(flow.setupChoice, t)}</p>
      {flow.setupChoice === "local_ai" ? <LocalAiSetup flow={flow} /> : null}
      {flow.isCustomEndpointSetup ? <CustomEndpointSetup flow={flow} /> : null}
      {flow.isByokSetup ? <ByokSetup flow={flow} /> : null}
    </>
  );
}

function LocalAiSetup({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const status = flow.managedLocalAi.status;
  const selectedModelId = flow.managedLocalAi.status?.selectedModelId
    ?? flow.managedLocalAi.actionModelId
    ?? DEFAULT_LOCAL_MODEL_ID;
  const statusReady = isManagedLocalReady(status);
  const statusBusy = !statusReady && (
    (flow.managedLocalAi.loading && status === null)
    || (Boolean(flow.managedLocalAi.actionModelId) && status?.state !== "error")
    || status?.state === "installing"
    || status?.state === "starting"
  );
  const statusMessage = statusReady
    ? t("onboarding.connection.modelReady")
    : localModelStatusMessage(flow.managedLocalAi.loading, status, t);

  return (
    <div className="dc-onb-local">
      <div className={statusReady ? "dc-onb-status dc-onb-status--ready" : "dc-onb-status"} role="status">
        {statusBusy ? <SpinnerIcon /> : statusReady ? <SuccessIcon /> : null}
        {statusMessage}
      </div>
      <div className="dc-onb-local__cards">
        {flow.managedLocalAi.catalog.map((model) => (
          <LocalModelCard
            key={model.id}
            model={model}
            selected={selectedModelId === model.id}
            flow={flow}
          />
        ))}
      </div>
    </div>
  );
}

function LocalModelCard({
  flow,
  model,
  selected,
}: {
  readonly flow: OnboardingFlow;
  readonly model: ManagedLocalAiModel;
  readonly selected: boolean;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const status = flow.managedLocalAi.status;
  const runtimeMemoryLabel = managedModelRuntimeMemoryLabel(model, status);
  const unsupported = model.fit === "insufficient";
  const installingThisModel = flow.managedLocalAi.actionModelId === model.id
    || (status?.state === "installing" && status.selectedModelId === model.id);
  const failedThisModel = status?.state === "error" && status.selectedModelId === model.id;
  const ready = localModelIsReady(model.id, status);
  const disabled = unsupported
    || ready
    || (flow.managedLocalAi.loading && status === null)
    || Boolean(flow.managedLocalAi.actionModelId)
    || status?.state === "installing"
    || status?.state === "starting";
  const actionLabel = localModelActionLabel({
    failed: failedThisModel,
    installing: installingThisModel,
    progress: installingThisModel ? status?.progress ?? null : null,
    ready,
    t,
  });
  const description = localModelDescription({
    defaultDescription: localizedManagedModelDetail(model, effectiveLanguage, t),
    failed: failedThisModel,
    installing: installingThisModel,
    ready,
    status,
    t,
  });

  return (
    <article
      className={`dc-onb-local-card${selected ? " dc-onb-local-card--selected" : ""}${unsupported ? " dc-onb-local-card--unsupported" : ""}`}
      aria-label={t("onboarding.connection.localModelAria", { model: model.label })}
    >
      <div className="dc-onb-local-card__copy">
        <div className="dc-onb-local-card__title-line">
          <strong>{model.label}</strong>
          <span className={model.recommended ? "dc-onb-local-card__tier dc-onb-local-card__tier--recommended" : "dc-onb-local-card__tier"}>
            {model.recommended ? (model.fit ? t("onboarding.connection.recommendedForMac") : t("common.recommended")) : localizedManagedModelTier(model.tier, effectiveLanguage, t)}
          </span>
        </div>
        <p>{description}</p>
        {!ready && model.fitDetail ? <p className="dc-onb-local-card__fit-note">{localizedManagedModelFitDetail(model, effectiveLanguage, t)}</p> : null}
      </div>
      <dl className="dc-onb-local-card__meta">
        <div>
          <dt>{t("onboarding.connection.download")}</dt>
          <dd>{model.downloadSize}</dd>
        </div>
        {runtimeMemoryLabel ? (
          <div>
            <dt>{t("onboarding.connection.ram")}</dt>
            <dd>{runtimeMemoryLabel}</dd>
          </div>
        ) : null}
      </dl>
      <button
        type="button"
        className="dc-onb-secondary-button"
        disabled={disabled}
        onClick={() => void flow.managedLocalAi.installModel(model.id)}
      >
        {actionLabel}
      </button>
    </article>
  );
}

function localModelStatusMessage(loading: boolean, status: ManagedLocalAiStatus | null, t: LocalizationController["t"]): string {
  const progressText = managedLocalAiProgressText(status?.progress ?? null);
  if (status?.progress && progressText) return `${t("onboarding.connection.downloadingPercent", { percent: status.progress.percent.toFixed(0) })} · ${progressText}`;
  if (status) return status.message;
  return loading ? t("onboarding.connection.looking") : t("onboarding.connection.chooseModel");
}

function localModelIsReady(modelId: string, status: ManagedLocalAiStatus | null): boolean {
  if (status?.selectedModelId !== modelId) return false;
  return status.state === "installed" || status.state === "starting" || status.state === "running";
}

function localModelActionLabel({
  failed,
  installing,
  progress,
  ready,
  t,
}: {
  readonly failed: boolean;
  readonly installing: boolean;
  readonly progress: ManagedLocalAiStatus["progress"];
  readonly ready: boolean;
  readonly t: LocalizationController["t"];
}): string {
  if (ready) return t("onboarding.connection.ready");
  if (failed) return t("onboarding.connection.retry");
  if (installing) return progress === null ? t("onboarding.connection.downloading") : t("onboarding.connection.downloadingPercent", { percent: progress.percent.toFixed(0) });
  return t("onboarding.connection.download");
}

function localModelDescription({
  defaultDescription,
  failed,
  installing,
  ready,
  status,
  t,
}: {
  readonly defaultDescription: string;
  readonly failed: boolean;
  readonly installing: boolean;
  readonly ready: boolean;
  readonly status: ManagedLocalAiStatus | null;
  readonly t: LocalizationController["t"];
}): string {
  if (ready) return t("onboarding.connection.readyDescription");
  if ((installing || failed) && status?.message) return status.message;
  return defaultDescription;
}

function CustomEndpointSetup({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const baseIssue = flow.customEndpointDraft.baseUrl.trim() ? flow.customEndpointBaseUrlIssue : null;
  const modelIssue = flow.customEndpointDraft.model.trim() ? flow.customEndpointModelIssue : null;

  return (
    <div className="dc-onb-server-form">
      <label className="dc-onb-labeled-input">
        <span>{t("onboarding.connection.baseUrl")}</span>
        <input
          className={baseIssue ? "dc-onb-input dc-onb-input--invalid dc-onb-input--mono" : "dc-onb-input dc-onb-input--mono"}
          value={flow.customEndpointDraft.baseUrl}
          onChange={(event) => flow.handleCustomEndpointDraftChange({ ...flow.customEndpointDraft, baseUrl: event.target.value })}
          placeholder="http://localhost:11434/v1"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={baseIssue ? "true" : "false"}
          aria-label={t("onboarding.connection.baseUrlAria")}
        />
        <span className={baseIssue ? "dc-onb-input-hint dc-onb-input-hint--error" : "dc-onb-input-hint"}>
          {baseIssue ?? t("onboarding.connection.baseUrlHint")}
        </span>
      </label>
      <label className="dc-onb-labeled-input">
        <span>{t("onboarding.connection.model")}</span>
        <input
          className={modelIssue ? "dc-onb-input dc-onb-input--invalid dc-onb-input--mono" : "dc-onb-input dc-onb-input--mono"}
          value={flow.customEndpointDraft.model}
          onChange={(event) => flow.handleCustomEndpointDraftChange({ ...flow.customEndpointDraft, model: event.target.value })}
          placeholder="llama3.2:latest"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={modelIssue ? "true" : "false"}
          aria-label={t("onboarding.connection.modelAria")}
        />
        <span className={modelIssue ? "dc-onb-input-hint dc-onb-input-hint--error" : "dc-onb-input-hint"}>
          {modelIssue ?? t("onboarding.connection.modelHint")}
        </span>
      </label>
    </div>
  );
}

function ByokSetup({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const apiInvalid = flow.apiKey.trim().length > 0 && !flow.apiKeyIsValid;

  return (
    <div className="dc-onb-server-form dc-onb-server-form--compact">
      <label className="dc-onb-labeled-input">
        <span>{t("onboarding.connection.apiKey")}</span>
        <input
          className={apiInvalid ? "dc-onb-input dc-onb-input--invalid dc-onb-input--mono" : "dc-onb-input dc-onb-input--mono"}
          type="password"
          value={flow.apiKey}
          onChange={(event) => flow.handleApiKeyChange(event.target.value)}
          placeholder="sk-or-..."
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={apiInvalid ? "true" : "false"}
          aria-label={t("onboarding.connection.apiKey")}
        />
        <span className={apiInvalid ? "dc-onb-input-hint dc-onb-input-hint--error" : "dc-onb-input-hint"}>
          {apiInvalid ? t("onboarding.connection.invalidKey") : t("onboarding.connection.maskedKey")}
        </span>
      </label>
    </div>
  );
}

function serverDescriptionForSetup(setupChoice: SetupChoice | null, t: LocalizationController["t"]): string {
  if (setupChoice === "byok") {
    return t("onboarding.connection.byokDescription");
  }
  if (setupChoice === "custom_endpoint") {
    return t("onboarding.connection.customDescription");
  }
  return t("onboarding.connection.localDescription");
}
