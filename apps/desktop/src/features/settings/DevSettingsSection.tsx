import { useEffect, useState } from "react";
import { Toggle } from "../../components/Toggle";
import { AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED, DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED, REPLAY_ONBOARDING_DEV_TOOL_ENABLED } from "../../appFeatureSwitches";
import { DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS, type DashboardAiUnavailablePreviewCase, type DashboardAiUnavailablePreviewState } from "../dashboard/dashboardAiUnavailablePreview";
import { SIDEBAR_CTA_PREVIEW_OPTIONS, type SidebarCtaPreviewCase } from "../sidebar/sidebarCtaSlotPreview";
import { formatDayLabel } from "../../lib/formatting";
import { type DemoDashboardReplayKind, DashboardDemoReplayControls } from "./DashboardDemoReplayControls";
import type { AiReviewEvent, ProjectPassRun } from "@drifty/domain";
import type { DemoDashboardReplaySettings } from "./settingsStorage";
import type { PreReleaseUpdateStatus } from "../updates/useDeveloperPreReleaseUpdateController";
import { PreReleaseUpdatesSettingsRow } from "./PreReleaseUpdatesSettingsRow";
import { SettingsCollapsibleCard } from "./SettingsCollapsibleCard";
import { DevSettingsDeviceSyncBlock } from "./DevSettingsDeviceSyncBlock";
import { DevSettingsCompanionPillBlock } from "./DevSettingsCompanionPillBlock";
import { DevSettingsAxFallbackCard, DevSettingsDebugLogsBlock } from "./DevSettingsDiagnosticsBlock";
import { DevSettingsEnhancedContextBlock } from "./DevSettingsEnhancedContextBlock";
import { DevSettingsProjectClassificationBlock } from "./DevSettingsProjectClassificationBlock";
import { DevSettingsWebAccountBlock } from "./DevSettingsWebAccountBlock";
import type { EnhancedContextSettings, EnhancedContextSourceFamily } from "./settingsStorage";
import { useLocalization } from "../localization/LocalizationContext";
import { SentrySmokeDiagnostics } from "./SentrySmokeDiagnostics";
import { cleanupTauriEventListener } from "../../lib/tauriEventCleanup";
import { listenToNativePetModeLabState, requestNativePetModeLabState } from "../pet-mode/petModeBridge";
import type { PetModeLabAction, PetModeLabState, PetModePreviewAction } from "../pet-mode/petModeData";
import { BOOT_SHELL_PREVIEW_DURATION_SECONDS, showBootShellPreview } from "../loading/bootShell";
import type {
  CompanionMilestonePreviewId,
  CompanionMomentPreviewId,
} from "../companion/companionPillPreview";

type DevSettingsSectionProps = {
  readonly dashboardAiUnavailablePreview: DashboardAiUnavailablePreviewState | null;
  readonly dashboardAiUnavailablePreviewCase: DashboardAiUnavailablePreviewCase;
  readonly sidebarCtaPreviewCase: SidebarCtaPreviewCase | null;
  readonly demoDashboardReplaySettings?: DemoDashboardReplaySettings;
  readonly enhancedContextSettings: EnhancedContextSettings;
  readonly forceBrowserHistoryUrlFallbackEnabled: boolean;
  readonly forceChromiumAxCaptureEnabled: boolean;
  readonly forceChromiumAxExtremeNudgeEnabled: boolean;
  readonly forceFrontmostFallbackCaptureEnabled: boolean;
  readonly deviceSyncPreviewEnabled: boolean;
  readonly webAccountPreviewEnabled: boolean;
  readonly projectClassificationAiReviewEvents: readonly AiReviewEvent[];
  readonly projectClassificationCorrectionsBusy: boolean;
  readonly projectPassRuns: readonly ProjectPassRun[];
  readonly petModeEnabled: boolean;
  readonly petModeLabPointerStatus: string | null;
  readonly petModeLabInputBounds: string | null;
  readonly floatingCompanionDevEnabled: boolean;
  readonly onFloatingCompanionDevEnabledChange: (enabled: boolean) => void;
  readonly onPreviewCompanionMilestone: (previewId: CompanionMilestonePreviewId) => void;
  readonly onPreviewCompanionMoment: (previewId: CompanionMomentPreviewId) => void;
  readonly onPreviewCompanionDayReview: () => void;
  readonly preReleaseUpdateStatus: PreReleaseUpdateStatus;
  readonly preReleaseUpdateMessage: string | null;
  readonly preReleaseUpdateError: string | null;
  readonly preReleaseUpdateBusy: boolean;
  readonly canInstallPreReleaseUpdate: boolean;
  readonly onClearDashboardAiUnavailablePreview: () => void;
  readonly onDashboardAiUnavailablePreviewCaseChange: (previewCase: DashboardAiUnavailablePreviewCase) => void;
  readonly onSidebarCtaPreviewCaseChange: (previewCase: SidebarCtaPreviewCase | null) => void;
  readonly onDemoDashboardReplayDurationSecondsChange?: (value: number) => void;
  readonly onDemoDashboardReplayPreRollSecondsChange?: (value: number) => void;
  readonly onEnhancedContextCaptureLocalChange: (enabled: boolean) => void;
  readonly onEnhancedContextDebugLoggingChange: (enabled: boolean) => void;
  readonly onEnhancedContextEnabledChange: (enabled: boolean) => void;
  readonly onEnhancedContextRetryLowConfidenceChange: (enabled: boolean) => void;
  readonly onEnhancedContextSourceFamilyChange: (family: EnhancedContextSourceFamily, enabled: boolean) => void;
  readonly onForceBrowserHistoryUrlFallbackChange: (enabled: boolean) => void;
  readonly onForceChromiumAxCaptureChange: (enabled: boolean) => void;
  readonly onForceChromiumAxExtremeNudgeChange: (enabled: boolean) => void;
  readonly onForceFrontmostFallbackCaptureChange: (enabled: boolean) => void;
  readonly onDeviceSyncPreviewEnabledChange: (enabled: boolean) => void;
  readonly onWebAccountPreviewEnabledChange: (enabled: boolean) => void;
  readonly onRevertProjectClassificationCorrection: (id: number) => void;
  readonly onOpenDebugLogs: () => void;
  readonly onOpenReplayOnboarding: () => void;
  readonly onPreviewPetModeIntervention: () => void;
  readonly onRehearsePetModeIntercept: () => void;
  readonly onPreviewPetModeBrowserTabClose: () => void;
  readonly onPreviewPetModeDriftyWindowClose: () => void;
  readonly onPlacePetModeCenter: () => void;
  readonly petModeGuidesEnabled?: boolean;
  readonly onTogglePetModeGuides?: () => void;
  readonly onPreviewPetModeAction: (action: PetModePreviewAction) => void;
  readonly onCheckLatestBuild: () => void;
  readonly onInstallLatestBuild: () => void;
  readonly teamsBetaEnabled: boolean;
  readonly profileBetaEnabled: boolean;
  readonly agentsBetaEnabled: boolean;
  readonly onTeamsBetaChange: (enabled: boolean) => void;
  readonly onProfileBetaChange: (enabled: boolean) => void;
  readonly onAgentsBetaChange: (enabled: boolean) => void;
  readonly legacyShellBlurPreviewEnabled: boolean;
  readonly onLegacyShellBlurPreviewEnabledChange: (enabled: boolean) => void;
  readonly onPreviewDashboardAiUnavailableCase: () => void;
  readonly onReplayDashboardDemo?: (kind: DemoDashboardReplayKind) => void;
  readonly onResetDemoDashboardReplaySettings?: () => void;
};

export function DevSettingsSection({
  dashboardAiUnavailablePreview,
  dashboardAiUnavailablePreviewCase,
  sidebarCtaPreviewCase,
  demoDashboardReplaySettings,
  enhancedContextSettings,
  forceBrowserHistoryUrlFallbackEnabled,
  forceChromiumAxCaptureEnabled,
  forceChromiumAxExtremeNudgeEnabled,
  forceFrontmostFallbackCaptureEnabled,
  deviceSyncPreviewEnabled,
  webAccountPreviewEnabled,
  projectClassificationAiReviewEvents,
  projectClassificationCorrectionsBusy,
  projectPassRuns,
  petModeEnabled,
  petModeLabPointerStatus,
  petModeLabInputBounds,
  floatingCompanionDevEnabled,
  onFloatingCompanionDevEnabledChange,
  onPreviewCompanionMilestone,
  onPreviewCompanionMoment,
  onPreviewCompanionDayReview,
  preReleaseUpdateStatus,
  preReleaseUpdateMessage,
  preReleaseUpdateError,
  preReleaseUpdateBusy,
  canInstallPreReleaseUpdate,
  onClearDashboardAiUnavailablePreview,
  onDashboardAiUnavailablePreviewCaseChange,
  onSidebarCtaPreviewCaseChange,
  onDemoDashboardReplayDurationSecondsChange,
  onDemoDashboardReplayPreRollSecondsChange,
  onEnhancedContextCaptureLocalChange,
  onEnhancedContextDebugLoggingChange,
  onEnhancedContextEnabledChange,
  onEnhancedContextRetryLowConfidenceChange,
  onEnhancedContextSourceFamilyChange,
  onForceBrowserHistoryUrlFallbackChange,
  onForceChromiumAxCaptureChange,
  onForceChromiumAxExtremeNudgeChange,
  onForceFrontmostFallbackCaptureChange,
  onDeviceSyncPreviewEnabledChange,
  onWebAccountPreviewEnabledChange,
  onRevertProjectClassificationCorrection,
  onOpenDebugLogs,
  onOpenReplayOnboarding,
  onPreviewPetModeIntervention,
  onRehearsePetModeIntercept,
  onPreviewPetModeBrowserTabClose,
  onPreviewPetModeDriftyWindowClose,
  onPlacePetModeCenter,
  petModeGuidesEnabled,
  onTogglePetModeGuides,
  onPreviewPetModeAction,
  onCheckLatestBuild,
  onInstallLatestBuild,
  teamsBetaEnabled,
  profileBetaEnabled,
  agentsBetaEnabled,
  onTeamsBetaChange,
  onProfileBetaChange,
  onAgentsBetaChange,
  legacyShellBlurPreviewEnabled,
  onLegacyShellBlurPreviewEnabledChange,
  onPreviewDashboardAiUnavailableCase,
  onReplayDashboardDemo,
  onResetDemoDashboardReplaySettings,
}: DevSettingsSectionProps) {
  const { koreanPreviewEnabled, setKoreanPreviewEnabled, t } = useLocalization();
  const [petModeLabState, setPetModeLabState] = useState<PetModeLabState | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetModeLabState(setPetModeLabState).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
      void requestNativePetModeLabState().catch(() => undefined);
    }).catch(() => undefined);
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, []);

  const isPetModeLabActionDisabled = (action: PetModeLabAction) => {
    if (!petModeEnabled) return true;
    if (action === "stop") return false;
    if (action === "wake") return petModeLabState?.phase !== "sleep";
    if (action === "life_loop" && petModeLabState?.lifeLoopEnabled) return true;
    return petModeLabState !== null
      && (petModeLabState.activeAction !== null || petModeLabState.phase !== "idle");
  };
  const petModeLabStatus = !petModeEnabled
    ? "Off"
    : petModeLabState?.phase !== undefined && petModeLabState.phase !== "idle"
      ? formatPetModeLabPhase(petModeLabState.phase)
      : petModeLabState?.lifeLoopEnabled
        ? "Loop on"
        : "Ready";

  return (
    <div className="settings-section">
      <DevSettingsDebugLogsBlock onOpenDebugLogs={onOpenDebugLogs} />
      <SentrySmokeDiagnostics />
      <div className="settings-block settings-block--dev-preview">
        <h3>Pre-release updates</h3>
        <PreReleaseUpdatesSettingsRow
          status={preReleaseUpdateStatus}
          message={preReleaseUpdateMessage}
          error={preReleaseUpdateError}
          busy={preReleaseUpdateBusy}
          canInstallPreReleaseUpdate={canInstallPreReleaseUpdate}
          onCheckLatestBuild={onCheckLatestBuild}
          onInstallLatestBuild={onInstallLatestBuild}
        />
      </div>

      {/* Preview and beta features share one Settings group. */}
      <div className="settings-block settings-block--dev-preview">
        <h3 className="settings-block__title-with-badge" aria-label={t("settings.dev.preview")}>
          <span>{t("settings.dev.preview")}</span>
          <span className="settings-beta-badge">Beta</span>
        </h3>
        {/* Only the Lab stays here. The pet itself, its coat, and its size are
            production settings and live in Companion & Alerts. */}
        <div className="pet-mode-lab" role="group" aria-label="Pet Mode Lab">
          <div className="pet-mode-lab__heading">
            <div>
              <div className="lbl">Pet Mode Lab</div>
              <div className="desc">Run production behaviors individually or leave the approved life loop on for observation. Turn the pet on in Companion &amp; Alerts first.</div>
            </div>
            <span className="pet-mode-lab__status" data-active={petModeEnabled}>{petModeLabStatus}</span>
          </div>
          {petModeLabPointerStatus || petModeLabInputBounds ? (
            <div className="pet-mode-lab__diagnostics" role="status" aria-label="Pet Mode diagnostics">
              {petModeLabPointerStatus ? <div className="pet-mode-lab__diagnostic"><span>Contact</span><code>{petModeLabPointerStatus}</code></div> : null}
              {petModeLabInputBounds ? <div className="pet-mode-lab__diagnostic"><span>Input</span><code>{petModeLabInputBounds}</code></div> : null}
            </div>
          ) : null}
          <div className="pet-mode-lab__groups">
          {/* Six labelled sections with prose under each one pushed the real
              controls far down the page. Everything a button explained now
              lives in its own tooltip, so the Lab is a compact bank of actions
              grouped by what they exercise: the loop, the pet's own behavior,
              and anything that moves the window. */}
          <div className="pet-mode-lab__row">
            <div className="pet-mode-lab__row-copy">
              <div className="lbl">Run</div>
            </div>
            <div className="pet-mode-lab__controls" aria-label="Pet Mode loop controls">
              <PetModeLabAction label="Life loop" detail="Cycle approved behaviors every 8–14 s" action="life_loop" active={petModeLabState?.lifeLoopEnabled === true} disabled={isPetModeLabActionDisabled("life_loop")} onAction={onPreviewPetModeAction} variant="primary" />
              <PetModeLabAction label="Stop" detail="Cancel current action" action="stop" disabled={isPetModeLabActionDisabled("stop")} onAction={onPreviewPetModeAction} variant="stop" />
              <button type="button" className={`settings-btn pet-mode-lab__action${petModeLabState?.activeAction === "intervention" ? " is-active" : ""}`} aria-label="Intervention. Run, paw, and return" title="Run, paw, and return" disabled={isPetModeLabActionDisabled("intervention")} onClick={onPreviewPetModeIntervention}>Intervention</button>
            </div>
          </div>
          <div className="pet-mode-lab__row">
            <div className="pet-mode-lab__row-copy">
              <div className="lbl">Behavior</div>
            </div>
            <div className="pet-mode-lab__controls" aria-label="Pet behavior actions">
              <PetModeLabAction label="Walk" detail="20.8 px/s sample · 0.90×" action="walk" active={petModeLabState?.activeAction === "walk"} disabled={isPetModeLabActionDisabled("walk")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Pet reaction" detail="Lean and heart" action="pet" active={petModeLabState?.activeAction === "pet"} disabled={isPetModeLabActionDisabled("pet")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Blink" detail="228 ms" action="blink" active={petModeLabState?.activeAction === "blink"} disabled={isPetModeLabActionDisabled("blink")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Tail flick" detail="Flow Tail B · 3.1 s" action="tail_flick" active={petModeLabState?.activeAction === "tail_flick"} disabled={isPetModeLabActionDisabled("tail_flick")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Stretch" detail="Flow Stretch C · 3.1 s" action="stretch" active={petModeLabState?.activeAction === "stretch"} disabled={isPetModeLabActionDisabled("stretch")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Sit" detail="G pose QA" action="sit" active={petModeLabState?.activeAction === "sit"} disabled={isPetModeLabActionDisabled("sit")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Sleep" detail="First touch stays asleep" action="sleep" active={petModeLabState?.activeAction === "sleep"} disabled={isPetModeLabActionDisabled("sleep")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Wake" detail="Return to idle" action="wake" active={petModeLabState?.activeAction === "wake"} disabled={isPetModeLabActionDisabled("wake")} onAction={onPreviewPetModeAction} />
            </div>
          </div>
          <div className="pet-mode-lab__row pet-mode-lab__row--target">
            <div className="pet-mode-lab__row-copy">
              <div className="lbl">Placement</div>
            </div>
            <div className="pet-mode-lab__controls" aria-label="Pet placement and target tests">
              <PetModeLabAction label="Outing" detail="Exit · pause · return" action="outing" active={petModeLabState?.activeAction === "outing"} disabled={isPetModeLabActionDisabled("outing")} onAction={onPreviewPetModeAction} />
              <button type="button" className="settings-btn pet-mode-lab__action" aria-label="Center drop. Temporary screen-center placement" title="Temporary screen-center placement, then use Walk to verify resident Y" disabled={isPetModeLabActionDisabled("intervention")} onClick={onPlacePetModeCenter}>Center drop</button>
              <button type="button" className="settings-btn pet-mode-lab__action" aria-label="Browser tab X. Latest observed tab" title="Move to the latest observed tab X and verify paw contact" disabled={isPetModeLabActionDisabled("intervention")} onClick={onPreviewPetModeBrowserTabClose}>Browser tab X</button>
              <button type="button" className="settings-btn pet-mode-lab__action" aria-label="Intercept card. Show the card a caught cat produces" title="Shows the card that appears when the cat is caught before its paw lands, without needing to win the grab first. Nothing is closed." onClick={onRehearsePetModeIntercept}>Intercept card</button>
              <button type="button" className="settings-btn pet-mode-lab__action pet-mode-lab__action--warning" aria-label="Drifty window X. Closes this window" title="Closes this window" disabled={isPetModeLabActionDisabled("intervention")} onClick={onPreviewPetModeDriftyWindowClose}>Drifty window X</button>
              <button type="button" className={`settings-btn pet-mode-lab__action${petModeGuidesEnabled ? " is-active" : ""}`} aria-label="Guide lines. Toggle feet contact, drop calibration guides, and the live drop preview badge" title="Toggle feet contact line (93pt), calibration guides, and the live drop preview badge on the pet overlay" onClick={onTogglePetModeGuides}>Guide lines</button>
            </div>
          </div>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">{t("settings.dev.koreanPreviewLabel")}</div>
            <div className="desc">{t("settings.dev.koreanPreviewDescription")}</div>
          </div>
          <div className="ctrl">
            <Toggle
              checked={koreanPreviewEnabled}
              onChange={setKoreanPreviewEnabled}
              ariaLabel={t("settings.dev.koreanPreviewToggle")}
            />
          </div>
        </div>
        <DevSettingsDeviceSyncBlock
          deviceSyncPreviewEnabled={deviceSyncPreviewEnabled}
          onDeviceSyncPreviewEnabledChange={onDeviceSyncPreviewEnabledChange}
        />
        <DevSettingsWebAccountBlock
          webAccountPreviewEnabled={webAccountPreviewEnabled}
          onWebAccountPreviewEnabledChange={onWebAccountPreviewEnabledChange}
        />
        <div className="settings-row">
          <div>
            <div className="lbl">Team preview (beta)</div>
            <div className="desc">Show the Team section in the sidebar for the internal aggregate team focus surface. Dev-mode opt-in.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={teamsBetaEnabled} onChange={onTeamsBetaChange} ariaLabel="Toggle Teams beta" />
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Profile (beta)</div>
            <div className="desc">Show the public Profile tab in the Social section. Dev-mode opt-in; the leaderboard stays available either way.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={profileBetaEnabled} onChange={onProfileBetaChange} ariaLabel="Toggle Profile beta" />
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Your Agents (beta)</div>
            <div className="desc">Show the Your Agents tab under the Dashboard section: agent session time from local Codex and Claude Code logs, paired with git commit activity. Reads only local files and keeps them local. Dev-mode opt-in.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={agentsBetaEnabled} onChange={onAgentsBetaChange} ariaLabel="Toggle Your Agents beta" />
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="lbl">Legacy shell blur (before/after)</div>
            <div className="desc">Compare the sidebar glass before and after the flicker fix. Off (default) renders the new native under-window blur. On restores the previous CSS backdrop-filter implementation — including its intermittent flicker on the transparent window. Comparison only; never ships as the default.</div>
          </div>
          <div className="ctrl">
            <Toggle checked={legacyShellBlurPreviewEnabled} onChange={onLegacyShellBlurPreviewEnabledChange} ariaLabel="Toggle legacy shell blur preview" />
          </div>
        </div>
      </div>
      <SettingsCollapsibleCard title="Enhanced context (Dev)">
        <DevSettingsEnhancedContextBlock settings={enhancedContextSettings} onCaptureLocalChange={onEnhancedContextCaptureLocalChange} onDebugLoggingChange={onEnhancedContextDebugLoggingChange} onEnabledChange={onEnhancedContextEnabledChange} onRetryLowConfidenceChange={onEnhancedContextRetryLowConfidenceChange} onSourceFamilyChange={onEnhancedContextSourceFamilyChange} />
      </SettingsCollapsibleCard>
      <DevSettingsProjectClassificationBlock
        projectClassificationAiReviewEvents={projectClassificationAiReviewEvents}
        projectClassificationCorrectionsBusy={projectClassificationCorrectionsBusy}
        projectPassRuns={projectPassRuns}
        onRevertProjectClassificationCorrection={onRevertProjectClassificationCorrection}
      />

      {/* Dev-only tools and previews, all merged under one Dev block at the end */}
      <DevSettingsCompanionPillBlock
        floatingEnabled={floatingCompanionDevEnabled}
        onFloatingEnabledChange={onFloatingCompanionDevEnabledChange}
        onPreviewMilestone={onPreviewCompanionMilestone}
        onPreviewMoment={onPreviewCompanionMoment}
        onPreviewDayReview={onPreviewCompanionDayReview}
      />
      <DevSettingsAxFallbackCard
        forceBrowserHistoryUrlFallbackEnabled={forceBrowserHistoryUrlFallbackEnabled}
        forceChromiumAxCaptureEnabled={forceChromiumAxCaptureEnabled}
        forceChromiumAxExtremeNudgeEnabled={forceChromiumAxExtremeNudgeEnabled}
        forceFrontmostFallbackCaptureEnabled={forceFrontmostFallbackCaptureEnabled}
        onForceBrowserHistoryUrlFallbackChange={onForceBrowserHistoryUrlFallbackChange}
        onForceChromiumAxCaptureChange={onForceChromiumAxCaptureChange}
        onForceChromiumAxExtremeNudgeChange={onForceChromiumAxExtremeNudgeChange}
        onForceFrontmostFallbackCaptureChange={onForceFrontmostFallbackCaptureChange}
      />
      <div className="settings-block settings-block--dev-preview">
        <h3>Dev</h3>
        <div className="settings-row">
          <div>
            <div className="lbl">Startup loading screen</div>
            <div className="desc">Show the real startup loading screen over the app for {BOOT_SHELL_PREVIEW_DURATION_SECONDS} seconds.</div>
          </div>
          <div className="ctrl">
            <button
              type="button"
              className="settings-btn"
              onClick={() => { showBootShellPreview(); }}
            >
              Preview {BOOT_SHELL_PREVIEW_DURATION_SECONDS} seconds
            </button>
          </div>
        </div>
        {DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED ? (
          <DashboardDemoReplayControls
            settings={demoDashboardReplaySettings}
            onDurationSecondsChange={onDemoDashboardReplayDurationSecondsChange}
            onPreRollSecondsChange={onDemoDashboardReplayPreRollSecondsChange}
            onReplay={onReplayDashboardDemo}
            onReset={onResetDemoDashboardReplaySettings}
          />
        ) : null}
        {AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED ? (
          <div className="settings-row settings-row--fallback settings-row--ai-preview" role="group" aria-label="AI unavailable preview case">
            <div>
              <div className="lbl">AI unavailable preview</div>
              <div className="desc">
                Apply a selected AI unavailable case to the dashboard three days ago. {dashboardAiUnavailablePreview ? `Active on ${formatDayLabel(dashboardAiUnavailablePreview.appliedDay)}.` : "Dev-mode preview tool."}
              </div>
            </div>
            <div className="ctrl settings-row__actions">
              <div className="settings-mode-switch settings-mode-switch--quad" role="radiogroup" aria-label="AI unavailable preview cases">
                {DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`settings-mode-option${dashboardAiUnavailablePreviewCase === option.id ? " is-active" : ""}`}
                    role="radio"
                    aria-checked={dashboardAiUnavailablePreviewCase === option.id}
                    onClick={() => onDashboardAiUnavailablePreviewCaseChange(option.id)}
                  >
                    <span>{option.label}</span>
                    <small>{option.detail}</small>
                  </button>
                ))}
              </div>
              <button type="button" className="settings-btn settings-btn--primary" onClick={onPreviewDashboardAiUnavailableCase}>Preview 3 days ago</button>
              {dashboardAiUnavailablePreview ? <button type="button" className="settings-btn" onClick={onClearDashboardAiUnavailablePreview}>Clear preview</button> : null}
            </div>
          </div>
        ) : null}
        <div className="settings-row settings-row--fallback settings-row--ai-preview" role="group" aria-label="Sidebar CTA slot preview">
          <div>
            <div className="lbl">Sidebar CTA preview</div>
            <div className="desc">
              Force the freed sidebar slot into one state. Each case runs through the real resolver, so hidden cases stay hidden. {sidebarCtaPreviewCase ? "Preview active." : "Off — showing your live state."}
            </div>
          </div>
          <div className="ctrl settings-row__actions">
            <div className="settings-mode-switch settings-mode-switch--quad" role="radiogroup" aria-label="Sidebar CTA preview cases">
              {SIDEBAR_CTA_PREVIEW_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-mode-option${sidebarCtaPreviewCase === option.id ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={sidebarCtaPreviewCase === option.id}
                  onClick={() => onSidebarCtaPreviewCaseChange(sidebarCtaPreviewCase === option.id ? null : option.id)}
                >
                  <span>{option.label}</span>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>
            {sidebarCtaPreviewCase ? (
              <button type="button" className="settings-btn" onClick={() => onSidebarCtaPreviewCaseChange(null)}>Clear preview</button>
            ) : null}
          </div>
        </div>
        {REPLAY_ONBOARDING_DEV_TOOL_ENABLED ? (
          <div className="settings-row">
            <div>
              <div className="lbl">Replay onboarding</div>
              <div className="desc">Open the setup flow again without clearing saved onboarding state.</div>
            </div>
            <div className="ctrl">
              <button type="button" className="settings-btn" onClick={onOpenReplayOnboarding}>Open onboarding</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PetModeLabAction({
  label,
  detail,
  action,
  active = false,
  disabled,
  onAction,
  variant,
}: {
  readonly label: string;
  readonly detail: string;
  readonly action: PetModePreviewAction;
  readonly active?: boolean;
  readonly disabled: boolean;
  readonly onAction: (action: PetModePreviewAction) => void;
  readonly variant?: "primary" | "stop";
}) {
  return (
    <button type="button" className={`settings-btn pet-mode-lab__action${variant === "primary" ? " pet-mode-lab__action--primary" : ""}${variant === "stop" ? " pet-mode-lab__action--stop" : ""}${active ? " is-active" : ""}`} aria-label={`${label} ${detail}`} title={detail} disabled={disabled} onClick={() => onAction(action)}>
      {label}
    </button>
  );
}

function formatPetModeLabPhase(phase: string): string {
  switch (phase) {
    case "walk": return "Walking";
    case "run": return "Running";
    case "paw": return "Reaching";
    case "blink": return "Blinking";
    case "stretch": return "Stretching";
    case "tail": return "Tail flick";
    case "sleep": return "Sleeping";
    case "sit": return "Sitting";
    case "happy": return "Reacting";
    default: return "Working";
  }
}
