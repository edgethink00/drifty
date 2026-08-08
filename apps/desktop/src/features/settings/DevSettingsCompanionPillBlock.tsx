import {
  COMPANION_MILESTONE_PREVIEW_OPTIONS,
  COMPANION_MOMENT_PREVIEW_OPTIONS,
  type CompanionMilestonePreviewId,
  type CompanionMomentPreviewId,
} from "../companion/companionPillPreview";
import { Toggle } from "../../components/Toggle";

type DevSettingsCompanionPillBlockProps = {
  readonly floatingEnabled: boolean;
  readonly onFloatingEnabledChange: (enabled: boolean) => void;
  readonly onPreviewMilestone: (previewId: CompanionMilestonePreviewId) => void;
  readonly onPreviewMoment: (previewId: CompanionMomentPreviewId) => void;
  readonly onPreviewDayReview: () => void;
};

export function DevSettingsCompanionPillBlock({
  floatingEnabled,
  onFloatingEnabledChange,
  onPreviewMilestone,
  onPreviewMoment,
  onPreviewDayReview,
}: DevSettingsCompanionPillBlockProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Companion Lab</h3>
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
      <div className="settings-row settings-row--companion-previews">
        <div>
          <div className="lbl">Day review</div>
          <div className="desc">V3 is final: work hours and productivity mix stay in the passing card; deeper detail opens in See full day.</div>
        </div>
        <div className="ctrl"><span className="settings-beta-badge">V3 final</span></div>
      </div>
      <div className="settings-row settings-row--companion-previews">
        <div>
          <div className="lbl">Celebration previews</div>
          <div className="desc">
            Fire the real milestone event. With Companion off, it appears as a standalone alert.
          </div>
        </div>
        <div
          className="ctrl settings-row__actions settings-row__actions--wrap"
          role="group"
          aria-label="Companion milestone previews"
        >
          {COMPANION_MILESTONE_PREVIEW_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="settings-btn"
              onClick={() => onPreviewMilestone(option.id)}
            >
              {option.label}
            </button>
          ))}
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
        <div
          className="ctrl settings-row__actions settings-row__actions--wrap"
          role="group"
          aria-label="Companion moment previews"
        >
          {COMPANION_MOMENT_PREVIEW_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="settings-btn"
              onClick={() => onPreviewMoment(option.id)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className="settings-btn"
            onClick={onPreviewDayReview}
          >
            Day review
          </button>
        </div>
      </div>
    </div>
  );
}
