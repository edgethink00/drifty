import { useMemo, useState } from "react";
import type { Project, ProjectInput } from "@drifty/domain";
import { firstUnusedProjectColor } from "../settings/projectPalette";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { PROJECT_COLOR_SWATCHES, ProjectEditorFields } from "../../components/ProjectEditorFields";
import { useModalDismiss } from "../../lib/useModalDismiss";

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
  const [color, setColor] = useState(project?.color || PROJECT_COLOR_SWATCHES[0].color);
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
        className="auth-modal modal-shell project-editor-modal"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="projects-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label="Close project editor" onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="projects-editor-title">{isEditing ? "Edit project" : "New project"}</h2>
            <p>Personal project</p>
          </div>
        </div>
        <ProjectEditorFields
          idPrefix="personal-project"
          name={name}
          description={description}
          color={effectiveColor}
          usedColors={usedColors}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onColorChange={(picked) => {
            setColor(picked);
            setColorTouched(true);
          }}
        />
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
