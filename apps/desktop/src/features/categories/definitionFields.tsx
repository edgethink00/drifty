import { useId, useRef, type ReactNode } from "react";
import { AiFieldMark } from "../../components/AiIcons";
import { ColorIdentityField, type IdentitySwatch } from "../../components/ProjectEditorFields";
import { BALANCED_PRESETS, normalizeHex, type BalancedPresetId } from "../../lib/colorPalette";
import type { LocalizationController } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";

/**
 * The fields of the category editor's detail pane. Productivity labels and
 * categories use the project editor's field language — a name led by its color
 * chip, a description marked with the AI sparkle — so all three kinds of
 * definition edit the same way.
 */

function presetNameKey(id: BalancedPresetId): TranslationKey {
  return ("settings.appearance.preset." + id) as TranslationKey;
}

/** The shared 22-color palette, with colors other definitions use marked by name. */
export function balancedIdentitySwatches(t: LocalizationController["t"], siblings: ReadonlyMap<string, string>): IdentitySwatch[] {
  return BALANCED_PRESETS.map((preset) => {
    const owner = siblings.get(preset.color);
    return {
      color: preset.color,
      label: t(presetNameKey(preset.id)),
      usedBy: owner ? t("settings.appearance.usedByRole", { label: owner }) : undefined,
    };
  });
}

export function DefinitionIdentityField({
  nameId,
  name,
  placeholder,
  maxLength,
  nameDisabled = false,
  color,
  swatches,
  customColorLabel,
  trailing,
  t,
  onNameChange,
  onColorChange,
}: {
  readonly nameId: string;
  readonly name: string;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly nameDisabled?: boolean;
  readonly color: string;
  readonly swatches: readonly IdentitySwatch[];
  /** Accessible name of the custom color well. */
  readonly customColorLabel: string;
  /** An action at the end of the name row. */
  readonly trailing?: ReactNode;
  readonly t: LocalizationController["t"];
  readonly onNameChange: (value: string) => void;
  readonly onColorChange: (value: string) => void;
}) {
  const value = normalizeHex(color);
  const selected = swatches.find((swatch) => normalizeHex(swatch.color) === value);
  return (
    <div className="project-editor-field">
      <label className="label-mono" htmlFor={nameId}>{t("settings.categories.nameLabel")}</label>
      <ColorIdentityField
        nameId={nameId}
        name={name}
        placeholder={placeholder}
        maxLength={maxLength}
        nameDisabled={nameDisabled}
        color={value}
        swatches={swatches}
        selectedLabel={selected?.label ?? t("projects.color.custom")}
        chipAriaLabel={t("settings.categories.colorLabel")}
        customColorAria={customColorLabel}
        trailing={trailing}
        onNameChange={onNameChange}
        onColorChange={onColorChange}
      />
    </div>
  );
}

/** An item's description, which the classifier reads: Drifty's own until the user edits it. */
export function DefinitionDescriptionField({ label, value, placeholder, maxLength, t, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly t: LocalizationController["t"];
  readonly onChange: (value: string) => void;
}) {
  const fieldId = useId();
  const length = Array.from(value).length;
  // The field starts with Drifty's description, which people usually add to,
  // so arriving by keyboard puts the caret at the end. A click keeps the
  // caret where it landed.
  const pressed = useRef(false);
  return (
    <div className="project-editor-field">
      <label className="label-mono project-editor-field__label-mono" htmlFor={fieldId}>
        <AiFieldMark />
        {label}
      </label>
      <textarea
        id={fieldId}
        className="settings-input project-editor-field__textarea"
        value={value}
        rows={3}
        maxLength={maxLength}
        placeholder={placeholder}
        onPointerDown={() => { pressed.current = true; }}
        onFocus={(event) => {
          const field = event.currentTarget;
          if (!pressed.current) field.setSelectionRange(field.value.length, field.value.length);
          pressed.current = false;
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {length >= maxLength * 0.8 ? (
        <span className="definition-field__count">{t("settings.categories.descriptionCount", { count: length, max: maxLength })}</span>
      ) : null}
    </div>
  );
}
