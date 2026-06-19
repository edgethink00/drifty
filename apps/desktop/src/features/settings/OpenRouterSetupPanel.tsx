import type { Dispatch, SetStateAction } from "react";

import type { LocalAiSetupState } from "./localAiSetup";

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
  return (
    <div className="ai-setup-detail" role="group" aria-label="OpenRouter BYOK settings">
      <div className="ai-setup-key-row">
        <label className="ai-setup-field">
          <span>OpenRouter API key</span>
          <input
            className="settings-input"
            type="password"
            autoComplete="off"
            aria-label="OpenRouter API key"
            value={localAiSetup.openRouterApiKey}
            onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, provider: "openrouter_byok", openRouterApiKey: event.target.value }))}
            placeholder="sk-or-v1-..."
          />
        </label>
        <button type="button" className="settings-btn ai-setup-model-action" aria-label="Choose OpenRouter models" onClick={onChooseModels}>Choose models</button>
      </div>
    </div>
  );
}
