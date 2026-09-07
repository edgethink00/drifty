import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectInput, ProjectStatus } from "@drifty/domain";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { ModalPresence } from "../../components/ModalPresence";
import { ProjectEditorModal } from "./ProjectEditorModal";
import { SettingsSelect } from "../settings/SettingsSelect";
import { projectAutoAnalysisPhase, type ProjectAutoAnalysisState } from "./projectAutoAnalysisState";
import { useLocalization } from "../localization/LocalizationContext";

const DEFAULT_PROJECT_COLOR = "#6366f1";

type StatusFilter = "all" | ProjectStatus;

export interface ProjectsManagerProps {
  readonly projects: readonly Project[];
  /** Tracked seconds attributed to each project within the current trend window. */
  readonly totalSecondsByProject: ReadonlyMap<string, number>;
  /** Latest ISO day with attributed activity per project (within the loaded window). */
  readonly lastActivityByProject: ReadonlyMap<string, string>;
  /** Caption in the per-project time column, e.g. "Latest 7 days". */
  readonly totalCaption: string;
  readonly onSave: (input: ProjectInput) => Promise<boolean> | boolean;
  readonly onDelete: (id: string) => void;
  /** Row click → project detail. */
  readonly onOpenProject: (projectId: string) => void;
  readonly autoAnalysis: ProjectAutoAnalysisState;
  readonly busy?: boolean;
}

function truncateDescription(description: string, emptyLabel: string, max = 72): string {
  const trimmed = description.trim();
  if (!trimmed) return emptyLabel;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function formatLastActivity(day: string | undefined, language: "en" | "ko"): string {
  if (!day) return "—";
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
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
  autoAnalysis,
  busy = false,
}: ProjectsManagerProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
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
    // The Edit item disappears with its menu; restore to the persistent trigger.
    menuTrigger.current?.focus({ preventScroll: true });
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

  return (
    <div className="projects-manager">
      {projects.length === 0 ? (
        <section className="projects-first-run" aria-labelledby="projects-first-run-title">
          <div className="projects-first-run__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 8 4.3-8 4.3-8-4.3L12 3Z" /><path d="m4 12.3 8 4.3 8-4.3M4 17.1l8 4.3 8-4.3" /></svg>
          </div>
          <div className="projects-first-run__copy">
            <span className="label-mono">{t("projects.firstRun.eyebrow")}</span>
            <h2 id="projects-first-run-title">{t("projects.firstRun.title")}</h2>
            <p>{t("projects.firstRun.detail")}</p>
            <ol>
              <li><span>1</span><strong>{t("projects.firstRun.stepName")}</strong></li>
              <li><span>2</span><strong>{t("projects.firstRun.stepDescribe")}</strong></li>
              <li><span>3</span><strong>{t("projects.firstRun.stepRefresh")}</strong></li>
            </ol>
          </div>
          <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setEditing("new"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {t("projects.create")}
          </button>
        </section>
      ) : (
        <>
          <div className="projects-toolbar" aria-label={t("projects.filtersAria")}>
            <span className="projects-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                className="settings-input"
                type="text"
                aria-label={t("projects.searchAria")}
                placeholder={t("projects.searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </span>
            <SettingsSelect
              ariaLabel={t("projects.filterStatus")}
              className="projects-status-filter"
              value={statusFilter}
              options={[
                { value: "all", label: t("projects.allStatuses") },
                { value: "active", label: t("common.active") },
                { value: "archived", label: t("common.archived") },
              ]}
              onChange={setStatusFilter}
            />
            <span className="projects-toolbar__spacer" />
            <button type="button" className="app-btn app-btn--primary" disabled={busy} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setEditing("new"); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              {t("projects.new")}
            </button>
          </div>

          <div className="projects-table" role="region" aria-label={t("projects.title")}>
            <div className="projects-table__head">
              <span>{t("common.project")}</span>
              <span>{t("projects.lastActivity")}</span>
              <span>{t("projects.status")}</span>
              <span>{t("projects.timeCaption", { caption: totalCaption })}</span>
              <span><span className="sr-only">{t("common.actions")}</span></span>
            </div>
        {filtered.map((project) => {
          const isArchived = project.status === "archived";
          const totalSeconds = totalSecondsByProject.get(project.id) ?? 0;
          const autoPhase = projectAutoAnalysisPhase(autoAnalysis, project.id);
          const timeState = autoPhase === "running"
            ? { label: t("projects.matching.matchingProgress"), tone: "running" }
            : autoPhase === "queued"
              ? { label: t("projects.matchingSoon"), tone: "running" }
              : autoPhase === "waiting_for_model"
                ? { label: t("projects.setupNeeded"), tone: "attention" }
                : autoPhase === "error"
                  ? { label: t("projects.matching.retryNeeded"), tone: "error" }
                  : autoPhase === "complete" && totalSeconds === 0
                    ? { label: t("projects.noRecentMatch"), tone: "muted" }
                    : null;
          return (
            <div
              className={`projects-table__rowwrap${isArchived ? " projects-table__rowwrap--archived" : ""}`}
              key={project.id}
            >
              <div className="projects-table__row" onClick={() => onOpenProject(project.id)}>
                <div className="pt-proj">
                  <span className="pt-swatch" style={{ background: project.color || DEFAULT_PROJECT_COLOR }} />
                  <button
                    type="button"
                    className="projects-table__open"
                    aria-label={t("projects.openAria", { name: project.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenProject(project.id);
                    }}
                  >
                    <strong>{project.name}</strong>
                    <small>{truncateDescription(project.description, t("projects.noDescription"))}</small>
                  </button>
                </div>
                <span className="pt-mono">{formatLastActivity(lastActivityByProject.get(project.id), effectiveLanguage)}</span>
                <span className={`chip${isArchived ? " gray" : " green"}`}>{t(isArchived ? "common.archived" : "common.active")}</span>
                <div className="pt-total">
                  {timeState ? (
                    <span
                      className={`projects-table__analysis-state projects-table__analysis-state--${timeState.tone}`}
                      role={autoPhase === "running" || autoPhase === "queued" ? "status" : undefined}
                      aria-live={autoPhase === "running" || autoPhase === "queued" ? "polite" : undefined}
                    >
                      {autoPhase === "running" || autoPhase === "queued" ? <span className="projects-table__analysis-spinner" aria-hidden="true" /> : null}
                      {timeState.label}
                    </span>
                  ) : (
                    <b>{totalSeconds > 0 ? formatLocalizedCompactDurationFromSeconds(totalSeconds, effectiveLanguage) : effectiveLanguage === "ko" ? "0분" : "0m"}</b>
                  )}
                </div>
                <span className="pt-menu-slot">
                  <button
                    type="button"
                    className="pt-more"
                    aria-label={t("projects.optionsAria", { name: project.name })}
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
                  {menuFor === project.id ? (
                    <div className="pt-menu" role="menu" aria-label={t("projects.options")}>
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
                        {t("common.edit")}
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
                        {t(isArchived ? "projects.unarchive" : "projects.archive")}
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
                        {t("common.delete")}
                      </button>
                    </div>
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}
            {filtered.length === 0 ? (
              <div className="projects-table__empty">
                <span>{t("projects.noFilterMatch")}</span>
                <button type="button" className="app-btn app-btn--quiet app-btn--compact" onClick={() => { setQuery(""); setStatusFilter("all"); }}>{t("projects.clearFilters")}</button>
              </div>
            ) : null}
          </div>
        </>
      )}

      <ModalPresence>
        {editing !== null ? (
        <ProjectEditorModal
          project={editing === "new" ? null : editing}
          projects={projects}
          busy={busy}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
        ) : null}
      </ModalPresence>
    </div>
  );
}
