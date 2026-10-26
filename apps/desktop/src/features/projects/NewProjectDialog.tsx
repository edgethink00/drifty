import { useMemo, useRef, useState } from "react";
import type { Project, ProjectInput } from "@drifty/domain";
import { KeyHint } from "../../components/KeyHint";
import { ActionLabel } from "../../components/ActionLabel";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ProjectEditorFields } from "../../components/ProjectEditorFields";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { describeActionError, type DescribedActionError } from "../../lib/actionErrors";
import { firstUnusedProjectColor } from "../settings/projectPalette";
import { useLocalization } from "../localization/LocalizationContext";
import type { ProjectSaveResult } from "./projectSaveResult";
import "./projectModals.css";

export interface NewProjectDialogProps {
  /** The library, so the suggested color is one no active project uses. */
  readonly projects: readonly Project[];
  /** Saves the new project; a failure keeps the dialog and its input. */
  readonly onCreate: (input: ProjectInput) => Promise<ProjectSaveResult> | ProjectSaveResult;
  /** Closes the dialog, with the new project's id once it is saved. */
  readonly onClose: (createdId?: string) => void;
}

/**
 * A new project's own dialog: a name, a color and the description matching
 * reads, nothing else on screen. Editing, ordering, archiving and deleting
 * stay in the category editor.
 */
export function NewProjectDialog({ projects, onCreate, onClose }: NewProjectDialogProps): JSX.Element {
  const { t } = useLocalization();
  const usedColors = useMemo(
    () => new Set(projects.filter((project) => project.status === "active").map((project) => project.color.trim().toLowerCase())),
    [projects],
  );
  const suggestedColor = useMemo(() => firstUnusedProjectColor([...usedColors]), [usedColors]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<DescribedActionError | null>(null);
  const inFlight = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const effectiveColor = color ?? suggestedColor;
  const canSave = name.trim().length > 0 && !saving;
  const hasInput = name !== "" || description !== "" || color !== null;

  // Closing mid-save would leave matching running for a project the user never
  // saw land, so every way out waits for the save to settle.
  const requestClose = () => {
    if (!saving) onClose();
  };
  useModalDismiss(requestClose, { disabled: saving });
  useAnchoredDialog(dialogRef);
  const overlayDismiss = useOverlayDismiss(requestClose, { disabled: saving, keepOpen: hasInput });

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onCreate({ name: trimmed, description: description.trim(), color: effectiveColor, status: "active" });
      if (result === true) onClose();
      else if (typeof result === "object" && result.saved) onClose(result.id);
      else setSaveError(typeof result === "object" ? { message: result.error, detail: result.detail ?? null } : { message: t("projects.editor.saveError"), detail: null });
    } catch (error) {
      setSaveError(describeActionError(error, t("projects.editor.saveError")));
    } finally {
      setSaving(false);
      inFlight.current = false;
    }
  };
  // The description is multi-line: ⌘/Ctrl+Enter creates from either field.
  useModalSubmitShortcut(dialogRef, "modEnter", () => void create(), { disabled: !canSave });

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell new-project-dialog"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        aria-describedby="new-project-lede"
        aria-busy={saving}
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("projects.newDialogClose")} onClick={requestClose} disabled={saving} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="new-project-title">{t("projects.new")}</h2>
            <p id="new-project-lede">{t("projects.empty.body")}</p>
          </div>
        </div>
        <fieldset className="new-project-dialog__fields" disabled={saving}>
          <ProjectEditorFields
            idPrefix="new-project"
            name={name}
            description={description}
            color={effectiveColor}
            usedColors={usedColors}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onColorChange={setColor}
          />
        </fieldset>
        <div className="modal-foot">
          {saveError ? (
            <p className="modal-foot__note modal-foot__note--error" role="alert" title={saveError.detail ?? saveError.message}>
              {saveError.message}{saveError.detail ? <span className="sr-only"> {saveError.detail}</span> : null}
            </p>
          ) : null}
          <button type="button" className="modal-btn modal-btn--ghost" onClick={requestClose} disabled={saving}>
            {t("common.cancel")}<KeyHint shortcut="escape" />
          </button>
          <button type="button" className="modal-btn modal-btn--primary" onClick={() => void create()} disabled={!canSave} aria-busy={saving}>
            <ActionLabel busy={saving} busyLabel={t("common.saving")}>{t("projects.createProject")}</ActionLabel>
            <KeyHint shortcut="modEnter" />
          </button>
        </div>
      </section>
    </div>
  );
}
