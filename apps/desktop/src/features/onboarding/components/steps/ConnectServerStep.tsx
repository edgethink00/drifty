import type { ManagedLocalAiModel, ManagedLocalAiStatus } from "../../../settings/managedLocalAiClient";
import { OnboardingCustomEndpointSetup, type CustomEndpointDraft } from "../../OnboardingCustomEndpointSetup";
import { OnboardingManagedLocalAiSetup } from "../../OnboardingManagedLocalAiSetup";
import type { SetupChoice } from "../../onboardingFlow";

type ConnectServerStepProps = {
  readonly actionModelId: string | null;
  readonly apiKey: string;
  readonly apiKeyIsValid: boolean;
  readonly catalog: readonly ManagedLocalAiModel[];
  readonly customEndpointBaseUrlIssue: string | null;
  readonly customEndpointDraft: CustomEndpointDraft;
  readonly customEndpointModelIssue: string | null;
  readonly isByokSetup: boolean;
  readonly isCustomEndpointSetup: boolean;
  readonly loading: boolean;
  readonly setupChoice: SetupChoice | null;
  readonly status: ManagedLocalAiStatus | null;
  readonly onApiKeyChange: (value: string) => void;
  readonly onCustomEndpointDraftChange: (draft: CustomEndpointDraft) => void;
  readonly onInstallModel: (modelId: string) => void | Promise<void>;
};

export function ConnectServerStep({
  actionModelId,
  apiKey,
  apiKeyIsValid,
  catalog,
  customEndpointBaseUrlIssue,
  customEndpointDraft,
  customEndpointModelIssue,
  isByokSetup,
  isCustomEndpointSetup,
  loading,
  setupChoice,
  status,
  onApiKeyChange,
  onCustomEndpointDraftChange,
  onInstallModel,
}: ConnectServerStepProps) {
  return (
    <>
      <p className="onb-step-desc">
        {isByokSetup
          ? "Enter the OpenRouter key Drifty uses for focus insights. The key stays masked during setup."
          : isCustomEndpointSetup
            ? "Enter the OpenAI-compatible endpoint and model Drifty should use for minimized classification requests."
            : "Choose a managed local model. Drifty downloads it inside the app and keeps classification on this Mac."}
      </p>
      {setupChoice === "local_ai" ? (
        <OnboardingManagedLocalAiSetup
          actionModelId={actionModelId}
          catalog={catalog}
          loading={loading}
          status={status}
          onInstallModel={onInstallModel}
        />
      ) : isCustomEndpointSetup ? (
        <OnboardingCustomEndpointSetup
          draft={customEndpointDraft}
          baseUrlError={customEndpointDraft.baseUrl.trim() ? customEndpointBaseUrlIssue : null}
          modelError={customEndpointDraft.model.trim() ? customEndpointModelIssue : null}
          onDraftChange={onCustomEndpointDraftChange}
        />
      ) : (
        <div className="onb-server-form">
          <label className="onb-field">
            <span className="onb-field__label">OpenRouter API key</span>
            <span className="onb-secure-field">
              <input
                className={`onb-field__input onb-secure-field__input${
                  apiKey.trim() && !apiKeyIsValid ? " onb-field__input--invalid" : ""
                }`}
                type="password"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-or-..."
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                aria-label="OpenRouter API key"
                aria-invalid={apiKey.trim() && !apiKeyIsValid ? "true" : "false"}
              />
              <span className="onb-secure-field__mask" aria-hidden="true">Masked</span>
            </span>
            <span
              className={`onb-field__hint${
                apiKey.trim() && !apiKeyIsValid ? " onb-field__hint--error" : ""
              }`}
            >
              {apiKey.trim() && !apiKeyIsValid
                ? "OpenRouter key should start with sk-or-."
                : "Drifty never displays the raw key after you leave this field."}
            </span>
          </label>
        </div>
      )}
    </>
  );
}
