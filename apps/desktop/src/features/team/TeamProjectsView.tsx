import { useEffect, useMemo, useState } from "react";
import type { TeamProject, TeamProjectAnchor } from "./teamTypes";
import "./team-projects.css";

export type TeamProjectDraft = {
  readonly name: string;
  readonly description?: string | null;
  readonly color?: string | null;
  readonly anchors?: readonly TeamProjectAnchor[] | null;
};

export type TeamProjectsViewProps = {
  readonly teamName: string;
  readonly projects: readonly TeamProject[];
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

const COLOR_PRESETS = [
  "#6f9a4b",
  "#c98a3c",
  "#4c86b5",
  "#a05fb0",
  "#c25f6e",
  "#4fa6a0",
  "#b7953d",
  "#7f7bce",
] as const;

const ANCHOR_KINDS = ["app", "domain", "keyword"] as const;
type AnchorKind = (typeof ANCHOR_KINDS)[number];

type AnchorRow = { readonly kind: AnchorKind; readonly value: string };

// ---- Icons ----

function PencilIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4L6 13.4l-3 .6.6-3 7.7-8.7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArchiveBoxIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="4.5" width="12" height="8.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 3.5h13v2h-13z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.5 8h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function CaretIcon({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <svg
      className={`tpj-archived-caret${open ? " tpj-archived-caret--open" : ""}`}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- Anchor summary chips ----

function AnchorSummary({ anchors }: { readonly anchors: readonly TeamProjectAnchor[] }): JSX.Element | null {
  const grouped = useMemo(() => {
    const map = new Map<AnchorKind, string[]>();
    for (const anchor of anchors) {
      const kind = anchor.kind as AnchorKind;
      const list = map.get(kind) ?? [];
      list.push(anchor.value);
      map.set(kind, list);
    }
    return ANCHOR_KINDS.map((kind) => ({ kind, values: map.get(kind) ?? [] })).filter(
      (group) => group.values.length > 0,
    );
  }, [anchors]);

  if (anchors.length === 0) {
    return <span className="tpj-muted">No signals yet</span>;
  }

  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {grouped.map((group) => (
        <div className="tpj-anchor-group" key={group.kind}>
          <span className="tpj-anchor-kind">{group.kind}</span>
          <div className="tpj-chips">
            {group.values.map((value, index) => (
              <span className="tpj-chip" key={`${group.kind}-${index}`}>
                {value}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Editor modal ----

type EditorState = {
  readonly mode: "create" | "edit";
  readonly project: TeamProject | null;
};

function ProjectEditorModal({
  state,
  actionLoading,
  actionError,
  onClose,
  onCreate,
  onUpdate,
}: {
  readonly state: EditorState;
  readonly actionLoading: boolean;
  readonly actionError: string | null;
  readonly onClose: () => void;
  readonly onCreate: TeamProjectsViewProps["onCreate"];
  readonly onUpdate: TeamProjectsViewProps["onUpdate"];
}): JSX.Element {
  const editing = state.mode === "edit" ? state.project : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [color, setColor] = useState<string>(editing?.color ?? COLOR_PRESETS[0]);
  const [anchors, setAnchors] = useState<AnchorRow[]>(
    editing
      ? editing.anchors.map((anchor) => ({ kind: anchor.kind as AnchorKind, value: anchor.value }))
      : [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && !actionLoading;

  const updateAnchor = (index: number, patch: Partial<AnchorRow>) => {
    setAnchors((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeAnchor = (index: number) => {
    setAnchors((rows) => rows.filter((_, i) => i !== index));
  };

  const addAnchor = () => {
    setAnchors((rows) => [...rows, { kind: "app", value: "" }]);
  };

  const handleSave = () => {
    if (!canSave) return;
    const cleanAnchors: TeamProjectAnchor[] = anchors
      .map((row) => ({ kind: row.kind, value: row.value.trim() }))
      .filter((row) => row.value.length > 0);
    const trimmedDescription = description.trim();

    if (state.mode === "edit" && editing) {
      onUpdate({
        project_id: editing.id,
        name: trimmedName,
        description: trimmedDescription.length > 0 ? trimmedDescription : null,
        color,
        anchors: cleanAnchors,
      });
    } else {
      onCreate({
        name: trimmedName,
        description: trimmedDescription.length > 0 ? trimmedDescription : null,
        color,
        anchors: cleanAnchors,
      });
    }
    onClose();
  };

  return (
    <div
      className="tpj-modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="tpj-modal"
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === "edit" ? "Edit project" : "New project"}
      >
        <h3 className="tpj-modal-title">{state.mode === "edit" ? "Edit project" : "New project"}</h3>

        {actionError ? <p className="tpj-warn">{actionError}</p> : null}

        <div className="tpj-field">
          <label className="tpj-label" htmlFor="tpj-name">
            Name
          </label>
          <input
            id="tpj-name"
            className="tpj-input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Q3 launch"
            autoFocus
          />
        </div>

        <div className="tpj-field">
          <label className="tpj-label" htmlFor="tpj-desc">
            Description
          </label>
          <textarea
            id="tpj-desc"
            className="tpj-textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What counts toward this project?"
          />
        </div>

        <div className="tpj-field">
          <span className="tpj-label">Color</span>
          <div className="tpj-swatches" role="radiogroup" aria-label="Project color">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`tpj-swatch${color === preset ? " tpj-swatch--selected" : ""}`}
                style={{ background: preset }}
                onClick={() => setColor(preset)}
                role="radio"
                aria-checked={color === preset}
                aria-label={`Color ${preset}`}
              />
            ))}
          </div>
        </div>

        <div className="tpj-field">
          <span className="tpj-label">Signals</span>
          <div className="tpj-anchor-rows">
            {anchors.map((row, index) => (
              <div className="tpj-anchor-row" key={index}>
                <select
                  className="tpj-select"
                  value={row.kind}
                  onChange={(event) => updateAnchor(index, { kind: event.target.value as AnchorKind })}
                  aria-label={`Signal ${index + 1} kind`}
                >
                  {ANCHOR_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
                <input
                  className="tpj-input"
                  type="text"
                  value={row.value}
                  onChange={(event) => updateAnchor(index, { value: event.target.value })}
                  placeholder={row.kind === "domain" ? "figma.com" : row.kind === "app" ? "Figma" : "keyword"}
                  aria-label={`Signal ${index + 1} value`}
                />
                <button
                  type="button"
                  className="tpj-icon-btn"
                  onClick={() => removeAnchor(index)}
                  aria-label={`Remove signal ${index + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="tpj-btn tpj-btn--ghost" onClick={addAnchor}>
              + Add signal
            </button>
          </div>
        </div>

        <div className="tpj-modal-actions">
          <button
            type="button"
            className="tpj-btn tpj-btn--ghost"
            onClick={onClose}
            aria-label="Cancel"
          >
            Cancel
          </button>
          <span className="tpj-spacer" />
          <button
            type="button"
            className="tpj-btn tpj-btn--accent"
            onClick={handleSave}
            disabled={!canSave}
            aria-label="Save project"
          >
            {actionLoading ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Card ----

function ProjectCard({
  project,
  onEdit,
  onArchive,
}: {
  readonly project: TeamProject;
  readonly onEdit: (project: TeamProject) => void;
  readonly onArchive: (projectId: string, archived: boolean) => void;
}): JSX.Element {
  const swatchColor = project.color && project.color.trim().length > 0 ? project.color : "#9ca3af";
  return (
    <div className="tpj-card">
      <div className="tpj-card-top">
        <span className="tpj-card-swatch" style={{ background: swatchColor }} />
        <span className="tpj-card-name">{project.name || "Untitled project"}</span>
        {project.can_manage ? (
          <div className="tpj-card-actions">
            <button
              type="button"
              className="tpj-icon-btn"
              onClick={() => onEdit(project)}
              aria-label={`Edit ${project.name}`}
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              className="tpj-icon-btn"
              onClick={() => onArchive(project.id, true)}
              aria-label={`Archive ${project.name}`}
            >
              <ArchiveBoxIcon />
            </button>
          </div>
        ) : null}
      </div>

      {project.description ? <p className="tpj-card-desc">{project.description}</p> : null}

      <AnchorSummary anchors={project.anchors} />

      <div className="tpj-card-foot">
        <span className="tpj-pill tpj-pill--active">
          <span className="tpj-pill-dot" />
          Active
        </span>
        <span className="tpj-muted" style={{ fontFamily: "var(--font-mono)", fontSize: "0.66rem" }}>
          {project.anchors.length} {project.anchors.length === 1 ? "signal" : "signals"}
        </span>
      </div>
    </div>
  );
}

function TeamProjectsView(props: TeamProjectsViewProps): JSX.Element {
  const { teamName, projects, loading, error, actionError, actionLoading, onCreate, onUpdate, onArchive } = props;

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const active = useMemo(() => projects.filter((p) => p.status === "active"), [projects]);
  const archived = useMemo(() => projects.filter((p) => p.status === "archived"), [projects]);

  const openCreate = () => setEditor({ mode: "create", project: null });
  const openEdit = (project: TeamProject) => setEditor({ mode: "edit", project });
  const closeEditor = () => setEditor(null);

  const showEmptyLoading = loading && projects.length === 0;

  return (
    <div className="tpj-root">
      <div className="tpj-head">
        <div className="tpj-head-titles">
          <span className="tpj-head-team">{teamName}</span>
          <h2 className="tpj-head-title">Shared projects</h2>
          <span className="tpj-section-sub">
            Anyone on the team can add a project. Your Mac matches your own activity to these; only totals are shared.
          </span>
        </div>
      </div>

      {error ? <p className="tpj-warn">{error}</p> : null}
      {actionError && !editor ? <p className="tpj-warn">{actionError}</p> : null}

      {showEmptyLoading ? (
        <div className="tpj-grid">
          <div className="tpj-loading" style={{ height: "8rem" }} />
          <div className="tpj-loading" style={{ height: "8rem" }} />
          <div className="tpj-loading" style={{ height: "8rem" }} />
        </div>
      ) : (
        <div className="tpj-grid">
          <button
            type="button"
            className="tpj-card tpj-card--add"
            onClick={openCreate}
            aria-label="Create a new project"
          >
            <span className="tpj-card-add-plus">＋</span>
            <span className="tpj-card-add-label">New project</span>
          </button>
          {active.map((project) => (
            <ProjectCard key={project.id} project={project} onEdit={openEdit} onArchive={onArchive} />
          ))}
        </div>
      )}

      {archived.length > 0 ? (
        <div className="tpj-archived">
          <button
            type="button"
            className="tpj-archived-head"
            onClick={() => setArchivedOpen((open) => !open)}
            aria-expanded={archivedOpen}
            aria-label={`${archivedOpen ? "Collapse" : "Expand"} archived projects`}
          >
            <CaretIcon open={archivedOpen} />
            Archived ({archived.length})
          </button>
          {archivedOpen
            ? archived.map((project) => {
                const swatchColor =
                  project.color && project.color.trim().length > 0 ? project.color : "#9ca3af";
                return (
                  <div className="tpj-archived-row" key={project.id}>
                    <span className="tpj-card-swatch" style={{ background: swatchColor }} />
                    <span className="tpj-archived-name">{project.name || "Untitled project"}</span>
                    {project.can_manage ? (
                      <button
                        type="button"
                        className="tpj-btn"
                        onClick={() => onArchive(project.id, false)}
                        aria-label={`Restore ${project.name}`}
                      >
                        Restore
                      </button>
                    ) : null}
                  </div>
                );
              })
            : null}
        </div>
      ) : null}

      {editor ? (
        <ProjectEditorModal
          state={editor}
          actionLoading={actionLoading}
          actionError={actionError}
          onClose={closeEditor}
          onCreate={onCreate}
          onUpdate={onUpdate}
        />
      ) : null}
    </div>
  );
}

export default TeamProjectsView;
