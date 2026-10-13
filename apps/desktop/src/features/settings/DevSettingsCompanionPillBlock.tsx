import {
  COMPANION_MILESTONE_PREVIEW_OPTIONS,
  COMPANION_MOMENT_PREVIEW_OPTIONS,
  type CompanionMilestonePreviewId,
  type CompanionMomentPreviewId,
} from "../companion/companionPillPreview";
import { Toggle } from "../../components/Toggle";
import { useState } from "react";

type DevSettingsCompanionPillBlockProps = {
  readonly floatingEnabled: boolean;
  readonly floatingSupported: boolean;
  readonly onFloatingEnabledChange: (enabled: boolean) => void;
  readonly onPreviewMilestone: (previewId: CompanionMilestonePreviewId) => void;
  readonly onPreviewMoment: (previewId: CompanionMomentPreviewId) => void;
  readonly onPreviewDayReview: () => void;
  /** Sends the Day Review through its production channel, the system notification. */
  readonly onPreviewDayReviewNotification?: () => void;
};

export function DevSettingsCompanionPillBlock({
  floatingEnabled,
  floatingSupported,
  onFloatingEnabledChange,
  onPreviewMilestone,
  onPreviewMoment,
  onPreviewDayReview,
  onPreviewDayReviewNotification,
}: DevSettingsCompanionPillBlockProps) {
  const [milestonePreview, setMilestonePreview] = useState<CompanionMilestonePreviewId>(COMPANION_MILESTONE_PREVIEW_OPTIONS[0].id);
  const [momentPreview, setMomentPreview] = useState<CompanionMomentPreviewId | "dayReview" | "dayReviewNotification">(COMPANION_MOMENT_PREVIEW_OPTIONS[0].id);

  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Companion previews</h3>
      {floatingSupported ? (
        <div className="settings-row settings-row--companion-previews">
          <div>
            <div className="lbl">Use floating Companion</div>
            <div className="desc">
              {floatingEnabled
                ? "Dev preview is enabled. Resident Companion moments expand from the desktop pill when it is not temporarily hidden."
                : "Production uses the menu-bar Companion when Companion is enabled."}
            </div>
          </div>
          <div className="ctrl">
            <Toggle checked={floatingEnabled} onChange={onFloatingEnabledChange} ariaLabel="Toggle floating Companion" />
          </div>
        </div>
      ) : null}
      <div className="settings-row settings-row--companion-previews">
        <div>
          <div className="lbl">Celebration previews</div>
          <div className="desc">
            Fire the real milestone event. With Companion off, it appears as a standalone alert.
          </div>
        </div>
        <div className="ctrl dev-preview-picker">
          <select className="settings-select" aria-label="Companion milestone preview" value={milestonePreview} onChange={(event) => setMilestonePreview(event.target.value as CompanionMilestonePreviewId)}>
            {COMPANION_MILESTONE_PREVIEW_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <button type="button" className="settings-btn settings-btn--primary" onClick={() => onPreviewMilestone(milestonePreview)}>Preview</button>
        </div>
      </div>
      <div className="settings-row settings-row--companion-previews">
        <div>
          <div className="lbl">Moment previews</div>
          <div className="desc">
            Open cards that normally need real drift. Previews follow the same resident or
            standalone route as production alerts.
          </div>
        </div>
        <div className="ctrl dev-preview-picker">
          <select className="settings-select" aria-label="Companion moment preview" value={momentPreview} onChange={(event) => setMomentPreview(event.target.value as CompanionMomentPreviewId | "dayReview" | "dayReviewNotification")}>
            {COMPANION_MOMENT_PREVIEW_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            <option value="dayReview">Day review</option>
            {onPreviewDayReviewNotification ? <option value="dayReviewNotification">Day review notification</option> : null}
          </select>
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={() => {
              if (momentPreview === "dayReview") onPreviewDayReview();
              else if (momentPreview === "dayReviewNotification") onPreviewDayReviewNotification?.();
              else onPreviewMoment(momentPreview);
            }}
          >
            Preview
          </button>
        </div>
      </div>
    </div>
  );
}
