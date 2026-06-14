import type { FormEvent } from "react";

export type AiModelOption = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly badge?: string;
};

type OpenRouterModelDialogProps = {
  readonly customModel: string;
  readonly fallbackSummary: string;
  readonly openRouterPrimaryModel: string;
  readonly options: readonly AiModelOption[];
  readonly selectedModels: readonly string[];
  readonly onAddCustomModel: (event: FormEvent<HTMLFormElement>) => void;
  readonly onClose: () => void;
  readonly onCustomModelChange: (value: string) => void;
  readonly onPrimaryModelChange: (model: string) => void;
  readonly onToggleModel: (model: string, selected: boolean) => void;
};

type SelfHostedModelDialogProps = {
  readonly customModel: string;
  readonly modelSummary: string;
  readonly options: readonly AiModelOption[];
  readonly selectedModel: string;
  readonly onAddCustomModel: (event: FormEvent<HTMLFormElement>) => void;
  readonly onClose: () => void;
  readonly onCustomModelChange: (value: string) => void;
  readonly onModelChange: (model: string) => void;
};

export function OpenRouterModelDialog({
  customModel,
  fallbackSummary,
  openRouterPrimaryModel,
  options,
  selectedModels,
  onAddCustomModel,
  onClose,
  onCustomModelChange,
  onPrimaryModelChange,
  onToggleModel,
}: OpenRouterModelDialogProps) {
  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal model-picker-modal" role="dialog" aria-modal="true" aria-labelledby="openrouter-model-picker-title" onClick={(event) => event.stopPropagation()}>
        <div className="auth-modal__header">
          <h2 id="openrouter-model-picker-title">OpenRouter models</h2>
          <p>Drifty sends models in priority order. Your API key stays session-only.</p>
        </div>
        <div className="model-picker-modal__summary" aria-label="Selected OpenRouter model summary">
          <span className="chip green">Primary: {openRouterPrimaryModel}</span>
          <span className="chip gray">{fallbackSummary}</span>
        </div>
        <div className="model-picker-list" role="group" aria-label="OpenRouter model choices">
          {options.map((option) => {
            const isSelected = selectedModels.includes(option.id);
            const isPrimary = option.id === openRouterPrimaryModel;
            return (
              <div key={option.id} className="model-picker-choice" data-selected={isSelected ? "true" : "false"}>
                <label className="model-picker-choice__select">
                  <input type="checkbox" aria-label={`Select ${option.id}`} checked={isSelected} onChange={(event) => onToggleModel(option.id, event.target.checked)} />
                  <span><strong>{option.label}</strong><small>{option.id}</small><small>{option.detail}</small></span>
                </label>
                {option.badge ? <span className="chip green">{option.badge}</span> : null}
                <label className="model-picker-choice__primary">
                  <input type="radio" name="openrouter-primary-model" aria-label={`Use ${option.id} as primary`} checked={isPrimary} disabled={!isSelected} onChange={() => onPrimaryModelChange(option.id)} />
                  <span>Primary</span>
                </label>
              </div>
            );
          })}
        </div>
        <form className="model-picker-custom" onSubmit={onAddCustomModel}>
          <label htmlFor="openrouter-custom-model">Other model</label>
          <div>
            <input id="openrouter-custom-model" className="settings-input" aria-label="Other OpenRouter model" value={customModel} onChange={(event) => onCustomModelChange(event.target.value)} placeholder="provider/model-name" />
            <button type="submit" className="settings-btn">Add model</button>
          </div>
        </form>
        <button type="button" className="settings-btn auth-modal__close" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}

export function SelfHostedModelDialog({
  customModel,
  modelSummary,
  options,
  selectedModel,
  onAddCustomModel,
  onClose,
  onCustomModelChange,
  onModelChange,
}: SelfHostedModelDialogProps) {
  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal model-picker-modal" role="dialog" aria-modal="true" aria-labelledby="self-hosted-model-picker-title" onClick={(event) => event.stopPropagation()}>
        <div className="auth-modal__header">
          <h2 id="self-hosted-model-picker-title">Self-hosted model</h2>
          <p>Pick a common local model or enter the exact model ID returned by your endpoint.</p>
        </div>
        <div className="model-picker-modal__summary" aria-label="Selected self-hosted model summary">
          <span className={selectedModel ? "chip green" : "chip gray"}>{modelSummary}</span>
        </div>
        <div className="model-picker-list" role="radiogroup" aria-label="Self-hosted model choices">
          {options.map((option) => {
            const isSelected = option.id === selectedModel;
            return (
              <div key={option.id} className="model-picker-choice model-picker-choice--single" data-selected={isSelected ? "true" : "false"}>
                <label className="model-picker-choice__select">
                  <input type="radio" name="self-hosted-model" aria-label={`Use ${option.id}`} checked={isSelected} onChange={() => onModelChange(option.id)} />
                  <span><strong>{option.label}</strong><small>{option.id}</small><small>{option.detail}</small></span>
                </label>
              </div>
            );
          })}
        </div>
        <form className="model-picker-custom" onSubmit={onAddCustomModel}>
          <label htmlFor="self-hosted-custom-model">Other model</label>
          <div>
            <input id="self-hosted-custom-model" className="settings-input" aria-label="Other self-hosted model" value={customModel} onChange={(event) => onCustomModelChange(event.target.value)} placeholder="model-name" />
            <button type="submit" className="settings-btn">Use model</button>
          </div>
        </form>
        <button type="button" className="settings-btn auth-modal__close" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}
