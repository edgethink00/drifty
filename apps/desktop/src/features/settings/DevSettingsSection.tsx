import { useEffect, useId, useState, type CSSProperties } from "react";
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
import { listenToNativePetModeLabState, previewNativePetModeFacing, requestNativePetModeLabState } from "../pet-mode/petModeBridge";
import {
  PET_MODE_SIT_VARIANT_STORAGE_KEY,
  PET_MODE_SIT_VARIANT_OPTIONS,
  resolvePetModeSitVariantSelection,
  type PetModeSitVariantSelectionId,
} from "../pet-mode/petModeSitVariant";
import {
  PET_MODE_FLOOR_HOME_PT,
  PET_MODE_FLOOR_HOME_RANGE,
  PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY,
  type PetModeLabAction,
  type PetModeLabState,
  type PetModePreviewAction,
} from "../pet-mode/petModeData";
import {
  DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
  PET_MODE_DRIFT_HUNT_TUNING_RANGES,
  persistPetModeDriftHuntSettings,
  resolvePetModeDriftCursorReturnTiers,
  resolvePetModeDriftHuntSettings,
  type PetModeDriftHuntSettings,
} from "../pet-mode/petModeDriftHunt";
import { BOOT_SHELL_PREVIEW_DURATION_SECONDS, showBootShellPreview } from "../loading/bootShell";
import type {
  CompanionMilestonePreviewId,
  CompanionMomentPreviewId,
} from "../companion/companionPillPreview";
import { PET_MODE_BROWSER_X_SHORTCUT_LABEL } from "../pet-mode/usePetModeBrowserXShortcut";

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
  readonly petModeRunBetaEnabled: boolean;
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
  readonly onEnhancedContextDebugLoggingChange: (enabled: boolean) => void;
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
  readonly onReplayTutorial: () => void;
  readonly onPetModeRunBetaEnabledChange: (enabled: boolean) => void;
  readonly onPreviewPetModeIntervention: () => void;
  readonly onRehearsePetModeIntercept: () => void;
  readonly onPreviewPetModeBrowserTabClose: () => void;
  readonly petModeBrowserXShortcutEnabled: boolean;
  readonly onPetModeBrowserXShortcutEnabledChange: (enabled: boolean) => void;
  readonly onPreviewPetModeDriftyWindowClose: () => void;
  readonly onPlacePetModeCenter: () => void;
  readonly petModeGuidesEnabled?: boolean;
  readonly onTogglePetModeGuides?: () => void;
  readonly petModeFloorHomePt?: number;
  readonly onPetModeFloorHomePtChange?: (value: number) => void;
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
  petModeRunBetaEnabled,
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
  onEnhancedContextDebugLoggingChange,
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
  onReplayTutorial,
  onPetModeRunBetaEnabledChange,
  onPreviewPetModeIntervention,
  onRehearsePetModeIntercept,
  onPreviewPetModeBrowserTabClose,
  petModeBrowserXShortcutEnabled,
  onPetModeBrowserXShortcutEnabledChange,
  onPreviewPetModeDriftyWindowClose,
  onPlacePetModeCenter,
  petModeGuidesEnabled,
  onTogglePetModeGuides,
  petModeFloorHomePt = PET_MODE_FLOOR_HOME_PT,
  onPetModeFloorHomePtChange,
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
  const { t } = useLocalization();
  const fastRunId = useId().replace(/:/g, "");
  const fastRunLabelId = `pet-run-beta-label-${fastRunId}`;
  const fastRunDescriptionId = `pet-run-beta-desc-${fastRunId}`;
  const [petModeLabState, setPetModeLabState] = useState<PetModeLabState | null>(null);
  const [driftHuntSettings, setDriftHuntSettings] = useState(resolvePetModeDriftHuntSettings);
  const [guaranteedOutcomes, setGuaranteedOutcomes] = useState(
    () => window.localStorage.getItem(PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY) === "1",
  );
  const [sitVariant, setSitVariant] = useState<PetModeSitVariantSelectionId>(resolvePetModeSitVariantSelection);

  const updateDriftHuntSettings = (next: PetModeDriftHuntSettings) => {
    setDriftHuntSettings(next);
    persistPetModeDriftHuntSettings(next);
  };
  const updateGuaranteedOutcomes = (enabled: boolean) => {
    setGuaranteedOutcomes(enabled);
    window.localStorage.setItem(PET_MODE_GUARANTEED_OUTCOMES_STORAGE_KEY, enabled ? "1" : "0");
  };
  const driftHuntCarryTiers = resolvePetModeDriftCursorReturnTiers(driftHuntSettings);

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
    if (action === "music_note") {
      return petModeLabState !== null
        && petModeLabState.activeAction !== null;
    }
    if (action === "cursor_hunt_single" || action === "cursor_hunt_chase") {
      return petModeLabState !== null
        && (petModeLabState.activeAction !== null
          || (petModeLabState.phase !== "idle" && petModeLabState.phase !== "sit"));
    }
    return petModeLabState !== null
      && (petModeLabState.activeAction !== null || petModeLabState.phase !== "idle");
  };
  const petModeLabTargetBusy = !petModeEnabled
    || (petModeLabState !== null
      && (petModeLabState.activeAction === "intervention"
        || petModeLabState.phase === "entry"
        || petModeLabState.phase === "drag"
        || petModeLabState.phase === "release"));
  const petModeLabStatus = !petModeEnabled
    ? "Off"
    : petModeLabState?.activeAction === "music_note"
      ? "Music note"
      : petModeLabState?.phase !== undefined && petModeLabState.phase !== "idle"
        ? formatPetModeLabPhase(petModeLabState.phase)
        : petModeLabState?.lifeLoopEnabled
          ? "Loop on"
          : "Ready";
  const petFacingBusy = !petModeEnabled
    || petModeLabState === null
    || petModeLabState.activeAction !== null
    || (petModeLabState.phase !== "idle" && petModeLabState.phase !== "sit");

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
              <div className="lbl">Motion</div>
              <div className="desc">Choose the experimental renderer used by fast intervention travel.</div>
            </div>
            <div className="pet-mode-lab__experiment-policy" data-active={petModeRunBetaEnabled}>
              <span>
                <strong className="settings-label-with-badge" id={fastRunLabelId}>
                  {t("settings.pet.fastRun")} <span className="status-badge status-badge--beta">{t("common.beta")}</span>
                </strong>
                <small id={fastRunDescriptionId}>{t("settings.pet.fastRunDescription")}</small>
              </span>
              <Toggle
                checked={petModeRunBetaEnabled}
                disabled={!petModeEnabled}
                onChange={onPetModeRunBetaEnabledChange}
                ariaLabel={t("settings.pet.toggleFastRun")}
                ariaDescribedBy={`${fastRunLabelId} ${fastRunDescriptionId}`}
              />
            </div>
          </div>
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
            <div className="pet-mode-lab__target-stack">
              <div className="pet-mode-lab__experiment-policy" data-active={petModeLabState?.facing === "right"}>
                <span>
                  <strong>{petModeLabState?.facing === "right" ? "Facing right" : petModeLabState?.facing === "left" ? "Facing left" : "Facing unavailable"}</strong>
                  <small>Dev-only preview · the next movement chooses its own direction</small>
                </span>
                <Toggle
                  checked={petModeLabState?.facing === "right"}
                  disabled={petFacingBusy}
                  onChange={(faceRight) => { void previewNativePetModeFacing(faceRight ? "right" : "left").catch(() => undefined); }}
                  ariaLabel="Face pet right"
                />
              </div>
              <div className="pet-mode-lab__controls" aria-label="Pet behavior actions">
                <PetModeLabAction label="Walk" detail="20.8 px/s sample · 0.90×" action="walk" active={petModeLabState?.activeAction === "walk"} disabled={isPetModeLabActionDisabled("walk")} onAction={onPreviewPetModeAction} />
                <PetModeLabAction label="Pet reaction" detail="Lean and heart" action="pet" active={petModeLabState?.activeAction === "pet"} disabled={isPetModeLabActionDisabled("pet")} onAction={onPreviewPetModeAction} />
                <PetModeLabAction label="Blink" detail="228 ms" action="blink" active={petModeLabState?.activeAction === "blink"} disabled={isPetModeLabActionDisabled("blink")} onAction={onPreviewPetModeAction} />
                <PetModeLabAction label="Tail flick" detail="Flow Tail B · 3.1 s" action="tail_flick" active={petModeLabState?.activeAction === "tail_flick"} disabled={isPetModeLabActionDisabled("tail_flick")} onAction={onPreviewPetModeAction} />
                <PetModeLabAction label="Stretch" detail="Flow Stretch C · 3.1 s" action="stretch" active={petModeLabState?.activeAction === "stretch"} disabled={isPetModeLabActionDisabled("stretch")} onAction={onPreviewPetModeAction} />
                <PetModeLabAction label="Music note" detail="Manual 760 ms preview" action="music_note" active={petModeLabState?.activeAction === "music_note"} disabled={isPetModeLabActionDisabled("music_note")} onAction={onPreviewPetModeAction} />
                <PetModeLabAction label="Sit" detail="G pose QA" action="sit" active={petModeLabState?.activeAction === "sit"} disabled={isPetModeLabActionDisabled("sit")} onAction={onPreviewPetModeAction} />
                <PetModeLabAction label="Sleep" detail="First touch stays asleep" action="sleep" active={petModeLabState?.activeAction === "sleep"} disabled={isPetModeLabActionDisabled("sleep")} onAction={onPreviewPetModeAction} />
                <PetModeLabAction label="Wake" detail="Return to idle" action="wake" active={petModeLabState?.activeAction === "wake"} disabled={isPetModeLabActionDisabled("wake")} onAction={onPreviewPetModeAction} />
              </div>
            </div>
          </div>
          <div className="pet-mode-lab__row pet-mode-lab__row--scenarios">
            <div className="pet-mode-lab__row-copy">
              <div className="lbl">Scenarios</div>
              <div className="desc">Deterministic combinations for reviewing every expressive state.</div>
            </div>
            <div className="pet-mode-lab__controls" aria-label="Expressive interaction scenarios">
              <PetModeLabAction label="Stretch + note" detail="Guaranteed combination" action="stretch_with_note" active={petModeLabState?.activeAction === "stretch_with_note"} disabled={isPetModeLabActionDisabled("stretch_with_note")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Tail + note" detail="Guaranteed combination" action="tail_flick_with_note" active={petModeLabState?.activeAction === "tail_flick_with_note"} disabled={isPetModeLabActionDisabled("tail_flick_with_note")} onAction={onPreviewPetModeAction} />
              <PetModeLabAction label="Sleep → angry" detail="Guaranteed wake reaction" action="sleep_angry_wake" active={petModeLabState?.activeAction === "sleep_angry_wake"} disabled={isPetModeLabActionDisabled("sleep_angry_wake")} onAction={onPreviewPetModeAction} />
            </div>
          </div>
          <div className="pet-mode-lab__row pet-mode-lab__row--outcome-policy">
            <div className="pet-mode-lab__row-copy">
              <div className="lbl">Guaranteed outcomes</div>
              <div className="desc">Dev-only override for production probability rolls.</div>
            </div>
            <div className="pet-mode-lab__outcome-policy">
              <span>
                <strong>{guaranteedOutcomes ? "Always trigger" : "Natural odds"}</strong>
                <small>{guaranteedOutcomes ? "Wake 100% · notes 100%" : "Wake 25% · notes 5%"}</small>
              </span>
              <Toggle checked={guaranteedOutcomes} onChange={updateGuaranteedOutcomes} ariaLabel="Toggle guaranteed expressive outcomes" />
            </div>
          </div>
          <div className="pet-mode-lab__row pet-mode-lab__row--sit-variant">
            <div className="pet-mode-lab__row-copy">
              <div className="lbl">Sit-pose variant</div>
              <div className="desc">R0.12 character-bible artwork. “Production default” follows the single release switch; refreshes on next sit.</div>
            </div>
            <div className="pet-mode-lab__controls pet-mode-lab__controls--sit-variant" role="radiogroup" aria-label="Sit-pose variant">
              {PET_MODE_SIT_VARIANT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-btn pet-mode-lab__action${sitVariant === option.id ? " is-active" : ""}`}
                  role="radio"
                  aria-checked={sitVariant === option.id}
                  onClick={() => {
                    window.localStorage.setItem(PET_MODE_SIT_VARIANT_STORAGE_KEY, option.id);
                    setSitVariant(option.id);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="pet-mode-lab__row pet-mode-lab__row--target">
            <div className="pet-mode-lab__row-copy">
              <div className="lbl">Placement</div>
            </div>
            <div>
              <div className="pet-mode-lab__controls" aria-label="Pet placement and target tests">
                <PetModeLabAction label="Outing" detail="Exit · pause · return" action="outing" active={petModeLabState?.activeAction === "outing"} disabled={isPetModeLabActionDisabled("outing")} onAction={onPreviewPetModeAction} />
                <button type="button" className="settings-btn pet-mode-lab__action" aria-label="Center drop. Temporary screen-center placement" title="Temporary screen-center placement, then use Walk to verify resident Y" disabled={isPetModeLabActionDisabled("intervention")} onClick={onPlacePetModeCenter}>Center drop</button>
                <button type="button" className="settings-btn pet-mode-lab__action" aria-label="Browser tab X. Latest observed tab" title="Move to the latest observed tab X and verify paw contact" disabled={petModeLabTargetBusy} onClick={onPreviewPetModeBrowserTabClose}>Browser tab X</button>
                <button type="button" className="settings-btn pet-mode-lab__action" aria-label="Intercept card. Show the card a caught cat produces" title="Shows the card that appears when the cat is caught before its paw lands, without needing to win the grab first. Nothing is closed." onClick={onRehearsePetModeIntercept}>Intercept card</button>
                <button type="button" className="settings-btn pet-mode-lab__action pet-mode-lab__action--warning" aria-label="Drifty window X. Closes this window" title="Closes this window" disabled={petModeLabTargetBusy} onClick={onPreviewPetModeDriftyWindowClose}>Drifty window X</button>
                <button type="button" className={`settings-btn pet-mode-lab__action${petModeGuidesEnabled ? " is-active" : ""}`} aria-label="Guide lines. Toggle feet contact, drop calibration, live drop preview, and AX obstacle status" title="Toggle feet contact line (93pt), calibration guides, live drop preview, and AX FREE or BUTTON OVERLAP status on the pet overlay" onClick={onTogglePetModeGuides}>Guide lines</button>
              </div>
              <PetModeHuntRange
                label="하단집"
                detail="발밑 이 거리까지는 땅에 떨어진 것으로 보고 유지합니다. 다음 드롭부터 적용됩니다."
                value={petModeFloorHomePt}
                range={PET_MODE_FLOOR_HOME_RANGE}
                valueLabel={`${petModeFloorHomePt}pt`}
                ariaLabel="Floor home stay band"
                onChange={(value) => onPetModeFloorHomePtChange?.(value)}
              />
              <div className="pet-mode-lab__experiment-policy pet-mode-lab__shortcut-policy" data-active={petModeBrowserXShortcutEnabled}>
                <span>
                  <strong>{petModeBrowserXShortcutEnabled ? "Shortcut armed this session" : "Browser X shortcut off"}</strong>
                  <small>{PET_MODE_BROWSER_X_SHORTCUT_LABEL} · exact observed tab only · resets on app quit</small>
                </span>
                <Toggle
                  checked={petModeEnabled && petModeBrowserXShortcutEnabled}
                  disabled={!petModeEnabled}
                  onChange={onPetModeBrowserXShortcutEnabledChange}
                  ariaLabel="Toggle Browser X session shortcut"
                />
              </div>
            </div>
          </div>
          <div className="pet-mode-lab__row pet-mode-lab__row--hunt">
            <div className="pet-mode-lab__row-copy">
              <div className="lbl">Cursor hunt</div>
              <div className="desc">Dev-only cursor play. Off keeps the production cat passive during drift.</div>
            </div>
            <div className="pet-mode-lab__hunt-policy">
              <div className="pet-mode-lab__hunt-enable">
                <span><strong>{driftHuntSettings.enabled ? "Enabled for QA" : "Off by default"}</strong><small>다음 drift부터 적용</small></span>
                <Toggle checked={driftHuntSettings.enabled} onChange={(enabled) => updateDriftHuntSettings({ ...driftHuntSettings, enabled })} ariaLabel="Toggle drift cursor hunt" />
              </div>
              {driftHuntSettings.enabled ? (
                <>
                  <div className="settings-mode-switch" role="radiogroup" aria-label="Cursor hunt policy">
                    <button type="button" className={`settings-mode-option${driftHuntSettings.mode === "single" ? " is-active" : ""}`} role="radio" aria-checked={driftHuntSettings.mode === "single"} onClick={() => updateDriftHuntSettings({ ...driftHuntSettings, mode: "single" })}><span>한 번만 노림</span></button>
                    <button type="button" className={`settings-mode-option${driftHuntSettings.mode === "chase" ? " is-active" : ""}`} role="radio" aria-checked={driftHuntSettings.mode === "chase"} onClick={() => updateDriftHuntSettings({ ...driftHuntSettings, mode: "chase" })}><span>몇 초간 추격</span></button>
                  </div>
                  <div className="pet-mode-lab__carry-tiers" aria-label="Cursor carry duration tiers">
                    {driftHuntCarryTiers.map(({ label, maxMovementDistance, durationMs }) => (
                      <span key={maxMovementDistance}><strong>{label}</strong><small>{durationMs / 1_000}초 물고 이동</small></span>
                    ))}
                  </div>
                  <div className="pet-mode-lab__hunt-preview" aria-label="Cursor hunt native previews">
                    <PetModeLabAction label="단발 사냥 재생" detail="현재 커서를 한 번 노리는 실제 native 경로" action="cursor_hunt_single" active={petModeLabState?.activeAction === "cursor_hunt_single"} disabled={isPetModeLabActionDisabled("cursor_hunt_single")} onAction={onPreviewPetModeAction} />
                    <PetModeLabAction label={`${driftHuntSettings.chaseDurationMs / 1_000}초 추격 재생`} detail="현재 설정 시간 동안 커서를 추격하는 실제 native 경로" action="cursor_hunt_chase" active={petModeLabState?.activeAction === "cursor_hunt_chase"} disabled={isPetModeLabActionDisabled("cursor_hunt_chase")} onAction={onPreviewPetModeAction} />
                  </div>
                  <details className="pet-mode-lab__hunt-details">
                    <summary>추격 세부 설정 · 자유 조정</summary>
                    <div className="pet-mode-lab__tuning-heading"><span>다가가기</span><small>발견부터 입으로 잡을 때까지</small></div>
                    <PetModeHuntRange label="추격 지속" detail="몇 초간 추격 모드의 제한 시간" value={driftHuntSettings.chaseDurationMs} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.chaseDurationMs} valueLabel={`${(driftHuntSettings.chaseDurationMs / 1_000).toFixed(1)}초`} ariaLabel="Cursor chase duration" onChange={(chaseDurationMs) => updateDriftHuntSettings({ ...driftHuntSettings, chaseDurationMs })} />
                    <PetModeHuntRange label="쫓아가는 속도" detail="고양이가 커서를 따라가는 이동 속도" value={driftHuntSettings.stalkSpeed} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.stalkSpeed} valueLabel={`${driftHuntSettings.stalkSpeed}pt/s`} ariaLabel="Cursor stalk speed" onChange={(stalkSpeed) => updateDriftHuntSettings({ ...driftHuntSettings, stalkSpeed })} />
                    <PetModeHuntRange label="잡는 범위" detail="입이 이 거리 안에 오면 물었다고 판정" value={driftHuntSettings.captureRadius} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.captureRadius} valueLabel={`${driftHuntSettings.captureRadius}pt`} ariaLabel="Cursor capture radius" onChange={(captureRadius) => updateDriftHuntSettings({ ...driftHuntSettings, captureRadius })} />
                    <PetModeHuntRange label="문 직후 멈춤" detail="잡은 순간을 읽을 수 있게 잠깐 정지" value={driftHuntSettings.biteHoldMs} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.biteHoldMs} valueLabel={`${driftHuntSettings.biteHoldMs}ms`} ariaLabel="Cursor bite hold" onChange={(biteHoldMs) => updateDriftHuntSettings({ ...driftHuntSettings, biteHoldMs })} />
                    <div className="pet-mode-lab__hunt-detail-row">
                      <span className="pet-mode-lab__hunt-detail-label"><strong>급한 방향 전환 줄이기</strong><small>커서가 몸을 가로지를 때 잦은 반전 방지</small></span>
                      <Toggle checked={driftHuntSettings.softTurns} onChange={(softTurns) => updateDriftHuntSettings({ ...driftHuntSettings, softTurns })} ariaLabel="Toggle soft cursor chase turns" />
                    </div>
                    <div className="pet-mode-lab__hunt-detail-row">
                      <span className="pet-mode-lab__hunt-detail-label"><strong>발견 느낌표</strong><small>추격 시작 때 주황색 ! 1회</small></span>
                      <Toggle checked={driftHuntSettings.showAlertCue} onChange={(showAlertCue) => updateDriftHuntSettings({ ...driftHuntSettings, showAlertCue })} ariaLabel="Toggle cursor hunt alert cue" />
                    </div>
                    {driftHuntSettings.showAlertCue ? <PetModeHuntRange label="느낌표 길이" detail="팝업이 나타났다 사라지는 시간" value={driftHuntSettings.alertDurationMs} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.alertDurationMs} valueLabel={`${driftHuntSettings.alertDurationMs}ms`} ariaLabel="Cursor hunt alert duration" onChange={(alertDurationMs) => updateDriftHuntSettings({ ...driftHuntSettings, alertDurationMs })} /> : null}

                    <div className="pet-mode-lab__tuning-heading"><span>물고 걷기</span><small>뒤돌아서 커서를 데려가는 구간</small></div>
                    <PetModeHuntRange label="걷는 거리" detail="한 번 물었을 때 데려가는 총 거리" value={driftHuntSettings.carryDistance} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.carryDistance} valueLabel={`${driftHuntSettings.carryDistance}pt`} ariaLabel="Cursor carry distance" onChange={(carryDistance) => updateDriftHuntSettings({ ...driftHuntSettings, carryDistance })} />
                    <PetModeHuntRange label="무저항 시간" detail="마우스를 가만히 뒀을 때 걷는 시간" value={driftHuntSettings.carryStillDurationMs} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.carryStillDurationMs} valueLabel={`${(driftHuntSettings.carryStillDurationMs / 1_000).toFixed(2)}초`} ariaLabel="Still cursor carry duration" onChange={(carryStillDurationMs) => updateDriftHuntSettings({ ...driftHuntSettings, carryStillDurationMs })} />
                    <PetModeHuntRange label="약한 저항 시간" detail="다가갈 때 조금 움직인 커서의 걷는 시간" value={driftHuntSettings.carryNudgeDurationMs} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.carryNudgeDurationMs} valueLabel={`${(driftHuntSettings.carryNudgeDurationMs / 1_000).toFixed(1)}초`} ariaLabel="Nudged cursor carry duration" onChange={(carryNudgeDurationMs) => updateDriftHuntSettings({ ...driftHuntSettings, carryNudgeDurationMs })} />
                    <PetModeHuntRange label="강한 저항 시간" detail="다가갈 때 많이 움직인 커서의 걷는 시간" value={driftHuntSettings.carryYankDurationMs} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.carryYankDurationMs} valueLabel={`${(driftHuntSettings.carryYankDurationMs / 1_000).toFixed(1)}초`} ariaLabel="Resistant cursor carry duration" onChange={(carryYankDurationMs) => updateDriftHuntSettings({ ...driftHuntSettings, carryYankDurationMs })} />
                    <PetModeHuntRange label="마우스 늘어짐" detail="고양이 입보다 커서가 탄성 있게 늦게 따라옴" value={driftHuntSettings.cursorLagMs} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.cursorLagMs} valueLabel={driftHuntSettings.cursorLagMs === 0 ? "붙음" : `${driftHuntSettings.cursorLagMs}ms`} ariaLabel="Cursor carry lag" onChange={(cursorLagMs) => updateDriftHuntSettings({ ...driftHuntSettings, cursorLagMs })} />

                    <div className="pet-mode-lab__tuning-heading"><span>물고 버티기</span><small>사용자가 반대로 당길 때 놓는 감각</small></div>
                    <PetModeHuntRange label="저항 여유" detail="이 거리까지는 마우스 떨림으로 보고 유지" value={driftHuntSettings.cursorSlack} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.cursorSlack} valueLabel={`${driftHuntSettings.cursorSlack}pt`} ariaLabel="Cursor grip slack" onChange={(cursorSlack) => updateDriftHuntSettings({ ...driftHuntSettings, cursorSlack })} />
                    <PetModeHuntRange label="강제 놓기 거리" detail="이만큼 당기면 바로 놓는 거리" value={driftHuntSettings.cursorYankDistance} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.cursorYankDistance} valueLabel={`${driftHuntSettings.cursorYankDistance}pt`} ariaLabel="Cursor yank release distance" onChange={(cursorYankDistance) => updateDriftHuntSettings({ ...driftHuntSettings, cursorYankDistance })} />
                    <PetModeHuntRange label="최대 버티기" detail="약한 저항에 버틸 수 있는 가장 긴 시간" value={driftHuntSettings.cursorGripMs} range={PET_MODE_DRIFT_HUNT_TUNING_RANGES.cursorGripMs} valueLabel={`${driftHuntSettings.cursorGripMs}ms`} ariaLabel="Cursor maximum grip duration" onChange={(cursorGripMs) => updateDriftHuntSettings({ ...driftHuntSettings, cursorGripMs })} />
                    <div className="pet-mode-lab__tuning-footer">
                      <small>슬라이더 변경은 다음 사냥부터 바로 적용됩니다.</small>
                      <button type="button" className="settings-btn" onClick={() => updateDriftHuntSettings({ ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS, enabled: driftHuntSettings.enabled, mode: driftHuntSettings.mode })}>기본값 복원</button>
                    </div>
                  </details>
                </>
              ) : <div className="pet-mode-lab__hunt-off">앉아 있기만 함 · 커서 접근 없음</div>}
            </div>
          </div>
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
            <div className="desc">Show the Your Agents tab under the Dashboard section: agent session time from local logs on this Mac (Codex, Claude Code, Aside, OpenCode, Gemini CLI, Pi, Droid, Amp, Copilot CLI, Qwen CLI, Kiro, Cursor CLI, and other supported tools), paired with git commit activity. Reads only local files and keeps them local. Dev-mode opt-in.</div>
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
      <SettingsCollapsibleCard title="Enhanced context dogfood">
        <DevSettingsEnhancedContextBlock settings={enhancedContextSettings} onDebugLoggingChange={onEnhancedContextDebugLoggingChange} onSourceFamilyChange={onEnhancedContextSourceFamilyChange} />
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
          <>
            <div className="settings-row">
              <div>
                <div className="lbl">Replay onboarding</div>
                <div className="desc">Open the setup flow again without clearing saved onboarding state.</div>
              </div>
              <div className="ctrl">
                <button type="button" className="settings-btn" onClick={onOpenReplayOnboarding}>Open onboarding</button>
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="lbl">Replay tutorial</div>
                <div className="desc">Restart the sidebar walkthrough from Dashboard without changing onboarding completion.</div>
              </div>
              <div className="ctrl">
                <button type="button" className="settings-btn" onClick={onReplayTutorial}>Replay tutorial</button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function PetModeHuntRange({
  label,
  detail,
  value,
  range,
  valueLabel,
  ariaLabel,
  onChange,
}: {
  readonly label: string;
  readonly detail: string;
  readonly value: number;
  readonly range: { readonly min: number; readonly max: number; readonly step: number };
  readonly valueLabel: string;
  readonly ariaLabel: string;
  readonly onChange: (value: number) => void;
}) {
  const fill = ((value - range.min) / (range.max - range.min)) * 100;
  return (
    <label className="pet-mode-lab__hunt-range">
      <span className="pet-mode-lab__hunt-range-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <span className="pet-mode-lab__hunt-range-control">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          aria-label={ariaLabel}
          style={{ "--pet-hunt-range-fill": `${fill}%` } as CSSProperties}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <output aria-hidden="true">{valueLabel}</output>
      </span>
    </label>
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
    case "stalk": return "Hunting cursor";
    case "bite": return "Holding cursor";
    case "return": return "Carrying cursor";
    case "paw": return "Reaching";
    case "blink": return "Blinking";
    case "stretch": return "Stretching";
    case "tail": return "Tail flick";
    case "sleep": return "Sleeping";
    case "sit": return "Sitting";
    case "happy": return "Reacting";
    case "anger": return "Angry wake";
    default: return "Working";
  }
}
