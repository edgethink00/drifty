import { ProjectColorToken } from "./ProjectColorToken";
import "./project-editor-fields.css";
import { useLocalization } from "../features/localization/LocalizationContext";

export const PROJECT_COLOR_SWATCHES = [
  { color: "#6366f1", name: "Indigo" },
  { color: "#ec4899", name: "Pink" },
  { color: "#f59e0b", name: "Amber" },
  { color: "#10b981", name: "Emerald" },
  { color: "#3b82f6", name: "Blue" },
  { color: "#8b5cf6", name: "Violet" },
  { color: "#ef4444", name: "Red" },
  { color: "#14b8a6", name: "Teal" },
  { color: "#f97316", name: "Orange" },
  { color: "#84cc16", name: "Lime" },
] as const;

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
  const colorLabelId = `${idPrefix}-color-label`;

  return (
    <div className="project-editor-fields">
      <label className="project-editor-field" htmlFor={nameId}>
        <span className="label-mono">{t("projects.editor.name")}</span>
        <input
          id={nameId}
          className="settings-input"
          type="text"
          value={name}
          maxLength={120}
          autoFocus
          placeholder={t("projects.editor.namePlaceholder")}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      <label className="project-editor-field" htmlFor={descriptionId}>
        <span className="label-mono">{t("projects.editor.description")}</span>
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
      <div className="project-editor-field">
        <span className="label-mono" id={colorLabelId}>{t("projects.editor.color")}</span>
        <ProjectColorToken
          value={color}
          swatches={PROJECT_COLOR_SWATCHES}
          usedColors={usedColors}
          ariaLabel={t("projects.editor.colorAria")}
          onPick={onColorChange}
        />
      </div>
    </div>
  );
}
