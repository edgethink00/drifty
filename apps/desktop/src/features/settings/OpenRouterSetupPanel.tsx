import type { Dispatch, SetStateAction } from "react";

import type { LocalAiSetupState } from "./localAiSetup";
import { useLocalization } from "../localization/LocalizationContext";

type OpenRouterSetupPanelProps = {
  readonly localAiSetup: LocalAiSetupState;
  readonly onChooseModels: () => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
};

export function OpenRouterSetupPanel({
  localAiSetup,
  onChooseModels,
  onLocalAiSetupChange,
}: OpenRouterSetupPanelProps) {
  return <OpenRouterConnectionFields
    apiKey={localAiSetup.openRouterApiKey}
    onApiKeyChange={(openRouterApiKey) => onLocalAiSetupChange((current) => ({ ...current, provider: "openrouter_byok", openRouterApiKey }))}
    onChooseModels={onChooseModels}
  />;
}

/** Same fields for both tasks; callers keep provider and model routing independent. */
export function OpenRouterConnectionFields({ apiKey, onApiKeyChange, onChooseModels, description }: {
  readonly apiKey: string;
  readonly description?: string;
  readonly onApiKeyChange: (value: string) => void;
  readonly onChooseModels: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="ai-setup-detail" role="group" aria-label={t("settings.ai.openRouterSettingsAria")}>
      <div className="ai-setup-key-row">
        <label className="ai-setup-field">
          <span>{t("settings.ai.openRouterApiKey")}</span>
          <input
            className="settings-input"
            type="password"
            autoComplete="off"
            aria-label={t("settings.ai.openRouterApiKey")}
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="sk-or-v1-..."
          />
        </label>
        <button
          type="button"
          className="settings-btn ai-setup-model-action"
          aria-label={t("settings.ai.chooseOpenRouterModelsAria")}
          onClick={(event) => {
            // WebKit pointer clicks may leave focus on the preceding field.
            event.currentTarget.focus({ preventScroll: true });
            onChooseModels();
          }}
        >{t("settings.ai.chooseModels")}</button>
      </div>
      {description ? <p className="ai-setup-route-description">{description}</p> : null}
    </div>
  );
}
