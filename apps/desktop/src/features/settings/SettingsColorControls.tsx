import { SettingsSelect } from "./SettingsSelect";

export type AppThemeColorKey = "accent" | "productivityFocus" | "productivityDrift" | "productivityNeutral";

export type ColorOption<TKey extends string> = {
  readonly key: TKey;
  readonly label: string;
  readonly cssVariable: string;
  readonly defaultColor: string;
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

export function ClassificationPicker<TValue extends string>({ label, ariaLabel, value, options, getLabel, getColor, onChange, variant = "category" }: ClassificationPickerProps<TValue>) {
  return (
    <label className={`classification-rule-field classification-rule-picker-field classification-rule-picker-field--${variant}`}>
      <span>{label}</span>
      <SettingsSelect
        ariaLabel={ariaLabel}
        className="classification-rule-select"
        menuSize={variant === "category" ? "content" : "bounded"}
        value={value}
        options={options.map((option) => ({ value: option, label: getLabel(option), accentColor: getColor(option) }))}
        onChange={onChange}
      />
    </label>
  );
}
