import { formatLocalizedDuration } from "../../lib/formatting";
import { useMemo, useState } from "react";
import type { Project } from "@drifty/domain";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { PencilGlyph } from "../../components/PencilGlyph";
import { projectAutoAnalysisPhase, type ProjectAutoAnalysisState } from "./projectAutoAnalysisState";
import { formatProjectLastActivity } from "./projectDates";
import { ProjectSparkline } from "./ProjectSparkline";
import { useLocalization } from "../localization/LocalizationContext";
import { SkeletonText } from "../dashboard/DashboardLoadingParts";

const DEFAULT_PROJECT_COLOR = "#6366f1";
/** The search field shows once the list is long enough to need it. */
export const PROJECT_SEARCH_FROM = 8;

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
 * The project list: one row per active project with its last activity, a
 * 7-day trend line and its time in the window, a pencil that opens it in the
 * category editor (where projects are added, archived and deleted), and
 * archived projects folded underneath. A search field appears once
 * the list is long.
 */
export function ProjectsManager({
  projects,
  totalSecondsByProject,
  lastActivityByProject,
  totalCaption,
  dailySecondsByProject,
  today,
  onEditProject,
  onOpenProject,
  autoAnalysis,
  busy = false,
  valuesLoading = false,
}: ProjectsManagerProps): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const zeroLabel = formatLocalizedDuration(0, effectiveLanguage);

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return (project: Project) => !trimmed || project.name.toLowerCase().includes(trimmed);
  }, [query]);
  const active = projects.filter((project) => project.status !== "archived" && matches(project));
  const archived = projects.filter((project) => project.status === "archived" && matches(project));
  const searching = query.trim() !== "";

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
      {projects.length >= PROJECT_SEARCH_FROM ? (
        <div className="projects-toolbar">
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
        </div>
      ) : null}

      <div className="projects-table" role="region" aria-label={t("projects.title")}>
        <div className="projects-table__head">
          <span>{t("common.project")}</span>
          <span>{t("projects.lastActivity")}</span>
          <span aria-hidden="true" />
          <span>{t("projects.timeCaption", { caption: totalCaption })}</span>
          <span><span className="sr-only">{t("common.actions")}</span></span>
        </div>
        {active.map(row)}
        {searching && active.length === 0 && archived.length === 0 ? (
          <p className="projects-table__empty">{t("projects.noFilterMatch")}</p>
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
 * The project table while the library first loads: its header and a few rows
 * in the loaded markup, with names, dates, trends and times held as
 * placeholders, so the page never claims there are no projects yet.
 */
export function ProjectsManagerLoading({ totalCaption }: { readonly totalCaption: string }) {
  const { t } = useLocalization();
  return (
    <div className="projects-manager projects-manager--loading" aria-busy="true">
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
