import type { FormEvent } from "react";
import { useLocalization } from "../localization/LocalizationContext";

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
  const { t } = useLocalization();
  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal model-picker-modal" role="dialog" aria-modal="true" aria-labelledby="openrouter-model-picker-title" onClick={(event) => event.stopPropagation()}>
        <div className="auth-modal__header">
          <h2 id="openrouter-model-picker-title">{t("settings.ai.openRouterModels")}</h2>
          <p>{t("settings.ai.openRouterModelsDescription")}</p>
        </div>
        <div className="model-picker-list" role="group" aria-label={t("settings.ai.openRouterModelChoicesAria")}>
          {options.map((option) => {
            const isSelected = selectedModels.includes(option.id);
            const isPrimary = option.id === openRouterPrimaryModel;
            return (
              <div key={option.id} className="model-picker-choice" data-selected={isSelected ? "true" : "false"}>
                <label className="model-picker-choice__select">
                  <input type="checkbox" aria-label={t("settings.ai.selectModelAria", { model: option.id })} checked={isSelected} onChange={(event) => onToggleModel(option.id, event.target.checked)} />
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
                  <input type="radio" name="openrouter-primary-model" aria-label={t("settings.ai.usePrimaryAria", { model: option.id })} checked={isPrimary} disabled={!isSelected} onChange={() => onPrimaryModelChange(option.id)} />
                  <span>{t("settings.ai.primary")}</span>
                </label>
              </div>
            );
          })}
        </div>
        <form className="model-picker-custom" onSubmit={onAddCustomModel}>
          <label htmlFor="openrouter-custom-model">{t("settings.ai.otherModel")}</label>
          <div>
            <input id="openrouter-custom-model" className="settings-input" aria-label={t("settings.ai.otherOpenRouterModelAria")} value={customModel} onChange={(event) => onCustomModelChange(event.target.value)} placeholder="provider/model-name" />
            <button type="submit" className="settings-btn">{t("settings.ai.addModel")}</button>
          </div>
        </form>
        <button type="button" className="settings-btn auth-modal__close" onClick={onClose}>{t("settings.ai.close")}</button>
      </section>
    </div>
  );
}
