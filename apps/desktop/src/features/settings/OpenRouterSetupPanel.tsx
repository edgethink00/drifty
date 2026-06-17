import type { Dispatch, SetStateAction } from "react";

import { AiSetupConnectionTestRow } from "./AiSetupConnectionTestRow";
import type { LocalAiSetupState } from "./localAiSetup";

type OpenRouterSetupPanelProps = {
  readonly connectionTestMessage: string | null;
  readonly connectionTestRunning: boolean;
  readonly fallbackCount: number;
  readonly localAiSetup: LocalAiSetupState;
  readonly primaryModel: string;
  readonly onChooseModels: () => void;
  readonly onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>;
  readonly onTestConnection: () => void | Promise<void>;
};

export function OpenRouterSetupPanel({
  connectionTestMessage,
  connectionTestRunning,
  fallbackCount,
  localAiSetup,
  primaryModel,
  onChooseModels,
  onLocalAiSetupChange,
  onTestConnection,
}: OpenRouterSetupPanelProps) {
  const testDisabled = connectionTestRunning || !localAiSetup.openRouterApiKey.trim();

  return (
    <div className="ai-setup-detail" role="group" aria-label="OpenRouter BYOK settings">
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
      <div className="ai-setup-model-row">
        <div>
          <span className="chip green">Primary: {primaryModel}</span>
          {fallbackCount > 0 ? <span className="chip gray">{fallbackCount} fallback{fallbackCount === 1 ? "" : "s"}</span> : null}
        </div>
        <button type="button" className="settings-btn" aria-label="Choose OpenRouter models" onClick={onChooseModels}>Choose models</button>
      </div>
      <AiSetupConnectionTestRow
        buttonLabel={connectionTestRunning ? "Testing..." : "Test connection"}
        message={connectionTestMessage}
        providerLabel="OpenRouter"
        disabled={testDisabled}
        onTestConnection={onTestConnection}
      />
    </div>
  );
}
