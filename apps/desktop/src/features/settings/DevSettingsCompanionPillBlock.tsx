import {
  COMPANION_MILESTONE_PREVIEW_OPTIONS,
  COMPANION_MOMENT_PREVIEW_OPTIONS,
  type CompanionMilestonePreviewId,
  type CompanionMomentPreviewId,
} from "../companion/companionPillPreview";
import {
  COMPANION_MENU_BAR_DISPLAY_OPTIONS,
  COMPANION_SURFACE_POLICY_OPTIONS,
  type CompanionSurfacePolicy,
} from "../companion/companionPillSettings";
import type { TrayDisplayMode } from "@drifty/domain";
import { Toggle } from "../../components/Toggle";

type DevSettingsCompanionPillBlockProps = {
  readonly betaEnabled: boolean;
  readonly policy: CompanionSurfacePolicy;
  readonly menuBarDisplayMode: TrayDisplayMode;
  readonly onBetaEnabledChange: (enabled: boolean) => void;
  readonly onPolicyChange: (policy: CompanionSurfacePolicy) => void;
  readonly onMenuBarDisplayModeChange: (mode: TrayDisplayMode) => void;
  readonly onPreviewMilestone: (previewId: CompanionMilestonePreviewId) => void;
  readonly onPreviewMoment: (previewId: CompanionMomentPreviewId) => void;
  readonly onPreviewDayReview: () => void;
};

export function DevSettingsCompanionPillBlock({
  betaEnabled,
  policy,
  menuBarDisplayMode,
  onBetaEnabledChange,
  onPolicyChange,
  onMenuBarDisplayModeChange,
  onPreviewMilestone,
  onPreviewMoment,
  onPreviewDayReview,
}: DevSettingsCompanionPillBlockProps) {
  return (
    <div className="settings-block settings-block--dev-preview">
      <h3>Companion beta</h3>
      <div className="settings-row settings-row--companion-previews">
        <div>
          <div className="lbl">Use redesigned Companion</div>
          <div className="desc">
            {betaEnabled
              ? "New Companion moments are active. Day review uses final V3 and drift cards include the Settings overflow."
              : "Off keeps the released legacy watcher, drift alarm, and day review completely unchanged."}
          </div>
        </div>
        <div className="ctrl">
          <Toggle checked={betaEnabled} onChange={onBetaEnabledChange} ariaLabel="Toggle Companion beta" />
        </div>
      </div>
      {betaEnabled ? <>
      <div className="settings-row settings-row--companion-previews">
        <div>
          <div className="lbl">Companion policy</div>
          <div className="desc">
            {policy === "floating"
              ? "Keep the resident pill visible and expand moments in place."
              : policy === "menuBar"
                ? "Use the menu-bar indicator as the resident surface; moments arrive below it as standalone cards."
                : "Remove the resident Companion. Safety alerts and earned milestones still arrive standalone."}
          </div>
        </div>
        <div className="ctrl">
          <div className="settings-mode-switch settings-mode-switch--compact" role="radiogroup" aria-label="Companion policy">
            {COMPANION_SURFACE_POLICY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`settings-mode-option${policy === option.value ? " is-active" : ""}`}
                role="radio"
                aria-checked={policy === option.value}
                onClick={() => onPolicyChange(option.value)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="settings-row settings-row--companion-previews">
        <div>
          <div className="lbl">Menu bar display</div>
          <div className="desc">
            {menuBarDisplayMode === "donut"
              ? "Show today's Focus, Drift, and Other mix as the compact ring."
              : menuBarDisplayMode === "donutFocusTime"
                ? "Replace the focus dot with today's productivity ring, keeping focused time beside it."
                : "Show today's focused time beside a small status dot."}
          </div>
        </div>
        <div className="ctrl">
          <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label="Menu bar display">
            {COMPANION_MENU_BAR_DISPLAY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`settings-mode-option${menuBarDisplayMode === option.value ? " is-active" : ""}`}
                role="radio"
                aria-checked={menuBarDisplayMode === option.value}
                onClick={() => onMenuBarDisplayModeChange(option.value)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
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
      </> : null}
    </div>
  );
}
