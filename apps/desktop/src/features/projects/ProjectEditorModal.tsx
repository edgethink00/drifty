import { useMemo, useState } from "react";
import type { Project, ProjectInput } from "@drifty/domain";
import { firstUnusedProjectColor } from "../settings/projectPalette";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { PROJECT_COLOR_SWATCHES, ProjectEditorFields } from "../../components/ProjectEditorFields";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useLocalization } from "../localization/LocalizationContext";

export interface ProjectEditorModalProps {
  /** Project being edited, or null to create a new one. */
  readonly project: Project | null;
  /** Full project list, for dimming colors already used by other projects. */
  readonly projects: readonly Project[];
  readonly busy?: boolean;
  /** Resolves true when the project was persisted; the modal stays open on failure. */
  readonly onSave: (input: ProjectInput) => Promise<boolean> | boolean;
  readonly onClose: () => void;
}

/**
 * Create/edit project modal (name, description, color) shared by the table
 * manager and the project detail view. Same layout language as the team
 * project editor: X-close head, stacked name → description → color fields,
 * named color picker ("Drifty Modals" v1.3 §13).
 */
export function ProjectEditorModal({ project, projects, busy = false, onSave, onClose }: ProjectEditorModalProps): JSX.Element {
  const { t } = useLocalization();
  const isEditing = Boolean(project);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color || PROJECT_COLOR_SWATCHES[0].color);
  const [colorTouched, setColorTouched] = useState(isEditing);
  const [saving, setSaving] = useState(false);

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
  const isBusy = busy || saving;
  const canSave = name.trim().length > 0 && !isBusy;

  useModalDismiss(onClose, { disabled: isBusy });

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isBusy) return;
    const input: ProjectInput = {
      name: trimmedName,
      description: description.trim(),
      color: effectiveColor,
      status: project?.status ?? "active",
    };
    if (project) input.id = project.id;
    // Persistence is asynchronous, and a new project immediately triggers
    // automatic matching. Closing before the save resolves would both discard
    // the user's input on failure and start analysis for a project that does
    // not exist yet.
    setSaving(true);
    try {
      const saved = await onSave(input);
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  };

  // Closing mid-save would leave the user with no editor while persistence (and
  // the matching run it triggers) is still in flight, so every dismissal path
  // is inert until the save settles.
  const requestClose = () => {
    if (isBusy) return;
    onClose();
  };

  return (
    <div className="auth-modal__overlay" onClick={requestClose}>
      <section
        className="auth-modal modal-shell project-editor-modal"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="projects-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("projects.editor.close")} onClick={requestClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="projects-editor-title">{t(isEditing ? "projects.editor.editTitle" : "projects.editor.newTitle")}</h2>
            <p>{t("projects.editor.personal")}</p>
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
          <button type="button" className="modal-btn modal-btn--ghost" onClick={requestClose} disabled={isBusy}>{t("common.cancel")}</button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={() => void handleSave()} disabled={!canSave}>
            {saving ? t("common.saving") : isEditing ? t("projects.editor.saveChanges") : t("projects.create")}
          </button>
        </div>
      </section>
    </div>
  );
}
