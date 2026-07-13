import { useEffect, useMemo, useRef, useState } from "react";

import { formatCompactDurationFromSeconds } from "../../lib/formatting";
import { SettingsSelect } from "../settings/SettingsSelect";
import { TeamProjectDetailView } from "./TeamProjectDetailView";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import type { TeamProject, TeamProjectAnchor, TeamProjectMemberRow, TeamProjectMixRow } from "./teamTypes";
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
  readonly memberDisplayName: string | null;
  readonly window: TeamProjectsWindow;
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

type StatusFilter = "all" | "active" | "archived";

type EditorState = {
  readonly mode: "create" | "edit";
  readonly project: TeamProject | null;
};

function ProjectEditorModal({
  state,
  teamName,
  actionLoading,
  actionError,
  onClose,
  onCreate,
  onUpdate,
}: {
  readonly state: EditorState;
  readonly teamName: string;
  readonly actionLoading: boolean;
  readonly actionError: string | null;
  readonly onClose: () => void;
  readonly onCreate: TeamProjectsViewProps["onCreate"];
  readonly onUpdate: TeamProjectsViewProps["onUpdate"];
}): JSX.Element {
  const project = state.project;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color || COLOR_SWATCHES[0].color);
  const [colorOpen, setColorOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const colorName = COLOR_SWATCHES.find((swatch) => swatch.color === color)?.name ?? "Custom";

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

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section
        className="auth-modal profile-modal team-modal team-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalCloseButton label="Close project editor" onClick={onClose} />
        <div className="modal-head">
          <div className="modal-head__copy">
            <h2 id="team-editor-title">{state.mode === "edit" ? "Edit project" : "New shared project"}</h2>
            <p>{teamName} · shared project</p>
          </div>
        </div>
        <div className="team-modal__body">
          <div className="team-modal__field">
            <span className="label-mono">Name</span>
            <input
              className="settings-input"
              type="text"
              value={name}
              maxLength={120}
              autoFocus
              placeholder="e.g. Q3 launch"
              aria-label="Project name"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="team-modal__field">
            <span className="label-mono">Description</span>
            <textarea
              className="settings-input"
              value={description}
              maxLength={2000}
              placeholder="What counts toward this project? Drifty matches activity from this."
              aria-label="Project description"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="team-editor-inline">
            <div className={`team-pick${colorOpen ? " is-open" : ""}`}>
              <span className="label-mono">Color</span>
              <button type="button" className="team-pick__trigger" aria-expanded={colorOpen} onClick={() => setColorOpen((open) => !open)}>
                <span className="team-pick__swatch" style={{ background: color }} />
                <span className="team-pick__val">{colorName}</span>
                <svg className="team-pick__chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
              </button>
              {colorOpen ? (
                <div className="team-pick__pop" role="radiogroup" aria-label="Project color">
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      type="button"
                      className={swatch.color === color ? "team-swatch team-swatch--on" : "team-swatch"}
                      style={{ background: swatch.color }}
                      role="radio"
                      aria-checked={swatch.color === color}
                      aria-label={`Color ${swatch.name}`}
                      key={swatch.color}
                      onClick={() => {
                        setColor(swatch.color);
                        setColorOpen(false);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {actionError ? <p className="team-message team-message--error">{actionError}</p> : null}
          <div className="modal-foot team-modal__actions">
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="modal-btn modal-btn--primary" disabled={actionLoading || !name.trim()} onClick={submit}>
              {state.mode === "edit" ? "Save changes" : "Create project"}
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
  memberDisplayName,
  window: timeWindow,
  loading,
  error,
  actionError,
  actionLoading,
  onCreate,
  onUpdate,
  onArchive,
}: TeamProjectsViewProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const submittedRef = useRef(false);

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

  const windowDays = (() => {
    const start = Date.parse(`${timeWindow.start_date}T00:00:00Z`);
    const end = Date.parse(`${timeWindow.end_date}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
    return Math.round((end - start) / 86_400_000) + 1;
  })();
  const totalCaption = windowDays <= 1 ? "Today" : `Last ${windowDays} days`;

  const emptyLabel = projects.length === 0
    ? loading
      ? "Loading shared projects…"
      : "No shared projects yet. Create the first one — the definition syncs to every member's Mac."
    : "No projects match.";

  if (selectedProject) {
    return (
      <section className="team-data-panel" aria-label="Shared projects">
        <TeamProjectDetailView
          project={selectedProject}
          mix={mix}
          members={members}
          window={timeWindow}
          memberDisplayName={memberDisplayName}
          loading={loading}
          actionLoading={actionLoading}
          onBack={() => setSelectedProjectId(null)}
          onEdit={startEdit}
          onArchive={onArchive}
        />
        {actionError && !editor ? <p className="team-message team-message--error">{actionError}</p> : null}
        {editor ? (
          <ProjectEditorModal
            state={editor}
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
      </section>
    );
  }

  return (
    <section className="team-data-panel" aria-label="Shared projects">
      <div className="team-dash-section">
        <div className="projects-toolbar" aria-label="Shared project filters">
          <span className="projects-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              className="settings-input"
              type="text"
              aria-label="Search project name"
              placeholder="Search project name…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
          <SettingsSelect
            ariaLabel="Filter by status"
            className="projects-status-filter"
            value={statusFilter}
            options={[
              { value: "all", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
            ]}
            onChange={setStatusFilter}
          />
          <span className="projects-toolbar__spacer" />
          <button type="button" className="settings-btn settings-btn--primary" disabled={actionLoading} onClick={startCreate}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            New project
          </button>
        </div>

        {error ? <p className="team-message team-message--error">{error}</p> : null}
        {actionError && !editor ? <p className="team-message team-message--error">{actionError}</p> : null}

        <div className="projects-table" role="table" aria-label="Shared projects">
          <div className="projects-table__head" role="row">
            <span>Project</span>
            <span>Status</span>
            <span>Team time</span>
            <span />
          </div>
          {filtered.map((project) => {
            const isArchived = project.status === "archived";
            const totalSeconds = secondsByProjectId.get(project.id) ?? 0;
            const descShort = project.description.trim() || "No description yet";
            return (
              <div
                className={`projects-table__rowwrap${isArchived ? " projects-table__rowwrap--archived" : ""}`}
                key={project.id}
              >
                <div className="projects-table__row" role="row" onClick={() => setSelectedProjectId(project.id)}>
                  <div className="pt-proj">
                    <span className="pt-swatch" style={{ background: project.color }} />
                    <div>
                      <strong>{project.name || "Untitled project"}</strong>
                      <small>{descShort}</small>
                    </div>
                  </div>
                  <span className={`chip${isArchived ? " gray" : " green"}`}>{isArchived ? "Archived" : "Active"}</span>
                  <div className="pt-total">
                    <small>{totalCaption}</small>
                    <b>{totalSeconds > 0 ? formatCompactDurationFromSeconds(totalSeconds) : "0m"}</b>
                  </div>
                  <span className="pt-menu-slot">
                    {project.can_manage ? (
                      <button
                        type="button"
                        className="pt-more"
                        aria-label={`Options for ${project.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === project.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor((current) => (current === project.id ? null : project.id));
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.6" r="1.7" /></svg>
                      </button>
                    ) : null}
                    {menuFor === project.id ? (
                      <div className="pt-menu" role="menu" aria-label="Project options">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation();
                            startEdit(project);
                          }}
                        >
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11.2 2.8a1.4 1.4 0 0 1 2 2L5.5 12.5l-2.7.7.7-2.7 7.7-7.7Z" /></svg>
                          Edit
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
                          {isArchived ? "Restore" : "Archive"}
                        </button>
                      </div>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 ? <div className="projects-table__empty">{emptyLabel}</div> : null}
        </div>
      </div>

      {editor ? (
        <ProjectEditorModal
          state={editor}
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
    </section>
  );
}

export default TeamProjectsView;
