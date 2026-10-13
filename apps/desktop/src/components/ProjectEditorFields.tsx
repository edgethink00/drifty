import { useEffect, useRef, useState } from "react";
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

/**
 * Name and mark are one identity, so the color chip leads the name field and
 * the palette opens inside the same frame — the chip is the exact dot the
 * project row will show. New projects arrive with a suggested color, so most
 * users never open this; the ones who do get one click and arrow keys.
 */
function ProjectIdentityField({
  nameId,
  name,
  color,
  usedColors,
  onNameChange,
  onColorChange,
}: {
  readonly nameId: string;
  readonly name: string;
  readonly color: string;
  readonly usedColors?: ReadonlySet<string>;
  readonly onNameChange: (value: string) => void;
  readonly onColorChange: (value: string) => void;
}): JSX.Element {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<SwatchItem | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);

  const value = normalizeProjectColor(color);
  const used = new Set([...(usedColors ?? [])].map(normalizeProjectColor));
  const usedTitle = t("projects.color.usedTitle");
  const items: SwatchItem[] = PROJECT_COLOR_SWATCHES.map((swatch) => {
    const isUsed = normalizeHex(swatch.color) !== value && used.has(normalizeHex(swatch.color));
    return {
      color: swatch.color,
      label: localizedProjectColorName(swatch.name, t),
      usedBy: isUsed ? usedTitle : undefined,
    };
  });
  const selectedName = PROJECT_COLOR_SWATCHES.find((swatch) => normalizeHex(swatch.color) === value)?.name;
  const selectedLabel = selectedName ? localizedProjectColorName(selectedName, t) : t("projects.color.custom");
  const captionLabel = hovered ? hovered.label : selectedLabel;
  const captionUsed = Boolean(hovered?.usedBy);

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
          aria-label={`${t("projects.editor.colorAria")} · ${selectedLabel}`}
          title={`${selectedLabel} · ${t("projects.color.change")}`}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="project-identity__dot" style={swatchStyle(value)} aria-hidden="true" />
          <span className="project-identity__chevron" aria-hidden="true" />
        </button>
        <input
          id={nameId}
          className="project-identity__input"
          type="text"
          value={name}
          maxLength={120}
          placeholder={t("projects.editor.namePlaceholder")}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>
      {open ? (
        <div className="project-identity__drawer">
          <ColorSwatchGrid
            items={items}
            value={value}
            columns={PROJECT_COLOR_SWATCHES.length}
            ariaLabel={t("projects.editor.colorAria")}
            autoFocus
            onHover={setHovered}
            onPick={(picked) => {
              onColorChange(picked);
              setOpen(false);
              chipRef.current?.focus();
            }}
          />
          <span className="project-identity__caption" aria-live="polite">
            {captionLabel}
            {captionUsed ? <span className="project-identity__caption-used">{t("projects.color.usedShort")}</span> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Shared project definition fields for personal and team projects. */
export function ProjectEditorFields({
  idPrefix,
  name,
  description,
  color,
  usedColors,
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
