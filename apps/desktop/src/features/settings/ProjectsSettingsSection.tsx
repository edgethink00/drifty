import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Project, ProjectAnchor, ProjectInput, ProjectStatus } from "@drifty/domain";
import { ProjectColorPicker } from "./ProjectColorPicker";
import { firstUnusedProjectColor } from "./projectPalette";

const DEFAULT_PROJECT_COLOR = "#6366f1";

const ANCHOR_KIND_OPTIONS: ReadonlyArray<{ readonly value: ProjectAnchor["kind"]; readonly label: string }> = [
  { value: "app", label: "App" },
  { value: "domain", label: "Domain" },
  { value: "keyword", label: "Keyword" },
];

const DEFAULT_ANCHOR_DRAFT: AnchorDraft = { kind: "app", value: "" };

export interface ProjectsSettingsSectionProps {
  readonly projects: readonly Project[];
  readonly onSave: (input: ProjectInput) => void;
  readonly onDelete: (id: string) => void;
  readonly onAddAnchor: (projectId: string, kind: ProjectAnchor["kind"], value: string) => void;
  readonly onDeleteAnchor: (projectId: string, kind: ProjectAnchor["kind"], value: string) => void;
  /** Segments attributed to each project today, keyed by project id. */
  readonly segmentCounts?: ReadonlyMap<string, number>;
  readonly busy?: boolean;
}

interface ProjectFormDraft {
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly status: ProjectStatus;
}

interface AnchorDraft {
  readonly kind: ProjectAnchor["kind"];
  readonly value: string;
}

function emptyDraft(): ProjectFormDraft {
  return { name: "", description: "", color: DEFAULT_PROJECT_COLOR, status: "active" };
}

function anchorKindLabel(kind: ProjectAnchor["kind"]): string {
  return ANCHOR_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function truncateDescription(description: string, max = 120): string {
  const trimmed = description.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function ProjectsSettingsSection({
  projects,
  onSave,
  onDelete,
  onAddAnchor,
  onDeleteAnchor,
  segmentCounts,
  busy = false,
}: ProjectsSettingsSectionProps): JSX.Element {
  const [draft, setDraft] = useState<ProjectFormDraft>(emptyDraft);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [anchorDrafts, setAnchorDrafts] = useState<Record<string, AnchorDraft>>({});
  const [colorTouched, setColorTouched] = useState(false);
  // The create/edit form lives in an on-demand modal — it's an infrequent action
  // and shouldn't take up the page while you're reading your projects.
  const [editorOpen, setEditorOpen] = useState(false);

  const isEditing = Boolean(draft.id);
  const canSave = draft.name.trim().length > 0 && !busy;

  // Colors already taken by other active projects (exclude the one being edited).
  const usedColors = useMemo(
    () => projects.filter((project) => project.status === "active" && project.id !== draft.id).map((project) => project.color),
    [projects, draft.id],
  );
  // Suggest an unused color for a new project unless the user picked one.
  const suggestedColor = useMemo(() => firstUnusedProjectColor(usedColors), [usedColors]);
  const effectiveColor = isEditing || colorTouched ? draft.color : suggestedColor;

  const anchorDraftFor = (projectId: string): AnchorDraft => anchorDrafts[projectId] ?? DEFAULT_ANCHOR_DRAFT;
  const segmentCountFor = (projectId: string): number => segmentCounts?.get(projectId) ?? 0;

  const handleStartNew = () => {
    setDraft(emptyDraft());
    setColorTouched(false);
    setEditorOpen(true);
  };

  const handleStartEdit = (project: Project) => {
    setDraft({
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color || DEFAULT_PROJECT_COLOR,
      status: project.status,
    });
    setColorTouched(true);
    setEditorOpen(true);
  };

  const handleCancelEdit = () => {
    setDraft(emptyDraft());
    setColorTouched(false);
    setEditorOpen(false);
  };

  const handleSave = () => {
    const name = draft.name.trim();
    if (!name) return;
    const input: ProjectInput = {
      name,
      description: draft.description.trim(),
      color: effectiveColor,
      status: draft.status,
    };
    if (draft.id) input.id = draft.id;
    onSave(input);
    setDraft(emptyDraft());
    setColorTouched(false);
    setEditorOpen(false);
  };

  useEffect(() => {
    if (!editorOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleCancelEdit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editorOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleArchive = (project: Project) => {
    onSave({
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      status: project.status === "archived" ? "active" : "archived",
    });
  };

  const handleToggleAdvanced = (projectId: string) => {
    setExpanded((previous) => ({ ...previous, [projectId]: !previous[projectId] }));
  };

  const handleAnchorDraftChange = (projectId: string, patch: Partial<AnchorDraft>) => {
    setAnchorDrafts((previous) => {
      const current = previous[projectId] ?? DEFAULT_ANCHOR_DRAFT;
      return { ...previous, [projectId]: { ...current, ...patch } };
    });
  };

  const handleAddAnchor = (projectId: string) => {
    const anchorDraft = anchorDraftFor(projectId);
    const value = anchorDraft.value.trim();
    if (!value) return;
    onAddAnchor(projectId, anchorDraft.kind, value);
    setAnchorDrafts((previous) => ({ ...previous, [projectId]: { kind: anchorDraft.kind, value: "" } }));
  };

  return (
    <div className="projects-manager">
      <div className="projects-list">
        <ul className="projects-list__items" aria-label="Projects">
          {projects.map((project) => {
              const isOpen = Boolean(expanded[project.id]);
              const isArchived = project.status === "archived";
              const anchorDraft = anchorDraftFor(project.id);
              const advancedId = `projects-advanced-${project.id}`;
              const displayDescription = project.description.trim() ? truncateDescription(project.description) : "No description yet";
              const segments = segmentCountFor(project.id);
              return (
                <li
                  key={project.id}
                  className={`project-card project-card--accented${isArchived ? " project-card--archived" : ""}`}
                  style={{ "--pc-color": project.color || DEFAULT_PROJECT_COLOR } as CSSProperties}
                  aria-label={project.name}
                >
                  <div className="project-card__body">
                    <div className="project-card__topline">
                      <span className="project-card__name">{project.name}</span>
                      <span className={`chip${isArchived ? " gray" : " green"} project-card__status`}>{isArchived ? "Archived" : "Active"}</span>
                    </div>
                    <p className="project-card__desc">{displayDescription}</p>
                    <div className="project-card__meta">
                      <span>{segments} segments today</span>
                      {project.anchors.length > 0 ? <span>· {project.anchors.length} signals</span> : null}
                    </div>
                    <div className="project-card__actions">
                      <button type="button" className="project-card__action" onClick={() => handleStartEdit(project)} disabled={busy} aria-label="Edit" title="Edit">
                        <EditIcon />
                      </button>
                      <button type="button" className="project-card__action" onClick={() => handleToggleArchive(project)} disabled={busy} aria-label={isArchived ? "Unarchive" : "Archive"} title={isArchived ? "Unarchive" : "Archive"}>
                        <ArchiveIcon />
                      </button>
                      <button type="button" className="project-card__action project-card__action--danger" onClick={() => onDelete(project.id)} disabled={busy} aria-label="Delete" title="Delete">
                        <TrashIcon />
                      </button>
                    </div>
                    <div className="project-card__disclosure">
                      <button type="button" className="project-advanced-toggle" aria-expanded={isOpen} aria-controls={advancedId} onClick={() => handleToggleAdvanced(project.id)}>
                        Advanced signals
                      </button>
                      {isOpen ? (
                        <div id={advancedId} className="project-advanced" role="group" aria-label={`Signals for ${project.name}`}>
                          <p className="project-advanced__hint">Signals are learned automatically as you confirm what this project looks like. Editing them here is optional.</p>
                          {project.anchors.length === 0 ? (
                            <p className="project-advanced__empty">No signals yet.</p>
                          ) : (
                            <ul className="projects-anchor-chips" aria-label={`Signal list for ${project.name}`}>
                              {project.anchors.map((anchor) => (
                                <li key={`${anchor.kind}:${anchor.value}`} className="projects-anchor-chip">
                                  <span className="projects-anchor-chip__kind">{anchorKindLabel(anchor.kind)}</span>
                                  <span className="projects-anchor-chip__value">{anchor.value}</span>
                                  <span className="projects-anchor-chip__source">{anchor.source === "harvested" ? "auto" : "manual"}</span>
                                  <button
                                    type="button"
                                    className="projects-anchor-chip__remove"
                                    aria-label={`Remove ${anchorKindLabel(anchor.kind)} signal ${anchor.value}`}
                                    onClick={() => onDeleteAnchor(project.id, anchor.kind, anchor.value)}
                                  >
                                    <span aria-hidden="true">×</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="projects-anchor-add">
                            <select
                              className="settings-input projects-anchor-add__kind"
                              aria-label={`New signal type for ${project.name}`}
                              value={anchorDraft.kind}
                              onChange={(event) => handleAnchorDraftChange(project.id, { kind: event.target.value as ProjectAnchor["kind"] })}
                            >
                              {ANCHOR_KIND_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <input
                              className="settings-input projects-anchor-add__value"
                              type="text"
                              aria-label={`New signal value for ${project.name}`}
                              placeholder="e.g. figma.com"
                              value={anchorDraft.value}
                              onChange={(event) => handleAnchorDraftChange(project.id, { value: event.target.value })}
                            />
                            <button
                              type="button"
                              className="settings-btn"
                              aria-label={`Add signal to ${project.name}`}
                              onClick={() => handleAddAnchor(project.id)}
                              disabled={busy || !anchorDraft.value.trim()}
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          <li className="project-card project-card--add">
            <button
              type="button"
              className="project-card__add"
              onClick={handleStartNew}
              disabled={busy}
              aria-label="New project"
            >
              <span className="project-card__add-plus" aria-hidden="true">+</span>
              <span className="project-card__add-label">New project</span>
            </button>
          </li>
        </ul>
      </div>

      {editorOpen ? (
        <div className="auth-modal__overlay" onClick={handleCancelEdit}>
          <section
            className="auth-modal projects-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="projects-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="auth-modal__header">
              <h2 id="projects-editor-title">{isEditing ? "Edit project" : "New project"}</h2>
            </div>
            <div className="projects-editor__card">
              <div className="projects-field">
                <label className="projects-field__label" htmlFor="projects-name-input">Project name</label>
                <p className="projects-field__hint">A short label like "Q3 marketing site".</p>
                <input
                  id="projects-name-input"
                  className="settings-input projects-field__input"
                  type="text"
                  value={draft.name}
                  placeholder="Project name"
                  onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
                />
              </div>
              <div className="projects-field">
                <label className="projects-field__label" htmlFor="projects-description-input">Description</label>
                <p className="projects-field__hint">This is the primary signal. Describe the project the way you'd explain it to a teammate.</p>
                <textarea
                  id="projects-description-input"
                  className="settings-input projects-field__input projects-field__textarea"
                  rows={4}
                  value={draft.description}
                  placeholder="e.g. Everything for the Q3 marketing site redesign — Figma mockups, the Next.js repo, and launch-planning docs."
                  onChange={(event) => setDraft((previous) => ({ ...previous, description: event.target.value }))}
                />
              </div>
              <div className="projects-field projects-field--color">
                <span className="projects-field__label">Color</span>
                <p className="projects-field__hint">Used in charts and summaries. Colors used by other projects are dimmed.</p>
                <ProjectColorPicker
                  value={effectiveColor}
                  usedColors={usedColors}
                  onChange={(color) => {
                    setDraft((previous) => ({ ...previous, color }));
                    setColorTouched(true);
                  }}
                />
              </div>
            </div>
            <div className="projects-editor__actions">
              <button type="button" className="settings-btn" onClick={handleCancelEdit} disabled={busy}>Cancel</button>
              <button type="button" className="settings-btn settings-btn--primary" onClick={handleSave} disabled={!canSave}>
                {isEditing ? "Save changes" : "Create project"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function EditIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.2 2.8a1.4 1.4 0 0 1 2 2L5.5 12.5l-2.7.7.7-2.7 7.7-7.7Z" />
    </svg>
  );
}

function ArchiveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.2" y="3" width="11.6" height="2.6" rx="0.6" />
      <path d="M3.2 5.6v6.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6" />
      <path d="M6.4 8.2h3.2" />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.4h10M6.4 4.4V3.2a0.8 0.8 0 0 1 .8-.8h1.6a0.8 0.8 0 0 1 .8.8v1.2" />
      <path d="M4.3 4.4l.5 8a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.5-8" />
      <path d="M6.6 7v3.6M9.4 7v3.6" />
    </svg>
  );
}
