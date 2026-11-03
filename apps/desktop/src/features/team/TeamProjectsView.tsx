import { useEffect, useMemo, useRef, useState } from "react";
import { KeyHint } from "../../components/KeyHint";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";

import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { SettingsSelect } from "../settings/SettingsSelect";
import { firstUnusedProjectColor } from "../settings/projectPalette";
import { TeamProjectDetailView } from "./TeamProjectDetailView";
import { ModalPresence } from "../../components/ModalPresence";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ProjectEditorFields } from "../../components/ProjectEditorFields";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import type { TeamProject, TeamProjectAnchor, TeamProjectMemberRow, TeamProjectMixRow } from "./teamTypes";
import { teamWindowCaption } from "./teamWindowCaption";
import type { TeamProjectsWindow } from "./useTeamProjects";

export type TeamProjectDraft = {
  readonly name: string;
  readonly description?: string | null;
  readonly color?: string | null;
  readonly anchors?: readonly TeamProjectAnchor[] | null;
};

export type TeamProjectsViewProps = {
  readonly teamName: string;
  readonly projects: readonly TeamProject[];
  readonly mix: readonly TeamProjectMixRow[];
  readonly members: readonly TeamProjectMemberRow[];
  /** False when this seat sees no team totals here (too few people share, or a member whose team keeps its summary). */
  readonly totalsShown?: boolean;
  /** False when people are not shown to this seat or projects are not shared per person. */
  readonly memberSplitShown?: boolean;
  readonly memberDisplayName: string | null;
  readonly window: TeamProjectsWindow;
  /** Whether the window ends today; earlier windows name their dates. */
  readonly isLatestWindow: boolean;
  /** Changes when the already-open Projects tab is pressed again, returning to the list. */
  readonly listResetSignal?: number;
  /** Changes to open the new-project editor, as from a new team's first screen. */
  readonly createSignal?: number;
  /** Called once the editor opened for createSignal, so a later visit does not open it again. */
  readonly onCreateSignalHandled?: () => void;
  readonly loading: boolean;
  readonly error: string | null;
  readonly actionError: string | null;
  readonly actionLoading: boolean;
  readonly onCreate: (draft: TeamProjectDraft) => void;
  readonly onUpdate: (input: {
    readonly project_id: string;
    readonly name: string;
    readonly description?: string | null;
    readonly color?: string | null;
    readonly anchors?: readonly TeamProjectAnchor[] | null;
  }) => void;
  readonly onArchive: (projectId: string, archived: boolean) => void;
};

type StatusFilter = "all" | "active" | "archived";

type EditorState = {
  readonly mode: "create" | "edit";
  readonly project: TeamProject | null;
};

function ProjectEditorModal({
  state,
  projects,
  teamName,
  actionLoading,
  actionError,
  onClose,
  onCreate,
  onUpdate,
}: {
  readonly state: EditorState;
  readonly projects: readonly TeamProject[];
  readonly teamName: string;
  readonly actionLoading: boolean;
  readonly actionError: string | null;
  readonly onClose: () => void;
  readonly onCreate: TeamProjectsViewProps["onCreate"];
  readonly onUpdate: TeamProjectsViewProps["onUpdate"];
}): JSX.Element {
  const { t } = useLocalization();
  const project = state.project;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const takenColors = projects.filter((item) => item.status === "active" && item.id !== project?.id).map((item) => item.color);
  const [initialColor] = useState(() => project?.color || firstUnusedProjectColor(takenColors));
  const [color, setColor] = useState(initialColor);
  const dialogRef = useRef<HTMLElement>(null);

  useModalDismiss(onClose, { disabled: actionLoading });
  const hasUnsavedInput = name !== (project?.name ?? "")
    || description !== (project?.description ?? "")
    || color !== initialColor;
  const overlayDismiss = useOverlayDismiss(onClose, { disabled: actionLoading, keepOpen: hasUnsavedInput });


  // The editor is deliberately signal-free — the description is the project's
  // definition. Signals keep whatever the project already has (harvested/auto).
  const submit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (state.mode === "edit" && project) {
      onUpdate({ project_id: project.id, name: trimmedName, description: description.trim(), color, anchors: project.anchors });
    } else {
      onCreate({ name: trimmedName, description: description.trim(), color });
    }
  };
  useModalSubmitShortcut(dialogRef, "modEnter", submit, { disabled: actionLoading || !name.trim() });

  return (
    <div className="auth-modal__overlay" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="auth-modal modal-shell profile-modal team-modal project-editor-modal"
        data-modal-variant="standard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label={t("team.editor.close")} onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="team-editor-title">{state.mode === "edit" ? t("team.editor.editTitle") : t("team.editor.newTitle")}</h2>
            <p>{t("team.editor.subtitle", { team: teamName })}</p>
          </div>
        </div>
        <div className="team-modal__body project-editor-modal__body">
          <ProjectEditorFields
            idPrefix="team-project"
            name={name}
            description={description}
            color={color}
            usedColors={new Set(takenColors)}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onColorChange={setColor}
          />
          {actionError ? <p className="team-message team-message--error">{actionError}</p> : null}
          <div className="modal-foot team-modal__actions">
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("common.cancel")}<KeyHint shortcut="escape" /></button>
            <button type="button" className="modal-btn modal-btn--primary" disabled={actionLoading || !name.trim()} onClick={submit}>
              {state.mode === "edit" ? t("team.editor.save") : t("team.editor.create")}
              <KeyHint shortcut="modEnter" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Shared projects table: search + status filter, expandable rows (description +
 * signal chips), and a per-row menu for edit/archive. Anyone on the team can add
 * a project; edit/archive respects each project's `can_manage`.
 */
export function TeamProjectsView({
  teamName,
  projects,
  mix,
  members,
  totalsShown = true,
  memberSplitShown = true,
  memberDisplayName,
  window: timeWindow,
  isLatestWindow,
  listResetSignal = 0,
  createSignal = 0,
  onCreateSignalHandled,
  loading,
  error,
  actionError,
  actionLoading,
  onCreate,
  onUpdate,
  onArchive,
}: TeamProjectsViewProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (listResetSignal > 0) setSelectedProjectId(null);
  }, [listResetSignal]);
  // A new team's first screen asks for its first project here.
  useEffect(() => {
    if (createSignal <= 0) return;
    setEditor({ mode: "create", project: null });
    onCreateSignalHandled?.();
  }, [createSignal, onCreateSignalHandled]);

  const secondsByProjectId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of mix) {
      const seconds = Number.isFinite(row.seconds) ? Math.max(0, row.seconds) : 0;
      if (seconds <= 0) continue;
      map.set(row.organization_project_id, (map.get(row.organization_project_id) ?? 0) + seconds);
    }
    return map;
  }, [mix]);

  const filtered = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (statusFilter !== "all" && project.status !== statusFilter) return false;
      if (trimmedQuery && !project.name.toLowerCase().includes(trimmedQuery)) return false;
      return true;
    });
  }, [projects, query, statusFilter]);

  useEffect(() => {
    if (menuFor === null) return;
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".pt-menu") || target?.closest(".pt-more")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuFor]);

  useEffect(() => {
    if (menuFor === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuFor(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuFor]);

  // Close the editor once its save round-trip finishes without an error.
  // `projects` is a dependency so a list change also closes it (covers flows
  // that resolve without a loading cycle, e.g. the QA mock).
  useEffect(() => {
    if (!submittedRef.current || actionLoading) return;
    if (actionError) {
      submittedRef.current = false;
      return;
    }
    submittedRef.current = false;
    setEditor(null);
  }, [actionError, actionLoading, projects]);

  const startCreate = () => setEditor({ mode: "create", project: null });
  const startEdit = (project: TeamProject) => {
    setMenuFor(null);
    setEditor({ mode: "edit", project });
  };

  const selectedProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId) ?? null
    : null;
  useEffect(() => {
    if (selectedProjectId && !selectedProject) setSelectedProjectId(null);
  }, [selectedProjectId, selectedProject]);

  const windowCaption = teamWindowCaption(timeWindow, isLatestWindow, effectiveLanguage, t);
  const emptyLabel = projects.length === 0
    ? loading
      ? t("team.projects.loading")
      : t("team.projects.empty")
    : t("team.projects.noMatch");

  if (selectedProject) {
    return (
      <section className="team-data-panel" aria-label={t("team.projects.aria")}>
        <TeamProjectDetailView
          project={selectedProject}
          mix={mix}
          members={members}
          totalsShown={totalsShown}
          memberSplitShown={memberSplitShown}
          window={timeWindow}
          isLatestWindow={isLatestWindow}
          memberDisplayName={memberDisplayName}
          loading={loading}
          actionLoading={actionLoading}
          onBack={() => setSelectedProjectId(null)}
          onEdit={startEdit}
          onArchive={onArchive}
        />
        {actionError && !editor ? <p className="team-message team-message--error">{actionError}</p> : null}
        <ModalPresence>
          {editor ? (
          <ProjectEditorModal
            state={editor}
            projects={projects}
            teamName={teamName}
            actionLoading={actionLoading}
            actionError={actionError}
            onClose={() => setEditor(null)}
            onCreate={(draft) => {
              submittedRef.current = true;
              onCreate(draft);
            }}
            onUpdate={(input) => {
              submittedRef.current = true;
              onUpdate(input);
            }}
          />
          ) : null}
        </ModalPresence>
      </section>
    );
  }

  return (
    <section className="team-data-panel" aria-label={t("team.projects.aria")}>
      <div className="team-dash-section">
        <div className="projects-toolbar" aria-label={t("team.projects.filtersAria")}>
          <span className="projects-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              className="settings-input"
              type="text"
              aria-label={t("team.projects.searchAria")}
              placeholder={t("team.projects.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <SettingsSelect
            ariaLabel={t("team.projects.statusFilterAria")}
            className="projects-status-filter"
            value={statusFilter}
            options={[
              { value: "all", label: t("team.projects.allStatuses") },
              { value: "active", label: t("team.projects.active") },
              { value: "archived", label: t("team.projects.archived") },
            ]}
            onChange={setStatusFilter}
          />
          <span className="projects-toolbar__spacer" />
          <button type="button" className="app-btn app-btn--primary" disabled={actionLoading} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); startCreate(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            {t("team.projects.new")}
          </button>
        </div>

        {error ? <p className="team-message team-message--error">{error}</p> : null}
        {actionError && !editor ? <p className="team-message team-message--error">{actionError}</p> : null}

        <div className="projects-table" role="region" aria-label={t("team.projects.aria")}>
          <div className="projects-table__head">
            <span>{t("team.projects.headerProject")}</span>
            <span>{t("team.projects.headerStatus")}</span>
            <span>{totalsShown ? t("team.projects.headerTeamTimeCaption", { caption: windowCaption }) : ""}</span>
            <span><span className="sr-only">{t("team.projects.headerActions")}</span></span>
          </div>
          {filtered.map((project) => {
            const isArchived = project.status === "archived";
            const totalSeconds = secondsByProjectId.get(project.id) ?? 0;
            const descShort = project.description.trim() || t("team.projects.noDescription");
            const projectName = project.name || t("team.projects.untitled");
            return (
              <div
                className={`projects-table__rowwrap${isArchived ? " projects-table__rowwrap--archived" : ""}`}
                key={project.id}
              >
                <div className="projects-table__row" onClick={() => setSelectedProjectId(project.id)}>
                  <div className="pt-proj">
                    <span className="pt-swatch" style={{ background: project.color }} />
                    <button
                      type="button"
                      className="projects-table__open"
                      aria-label={t("team.projects.openAria", { name: projectName })}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedProjectId(project.id);
                      }}
                    >
                      <strong>{projectName}</strong>
                      <small>{descShort}</small>
                    </button>
                  </div>
                  {/* As in the personal table: every live project is Active, so only
                      Archived keeps the chip. */}
                  {isArchived ? (
                    <span className="chip gray">{t("team.projects.archived")}</span>
                  ) : (
                    <span className="pt-status">{t("team.projects.active")}</span>
                  )}
                  <div className="pt-total">
                    {/* The window is in the toolbar above; each row only carries its total. */}
                    <b>{!totalsShown ? "" : totalSeconds > 0 ? formatLocalizedCompactDurationFromSeconds(totalSeconds, effectiveLanguage) : "—"}</b>
                  </div>
                  <span className="pt-menu-slot">
                    {project.can_manage ? (
                      <button
                        type="button"
                        className="pt-more"
                        aria-label={t("team.projects.optionsAria", { name: projectName })}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === project.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          menuTrigger.current = event.currentTarget;
                          setMenuFor((current) => (current === project.id ? null : project.id));
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.6" r="1.7" /></svg>
                      </button>
                    ) : null}
                    <AnchoredPresence>{menuFor === project.id ? (
                      <div className="pt-menu" role="menu" aria-label={t("team.projects.options")}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation();
                            // Keep the return target outside the disappearing menu.
                            menuTrigger.current?.focus({ preventScroll: true });
                            startEdit(project);
                          }}
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11.2 2.8a1.4 1.4 0 0 1 2 2L5.5 12.5l-2.7.7.7-2.7 7.7-7.7Z" /></svg>
                          {t("team.projects.edit")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={actionLoading}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuFor(null);
                            onArchive(project.id, !isArchived);
                          }}
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.2" y="3" width="11.6" height="2.6" rx="0.6" /><path d="M3.2 5.6v6.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6" /><path d="M6.4 8.2h3.2" /></svg>
                          {isArchived ? t("team.projects.restore") : t("team.projects.archive")}
                        </button>
                      </div>
                    ) : null}</AnchoredPresence>
                  </span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 ? <div className="projects-table__empty"><span>{emptyLabel}</span></div> : null}
        </div>
      </div>

      <ModalPresence>
        {editor ? (
        <ProjectEditorModal
          state={editor}
          projects={projects}
          teamName={teamName}
          actionLoading={actionLoading}
          actionError={actionError}
          onClose={() => setEditor(null)}
          onCreate={(draft) => {
            submittedRef.current = true;
            onCreate(draft);
          }}
          onUpdate={(input) => {
            submittedRef.current = true;
            onUpdate(input);
          }}
        />
        ) : null}
      </ModalPresence>
    </section>
  );
}

export default TeamProjectsView;
