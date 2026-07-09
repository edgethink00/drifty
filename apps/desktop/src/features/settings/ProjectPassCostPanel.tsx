import type { ProjectPassRun, ProjectPassTrigger } from "@drifty/domain";
import { estimateProjectPassSpend, summarizeProjectPassCost } from "../classification/projectPassCostModel";
import "../projects/projects.css";

export interface ProjectPassCostPanelProps {
  readonly runs: readonly ProjectPassRun[];
  /** Set when a non-row element (e.g. corrections card) sits between this row and the ones above, so the row card reopens with a top edge. */
  readonly startsGroup?: boolean;
}

const TRIGGER_ORDER: readonly ProjectPassTrigger[] = ["schedule", "open", "eod", "manual", "backfill", "discovery"];

function formatUsd(value: number): string {
  if (value <= 0) return "$0.00";
  if (value < 0.005) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** "openai/gpt-5-mini" → "gpt-5-mini" for a compact label. */
function shortModel(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

export function ProjectPassCostPanel(props: ProjectPassCostPanelProps): JSX.Element {
  const { runs, startsGroup = false } = props;
  const summary = summarizeProjectPassCost(runs);
  const spend = estimateProjectPassSpend(runs);
  const modelLabel = spend.models.length > 0 ? spend.models.map(shortModel).join(", ") : "—";

  return (
    <div className={`settings-row settings-row--fallback settings-row--project-pass-cost${startsGroup ? " settings-row--group-start" : ""}`}>
      <div>
        <h4 className="lbl project-pass-cost__heading">Project pass cost</h4>
        {runs.length === 0 ? (
          <p className="desc">No project passes yet.</p>
        ) : (
          <>
          <div className="project-pass-cost__stats" role="group" aria-label="Project pass spend">
            <div className="project-pass-cost__stat">
              <span className="project-pass-cost__stat-label">Model</span>
              <strong className="project-pass-cost__stat-value">{modelLabel}</strong>
            </div>
            <div className="project-pass-cost__stat">
              <span className="project-pass-cost__stat-label">Est. cost to date</span>
              <strong className="project-pass-cost__stat-value">{formatUsd(spend.totalUsd)}</strong>
            </div>
            <div className="project-pass-cost__stat">
              <span className="project-pass-cost__stat-label">Est. monthly</span>
              <strong className="project-pass-cost__stat-value">~{formatUsd(spend.monthlyUsd)}</strong>
            </div>
            <div className="project-pass-cost__stat">
              <span className="project-pass-cost__stat-label">Passes</span>
              <strong className="project-pass-cost__stat-value">{summary.totalPasses}</strong>
            </div>
          </div>
          <p className="project-pass-cost__note">
            {summary.totalTokensIn.toLocaleString()} tokens in · {summary.totalTokensOut.toLocaleString()} out. Cost is estimated from public per-token pricing — your provider is the source of truth.
          </p>
          <div className="project-pass-cost__table-wrap">
            <table className="project-pass-cost__table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Passes</th>
                  <th scope="col">Tokens in</th>
                  <th scope="col">Tokens out</th>
                  <th scope="col">Assign.</th>
                  <th scope="col">Corr.</th>
                </tr>
              </thead>
              <tbody>
                {summary.byDay.map((bucket) => (
                  <tr key={bucket.day}>
                    <td>{bucket.day}</td>
                    <td>{bucket.passes}</td>
                    <td>{bucket.tokensIn.toLocaleString()}</td>
                    <td>{bucket.tokensOut.toLocaleString()}</td>
                    <td>{bucket.assignments}</td>
                    <td>{bucket.corrections}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="project-pass-cost__triggers">
            <span className="project-pass-cost__triggers-label">By trigger</span>
            <span className="project-pass-cost__triggers-list">
              {TRIGGER_ORDER.map((trigger) => (
                <span key={trigger} className="project-pass-cost__trigger">{`${trigger}: ${summary.byTrigger[trigger] ?? 0}`}</span>
              ))}
            </span>
          </div>
        </>
        )}
      </div>
    </div>
  );
}
