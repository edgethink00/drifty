import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectInput, ProjectStatus } from "@drifty/domain";
import { formatCompactDurationFromSeconds } from "../../lib/formatting";
import { ProjectEditorModal } from "./ProjectEditorModal";
import { SettingsSelect } from "../settings/SettingsSelect";

const DEFAULT_PROJECT_COLOR = "#6366f1";

const LAST_ACTIVITY_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

type StatusFilter = "all" | ProjectStatus;

export interface ProjectsManagerProps {
  readonly projects: readonly Project[];
  /** Tracked seconds attributed to each project within the current trend window. */
  readonly totalSecondsByProject: ReadonlyMap<string, number>;
  /** Latest ISO day with attributed activity per project (within the loaded window). */
  readonly lastActivityByProject: ReadonlyMap<string, string>;
  /** Caption above the per-project total, e.g. "Last 14 days". */
  readonly totalCaption: string;
  readonly onSave: (input: ProjectInput) => void;
  readonly onDelete: (id: string) => void;
  /** Row click → project detail. */
  readonly onOpenProject: (projectId: string) => void;
  readonly busy?: boolean;
}

function truncateDescription(description: string, max = 72): string {
  const trimmed = description.trim();
  if (!trimmed) return "No description yet";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function formatLastActivity(day: string | undefined): string {
  if (!day) return "—";
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return LAST_ACTIVITY_FORMAT.format(parsed);
}

/**
 * Project library as a filterable table: search + status filter + "New project",
 * one row per project with a per-row ⋯ menu (edit / archive / delete). The
 * create/edit form lives in an on-demand modal. Signals are deliberately not
 * exposed here — the description is the project's definition, and the full text
 * is readable in the Edit modal.
 */
export function ProjectsManager({
  projects,
  totalSecondsByProject,
  lastActivityByProject,
  totalCaption,
  onSave,
  onDelete,
  onOpenProject,
  busy = false,
}: ProjectsManagerProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // null = closed; "new" = create; otherwise the project being edited.
  const [editing, setEditing] = useState<Project | "new" | null>(null);

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

  const handleStartEdit = (project: Project) => {
    setMenuFor(null);
    setEditing(project);
  };

  const handleToggleArchive = (project: Project) => {
    setMenuFor(null);
    onSave({
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      status: project.status === "archived" ? "active" : "archived",
    });
  };

  const emptyLabel = projects.length === 0
    ? "No projects yet. Create a project, then run analysis — descriptions guide the analysis model."
    : "No projects match.";

  return (
    <div className="projects-manager">
      <div className="projects-toolbar" aria-label="Project filters">
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
        <button type="button" className="settings-btn settings-btn--primary" disabled={busy} onClick={() => setEditing("new")}>
          + New project
        </button>
      </div>

      <div className="projects-table" role="table" aria-label="Projects">
        <div className="projects-table__head" role="row">
          <span>Project</span>
          <span>Last activity</span>
          <span>Status</span>
          <span>Total time</span>
          <span />
        </div>
        {filtered.map((project) => {
          const isArchived = project.status === "archived";
          const totalSeconds = totalSecondsByProject.get(project.id) ?? 0;
          return (
            <div
              className={`projects-table__rowwrap${isArchived ? " projects-table__rowwrap--archived" : ""}`}
              key={project.id}
            >
              <div className="projects-table__row" role="row" onClick={() => onOpenProject(project.id)}>
                <div className="pt-proj">
                  <span className="pt-swatch" style={{ background: project.color || DEFAULT_PROJECT_COLOR }} />
                  <div>
                    <strong>{project.name}</strong>
                    <small>{truncateDescription(project.description)}</small>
                  </div>
                </div>
                <span className="pt-mono">{formatLastActivity(lastActivityByProject.get(project.id))}</span>
                <span className={`chip${isArchived ? " gray" : " green"}`}>{isArchived ? "Archived" : "Active"}</span>
                <div className="pt-total">
                  <small>{totalCaption}</small>
                  <b>{totalSeconds > 0 ? formatCompactDurationFromSeconds(totalSeconds) : "0m"}</b>
                </div>
                <span className="pt-menu-slot">
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
                  {menuFor === project.id ? (
                    <div className="pt-menu" role="menu" aria-label="Project options">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleStartEdit(project);
                        }}
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M11.2 2.8a1.4 1.4 0 0 1 2 2L5.5 12.5l-2.7.7.7-2.7 7.7-7.7Z" /></svg>
                        Edit
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleArchive(project);
                        }}
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.2" y="3" width="11.6" height="2.6" rx="0.6" /><path d="M3.2 5.6v6.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6" /><path d="M6.4 8.2h3.2" /></svg>
                        {isArchived ? "Unarchive" : "Archive"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor(null);
                          onDelete(project.id);
                        }}
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.4h10M6.4 4.4V3.2a0.8 0.8 0 0 1 .8-.8h1.6a0.8 0.8 0 0 1 .8.8v1.2" /><path d="M4.3 4.4l.5 8a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.5-8" /><path d="M6.6 7v3.6M9.4 7v3.6" /></svg>
                        Delete
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

      {editing !== null ? (
        <ProjectEditorModal
          project={editing === "new" ? null : editing}
          projects={projects}
          busy={busy}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
