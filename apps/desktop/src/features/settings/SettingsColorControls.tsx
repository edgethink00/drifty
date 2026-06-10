import { useState, type CSSProperties } from "react";
import type { ActivityCategory } from "@drifty/domain";

export type AppThemeColorKey = "accent" | "productivityFocus" | "productivityDrift" | "productivityNeutral";

export type ColorOption<TKey extends string> = {
  readonly key: TKey;
  readonly label: string;
  readonly cssVariable: string;
  readonly defaultColor: string;
};

type ColorPreset = {
  readonly id: string;
  readonly color: string;
};

type SwatchStyle = CSSProperties & {
  readonly "--settings-swatch-color": string;
};

type CategoryColorControlsProps = {
  readonly options: readonly ColorOption<ActivityCategory>[];
  readonly overrides: Partial<Record<ActivityCategory, string>>;
  readonly onColorChange: (key: ActivityCategory, value: string) => void;
  readonly onColorReset: (key: ActivityCategory) => void;
};

type ThemeColorControlsProps = {
  readonly accentOptions: readonly ColorOption<AppThemeColorKey>[];
  readonly productivityOptions: readonly ColorOption<AppThemeColorKey>[];
  readonly overrides: Partial<Record<AppThemeColorKey, string>>;
  readonly onColorChange: (key: AppThemeColorKey, value: string) => void;
  readonly onColorReset: (key: AppThemeColorKey) => void;
};

type ClassificationPickerProps<TValue extends string> = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: TValue;
  readonly options: readonly TValue[];
  readonly getLabel: (value: TValue) => string;
  readonly getColor: (value: TValue) => string;
  readonly onChange: (value: TValue) => void;
};

const BALANCED_PRESETS = [
  { id: "moss", color: "#5f7f31" },
  { id: "fern", color: "#4f751e" },
  { id: "teal", color: "#2f7f78" },
  { id: "cyan", color: "#3a8ea5" },
  { id: "blue", color: "#476f8f" },
  { id: "indigo", color: "#5366a3" },
  { id: "violet", color: "#7b5ea7" },
  { id: "plum", color: "#9b5b91" },
  { id: "rose", color: "#b9565b" },
  { id: "berry", color: "#b24f79" },
  { id: "wine", color: "#8f3f5f" },
  { id: "clay", color: "#a34139" },
  { id: "coral", color: "#c05d48" },
  { id: "rust", color: "#b96a3f" },
  { id: "copper", color: "#9a6530" },
  { id: "ochre", color: "#a1792f" },
  { id: "gold", color: "#b58a2a" },
  { id: "olive", color: "#7d7a35" },
  { id: "sand", color: "#a49a84" },
  { id: "stone", color: "#7d786f" },
  { id: "slate", color: "#66707a" },
  { id: "charcoal", color: "#4d4b45" },
] satisfies readonly ColorPreset[];

function swatchStyle(color: string): SwatchStyle {
  return { "--settings-swatch-color": color };
}

function activeColor<TKey extends string>(option: ColorOption<TKey>, overrides: Partial<Record<TKey, string>>): string {
  return overrides[option.key] ?? option.defaultColor;
}

function ColorPresetGroup<TKey extends string>({
  option,
  value,
  presets,
  ariaType,
  isOpen,
  onToggle,
  onColorChange,
  onColorReset,
}: {
  readonly option: ColorOption<TKey>;
  readonly value: string;
  readonly presets: readonly ColorPreset[];
  readonly ariaType: string;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onColorChange: (key: TKey, value: string) => void;
  readonly onColorReset: (key: TKey) => void;
}) {
  const isOverridden = value.toLowerCase() !== option.defaultColor.toLowerCase();
  return (
    <div className={`settings-color-token${isOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className="settings-color-trigger"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <span className="settings-color-trigger__swatch" style={swatchStyle(value)} aria-hidden="true" />
        <span className="settings-color-trigger__copy">
          <span className="settings-color-token__name">{option.label}</span>
          <span className="settings-color-token__action">Change color</span>
        </span>
        <span className="settings-color-trigger__chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="settings-color-popover" aria-label={`${option.label} color palette`}>
          <div className="settings-color-token__presets" aria-label={`${option.label} preset colors`}>
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`settings-color-preset${value.toLowerCase() === preset.color ? " is-selected" : ""}`}
                style={swatchStyle(preset.color)}
                onClick={() => onColorChange(option.key, preset.color)}
                aria-label={`${option.label} ${preset.id} preset`}
              />
            ))}
          </div>
          <div className="settings-color-popover__footer">
            <span className="settings-color-main">
              <span style={swatchStyle(value)} aria-hidden="true" />
              <span>Main</span>
            </span>
            <label className="settings-color-more">
              <input type="color" aria-label={`${option.label} ${ariaType} color`} value={value} onChange={(event) => onColorChange(option.key, event.currentTarget.value)} />
              <span>More colors</span>
            </label>
            <button type="button" className="settings-color-default" onClick={() => onColorReset(option.key)} disabled={!isOverridden} aria-label={`${option.label} set default`}>Default</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CategoryColorControls({ options, overrides, onColorChange, onColorReset }: CategoryColorControlsProps) {
  const [openKey, setOpenKey] = useState<ActivityCategory | null>(null);
  return (
    <div className="settings-row settings-row--fallback settings-color-row" role="group" aria-label="Category colors">
      <div>
        <div className="lbl">Category colors</div>
        <div className="desc">Click a color to open its preset palette. Use More colors only for custom values.</div>
      </div>
      <div className="ctrl settings-row__actions settings-color-editor">
        <div className="settings-color-grid">
          {options.map((option) => (
            <ColorPresetGroup
              key={option.key}
              option={option}
              value={activeColor(option, overrides)}
              presets={BALANCED_PRESETS}
              ariaType="category"
              isOpen={openKey === option.key}
              onToggle={() => setOpenKey((current) => (current === option.key ? null : option.key))}
              onColorChange={onColorChange}
              onColorReset={onColorReset}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ThemeColorControls({
  accentOptions,
  productivityOptions,
  overrides,
  onColorChange,
  onColorReset,
}: ThemeColorControlsProps) {
  const [openKey, setOpenKey] = useState<AppThemeColorKey | null>(null);
  return (
    <>
      <div className="settings-row settings-row--fallback settings-color-row" role="group" aria-label="Accent color">
        <div>
          <div className="lbl">Accent</div>
          <div className="desc">Choose the primary app accent used for emphasis and selected states.</div>
        </div>
        <div className="ctrl settings-row__actions settings-color-editor">
          <div className="settings-color-grid settings-color-grid--single">
            {accentOptions.map((option) => (
              <ColorPresetGroup
                key={option.key}
                option={option}
                value={activeColor(option, overrides)}
                presets={BALANCED_PRESETS}
                ariaType="theme"
                isOpen={openKey === option.key}
                onToggle={() => setOpenKey((current) => (current === option.key ? null : option.key))}
                onColorChange={onColorChange}
                onColorReset={onColorReset}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="settings-row settings-row--fallback settings-color-row" role="group" aria-label="Productivity colors">
        <div>
          <div className="lbl">Productivity colors</div>
          <div className="desc">Tune Focus, Drift, and Neutral tones with presets first, then More for custom values.</div>
        </div>
        <div className="ctrl settings-row__actions settings-color-editor">
          <div className="settings-color-grid">
            {productivityOptions.map((option) => (
              <ColorPresetGroup
                key={option.key}
                option={option}
                value={activeColor(option, overrides)}
                presets={BALANCED_PRESETS}
                ariaType="theme"
                isOpen={openKey === option.key}
                onToggle={() => setOpenKey((current) => (current === option.key ? null : option.key))}
                onColorChange={onColorChange}
                onColorReset={onColorReset}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export function ClassificationPicker<TValue extends string>({ label, ariaLabel, value, options, getLabel, getColor, onChange }: ClassificationPickerProps<TValue>) {
  const selectedLabel = getLabel(value);
  return (
    <label className="classification-rule-field classification-rule-picker-field">
      <span>{label}</span>
      <span className="classification-rule-picker-shell" style={swatchStyle(getColor(value))}>
        <span className="classification-rule-picker-shell__dot" aria-hidden="true" />
        <span className="classification-rule-picker-shell__label">{selectedLabel}</span>
        <select
          className="settings-input settings-select classification-rule-picker"
          value={value}
          onChange={(event) => {
            const selected = options.find((option) => option === event.currentTarget.value);
            if (selected) onChange(selected);
          }}
          aria-label={ariaLabel}
        >
          {options.map((option) => <option key={option} value={option}>{getLabel(option)}</option>)}
        </select>
      </span>
    </label>
  );
}
