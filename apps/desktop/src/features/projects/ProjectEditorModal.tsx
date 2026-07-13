import { useMemo, useState } from "react";
import type { Project, ProjectInput } from "@drifty/domain";
import { firstUnusedProjectColor } from "../settings/projectPalette";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ProjectColorToken } from "../../components/ProjectColorToken";
import { useModalDismiss } from "../../lib/useModalDismiss";

const COLOR_SWATCHES = [
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

export interface ProjectEditorModalProps {
  /** Project being edited, or null to create a new one. */
  readonly project: Project | null;
  /** Full project list, for dimming colors already used by other projects. */
  readonly projects: readonly Project[];
  readonly busy?: boolean;
  readonly onSave: (input: ProjectInput) => void;
  readonly onClose: () => void;
}

/**
 * Create/edit project modal (name, description, color) shared by the table
 * manager and the project detail view. Same layout language as the team
 * project editor: X-close head, stacked name → description → color fields,
 * named color picker ("Drifty Modals" v1.3 §13).
 */
export function ProjectEditorModal({ project, projects, busy = false, onSave, onClose }: ProjectEditorModalProps): JSX.Element {
  const isEditing = Boolean(project);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color || COLOR_SWATCHES[0].color);
  const [colorTouched, setColorTouched] = useState(isEditing);

  const usedColors = useMemo(
    () => new Set(
      projects
        .filter((item) => item.status === "active" && item.id !== project?.id)
        .map((item) => item.color.trim().toLowerCase()),
    ),
    [projects, project?.id],
  );
  const suggestedColor = useMemo(() => firstUnusedProjectColor([...usedColors]), [usedColors]);
  const effectiveColor = colorTouched ? color : suggestedColor;
  const canSave = name.trim().length > 0 && !busy;

  useModalDismiss(onClose, { disabled: busy });

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const input: ProjectInput = {
      name: trimmedName,
      description: description.trim(),
      color: effectiveColor,
      status: project?.status ?? "active",
    };
    if (project) input.id = project.id;
    onSave(input);
    onClose();
  };

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section
        className="auth-modal projects-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="projects-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label="Close project editor" onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="projects-editor-title">{isEditing ? "Edit project" : "New project"}</h2>
          </div>
        </div>
        <div className="projects-editor__card">
          <div className="projects-field projects-field--name">
            <label className="projects-field__label" htmlFor="projects-name-input">Project name</label>
            <input
              id="projects-name-input"
              className="settings-input projects-field__input"
              type="text"
              value={name}
              autoFocus
              placeholder="Project name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="projects-field">
            <label className="projects-field__label" htmlFor="projects-description-input">Description</label>
            <textarea
              id="projects-description-input"
              className="settings-input projects-field__input projects-field__textarea"
              rows={4}
              value={description}
              placeholder="e.g. Everything for the Q3 marketing site redesign — Figma mockups, the Next.js repo, and launch-planning docs."
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="projects-field projects-field--color">
            <span className="projects-field__label" id="projects-color-label">Color</span>
            <ProjectColorToken
              value={effectiveColor}
              swatches={COLOR_SWATCHES}
              usedColors={usedColors}
              ariaLabel="Project color"
              onPick={(picked) => {
                setColor(picked);
                setColorTouched(true);
              }}
            />
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={handleSave} disabled={!canSave}>
            {isEditing ? "Save changes" : "Create project"}
          </button>
        </div>
      </section>
    </div>
  );
}
