import type { Dispatch, SetStateAction } from "react";

import type { LocalAiSetupState } from "./localAiSetup";
import { useLocalization } from "../localization/LocalizationContext";

type CustomEndpointSetupPanelProps = {
  readonly localAiSetup: LocalAiSetupState;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
};

export function CustomEndpointSetupPanel({
  localAiSetup,
  onLocalAiSetupChange,
}: CustomEndpointSetupPanelProps) {
  const { t } = useLocalization();
  return (
    <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label={t("settings.ai.customEndpointSettingsAria")}>
      <div className="ai-setup-custom-endpoint__header">
        <strong>{t("settings.ai.customEndpoint")}</strong>
        <span>{t("settings.ai.customEndpointDescription")}</span>
      </div>
      <label className="ai-setup-field">
        <span>{t("settings.ai.baseUrl")}</span>
        <input
          className="settings-input"
          aria-label={t("settings.ai.customEndpointBaseUrlAria")}
          value={localAiSetup.selfHostedBaseUrl}
          onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedBaseUrl: event.target.value }))}
          placeholder="http://localhost:11434/v1"
        />
      </label>
      <label className="ai-setup-field">
        <span>{t("settings.ai.model")}</span>
        <input
          className="settings-input"
          aria-label={t("settings.ai.customEndpointModelAria")}
          value={localAiSetup.selfHostedModel}
          onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedModel: event.target.value }))}
          placeholder="llama3.2"
        />
      </label>
    </div>
  );
}
