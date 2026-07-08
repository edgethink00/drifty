import type { ActivitySegment, Project, ProjectAnchor, ProjectAssignmentRecord, ProjectInput } from "@drifty/domain";
import "./projects.css";
import { ProjectTrendChart } from "./ProjectTrendChart";
import { ProjectsSettingsSection } from "../settings/ProjectsSettingsSection";
import { ProjectPassConsentModal } from "../classification/ProjectPassConsentModal";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";

function analysisModelLabel(setup: AnalysisAiSetupState): string {
  if (setup.provider === "cloud") return "Drifty Cloud";
  if (setup.provider === "openrouter") return `OpenRouter · ${setup.openRouterModel}`;
  if (setup.provider === "openai") return `OpenAI · ${setup.openaiModel}`;
  if (setup.provider === "anthropic") return `Anthropic · ${setup.anthropicModel}`;
  return "Custom endpoint";
}

export interface ProjectsPageProps {
  readonly projects: readonly Project[];
  readonly assignments: readonly ProjectAssignmentRecord[];
  readonly selectedDay: string;
  readonly startOfDayMinutes: number;
  readonly daySegments: readonly ActivitySegment[];
  readonly dayProjectBySegmentId: ReadonlyMap<string, string>;
  readonly trendSegments: readonly ActivitySegment[];
  readonly trendProjectBySegmentId: ReadonlyMap<string, string>;
  readonly projectsLoading: boolean;
  readonly running: boolean;
  readonly progress: { readonly done: number; readonly total: number } | null;
  readonly runError: string | null;
  readonly analysisConnected: boolean;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly consentOpen: boolean;
  readonly consentProviderLabel: string;
  readonly onConfigureModel: () => void;
  readonly onSaveProject: (input: ProjectInput) => void;
  readonly onDeleteProject: (id: string) => void;
  readonly onAddAnchor: (projectId: string, kind: ProjectAnchor["kind"], value: string) => void;
  readonly onDeleteAnchor: (projectId: string, kind: ProjectAnchor["kind"], value: string) => void;
  readonly onRunAnalysis: () => void;
  readonly onConsentConfirm: () => void;
  readonly onConsentCancel: () => void;
}

function segmentCountByProject(assignments: readonly ProjectAssignmentRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    if (!assignment.projectId) continue;
    counts.set(assignment.projectId, (counts.get(assignment.projectId) ?? 0) + 1);
  }
  return counts;
}

export function ProjectsPage(props: ProjectsPageProps) {
  const activeProjects = props.projects.filter((project) => project.status === "active");
  const counts = segmentCountByProject(props.assignments);

  return (
    <div className="page projects-page">
      <div className="pg-head projects-page__head">
        <div className="projects-page__title">
          <h1>Projects</h1>
          <span className="projects-help">
            <button type="button" className="projects-help__trigger" aria-label="What are projects?">How it works</button>
            <span className="projects-help__tip" role="tooltip">Group your tracked time by what it was for. Describe a project in plain language and Drifty's analysis model attributes your activity to it.</span>
          </span>
        </div>
      </div>

      {props.running ? (
        <div className="projects-analyzing" role="status" aria-live="polite">
          <span className="projects-analyzing__spinner" aria-hidden="true" />
          <div className="projects-analyzing__body">
            <span className="projects-analyzing__label">
              Analyzing your activity…{props.progress && props.progress.total > 0 ? ` chunk ${props.progress.done} of ${props.progress.total}` : ""}
            </span>
            {props.progress && props.progress.total > 0 ? (
              <span className="projects-analyzing__bar" aria-hidden="true">
                <span
                  className="projects-analyzing__fill"
                  style={{ width: `${Math.round((props.progress.done / props.progress.total) * 100)}%` }}
                />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <ProjectsSettingsSection
        projects={props.projects}
        onSave={props.onSaveProject}
        onDelete={props.onDeleteProject}
        onAddAnchor={props.onAddAnchor}
        onDeleteAnchor={props.onDeleteAnchor}
        segmentCounts={counts}
        busy={props.running || props.projectsLoading}
      />

      {activeProjects.length > 0 ? (
        <div className="projects-charts">
          <ProjectTrendChart
            segments={props.trendSegments}
            projectBySegmentId={props.trendProjectBySegmentId}
            projects={props.projects}
            days={14}
            endDay={props.selectedDay}
          />
        </div>
      ) : null}

      <div className="projects-page__footer">
        {!props.analysisConnected ? (
          <div className="projects-page__banner projects-page__banner--warn" role="status">
            Connect an analysis model to attribute activity to your projects.
          </div>
        ) : null}
        {props.runError ? (
          <div className="projects-page__banner projects-page__banner--error" role="alert">Analysis failed: {props.runError}</div>
        ) : null}
        <div className={`projects-model-status${props.analysisConnected ? " is-connected" : " is-disconnected"}`} role="group" aria-label="Project analysis model">
          <div className="projects-model-status__info">
            <span className="projects-model-status__label">Project analysis</span>
            <span className="projects-model-status__value">{analysisModelLabel(props.analysisSetup)}</span>
          </div>
          <span className={`projects-model-status__chip${props.analysisConnected ? " is-connected" : ""}`}>
            {props.analysisConnected ? "Connected" : "Needs setup"}
          </span>
          <div className="projects-model-status__actions">
            <button type="button" className="settings-btn" onClick={props.onConfigureModel}>AI setup</button>
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              onClick={props.onRunAnalysis}
              disabled={props.running || !props.analysisConnected || activeProjects.length === 0}
            >
              {props.running ? "Analyzing…" : "Analyze last 7 days"}
            </button>
          </div>
          {activeProjects.length === 0 ? (
            <p className="projects-model-status__reason">Create at least one active project before running analysis.</p>
          ) : !props.analysisConnected ? (
            <p className="projects-model-status__reason">Connect an analysis model before running analysis.</p>
          ) : null}
        </div>
      </div>

      <ProjectPassConsentModal
        open={props.consentOpen}
        providerLabel={props.consentProviderLabel}
        includesTitles={false}
        onConfirm={props.onConsentConfirm}
        onCancel={props.onConsentCancel}
      />
    </div>
  );
}
