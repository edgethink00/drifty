import type { AiReviewEvent, ProjectPassRun } from "@drifty/domain";
import { Toggle } from "../../components/Toggle";
import { ProjectCorrectionsCard } from "../classification/ProjectCorrectionsCard";
import { ProjectPassCostPanel } from "./ProjectPassCostPanel";

type DevSettingsProjectClassificationBlockProps = {
  readonly projectClassificationAiReviewEvents: readonly AiReviewEvent[];
  readonly projectClassificationCorrectionsBusy: boolean;
  readonly projectClassificationEnabled: boolean;
  readonly projectPassRuns: readonly ProjectPassRun[];
  readonly onProjectClassificationEnabledChange: (enabled: boolean) => void;
  readonly onRevertProjectClassificationCorrection: (id: number) => void;
};

export function DevSettingsProjectClassificationBlock({
  projectClassificationAiReviewEvents,
  projectClassificationCorrectionsBusy,
  projectClassificationEnabled,
  projectPassRuns,
  onProjectClassificationEnabledChange,
  onRevertProjectClassificationCorrection,
}: DevSettingsProjectClassificationBlockProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Project classification (preview)</h3>
      <div className="settings-row">
        <div>
          <div className="lbl">Enable project classification</div>
          <div className="desc">Show the Projects tab and the Intelligence analysis-model tab in AI setup. Off by default — a Dev-mode preview available in any build.</div>
        </div>
        <div className="ctrl">
          <Toggle
            checked={projectClassificationEnabled}
            onChange={onProjectClassificationEnabledChange}
            ariaLabel="Toggle project classification preview"
          />
        </div>
      </div>
      {projectClassificationEnabled ? (
        <>
          {projectClassificationAiReviewEvents.some((event) => !event.revertedAt) ? (
            <ProjectCorrectionsCard
              events={projectClassificationAiReviewEvents}
              onRevert={onRevertProjectClassificationCorrection}
              busy={projectClassificationCorrectionsBusy}
            />
          ) : (
            <div className="settings-row">
              <div>
                <div className="lbl">Intelligence adjustments</div>
                <div className="desc">Day-context corrections the heavy pass applied to the selected day show here with a revert. None recorded for the selected day.</div>
              </div>
            </div>
          )}
          <ProjectPassCostPanel runs={projectPassRuns} />
        </>
      ) : null}
    </div>
  );
}
