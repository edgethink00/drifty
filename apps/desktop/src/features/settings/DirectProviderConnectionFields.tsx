import { analysisModelDisplayLabel } from "./analysisModelSetup";
import { useLocalization } from "../localization/LocalizationContext";

export type DirectProviderId = "openai" | "anthropic";

type DirectProviderConnectionFieldsProps = {
  readonly provider: DirectProviderId;
  readonly apiKey: string;
  readonly model: string;
  readonly defaultModel: string;
  readonly suggestions: readonly string[];
  /** Several panels can show the same provider, so each needs its own list id. */
  readonly datalistId: string;
  readonly groupAriaLabel: string;
  readonly onApiKeyChange: (value: string) => void;
  readonly onModelChange: (value: string) => void;
};

/** Key and model fields for a direct OpenAI or Anthropic connection. */
export function DirectProviderConnectionFields({
  provider,
  apiKey,
  model,
  defaultModel,
  suggestions,
  datalistId,
  groupAriaLabel,
  onApiKeyChange,
  onModelChange,
}: DirectProviderConnectionFieldsProps): JSX.Element {
  const { t } = useLocalization();
  const openai = provider === "openai";
  return (
    <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label={groupAriaLabel}>
      <ApiKeyField
        ariaLabel={t(openai ? "settings.intelligence.openAiApiKeyAria" : "settings.intelligence.anthropicApiKeyAria")}
        value={apiKey}
        placeholder={openai ? "sk-..." : "sk-ant-..."}
        onValueChange={onApiKeyChange}
      />
      <label className="ai-setup-field">
        <span>{t("settings.ai.model")}</span>
        <input
          className="settings-input"
          aria-label={t(openai ? "settings.intelligence.openAiModelIdAria" : "settings.intelligence.anthropicModelIdAria")}
          list={datalistId}
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          placeholder={defaultModel}
        />
        <datalist id={datalistId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion}>
              {analysisModelDisplayLabel(suggestion)}
            </option>
          ))}
        </datalist>
      </label>
      <p className="ai-setup-route-description">
        {t(openai ? "settings.intelligence.openAiDescription" : "settings.intelligence.anthropicDescription")}
      </p>
    </div>
  );
}

/** Shared API-key input for the direct-key providers: password field, autocomplete off. */
export function ApiKeyField({ ariaLabel, value, onValueChange, placeholder = "sk-..." }: {
  readonly ariaLabel: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
}): JSX.Element {
  const { t } = useLocalization();
  return (
    <label className="ai-setup-field">
      <span>{t("settings.intelligence.apiKey")}</span>
      <input
        className="settings-input"
        type="password"
        autoComplete="off"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
