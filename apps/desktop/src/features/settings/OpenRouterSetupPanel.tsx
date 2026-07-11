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
            value={localAiSetup.openRouterApiKey}
            onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, provider: "openrouter_byok", openRouterApiKey: event.target.value }))}
            placeholder="sk-or-v1-..."
          />
        </label>
        <button type="button" className="settings-btn ai-setup-model-action" aria-label={t("settings.ai.chooseOpenRouterModelsAria")} onClick={onChooseModels}>{t("settings.ai.chooseModels")}</button>
      </div>
    </div>
  );
}
