import { useEffect, useRef, useState, type ReactNode } from "react";
import { AiFieldMark } from "./AiIcons";
import { ColorSwatchGrid, swatchStyle, type SwatchItem } from "./ColorSwatchGrid";
import "./project-editor-fields.css";
import { useLocalization, type LocalizationController } from "../features/localization/LocalizationContext";
import { PROJECT_COLOR_SLOTS, normalizeHex, normalizeProjectColor } from "../lib/colorPalette";

export type ProjectColorSwatch = {
  readonly color: string;
  readonly name: string;
};

/** The project mark palette: ten slots of the shared app palette. */
export const PROJECT_COLOR_SWATCHES: readonly ProjectColorSwatch[] = PROJECT_COLOR_SLOTS.map((slot) => ({
  color: slot.color,
  name: slot.name,
}));

export interface ProjectEditorFieldsProps {
  readonly idPrefix: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly usedColors?: ReadonlySet<string>;
  /** An action at the end of the name row (the category editor's fold control). */
  readonly nameTrailing?: ReactNode;
  readonly onNameChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onColorChange: (value: string) => void;
}

function localizedProjectColorName(name: string, t: LocalizationController["t"]): string {
  switch (name) {
    case "Indigo": return t("projects.color.indigo");
    case "Pink": return t("projects.color.pink");
    case "Amber": return t("projects.color.amber");
    case "Emerald": return t("projects.color.emerald");
    case "Blue": return t("projects.color.blue");
    case "Violet": return t("projects.color.violet");
    case "Red": return t("projects.color.red");
    case "Teal": return t("projects.color.teal");
    case "Orange": return t("projects.color.orange");
    case "Lime": return t("projects.color.lime");
    default: return name;
  }
}

/** One color in an identity palette. */
export type IdentitySwatch = {
  readonly color: string;
  readonly label: string;
  /** Who already uses this color, if anyone; shown as a ring and in the caption. */
  readonly usedBy?: string;
};

/**
 * Name and mark are one identity, so the color chip leads the name field and
 * the palette opens inside the same frame — the chip is the exact dot the
 * row will show. Projects and the category editor share this field; the
 * categories pass their own palette and allow a custom color.
 */
export function ColorIdentityField({
  nameId,
  name,
  placeholder,
  maxLength = 120,
  nameDisabled = false,
  color,
  swatches,
  selectedLabel,
  chipAriaLabel,
  usedCaption,
  customColorAria,
  trailing,
  onNameChange,
  onColorChange,
}: {
  readonly nameId: string;
  readonly name: string;
  readonly placeholder: string;
  readonly maxLength?: number;
  /** Shows the name without letting it change (a definition that keeps its built-in name). */
  readonly nameDisabled?: boolean;
  /** Normalized current color. */
  readonly color: string;
  readonly swatches: readonly IdentitySwatch[];
  readonly selectedLabel: string;
  readonly chipAriaLabel: string;
  /** Short caption for a used color; defaults to the swatch's own usedBy text. */
  readonly usedCaption?: string;
  /** Set to offer a custom color well after the presets. */
  readonly customColorAria?: string;
  /** An action at the end of the name row, such as restoring an item's defaults. */
  readonly trailing?: ReactNode;
  readonly onNameChange: (value: string) => void;
  readonly onColorChange: (value: string) => void;
}): JSX.Element {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<SwatchItem | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const items: SwatchItem[] = swatches.map((swatch) => ({
    color: swatch.color,
    label: swatch.label,
    usedBy: normalizeHex(swatch.color) !== color ? swatch.usedBy : undefined,
  }));
  const isCustom = !swatches.some((swatch) => normalizeHex(swatch.color) === color);
  const captionLabel = hovered ? hovered.label : selectedLabel;
  const captionUsed = hovered?.usedBy ? usedCaption ?? hovered.usedBy : undefined;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Close the palette only; the dialog's own Escape handling stays for the next press.
      event.stopPropagation();
      setOpen(false);
      chipRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className={`project-identity${open ? " is-open" : ""}`} ref={rootRef}>
      <div className="project-identity__frame">
        <button
          ref={chipRef}
          type="button"
          className="project-identity__chip"
          aria-expanded={open}
          aria-label={`${chipAriaLabel} · ${selectedLabel}`}
          title={`${selectedLabel} · ${t("projects.color.change")}`}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="project-identity__dot" style={swatchStyle(color)} aria-hidden="true" />
          <span className="project-identity__chevron" aria-hidden="true" />
        </button>
        <input
          id={nameId}
          className="project-identity__input"
          type="text"
          value={name}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={nameDisabled}
          onChange={(event) => onNameChange(event.target.value)}
        />
        {trailing}
      </div>
      {open ? (
        <div className="project-identity__drawer">
          <div className="project-identity__palette">
            <ColorSwatchGrid
              items={items}
              value={color}
              columns={Math.min(swatches.length, 11)}
              ariaLabel={chipAriaLabel}
              autoFocus
              onHover={setHovered}
              onPick={(picked) => {
                onColorChange(picked);
                setOpen(false);
                chipRef.current?.focus();
              }}
            />
            {customColorAria ? (
              <label className={`project-identity__custom${isCustom ? " is-selected" : ""}`} style={swatchStyle(color)} title={t("projects.color.custom")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
                <input type="color" aria-label={customColorAria} value={color} onChange={(event) => onColorChange(event.currentTarget.value.toLowerCase())} />
              </label>
            ) : null}
          </div>
          <span className="project-identity__caption" aria-live="polite">
            {captionLabel}
            {captionUsed ? <span className="project-identity__caption-used">{captionUsed}</span> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ProjectIdentityField({
  nameId,
  name,
  color,
  usedColors,
  trailing,
  onNameChange,
  onColorChange,
}: {
  readonly nameId: string;
  readonly name: string;
  readonly color: string;
  readonly usedColors?: ReadonlySet<string>;
  readonly trailing?: ReactNode;
  readonly onNameChange: (value: string) => void;
  readonly onColorChange: (value: string) => void;
}): JSX.Element {
  const { t } = useLocalization();
  const value = normalizeProjectColor(color);
  const used = new Set([...(usedColors ?? [])].map(normalizeProjectColor));
  const swatches: IdentitySwatch[] = PROJECT_COLOR_SWATCHES.map((swatch) => ({
    color: swatch.color,
    label: localizedProjectColorName(swatch.name, t),
    usedBy: used.has(normalizeHex(swatch.color)) ? t("projects.color.usedTitle") : undefined,
  }));
  const selectedName = PROJECT_COLOR_SWATCHES.find((swatch) => normalizeHex(swatch.color) === value)?.name;
  return (
    <ColorIdentityField
      nameId={nameId}
      name={name}
      placeholder={t("projects.editor.namePlaceholder")}
      color={value}
      swatches={swatches}
      selectedLabel={selectedName ? localizedProjectColorName(selectedName, t) : t("projects.color.custom")}
      chipAriaLabel={t("projects.editor.colorAria")}
      usedCaption={t("projects.color.usedShort")}
      trailing={trailing}
      onNameChange={onNameChange}
      onColorChange={onColorChange}
    />
  );
}

/** Shared project definition fields for personal and team projects. */
export function ProjectEditorFields({
  idPrefix,
  name,
  description,
  color,
  usedColors,
  nameTrailing,
  onNameChange,
  onDescriptionChange,
  onColorChange,
}: ProjectEditorFieldsProps): JSX.Element {
  const { t } = useLocalization();
  const nameId = `${idPrefix}-name`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <div className="project-editor-fields" data-modal-initial-selector={`#${nameId}`}>
      <div className="project-editor-field">
        <label className="label-mono" htmlFor={nameId}>{t("projects.editor.name")}</label>
        <ProjectIdentityField
          nameId={nameId}
          name={name}
          color={color}
          usedColors={usedColors}
          trailing={nameTrailing}
          onNameChange={onNameChange}
          onColorChange={onColorChange}
        />
      </div>
      <label className="project-editor-field" htmlFor={descriptionId}>
        <span className="label-mono project-editor-field__label-mono">
          <AiFieldMark />
          {t("projects.editor.description")}
        </span>
        <textarea
          id={descriptionId}
          className="settings-input project-editor-field__textarea"
          value={description}
          rows={4}
          maxLength={2000}
          placeholder={t("projects.editor.descriptionPlaceholder")}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </label>
    </div>
  );
}
