export type CustomEndpointDraft = {
  readonly baseUrl: string;
  readonly model: string;
};

type OnboardingCustomEndpointSetupProps = {
  readonly draft: CustomEndpointDraft;
  readonly baseUrlError: string | null;
  readonly modelError: string | null;
  readonly onDraftChange: (draft: CustomEndpointDraft) => void;
};

export function OnboardingCustomEndpointSetup({
  draft,
  baseUrlError,
  modelError,
  onDraftChange,
}: OnboardingCustomEndpointSetupProps) {
  return (
    <div className="onb-server-form onb-server-form--custom-endpoint">
      <label className="onb-field">
        <span className="onb-field__label">Base URL</span>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          className={`onb-field__input${baseUrlError ? " onb-field__input--invalid" : ""}`}
          placeholder="http://localhost:11434/v1"
          spellCheck={false}
          value={draft.baseUrl}
          onChange={(event) => onDraftChange({ ...draft, baseUrl: event.target.value })}
          aria-invalid={baseUrlError ? "true" : "false"}
          aria-label="Custom endpoint base URL"
        />
        <span className={`onb-field__hint${baseUrlError ? " onb-field__hint--error" : ""}`}>
          {baseUrlError ?? "Use an OpenAI-compatible /v1 endpoint. Localhost works."}
        </span>
      </label>
      <label className="onb-field">
        <span className="onb-field__label">Model</span>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          className={`onb-field__input${modelError ? " onb-field__input--invalid" : ""}`}
          placeholder="llama3.2:latest"
          spellCheck={false}
          value={draft.model}
          onChange={(event) => onDraftChange({ ...draft, model: event.target.value })}
          aria-invalid={modelError ? "true" : "false"}
          aria-label="Custom endpoint model"
        />
        <span className={`onb-field__hint${modelError ? " onb-field__hint--error" : ""}`}>
          {modelError ?? "Enter the model id your endpoint exposes."}
        </span>
      </label>
    </div>
  );
}
