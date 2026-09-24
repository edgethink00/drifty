import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "../../../settings/managedLocalAiClient";
import { managedLocalAiProgressText } from "../../../settings/managedLocalAiProgressText";
import { managedModelRuntimeMemoryLabel } from "../../../settings/managedLocalAiMemory";
import { isManagedLocalReady } from "../../onboardingManagedLocalStatus";
import { useLocalModelSetupAnalytics } from "../../useLocalModelSetupAnalytics";
import type { SetupChoice } from "../../onboardingFlow";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { isLocalModelUnsupported, recommendedModelFit } from "../../localModelSetupAnalytics";
import { capturePostHogEvent } from "../../../../lib/analytics/posthogClient";
import { ManagedModelDownloadProgress } from "./ManagedModelDownloadProgress";
import { SpinnerIcon, SuccessIcon } from "./shared";
import { useLocalization, type LocalizationController } from "../../../localization/LocalizationContext";
import { localizedManagedModelDetail, localizedManagedModelFitDetail, localizedManagedModelTier } from "../../../localization/managedModelTranslations";
import { AiResourceNote } from "../../../settings/AiResourceNote";

const DEFAULT_LOCAL_MODEL_ID = "drifty-qwen3-5-4b-default";

export function ConnectServerStep({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const hideLocalCatalog = flow.setupChoice === "local_ai"
    && isLocalModelUnsupported(flow.managedLocalAi.catalog, flow.managedLocalAi.loading);
  return (
    <>
      {hideLocalCatalog ? null : (
        <p className="dc-onb-copy dc-onb-server-copy">{serverDescriptionForSetup(flow.setupChoice, t)}</p>
      )}
      {flow.setupChoice === "local_ai" ? <LocalAiSetup flow={flow} /> : null}
      {flow.isCustomEndpointSetup ? <CustomEndpointSetup flow={flow} /> : null}
      {flow.isByokSetup ? <ByokSetup flow={flow} /> : null}
    </>
  );
}

function LocalAiSetup({ flow }: { readonly flow: OnboardingFlow }) {
  const { t } = useLocalization();
  const status = flow.managedLocalAi.status;
  useLocalModelSetupAnalytics({ active: true, catalog: flow.managedLocalAi.catalog, status });
  const selectedModelId = flow.managedLocalAi.status?.selectedModelId
    ?? flow.managedLocalAi.actionModelId
    ?? flow.managedLocalAi.catalog.find((model) => model.recommended)?.id
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

  if (showLocalModelUnsupportedNotice(flow)) {
    return (
      <div className="dc-onb-local">
        <div className="dc-onb-local-unsupported" role="status">
          <strong>{t("onboarding.connection.localModelUnsupportedTitle")}</strong>
          <p>{t("onboarding.connection.localModelUnsupportedBody")}</p>
          <button
            type="button"
            className="dc-onb-secondary-button"
            onClick={() => {
              capturePostHogEvent("local_model_setup", {
                phase: "switched_to_cloud",
                any_installable: false,
                recommended_fit: recommendedModelFit(flow.managedLocalAi.catalog),
              });
              flow.handleSetupChoice("simple");
            }}
          >
            {t("onboarding.connection.switchToCloud")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dc-onb-local">
      <AiResourceNote route="local" />
      {statusBusy || statusReady || status?.state === "error" ? <div className={statusReady ? "dc-onb-status dc-onb-status--ready" : "dc-onb-status"} role="status">
        {statusBusy ? <SpinnerIcon /> : statusReady ? <SuccessIcon /> : null}
        {statusMessage}
      </div> : null}
      <ManagedModelDownloadProgress status={status} />
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
        {!ready && model.fitDetail && model.fit !== "good" ? <p className="dc-onb-local-card__fit-note">{localizedManagedModelFitDetail(model, effectiveLanguage, t)}</p> : null}
      </div>
      <dl className="dc-onb-local-card__meta">
        <div>
          <dt>{t("onboarding.connection.download")}</dt>
          <dd>{model.downloadSize}</dd>
        </div>
        {runtimeMemoryLabel ? (
          <div>
            <dt>{t(status?.selectedModelId === model.id && status.state === "running" && (status.memoryUsageBytes ?? 0) > 0 ? "onboarding.connection.ram" : "ai.resources.estimatedRam")}</dt>
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
  // Numbers live on the progress bar now, so the status line stays a sentence —
  // and a localized one, which the backend's own message is not.
  if (status?.state === "installing") return t("onboarding.connection.downloading");
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
  ready,
  t,
}: {
  readonly failed: boolean;
  readonly installing: boolean;
  readonly ready: boolean;
  readonly t: LocalizationController["t"];
}): string {
  if (ready) return t("onboarding.connection.ready");
  if (failed) return t("onboarding.connection.retry");
  // The button says which model is being fetched; the progress bar above owns
  // the number. Repeating the percentage in both made the card argue with
  // itself over the same value.
  if (installing) return t("onboarding.connection.downloading");
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
        <span>{t("onboarding.connection.customApiKey")}</span>
        <input
          className="dc-onb-input dc-onb-input--mono"
          type="password"
          value={flow.customEndpointApiKey}
          onChange={(event) => flow.handleCustomEndpointApiKeyChange(event.target.value)}
          placeholder="sk-..."
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label={t("onboarding.connection.customApiKeyAria")}
        />
        <span className="dc-onb-input-hint">{t("onboarding.connection.customApiKeyHint")}</span>
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

function showLocalModelUnsupportedNotice(flow: OnboardingFlow): boolean {
  return isLocalModelUnsupported(flow.managedLocalAi.catalog, flow.managedLocalAi.loading);
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
