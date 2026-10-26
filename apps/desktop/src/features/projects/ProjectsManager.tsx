import { formatLocalizedDuration, localeForDisplayLanguage } from "../../lib/formatting";
import { useState } from "react";
import type { Project } from "@drifty/domain";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { PencilGlyph } from "../../components/PencilGlyph";
import { projectAutoAnalysisPhase, type ProjectAutoAnalysisState } from "./projectAutoAnalysisState";
import { formatProjectLastActivity } from "./projectDates";
import { ProjectSparkline } from "./ProjectSparkline";
import { useLocalization } from "../localization/LocalizationContext";
import { SkeletonText } from "../dashboard/DashboardLoadingParts";
import {
  DEFAULT_PROJECT_LIBRARY_VIEW,
  nextProjectLibrarySort,
  pageOfProjectLibrary,
  projectLibraryOrder,
  type ProjectLibrarySortKey,
  type ProjectLibraryView,
} from "./projectLibraryView";

const DEFAULT_PROJECT_COLOR = "#6366f1";

export interface ProjectsManagerProps {
  readonly projects: readonly Project[];
  /** Tracked seconds attributed to each project within the current trend window. */
  readonly totalSecondsByProject: ReadonlyMap<string, number>;
  /** Latest ISO day with attributed activity per project (within the loaded window). */
  readonly lastActivityByProject: ReadonlyMap<string, string>;
  /** Caption in the per-project time column, e.g. "Latest 7 days". */
  readonly totalCaption: string;
  /** Per-day seconds across the window, oldest first, for each row's trend line. */
  readonly dailySecondsByProject?: ReadonlyMap<string, readonly number[]>;
  /** The logical today, for "today", "yesterday" and "3 days ago". */
  readonly today: string;
  /** Opens the category editor on a project; absent while Intelligence locks project edits. */
  readonly onEditProject?: (project: Project) => void;
  /** New project beside the search; absent while Intelligence locks project edits. */
  readonly onCreateProject?: () => void;
  /** The search, column sort and page, held by the page so they survive a visit to a project. */
  readonly view?: ProjectLibraryView;
  readonly onViewChange?: (view: ProjectLibraryView) => void;
  /** A project just made in the New project dialog, whose row is marked for a moment. */
  readonly highlightProjectId?: string | null;
  /** Row click → project detail. */
  readonly onOpenProject: (projectId: string) => void;
  readonly autoAnalysis: ProjectAutoAnalysisState;
  readonly busy?: boolean;
  /** The window's activity is still loading: last activity, trend and time wait as placeholders. */
  readonly valuesLoading?: boolean;
}

function truncateDescription(description: string, emptyLabel: string, max = 72): string {
  const trimmed = description.trim();
  if (!trimmed) return emptyLabel;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The project table, the same at every library size: the search and New
 * project over it, one line per active project with its last activity, a
 * 7-day trend line, its time in the window and a pencil that opens it in the
 * category editor; column titles that sort; 15 rows a page with the range and
 * previous/next under them; archived projects folded underneath.
 */
export function ProjectsManager({
  projects,
  totalSecondsByProject,
  lastActivityByProject,
  totalCaption,
  dailySecondsByProject,
  today,
  onEditProject,
  onCreateProject,
  view: controlledView,
  onViewChange,
  highlightProjectId,
  onOpenProject,
  autoAnalysis,
  busy = false,
  valuesLoading = false,
}: ProjectsManagerProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const [ownView, setOwnView] = useState<ProjectLibraryView>(DEFAULT_PROJECT_LIBRARY_VIEW);
  const view = controlledView ?? ownView;
  const setView = (next: ProjectLibraryView) => {
    if (!controlledView) setOwnView(next);
    onViewChange?.(next);
  };
  const [showArchived, setShowArchived] = useState(false);
  const zeroLabel = formatLocalizedDuration(0, effectiveLanguage);

  const values = { totalSecondsByProject, lastActivityByProject, locale: localeForDisplayLanguage(effectiveLanguage) };
  const active = projectLibraryOrder(projects, "active", view, values);
  const archived = projectLibraryOrder(projects, "archived", view, values);
  const searching = view.query.trim() !== "";
  const shown = pageOfProjectLibrary(active, view.page);
  const sortTitle = (key: ProjectLibrarySortKey, label: string) => {
    const sorted = view.sort?.key === key ? view.sort.direction : null;
    return (
      <button
        type="button"
        className={"projects-table__sort" + (sorted ? " is-sorted" : "")}
        aria-pressed={sorted !== null}
        onClick={() => setView({ ...view, sort: nextProjectLibrarySort(view.sort, key), page: 0 })}
      >
        {label}
        <span className="projects-table__sort-mark" aria-hidden="true">{sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}</span>
      </button>
    );
  };

  const row = (project: Project) => {
    const isArchived = project.status === "archived";
    const totalSeconds = totalSecondsByProject.get(project.id) ?? 0;
    const autoPhase = isArchived ? null : projectAutoAnalysisPhase(autoAnalysis, project.id);
    const timeState = autoPhase === "running"
      ? { label: t("projects.matching.matchingProgress"), tone: "running" }
      : autoPhase === "queued"
        ? { label: t("projects.matchingSoon"), tone: "running" }
        : autoPhase === "waiting_for_model"
          ? { label: t("projects.setupNeeded"), tone: "attention" }
          : autoPhase === "error"
            ? { label: t("projects.matching.retryNeeded"), tone: "error" }
            : autoPhase === "complete" && totalSeconds === 0
              ? { label: t("projects.noRecentMatch"), tone: "muted", refine: true }
              : null;
    const daily = dailySecondsByProject?.get(project.id);
    return (
      <div className={`projects-table__rowwrap${isArchived ? " projects-table__rowwrap--archived" : ""}`} key={project.id}>
        <div className={"projects-table__row" + (highlightProjectId === project.id ? " is-just-made" : "")} onClick={() => onOpenProject(project.id)}>
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
          <span className="pt-last">{valuesLoading ? <SkeletonText>0 days ago</SkeletonText> : formatProjectLastActivity(lastActivityByProject.get(project.id), today, effectiveLanguage, t)}</span>
          <span className="pt-trend">{valuesLoading && !isArchived ? <span className="pt-trend-loading" /> : daily && !isArchived ? <ProjectSparkline values={daily} color={project.color || DEFAULT_PROJECT_COLOR} label={t("projects.trendAria", { name: project.name })} /> : null}</span>
          <div className="pt-total">
            {valuesLoading ? (
              <b><SkeletonText>0h 00m</SkeletonText></b>
            ) : timeState ? (
              <span
                className={`projects-table__analysis-state projects-table__analysis-state--${timeState.tone}`}
                role={autoPhase === "running" || autoPhase === "queued" ? "status" : undefined}
                aria-live={autoPhase === "running" || autoPhase === "queued" ? "polite" : undefined}
              >
                {autoPhase === "running" || autoPhase === "queued" ? <span className="projects-table__analysis-spinner" aria-hidden="true" /> : null}
                {timeState.label}
                {"refine" in timeState && onEditProject ? (
                  <button
                    type="button"
                    className="projects-table__refine"
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditProject(project);
                    }}
                  >
                    {t("projects.refineDescription")}
                  </button>
                ) : null}
              </span>
            ) : (
              <b>{totalSeconds > 0 ? formatLocalizedCompactDurationFromSeconds(totalSeconds, effectiveLanguage) : zeroLabel}</b>
            )}
          </div>
          <span className="pt-edit-slot">
            {onEditProject ? <button
              type="button"
              className="pencil-plate pencil-plate--sm pt-edit"
              aria-label={t("projects.editAria", { name: project.name })}
              title={t("projects.editAria", { name: project.name })}
              aria-haspopup="dialog"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onEditProject(project);
              }}
            >
              <PencilGlyph />
            </button> : null}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="projects-manager">
      <div className="projects-toolbar">
        <span className="projects-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            className="settings-input"
            type="text"
            aria-label={t("projects.searchAria")}
            placeholder={t("projects.searchPlaceholder")}
            value={view.query}
            onChange={(event) => setView({ ...view, query: event.target.value, page: 0 })}
          />
        </span>
        <span className="projects-toolbar__spacer" />
        {onCreateProject ? (
          <button
            type="button"
            className="app-btn app-btn--quiet projects-toolbar__new"
            disabled={busy}
            aria-haspopup="dialog"
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              onCreateProject();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {t("projects.new")}
          </button>
        ) : null}
      </div>

      <div className="projects-table" role="region" aria-label={t("projects.title")}>
        <div className="projects-table__head">
          <span>{sortTitle("name", t("common.project"))}</span>
          <span>{sortTitle("last", t("projects.lastActivity"))}</span>
          <span aria-hidden="true" />
          <span>{sortTitle("time", t("projects.timeCaption", { caption: totalCaption }))}</span>
          <span><span className="sr-only">{t("common.actions")}</span></span>
        </div>
        {shown.items.map(row)}
        {searching && active.length === 0 && archived.length === 0 ? (
          <p className="projects-table__empty">{t("projects.noFilterMatch")}</p>
        ) : null}
        {active.length > 0 ? (
          <div className="projects-table__foot">
            <span>{t("projects.pageRange", { first: shown.first, last: shown.last, total: shown.total })}</span>
            <span className="projects-toolbar__spacer" />
            <button
              type="button"
              className="projects-table__page"
              aria-label={t("projects.previousPage")}
              title={t("projects.previousPage")}
              disabled={shown.page === 0}
              onClick={() => setView({ ...view, page: shown.page - 1 })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <button
              type="button"
              className="projects-table__page"
              aria-label={t("projects.nextPage")}
              title={t("projects.nextPage")}
              disabled={shown.page >= shown.pageCount - 1}
              onClick={() => setView({ ...view, page: shown.page + 1 })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
        ) : null}
      </div>

      {archived.length > 0 ? (
        <div className="projects-archived">
          <button
            type="button"
            className="projects-archived__toggle"
            aria-expanded={showArchived || searching}
            onClick={() => setShowArchived((open) => !open)}
          >
            {t("projects.archivedCount", { count: archived.length })}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
          {showArchived || searching ? (
            <div className="projects-table projects-table--archived" role="region" aria-label={t("common.archived")}>
              {archived.map(row)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Rows while the project library first loads; most libraries hold a few projects.
const LOADING_PROJECT_ROWS = 3;

/**
 * The project table while the library first loads: its toolbar, header and a
 * few rows in the loaded markup, with names, dates, trends and times held as
 * placeholders, so the page never claims there are no projects yet.
 */
export function ProjectsManagerLoading({ totalCaption }: { readonly totalCaption: string }) {
  const { t } = useLocalization();
  return (
    <div className="projects-manager projects-manager--loading" aria-busy="true">
      {/* The loaded page's toolbar holds its place, so the table does not jump when it arrives. */}
      <div className="projects-toolbar" aria-hidden="true">
        <span className="projects-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="settings-input" type="text" tabIndex={-1} disabled placeholder={t("projects.searchPlaceholder")} />
        </span>
      </div>
      <div className="projects-table" aria-hidden="true">
        <div className="projects-table__head">
          <span>{t("common.project")}</span>
          <span>{t("projects.lastActivity")}</span>
          <span />
          <span>{t("projects.timeCaption", { caption: totalCaption })}</span>
          <span />
        </div>
        {Array.from({ length: LOADING_PROJECT_ROWS }, (_, index) => (
          <div className="projects-table__rowwrap" key={index}>
            <div className="projects-table__row">
              <div className="pt-proj">
                <span className="pt-swatch pt-swatch--loading" />
                <span className="projects-table__open">
                  <strong><SkeletonText>Project name</SkeletonText></strong>
                  <small><SkeletonText>Project description goes here</SkeletonText></small>
                </span>
              </div>
              <span className="pt-last"><SkeletonText>0 days ago</SkeletonText></span>
              <span className="pt-trend"><span className="pt-trend-loading" /></span>
              <div className="pt-total"><b><SkeletonText>0h 00m</SkeletonText></b></div>
              <span className="pt-edit-slot" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
