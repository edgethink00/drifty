import type { Dispatch, SetStateAction } from "react";

import type { LocalAiSetupState } from "./localAiSetup";

type CustomEndpointSetupPanelProps = {
  readonly localAiSetup: LocalAiSetupState;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
};

export function CustomEndpointSetupPanel({
  localAiSetup,
  onLocalAiSetupChange,
}: CustomEndpointSetupPanelProps) {
  return (
    <div className="ai-setup-detail ai-setup-detail--custom" role="group" aria-label="Custom endpoint settings">
      <div className="ai-setup-custom-endpoint__header">
        <strong>Custom endpoint</strong>
        <span>OpenAI-compatible local or hosted endpoint</span>
      </div>
      <label className="ai-setup-field">
        <span>Base URL</span>
        <input
          className="settings-input"
          aria-label="Custom endpoint base URL"
          value={localAiSetup.selfHostedBaseUrl}
          onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedBaseUrl: event.target.value }))}
          placeholder="http://localhost:11434/v1"
        />
      </label>
      <label className="ai-setup-field">
        <span>Model</span>
        <input
          className="settings-input"
          aria-label="Custom endpoint model"
          value={localAiSetup.selfHostedModel}
          onChange={(event) => onLocalAiSetupChange((current) => ({ ...current, provider: "self_hosted", selfHostedModel: event.target.value }))}
          placeholder="llama3.2"
        />
      </label>
    </div>
  );
}
