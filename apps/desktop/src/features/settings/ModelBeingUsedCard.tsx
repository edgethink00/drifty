import type { ReactNode } from "react";

import type { AiConnectionTone } from "../ai-connection/AiConnectionStatusBar";
import { SettingsSelect, type SettingsSelectOption } from "./SettingsSelect";

/**
 * Presentational "Model being used" card shared by the Classification and
 * Intelligence AI-setup tabs so both read identically: a heading row (with an
 * optional action), a status pill row, and a provider / model selector pair.
 * Callers own all data prep; this component only renders the shell.
 */
export type ModelBeingUsedCardProps = {
  readonly regionAriaLabel: string;
  readonly heading?: string;
  readonly headingAction?: ReactNode;
  readonly tone: AiConnectionTone;
  readonly statusLabel: string;
  readonly statusProviderLabel: string;
  readonly statusAriaLabel: string;
  readonly providerAriaLabel: string;
  readonly providerValue: string;
  readonly providerOptions: readonly SettingsSelectOption<string>[];
  readonly onProviderChange: (value: string) => void;
  readonly modelAriaLabel: string;
  readonly modelValue: string;
  readonly modelOptions: readonly SettingsSelectOption<string>[];
  readonly onModelChange: (value: string) => void;
  readonly statusMessage?: string | null;
  readonly statusMessageKind?: "success" | "error" | null;
};

export function ModelBeingUsedCard({
  regionAriaLabel,
  heading = "Model being used",
  headingAction,
  tone,
  statusLabel,
  statusProviderLabel,
  statusAriaLabel,
  providerAriaLabel,
  providerValue,
  providerOptions,
  onProviderChange,
  modelAriaLabel,
  modelValue,
  modelOptions,
  onModelChange,
  statusMessage,
  statusMessageKind,
}: ModelBeingUsedCardProps) {
  return (
    <section className="ai-setup-model-zone" aria-label={regionAriaLabel}>
      <div className="ai-setup-model-zone__head">
        <h4 className="ai-setup-provider-heading">{heading}</h4>
        {headingAction}
      </div>
      <div className={`ai-setup-current-model${classNameForConnectionTone(tone)}`}>
        <div
          className="ai-setup-current-model__ai-status"
          data-tone={tone}
          role={tone === "error" ? "alert" : "status"}
          aria-label={statusAriaLabel}
        >
          <span className="ai-setup-current-model__ai-status-dot" aria-hidden="true" />
          <span className="ai-setup-current-model__ai-status-label">{statusLabel}</span>
          <span className="ai-setup-current-model__ai-status-provider">{statusProviderLabel}</span>
        </div>
        <div className="ai-setup-current-model__controls">
          <SettingsSelect
            ariaLabel={providerAriaLabel}
            className="ai-setup-select-control"
            value={providerValue}
            options={providerOptions}
            onChange={onProviderChange}
          />
          <span className="ai-setup-current-model__slash" aria-hidden="true">/</span>
          <SettingsSelect
            ariaLabel={modelAriaLabel}
            className="ai-setup-select-control ai-setup-select-control--model"
            value={modelValue}
            options={modelOptions}
            onChange={onModelChange}
          />
        </div>
        {statusMessage ? (
          <p
            className={`ai-setup-current-model__status${statusMessageKind ? ` is-${statusMessageKind}` : ""}`}
            role={statusMessageKind === "error" ? "alert" : "status"}
          >
            {statusMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function classNameForConnectionTone(tone: AiConnectionTone): string {
  switch (tone) {
    case "ok":
      return " is-success";
    case "error":
      return " is-error";
    case "warning":
    case "neutral":
      return "";
    default:
      return "";
  }
}
