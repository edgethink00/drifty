import type { AiReviewEvent, ProjectPassRun } from "@drifty/domain";
import { ProjectCorrectionsCard } from "../classification/ProjectCorrectionsCard";
import { ProjectPassCostPanel } from "./ProjectPassCostPanel";

type DevSettingsProjectClassificationBlockProps = {
  readonly projectClassificationAiReviewEvents: readonly AiReviewEvent[];
  readonly projectClassificationCorrectionsBusy: boolean;
  readonly projectPassRuns: readonly ProjectPassRun[];
  readonly onRevertProjectClassificationCorrection: (id: number) => void;
};

/**
 * Project classification diagnostics (corrections review + pass cost). The
 * feature itself ships default-on; only these support controls stay in Dev.
 */
export function DevSettingsProjectClassificationBlock({
  projectClassificationAiReviewEvents,
  projectClassificationCorrectionsBusy,
  projectPassRuns,
  onRevertProjectClassificationCorrection,
}: DevSettingsProjectClassificationBlockProps) {
  const hasActiveCorrections = projectClassificationAiReviewEvents.some((event) => !event.revertedAt);

  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Project classification</h3>
      {hasActiveCorrections ? (
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
      <ProjectPassCostPanel runs={projectPassRuns} startsGroup={hasActiveCorrections} />
    </div>
  );
}
