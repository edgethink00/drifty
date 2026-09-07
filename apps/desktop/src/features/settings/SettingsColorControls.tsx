import { useState, type CSSProperties } from "react";
import type { ActivityCategory } from "@drifty/domain";
import { SettingsSelect } from "./SettingsSelect";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";

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
  readonly variant?: "category" | "productivity";
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
  const { t } = useLocalization();
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
          <span className="settings-color-token__action">{t("settings.appearance.changeColor")}</span>
        </span>
        <span className="settings-color-trigger__chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="settings-color-popover" aria-label={t("settings.appearance.colorPaletteAria", { label: option.label })}>
          <div className="settings-color-token__presets" aria-label={t("settings.appearance.presetColorsAria", { label: option.label })}>
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`settings-color-preset${value.toLowerCase() === preset.color ? " is-selected" : ""}`}
                style={swatchStyle(preset.color)}
                onClick={() => onColorChange(option.key, preset.color)}
                aria-label={t("settings.appearance.colorPresetAria", { label: option.label, preset: preset.id })}
              />
            ))}
          </div>
          <div className="settings-color-popover__footer">
            <span className="settings-color-main">
              <span style={swatchStyle(value)} aria-hidden="true" />
              <span>{t("settings.appearance.mainColor")}</span>
            </span>
            <label className="settings-color-more">
              <input type="color" aria-label={t("settings.appearance.customColorAria", { label: option.label, type: ariaType })} value={value} onChange={(event) => onColorChange(option.key, event.currentTarget.value)} />
              <span>{t("settings.appearance.moreColors")}</span>
            </label>
            <button type="button" className="settings-color-default" onClick={() => onColorReset(option.key)} disabled={!isOverridden} aria-label={t("settings.appearance.setDefaultAria", { label: option.label })}>{t("settings.appearance.defaultColor")}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CategoryColorControls({ options, overrides, onColorChange, onColorReset }: CategoryColorControlsProps) {
  const { t } = useLocalization();
  const [openKey, setOpenKey] = useState<ActivityCategory | null>(null);
  return (
    <div data-setting-id="settings.appearance.categoryColors" className="settings-row settings-row--fallback settings-color-row" role="group" aria-label={t("settings.appearance.categoryColors")}>
      <div>
        <div className="lbl">{t("settings.appearance.categoryColors")}</div>
        <div className="desc">{t("settings.appearance.categoryColorsDescription")}</div>
      </div>
      <div className="ctrl settings-row__actions settings-color-editor">
        <div className="settings-color-grid">
          {options.map((option) => (
            <ColorPresetGroup
              key={option.key}
              option={{ ...option, label: localizedCategoryLabel(option.key, t) }}
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
  const { t } = useLocalization();
  const [openKey, setOpenKey] = useState<AppThemeColorKey | null>(null);
  return (
    <>
      <div data-setting-id="settings.appearance.accent" className="settings-row settings-row--fallback settings-color-row" role="group" aria-label={t("settings.appearance.accentColor")}>
        <div>
          <div className="lbl">{t("settings.appearance.accent")}</div>
          <div className="desc">{t("settings.appearance.accentDescription")}</div>
        </div>
        <div className="ctrl settings-row__actions settings-color-editor">
          <div className="settings-color-grid settings-color-grid--single">
            {accentOptions.map((option) => (
              <ColorPresetGroup
                key={option.key}
                option={{ ...option, label: localizedThemeColorOptionLabel(option.key, option.label, t) }}
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
      <div data-setting-id="settings.appearance.productivityColors" className="settings-row settings-row--fallback settings-color-row" role="group" aria-label={t("settings.appearance.productivityColors")}>
        <div>
          <div className="lbl">{t("settings.appearance.productivityColors")}</div>
          <div className="desc">{t("settings.appearance.productivityColorsDescription")}</div>
        </div>
        <div className="ctrl settings-row__actions settings-color-editor">
          <div className="settings-color-grid">
            {productivityOptions.map((option) => (
              <ColorPresetGroup
                key={option.key}
                option={{ ...option, label: localizedThemeColorOptionLabel(option.key, option.label, t) }}
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

function localizedThemeColorOptionLabel(
  key: AppThemeColorKey,
  fallback: string,
  t: LocalizationController["t"],
): string {
  switch (key) {
    case "accent": return t("settings.appearance.accent");
    case "productivityFocus": return localizedProductivityLabel("focus", t);
    case "productivityDrift": return localizedProductivityLabel("drift", t);
    case "productivityNeutral": return localizedProductivityLabel("neutral", t);
    default: return fallback;
  }
}

export function ClassificationPicker<TValue extends string>({ label, ariaLabel, value, options, getLabel, getColor, onChange, variant = "category" }: ClassificationPickerProps<TValue>) {
  return (
    <label className={`classification-rule-field classification-rule-picker-field classification-rule-picker-field--${variant}`}>
      <span>{label}</span>
      <SettingsSelect
        ariaLabel={ariaLabel}
        className="classification-rule-select"
        value={value}
        options={options.map((option) => ({ value: option, label: getLabel(option), accentColor: getColor(option) }))}
        onChange={onChange}
      />
    </label>
  );
}
