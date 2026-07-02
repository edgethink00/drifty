import type { FormEvent } from "react";

export type AiModelOption = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly badges?: readonly string[];
};

type OpenRouterModelDialogProps = {
  readonly customModel: string;
  readonly openRouterPrimaryModel: string;
  readonly options: readonly AiModelOption[];
  readonly selectedModels: readonly string[];
  readonly onAddCustomModel: (event: FormEvent<HTMLFormElement>) => void;
  readonly onClose: () => void;
  readonly onCustomModelChange: (value: string) => void;
  readonly onPrimaryModelChange: (model: string) => void;
  readonly onToggleModel: (model: string, selected: boolean) => void;
};

export function OpenRouterModelDialog({
  customModel,
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
        <div className="model-picker-list" role="group" aria-label="OpenRouter model choices">
          {options.map((option) => {
            const isSelected = selectedModels.includes(option.id);
            const isPrimary = option.id === openRouterPrimaryModel;
            return (
              <div key={option.id} className="model-picker-choice" data-selected={isSelected ? "true" : "false"}>
                <label className="model-picker-choice__select">
                  <input type="checkbox" aria-label={`Select ${option.id}`} checked={isSelected} onChange={(event) => onToggleModel(option.id, event.target.checked)} />
                  <span className="model-picker-choice__body">
                    <span className="model-picker-choice__title">
                      <strong>{option.label}</strong>
                      {option.badges && option.badges.length > 0 ? (
                        <span className="model-picker-choice__badges">
                          {option.badges.map((badge) => <span key={badge} className={badge === "No ZDR" ? "chip warn" : "chip green"}>{badge}</span>)}
                        </span>
                      ) : null}
                    </span>
                    <small>{option.id}</small>
                    <small>{option.detail}</small>
                  </span>
                </label>
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
