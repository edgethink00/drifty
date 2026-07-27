import { ANALYSIS_RECOMMENDED_MODELS, DEFAULT_ANALYSIS_MODEL } from "./analysisModelSetup";
import type { AnalysisAiSetupState, AnalysisProvider } from "./analysisModelSetup";

export interface AnalysisModelSectionProps {
  readonly setup: AnalysisAiSetupState;
  readonly onChange: (next: AnalysisAiSetupState) => void;
  readonly onConnectOpenRouter: () => void;
  readonly openRouterConnected: boolean;
  readonly connecting?: boolean;
}

const PROVIDER_OPTIONS: readonly { readonly value: AnalysisProvider; readonly label: string }[] = [
  { value: "cloud", label: "Drifty Cloud" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "self_hosted", label: "Custom endpoint" },
];

const ANALYSIS_MODEL_DATALIST_ID = "analysis-model-options";

export function AnalysisModelSection({
  setup,
  onChange,
  onConnectOpenRouter,
  openRouterConnected,
  connecting = false,
}: AnalysisModelSectionProps) {
  const handleProviderChange = (provider: AnalysisProvider) => {
    if (provider === setup.provider) return;
    onChange({ ...setup, provider });
  };

  const connectLabel = connecting ? "Connecting..." : openRouterConnected ? "Connected" : "Connect OpenRouter";

  return (
    <div className="settings-section settings-section--analysis-model">
      <div className="settings-block">
        <h3>Analysis model</h3>

        <div className="settings-row">
          <div>
            <div className="lbl">Project analysis model</div>
            <div className="desc">
              The project pass groups your day into projects with a heavier read over your activity, so it needs a strong model. This is separate from the small model that labels each live segment.
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="lbl">Provider</div>
            <div className="desc">Choose where the analysis model runs.</div>
          </div>
          <div className="ctrl">
            <div className="settings-mode-switch" role="radiogroup" aria-label="Analysis model provider">
              {PROVIDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`settings-mode-option${setup.provider === option.value ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={setup.provider === option.value}
                  onClick={() => handleProviderChange(option.value)}
                >
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {setup.provider === "cloud" ? (
          <div className="settings-row">
            <div>
              <div className="lbl">Drifty Cloud</div>
              <div className="desc">Drifty Cloud provides the analysis model. No configuration needed.</div>
            </div>
          </div>
        ) : null}

        {setup.provider === "openrouter" ? (
          <div className="settings-row settings-row--stacked-action" role="group" aria-label="OpenRouter analysis model settings">
            <div>
              <div className="lbl">OpenRouter model</div>
              <div className="desc">Pick a recommended model or type any OpenRouter model id. Connecting provisions a scoped key with a browser sign-in — your key is never shown here.</div>
              <label className="ai-setup-field">
                <span>Model</span>
                <input
                  className="settings-input"
                  aria-label="Analysis model"
                  list={ANALYSIS_MODEL_DATALIST_ID}
                  value={setup.openRouterModel}
                  onChange={(event) => onChange({ ...setup, openRouterModel: event.target.value })}
                  placeholder={DEFAULT_ANALYSIS_MODEL}
                />
                <datalist id={ANALYSIS_MODEL_DATALIST_ID}>
                  {ANALYSIS_RECOMMENDED_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </datalist>
              </label>
            </div>
            <div className="ctrl">
              <button type="button" className="settings-btn" onClick={onConnectOpenRouter} disabled={connecting}>
                {connectLabel}
              </button>
            </div>
          </div>
        ) : null}

        {setup.provider === "self_hosted" ? (
          <div className="settings-row settings-row--stacked-action" role="group" aria-label="Custom endpoint analysis model settings">
            <div>
              <div className="lbl">Custom endpoint</div>
              <div className="desc">OpenAI-compatible endpoint that serves a strong analysis model.</div>
              <label className="ai-setup-field">
                <span>Base URL</span>
                <input
                  className="settings-input"
                  aria-label="Analysis endpoint base URL"
                  value={setup.selfHostedBaseUrl}
                  onChange={(event) => onChange({ ...setup, selfHostedBaseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label className="ai-setup-field">
                <span>Model</span>
                <input
                  className="settings-input"
                  aria-label="Analysis endpoint model"
                  value={setup.selfHostedModel}
                  onChange={(event) => onChange({ ...setup, selfHostedModel: event.target.value })}
                  placeholder="gpt-5-mini"
                />
              </label>
              <label className="ai-setup-field">
                <span>API key (optional)</span>
                <input
                  className="settings-input"
                  type="password"
                  autoComplete="off"
                  aria-label="Analysis endpoint API key"
                  value={setup.selfHostedApiKey}
                  onChange={(event) => onChange({ ...setup, selfHostedApiKey: event.target.value })}
                  placeholder="sk-..."
                />
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
