import type { DeleteHistoryRangeResult } from "@drifty/domain";
import { setShareCardRankAccountScope } from "./features/share/shareCardRankCache";
import { canOfferPromoCode, canStartCloudTrial } from "./features/billing/billingEligibility";
import { localizeUpdateMessage } from "./features/localization/settingsMessageTranslations";
import { SettingsSearchNavigatorBridge, SettingsSearchProvider, SettingsSearchDestination } from "./features/settings/SettingsSearchContext";
import { FRIEND_INVITE_SETTING_ID, SETTINGS_SEARCH_ENTRIES, type SettingsSearchEntry } from "./features/settings/settingsSearchCatalog";
import { friendInviteAccountKey, useFriendInvite } from "./features/settings/friendInviteStore";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ModalPresence } from "./components/ModalPresence";
import { deleteHistorySelection } from "./features/history/historyDeletion";
import type { ProjectSaveResult } from "./features/projects/ProjectEditorModal";
import type { ProjectDeleteResult } from "./features/projects/ProjectDeleteConfirmation";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationMetrics, ClassificationOptions, ClassificationRuleInput, CurrentActivitySnapshot, DeveloperDiagnosticsSettings, DeviceTimelineFilter, DriftAlarmTrayStatus, FlowIntervalMinutes, HourBucket, ProductivityLabel, ProductivityShareMix, ProjectAssignmentRecord, ProjectInput, ProjectWindowAssignmentRecord, SiteDuration, TimelinePageCursor, TrackerStatus, UnclassifiedSegmentsQuery } from "@drifty/domain";
import {
  aggregateDeviceElapsedTime,
  clipDeviceElapsedTimeSegment,
  logicalDayStartMs,
  logicalDayIsoDateForDate,
  buildAppUsageSummaries,
  buildFlowBlocksForIntervals,
  filterSegmentsByDevice,
  isFailedForegroundCaptureSegment,
  isYouTubeShortsSegment,
  buildRollingFocusSeconds,
  buildCategoryDurations,
  buildProductivityDurations,
  classifyActivity,
  buildHourlySummary,
  buildPersonalProjectSliceProjection,
  logicalDayEndExclusiveMs,
  shiftIsoDate,
  todayIsoDate,
  totalDurationSeconds,
} from "@drifty/domain";
import logoUrl from "./assets/drifty-mark.svg";
import {
  DASHBOARD_CLOUD_BILLING_VARIANTS,
  resolveDashboardAiUnavailableState,
  isCloudBillingVariant,
} from "./features/dashboard/dashboardAiUnavailableState";
import {
  clearDashboardAiRecoveryDismissal,
  isDashboardAiRecoveryDismissed,
  storeDashboardAiRecoveryDismissal,
} from "./features/dashboard/dashboardAiRecoveryDismissal";
import {
  buildDashboardAiUnavailablePreviewInput,
  type DashboardAiUnavailablePreviewCase,
  type DashboardAiUnavailablePreviewState,
} from "./features/dashboard/dashboardAiUnavailablePreview";
import { useBrowserHistoryBootstrap } from "./features/dashboard/useBrowserHistoryBootstrap";
import { useLeaderboardProfileController } from "./features/leaderboard/useLeaderboardProfileController";
import { IDLE_PROJECT_AUTO_ANALYSIS, projectsAwaitingAutoAnalysis, projectsBlockedOnModel, resolveProjectAutoAnalysisAfterPass, setProjectAutoAnalysisPhase, type ProjectAutoAnalysisState } from "./features/projects/projectAutoAnalysisState";
import { NO_PROJECT_MATCH_COOLDOWN, resolveProjectMatchCooldown } from "./features/projects/projectMatchCooldown";
import { fetchOwnLeaderboardCheckpoint } from "./features/leaderboard/leaderboardService";
import type { SocialSection } from "./features/social/SocialPage";
import { useFocusCard } from "./features/share/useFocusCard";
import { useAccountStatsPublisher } from "./features/account-stats/useAccountStatsPublisher";
import { useDailyProductivitySeries, type DailyProductivityPoint } from "./features/share/dailyProductivity";
import { isTeamQaMockEnabled, useTeamQaMockController } from "./features/team/teamQaMock";
import { useTeamController } from "./features/team/useTeamController";
import type { TeamProjectsSubView } from "./features/team/useTeamProjects";
import { TEAM_INVITE_DEEP_LINK_EVENT, readPendingTeamInviteFromEvent, type PendingTeamInvite } from "./features/team/teamInviteDeepLinks";
import { HISTORY_TIMELINE_PAGE_SIZE, mergeHistoryTimelinePages } from "./features/history/historyPagination";
import { AiConnectionStatusBar, resolveAiConnectionStatus, type AiConnectionStatus } from "./features/ai-connection/AiConnectionStatusBar";
import { applyManagedLocalAiRuntimeStatus, managedLocalAiStatusForModel } from "./features/ai-connection/managedLocalAiRuntimeStatus";
import { SidebarCtaSlot, resolveSidebarCtaSlot } from "./features/sidebar/SidebarCtaSlot";
import { readDayNotePreview } from "./features/day-note/dayNoteGate";
import { resolveTrackerCtaSlot } from "./features/sidebar/trackerCtaSlot";
import { resolveSidebarLiveActivityLabels } from "./features/sidebar/sidebarLiveActivity";
import { ProDecisionSheet, type ProSheetContext } from "./features/billing/ProDecisionSheet";
import { resolveProLooksAccess, type ProLook } from "./features/pro-looks/proLooks";
import { ProLooksProvider, useProLooksController } from "./features/pro-looks/useProLooksController";
import { ProStartedNotice } from "./features/billing/ProStartedNotice";
import { TrialEndNotice } from "./features/billing/TrialEndNotice";
import { getTrialEndFollowUpKey, useTrialEndFollowUp } from "./features/billing/trialEndFollowUp";
import { recordProFunnelStep } from "./lib/analytics/proFunnel";
import { resolvePlanCardState } from "./features/billing/planCardState";
import { canStartIndividualCheckout } from "./features/billing/billingEligibility";
import {
  buildSidebarCtaPreviewInput,
  type SidebarCtaPreviewCase,
} from "./features/sidebar/sidebarCtaSlotPreview";
import {
  isSidebarUpgradeDismissed,
  readSidebarUpgradeDismissedUntil,
  storeSidebarUpgradeDismissal,
} from "./features/sidebar/sidebarUpgradeDismissal";
import {
  isEstablishedCloudAiDisconnect,
  nextCloudAiConnectionCheck,
  type CloudAiConnectionCheck,
} from "./features/ai-connection/aiConnectionHealth";
import { appIconIdentityKey, collectMissingAppIconRequests, mergeAppIconResults, type AppIconLoadRequest } from "./features/app-icons/appIconRequests";
import { collectMissingSiteIconRequests, mergeSiteIconResults, normalizeSiteIconDomain, type SiteIconMap } from "./features/app-icons/siteIconRequests";
import { SiteIconProvider } from "./components/SiteIconContext";
import { cloudAiRequestBackoffs, isDailyCloudQuotaBackoff } from "./features/classification/cloudAiRequestBackoff";
import { AI_CLASSIFICATION_BACKGROUND_THRESHOLD, AI_CLASSIFICATION_FOCUSED_IDLE_MS, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD, classifyLiveActivityWithAi, clearCloudAiRequestBackoff, describeAiClassificationFailure, describeLocalAiClassificationFailure, diffAiClassificationUsageSummary, projectAiClassificationCost, runAiClassification, runAiClassificationForUnknownThreshold, runAiClassificationUntilEmpty, toClassificationQueryForDay, type AiClassificationSummary, type AiClassificationUsageSummary } from "./features/classification/aiClassificationService";
import { testCloudAiConnection } from "./features/settings/cloudAiConnectionTest";
import { getClassificationActivitySnapshot, useClassificationActivity } from "./features/classification/classificationActivity";
import { materializeBuiltInHeuristicClassifications, scheduleBuiltInHeuristicClassificationPersistence, type BuiltInHeuristicClassificationMaterialization } from "./features/classification/heuristicClassificationMaterialization";
import { applyClassificationAvailabilityToAiStatus, isQuietCloudPause, resolveBuiltInHeuristicsUnavailableSince, resolveClassificationAvailability, resolveProjectAnalysisConnected, shouldRunClassificationRecoveryBatch } from "./features/classification/classificationAvailability";
import { useClassificationRulesController } from "./features/classification/useClassificationRulesController";
import { AvailableUpdateDialog } from "./features/updates/AvailableUpdateDialog";
import { TopbarUpdateButton } from "./features/updates/TopbarUpdateButton";
import { useAutomaticUpdateScheduler, WINDOWS_BETA_NEXT_AUTOMATIC_CHECK_STORAGE_KEY } from "./features/updates/useAutomaticUpdateScheduler";
import { useUpdateController } from "./features/updates/useUpdateController";
import { consumePostUpdateRelaunchFocusPending, fallbackUpdatePolicy } from "./features/updates/updatePolicy";
import { useDeveloperPreReleaseUpdateController } from "./features/updates/useDeveloperPreReleaseUpdateController";
import { AppStatusNotice, buildLatestBuildStatusNotice, buildManualUpdateStatusNotice } from "./features/updates/AppUpdateStatusNotice";
import { trackerClient } from "./lib/api/trackerClient";
import { accessibilityClient } from "./lib/api/accessibilityClient";
import type { HostPlatform } from "./lib/api/accessibilityClient";
import { shouldUsePreviewData } from "./lib/api/previewData";
import { setMainWindowThemeAppearance, setOnboardingWindowPresentation } from "./lib/api/windowChromeClient";
import {
  capturePostHogEvent,
  capturePostHogDailyEvent,
  toAnalyticsErrorKind,
} from "./lib/analytics/posthogClient";
import { cleanupTauriEventListener } from "./lib/tauriEventCleanup";
import { AI_AVAILABILITY_CLASSIFICATION_GATE_ENABLED, DEV_SETTINGS_ENABLED, END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED, END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED, isDevOnboardingBypassEnabled, isDevOnboardingForceOpenEnabled } from "./appFeatureSwitches";
import { useAuth } from "./features/auth/AuthContext";
import type { AuthConnectionStatus } from "./features/auth/authConnectionStatus";
import { AuthModal } from "./features/auth/AuthModal";
import { PromoHandoffAccountDialog } from "./features/billing/PromoHandoffAccountDialog";
import {
  clearPendingPromoHandoff,
  hasPendingPromoHandoff,
  storePendingPromoHandoff,
  type BillingSuccessSource,
} from "./features/billing/promoHandoff";
import { describeActionError, type DescribedActionError } from "./lib/actionErrors";
import { AccountDeletionModal } from "./features/auth/AccountDeletionModal";
import { deleteDriftyAccount, type AccountDeletionResult } from "./features/auth/accountDeletionService";
import {
  disconnectGoogleCalendar,
  hasLocalGoogleCalendarConnectionMarker,
} from "./features/calendar/googleCalendarClient";
import { useGoogleCalendarWeek } from "./features/calendar/useGoogleCalendarWeek";
import { hideBootShell } from "./features/loading/bootShell";
import { BUILD_INFO } from "./buildInfo";
import { AccountSettingsSection } from "./features/settings/AccountSettingsSection";
import { SyncSettingsSection } from "./features/settings/SyncSettingsSection";
import { AppearanceSettingsSection } from "./features/settings/AppearanceSettingsSection";
import { ClassificationRulesManager } from "./features/settings/ClassificationRulesManager";
import { DevSettingsSection } from "./features/settings/DevSettingsSection";
import { DeveloperSettingsSection } from "./features/settings/DeveloperSettingsSection";
import { GeneralSettingsSection } from "./features/settings/GeneralSettingsSection";
import type { AppThemeColorKey } from "./features/settings/SettingsColorControls";
import { PetSettingsSection } from "./features/settings/PetSettingsSection";
import { NotificationsSettingsSection } from "./features/settings/NotificationsSettingsSection";
import { PermissionsSettingsSection } from "./features/settings/PermissionsSettingsSection";
import { SettingsSidebar, type SettingsSection } from "./features/settings/SettingsSidebar";
import { settingsSectionsNeedingAttention } from "./features/settings/settingsAttention";
import {
  DEV_SETTINGS_SUBSECTION_STORAGE_KEY,
  resolveDevSettingsReviewSubsection,
  resolveDevSettingsSubsection,
  type DevSettingsSubsection,
} from "./features/settings/devSettingsNavigation";
import {
  applyDarkPalettePreview,
  persistDarkPalettePreview,
  resolveInitialDarkPalettePreview,
  type DarkPalettePreview,
} from "./features/settings/darkPalettePreview";
import { analysisModelDisplayLabel } from "./features/settings/analysisModelSetup";
import {
  AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT,
  readAiPrivacyRequestSettings,
} from "./features/settings/aiPrivacyRequestSettings";
import { useAnalysisModelSetup } from "./features/settings/useAnalysisModelSetup";
import { useProjectClassification } from "./features/classification/useProjectClassification";
import { CommandBar } from "./features/command-bar/CommandBar";
import { NO_PROJECT_COLOR, projectColorMap, type ProjectLegendEntry } from "./features/flow-chart/projectFlowView";
import {
  DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES,
  YOUR_DAY_FLOW_INTERVAL_MINUTES,
  persistDashboardFlowIntervalMinutes,
  resolveInitialDashboardFlowIntervalMinutes,
} from "./features/flow-chart/flowChartDetailPreference";

import { buildDebugLogPayload, readRecentEnhancedContextDebugEvents } from "./features/settings/debugLog";
import { createDeveloperDiagnosticsSync } from "./features/settings/developerDiagnosticsSync";
import { readContextualGuardAuditEvents } from "./features/classification/contextualGuardAuditLog";
import {
  OnboardingModal,
  hasCompletedUserOnboarding,
  readUserOnboardingState,
  type UserOnboardingState,
} from "./features/onboarding/OnboardingModal";
import { FirstDayPreparationScreen, type FirstDayPreparationPhase, type FirstDayPreparationPlan } from "./features/onboarding/FirstDayPreparationScreen";
import { FIRST_DAY_PREPARATION_READY_HOLD_MS } from "./features/onboarding/firstDayPreparationProgress";
import { buildFirstDayRecap, type FirstDayRecap } from "./features/onboarding/firstDayStory";
import { buildFirstDayReviewSiteIcons as buildIntroReviewSiteIcons, buildIntroReviewCase, introReviewDataMode } from "./features/onboarding/introStoryReview";
import { FirstDayPreparationReview } from "./features/onboarding/FirstDayPreparationReview";
import { buildFirstDayChart, buildFirstDayDiscoveries, buildFirstDayReadingSources, firstDayDayRelation } from "./features/onboarding/firstDayPreparationStory";
import { isFirstDayReviewEnabled } from "./features/onboarding/firstDayPreparationReviewData";
import { isInitialDailyFocusQuietPeriod } from "./features/onboarding/initialExperiencePolicy";
import { resolveFirstDayTargetDay, useFirstDayPreparation } from "./features/onboarding/useFirstDayPreparation";
import { readFirstDayCloudBacklog, resumeFirstDayCloudBacklog, updateFirstDayCloudBacklog } from "./features/onboarding/firstDayCloudBacklog";
import { useIntroReviewOverrides } from "./features/onboarding/introReviewOverrides";
import { PostOnboardingSidebarGuide, type GuideDecision } from "./features/onboarding/PostOnboardingSidebarGuideOverlay";
import { isPostOnboardingSidebarGuideReviewEnabled, POST_ONBOARDING_SIDEBAR_GUIDE_STEPS, POST_ONBOARDING_STORY_GUIDE_STEPS } from "./features/onboarding/postOnboardingSidebarGuide";
import { usePostOnboardingSidebarGuide } from "./features/onboarding/usePostOnboardingSidebarGuide";
import type { WatcherPeekEvent, WatcherPeekResponse } from "./features/companion/watcherPeekTypes";
import {
  buildCompanionMilestonePreview,
  type CompanionMilestonePreviewId,
  buildCompanionDriftAlarmPreview,
  buildCompanionExtremeNudgePreview,
  type CompanionMomentPreviewId,
} from "./features/companion/companionPillPreview";
import {
  COMPANION_HIDE_ONE_HOUR_MS,
  persistCompanionHiddenUntil,
  persistCompanionSurfacePolicy,
  resolveInitialCompanionHiddenUntil,
  resolveInitialCompanionSurfacePolicy,
  resolveEffectiveCompanionSurfacePolicy,
  type CompanionResidentPreference,
} from "./features/companion/companionPillSettings";
import { recordCompanionEngagementMetric } from "./features/companion/companionEngagementMetrics";
import { CompanionDayReviewBrowserSurface } from "./features/companion/CompanionDayReviewBrowserSurface";
import {
  buildEndOfDayReviewSummary,
  sumPendingEndOfDayReviewSeconds,
  type EndOfDayReviewEvent,
} from "./features/companion/endOfDayReviewModel";
import {
  buildBreakReturnAlarmEvent,
  buildDriftAlarmEvent,
  type DriftAlarmAction,
  type DriftAlarmCorrectionStatus,
  type DriftAlarmEvent,
  type DriftAlarmFocusTarget,
} from "./features/companion/driftAlarmEvent";
import { CompanionDriftAlarmCard } from "./features/companion/CompanionDriftAlarmCard";
import type { ExtremeNudgeToastEvent } from "./features/companion/extremeNudgeData";
import {
  hideNativeWatcherPeek,
  isTauriRuntime,
  listenToNativeCompanionVisibilityAction,
  listenToNativeEndOfDayReviewAction,
  listenToNativeEndOfDayReviewDisplayed,
  listenToNativeEndOfDayReviewDropped,
  listenToNativeWatcherDismissed,
  listenToNativeWatcherResponse,
  setNativeCompanionSurfacePolicy,
  showNativeCompanionDriftAlarm,
  showNativeCompanionMilestone,
  showNativeEndOfDayReview,
  showNativeExtremeNudgeToast,
  showNativeWatcherPeek,
  updateNativeCompanionPill,
  type CompanionVisibilityAction,
  type EndOfDayReviewAction,
} from "./features/companion/watcherBridge";
import {
  applyNativeExtremeNudge,
  listenToNativeDriftAlarmAction,
  listenToNativeDriftAlarmDismissed,
} from "./features/companion/driftAlarmBridge";
import { getExtremeNudgeFailure } from "./features/companion/extremeNudgeFailure";
import { evaluateYouTubeDriftAlarmGate, type YouTubeDriftAlarmGateSettledResult } from "./features/companion/youtubeDriftAlarmGate";
import { selectedYouTubeDriftReason } from "./features/companion/youtubeDeterministicDrift";
import {
  buildDriftAlarmManualCorrectionRecord,
  buildDriftAlarmManualCorrectionRuleInput,
} from "./features/companion/driftAlarmManualCorrection";
import {
  advanceDriftAlarmSessionProtection,
  armDriftAlarmSessionProtection,
  driftAlarmSessionSuppressionReason,
  type DriftAlarmSessionProtection,
} from "./features/companion/driftAlarmSessionProtection";
import { observeAutomaticCloseReentry, type AutomaticCloseReentry } from "./features/companion/automaticCloseReentry";
import {
  buildPetInterceptionGrace,
  isPetInterceptionGraceActive,
  type PetInterceptionGrace,
} from "./features/companion/petInterceptionGrace";
import {
  consumeDriftAlarmReminder,
  isDriftAlarmReminderDue,
  scheduleDriftAlarmReminder,
  type DriftAlarmReminderState,
} from "./features/companion/driftAlarmReminder";
import {
  CloudTrialStartedNotice,
} from "./features/billing/CloudTrialStartedNotice";
import { useCloudBillingController } from "./features/billing/useCloudBillingController";
import { fetchFriendInvite } from "./features/billing/billingService";
import { useDeviceSyncController } from "./features/device-sync/useDeviceSyncController";
import { buildRemoteDeviceLabels } from "./features/device-sync/deviceTimelineLabels";
import { fetchSyncDevices, purgeCloudSyncData, resumeCloudSyncData } from "./features/device-sync/deviceSyncApi";
import { resetAccountSyncIdentity } from "./features/device-sync/accountDeletionSyncReset";
import { useSshAgentSourceSyncController } from "./features/dev-signals/useSshAgentSourceSyncController";
import {
  clearDeviceSyncCycleRecordsForUser,
  clearPendingDeviceSyncAccountReset,
  findDeviceSyncCycleRecord,
  hasPendingDeviceSyncAccountReset,
  markDeviceSyncAccountResetPending,
  readDeviceSyncCycleRecords,
  readPendingDeviceSyncAccountReset,
} from "./features/device-sync/deviceSyncState";
import {
  SYNC_DELETION_PULL_CURSOR_KEY,
  SYNC_DEVICE_ID_KEY,
  SYNC_GENERATION_KEY,
  SYNC_LAST_PULLED_AT_KEY,
  SYNC_LAST_PUSHED_AT_KEY,
  SYNC_PULL_CURSOR_KEY,
  SYNC_PUSH_SEQ_KEY,
} from "./features/device-sync/deviceSyncEngine";
import { buildSyncStateAfterCloudPurge } from "./features/device-sync/deviceSyncPurgeState";
import { prepareDeviceSyncAccountScope, suspendDeviceSyncAccountScope } from "./features/device-sync/deviceSyncAccountScope";
import { DeviceSyncPurgeConfirmation } from "./features/device-sync/DeviceSyncPurgeConfirmation";
import { AiSetupSettingsSection } from "./features/settings/AiSetupSettingsSection";
import { HistoryDeletionNotice } from "./features/settings/HistoryDeletionNotice";
import { DeleteHistoryModal } from "./features/settings/DeleteHistoryModal";
import { PrivacySettingsSection } from "./features/settings/PrivacySettingsSection";
import { getAuthMetadataAvatarUrl } from "./features/auth/accountDisplay";
import { buildClassificationActivityRows, buildClassificationCategoryBreakdowns, buildClassificationSourceSummaries, classifySegmentSourceKey, classifySourceKey } from "./features/classification/classificationViewData";
import { DRIFT_ALARM_GATE_EXEMPT_SOURCES, buildDriftAlarmCandidates, buildExtremeNudgeTarget, buildExtremeNudgeToastEvent, activateFocusTargetSite, buildRecentFocusTargets, canApplyExtremeNudgeToSurface, hasDriftAlarmFocusTargetUpdate } from "./features/companion/driftAlarmData";
import type { DriftAlarmCandidate } from "./features/companion/driftAlarmData";
import { filterDefinitelyAvailableFocusTargets, haveSameDriftAlarmFocusTargets, resolveAvailableFocusTargets, resolvePostCloseFocusTargets } from "./features/companion/driftAlarmFocusTargetAvailability";
import { buildDriftAlarmCandidateProbe } from "./features/companion/driftAlarmCandidateProbe";
import { buildDriftAlarmDebugEvaluationSummary, readRecentDriftAlarmDebugEvents, recordDriftAlarmDebugEvent, summarizeDriftAlarmCandidate, summarizeDriftAlarmEvent, summarizeDriftAlarmSegment, summarizeDriftAlarmSnapshot, summarizeDriftAlarmTrayResult, summarizeLiveAiClassificationResult, summarizeYouTubeDriftAlarmGateResult } from "./features/companion/driftAlarmDebugLog";
import { buildInterventionLedgerDebugInput } from "./features/companion/interventionLedger";
import { buildDriftAlarmTrayCandidateDetail, buildDriftAlarmTrayStatus, type DriftAlarmTrayResult, type DriftAlarmTrayState } from "./features/companion/driftAlarmTrayStatus";
import { getUnconfirmedDriftAlarmReason, resolveFreshDriftAlarmCandidate } from "./features/companion/driftAlarmFreshCandidate";
import { confirmPetTargetWithRecovery } from "./features/companion/petTargetConfirmation";
import { resolveLiveDriftAlarmAiCandidate } from "./features/companion/liveDriftAlarmAiCandidate";
import {
  resolveDriftAlarmTransientDefer,
  sourceKeyForDriftAlarmCandidate,
  type DriftAlarmTransientPending,
} from "./features/companion/driftAlarmTransientDefer";
import { useCompanionSettingsController } from "./features/companion/useCompanionSettingsController";
import {
  buildPetModeInterventionTarget,
  buildPetModeLabBrowserTabTarget,
  buildPetModeLabDriftyWindowTarget,
  buildPetModePreviewInterventionTarget,
  buildPetModeSnapshot,
  getPetModeWindowSize,
  PET_MODE_GUIDES_STORAGE_KEY,
  PET_MODE_HIDE_ONE_HOUR_MS,
  persistPetModeFloorHomePt,
  persistPetModeHiddenUntil,
  PET_MODE_FLOOR_HOME_PT,
  resolveInitialPetModeFloorHomePt,
  resolveInitialPetModeHiddenUntil,
} from "./features/pet-mode/petModeData";
import {
  applyNativePetModeLabTarget,
  getNativePetInputBounds,
  isNativePetCursorInside,
  isNativePetQuickControlsCursorInside,
  listenToNativePetAlignment,
  listenToNativePetQuickControlsMenuState,
  listenToNativePetPointer,
  listenToNativePetQuickControlsAction,
  setNativePetQuickControlsVisible,
  syncNativePetQuickControlsState,
  listenToNativePetVisibilityAction,
  placeNativePetModeAtCenterForLab,
  playNativePetModeIntervention,
  completeNativePetFullscreenClose,
  previewNativePetModeAction,
  previewNativePetModeIntervention,
  setNativePetModeEnabled,
  setNativePetModeFloorHome,
  setNativePetModeGuides,
  updateNativePetMode,
  type PetModeWindowsDpiEvents,
  type PetVisibilityAction,
} from "./features/pet-mode/petModeBridge";
import { usePetModeVisibilityRequests } from "./features/pet-mode/usePetModeVisibilityRequests";
import { usePetModeNativeSyncDiagnostics } from "./features/pet-mode/usePetModeNativeSyncDiagnostics";
import { waitForPetModeStartupRetryReadiness } from "./features/pet-mode/petModeNativeReadiness";
import {
  canTriggerPetModeBrowserXShortcut,
  usePetModeBrowserXShortcut,
} from "./features/pet-mode/usePetModeBrowserXShortcut";
import { useCompanionDailyFocusMilestones } from "./features/companion/useCompanionDailyFocusMilestones";
import { canEvaluateCompanionDailyFocus } from "./features/companion/companionDailyFocusMilestones";
import { useCompanionFocusRunMilestones } from "./features/companion/useCompanionFocusRunMilestones";
import { useCompanionLeaderboardMilestones } from "./features/companion/useCompanionLeaderboardMilestones";
import { useCompanionCommunityMilestones } from "./features/companion/useCompanionCommunityMilestones";
import { toLeaderboardCelebration, type LeaderboardCelebration } from "./features/companion/companionLeaderboardMilestones";
import { buildBreakRecoveryAttempt, buildBreakSnooze, readDriftAlarmInteractions, recordDriftAlarmInteraction, resolveBreakRecoveryOutcome } from "./features/companion/driftAlarmRecovery";
import { buildAlarmFollowThrough } from "./features/insights/alarmFollowThrough";
import type { BreakRecoveryOutcome, DriftAlarmBreakSnooze, DriftAlarmInteraction } from "./features/companion/driftAlarmRecovery";
import { END_OF_DAY_LEADERBOARD_CHECKPOINT_STORAGE_KEY, END_OF_DAY_REVIEW_TRIGGER_MINUTE, buildMockEndOfDayReviewSegments, buildMockPendingEndOfDayReviewSegments, collectMissingEndOfDayReviewIconRequests, mergeResolvedAppIcons } from "./features/companion/endOfDayReviewData";
import type { EndOfDayReviewSummaryInput } from "./features/companion/endOfDayReviewData";
import {
  END_OF_DAY_REVIEW_MINUTE_STORAGE_KEY,
  endOfDayReviewMinuteToValue,
  endOfDayReviewValueToMinute,
  resolveInitialEndOfDayReviewMinute,
} from "./features/companion/endOfDayReviewSchedule";
import {
  acknowledgeDayReview,
  isDayReviewUserActive,
  readDayReviewDiagnostics,
  recordDayReviewUnseen,
} from "./features/companion/dayReviewScheduler";
import {
  useDayReviewScheduler,
  type DayReviewDeliveryResult,
  type DayReviewPresentationRequest,
} from "./features/companion/useDayReviewScheduler";
import { LIVE_CAPTURE_GAP_GRACE_MS, WATCHER_INITIAL_PEEK_DELAY_MS, WATCHER_STALE_EVENT_RECOVERY_MS, buildCaptureGapWatcherSnapshot, buildLiveWatcherSnapshot, buildWatcherSnapshot, getDefaultWatcherSnapshot, getWatcherContextLabel, getWatcherScheduleDelayMs, persistWatcherResponse, resolveWatcherSnapshot, sendDriftNotification, shouldReplacePetModeLiveSnapshot, showDueDriftWatcherPeek, snapshotObservedAtMs } from "./features/companion/watcherData";
import type { DriftReminderState, WatcherSnapshot } from "./features/companion/watcherData";
import {
  automaticCloseOverrideIsExpired,
  buildAutomaticCloseOverride,
  extendAutomaticCloseOverride,
  persistAutomaticCloseOverride,
  resolveEffectiveAutomaticCloseEnabled,
  resolveInitialAutomaticCloseOverride,
  sendAutomaticCloseOverrideExpiredNotification,
  type AutomaticCloseOverrideKind,
} from "./features/companion/automaticCloseOverride";
import { buildPetModeHidePause } from "./features/pet-mode/petModeHidePause";
import { getDashboardCurrentPeriodLabel, getDashboardPeriodRange, getInsightPeriodRange, getSafeClassificationNavigationDay, resolveDashboardPeriodAnchorDay, shiftDashboardPeriodDay, shiftInsightPeriodDay } from "./features/dashboard/dashboardPeriods";
import type { ClassificationRange, InsightRange } from "./features/dashboard/dashboardPeriods";
import { buildActivityRefreshPlan } from "./features/dashboard/activityRefreshPlan";
import { buildQuarterHourDayField } from "./features/dashboard/dayField";
import { buildDayPatternMetrics, EMPTY_DAY_PATTERN_METRICS } from "./features/dashboard/dayPatternMetrics";
import { DayBreakdownPatterns } from "./features/dashboard/DayBreakdownPatterns";
import { applyFocusDriftReplayReveal, buildFocusDriftChart } from "./features/dashboard/focusDriftChart";
import { buildFocusRatePercent } from "./features/classification/classificationFocusRate";
import {
  WeekDashboardDayModelCache,
  buildWeekDashboardModel,
  emptyWeekDashboardModel,
  prewarmClosedWeekDashboardDays,
  syncWeekDashboardDayModelCacheSettings,
  type WeekDashboardDayModelCacheSettings,
} from "./features/dashboard/weekDashboardModel";
import { useDashboardDemoReplayController } from "./features/dashboard/useDashboardDemoReplayController";
import { buildSelectedDashboardReplayAnchor } from "./features/dashboard/dashboardDemoReplaySource";
import type { DemoDashboardReplayKind } from "./features/dashboard/demoDashboardReplay";
import { buildSelectedDayDashboardClassificationOptions, isDashboardDemoReplayUpdateDialogBlocking, resolveDashboardDemoReplayEffectiveData } from "./features/dashboard/dashboardDemoReplayEffectiveData";
import { buildDashboardDemoReplaySidebarCard } from "./features/dashboard/dashboardDemoReplaySidebarCard";
import { buildAttentionRhythm, buildInsightSourceLists, buildWeeklyBreakdown, NO_PROJECT_KEY, type WeeklyChartMode } from "./features/insights/insightData";
import { selectInsightSegments } from "./features/insights/insightSegments";
import { useAiSetupController } from "./features/settings/useAiSetupController";
import { useManagedLocalModelAttach } from "./features/settings/useManagedLocalModelAttach";
import { useManagedLocalAiStatusObserver } from "./features/settings/useManagedLocalAiStatusObserver";
import { isManagedLocalAiRoute, shouldPreferLegacyAnalysisCustomConnection } from "./features/settings/localAiSetup";
import { LocalizationProvider, useLocalizationController, type LocalizationController } from "./features/localization/LocalizationContext";
import { translateFor } from "./features/localization/translate";
import { isQuietHoursActiveAt, useQuietHoursActive } from "./features/companion/quietHours";
import { AGENTS_BETA_STORAGE_KEY, AI_AVAILABILITY_GATE_DEV_DISABLED_STORAGE_KEY, AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY, APP_THEME_COLOR_STORAGE_KEY, CATEGORY_COLOR_OPTIONS, CATEGORY_COLOR_STORAGE_KEY, FLOATING_COMPANION_DEV_STORAGE_KEY, DEV_MODE_STORAGE_KEY, WEB_ACCOUNT_PREVIEW_STORAGE_KEY, TEAMS_BETA_STORAGE_KEY, PROFILE_BETA_STORAGE_KEY, FORCE_BROWSER_HISTORY_URL_FALLBACK_STORAGE_KEY, FORCE_CHROMIUM_AX_CAPTURE_STORAGE_KEY, FORCE_CHROMIUM_AX_EXTREME_NUDGE_STORAGE_KEY, FORCE_FRONTMOST_FALLBACK_CAPTURE_STORAGE_KEY, SIDEBAR_COLLAPSED_STORAGE_KEY, START_OF_DAY_STORAGE_KEY, START_OF_WEEK_STORAGE_KEY, THEME_STORAGE_KEY, applyAppThemeColorOverrides, hourlyStartOfDayValueToMinutes, isHexColor, minutesToHourlyStartOfDayValue, persistBreakdownPatternsPreviewEnabled, persistBuiltInHeuristicsUnavailableSince, persistDashboardPeriod, persistNavigationRefreshEnabled, persistWindowsBlurEnabled, persistDailyRecordPreviewEnabled, persistDemoDashboardReplaySettings, persistDeviceSyncEnabled, resetDemoDashboardReplaySettings, resolveDeviceSyncEnabled, resolveInitialAgentsBetaEnabled, resolveInitialAiAvailabilityGateDevDisabled, resolveInitialAiClassificationVisibility, resolveInitialAppThemeColorOverrides, resolveInitialBreakdownPatternsPreviewEnabled, resolveInitialBuiltInHeuristicsUnavailableSince, resolveInitialCategoryColorOverrides, resolveInitialDashboardPeriod, resolveInitialFloatingCompanionDevEnabled, resolveInitialDailyRecordPreviewEnabled, resolveInitialDemoDashboardReplaySettings, resolveInitialDevModeEnabled, resolveInitialNavigationRefreshEnabled, resolveInitialWindowsBlurEnabled, resolveInitialWebAccountPreviewEnabled, resolveInitialTeamsBetaEnabled, resolveInitialProfileBetaEnabled, resolveInitialForceBrowserHistoryUrlFallbackEnabled, resolveInitialForceChromiumAxCaptureEnabled, resolveInitialForceChromiumAxExtremeNudgeEnabled, resolveInitialForceFrontmostFallbackCaptureEnabled, resolveInitialSidebarCollapsed, resolveInitialStartOfDayMinutes, resolveInitialStartOfWeek, resolveInitialTheme, retireLegacyDeviceSyncEnabledPreference , LEGACY_DEVICE_SYNC_ENABLED_STORAGE_KEY} from "./features/settings/settingsStorage";
import { ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS, persistEnhancedContextSettings, resolveEffectiveEnhancedContextSettings, resolveInitialEnhancedContextSettings } from "./features/settings/settingsStorage";
import type { AppThemeColorOverrides, CategoryColorOverrides, DemoDashboardReplaySettings, EnhancedContextSettings, EnhancedContextSourceFamily, StartOfWeek, ThemeMode } from "./features/settings/settingsStorage";
import { useLeaderboardSeriesPrewarm } from "./features/leaderboard/useLeaderboardSeriesPrewarm";
import { CATEGORY_COLORS, categoryLabel, productivityLabel } from "./lib/activityLabels";
import { describeRelativeDay, filterSegmentsForRange, formatCompactDurationFromSeconds, formatDateRangeLabel, formatDayLabel, formatDuration, formatLocalDateTime, formatLocalizedDateRangeLabel, formatLocalizedDayLabel, formatLocalizedQuarterHourLabel, formatQuarterHourLabel, formatRelativeTime, formatTimeLabel, getLogicalDayRange, isoDateFromTimestamp, localDateKey, logicalTodayIsoDate, toErrorMessage } from "./lib/formatting";
import { useUsageMilestones } from "./lib/analytics/useUsageMilestones";
import { DateNavigator } from "./components/DateNavigator";
import { MainContentShell, WindowsTitlebar, WindowSidebarToggle, WindowThemeToggle } from "./app/AppShell";
import { replaceNavigationHistoryTab, type NavigationHistoryState, type TabId } from "./app/navigation";
import { resolveSidebarTeamReviewVariant, SidebarNavigation } from "./app/SidebarNavigation";
import { useFeatureNewBadges } from "./features/discovery/useFeatureNewBadges";
import { WhatsNewDialog } from "./features/whats-new/WhatsNewDialog";
import { useWhatsNewChangelog } from "./features/whats-new/useWhatsNewChangelog";
import {
  entriesForBuild,
  toWhatsNewPlatform,
} from "./features/whats-new/whatsNewPolicy";
import {
  captureAiClassificationRun,
  captureAiClassificationRunOncePerDay,
  captureScheduledProjectPass,
  toAiProviderAnalytics,
  toAppSurfaceAnalytics,
  toDashboardPeriodAnalytics,
  toTrackerModeAnalytics,
} from "./app/appAnalytics";
import { aiServerStatusLabelForCloud, driftyCloudStatusLabel, hasAiClassificationUsageMeasurement } from "./features/ai-connection/aiStatusLabels";
import { AccountMenu, type AccountTrackerAttention } from "./features/auth/AccountMenu";
import { AuthConfigurationGate, AuthLoadingGate, AuthRequiredGate } from "./features/auth/AuthGates";
import type { ClassificationPanelStyle } from "./features/classification/ClassificationBreakdownCards";
import { FocusDriftSection, FocusDriftSummaryTiles } from "./features/dashboard/FocusDriftSection";
import type { TimelineHoverState } from "./features/dashboard/HoverCards";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { buildDashboardProjectBySegmentId } from "./features/dashboard/dashboardActivityProjects";
import type {
  ActivityInspectorAttribute,
  ActivityInspectorProjectOption,
  ActivityInspectorSegmentValues,
} from "./features/dashboard/WeekActivityInspector";
import { useStickyDuringLoad } from "./features/dashboard/useStickyDuringLoad";
import type { CompactRingEntry } from "./features/dashboard/CompactRingChart";
import { selectDashboardSegments, type DashboardHistoryRange, type DashboardSegmentSource } from "./features/dashboard/dashboardWeekData";
import { DASHBOARD_PREVIOUS_WEEK_FOCUS_DELAY_MS, resolveAppRefreshTickAction, resolveDashboardRefreshMode, shouldRefreshHistoryData, shouldRollSelectedDayToToday, type DashboardPreviousWeekFocusLoad, type DashboardRefreshInputs, type DashboardWeekRefreshState, type DashboardWeekRefreshStatus } from "./features/dashboard/dashboardRefreshPolicy";
import { DeferredTabBodyFallback } from "./features/loading/DeferredTabBodyFallback";
import { DeferredPageImportFallback } from "./features/loading/DeferredPageImportFallback";
import { TrendsPage } from "./features/insights/TrendsPage";
import { ProfileDialogs } from "./features/profile/ProfileDialogs";
import { copyTextToClipboard } from "./features/profile/ProfileModals";
import { useDeferredTabBodyReady } from "./app/useDeferredTabBodyReady";
import { buildClassificationCorrectionDraft, buildClassificationCorrectionRecord, classificationCorrectionScopeForRow, persistClassificationCorrection, persistUnidentifiedRecordsCorrection, type ClassificationCorrectionDraft, type ClassificationCorrectionNotice, type ClassificationCorrectionScope } from "./features/classification/classificationCorrection";
import { captureCorrectionEvidence } from "./features/classification/correctionEvidence";
import { learnLivingSoulFromFeedback, type SoulLearningProvider } from "./features/classification/soulLearning";
import type { MemorySuggestionProvider } from "./features/classification/memorySuggestionJob";
import { useMemorySuggestionScheduler } from "./features/settings/useMemorySuggestionScheduler";
import type { LocalAiClassificationOptions } from "./features/settings/localAiClassificationOptions";
import { compactHistoryRangeContains, compactHistoryRangeKey, findDisplayableCompactHistoryLoad, findFreshCompactHistoryLoad, pruneCompactHistoryLoads, type CompactHistoryLoad, type CompactHistoryRange } from "./features/dashboard/compactHistoryCache";
import { getDriftAlarmPollTimelineRange, mergeDriftAlarmSegments, pruneExpiredDriftAlarmAiRetries, rememberDriftAlarmSourceSegment, type DriftAlarmEvaluationInput, type DriftAlarmEvaluator, type DriftAlarmTrayPublishOptions } from "./features/companion/driftAlarmEvaluation";
import { EMPTY_ACTIVITY_SEGMENTS, latestActivitySegmentCursor, mergeActivitySegments } from "./lib/activitySegments";
import { scheduleIdleWork } from "./lib/scheduleIdleWork";


const LazyClassificationPage = lazy(async () => ({
  default: (await import("./features/classification/ClassificationPage")).ClassificationPage,
}));
const LazyHistoryView = lazy(async () => ({
  default: (await import("./features/history/HistoryView")).HistoryView,
}));
const LazyProjectsPage = lazy(async () => ({
  default: (await import("./features/projects/ProjectsPage")).ProjectsPage,
}));
const LazyAgentsPage = lazy(async () => ({
  default: (await import("./features/dev-signals/AgentsPage")).AgentsPage,
}));
const LazySocialPage = lazy(async () => ({
  default: (await import("./features/social/SocialPage")).SocialPage,
}));
const LazyTeamsBetaSurface = lazy(async () => ({
  default: (await import("./features/team/TeamsBetaSurface")).TeamsBetaSurface,
}));
const LazyFeedbackModal = lazy(async () => ({
  default: (await import("./features/feedback/FeedbackModal")).FeedbackModal,
}));
const LazyDebugLogModal = lazy(async () => ({
  default: (await import("./features/settings/DebugLogModal")).DebugLogModal,
}));
const POST_UPDATE_RELAUNCH_FOCUS_DELAY_MS = 250;
const MANUAL_UPDATE_STATUS_NOTICE_MS = 6_000;
const APP_REFRESH_INTERVAL_MS = 30_000;
const LIVE_TAIL_LIMIT = 8;
const FULL_HISTORY_SEARCH_RANGE = {
  start: "1970-01-01T00:00:00+00:00",
  end: "9999-12-31T23:59:59+00:00",
} as const;
const LAST_CAPTURE_JUST_NOW_MS = 10_000;
const DRIFT_ALARM_POLL_INTERVAL_MS = 15_000;
const AUTO_AI_CLASSIFICATION_INTERVAL_MS = 2 * 60 * 1000;
const CLOUD_AI_RECOVERY_TEST_INTERVAL_MS = 10 * 60 * 1000;
const CLOUD_AI_RECOVERY_FAILED_PROBE_MAX_INTERVAL_MS = 60 * 60 * 1000;
// Heavy project pass cadence: hourly keeps "today" fresh without the cost/churn
// of finer cadences. Eval-cadence experiment (2026-07-10): 15m ≈ 3.7× the cost
// and ~13× the mid-day assignment revisions of 60m for no end-of-day accuracy
// gain, so 60m is the efficient pick.
const PROJECT_PASS_SCHEDULE_INTERVAL_MS = 60 * 60 * 1000;
// Debounce window for creation-triggered matching. Long enough to absorb a
// burst of "add several projects in a row", short enough that a single
// creation still feels immediate.
const PROJECT_AUTO_ANALYSIS_DEBOUNCE_MS = 8_000;
const LIVE_DRIFT_ALARM_AI_UNAVAILABLE_RETRY_MS = 2 * 60 * 1000;
const LIVE_DRIFT_ALARM_AI_UNKNOWN_RETRY_MS = 5 * 60 * 1000;

function currentSoulLearningProvider(
  localOptions: LocalAiClassificationOptions | null,
  canUseCloud: boolean,
): SoulLearningProvider {
  if (localOptions) return { kind: "local", provider: localOptions.localProvider };
  return canUseCloud ? { kind: "cloud" } : { kind: "none" };
}
function isLastCaptureJustNow(value: string, nowMs = Date.now()): boolean {
  const capturedAtMs = new Date(value).getTime();
  if (Number.isNaN(capturedAtMs)) return false;
  return Math.max(0, nowMs - capturedAtMs) < LAST_CAPTURE_JUST_NOW_MS;
}

function loadClassificationMetrics(day: string): Promise<ClassificationMetrics | null> {
  const client = trackerClient as Partial<typeof trackerClient>;
  return typeof client.getClassificationMetrics === "function"
    ? client.getClassificationMetrics({ day }).catch(() => null)
    : Promise.resolve(null);
}

function loadAiClassificationUsage(_day: string): Promise<AiClassificationUsageSummary | null> {
  return Promise.resolve(null);
}

function isRendererFocused(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function assertNever(value: never): never {
  throw new Error(`Unexpected app state: ${JSON.stringify(value)}`);
}

/**
 * Creates the display-language controller and provides it before any other
 * app hook runs. AppBody's own body calls hooks that translate (billing,
 * leaderboard); when App created the controller and provided it only in the
 * tree it returned, those hooks read the English default in a Korean app.
 * AppBody's return paths still wrap their trees in the same controller; this
 * outer provider is the one its hooks depend on.
 */
// Dev-server design review of where the day note lives (?driftyNote=1).
// import.meta.env.DEV is false in production builds, so none of it ships.
const DayNoteNavItemPreview = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("./features/day-note/DayNotePreview")).DayNoteNavItem }))
  : null;
const DayNotePagePreview = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("./features/day-note/DayNotePreview")).DayNotePage }))
  : null;
const DayNoteMomentPreview = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("./features/day-note/DayNotePreview")).DayNoteMoment }))
  : null;
// Dev mode's Daily record preview (all builds, off by default): the page on this Mac's own records.
const LazyDayRecordPage = lazy(async () => ({ default: (await import("./features/day-note/DayRecordPage")).DayRecordPage }));
const LazyDayRecordNavItem = lazy(async () => ({ default: (await import("./features/day-note/DayRecordPage")).DayRecordNavItem }));
const DayNoteDevBarPreview = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import("./features/day-note/DayNotePreview")).DayNoteDevBar }))
  : null;

export default function App() {
  const localization = useLocalizationController();
  return (
    <LocalizationProvider controller={localization}>
      <AppBody localization={localization} />
    </LocalizationProvider>
  );
}

/** How long the intro waits for the prepared day to load before opening on the sample cards. */
const INTRO_STORY_WAIT_MS = 6_000;

function AppBody({ localization }: { readonly localization: LocalizationController }) {
  /* Companion cards and macOS notifications are built here as strings before
     they cross to another window, so their wording follows the display
     language at build time. */
  const companionLanguage = localization.effectiveLanguage;
  const companionTranslate = useMemo(() => translateFor(companionLanguage), [companionLanguage]);
  const sidebarTeamReviewVariant = resolveSidebarTeamReviewVariant();
  const devSettingsReviewSubsection = resolveDevSettingsReviewSubsection(window.location.search);
  const initialDevModeEnabled = devSettingsReviewSubsection !== null
    || isDevOnboardingBypassEnabled()
    || resolveInitialDevModeEnabled();
  const initialNavigationRefreshEnabled = initialDevModeEnabled
    && resolveInitialNavigationRefreshEnabled();
  const initialBreakdownPatternsPreviewEnabled = initialDevModeEnabled
    && resolveInitialBreakdownPatternsPreviewEnabled();
  useEffect(() => {
    readContextualGuardAuditEvents();
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.driftyBuildCommit = BUILD_INFO.commit;
    root.dataset.driftyAppVersion = BUILD_INFO.version;
    return () => {
      delete root.dataset.driftyBuildCommit;
      delete root.dataset.driftyAppVersion;
    };
  }, []);
  const contentRef = useRef<HTMLElement>(null);
  const previousSurfaceAnalyticsKeyRef = useRef<string | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryState>(() => ({
    entries: [{
      tabId: devSettingsReviewSubsection
        ? "settings"
        : import.meta.env.DEV && readDayNotePreview()?.place === "insights" ? "trends" : "dashboard",
      dashPeriod: initialNavigationRefreshEnabled ? resolveInitialDashboardPeriod() : "Today",
    }],
    index: 0,
  }));
  const activeSnapshot = navigationHistory.entries[navigationHistory.index] ?? { tabId: "dashboard", dashPeriod: "Today" };
  const rawActiveTab = activeSnapshot.tabId;
  const activeTab = rawActiveTab === "profile" ? "leaderboard" : rawActiveTab;
  const socialSection: SocialSection = rawActiveTab === "profile" ? "profile" : "leaderboard";
  const dashPeriod = activeSnapshot.dashPeriod;
  const isDashboardWeekView = activeTab === "dashboard" && dashPeriod === "Week";
  const isDeferredTabBodyReady = useDeferredTabBodyReady(activeTab);
  const canNavigateBack = navigationHistory.index > 0;
  const canNavigateForward = navigationHistory.index < navigationHistory.entries.length - 1;
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme);
  const [darkPalettePreview, setDarkPalettePreview] = useState(resolveInitialDarkPalettePreview);
  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(resolveInitialSidebarCollapsed);
  const [selectedDay, setSelectedDay] = useState(() => logicalTodayIsoDate(resolveInitialStartOfDayMinutes()));
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [trackerPausePending, setTrackerPausePending] = useState(false);
  const trackerPauseIntentRef = useRef(false);
  trackerPauseIntentRef.current = trackerPausePending || status?.trackingPaused === true;
  const hasTrackerStatus = status !== null;
  const [brandCaptureMotionKey, setBrandCaptureMotionKey] = useState(0);
  const triggerBrandCaptureMotion = useCallback(() => {
    setBrandCaptureMotionKey((currentKey) => currentKey + 1);
  }, []);
  const brandCaptureEventAtRef = useRef<string | null>(null);
  const hasObservedBrandCaptureRef = useRef(false);
  const [hostPlatform, setHostPlatform] = useState<HostPlatform>(accessibilityClient.detectHostPlatform);
  // index.html seeds data-platform from a user-agent guess so the first paint
  // already has Windows chrome. Reassert it from the real host detection: the
  // whole Windows token layer hangs off this one attribute, and a wrong guess
  // silently drops the titlebar metrics, panel radius, and font overrides.
  useLayoutEffect(() => {
    document.documentElement.dataset.platform = hostPlatform;
  }, [hostPlatform]);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [accessibilityRequired, setAccessibilityRequired] = useState(hostPlatform !== "windows");
  const [currentSnapshot, setCurrentSnapshot] = useState<CurrentActivitySnapshot | null>(null);
  const [liveCaptureGapExpired, setLiveCaptureGapExpired] = useState(false);
  // True until a refresh has settled its first live snapshot; the sidebar keeps
  // its pre-load placeholder meanwhile (resolveSidebarLiveActivityLabels).
  const [awaitingFirstCurrentSnapshot, setAwaitingFirstCurrentSnapshot] = useState(true);
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [segmentsLoadedDay, setSegmentsLoadedDay] = useState<string | null>(null);
  const [historySegments, setHistorySegments] = useState<ActivitySegment[]>([]);
  const [historySegmentsLoadedRange, setHistorySegmentsLoadedRange] = useState<DashboardHistoryRange | null>(null);
  const [historyNextCursor, setHistoryNextCursor] = useState<TimelinePageCursor | null>(null);
  const [historyHasMoreSegments, setHistoryHasMoreSegments] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyLoadMoreError, setHistoryLoadMoreError] = useState<DescribedActionError | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historySearchSegments, setHistorySearchSegments] = useState<ActivitySegment[]>([]);
  const [historySearchNextCursor, setHistorySearchNextCursor] = useState<TimelinePageCursor | null>(null);
  const [historySearchHasMoreSegments, setHistorySearchHasMoreSegments] = useState(false);
  const [historySearchLoading, setHistorySearchLoading] = useState(false);
  const [historySearchError, setHistorySearchError] = useState<DescribedActionError | null>(null);
  const normalizedHistorySearchQuery = historySearchQuery.trim();
  const isHistorySearchActive = normalizedHistorySearchQuery.length > 0;
  const [dashboardPreviousWeekFocusLoad, setDashboardPreviousWeekFocusLoad] = useState<DashboardPreviousWeekFocusLoad | null>(null);
  const [dashboardPreviousDayFocusLoad, setDashboardPreviousDayFocusLoad] = useState<DashboardPreviousWeekFocusLoad | null>(null);
  const [dashboardWeekRefreshState, setDashboardWeekRefreshState] = useState<DashboardWeekRefreshState>({ key: null, status: "idle" });
  const [hourly, setHourly] = useState<HourBucket[]>([]);
  const [insightHourly, setInsightHourly] = useState<HourBucket[]>([]);
  const [insightTopSites, setInsightTopSites] = useState<SiteDuration[]>([]);
  const [appIcons, setAppIcons] = useState<AppIconMap>({});
  const appIconsRef = useRef<AppIconMap>({});
  const [siteIcons, setSiteIcons] = useState<SiteIconMap>({});
  const siteIconsRef = useRef<SiteIconMap>({});
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentsFlowIntervalMinutes, setAgentsFlowIntervalMinutes] = useState<FlowIntervalMinutes>(resolveInitialDashboardFlowIntervalMinutes);
  const handleAgentsFlowIntervalChange = useCallback((intervalMinutes: FlowIntervalMinutes) => {
    setAgentsFlowIntervalMinutes(persistDashboardFlowIntervalMinutes(intervalMinutes));
  }, []);
  const [classificationRange, setClassificationRange] = useState<ClassificationRange>("Day");
  const [trendsRange, setTrendsRange] = useState<InsightRange>("Week");
  const [weeklyChartMode, setWeeklyChartMode] = useState<WeeklyChartMode>("category");
  const [classifySelectedCategoryId, setClassifySelectedCategoryId] = useState<ActivityCategory | null>(null);
  const [classifySelectedSourceId, setClassifySelectedSourceId] = useState<string | null>(null);
  const [expandedClassificationActivityRows, setExpandedClassificationActivityRows] = useState<Set<string>>(() => new Set());
  const [classificationCorrectionDraft, setClassificationCorrectionDraft] = useState<ClassificationCorrectionDraft | null>(null);
  const [classificationCorrectionNotice, setClassificationCorrectionNotice] = useState<ClassificationCorrectionNotice | null>(null);
  const [classificationCorrectionSaving, setClassificationCorrectionSaving] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    devSettingsReviewSubsection ? "dev" : "general",
  );
  const [devSettingsSubsection, setDevSettingsSubsection] = useState(() => (
    devSettingsReviewSubsection
      ?? resolveDevSettingsSubsection(window.localStorage.getItem(DEV_SETTINGS_SUBSECTION_STORAGE_KEY))
  ));
  const handleDevSettingsSubsectionChange = useCallback((subsection: DevSettingsSubsection) => {
    setDevSettingsSubsection(subsection);
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, []);
  const canSafelyRestartRef = useRef<() => boolean>(() => true);
  const petOccupancyRef = useRef({ enabled: false, hiddenUntil: null as number | null, menuOpen: false });
  const [devModeEnabled, setDevModeEnabled] = useState(initialDevModeEnabled);
  const isDevModeActive = DEV_SETTINGS_ENABLED && devModeEnabled;
  const windowsBetaAutomaticChecksEnabled = isTauriRuntime()
    && hostPlatform === "windows"
    && isDevModeActive;
  const {
    backgroundUpdatesEnabled,
    availableUpdate,
    availableUpdateSource,
    canAutoUpdateSilently,
    currentUpdatePolicy,
    dismissAvailableUpdate,
    handleCheckForUpdates,
    handleInstallUpdate,
    setBackgroundUpdatesEnabled,
    shouldShowAvailableUpdateDialog,
    updateLifecycleStatus,
    updaterChecking,
    updaterDownloading,
    updaterDownloadProgress,
    updaterError,
    updaterInstalling,
    updaterMessage,
  } = useUpdateController({
    backgroundPreparationSupported: hostPlatform === "macos" || hostPlatform === "windows",
    hostPlatform,
    stableAutomaticUpdatesEnabled: !windowsBetaAutomaticChecksEnabled,
    getIdleSeconds: async () => {
      try {
        const occupancy = petOccupancyRef.current;
        if (occupancy.enabled && occupancy.hiddenUntil === null) {
          if (occupancy.menuOpen) return 0;
          const [petCursorInside, controlsCursorInside] = await Promise.all([
            isNativePetCursorInside(),
            isNativePetQuickControlsCursorInside(),
          ]);
          // A failed occupancy probe is not proof the pet is idle.
          if (petCursorInside !== false || controlsCursorInside === true) return 0;
        }
        const s = await trackerClient.getStatus();
        // If the tracker is actively recording (e.g. video, meeting, or interactive work),
        // treat as active even if the mouse hasn't moved
        if (s.running && s.trackerMode && s.trackerMode !== "idle") {
          return 0;
        }
        return s.idleSeconds ?? null;
      } catch {
        return null;
      }
    },
    canSafelyRestart: () => canSafelyRestartRef.current(),
  });
  const developerPreReleaseUpdateController = useDeveloperPreReleaseUpdateController();
  const [manualUpdateNoticeVisible, setManualUpdateNoticeVisible] = useState(false);
  const [latestBuildNoticeVisible, setLatestBuildNoticeVisible] = useState(false);
  const [windowsBlurEnabled, setWindowsBlurEnabled] = useState(resolveInitialWindowsBlurEnabled);
  const [teamsBetaEnabled, setTeamsBetaEnabled] = useState(resolveInitialTeamsBetaEnabled);
  const [profileBetaEnabled, setProfileBetaEnabled] = useState(resolveInitialProfileBetaEnabled);
  const [agentsBetaEnabled, setAgentsBetaEnabled] = useState(resolveInitialAgentsBetaEnabled);
  const [navigationRefreshEnabled, setNavigationRefreshEnabled] = useState(initialNavigationRefreshEnabled);
  const [breakdownPatternsPreviewEnabled, setBreakdownPatternsPreviewEnabled] = useState(initialBreakdownPatternsPreviewEnabled);
  const floatingCompanionDevSupported = hostPlatform === "macos";
  const [floatingCompanionDevEnabled, setFloatingCompanionDevEnabled] = useState(
    () => floatingCompanionDevSupported && resolveInitialFloatingCompanionDevEnabled(),
  );
  const [dailyRecordPreviewEnabled, setDailyRecordPreviewEnabled] = useState(resolveInitialDailyRecordPreviewEnabled);
  const [teamSubView, setTeamSubView] = useState<TeamProjectsSubView>("dashboards");
  const [pendingTeamInvite, setPendingTeamInvite] = useState<PendingTeamInvite | null>(null);
  useAutomaticUpdateScheduler({
    enabled: isTauriRuntime() && !windowsBetaAutomaticChecksEnabled,
    checkForUpdates: () => handleCheckForUpdates("automatic"),
  });
  useAutomaticUpdateScheduler({
    enabled: windowsBetaAutomaticChecksEnabled,
    checkForUpdates: developerPreReleaseUpdateController.checkLatestBuild,
    storageKey: WINDOWS_BETA_NEXT_AUTOMATIC_CHECK_STORAGE_KEY,
  });
  const isDailyRecordPreviewActive = isDevModeActive && dailyRecordPreviewEnabled;
  const [browserContentContextEnabled, setBrowserContentContextEnabled] = useState(() => readAiPrivacyRequestSettings().optional.contentContext);
  useEffect(() => {
    const refresh = () => setBrowserContentContextEnabled(readAiPrivacyRequestSettings().optional.contentContext);
    window.addEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const [enhancedContextSettings, setEnhancedContextSettings] = useState<EnhancedContextSettings>(resolveInitialEnhancedContextSettings);
  const effectiveEnhancedContextSettings = resolveEffectiveEnhancedContextSettings(isDevModeActive, enhancedContextSettings);
  const canOpenTeamsBeta = (devModeEnabled && teamsBetaEnabled) || isTeamQaMockEnabled();
  const canOpenProfileBeta = DEV_SETTINGS_ENABLED && devModeEnabled && profileBetaEnabled;
  const canUseNavigationRefresh = DEV_SETTINGS_ENABLED && devModeEnabled && navigationRefreshEnabled;
  const canUseBreakdownPatternsPreview = DEV_SETTINGS_ENABLED && devModeEnabled && breakdownPatternsPreviewEnabled;
  const canOpenAgentsBeta = DEV_SETTINGS_ENABLED && devModeEnabled && agentsBetaEnabled;
  const canOpenAgents = canUseNavigationRefresh || canOpenAgentsBeta;
  const sshAgentSourceSync = useSshAgentSourceSyncController({
    enabled: canOpenAgents && isTauriRuntime(),
  });
  const [companionSurfacePolicy, setCompanionSurfacePolicy] = useState(resolveInitialCompanionSurfacePolicy);
  const [companionHiddenUntil, setCompanionHiddenUntil] = useState(resolveInitialCompanionHiddenUntil);
  const floatingCompanionDevActive = floatingCompanionDevSupported
    && isDevModeActive
    && floatingCompanionDevEnabled;
  const companionResidentEnabled = companionSurfacePolicy !== "off";
  const companionTemporarilyHidden = companionHiddenUntil !== null && companionHiddenUntil > Date.now();
  const effectiveCompanionSurfacePolicy = resolveEffectiveCompanionSurfacePolicy(
    companionSurfacePolicy,
    floatingCompanionDevActive,
    companionTemporarilyHidden,
  );
  // Dev-only: "floating" is unreachable from the public preference
  // (`"menuBar" | "off"`), so this is true only under Dev mode with the
  // floating-companion toggle on. Treat the resident pill as a Dev surface.
  const companionPillVisible = effectiveCompanionSurfacePolicy === "floating";

  const handleCompanionSurfacePolicyChange = useCallback((policy: CompanionResidentPreference) => {
    setCompanionSurfacePolicy((currentPolicy) => {
      const nextPolicy = persistCompanionSurfacePolicy(policy);
      if (nextPolicy !== currentPolicy) {
        recordCompanionEngagementMetric(nextPolicy === "off" ? "companion_disabled" : "companion_enabled");
      }
      return nextPolicy;
    });
    setCompanionHiddenUntil(persistCompanionHiddenUntil(null));
  }, []);

  const handleFloatingCompanionDevEnabledChange = useCallback((enabled: boolean) => {
    if (!floatingCompanionDevSupported) return;
    setFloatingCompanionDevEnabled(enabled);
  }, [floatingCompanionDevSupported]);

  const handleHideCompanionForOneHour = useCallback(() => {
    if (!companionResidentEnabled) return;
    setCompanionHiddenUntil(persistCompanionHiddenUntil(Date.now() + COMPANION_HIDE_ONE_HOUR_MS));
    recordCompanionEngagementMetric("companion_hidden_one_hour");
  }, [companionResidentEnabled]);

  const handleCompanionVisibilityAction = useCallback((action: CompanionVisibilityAction) => {
    if (action === "hideOneHour") {
      handleHideCompanionForOneHour();
      return;
    }
    handleCompanionSurfacePolicyChange("off");
  }, [handleCompanionSurfacePolicyChange, handleHideCompanionForOneHour]);

  useEffect(() => {
    if (companionHiddenUntil === null) return undefined;
    const remainingMs = companionHiddenUntil - Date.now();
    if (remainingMs <= 0) {
      setCompanionHiddenUntil(persistCompanionHiddenUntil(null));
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setCompanionHiddenUntil(persistCompanionHiddenUntil(null));
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [companionHiddenUntil]);

  useEffect(() => {
    void setNativeCompanionSurfacePolicy(effectiveCompanionSurfacePolicy).catch((error: unknown) => {
      console.warn("Failed to update the Companion surface policy", toErrorMessage(error));
    });
  }, [effectiveCompanionSurfacePolicy]);

  useEffect(() => {
    const client = trackerClient as Partial<typeof trackerClient>;
    if (typeof client.updateTrayIconStyle !== "function") return;
    void client.updateTrayIconStyle("compact").catch(() => undefined);
  }, []);
  // Project classification is a Dev-mode preview control (opt-in, off by default):
  // the Dev-settings toggle is the sole gate, so it is available in any build —
  // including public/prerelease binaries — only after the user turns it on.
  // Project classification (Projects tab + Intelligence analysis) shipped as a
  // default-on production surface — the Dev-mode preview gate is retired.
  const projectClassificationFeatureEnabled = true;
  const [deviceSyncEnabled, setDeviceSyncEnabled] = useState(false);
  const [deviceSyncAccountResetPending, setDeviceSyncAccountResetPending] = useState(hasPendingDeviceSyncAccountReset);
  const recoverPendingDeviceSyncAccountResetOnLaunchRef = useRef(deviceSyncAccountResetPending);
  const [deviceSyncPreferenceOwnerId, setDeviceSyncPreferenceOwnerId] = useState<string | null>(null);
  const deviceSyncToggleGenerationRef = useRef(0);
  const [aiAvailabilityGateDevDisabled, setAiAvailabilityGateDevDisabled] = useState(resolveInitialAiAvailabilityGateDevDisabled);
  const [deviceTimelineFilter, setDeviceTimelineFilter] = useState<DeviceTimelineFilter>("all");
  // Dev-only gate for the web account preview: embed detail-share toggles on the Profile
  // tab + background publishing of the aggregate account summary for drifty.so.
  const [devWebAccountPreviewEnabled, setDevWebAccountPreviewEnabled] = useState(resolveInitialWebAccountPreviewEnabled);
  const [forceChromiumAxCaptureEnabled, setForceChromiumAxCaptureEnabled] = useState(resolveInitialForceChromiumAxCaptureEnabled);
  const [forceFrontmostFallbackCaptureEnabled, setForceFrontmostFallbackCaptureEnabled] = useState(resolveInitialForceFrontmostFallbackCaptureEnabled);
  const [forceBrowserHistoryUrlFallbackEnabled, setForceBrowserHistoryUrlFallbackEnabled] = useState(resolveInitialForceBrowserHistoryUrlFallbackEnabled);
  const [forceChromiumAxExtremeNudgeEnabled, setForceChromiumAxExtremeNudgeEnabled] = useState(resolveInitialForceChromiumAxExtremeNudgeEnabled);
  const [startOfDayMinutes, setStartOfDayMinutes] = useState(resolveInitialStartOfDayMinutes);
  const [startOfWeek, setStartOfWeek] = useState<StartOfWeek>(resolveInitialStartOfWeek);
  const [endOfDayReviewMinute, setEndOfDayReviewMinute] = useState(resolveInitialEndOfDayReviewMinute);
  const [demoDashboardReplaySettings, setDemoDashboardReplaySettings] = useState<DemoDashboardReplaySettings>(resolveInitialDemoDashboardReplaySettings);
  const [categoryColorOverrides, setCategoryColorOverrides] = useState<CategoryColorOverrides>(resolveInitialCategoryColorOverrides);
  const [appThemeColorOverrides, setAppThemeColorOverrides] = useState<AppThemeColorOverrides>(resolveInitialAppThemeColorOverrides);
  const {
    celebrationsEnabled,
    dayReviewEnabled,
    driftAlertDelaySeconds,
    driftAlertsEnabled,
    driftAlarmCopy,
    driftAlarmCopyDefaults,
    extremeNudgeEnabled,
    macosNotificationEnabled,
    quietHours,
    petModeEnabled,
    petModeCoat,
    petModeFastRunEnabled,
    petModeSize,
    setCelebrationsEnabled,
    setDayReviewEnabled,
    setDriftAlertDelaySeconds,
    setDriftAlarmCopyOverrides,
    setDriftAlertsEnabled,
    setExtremeNudgeEnabled,
    setMacosNotificationEnabled,
    setQuietHours,
    setPetModeEnabled,
    setPetModeCoat,
    setPetModeFastRunEnabled,
    setPetModeSize,
    watcherMode,
    watcherPeekEnabled,
    watcherPeriodicMaxMinutes,
    watcherPeriodicMinMinutes,
  } = useCompanionSettingsController({ language: localization.effectiveLanguage });
  /* Quiet hours pause interventions and celebrations. Delivery reads the
     clock at evaluation time through the ref; render-time gates (milestones)
     read the boundary-aware hook so they flip without a poll. */
  const quietHoursActive = useQuietHoursActive(quietHours);
  const quietHoursRef = useRef(quietHours);
  quietHoursRef.current = quietHours;
  const macosNotificationEnabledRef = useRef(macosNotificationEnabled);
  // The switch is locked in Settings while Drift alerts are off, so the saved
  // value must not act on its own if alerts were turned off afterwards.
  macosNotificationEnabledRef.current = macosNotificationEnabled && driftAlertsEnabled;
  const driftNotificationCopyRef = useRef({ copy: driftAlarmCopy, language: companionLanguage });
  driftNotificationCopyRef.current = { copy: driftAlarmCopy, language: companionLanguage };
  /** The last alert whose card failure was carried by a macOS notification. */
  const cardFailureNotifiedAlertKeyRef = useRef<string | null>(null);
  /** The last alert already recorded as suppressed by the current quiet window. */
  const quietHoursSuppressedAlertKeyRef = useRef<string | null>(null);
  const [automaticCloseOverride, setAutomaticCloseOverride] = useState(resolveInitialAutomaticCloseOverride);
  // Persist only the committed choice. Writing inside queued updaters can
  // overwrite a newer explicit choice while leaving React on the newer state.
  useEffect(() => {
    persistAutomaticCloseOverride(automaticCloseOverride);
  }, [automaticCloseOverride]);
  const activeAutomaticCloseOverride = automaticCloseOverride
    && !automaticCloseOverrideIsExpired(automaticCloseOverride)
    ? automaticCloseOverride
    : null;
  const automaticCloseSavedEnabled = extremeNudgeEnabled && driftAlertsEnabled;
  const automaticCloseEnabled = resolveEffectiveAutomaticCloseEnabled(
    automaticCloseSavedEnabled,
    activeAutomaticCloseOverride,
  );
  const driftAlertsRuntimeEnabled = driftAlertsEnabled || automaticCloseEnabled;
  const automaticCloseEnabledRef = useRef(automaticCloseEnabled);
  automaticCloseEnabledRef.current = automaticCloseEnabled;
  const automaticCloseExpiryHandledRef = useRef<string | null>(null);
  const handleAutomaticCloseSettingsChange = useCallback((enabled: boolean) => {
    // A direct Settings choice replaces any temporary quick-control override.
    automaticCloseEnabledRef.current = enabled;
    if (!enabled) pendingExtremeNudgeRef.current = null;
    automaticCloseExpiryHandledRef.current = null;
    setAutomaticCloseOverride(null);
    if (enabled) setDriftAlertsEnabled(true);
    setExtremeNudgeEnabled(enabled);
  }, [setDriftAlertsEnabled, setExtremeNudgeEnabled]);
  const setTemporaryAutomaticClose = useCallback((enabled: boolean, kind: AutomaticCloseOverrideKind) => {
    const next = buildAutomaticCloseOverride(enabled, kind);
    automaticCloseEnabledRef.current = enabled;
    if (!enabled) pendingExtremeNudgeRef.current = null;
    automaticCloseExpiryHandledRef.current = null;
    setAutomaticCloseOverride(next);
  }, []);
  const restoreSavedAutomaticClose = useCallback(() => {
    automaticCloseEnabledRef.current = automaticCloseSavedEnabled;
    automaticCloseExpiryHandledRef.current = null;
    setAutomaticCloseOverride(null);
  }, [automaticCloseSavedEnabled]);
  const extendTemporaryAutomaticClose = useCallback((extension: "60" | "today") => {
    automaticCloseExpiryHandledRef.current = null;
    setAutomaticCloseOverride((current) => {
      if (!current) return current;
      return extendAutomaticCloseOverride(current, extension);
    });
  }, []);
  useEffect(() => {
    if (!automaticCloseOverride || automaticCloseOverride.endsAtMs === null) return undefined;
    const expiryKey = `${automaticCloseOverride.startedAtMs}:${automaticCloseOverride.enabled}:${automaticCloseOverride.kind}`;
    const expireIfDue = () => {
      if (!automaticCloseOverrideIsExpired(automaticCloseOverride)) return;
      if (automaticCloseExpiryHandledRef.current === expiryKey) return;
      automaticCloseExpiryHandledRef.current = expiryKey;
      setAutomaticCloseOverride(null);
      void sendAutomaticCloseOverrideExpiredNotification(
        automaticCloseOverride,
        automaticCloseSavedEnabled,
        localization.effectiveLanguage,
      );
    };
    const remainingMs = Math.max(0, automaticCloseOverride.endsAtMs - Date.now());
    const timer = window.setTimeout(expireIfDue, remainingMs);
    window.addEventListener("focus", expireIfDue);
    document.addEventListener("visibilitychange", expireIfDue);
    expireIfDue();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", expireIfDue);
      document.removeEventListener("visibilitychange", expireIfDue);
    };
  }, [automaticCloseOverride, automaticCloseSavedEnabled, localization.effectiveLanguage]);
  // No Dev gate: the pet ships as a production surface and is controlled from
  // the account menu and Desktop pet settings.
  const [petModeHiddenUntil, setPetModeHiddenUntil] = useState(resolveInitialPetModeHiddenUntil);
  const clearPetModeTemporaryHide = useCallback(() => {
    setPetModeHiddenUntil((hiddenUntil) => (
      hiddenUntil === null ? hiddenUntil : persistPetModeHiddenUntil(null)
    ));
  }, []);
  const {
    petModeRevealRevision,
    requestPetModeEnabled,
    togglePetModeEnabled,
  } = usePetModeVisibilityRequests(
    petModeEnabled,
    setPetModeEnabled,
    clearPetModeTemporaryHide,
  );
  // A temporary hide suppresses the pet without touching its on/off preference,
  // so the one-hour timer below can restore exactly what the user had.
  const petModeActive = petModeEnabled && petModeHiddenUntil === null;
  petOccupancyRef.current = {
    enabled: petModeEnabled,
    hiddenUntil: petModeHiddenUntil,
    menuOpen: petOccupancyRef.current.menuOpen,
  };
  const handledPetModeRevealRevisionRef = useRef(0);
  const pendingPetModeRevealRevisionsRef = useRef(new Set<number>());
  const initialPetModeSyncCompletedRef = useRef(false);
  const petModeRevealRetryAttemptsRef = useRef(new Map<number, number>());
  const latestPetModeRevealRevisionRef = useRef(petModeRevealRevision);
  const petModeSyncMountedRef = useRef(false);
  const [petModeSyncRetryNonce, setPetModeSyncRetryNonce] = useState(0);
  const { records: petModeNativeSyncDiagnostics, begin: beginPetModeSyncDiagnostic, resolve: resolvePetModeSyncDiagnostic,
    reject: rejectPetModeSyncDiagnostic, cancel: cancelPetModeSyncDiagnostic,
    readiness: recordPetModeSyncReadiness } = usePetModeNativeSyncDiagnostics();
  latestPetModeRevealRevisionRef.current = petModeRevealRevision;

  useEffect(() => {
    petModeSyncMountedRef.current = true;
    return () => {
      petModeSyncMountedRef.current = false;
    };
  }, []);

  const handleHidePetForOneHour = useCallback(() => {
    const now = Date.now();
    // Set the guard synchronously: an already-running approach can settle before
    // React publishes the new override to the next alarm evaluation.
    automaticCloseEnabledRef.current = false;
    pendingExtremeNudgeRef.current = null;
    automaticCloseExpiryHandledRef.current = null;
    // Native choices can arrive before the preceding state update commits.
    // Preserve the newest queued pause rather than this render's snapshot.
    setAutomaticCloseOverride((current) => buildPetModeHidePause(current, now));
    setPetModeHiddenUntil(persistPetModeHiddenUntil(now + PET_MODE_HIDE_ONE_HOUR_MS));
  }, []);

  const handlePetVisibilityAction = useCallback((action: PetVisibilityAction) => {
    if (action === "hideOneHour") {
      handleHidePetForOneHour();
      return;
    }
    requestPetModeEnabled(false);
  }, [handleHidePetForOneHour, requestPetModeEnabled]);

  useEffect(() => {
    if (petModeHiddenUntil === null) return undefined;
    const remainingMs = petModeHiddenUntil - Date.now();
    if (remainingMs <= 0) {
      setPetModeHiddenUntil(persistPetModeHiddenUntil(null));
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setPetModeHiddenUntil(persistPetModeHiddenUntil(null));
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [petModeHiddenUntil]);

  const [petModeLabPointerStatus, setPetModeLabPointerStatus] = useState<string | null>(null);
  const [petModeLabInputBounds, setPetModeLabInputBounds] = useState<string | null>(null);
  const [petModeLabDpiEvents, setPetModeLabDpiEvents] = useState<PetModeWindowsDpiEvents | null>(null);
  // Intentionally session-only: a destructive global shortcut must be armed
  // again after every app launch instead of silently surviving into normal use.
  const [petModeBrowserXShortcutEnabled, setPetModeBrowserXShortcutEnabled] = useState(false);
  const [petModeGuidesEnabled, setPetModeGuidesEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(PET_MODE_GUIDES_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const handleTogglePetModeGuides = useCallback(() => {
    setPetModeGuidesEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(PET_MODE_GUIDES_STORAGE_KEY, next ? "1" : "0");
      } catch {}
      void setNativePetModeGuides(next);
      return next;
    });
  }, []);
  const [petModeFloorHomePt, setPetModeFloorHomePt] = useState(resolveInitialPetModeFloorHomePt);
  const handlePetModeFloorHomePtChange = useCallback((value: number) => {
    const next = persistPetModeFloorHomePt(value);
    setPetModeFloorHomePt(next);
  }, []);
  const [driftAlarmSnooze, setDriftAlarmSnooze] = useState<DriftAlarmBreakSnooze | null>(null);
  // Store the semantic check outcome, not rendered copy: the label must follow a
  // live language change instead of freezing the language used at mount.
  const [driftAlarmTrayState, setDriftAlarmTrayState] = useState<DriftAlarmTrayState>(() => ({
    checkedAt: null,
    result: driftAlertsRuntimeEnabled ? { kind: "no_candidate" } : { kind: "disabled" },
  }));
  const driftAlarmTrayStatus = useMemo(() => buildDriftAlarmTrayStatus({
    enabled: driftAlertsRuntimeEnabled,
    checkedAt: driftAlarmTrayState.checkedAt,
    result: driftAlarmTrayState.result,
    locale: localization.effectiveLanguage,
  }), [driftAlarmTrayState, driftAlertsRuntimeEnabled, localization.effectiveLanguage]);
  const [breakRecoveryAssessment, setBreakRecoveryAssessment] = useState<DriftAlarmBreakSnooze | null>(null);
  const [driftAlarmInteractions, setDriftAlarmInteractions] = useState<DriftAlarmInteraction[]>(readDriftAlarmInteractions);
  const [showAiClassificationImpact, setShowAiClassificationImpact] = useState(resolveInitialAiClassificationVisibility);
  const {
    aiConnectionTest,
    customEndpointCredentialState,
    retryCustomEndpointKeyRead,
    aiSetupDialogOpen,
    localAiClassificationOptions,
    localAiConnectionFingerprint,
    localAiConnectionFailureCount,
    localAiConnectionProviderLabel,
    localAiConnectionPersistentFailure,
    localAiMemoryUsageBytes,
    localAiProviderStatus,
    localAiSetup,
    recordLocalAiClassificationError,
    recordLocalAiClassificationSummary,
    setAiSetupDialogOpen,
    setLocalAiSetup,
  } = useAiSetupController();
  const {
    appRuleCategory,
    appRuleDisplayName,
    appRuleProductivity,
    appRuleSearch,
    appRuleSearchPanelOpen,
    appRuleSearchRef,
    appRuleTargetValue,
    classificationRuleApplyResult,
    classificationRuleCandidates,
    classificationRuleCandidatesLoading,
    classificationRuleDeletingId,
    classificationRuleMessage,
    classificationRuleSavingKind,
    classificationRules,
    classificationRulesError,
    classificationRulesLoading,
    domainRuleCandidates,
    domainRuleCandidatesLoading,
    domainRuleCategory,
    domainRuleInput,
    domainRuleMode,
    domainRuleProductivity,
    domainRuleSearchPanelOpen,
    domainRuleSearchRef,
    handleAppRuleSearchBlur,
    handleAppRuleSearchFocus,
    handleDeleteClassificationRule,
    handleDomainRuleSearchBlur,
    handleDomainRuleSearchFocus,
    handleSaveAppRule,
    handleSaveDomainRule,
    handleSelectClassificationCandidate,
    handleSelectDomainRuleCandidate,
    handleToggleClassificationRule,
    loadClassificationRules,
    saveClassificationRule,
    setAppRuleCategory,
    setAppRuleProductivity,
    setDomainRuleCategory,
    setDomainRuleMode,
    setDomainRuleProductivity,
    updateAppRuleSearch,
    updateDomainRuleInput,
  } = useClassificationRulesController({
    managerOpen: activeTab === "settings" && settingsSection === "classification",
    t: localization.t,
    onRefreshSelectedDay: () => refresh(selectedDay),
  });
  const [dashboardAiUnavailablePreviewCase, setDashboardAiUnavailablePreviewCase] = useState<DashboardAiUnavailablePreviewCase>("cloud-plan");
  const [dashboardAiUnavailablePreview, setDashboardAiUnavailablePreview] = useState<DashboardAiUnavailablePreviewState | null>(null);
  const [sidebarCtaPreviewCase, setSidebarCtaPreviewCase] = useState<SidebarCtaPreviewCase | null>(null);
  const [sidebarUpgradeDismissedUntil, setSidebarUpgradeDismissedUntil] = useState(readSidebarUpgradeDismissedUntil);
  const [dismissedDashboardAiRecoveryKey, setDismissedDashboardAiRecoveryKey] = useState<string | null>(null);
  const [watcherEvent, setWatcherEvent] = useState<WatcherPeekEvent | null>(null);
  const [endOfDayReviewEvent, setEndOfDayReviewEvent] = useState<EndOfDayReviewEvent | null>(null);
  /* In Tauri the review card lives in the Companion window, so the main
     window only knows which day it last sent. That day decides where the
     card's "open dashboard" lands: a catch-up review opens yesterday. */
  const presentedEndOfDayReviewDayRef = useRef<string | null>(null);
  const [driftAlarmEvent, setDriftAlarmEvent] = useState<DriftAlarmEvent | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [newProjectRequested, setNewProjectRequested] = useState(false);

  useEffect(() => {
    appIconsRef.current = appIcons;
  }, [appIcons]);

  useEffect(() => {
    siteIconsRef.current = siteIcons;
  }, [siteIcons]);

  useEffect(() => {
    const dashboardPeriod = activeTab === "dashboard" ? toDashboardPeriodAnalytics(dashPeriod) : null;
    const surfaceKey = [activeTab, dashboardPeriod, activeTab === "settings" ? settingsSection : null].join(":");
    if (previousSurfaceAnalyticsKeyRef.current === surfaceKey) return;
    previousSurfaceAnalyticsKeyRef.current = surfaceKey;

    // Which surfaces get opened is the question; how many times someone walks
    // back and forth between two tabs is not. The key carries every property
    // below so each distinct surface still reports once a day.
    capturePostHogDailyEvent("app_surface_opened", surfaceKey, {
      surface: toAppSurfaceAnalytics(activeTab),
      ...(dashboardPeriod ? { dashboard_period: dashboardPeriod } : {}),
      ...(activeTab === "settings" ? { settings_section: settingsSection } : {}),
    });
  }, [activeTab, dashPeriod, settingsSection]);

  useEffect(() => {
    if (!error) return;
    // The same unresolved error re-fired on every tab change. Sentry owns the
    // per-occurrence detail; this event only needs "did this kind of error
    // reach this surface today".
    const surface = toAppSurfaceAnalytics(activeTab);
    const errorKind = toAnalyticsErrorKind(error);
    capturePostHogDailyEvent("app_error", `${surface}:${errorKind}`, {
      surface,
      error_kind: errorKind,
    });
  }, [activeTab, error]);

  const navigateToTab = useCallback((tabId: TabId, nextDashPeriod = dashPeriod) => {
    setNavigationHistory((current) => {
      const currentSnapshot = current.entries[current.index] ?? { tabId: "dashboard", dashPeriod: "Today" };
      if (currentSnapshot.tabId === tabId && currentSnapshot.dashPeriod === nextDashPeriod) return current;

      const entries = current.entries.slice(0, current.index + 1);
      return { entries: [...entries, { tabId, dashPeriod: nextDashPeriod }], index: entries.length };
    });
  }, [dashPeriod]);

  const openProjectTrends = useCallback(() => {
    setTrendsRange("Week");
    setWeeklyChartMode("project");
    navigateToTab("trends");
  }, [navigateToTab]);

  useEffect(() => {
    if (activeTab !== "team" || canOpenTeamsBeta) return;

    setNavigationHistory((current) => {
      const safeEntry: NavigationHistoryState["entries"][number] = { tabId: "dashboard", dashPeriod: "Today" };
      if (current.entries.length === 0) return { entries: [safeEntry], index: 0 };
      const entries = current.entries.slice();
      entries[current.index] = safeEntry;
      return { ...current, entries };
    });
  }, [activeTab, canOpenTeamsBeta]);

  useEffect(() => {
    const handleTeamInvite = (event: Event) => {
      const pendingInvite = readPendingTeamInviteFromEvent(event);
      if (!pendingInvite) return;
      setPendingTeamInvite(pendingInvite);
      if (canOpenTeamsBeta) {
        navigateToTab("team");
      }
    };
    window.addEventListener(TEAM_INVITE_DEEP_LINK_EVENT, handleTeamInvite);
    return () => window.removeEventListener(TEAM_INVITE_DEEP_LINK_EVENT, handleTeamInvite);
  }, [canOpenTeamsBeta, navigateToTab]);

  useEffect(() => {
    if (!pendingTeamInvite || !canOpenTeamsBeta) return;
    navigateToTab("team");
  }, [canOpenTeamsBeta, navigateToTab, pendingTeamInvite]);
  const {
    replayState: dashboardDemoReplayState,
    restartReplay: restartDashboardDemoReplay,
    startReplay: startDashboardDemoReplay,
    stopReplay: stopDashboardDemoReplay,
  } = useDashboardDemoReplayController({
    settings: demoDashboardReplaySettings,
    startOfDayMinutes,
    startOfWeek,
    onNavigateDashboard: (period) => navigateToTab("dashboard", period),
    onSelectDay: selectDay,
  });

  useEffect(() => {
    if (activeTab !== "dashboard") stopDashboardDemoReplay();
  }, [activeTab, stopDashboardDemoReplay]);

  function handleDemoDashboardReplayPreRollSecondsChange(value: number) {
    stopDashboardDemoReplay();
    setDemoDashboardReplaySettings((current) => persistDemoDashboardReplaySettings({ ...current, preRollSeconds: value }));
  }

  function handleDemoDashboardReplayDurationSecondsChange(value: number) {
    stopDashboardDemoReplay();
    setDemoDashboardReplaySettings((current) => persistDemoDashboardReplaySettings({ ...current, durationSeconds: value }));
  }

  function handleResetDemoDashboardReplaySettings() {
    stopDashboardDemoReplay();
    setDemoDashboardReplaySettings(resetDemoDashboardReplaySettings());
  }

  const navigateBack = useCallback(() => {
    setNavigationHistory((current) => (current.index > 0 ? { ...current, index: current.index - 1 } : current));
  }, []);

  const formatPetModeInputBounds = useCallback((bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly visible: boolean;
    readonly windowScaleFactor?: number;
    readonly nativeScaleFactor?: number;
    readonly windowDpiAwareness?: string;
    readonly threadDpiAwareness?: string;
    readonly currentMonitorScaleFactor?: number;
    readonly expectedRenderWidth?: number;
    readonly expectedRenderHeight?: number;
    readonly sampledAtMs?: number;
  }) => (
    `Native input bounds · ${bounds.x}, ${bounds.y} · ${bounds.width}×${bounds.height} · ${bounds.visible ? "visible" : "hidden"}`
    + (bounds.expectedRenderWidth !== undefined && bounds.expectedRenderHeight !== undefined
      ? ` · expected ${bounds.expectedRenderWidth}×${bounds.expectedRenderHeight}`
      : "")
    + (bounds.windowScaleFactor !== undefined && bounds.nativeScaleFactor !== undefined
      ? ` · window scale ${Math.round(bounds.windowScaleFactor * 100)}% · native scale ${Math.round(bounds.nativeScaleFactor * 100)}%`
      : "")
    + (bounds.windowDpiAwareness !== undefined
      ? ` · window awareness ${bounds.windowDpiAwareness}`
      : "")
    + (bounds.threadDpiAwareness !== undefined
      ? ` · thread awareness ${bounds.threadDpiAwareness}`
      : "")
    + (bounds.windowDpiAwareness !== undefined
      ? ` · monitor diagnostic ${bounds.currentMonitorScaleFactor !== undefined ? `${Math.round(bounds.currentMonitorScaleFactor * 100)}%` : "unavailable"}`
      : "")
    + (bounds.sampledAtMs !== undefined
      ? ` · sampled ${new Date(bounds.sampledAtMs).toLocaleTimeString([], { hour12: false })}`
      : "")
  ), []);

  useEffect(() => {
    if (!petModeActive) {
      setPetModeLabInputBounds(null);
      setPetModeLabDpiEvents(null);
      return;
    }
    if (activeTab !== "settings" || settingsSection !== "dev" || devSettingsSubsection !== "lab") {
      setPetModeLabInputBounds(null);
      setPetModeLabDpiEvents(null);
      return;
    }
    setPetModeLabInputBounds(null);
    setPetModeLabDpiEvents(null);
    let disposed = false;
    const refresh = () => {
      void getNativePetInputBounds().then((bounds) => {
        if (!disposed) {
          setPetModeLabInputBounds(bounds
            ? formatPetModeInputBounds(bounds)
            : "Native input bounds unavailable");
          setPetModeLabDpiEvents(bounds?.windowsDpiEvents ?? null);
        }
      });
    };
    // The native enable effect runs later in this component. Delay one paint,
    // then keep the Dev-only coordinate read live while testing movement.
    const timerId = window.setTimeout(refresh, 120);
    const intervalId = window.setInterval(refresh, 500);
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      window.clearInterval(intervalId);
    };
  }, [activeTab, devSettingsSubsection, formatPetModeInputBounds, petModeActive, settingsSection]);

  const navigateForward = useCallback(() => {
    setNavigationHistory((current) => (
      current.index < current.entries.length - 1 ? { ...current, index: current.index + 1 } : current
    ));
  }, []);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const openSettingsTab = useCallback(() => {
    setSettingsSection("general");
    navigateToTab("settings");
    setAccountMenuOpen(false);
  }, [navigateToTab]);
  const openCompanionNotificationSettings = useCallback(() => {
    setSettingsSection("notifications");
    navigateToTab("settings");
    setAccountMenuOpen(false);
  }, [navigateToTab]);
  const openPetSettings = useCallback(() => {
    setSettingsSection("pet");
    navigateToTab("settings");
    setAccountMenuOpen(false);
  }, [navigateToTab]);
  const openAiSetupSettings = useCallback(() => {
    setSettingsSection("aiSetup");
    navigateToTab("settings");
    setAccountMenuOpen(false);
  }, [navigateToTab]);
  const openAccountSettings = useCallback(() => {
    setSettingsSection("account");
    navigateToTab("settings");
    setAccountMenuOpen(false);
  }, [navigateToTab]);
  const openSyncSettings = useCallback(() => {
    setSettingsSection("sync");
    navigateToTab("settings");
    setAccountMenuOpen(false);
  }, [navigateToTab]);
  const handleSettingsBack = useCallback(() => {
    setAccountMenuOpen(false);
    if (canNavigateBack) {
      navigateBack();
      return;
    }

    navigateToTab("dashboard", "Today");
  }, [canNavigateBack, navigateBack, navigateToTab]);

  const handleManualCheckForUpdates = useCallback(() => {
    setAccountMenuOpen(false);
    setManualUpdateNoticeVisible(true);
    void handleCheckForUpdates().then((result) => {
      if (!result) return;
      if (result.kind === "available") return;
      void invoke("update_status_show_native", {
        title: localization.t(result.kind === "error" ? "updates.checkFailed" : "settings.general.upToDate"),
        body: result.kind === "error"
          ? localizeUpdateMessage(result.message, "error", localization.effectiveLanguage, localization.t)
          : localization.t("updates.noSignedUpdate"),
        language: localization.effectiveLanguage,
      }).catch((error: unknown) => {
        console.warn("Failed to show update status window.", error);
      });
    });
  }, [handleCheckForUpdates, localization]);

  const handleAppMenuCheckLatestBuild = useCallback(() => {
    setLatestBuildNoticeVisible(true);
    if (DEV_SETTINGS_ENABLED && devModeEnabled) {
      handleDevSettingsSubsectionChange("diagnostics");
      setSettingsSection("dev");
      navigateToTab("settings");
      setAccountMenuOpen(false);
    }
    void developerPreReleaseUpdateController.checkLatestBuild();
  }, [developerPreReleaseUpdateController.checkLatestBuild, devModeEnabled, handleDevSettingsSubsectionChange, navigateToTab]);

  const handleDevModeEnabledChange = useCallback((enabled: boolean) => {
    setDevModeEnabled(enabled);
  }, []);

  const handleAppMenuToggleDevMode = useCallback(() => {
    handleDevModeEnabledChange(!devModeEnabled);
  }, [devModeEnabled, handleDevModeEnabledChange]);

  const openEndOfDayReviewSettings = useCallback(() => {
    openCompanionNotificationSettings();
  }, [openCompanionNotificationSettings]);

  const openEndOfDayReviewDashboard = useCallback(() => {
    const reviewDay = presentedEndOfDayReviewDayRef.current;
    setEndOfDayReviewEvent(null);
    selectDay(reviewDay ?? logicalTodayIsoDate(startOfDayMinutes));
    navigateToTab("dashboard", "Today");
  }, [navigateToTab, startOfDayMinutes]);

  const handleEndOfDayReviewAction = useCallback((action: EndOfDayReviewAction) => {
    setEndOfDayReviewEvent(null);

    if (action === "openSettings") {
      openCompanionNotificationSettings();
      return;
    }

    if (action === "openAiSettings") {
      openAiSetupSettings();
      return;
    }

    if (action === "openNotificationSettings") {
      openEndOfDayReviewSettings();
      return;
    }

    if (action === "openLeaderboard") {
      navigateToTab("leaderboard");
      return;
    }

    if (action === "openTrends") {
      navigateToTab("trends");
      return;
    }

    openEndOfDayReviewDashboard();
  }, [navigateToTab, openAiSetupSettings, openCompanionNotificationSettings, openEndOfDayReviewDashboard, openEndOfDayReviewSettings]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalShowsGoogle, setAuthModalShowsGoogle] = useState(true);
  const [authModalIntent, setAuthModalIntent] = useState<"default" | "promo">("default");
  const [promoHandoffPending, setPromoHandoffPending] = useState(hasPendingPromoHandoff);
  const [promoHandoffMismatch, setPromoHandoffMismatch] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [upgradePlanModalOpen, setUpgradePlanModalOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  /** The trial-end sheet opens by itself at most once per launch. */
  const [automaticSheetShownThisLaunch, setAutomaticSheetShownThisLaunch] = useState(false);
  /** The Pro sheet opened on its own after a trial ended (reported as trial_end_sheet). */
  const [trialEndSheetAuto, setTrialEndSheetAuto] = useState(false);
  const [resumeUpgradePlanAfterAuth, setResumeUpgradePlanAfterAuth] = useState(false);
  const [accountDeletionModalOpen, setAccountDeletionModalOpen] = useState(false);
  const [debugLogPreview, setDebugLogPreview] = useState<{ readonly text: string; readonly exportedAt: string } | null>(null);
  const [resumeOnboardingAfterAuthModal, setResumeOnboardingAfterAuthModal] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  canSafelyRestartRef.current = () => (
    !onboardingOpen
    && !authModalOpen
    && !upgradePlanModalOpen
    && driftAlarmEvent === null
    && driftAlarmSnooze === null
  );
  // One-shot: armed only by completing onboarding in this session — never re-read
  // from storage, so the bootstrap import cannot re-fire on later launches.
  const [browserHistoryBootstrapEnabled, setBrowserHistoryBootstrapEnabled] = useState(false);
  const firstDayHistoryImportFailedRef = useRef(false);
  const [preparingFirstDay, setPreparingFirstDay] = useState(false);
  const [firstDayPreparationPhase, setFirstDayPreparationPhase] = useState<FirstDayPreparationPhase>("importing");
  const [firstDayPreparationProgress, setFirstDayPreparationProgress] = useState<number | null>(null);
  const [firstDayReadingSegmentIds, setFirstDayReadingSegmentIds] = useState<readonly string[]>([]);
  // The day the first-day gate is preparing. The screen narrates only once that day's activity is loaded,
  // so it never describes whatever day happened to be on screen before the gate selected it.
  const [firstDayPreparedDay, setFirstDayPreparedDay] = useState<string | null>(null);
  // Phases this run expects, so the gate can spend one bar across all of them
  // instead of restarting it at every handoff.
  const [firstDayPreparationPlan, setFirstDayPreparationPlan] = useState<FirstDayPreparationPlan>(["classifying"]);
  const firstDayRevealTimerRef = useRef<number | null>(null);
  // First work activity from the just-finished onboarding, echoed in the gate's loading copy.
  const [firstDayWorkLabel, setFirstDayWorkLabel] = useState<string | null>(null);
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [classificationMetrics, setClassificationMetrics] = useState<ClassificationMetrics | null>(null);
  const [aiClassificationUsage, setAiClassificationUsage] = useState<AiClassificationUsageSummary | null>(null);
  const [aiClassificationUsageDay, setAiClassificationUsageDay] = useState<string | null>(null);
  const [classificationActionLoading, setClassificationActionLoading] = useState(false);
  const [classificationSummary, setClassificationSummary] = useState<AiClassificationSummary | null>(null);
  const [, setCloudAiBackoffTick] = useState(0);
  const [cloudAiConnectionCheck, setCloudAiConnectionCheck] = useState<CloudAiConnectionCheck | null>(null);
  const cloudAiConnectionGenerationRef = useRef(0);
  const cloudRecoveryTestNextAtRef = useRef(0);
  const cloudRecoveryProbeNextAtRef = useRef(0);
  const cloudRecoveryProbeFailuresRef = useRef(0);
  const recordCloudAiClassificationSummary = useCallback((summary: AiClassificationSummary, generation: number) => {
    if (generation !== cloudAiConnectionGenerationRef.current) return;
    if (summary.status === "error" && summary.failureKind === "quota") return;
    if (summary.status === "error" && summary.failureKind !== "content") {
      setCloudAiConnectionCheck((current) => nextCloudAiConnectionCheck(current, {
        kind: "classification_transport_failure",
        message: summary.message,
      }, Date.now()));
      return;
    }
    if (summary.usedAiProvider !== true) return;
    setCloudAiConnectionCheck((current) => nextCloudAiConnectionCheck(current, {
      kind: "provider_contact_ok",
      message: summary.message,
    }, Date.now()));
  }, []);
  const recordCloudAiClassificationError = useCallback(async (error: unknown, generation: number) => {
    const failure = await describeAiClassificationFailure(error);
    if (generation !== cloudAiConnectionGenerationRef.current || failure.failureKind === "quota") return failure;
    setCloudAiConnectionCheck((current) => nextCloudAiConnectionCheck(current, {
      kind: "classification_transport_failure",
      message: failure.message,
    }, Date.now()));
    return failure;
  }, []);
  const [rendererFocused, setRendererFocused] = useState(isRendererFocused);
  const [timelineHover, setTimelineHover] = useState<TimelineHoverState | null>(null);
  const [compactHistoryCacheRevision, setCompactHistoryCacheRevision] = useState(0);
  const [weekDashboardCacheRevision, setWeekDashboardCacheRevision] = useState(0);
  const openDefaultAuthModal = useCallback(() => {
    setAuthModalIntent("default");
    setAuthModalShowsGoogle(true);
    setAuthModalOpen(true);
  }, []);
  const openPromoAuthModal = useCallback(() => {
    setAuthModalIntent("promo");
    setAuthModalShowsGoogle(true);
    setAuthModalOpen(true);
  }, []);
  // Keep the compact onboarding window chrome through the first-day preparation gate,
  // so the loading screen runs in the small onboarding window rather than the full app
  // window. Only apply when the desired state actually flips to avoid a resize flicker
  // across the onboarding -> gate handoff.
  const onboardingChromeAppliedRef = useRef(false);
  useEffect(() => {
    const wantsOnboardingChrome = onboardingOpen || preparingFirstDay;
    if (wantsOnboardingChrome === onboardingChromeAppliedRef.current) return;
    onboardingChromeAppliedRef.current = wantsOnboardingChrome;
    void setOnboardingWindowPresentation(wantsOnboardingChrome, true);
  }, [onboardingOpen, preparingFirstDay]);
  const {
    user,
    status: authStatus,
    cloudConnectionStatus: reportedCloudConnectionStatus,
    callbackStatus,
    passwordRecoveryState,
    signInWithGoogle,
    signInWithWebsite,
    signInAnonymously,
    signOut,
    isEnabled: isSupabaseConfigured,
    isAuthRequired,
    allowsAnonymousAuth,
    hasRequiredAccountAuth,
    hasBlockingAuthConfigurationError,
  } = useAuth();
  useEffect(() => {
    // Recovery links can reopen a closed app while onboarding owns the shell.
    // Keep the required-account gate until the verified user sets a password.
    if (passwordRecoveryState?.phase !== "awaiting-new-password") return;
    setAuthModalIntent("default");
    setAuthModalOpen(true);
  }, [passwordRecoveryState?.phase]);
  const postOnboardingSidebarGuideReviewEnabled = isPostOnboardingSidebarGuideReviewEnabled(
    window.location.search,
    import.meta.env.DEV,
  );
  /* The intro opens on the user's own first day when the preparation left enough classified time.
     The recap is read once, when the intro is first shown, so its facts do not shift while it is open. */
  const [introStory, setIntroStory] = useState<{ readonly resolved: boolean; readonly recap: FirstDayRecap | null }>({ resolved: false, recap: null });
  const introSequence = introStory.recap ? POST_ONBOARDING_STORY_GUIDE_STEPS : POST_ONBOARDING_SIDEBAR_GUIDE_STEPS;
  const firstDayReviewEnabled = isFirstDayReviewEnabled(window.location.search, import.meta.env.DEV);
  const introHostPlatform = useIntroReviewOverrides(postOnboardingSidebarGuideReviewEnabled, hostPlatform);
  const {
    isActive: postOnboardingSidebarGuideActive,
    step: postOnboardingSidebarGuideStep,
    begin: beginPostOnboardingSidebarGuide,
    restart: restartPostOnboardingSidebarGuide,
    advance: advancePostOnboardingSidebarGuide,
    retreat: retreatPostOnboardingSidebarGuide,
    dismiss: dismissPostOnboardingSidebarGuide,
  } = usePostOnboardingSidebarGuide(
    postOnboardingSidebarGuideReviewEnabled ? "review" : user?.id ?? "local",
    introSequence,
  );
  const toggleAccountMenu = useCallback(() => {
    setAccountMenuOpen((open) => !open);
  }, []);
  const replayPostOnboardingSidebarGuide = useCallback(() => {
    selectDay(logicalTodayIsoDate(startOfDayMinutes));
    navigateToTab("dashboard", "Today");
    restartPostOnboardingSidebarGuide();
  }, [navigateToTab, restartPostOnboardingSidebarGuide, startOfDayMinutes]);
  const postOnboardingSidebarGuideReviewStartedRef = useRef(false);
  useEffect(() => {
    if (!postOnboardingSidebarGuideReviewEnabled || postOnboardingSidebarGuideReviewStartedRef.current) return;
    postOnboardingSidebarGuideReviewStartedRef.current = true;
    replayPostOnboardingSidebarGuide();
  }, [postOnboardingSidebarGuideReviewEnabled, replayPostOnboardingSidebarGuide]);
  const deviceSyncAccountId = authStatus === "authenticated" && hasRequiredAccountAuth && user?.id
    ? user.id
    : null;
  const deviceSyncAccountIdRef = useRef(deviceSyncAccountId);
  deviceSyncAccountIdRef.current = deviceSyncAccountId;
  const onboardingCompletedAt = readUserOnboardingState(user?.id ?? "local", ["local"])?.completedAt ?? null;
  const featureNewBadges = useFeatureNewBadges(onboardingCompletedAt, petModeEnabled);
  const openWhatsNew = useCallback(() => setWhatsNewOpen(true), []);
  const authMetadataAvatarUrl = getAuthMetadataAvatarUrl(user);
  const isEffectiveAuthRequired = isAuthRequired;
  const allowsEffectiveAnonymousAuth = allowsAnonymousAuth && !isEffectiveAuthRequired;
  const hasEffectiveBlockingAuthConfigurationError = hasBlockingAuthConfigurationError;
  const cloudConnectionStatus: AuthConnectionStatus = reportedCloudConnectionStatus
    ?? (isSupabaseConfigured ? (authStatus === "loading" ? "checking" : "online") : "disabled");
  const isCloudOnline = cloudConnectionStatus === "online";
  const shouldCheckBillingEntitlement = isCloudOnline && isSupabaseConfigured && authStatus === "authenticated" && hasRequiredAccountAuth;
  // The account menu shortcut and the Settings card share one friend-invite
  // read; the shortcut appears only while invites are open for this account.
  const friendInviteLoader = isSupabaseConfigured && authStatus === "authenticated" && hasRequiredAccountAuth && Boolean(user)
    ? fetchFriendInvite
    : null;
  const friendInvite = useFriendInvite(friendInviteLoader ? friendInviteAccountKey(user?.email, user?.id) : null, friendInviteLoader);
  const settingsSearchNavigateRef = useRef<((entry: SettingsSearchEntry) => void) | null>(null);
  const shouldBlockLocalTrackerAccess = isEffectiveAuthRequired && (hasEffectiveBlockingAuthConfigurationError || !hasRequiredAccountAuth);
  const isPolicySignedIn = Boolean(user) && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
  const shareAccountScope = isPolicySignedIn ? user?.id ?? null : null;
  useEffect(() => { setShareCardRankAccountScope(shareAccountScope); }, [shareAccountScope]);
  const requestCloudBillingAuth = openDefaultAuthModal;
  const {
    billingActionError,
    billingActionErrorCode,
    billingCheckoutAwaitingConfirmation,
    billingCheckoutLoadingInterval,
    billingEntitlement,
    billingEntitlementError,
    billingEntitlementLoading,
    billingPortalLoading,
    individualPricingQuote,
    individualPricingQuoteLoading,
    couponRedemption,
    couponRedemptionErrorCode,
    couponRedemptionLoading,
    cloudDeviceActionError,
    cloudDeviceRevokingId,
    cloudDevices,
    cloudTrialStartedNotice,
    dismissCloudTrialStartedNotice,
    proPurchaseConfirmed,
    acknowledgeProPurchase,
    handleManageCloudBilling,
    handleRedeemTrialCoupon,
    handleRevokeCloudDevice,
    refreshBillingEntitlement,
    startCloudCheckout,
    activateCloudTrial,
    cloudTrialStarting,
    cloudTrialError,
  } = useCloudBillingController({
    hasRequiredAccountAuth,
    isSupabaseConfigured,
    shouldCheckBillingEntitlement,
    user,
    onAuthRequired: requestCloudBillingAuth,
  });
  // A Pro purchase made from the app moves classification to Cloud AI once. Only the
  // route changes, so the Local AI (or own-provider) setup stays in AI settings as the way back.
  const [proStartedNoticeVisible, setProStartedNoticeVisible] = useState(false);
  const classificationOnCloudRoute = localAiSetup.provider === "managed_local" && localAiSetup.driftyRoute === "cloud";
  useEffect(() => {
    if (!proPurchaseConfirmed) return;
    acknowledgeProPurchase();
    if (!classificationOnCloudRoute) {
      setLocalAiSetup((current) => ({ ...current, provider: "managed_local", driftyRoute: "cloud" }));
    }
    setProStartedNoticeVisible(true);
  }, [acknowledgeProPurchase, classificationOnCloudRoute, proPurchaseConfirmed, setLocalAiSetup]);
  // Pro looks: cat Dock icons and four pet coats need a trial, Pro or a seat.
  // Locks follow the real account (not Dev previews), so a preview can never
  // put someone's look away.
  const [upgradeSheetLook, setUpgradeSheetLook] = useState<ProLook | null>(null);
  const proLooksAccess = useMemo(() => resolveProLooksAccess({
    accountsConfigured: isSupabaseConfigured,
    authStatus,
    signedIn: Boolean(user) && hasRequiredAccountAuth,
    entitlement: billingEntitlement,
    entitlementLoading: billingEntitlementLoading,
    entitlementError: billingEntitlementError,
  }), [authStatus, billingEntitlement, billingEntitlementError, billingEntitlementLoading, hasRequiredAccountAuth, isSupabaseConfigured, user]);
  const proLooks = useProLooksController({
    access: proLooksAccess,
    appIconsSupported: hostPlatform === "macos",
    coat: petModeCoat,
    setCoat: setPetModeCoat,
    flowOpen: authModalOpen || upgradePlanModalOpen || cloudTrialStarting
      || billingCheckoutAwaitingConfirmation || billingCheckoutLoadingInterval !== null,
    requestSignIn: requestCloudBillingAuth,
    startTrial: activateCloudTrial,
    openProSheet: (look) => {
      setUpgradeSheetLook(look);
      setUpgradePlanModalOpen(true);
    },
    openAccountSettings: () => {
      setSettingsSection("account");
      navigateToTab("settings");
    },
  });
  useEffect(() => {
    if (!upgradePlanModalOpen) setUpgradeSheetLook(null);
  }, [upgradePlanModalOpen]);
  useEffect(() => {
    function handlePromoBillingSuccess(event: Event) {
      const source = event instanceof CustomEvent
        ? (event.detail as { readonly source?: BillingSuccessSource } | null)?.source
        : null;
      if (source !== "promo") return;
      storePendingPromoHandoff();
      setPromoHandoffPending(true);
      setPromoHandoffMismatch(false);
      if (!hasRequiredAccountAuth) openPromoAuthModal();
    }

    window.addEventListener("drifty:billing-success", handlePromoBillingSuccess);
    return () => window.removeEventListener("drifty:billing-success", handlePromoBillingSuccess);
  }, [hasRequiredAccountAuth, openPromoAuthModal]);

  useEffect(() => {
    if (!promoHandoffPending || authStatus === "loading") return;
    if (!hasRequiredAccountAuth) {
      setPromoHandoffMismatch(false);
      openPromoAuthModal();
      return;
    }
    if (!shouldCheckBillingEntitlement || billingEntitlementLoading || billingEntitlementError || !billingEntitlement) return;
    if (billingEntitlement.accessSource === "promotion") {
      clearPendingPromoHandoff();
      setPromoHandoffPending(false);
      setPromoHandoffMismatch(false);
      return;
    }
    if (billingEntitlement.accessSource) setPromoHandoffMismatch(true);
  }, [
    authStatus,
    billingEntitlement,
    billingEntitlementError,
    billingEntitlementLoading,
    hasRequiredAccountAuth,
    openPromoAuthModal,
    promoHandoffPending,
    shouldCheckBillingEntitlement,
  ]);

  useEffect(() => {
    if (!promoHandoffPending || !billingEntitlementError || !shouldCheckBillingEntitlement) return;

    function retryPendingPromoHandoff() {
      void refreshBillingEntitlement();
    }

    window.addEventListener("online", retryPendingPromoHandoff);
    return () => window.removeEventListener("online", retryPendingPromoHandoff);
  }, [
    billingEntitlementError,
    promoHandoffPending,
    refreshBillingEntitlement,
    shouldCheckBillingEntitlement,
  ]);

  const keepCurrentPromoHandoffAccount = useCallback(() => {
    clearPendingPromoHandoff();
    setPromoHandoffPending(false);
    setPromoHandoffMismatch(false);
  }, []);

  const switchPromoHandoffAccount = useCallback(async () => {
    await signOut();
    setPromoHandoffMismatch(false);
    openPromoAuthModal();
  }, [openPromoAuthModal, signOut]);
  const canUseCloudAiClassification = isCloudOnline && isSupabaseConfigured && isPolicySignedIn && billingEntitlement?.canUseApp === true;
  const classificationAvailabilityGateEnabled = AI_AVAILABILITY_CLASSIFICATION_GATE_ENABLED
    && !(isDevModeActive && aiAvailabilityGateDevDisabled);
  const selectedClassificationRoute = localAiSetup.provider === "managed_local" && localAiSetup.driftyRoute === "cloud"
    ? "cloud" as const
    : "local" as const;
  const selectedLocalAiClassificationOptions = selectedClassificationRoute === "local"
    ? localAiClassificationOptions
    : null;
  const canUseSelectedCloudAiClassification = selectedClassificationRoute === "cloud"
    && canUseCloudAiClassification;
  const hasSelectedAiClassificationProvider = Boolean(
    selectedLocalAiClassificationOptions || canUseSelectedCloudAiClassification,
  );
  const memorySuggestionProvider = useMemo<MemorySuggestionProvider | null>(() => (
    selectedLocalAiClassificationOptions
      ? { kind: "local", provider: selectedLocalAiClassificationOptions.localProvider }
      : canUseSelectedCloudAiClassification ? { kind: "cloud" } : null
  ), [selectedLocalAiClassificationOptions, canUseSelectedCloudAiClassification]);
  useMemorySuggestionScheduler({
    ownerId: user?.id ?? "local",
    provider: memorySuggestionProvider,
    language: localization.effectiveLanguage === "ko" ? "ko" : "en",
    enabled: !onboardingOpen && !preparingFirstDay,
  });
  const cloudRateLimitBackoff = selectedClassificationRoute === "cloud" && user?.id
    ? cloudAiRequestBackoffs.current(user.id)
    : null;
  const isCloudQuotaExceeded = cloudRateLimitBackoff?.status === 429;
  useEffect(() => {
    if (selectedClassificationRoute !== "cloud" || !user?.id) return undefined;
    const retryAtMs = cloudAiRequestBackoffs.nextExpiryMs();
    if (retryAtMs === null) return undefined;
    const delayMs = Math.max(0, retryAtMs - Date.now()) + 10;
    const timer = window.setTimeout(() => {
      setCloudAiBackoffTick((value) => value + 1);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [selectedClassificationRoute, user?.id, cloudRateLimitBackoff?.retryAtMs]);
  const classificationAvailabilityInput = {
    localProviderStatus: localAiProviderStatus,
    localConsecutiveFailures: localAiConnectionFailureCount,
    localDisconnectConfirmed: localAiConnectionPersistentFailure,
    cloudOnline: isCloudOnline,
    cloudConfigured: isSupabaseConfigured,
    cloudAuthenticated: isPolicySignedIn,
    billingEntitlement,
    billingEntitlementLoading,
    billingEntitlementError,
    cloudConnectionCheck: cloudAiConnectionCheck,
    cloudQuotaExceeded: isCloudQuotaExceeded,
    cloudQuotaDaily: Boolean(cloudRateLimitBackoff && isDailyCloudQuotaBackoff(cloudRateLimitBackoff)),
    cloudQuotaWindow: cloudRateLimitBackoff?.quotaWindow,
    cloudQuotaRetryAtMs: cloudRateLimitBackoff?.retryAtMs,
  };
  const cloudClassificationAvailability = resolveClassificationAvailability({
    ...classificationAvailabilityInput,
    route: "cloud",
  });
  const classificationAvailability = selectedClassificationRoute === "cloud"
    ? cloudClassificationAvailability
    : resolveClassificationAvailability({ ...classificationAvailabilityInput, route: "local" });
  const classificationAvailabilityRef = useRef(classificationAvailability);
  classificationAvailabilityRef.current = classificationAvailability;
  const dashboardAiRecoveryResolved = Boolean(selectedLocalAiClassificationOptions)
    || billingEntitlement?.status === "trialing"
    || billingEntitlement?.status === "active";

  useEffect(() => {
    if (!dashboardAiRecoveryResolved) return;
    for (const recoveryKey of DASHBOARD_CLOUD_BILLING_VARIANTS) {
      clearDashboardAiRecoveryDismissal(recoveryKey);
    }
    setDismissedDashboardAiRecoveryKey(null);
  }, [dashboardAiRecoveryResolved]);
  const previousClassificationAvailabilityStateRef = useRef(classificationAvailability.state);
  const currentClassificationAvailabilityStateRef = useRef(classificationAvailability.state);
  currentClassificationAvailabilityStateRef.current = classificationAvailability.state;
  const builtInHeuristicsUnavailableSinceRef = useRef<string | null>(resolveInitialBuiltInHeuristicsUnavailableSince());
  const [classificationRecoveryPending, setClassificationRecoveryPending] = useState(
    () => classificationAvailabilityGateEnabled && builtInHeuristicsUnavailableSinceRef.current !== null,
  );
  const classificationRecoveryTransitionPending = shouldRunClassificationRecoveryBatch(
    previousClassificationAvailabilityStateRef.current,
    classificationAvailability.state,
  );
  const classificationAssessmentReady = !classificationAvailabilityGateEnabled || (
    classificationAvailability.state === "ready"
    && builtInHeuristicsUnavailableSinceRef.current === null
    && !classificationRecoveryPending
    && !classificationRecoveryTransitionPending
  );
  const isClassificationCatchingUp = classificationAvailabilityGateEnabled && (
    classificationAvailability.state === "ready"
    && (builtInHeuristicsUnavailableSinceRef.current !== null || classificationRecoveryPending || classificationRecoveryTransitionPending)
  );
  const classificationAssessmentReadyRef = useRef(classificationAssessmentReady);
  classificationAssessmentReadyRef.current = classificationAssessmentReady;
  builtInHeuristicsUnavailableSinceRef.current = resolveBuiltInHeuristicsUnavailableSince({
    gateEnabled: classificationAvailabilityGateEnabled,
    state: classificationAvailability.state,
    recoveryPending: classificationRecoveryPending || classificationRecoveryTransitionPending,
    currentValue: builtInHeuristicsUnavailableSinceRef.current,
    now: new Date().toISOString(),
  });
  const builtInHeuristicsUnavailableSince = builtInHeuristicsUnavailableSinceRef.current;
  useEffect(() => {
    persistBuiltInHeuristicsUnavailableSince(builtInHeuristicsUnavailableSince);
  }, [builtInHeuristicsUnavailableSince]);
  const allowBuiltInHeuristics = !classificationAvailabilityGateEnabled || classificationAvailability.allowBuiltInHeuristics;
  const allowAutomaticClassificationAttempt = hasSelectedAiClassificationProvider && (
    !classificationAvailabilityGateEnabled
      || classificationAvailability.allowAutomaticClassification
      || classificationAvailability.allowRecoveryProbe
  );
  const selectedDayClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      fallbackCandidates: segments,
      includeAiClassifications: showAiClassificationImpact,
      includeBuiltInHeuristics: allowBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
      rules: classificationRules,
    }),
    [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, classificationRules, segments, showAiClassificationImpact],
  );
  useEffect(() => {
    if (!postOnboardingSidebarGuideActive) {
      if (introStory.resolved) setIntroStory({ resolved: false, recap: null });
      return;
    }
    if (introStory.resolved || preparingFirstDay) return;
    const today = logicalTodayIsoDate(startOfDayMinutes);
    if (postOnboardingSidebarGuideReviewEnabled) {
      const review = buildIntroReviewCase(introReviewDataMode(window.location.search), (offset) => shiftIsoDate(today, offset));
      setIntroStory({ resolved: true, recap: buildFirstDayRecap({ segments: review.segments, day: review.day, today, startOfDayMinutes }) });
      return;
    }
    if (segmentsLoadedDay !== selectedDay) {
      // The day could not be read: open on the sample cards rather than holding the intro back.
      if (error) setIntroStory({ resolved: true, recap: null });
      return;
    }
    setIntroStory({
      resolved: true,
      recap: buildFirstDayRecap({ segments, day: selectedDay, today, options: selectedDayClassificationOptions, startOfDayMinutes }),
    });
  }, [error, introStory.resolved, postOnboardingSidebarGuideActive, postOnboardingSidebarGuideReviewEnabled, preparingFirstDay, segments, segmentsLoadedDay, selectedDay, selectedDayClassificationOptions, startOfDayMinutes]);
  // A day that is still loading after a few seconds does not hold the intro back either.
  const introStoryPending = postOnboardingSidebarGuideActive && !introStory.resolved && !preparingFirstDay;
  useEffect(() => {
    if (!introStoryPending) return undefined;
    const timer = window.setTimeout(() => {
      setIntroStory((current) => (current.resolved ? current : { resolved: true, recap: null }));
    }, INTRO_STORY_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [introStoryPending]);
  /* The intro reports each card it shows and, when it ends, the focus-support choices it settled
     (the same three booleans onboarding_completed carried while setup still asked about them). */
  const introSequenceName = introStory.recap ? "story" as const : "sample" as const;
  const introLastViewedRef = useRef<string | null>(null);
  const introChoicesRef = useRef({ drift_alarm_enabled: false, extreme_nudge_enabled: false, pet_enabled: false });
  introChoicesRef.current = { drift_alarm_enabled: driftAlertsEnabled, extreme_nudge_enabled: automaticCloseSavedEnabled, pet_enabled: petModeEnabled };
  const reportIntroEnd = useCallback((action: "completed" | "dismissed") => {
    if (!postOnboardingSidebarGuideStep || postOnboardingSidebarGuideReviewEnabled) return;
    capturePostHogEvent("onboarding_intro", { action, step: postOnboardingSidebarGuideStep, sequence: introSequenceName, ...introChoicesRef.current });
  }, [introSequenceName, postOnboardingSidebarGuideReviewEnabled, postOnboardingSidebarGuideStep]);
  useEffect(() => {
    const viewing = postOnboardingSidebarGuideActive && introStory.resolved && !preparingFirstDay && !onboardingOpen ? postOnboardingSidebarGuideStep : null;
    if (!viewing || postOnboardingSidebarGuideReviewEnabled) {
      if (!postOnboardingSidebarGuideActive) introLastViewedRef.current = null;
      return;
    }
    if (introLastViewedRef.current === viewing) return;
    introLastViewedRef.current = viewing;
    capturePostHogEvent("onboarding_intro", { action: "step_viewed", step: viewing, sequence: introSequenceName });
  }, [introSequenceName, introStory.resolved, onboardingOpen, postOnboardingSidebarGuideActive, postOnboardingSidebarGuideReviewEnabled, postOnboardingSidebarGuideStep, preparingFirstDay]);
  const advanceIntro = useCallback(() => {
    if (postOnboardingSidebarGuideStep === introSequence[introSequence.length - 1]) reportIntroEnd("completed");
    advancePostOnboardingSidebarGuide();
  }, [advancePostOnboardingSidebarGuide, introSequence, postOnboardingSidebarGuideStep, reportIntroEnd]);
  const dismissIntro = useCallback(() => {
    reportIntroEnd("dismissed");
    dismissPostOnboardingSidebarGuide();
  }, [dismissPostOnboardingSidebarGuide, reportIntroEnd]);
  /* The intro's drift decision writes the same settings as Companion & Alerts. Turning Automatic close
     on also turns on its Drift alert delivery path, as Settings does; turning it back off in the intro
     restores Drift alerts to what they were when the intro opened, so the intro never leaves alerts on
     that the user did not choose (first-run never offers alerts on their own). */
  const introDriftAlertsBaselineRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!postOnboardingSidebarGuideActive) introDriftAlertsBaselineRef.current = null;
    else if (introDriftAlertsBaselineRef.current === null) introDriftAlertsBaselineRef.current = driftAlertsEnabled;
  }, [driftAlertsEnabled, postOnboardingSidebarGuideActive]);
  const introDecision = useMemo<GuideDecision>(() => ({
    autoCloseEnabled: automaticCloseSavedEnabled,
    petEnabled: petModeEnabled,
    onAutoCloseChange: (enabled) => {
      handleAutomaticCloseSettingsChange(enabled);
      if (!enabled && introDriftAlertsBaselineRef.current === false) setDriftAlertsEnabled(false);
    },
    onPetChange: (enabled) => requestPetModeEnabled(enabled),
  }), [automaticCloseSavedEnabled, handleAutomaticCloseSettingsChange, petModeEnabled, requestPetModeEnabled, setDriftAlertsEnabled]);
  // The first-day preparation screen stacks up what the run has loaded for the day it is preparing.
  const firstDayPreparedDayLoaded = preparingFirstDay && firstDayPreparedDay !== null && segmentsLoadedDay === firstDayPreparedDay;
  const firstDayDiscoveries = useMemo(
    () => (firstDayPreparedDayLoaded ? buildFirstDayDiscoveries(segments, selectedDayClassificationOptions) : null),
    [firstDayPreparedDayLoaded, segments, selectedDayClassificationOptions],
  );
  const firstDayChart = useMemo(
    () => (firstDayPreparedDayLoaded ? buildFirstDayChart(segments, selectedDayClassificationOptions) : null),
    [firstDayPreparedDayLoaded, segments, selectedDayClassificationOptions],
  );
  // What the in-flight batch is reading, named from the loaded day so the screen can say it.
  const firstDayReading = useMemo(
    () => (firstDayPreparedDayLoaded ? buildFirstDayReadingSources(segments, firstDayReadingSegmentIds) : []),
    [firstDayPreparedDayLoaded, firstDayReadingSegmentIds, segments],
  );
  const companionFocusRecordClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      includeAiClassifications: showAiClassificationImpact,
      includeBuiltInHeuristics: allowBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
      rules: classificationRules,
    }),
    [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, classificationRules, showAiClassificationImpact],
  );
  const materializeBuiltInHeuristicTimeline = useCallback((sourceSegments: ActivitySegment[]) => materializeBuiltInHeuristicClassifications({
    classificationOptions: {
      fallbackCandidates: sourceSegments,
      includeAiClassifications: false,
      includeBuiltInHeuristics: allowBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
      rules: classificationRules,
    },
    segments: sourceSegments,
  }), [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, classificationRules]);
  const allowBuiltInHeuristicsRef = useRef(allowBuiltInHeuristics);
  allowBuiltInHeuristicsRef.current = allowBuiltInHeuristics;
  const scheduleAvailableBuiltInHeuristicPersistence = useCallback((classifications: BuiltInHeuristicClassificationMaterialization["classifications"]) => {
    // A history load can finish after the selected AI route becomes unavailable.
    // Re-check at the commit boundary so a stale render cannot persist heuristics.
    if (!allowBuiltInHeuristicsRef.current) return;
    scheduleBuiltInHeuristicClassificationPersistence(
      classifications,
      () => allowBuiltInHeuristicsRef.current,
    );
  }, []);
  const recentDriftAlarmFocusTargets = useMemo(
    () => buildRecentFocusTargets(segments, historySegments, selectedDayClassificationOptions, appIcons, siteIcons),
    [appIcons, historySegments, segments, selectedDayClassificationOptions, siteIcons],
  );
  const [availableDriftAlarmFocusTargets, setAvailableDriftAlarmFocusTargets] = useState<DriftAlarmFocusTarget[]>([]);
  const availableDriftAlarmFocusTargetsRef = useRef<DriftAlarmFocusTarget[]>([]);
  const availableDriftAlarmFocusTargetsPromiseRef = useRef<Promise<DriftAlarmFocusTarget[]> | null>(null);
  const applyAvailableDriftAlarmFocusTargets = useCallback((targets: DriftAlarmFocusTarget[]) => {
    if (haveSameDriftAlarmFocusTargets(availableDriftAlarmFocusTargetsRef.current, targets)) return;
    availableDriftAlarmFocusTargetsRef.current = targets;
    setAvailableDriftAlarmFocusTargets(targets);
  }, []);
  const resolveCurrentAvailableDriftAlarmFocusTargets = useCallback(async () => {
    const pendingTargets = availableDriftAlarmFocusTargetsPromiseRef.current;
    if (!pendingTargets) return availableDriftAlarmFocusTargetsRef.current;
    try {
      return await pendingTargets;
    } catch (error) {
      console.warn("Failed to resolve current focus target availability", error);
      return availableDriftAlarmFocusTargetsRef.current;
    }
  }, []);
  useEffect(() => {
    let active = true;
    const definitelyAvailableTargets = filterDefinitelyAvailableFocusTargets(recentDriftAlarmFocusTargets);
    applyAvailableDriftAlarmFocusTargets(definitelyAvailableTargets);

    const resolvedTargetsPromise = resolveAvailableFocusTargets(recentDriftAlarmFocusTargets);
    availableDriftAlarmFocusTargetsPromiseRef.current = resolvedTargetsPromise;
    void resolvedTargetsPromise.then((resolvedTargets) => {
      if (!active) return;
      if (availableDriftAlarmFocusTargetsPromiseRef.current !== resolvedTargetsPromise) return;
      applyAvailableDriftAlarmFocusTargets(resolvedTargets);
    });

    return () => {
      active = false;
    };
  }, [applyAvailableDriftAlarmFocusTargets, recentDriftAlarmFocusTargets]);
  // Paid device sync: same entitlement gate as cloud AI, plus the per-device
  // explicit opt-in toggle (raw activity leaves the device only when both hold).
  // Settings > Sync exposes the default-off Pro feature independently of Dev mode.
  const deviceSyncFeatureVisible = true;
  const deviceSyncCanEnable =
    deviceSyncAccountId !== null &&
    deviceSyncPreferenceOwnerId === deviceSyncAccountId &&
    !deviceSyncAccountResetPending
    && isCloudOnline && isSupabaseConfigured && isPolicySignedIn && billingEntitlement?.canUseApp === true;
  const deviceSyncActive = deviceSyncFeatureVisible && deviceSyncCanEnable && deviceSyncEnabled;
  const deviceSyncUserScopeKey = user?.id ?? "anonymous";
  // `refresh` is re-created every render (function declaration below); the ref
  // keeps the sync controller's callback pointed at the current one instead of
  // a stale first-render closure.
  const deviceSyncRefreshRef = useRef<(() => void) | null>(null);
  deviceSyncRefreshRef.current = () => {
    void refresh(undefined, { foreground: false });
  };
  useEffect(() => {
    const identityGeneration = deviceSyncToggleGenerationRef.current + 1;
    deviceSyncToggleGenerationRef.current = identityGeneration;
    retireLegacyDeviceSyncEnabledPreference();
    setDeviceSyncPreferenceOwnerId(null);
    setDeviceSyncEnabled(false);
    const syncTracker = trackerClient as unknown as Record<string, unknown>;
    const hasAccountScopeCommands = [
      "getSyncState",
      "purgeRemoteSegments",
      "setSyncState",
    ].every((command) => typeof syncTracker[command] === "function");
    if (!isTauri() || !hasAccountScopeCommands) return;
    // Capture one coherent tracker surface for the async transition. Test and
    // hot-reload harnesses may replace the shared client object between turns.
    const accountScopeTracker = {
      getSyncState: trackerClient.getSyncState.bind(trackerClient),
      purgeRemoteSegments: trackerClient.purgeRemoteSegments.bind(trackerClient),
      setSyncState: trackerClient.setSyncState.bind(trackerClient),
    };

    const accountId = deviceSyncAccountId;
    const isCurrent = () => (
      deviceSyncAccountIdRef.current === accountId
      && deviceSyncToggleGenerationRef.current === identityGeneration
    );
    void (async () => {
      try {
        if (accountId) {
          await prepareDeviceSyncAccountScope(accountScopeTracker, accountId, isCurrent);
        } else {
          await suspendDeviceSyncAccountScope(accountScopeTracker, isCurrent);
        }
        if (!isCurrent()) return;
        setDeviceSyncPreferenceOwnerId(accountId);
        setDeviceSyncEnabled(accountId ? resolveDeviceSyncEnabled(accountId) : false);
        deviceSyncRefreshRef.current?.();
      } catch (error) {
        console.warn("Failed to prepare device sync account scope", error);
        // Fail closed and retain the saved account preference for a later retry.
        if (isCurrent()) setDeviceSyncPreferenceOwnerId(null);
      }
    })();
  }, [deviceSyncAccountId]);
  const handleRemoteSegmentsApplied = useCallback(() => {
    deviceSyncRefreshRef.current?.();
  }, []);
  const handleDeviceSyncAccountPaused = useCallback((syncGeneration: number | null) => {
    deviceSyncToggleGenerationRef.current += 1;
    setDeviceSyncEnabled(false);
    if (syncGeneration !== null) {
      void (async () => {
        await trackerClient.setSyncState(buildSyncStateAfterCloudPurge(syncGeneration));
        await trackerClient.purgeRemoteSegments();
        deviceSyncRefreshRef.current?.();
      })().catch((error) => {
        console.warn("Failed to reconcile a paused device sync account", error);
      });
    }
  }, []);
  const handleDeviceSyncEnabledChange = useCallback(async (enabled: boolean) => {
    const toggleGeneration = deviceSyncToggleGenerationRef.current + 1;
    deviceSyncToggleGenerationRef.current = toggleGeneration;
    if (!enabled) {
      setDeviceSyncEnabled(false);
      return;
    }
    if (!deviceSyncAccountId || deviceSyncPreferenceOwnerId !== deviceSyncAccountId) {
      setDeviceSyncEnabled(false);
      return;
    }
    try {
      const isCurrent = () => (
        deviceSyncAccountIdRef.current === deviceSyncAccountId
        && deviceSyncToggleGenerationRef.current === toggleGeneration
      );
      await prepareDeviceSyncAccountScope(trackerClient, deviceSyncAccountId, isCurrent);
      if (deviceSyncToggleGenerationRef.current !== toggleGeneration) return;
      const accountState = await fetchSyncDevices(deviceSyncAccountId);
      if (deviceSyncToggleGenerationRef.current !== toggleGeneration) return;
      if (accountState.syncStatus === "paused") {
        await trackerClient.setSyncState(buildSyncStateAfterCloudPurge(accountState.syncGeneration));
        await trackerClient.purgeRemoteSegments();
        deviceSyncRefreshRef.current?.();
      }
      // Invalidate any generation-bound pull before the server mutation. A
      // stale response can no longer apply rows after a concurrent purge.
      await trackerClient.setSyncState({ [SYNC_GENERATION_KEY]: null });
      if (deviceSyncToggleGenerationRef.current !== toggleGeneration) return;
      const resumed = await resumeCloudSyncData(deviceSyncAccountId, accountState.syncGeneration);
      if (deviceSyncToggleGenerationRef.current !== toggleGeneration) return;
      await trackerClient.setSyncState({ [SYNC_GENERATION_KEY]: String(resumed.syncGeneration) });
      if (deviceSyncToggleGenerationRef.current !== toggleGeneration) return;
      setDeviceSyncEnabled(true);
    } catch (error) {
      console.warn("Failed to resume device sync", error);
      if (deviceSyncToggleGenerationRef.current === toggleGeneration) setDeviceSyncEnabled(false);
    }
  }, [deviceSyncAccountId, deviceSyncPreferenceOwnerId]);
  const {
    status: deviceSyncStatus,
    deviceLabelById: syncDeviceLabelById,
    syncNow: deviceSyncNow,
    quiesce: quiesceDeviceSync,
  } = useDeviceSyncController({
    syncActive: deviceSyncActive,
    userScopeKey: deviceSyncUserScopeKey,
    syncAccountId: deviceSyncAccountId,
    onRemoteSegmentsApplied: handleRemoteSegmentsApplied,
    onAccountSyncPaused: handleDeviceSyncAccountPaused,
  });
  // Keep received history filterable before the live device list loads or while sync is off.
  const remoteDeviceLabelById = useMemo(() => {
    return buildRemoteDeviceLabels(syncDeviceLabelById, deviceSyncStatus.deviceId,
      [segments, historySegments], (number) => localization.t("dashboard.syncedDevice", { number }));
  }, [deviceSyncStatus.deviceId, historySegments, localization, segments, syncDeviceLabelById]);
  useEffect(() => {
    // Leaving sync (or losing the gate) drops any device-scoped filter so the
    // timeline never silently hides local history.
    if (!deviceSyncActive) setDeviceTimelineFilter("all");
  }, [deviceSyncActive]);
  const [deviceSyncPurging, setDeviceSyncPurging] = useState(false);
  // Keep destructive confirmation inside the shared app modal system so its
  // hierarchy and keyboard behavior match the rest of the product.
  const [deviceSyncPurgeConfirmOpen, setDeviceSyncPurgeConfirmOpen] = useState(false);
  const handlePurgeDeviceSyncData = useCallback(() => {
    setDeviceSyncPurgeConfirmOpen(true);
  }, []);
  const cancelPurgeDeviceSyncData = useCallback(() => {
    setDeviceSyncPurgeConfirmOpen(false);
  }, []);
  const confirmPurgeDeviceSyncData = useCallback(async () => {
    setDeviceSyncPurgeConfirmOpen(false);
    setDeviceSyncPurging(true);
    try {
      if (!deviceSyncAccountId) throw new Error("Device sync requires a signed-in account.");
      const purgeAccountId = deviceSyncAccountId;
      const purgeOperationGeneration = deviceSyncToggleGenerationRef.current + 1;
      deviceSyncToggleGenerationRef.current = purgeOperationGeneration;
      setDeviceSyncEnabled(false);
      await trackerClient.setSyncState({ [SYNC_GENERATION_KEY]: null });
      // Purge must not depend on the paid devices endpoint: an expired Pro
      // account still owns its cloud copy and can delete it immediately.
      const purge = await purgeCloudSyncData(purgeAccountId);
      if (deviceSyncAccountIdRef.current !== purgeAccountId) return;
      if (deviceSyncToggleGenerationRef.current !== purgeOperationGeneration) {
        // The cloud deletion still happened. Reconcile its local copy even if
        // a newer toggle now owns the visible enabled state.
        await trackerClient.setSyncState(buildSyncStateAfterCloudPurge(purge.syncGeneration));
        await trackerClient.purgeRemoteSegments();
        deviceSyncRefreshRef.current?.();
        return;
      }
      setDeviceSyncEnabled(false);
      // Keep the push cursor: deleting the cloud copy must not become an
      // implicit full-history re-upload. Explicit re-enable resumes only with
      // activity recorded after the prior cursor.
      await trackerClient.setSyncState(buildSyncStateAfterCloudPurge(purge.syncGeneration));
      await trackerClient.purgeRemoteSegments();
      deviceSyncRefreshRef.current?.();
    } catch (error) {
      console.warn("Failed to purge device sync data", error);
    } finally {
      setDeviceSyncPurging(false);
    }
  }, []);

  const handleDeleteAccount = useCallback(async (confirmation: string): Promise<AccountDeletionResult> => {
    const deletedUserId = user?.id ?? null;
    try {
      // Write both fail-closed values synchronously before touching remote
      // state. React's persistence effect may not run before an app exit.
      markDeviceSyncAccountResetPending(deletedUserId);
      window.localStorage.setItem(LEGACY_DEVICE_SYNC_ENABLED_STORAGE_KEY, "0");
      setDeviceSyncEnabled(false);
      // A cycle that started before the toggle changed can still write the old
      // pacing record, device id, and cursors. Drain it before clearing either.
      await resetAccountSyncIdentity({
        userScopeKey: deletedUserId,
        quiesce: quiesceDeviceSync,
        setSyncState: (state) => trackerClient.setSyncState(state),
      });
      clearPendingDeviceSyncAccountReset();
      setDeviceSyncAccountResetPending(false);
    } catch (resetError) {
      // Keep this session fail-closed too. Recovery is intentionally armed only
      // from the marker observed at launch, so setting this flag cannot race an
      // immediate second tracker write against the deletion attempt.
      setDeviceSyncAccountResetPending(true);
      console.warn("Unable to reset local sync identity before account deletion.", resetError);
      return {
        success: false,
        code: "local_sync_reset_failed",
        stage: "not_started",
        error: resetError instanceof Error ? resetError.message : "Unable to reset local sync identity.",
      };
    }

    if (
      deletedUserId
      && isTauriRuntime()
      && hasLocalGoogleCalendarConnectionMarker(deletedUserId)
    ) {
      try {
        await disconnectGoogleCalendar(deletedUserId);
      } catch (calendarError) {
        console.warn("Unable to remove the local Google Calendar credential before account deletion.", calendarError);
        return {
          success: false,
          code: "local_calendar_disconnect_failed",
          stage: "not_started",
          error: calendarError instanceof Error
            ? calendarError.message
            : "Unable to remove the local Google Calendar credential.",
        };
      }
    }

    const result = await deleteDriftyAccount(confirmation);
    if (!result.success) return result;

    setAccountDeletionModalOpen(false);
    try {
      await signOut();
    } catch (signOutError) {
      // The remote auth user is already gone. The next auth refresh will also
      // clear the session; keep account deletion successful and surface only a
      // non-sensitive diagnostic for this local cleanup failure.
      console.warn("Unable to clear the deleted account session immediately.", signOutError);
    }
    return result;
  }, [quiesceDeviceSync, signOut, user?.id]);

  useEffect(() => {
    if (!recoverPendingDeviceSyncAccountResetOnLaunchRef.current) return;
    recoverPendingDeviceSyncAccountResetOnLaunchRef.current = false;
    window.localStorage.setItem(LEGACY_DEVICE_SYNC_ENABLED_STORAGE_KEY, "0");
    setDeviceSyncEnabled(false);
    const pendingReset = readPendingDeviceSyncAccountReset();
    if (pendingReset?.userScopeKey) clearDeviceSyncCycleRecordsForUser(pendingReset.userScopeKey);
    void trackerClient.setSyncState({
      [SYNC_PUSH_SEQ_KEY]: "0",
      [SYNC_PULL_CURSOR_KEY]: null,
      [SYNC_DELETION_PULL_CURSOR_KEY]: null,
      [SYNC_DEVICE_ID_KEY]: null,
      [SYNC_LAST_PUSHED_AT_KEY]: null,
      [SYNC_LAST_PULLED_AT_KEY]: null,
    }).then(() => {
      clearPendingDeviceSyncAccountReset();
      setDeviceSyncAccountResetPending(false);
    }).catch((resetError) => {
      console.warn("Unable to recover pending account-deletion sync reset.", resetError);
    });
  }, []);
  const requestLeaderboardAuth = openDefaultAuthModal;
  const requestTeamAuth = openDefaultAuthModal;
  // Owned here so route gating and team invite deep links share one controller.
  const realTeamController = useTeamController({
    activeTab,
    hasRequiredAccountAuth,
    isEffectiveAuthRequired,
    isSupabaseConfigured,
    user,
    onAuthRequired: requestTeamAuth,
  });
  // Dev-server-only QA fixtures; both hooks always run to keep hook order stable.
  const teamQaMockController = useTeamQaMockController();
  const teamController = isTeamQaMockEnabled() ? teamQaMockController : realTeamController;
  const {
    activeLeaderboardPeriod,
    isLeaderboardOptedIn,
    isLeaderboardParticipationResolved,
    isProfileEditorOpen,
    leaderboardActionError,
    leaderboardActionLoading,
    leaderboardError,
    leaderboardLoading,
    leaderboardLocalMetricsStatus,
    leaderboardProfileBio,
    leaderboardProfileDisplayName,
    leaderboardProfileGithubUrl,
    leaderboardProfileLinkedinUrl,
    leaderboardProfileWebsiteUrl,
    leaderboardStatusMessage,
    leaderboardStatusTone,
    leaderboardSegments,
    leaderboardUsesPreviewProfile,
    leaderboardWindowEndDay,
    localRollingFocusSeconds,
    ownLeaderboardEntry,
    profile,
    profileDraft,
    profileError,
    profileLoading,
    profileMessage,
    profileReadyUserId,
    profileSaving,
    profileShareMessage,
    rows: leaderboardRows,
    selectedLeaderboardRow,
    selectedProfileError,
    selectedProfileLoading,
    selectedPublicProfile,
    totalLeaderboardFocusSeconds,
    closeProfileEditor,
    closeSelectedProfile,
    handleLeaderboardOptIn,
    handleLeaderboardOptOut,
    handleProfilePhotoSelected,
    handleSaveProfile,
    handleSaveProfileFromModal,
    handleSelectLeaderboardProfile,
    handleShareLeaderboardProfile,
    openProfileEditor,
    publishLeaderboardCheckpoint,
    refreshLeaderboardData,
    syncLeaderboardPublication,
    removeProfilePhoto,
    setActiveLeaderboardPeriod,
    updateProfileDraft,
  } = useLeaderboardProfileController({
    activeTab,
    allowsEffectiveAnonymousAuth,
    authMetadataAvatarUrl,
    hasRequiredAccountAuth,
    isAuthResolved: authStatus !== "loading",
    isEffectiveAuthRequired,
    isSupabaseConfigured,
    classificationAssessmentReady,
    classificationAvailabilityState: classificationAvailability.state,
    classificationRecoveryPending: classificationRecoveryPending || classificationRecoveryTransitionPending,
    classificationCatchingUp: isClassificationCatchingUp,
    classificationAvailabilityReason: classificationAvailability.reason,
    classificationRecoveryAction: classificationAvailability.recoveryAction,
    classificationCloudQuota: classificationAvailability.cloudQuota,
    showAiClassificationImpact,
    includeBuiltInHeuristics: allowBuiltInHeuristics,
    builtInHeuristicsUnavailableSince,
    signInAnonymously,
    startOfDayMinutes,
    user,
    onAuthRequired: requestLeaderboardAuth,
  });
  const focusCard = useFocusCard({
    userId: isPolicySignedIn ? (user?.id ?? null) : null,
    windowEndDay: leaderboardWindowEndDay,
    startOfDayMinutes,
    includeAiClassifications: showAiClassificationImpact,
    includeBuiltInHeuristics: allowBuiltInHeuristics,
    builtInHeuristicsUnavailableSince,
    classificationAssessmentReady,
  });
  // Web account preview (Dev-gated): while active, periodically publish the aggregate-only
  // account summary that powers the drifty.so account dashboard. Private self-view data —
  // owner-only RLS on the table, nothing public and nothing raw.
  const webAccountStatsActive = isDevModeActive && devWebAccountPreviewEnabled && isCloudOnline && isSupabaseConfigured && isPolicySignedIn;
  useAccountStatsPublisher({
    active: webAccountStatsActive && classificationAssessmentReady,
    userScopeKey: user?.id ?? "anonymous",
    startOfDayMinutes,
    includeAiClassifications: showAiClassificationImpact,
    includeBuiltInHeuristics: allowBuiltInHeuristics,
    builtInHeuristicsUnavailableSince,
  });
  // Load the 30-day series shortly after launch for people on the leaderboard, so the
  // first visit to the tab does not wait on the tracker query. Each visit still refreshes it.
  const leaderboardSeriesPrewarmReady = useLeaderboardSeriesPrewarm(isLeaderboardOptedIn);
  const [leaderboardSeriesPrewarmed, setLeaderboardSeriesPrewarmed] = useState(false);
  const profileDailyProductivity = useDailyProductivitySeries({
    windowEndDay: leaderboardWindowEndDay,
    startOfDayMinutes,
    includeAiClassifications: showAiClassificationImpact,
    includeBuiltInHeuristics: allowBuiltInHeuristics,
    builtInHeuristicsUnavailableSince,
    enabled: activeTab === "leaderboard" || (leaderboardSeriesPrewarmReady && !leaderboardSeriesPrewarmed),
  });
  useEffect(() => {
    if (profileDailyProductivity !== null) setLeaderboardSeriesPrewarmed(true);
  }, [profileDailyProductivity]);
  const effectiveDailyProductivity = useMemo(() => {
    if (!leaderboardUsesPreviewProfile) return profileDailyProductivity;
    // A browser preview has no tracker, so its series arrives as zeros; the
    // sample week keeps the rail and share card readable there.
    if (profileDailyProductivity && profileDailyProductivity.length >= 2 && profileDailyProductivity.some((point) => point.focus > 0)) return profileDailyProductivity;
    const points: DailyProductivityPoint[] = [];
    const focusMinutes = [25, 38, 32, 54, 42, 68, 52];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(`${leaderboardWindowEndDay}T12:00:00`);
      date.setDate(date.getDate() - i);
      const day = localDateKey(date);
      const focus = (focusMinutes[6 - i] ?? 30) * 60;
      points.push({
        day,
        focus,
        drift: Math.round(focus * 0.2),
        neutral: 0,
      });
    }
    return points;
  }, [leaderboardUsesPreviewProfile, leaderboardWindowEndDay, profileDailyProductivity]);
  // Stable while the sheet is open, so the card does not re-render on every tracker tick.
  const leaderboardShareCardContext = useMemo(() => ({
    accountScope: shareAccountScope,
    comparisonWindowKey: `${leaderboardWindowEndDay}:${startOfDayMinutes}`,
    theme,
    windowEndDay: leaderboardWindowEndDay,
    onJoinLeaderboard: handleLeaderboardOptIn,
  }), [handleLeaderboardOptIn, leaderboardWindowEndDay, shareAccountScope, startOfDayMinutes, theme]);
  const aiClassificationProviderKey = selectedLocalAiClassificationOptions
    ? `local:${localAiConnectionFingerprint ?? "unconfigured"}`
    : canUseSelectedCloudAiClassification
      ? "cloud"
      : "disabled";
  const currentAiClassificationProviderKeyRef = useRef(aiClassificationProviderKey);
  currentAiClassificationProviderKeyRef.current = aiClassificationProviderKey;
  const classificationActivity = useClassificationActivity();
  const establishedCloudClassificationIssueKind = isEstablishedCloudAiDisconnect(cloudAiConnectionCheck)
    ? cloudAiConnectionCheck?.issueKind ?? null
    : null;
  const resolvedAiConnectionStatus = resolveAiConnectionStatus({
    canUseCloudAi: canUseSelectedCloudAiClassification,
    localProviderStatus: localAiProviderStatus,
    localProviderLabel: localAiConnectionFingerprint ? localAiConnectionProviderLabel : null,
    localMemoryUsageBytes: localAiMemoryUsageBytes,
    classificationRunning: classificationActivity.running || classificationActionLoading || classificationSummary?.status === "running",
    classificationRemaining: classificationActivity.remaining,
    // Local providers report connectivity through localProviderStatus (with
    // failure hysteresis); only cloud runs surface summary errors here, and
    // content-level failures (provider answered, output unusable) never do.
    classificationIssueKind: selectedClassificationRoute === "cloud" ? establishedCloudClassificationIssueKind : null,
    cloudIssueKind: classificationAvailability.reason === "cloud_quota_exceeded" && classificationAvailability.showRecovery
      ? "rate_limited"
      : selectedClassificationRoute === "cloud" && billingEntitlement?.lockedReason === "device_limit_reached"
          ? "provider"
          : null,
  });
  const aiConnectionStatus = classificationAvailabilityGateEnabled || isQuietCloudPause(classificationAvailability)
    ? applyClassificationAvailabilityToAiStatus(resolvedAiConnectionStatus, classificationAvailability)
    : resolvedAiConnectionStatus;
  const previousAiClassificationProviderKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const previousAiClassificationProviderKey = previousAiClassificationProviderKeyRef.current;
    setClassificationSummary((current) => {
      if (previousAiClassificationProviderKey === null) return current;
      if (previousAiClassificationProviderKey === aiClassificationProviderKey) return current;
      return current?.status === "error" ? null : current;
    });
    setCloudAiConnectionCheck(null);
    clearCloudAiRequestBackoff();
    cloudAiConnectionGenerationRef.current += 1;
    cloudRecoveryTestNextAtRef.current = 0;
    cloudRecoveryProbeNextAtRef.current = 0;
    cloudRecoveryProbeFailuresRef.current = 0;
    previousAiClassificationProviderKeyRef.current = aiClassificationProviderKey;
  }, [aiClassificationProviderKey]);
  const isSettingsTab = activeTab === "settings";
  // This observer is app-scoped. Entering Settings must not clear a runtime
  // failure and reveal an unrelated connection-probe result underneath it.
  const managedLocalAiStatus = useManagedLocalAiStatusObserver(!onboardingOpen);
  const selectedManagedLocalAiStatus = isManagedLocalAiRoute(localAiSetup)
    ? managedLocalAiStatusForModel(managedLocalAiStatus, localAiSetup.managedLocalModelId)
    : null;
  const isSidebarVisuallyCollapsed = !isSettingsTab && sidebarCollapsed;
  // Dev preview feeds the same resolver a synthetic input instead of swapping in
  // a canned state, so what you see is the production branching.
  const isSidebarCtaPreviewActive = isDevModeActive && sidebarCtaPreviewCase !== null;
  const sidebarCtaPreviewInput = isSidebarCtaPreviewActive && sidebarCtaPreviewCase
    ? buildSidebarCtaPreviewInput(sidebarCtaPreviewCase, Date.now())
    : null;
  const runtimeAwareAiConnectionStatus = applyManagedLocalAiRuntimeStatus(
    aiConnectionStatus,
    selectedManagedLocalAiStatus,
  );
  const effectiveAiConnectionStatus = sidebarCtaPreviewInput
    ? applyManagedLocalAiRuntimeStatus(
      { ...sidebarCtaPreviewInput.aiStatus, memoryLabel: null },
      sidebarCtaPreviewInput.managedLocalAiStatus,
    )
    : runtimeAwareAiConnectionStatus;
  const dayNotePreview = import.meta.env.DEV ? readDayNotePreview() : null;
  const [dayNotePageOpen, setDayNotePageOpen] = useState(() => dayNotePreview?.place === "page");
  const [dayRecordOpen, setDayRecordOpen] = useState(false);
  const dayRecordVisible = isDailyRecordPreviewActive && dayRecordOpen && !dayNotePageOpen;
  const sidebarCtaSlot = resolveSidebarCtaSlot(
    sidebarCtaPreviewInput
      ? sidebarCtaPreviewInput
      : {
        aiStatus: aiConnectionStatus,
        billingCheckoutLoading: billingCheckoutLoadingInterval !== null || billingCheckoutAwaitingConfirmation || billingPortalLoading,
        billingEntitlement,
        billingEntitlementError,
        billingEntitlementLoading,
        localAiProvider: localAiSetup.provider,
        localAiConfigured: localAiConnectionFingerprint !== null,
        localAiDisconnectConfirmed: localAiConnectionPersistentFailure,
        managedLocalAiStatus: selectedManagedLocalAiStatus,
        classificationAvailability: classificationAvailabilityGateEnabled ? classificationAvailability : undefined,
      },
  );
  const sidebarUpgradeDismissed = !isSidebarCtaPreviewActive
    && sidebarCtaSlot?.kind === "upgrade"
    && isSidebarUpgradeDismissed(sidebarUpgradeDismissedUntil, Date.now());
  const shouldShowSidebarCtaSlot = !isSettingsTab
    && sidebarCtaSlot !== null
    && !sidebarUpgradeDismissed;
  const billingEntitlementSupportsUpgrade = canStartIndividualCheckout(billingEntitlement);
  const handleOpenUpgradePlanModal = useCallback(() => {
    if (!isSidebarCtaPreviewActive && canStartCloudTrial(billingEntitlement)) {
      openAiSetupSettings();
      return;
    }
    if (!isSupabaseConfigured) {
      requestCloudBillingAuth();
      return;
    }
    if (!user || !hasRequiredAccountAuth) {
      setResumeUpgradePlanAfterAuth(true);
      requestCloudBillingAuth();
      return;
    }
    if (!isSidebarCtaPreviewActive && (billingEntitlementLoading || !billingEntitlementSupportsUpgrade)) return;
    setUpgradePlanModalOpen(true);
  }, [
    billingEntitlement,
    openAiSetupSettings,
    billingEntitlementLoading,
    billingEntitlementSupportsUpgrade,
    hasRequiredAccountAuth,
    isSidebarCtaPreviewActive,
    isSupabaseConfigured,
    requestCloudBillingAuth,
    user,
  ]);

  const refreshRequestRef = useRef(0);
  const trackerMutationGenerationRef = useRef(0);
  const trackerStopInFlightRef = useRef(false);
  const lastFullDayRefreshAtRef = useRef(0);
  const historyRefreshRequestRef = useRef(0);
  const historyLoadMoreRequestRef = useRef(0);
  const historySearchRequestRef = useRef(0);
  const dashboardRefreshInputsRef = useRef<DashboardRefreshInputs | null>(null);
  const requiredCurrentSnapshotRefreshInFlightRef = useRef(false);
  // The refresh whose deferred live snapshot the sidebar placeholder waits on.
  const deferredCurrentSnapshotRequestRef = useRef<number | null>(null);
  const dashboardWeekPrefetchRequestRef = useRef(0);
  const compactHistoryCacheRef = useRef<Map<string, CompactHistoryLoad>>(new Map());
  const compactHistoryInFlightRef = useRef<Map<string, { readonly range: CompactHistoryRange; readonly promise: Promise<CompactHistoryLoad> }>>(new Map());
  const compactHistoryCacheGenerationRef = useRef(0);
  const autoSelectedLatestDayRef = useRef(false);
  const userSelectedDayRef = useRef(false);
  // The logical today when the current day was picked automatically (the first-day gate's prepared day).
  const automaticDayChoiceTodayRef = useRef<string | null>(null);
  const lastDriftAlertSegmentRef = useRef<string | null>(null);
  const pendingExtremeNudgeRef = useRef<{ readonly alertKey: string; readonly candidate: DriftAlarmCandidate } | null>(null);
  const nativeExtremeNudgeInFlightRef = useRef(false);
  // One card per episode used to be the whole intervention. The reminder
  // ladder re-opens delivery for an episode that outlives its card; it is
  // reset wherever the episode lock itself is cleared.
  const driftAlarmReminderRef = useRef<DriftAlarmReminderState | null>(null);
  const driftAlarmSessionProtectionRef = useRef<DriftAlarmSessionProtection | null>(null);
  // A real catch is an explicit veto of this close attempt. Keep its short
  // grace on the stable drift episode so tracker segment rollover or an extra
  // refresh cannot make the cat return before the grace deadline.
  const petInterceptionGraceRef = useRef<(PetInterceptionGrace & {
    readonly candidate: DriftAlarmCandidate;
  }) | null>(null);
  const automaticCloseReentryRef = useRef<AutomaticCloseReentry | null>(null);
  const pendingDriftAlarmGateRef = useRef<string | null>(null);
  const pendingDriftAlarmGateGenerationRef = useRef(0);
  // Alert key whose latest outcome is an AI-gate suppression or gate error,
  // not a delivered alarm. `lastDriftAlertSegmentRef` alone cannot tell the
  // two apart, and a user rule, manual correction, or the sustained social
  // dwell hard rule must be able to reopen such an episode
  // (docs/product-decisions.md, 2026-09-12). `reminder` remembers whether that
  // attempt was a reminder, so a reopen never turns into a second close.
  const gateSuppressedDriftAlarmRef = useRef<{ alertKey: string; reminder: boolean } | null>(null);
  const unavailableYouTubeDriftAlarmGateRef = useRef<{
    alertKey: string;
    videoId: string;
    reason: string;
    reminder: boolean;
  } | null>(null);
  const lastEligibleDriftCandidateRef = useRef<DriftAlarmCandidate | null>(null);
  const pendingDriftAlarmTransientRef = useRef<DriftAlarmTransientPending | null>(null);
  const pendingDriftAlarmTransientRefreshRef = useRef(0);
  const driftAlarmSnoozeRef = useRef<DriftAlarmBreakSnooze | null>(null);
  const breakRecoveryAssessmentRef = useRef<DriftAlarmBreakSnooze | null>(null);
  const autoStartAttemptedRef = useRef(false);
  const watcherSnapshotRef = useRef<WatcherSnapshot>(getDefaultWatcherSnapshot());
  const petModeLiveObservedAtMsRef = useRef(0);
  const petModeLiveSnapshotRef = useRef(getDefaultWatcherSnapshot());
  const watcherEventRef = useRef<WatcherPeekEvent | null>(null);
  const watcherRequestInFlightRef = useRef(false);
  const watcherRecoveryTimeoutRef = useRef(0);
  const endOfDayReviewQueryPreviewShownRef = useRef(false);
  const driftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const lastDriftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const lastExtremeNudgeToastEventRef = useRef<ExtremeNudgeToastEvent | null>(null);
  const driftAlarmSourceSegmentsRef = useRef<Map<string, ActivitySegment>>(new Map());
  const appIconRequestsInFlightRef = useRef<Set<string>>(new Set());
  const siteIconRequestsInFlightRef = useRef<Set<string>>(new Set());
  const siteIconCachedOnlyRequestsInFlightRef = useRef<Set<string>>(new Set());
  const driftAlarmRequestInFlightRef = useRef(false);
  const liveDriftAlarmRefreshInFlightRef = useRef(false);
  const liveDriftAlarmTimelineUnavailableRef = useRef(false);
  const windowsLiveSnapshotRefreshInFlightRef = useRef(false);
  const liveDriftAlarmAiRequestInFlightRef = useRef<string | null>(null);
  const liveDriftAlarmAiRetryAfterRef = useRef<Map<string, number>>(new Map());
  const pendingDriftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const pendingBreakReturnAlarmRef = useRef<DriftAlarmBreakSnooze | null>(null);
  const evaluateDriftAlarmRef = useRef<DriftAlarmEvaluator | null>(null);
  const acknowledgedNativeDriftAlarmStatusSignatureRef = useRef<string | null>(null);
  const pendingNativeDriftAlarmStatusSignatureRef = useRef<string | null>(null);
  const desiredNativeDriftAlarmStatusRef = useRef<{ signature: string; status: DriftAlarmTrayStatus } | null>(null);
  const loadCompactHistoryRange = useCallback((historyTimelineRange: CompactHistoryRange): Promise<CompactHistoryLoad> => {
    const key = compactHistoryRangeKey(historyTimelineRange);
    const cached = findFreshCompactHistoryLoad(compactHistoryCacheRef.current, historyTimelineRange);
    if (cached) {
      return Promise.resolve(cached);
    }

    const exactInFlight = compactHistoryInFlightRef.current.get(key);
    if (exactInFlight) return exactInFlight.promise;
    for (const inFlight of compactHistoryInFlightRef.current.values()) {
      if (compactHistoryRangeContains(inFlight.range, historyTimelineRange)) return inFlight.promise;
    }

    const generation = compactHistoryCacheGenerationRef.current;
    const promise = trackerClient.getDashboardWeekTimeline(historyTimelineRange).then((archiveTimelines) => {
      const nextLoad: CompactHistoryLoad = {
        key,
        start: historyTimelineRange.start,
        end: historyTimelineRange.end,
        loadedAtMs: Date.now(),
        materialized: materializeBuiltInHeuristicTimeline(archiveTimelines),
      };
      if (compactHistoryCacheGenerationRef.current === generation) {
        compactHistoryCacheRef.current.set(key, nextLoad);
        pruneCompactHistoryLoads(compactHistoryCacheRef.current);
        setCompactHistoryCacheRevision((revision) => revision + 1);
      }
      return nextLoad;
    }).finally(() => {
      const current = compactHistoryInFlightRef.current.get(key);
      if (current?.promise === promise && compactHistoryCacheGenerationRef.current === generation) {
        compactHistoryInFlightRef.current.delete(key);
      }
    });

    compactHistoryInFlightRef.current.set(key, { range: historyTimelineRange, promise });
    return promise;
  }, [materializeBuiltInHeuristicTimeline]);
  const loadMissingAppIcons = useCallback(({ segments: segmentsToInspect, shouldReportFailure, failureMessage }: AppIconLoadRequest) => {
    void (async () => {
      const missingIconRequests = collectMissingAppIconRequests(segmentsToInspect, appIconsRef.current).filter((identity) => {
        const identityKey = appIconIdentityKey(identity);
        if (appIconRequestsInFlightRef.current.has(identityKey)) return false;
        appIconRequestsInFlightRef.current.add(identityKey);
        return true;
      });
      if (missingIconRequests.length === 0) return;

      try {
        const rawIconMap = await trackerClient.getAppIcons(missingIconRequests);
        setAppIcons((current) => mergeAppIconResults(current, missingIconRequests, rawIconMap));
      } catch (error) {
        if (shouldReportFailure?.() === false) return;
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn(failureMessage, message);
      } finally {
        for (const identity of missingIconRequests) {
          appIconRequestsInFlightRef.current.delete(appIconIdentityKey(identity));
        }
      }
    })();
  }, []);

  // Site icons follow the same path as app icons: ask the native layer only
  // for domains that are not already resolved, and let it serve them from the
  // on-disk cache. Resolved misses stay in the map so they are not retried.
  // A cached-only request settles on-disk cache entries without any network
  // fetch and omits the rest. It keeps its own in-flight set so it never holds
  // back a normal request for the domains it is about to omit.
  const loadMissingSiteIconDomains = useCallback((domains: readonly string[], options?: { readonly cachedOnly?: boolean }) => {
    const cachedOnly = options?.cachedOnly === true;
    const inFlight = cachedOnly ? siteIconCachedOnlyRequestsInFlightRef.current : siteIconRequestsInFlightRef.current;
    void (async () => {
      const missingDomains = domains.filter((domain) => {
        if (siteIconRequestsInFlightRef.current.has(domain) || inFlight.has(domain)) return false;
        inFlight.add(domain);
        return true;
      });
      if (missingDomains.length === 0) return;

      try {
        const rawIconMap = cachedOnly
          ? await trackerClient.getSiteIcons(missingDomains, { cachedOnly: true })
          : await trackerClient.getSiteIcons(missingDomains);
        setSiteIcons((current) => mergeSiteIconResults(current, missingDomains, rawIconMap));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn("Failed to load site icons.", message);
      } finally {
        for (const domain of missingDomains) {
          inFlight.delete(domain);
        }
      }
    })();
  }, []);

  const loadMissingSiteIcons = useCallback((segmentsToInspect: readonly ActivitySegment[], options?: { readonly cachedOnly?: boolean }) => {
    loadMissingSiteIconDomains(collectMissingSiteIconRequests(segmentsToInspect, siteIconsRef.current), options);
  }, [loadMissingSiteIconDomains]);

  // Saved classification rules name domains directly rather than through
  // tracked segments, so their icons need their own resolve pass.
  useEffect(() => {
    const ruleDomains = classificationRules
      .filter((rule) => rule.targetKind === "site")
      .map((rule) => normalizeSiteIconDomain(rule.targetValue))
      .filter((domain): domain is string => domain !== null && !(domain in siteIconsRef.current));
    if (ruleDomains.length === 0) return;
    loadMissingSiteIconDomains(ruleDomains);
  }, [classificationRules, loadMissingSiteIconDomains]);

  const resetHistorySearch = useCallback(() => {
    setHistorySearchQuery("");
    historySearchRequestRef.current += 1;
    setHistorySearchSegments([]);
    setHistorySearchNextCursor(null);
    setHistorySearchHasMoreSegments(false);
    setHistorySearchLoading(false);
    setHistorySearchError(null);
  }, []);

  useEffect(() => {
    const query = normalizedHistorySearchQuery;
    if (query.length === 0) {
      historySearchRequestRef.current += 1;
      setHistorySearchSegments([]);
      setHistorySearchNextCursor(null);
      setHistorySearchHasMoreSegments(false);
      setHistorySearchLoading(false);
      setHistorySearchError(null);
      return;
    }
    if (activeTab !== "history" || shouldBlockLocalTrackerAccess) {
      historySearchRequestRef.current += 1;
      setHistorySearchLoading(false);
      return;
    }

    const requestId = historySearchRequestRef.current + 1;
    historySearchRequestRef.current = requestId;
    setHistorySearchSegments([]);
    setHistorySearchNextCursor(null);
    setHistorySearchHasMoreSegments(false);
    setHistorySearchLoading(true);
    setHistorySearchError(null);

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const timelinePage = await trackerClient.searchTimeline({
            query,
            ...FULL_HISTORY_SEARCH_RANGE,
            limit: HISTORY_TIMELINE_PAGE_SIZE,
          });
          const materializedPage = materializeBuiltInHeuristicTimeline(timelinePage.items);
          if (historySearchRequestRef.current !== requestId) return;

          setHistorySearchSegments(materializedPage.segments);
          setHistorySearchNextCursor(timelinePage.nextCursor);
          setHistorySearchHasMoreSegments(timelinePage.hasMore);
          scheduleAvailableBuiltInHeuristicPersistence(materializedPage.classifications);
          loadMissingAppIcons({
            segments: materializedPage.segments,
            shouldReportFailure: () => historySearchRequestRef.current === requestId,
            failureMessage: "Failed to load history search app icons",
          });
          loadMissingSiteIcons(materializedPage.segments);
        } catch (nextError) {
          if (historySearchRequestRef.current !== requestId) return;
          setHistorySearchError(describeActionError(nextError instanceof Error ? nextError : toErrorMessage(nextError), localization.t("history.searchError")));
        } finally {
          if (historySearchRequestRef.current === requestId) {
            setHistorySearchLoading(false);
          }
        }
      })();
    }, 200);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeTab,
    loadMissingAppIcons,
    loadMissingSiteIcons,
    materializeBuiltInHeuristicTimeline,
    normalizedHistorySearchQuery,
    shouldBlockLocalTrackerAccess,
  ]);

  useEffect(() => {
    if (activeTab === "history") return;
    if (
      historySearchQuery === ""
      && historySearchSegments.length === 0
      && historySearchNextCursor === null
      && !historySearchHasMoreSegments
      && !historySearchLoading
      && historySearchError === null
    ) return;
    resetHistorySearch();
  }, [
    activeTab,
    historySearchError,
    historySearchHasMoreSegments,
    historySearchLoading,
    historySearchNextCursor,
    historySearchQuery,
    historySearchSegments,
    resetHistorySearch,
  ]);

  const publishNativeDriftAlarmTrayStatus = useCallback((nextStatus: DriftAlarmTrayStatus) => {
    const client = trackerClient as Partial<typeof trackerClient>;
    const updateNativeStatus = client.updateTrayDriftAlarmStatus;
    if (typeof updateNativeStatus !== "function") return;

    const signature = JSON.stringify(nextStatus);
    desiredNativeDriftAlarmStatusRef.current = { signature, status: nextStatus };
    if (
      acknowledgedNativeDriftAlarmStatusSignatureRef.current === signature
      || pendingNativeDriftAlarmStatusSignatureRef.current !== null
    ) return;

    const send = (entry: { signature: string; status: DriftAlarmTrayStatus }, attempt: number) => {
      pendingNativeDriftAlarmStatusSignatureRef.current = entry.signature;
      void updateNativeStatus(entry.status).then(() => {
        acknowledgedNativeDriftAlarmStatusSignatureRef.current = entry.signature;
        pendingNativeDriftAlarmStatusSignatureRef.current = null;
        const desired = desiredNativeDriftAlarmStatusRef.current;
        if (desired && desired.signature !== entry.signature) send(desired, 0);
      }).catch(() => {
        const desired = desiredNativeDriftAlarmStatusRef.current;
        if (desired?.signature === entry.signature && attempt === 0) {
          window.setTimeout(() => {
            const latest = desiredNativeDriftAlarmStatusRef.current;
            if (latest?.signature === entry.signature) {
              send(entry, 1);
              return;
            }
            pendingNativeDriftAlarmStatusSignatureRef.current = null;
            if (latest) send(latest, 0);
          }, 250);
          return;
        }
        pendingNativeDriftAlarmStatusSignatureRef.current = null;
        if (desired && desired.signature !== entry.signature) send(desired, 0);
      });
    };

    send({ signature, status: nextStatus }, 0);
  }, []);

  const publishDriftAlarmTrayStatus = useCallback((result: DriftAlarmTrayResult, checkedAt: Date | null = new Date(), options?: DriftAlarmTrayPublishOptions) => {
    recordDriftAlarmDebugEvent({
      kind: "tray_status_published",
      trayResult: summarizeDriftAlarmTrayResult(result),
    });

    if (options?.updateRendererState === false) {
      publishNativeDriftAlarmTrayStatus({
        ...buildDriftAlarmTrayStatus({
          enabled: driftAlertsRuntimeEnabled,
          checkedAt,
          result,
          locale: localization.effectiveLanguage,
        }),
        developerDetailsEnabled: isDevModeActive,
        trackerRunning: status?.running ?? null,
      });
      return;
    }

    setDriftAlarmTrayState({ checkedAt, result });
  }, [driftAlertsRuntimeEnabled, isDevModeActive, localization.effectiveLanguage, publishNativeDriftAlarmTrayStatus, status?.running]);
  const driftReminderStateRef = useRef<DriftReminderState | null>(null);
  const segmentsRef = useRef<ActivitySegment[]>([]);
  const petModeBrowserXRuntimeRef = useRef({ busy: false, lastTriggeredAt: 0 });
  const liveDriftAlarmSegmentsRef = useRef<ActivitySegment[]>([]);
  const driftAlarmDayRef = useRef(logicalTodayIsoDate(startOfDayMinutes));
  const driftAlarmBaseSegmentsRef = useRef<ActivitySegment[]>([]);
  const driftAlarmHistorySegmentsRef = useRef<ActivitySegment[]>([]);
  const liveTailRefreshInFlightRef = useRef(false);
  const rendererFocusedRef = useRef(rendererFocused);
  const previousRendererFocusedRef = useRef(rendererFocused);
  const selectedDayRef = useRef(selectedDay);
  const lastRendererInteractionAtRef = useRef(Date.now());
  const aiClassificationInFlightRef = useRef(false);

  const runPetModeLabBrowserTabClose = useCallback(async () => {
    const runtime = petModeBrowserXRuntimeRef.current;
    const now = Date.now();
    if (!canTriggerPetModeBrowserXShortcut(runtime.busy, runtime.lastTriggeredAt, now)) return;

    const target = buildPetModeLabBrowserTabTarget(segmentsRef.current);
    if (!target) {
      setPetModeLabPointerStatus("Exact browser tab X unavailable · no close performed");
      return;
    }

    runtime.busy = true;
    runtime.lastTriggeredAt = now;
    setPetModeLabPointerStatus("Browser X shortcut · approaching exact observed tab");
    try {
      const intervention = await playNativePetModeIntervention(target);
      if (intervention.outcome !== "contacted") {
        setPetModeLabPointerStatus("Exact browser tab X unavailable · no close performed");
        return;
      }
      await applyNativePetModeLabTarget(target);
    } catch {
      setPetModeLabPointerStatus("Browser tab X failed · no close confirmed");
    } finally {
      runtime.busy = false;
    }
  }, []);

  usePetModeBrowserXShortcut({
    enabled: isDevModeActive && petModeEnabled && petModeBrowserXShortcutEnabled,
    onTrigger: () => { void runPetModeLabBrowserTabClose(); },
    onRegistrationError: () => {
      setPetModeBrowserXShortcutEnabled(false);
      setPetModeLabPointerStatus("Browser X shortcut unavailable · key already in use or permission denied");
    },
  });

  useEffect(() => {
    if (isDevModeActive && petModeEnabled) return;
    setPetModeBrowserXShortcutEnabled(false);
  }, [isDevModeActive, petModeEnabled]);

  useEffect(() => () => {
    if (pendingDriftAlarmTransientRefreshRef.current) {
      window.clearTimeout(pendingDriftAlarmTransientRefreshRef.current);
      pendingDriftAlarmTransientRefreshRef.current = 0;
    }
  }, []);

  function clearPendingTransientRefresh() {
    if (!pendingDriftAlarmTransientRefreshRef.current) return;
    window.clearTimeout(pendingDriftAlarmTransientRefreshRef.current);
    pendingDriftAlarmTransientRefreshRef.current = 0;
  }

  function resetDriftAlarmRuntimeForDay(nextAlarmDay: string) {
    unavailableYouTubeDriftAlarmGateRef.current = null;
    driftAlarmDayRef.current = nextAlarmDay;
    automaticCloseReentryRef.current = null;
    pendingExtremeNudgeRef.current = null;
    driftAlarmBaseSegmentsRef.current = [];
    driftAlarmHistorySegmentsRef.current = [];
    liveDriftAlarmSegmentsRef.current = [];
    pendingDriftAlarmGateRef.current = null;
    pendingDriftAlarmGateGenerationRef.current += 1;
    lastEligibleDriftCandidateRef.current = null;
    pendingDriftAlarmTransientRef.current = null;
    lastDriftAlertSegmentRef.current = null;
    driftAlarmReminderRef.current = null;
    driftAlarmSessionProtectionRef.current = null;
    clearPendingTransientRefresh();
  }

  function clearPausedDriftAlarmRuntime() {
    pendingExtremeNudgeRef.current = null;
    if (automaticCloseReentryRef.current) automaticCloseReentryRef.current = { ...automaticCloseReentryRef.current, entry: null };
    pendingDriftAlarmGateRef.current = null;
    pendingDriftAlarmGateGenerationRef.current += 1;
    lastEligibleDriftCandidateRef.current = null;
    pendingDriftAlarmTransientRef.current = null;
    driftAlarmSessionProtectionRef.current = null;
    clearPendingTransientRefresh();
  }

  function currentDriftAlarmDay(): string {
    const nextAlarmDay = logicalTodayIsoDate(startOfDayMinutes);
    if (driftAlarmDayRef.current !== nextAlarmDay) resetDriftAlarmRuntimeForDay(nextAlarmDay);
    return nextAlarmDay;
  }

  function updateDriftAlarmBaseSegments(day: string, nextSegments: ActivitySegment[]) {
    if (day !== currentDriftAlarmDay()) return;
    driftAlarmBaseSegmentsRef.current = nextSegments;
  }

  function updateDriftAlarmHistorySegments(day: string, nextSegments: ActivitySegment[]) {
    if (day !== currentDriftAlarmDay()) return;
    driftAlarmHistorySegmentsRef.current = nextSegments;
  }

  function selectDay(day: string | ((currentDay: string) => string), options?: { userSelected?: boolean }) {
    autoSelectedLatestDayRef.current = true;
    setSelectedDay((currentDay) => {
      const nextDay = typeof day === "function" ? day(currentDay) : day;
      const today = logicalTodayIsoDate(startOfDayMinutes);
      const userSelected = options?.userSelected ?? true;
      userSelectedDayRef.current = userSelected && nextDay !== today;
      automaticDayChoiceTodayRef.current = !userSelected && nextDay !== today ? today : null;
      return nextDay;
    });
  }

  const selectTodayAfterDateRollover = useCallback(() => {
    const currentDay = logicalTodayIsoDate(startOfDayMinutes);
    if (!shouldRollSelectedDayToToday({
      activeTab,
      automaticChoiceToday: automaticDayChoiceTodayRef.current,
      dashPeriod,
      selectedDay,
      today: currentDay,
      userSelected: userSelectedDayRef.current,
    })) return false;

    automaticDayChoiceTodayRef.current = null;
    autoSelectedLatestDayRef.current = true;
    setSelectedDay(currentDay);
    return true;
  }, [activeTab, dashPeriod, selectedDay, startOfDayMinutes]);

  function shiftDashboardPeriod(direction: -1 | 1) {
    if (direction === 1 && !canShiftDashboardForward) return;
    selectDay((currentDay) => shiftDashboardPeriodDay(currentDay, dashPeriod, direction));
  }

  function selectDashboardPeriod(period: "Today" | "Week") {
    if (period === dashPeriod) return;
    const currentTodayDay = logicalTodayIsoDate(startOfDayMinutes);
    const nextSelectedDay = resolveDashboardPeriodAnchorDay(selectedDay, currentTodayDay, period);
    if (nextSelectedDay !== selectedDay) selectDay(nextSelectedDay);
    persistDashboardPeriod(period);
    navigateToTab("dashboard", period);
  }

  function previewDashboardAiUnavailableCase() {
    const previewDay = shiftIsoDate(logicalTodayIsoDate(startOfDayMinutes), -3);
    setDashboardAiUnavailablePreview({ caseId: dashboardAiUnavailablePreviewCase, appliedDay: previewDay });
    selectDay(previewDay);
    navigateToTab("dashboard", "Today");
  }

  function clearDashboardAiUnavailablePreview() {
    setDashboardAiUnavailablePreview(null);
  }

  const clearWatcherRecoveryTimer = useCallback(() => {
    if (watcherRecoveryTimeoutRef.current === 0) return;
    window.clearTimeout(watcherRecoveryTimeoutRef.current);
    watcherRecoveryTimeoutRef.current = 0;
  }, []);

  const clearWatcherEvent = useCallback(() => {
    clearWatcherRecoveryTimer();
    watcherEventRef.current = null;
    setWatcherEvent(null);
  }, [clearWatcherRecoveryTimer]);

  const armWatcherRecoveryTimer = useCallback((eventId: number) => {
    clearWatcherRecoveryTimer();
    watcherRecoveryTimeoutRef.current = window.setTimeout(() => {
      if (watcherEventRef.current?.id !== eventId) return;
      clearWatcherEvent();
      void hideNativeWatcherPeek(`watcherPeek:${eventId}`);
    }, WATCHER_STALE_EVENT_RECOVERY_MS);
  }, [clearWatcherEvent, clearWatcherRecoveryTimer]);

  const showWatcherPeek = useCallback((force = false, reminderThresholdSeconds: number | null = null) => {
    if (status?.running !== true) return;
    if (!force && watcherEventRef.current) return;
    if (watcherRequestInFlightRef.current) return;

    watcherRequestInFlightRef.current = true;

    void (async () => {
      const snapshot = await resolveWatcherSnapshot(segmentsRef.current, reminderThresholdSeconds, {
        fallbackCandidates: segmentsRef.current,
        includeAiClassifications: showAiClassificationImpact,
        includeBuiltInHeuristics: allowBuiltInHeuristics,
        builtInHeuristicsUnavailableSince,
        rules: classificationRules,
      });
      const nextEvent = {
        id: Date.now(),
        ...snapshot,
        slotIndex: 0,
      };
      watcherEventRef.current = nextEvent;
      armWatcherRecoveryTimer(nextEvent.id);

      if (!isTauriRuntime()) {
        setWatcherEvent(nextEvent);
        return;
      }

      await showNativeWatcherPeek(nextEvent).catch(() => {
        clearWatcherEvent();
      });
    })().finally(() => {
      watcherRequestInFlightRef.current = false;
    });
  }, [allowBuiltInHeuristics, armWatcherRecoveryTimer, builtInHeuristicsUnavailableSince, classificationRules, clearWatcherEvent, showAiClassificationImpact, status?.running]);

  const showEndOfDayReview = useCallback(async (event: EndOfDayReviewEvent): Promise<DayReviewDeliveryResult> => {
    if (!event.isMock) presentedEndOfDayReviewDayRef.current = event.day;
    if (!isTauriRuntime()) {
      setEndOfDayReviewEvent(event);
      /* The browser fallback renders into the visible main window, so a
         successful show is already the display. */
      return "displayed";
    }

    try {
      return (await showNativeEndOfDayReview(event)) ?? "failed";
    } catch {
      return "failed";
    }
  }, []);

  const buildEndOfDayReviewEvent = useCallback(async (input: EndOfDayReviewSummaryInput): Promise<EndOfDayReviewEvent> => {
    const currentAppIcons = appIconsRef.current;
    const { assessment: requestedAssessment, ...rawReviewInput } = input;
    const reviewInput = {
      ...rawReviewInput,
      segments: rawReviewInput.segments.filter((segment) => !isFailedForegroundCaptureSegment(segment)),
    };
    const resolveCurrentInput = () => {
      const currentAvailability = classificationAvailabilityRef.current;
      const inferredPendingAssessment = !classificationAssessmentReadyRef.current ? {
        state: "pending",
        route: currentAvailability.route,
        reason: currentAvailability.reason,
        recoveryAction: currentAvailability.recoveryAction,
        cloudQuota: currentAvailability.cloudQuota,
        unavailableSince: builtInHeuristicsUnavailableSinceRef.current,
      } as const : undefined;
      const inferredPendingSeconds = inferredPendingAssessment
        ? sumPendingEndOfDayReviewSeconds(
          reviewInput.segments,
          inferredPendingAssessment.unavailableSince,
          companionFocusRecordClassificationOptions,
        )
        : 0;
      const totalTrackedSeconds = reviewInput.segments.reduce((total, s) => total + s.durationSeconds, 0);
      const isPendingAssessmentMaterial = inferredPendingSeconds > 15 * 60
        && (totalTrackedSeconds === 0 || (inferredPendingSeconds / totalTrackedSeconds) >= 0.2);
      const assessment = requestedAssessment === null
        ? undefined
        : requestedAssessment ?? (isPendingAssessmentMaterial ? inferredPendingAssessment : undefined);
      return { ...reviewInput, assessment };
    };
    const resolvedInput = resolveCurrentInput();
    const baseEvent = buildEndOfDayReviewSummary({ ...resolvedInput, appIcons: currentAppIcons, classificationOptions: companionFocusRecordClassificationOptions });
    const layout = baseEvent.assessment ? "full" as const : "minimal" as const;
    const missingIconRequests = input.isMock ? [] : collectMissingEndOfDayReviewIconRequests(baseEvent);
    if (!isTauriRuntime() || missingIconRequests.length === 0) {
      return { ...baseEvent, layout };
    }

    try {
      const resolvedIcons = await trackerClient.getAppIcons(missingIconRequests);
      // A provider can become unavailable while native icon lookup is in
      // flight. An automatic review may downgrade to pending at this commit
      // boundary, but an explicit Dev preview and an already-pending review
      // keep the assessment they were built with.
      const latestResolvedInput = requestedAssessment === undefined && !resolvedInput.assessment
        ? resolveCurrentInput()
        : resolvedInput;
      return {
        ...buildEndOfDayReviewSummary({
          ...latestResolvedInput,
          appIcons: mergeResolvedAppIcons(currentAppIcons, missingIconRequests, resolvedIcons),
          classificationOptions: companionFocusRecordClassificationOptions,
        }),
        layout: latestResolvedInput.assessment ? "full" : layout,
      };
    } catch {
      const latestResolvedInput = requestedAssessment === undefined && !resolvedInput.assessment
        ? resolveCurrentInput()
        : resolvedInput;
      if (latestResolvedInput === resolvedInput) return { ...baseEvent, layout };
      return {
        ...buildEndOfDayReviewSummary({
          ...latestResolvedInput,
          appIcons: currentAppIcons,
          classificationOptions: companionFocusRecordClassificationOptions,
        }),
        layout: latestResolvedInput.assessment ? "full" : layout,
      };
    }
  }, [companionFocusRecordClassificationOptions]);

  const handleEndOfDayReviewPreview = useCallback(() => {
    if (!END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED) return;
    if (!isDevModeActive) return;
    const previewSegments = segments.length > 0 ? segments : buildMockEndOfDayReviewSegments(selectedDay);
    void buildEndOfDayReviewEvent({
      day: selectedDay,
      generatedAt: new Date().toISOString(),
      segments: previewSegments,
      assessment: null,
      isMock: true,
    }).then(showEndOfDayReview);
  }, [buildEndOfDayReviewEvent, isDevModeActive, segments, selectedDay, showEndOfDayReview]);

  const recordDriftInteraction = useCallback((interaction: DriftAlarmInteraction) => {
    setDriftAlarmInteractions(recordDriftAlarmInteraction(interaction));
  }, []);

  const recordDriftAlarmShown = useCallback((event: DriftAlarmEvent) => {
    const alreadyRecorded = readDriftAlarmInteractions().some(
      (entry) => entry.kind === "shown" && entry.alarmId === event.id,
    );
    if (alreadyRecorded) return;
    recordDriftInteraction({
      kind: "shown",
      alarmId: event.id,
      mode: event.mode,
      shownAt: new Date().toISOString(),
      driftDurationSeconds: event.driftDurationSeconds,
    });
  }, [recordDriftInteraction]);

  const recordBreakRecoveryOutcome = useCallback((attempt: DriftAlarmBreakSnooze, outcome: BreakRecoveryOutcome) => {
    recordDriftInteraction({
      kind: "break_outcome",
      alarmId: attempt.alarmId,
      attemptId: attempt.attemptId,
      minutes: attempt.minutes,
      outcome,
      sourceLabel: attempt.source.label,
      resolvedAt: new Date().toISOString(),
    });
  }, [recordDriftInteraction]);

  const clearDriftAlarmEvent = useCallback(() => {
    driftAlarmEventRef.current = null;
    pendingDriftAlarmEventRef.current = null;
    setDriftAlarmEvent(null);
  }, []);

  const showDriftAlarm = useCallback((event: DriftAlarmEvent) => {
    const delivery = summarizeDriftAlarmEvent(event);
    const currentEvent = driftAlarmEventRef.current;
    if (currentEvent?.id === event.id && !hasDriftAlarmFocusTargetUpdate(currentEvent, event)) {
      recordDriftAlarmDebugEvent({
        kind: "native_show_duplicate",
        alertKey: event.id,
        delivery,
      });
      return;
    }
    if (driftAlarmRequestInFlightRef.current) {
      pendingDriftAlarmEventRef.current = event;
      recordDriftAlarmDebugEvent({
        kind: "native_show_queued",
        alertKey: event.id,
        delivery,
      });
      return;
    }

    driftAlarmEventRef.current = event;
    lastDriftAlarmEventRef.current = event;
    lastExtremeNudgeToastEventRef.current = null;

    if (!isTauriRuntime()) {
      setDriftAlarmEvent(event);
      recordDriftAlarmShown(event);
      recordDriftAlarmDebugEvent({
        kind: "renderer_show_non_tauri",
        alertKey: event.id,
        delivery,
      });
      return;
    }

    driftAlarmRequestInFlightRef.current = true;
    recordDriftAlarmDebugEvent({
      kind: "native_show_requested",
      alertKey: event.id,
      delivery,
    });
    void showNativeCompanionDriftAlarm(event).then(() => {
      recordDriftAlarmDebugEvent({
        kind: "native_show_succeeded",
        alertKey: event.id,
        delivery,
      });
      recordDriftAlarmShown(event);
    }).catch((error: unknown) => {
      recordDriftAlarmDebugEvent({
        kind: "native_show_failed",
        alertKey: event.id,
        message: toErrorMessage(error),
        delivery,
      });
      if (driftAlarmEventRef.current?.id === event.id) clearDriftAlarmEvent();
      /* The card is the primary surface; when it cannot be shown, the host OS carries
         the alert instead. Two limits keep that from becoming noise: a user who
         already receives every card as a notification has been told, and a
         Companion window that keeps failing must not repeat the notification on
         every reminder for the same alert. */
      if (event.mode === "drift"
        && !macosNotificationEnabledRef.current
        && cardFailureNotifiedAlertKeyRef.current !== event.id) {
        cardFailureNotifiedAlertKeyRef.current = event.id;
        recordDriftAlarmDebugEvent({ kind: "native_notification_requested", alertKey: event.id, message: "card_failed", delivery });
        const { copy, language } = driftNotificationCopyRef.current;
        void sendDriftNotification(
          { place: event.sourceSiteDomain ?? event.sourceAppName, driftDurationSeconds: event.driftDurationSeconds },
          copy,
          language,
        ).catch((notificationError: unknown) => {
          recordDriftAlarmDebugEvent({
            kind: "native_notification_failed",
            alertKey: event.id,
            message: toErrorMessage(notificationError),
            delivery,
          });
        });
      }
    }).finally(() => {
      driftAlarmRequestInFlightRef.current = false;
      const pendingEvent = pendingDriftAlarmEventRef.current;
      pendingDriftAlarmEventRef.current = null;
      if (pendingEvent) showDriftAlarm(pendingEvent);
    });
  }, [clearDriftAlarmEvent, recordDriftAlarmShown]);

  const previewCompanionMilestone = useCallback((previewId: CompanionMilestonePreviewId) => {
    void showNativeCompanionMilestone(buildCompanionMilestonePreview(previewId, Date.now(), companionTranslate))
      .catch((error: unknown) => {
        console.warn("Failed to preview companion milestone", toErrorMessage(error));
      });
  }, [companionTranslate]);

  /* The decision cards could not be reviewed without waiting for real drift, so
     they are fired through the same native path the tracker uses. */
  const previewCompanionMoment = useCallback((previewId: CompanionMomentPreviewId) => {
    const sent = previewId === "extreme-nudge"
      ? showNativeExtremeNudgeToast(buildCompanionExtremeNudgePreview(Date.now(), { copySettings: driftAlarmCopy, language: companionLanguage }))
      : showNativeCompanionDriftAlarm(buildCompanionDriftAlarmPreview(previewId, Date.now(), false, { copySettings: driftAlarmCopy, language: companionLanguage }));
    void sent.catch((error: unknown) => {
      console.warn("Failed to preview companion moment", toErrorMessage(error));
    });
  }, [companionLanguage, driftAlarmCopy]);

  /* The caught-cat card differs from the ordinary drift card only in its copy,
     so it needs its own preview to be reviewable at all. */
  const previewPetInterceptCard = useCallback(() => {
    const alarm = buildCompanionDriftAlarmPreview("drift-alarm", Date.now(), true, { copySettings: driftAlarmCopy, language: companionLanguage });
    const sent = showNativeCompanionDriftAlarm(alarm);
    void sent.catch((error: unknown) => {
      console.warn("Failed to preview pet intercept card", toErrorMessage(error));
    });
  }, [companionLanguage, driftAlarmCopy]);

  const handleWatcherResponse = useCallback((response: WatcherPeekResponse) => {
    const currentEvent = watcherEventRef.current;
    if (!currentEvent) return;

    clearWatcherRecoveryTimer();
    watcherEventRef.current = null;
    persistWatcherResponse(currentEvent, response);
    setWatcherEvent(null);
  }, [clearWatcherRecoveryTimer]);

  const dismissDriftAlarm = useCallback(() => {
    clearDriftAlarmEvent();
  }, [clearDriftAlarmEvent]);

  const recordCurrentDriftAlarmDismiss = useCallback(() => {
    const currentAlarmEvent = driftAlarmEventRef.current;
    if (!currentAlarmEvent) return;

    recordDriftInteraction({
      kind: "action",
      alarmId: currentAlarmEvent.id,
      mode: currentAlarmEvent.mode,
      action: "dismiss",
      actedAt: new Date().toISOString(),
    });
  }, [recordDriftInteraction]);

  const handleDriftAlarmDismissed = useCallback((momentKey?: string | null) => {
    if (momentKey && momentKey !== `driftAlarm:${driftAlarmEventRef.current?.id}`) return;
    recordCurrentDriftAlarmDismiss();
    clearDriftAlarmEvent();
  }, [clearDriftAlarmEvent, recordCurrentDriftAlarmDismiss]);

  const cancelDriftAlarm = useCallback(() => {
    recordCurrentDriftAlarmDismiss();
    dismissDriftAlarm();
  }, [dismissDriftAlarm, recordCurrentDriftAlarmDismiss]);

  const presentDriftAlarmCorrectionStatus = useCallback(({
    event,
    extremeNudgeEvent,
    status,
  }: {
    event: DriftAlarmEvent;
    extremeNudgeEvent: ExtremeNudgeToastEvent | null;
    status: DriftAlarmCorrectionStatus;
  }): Promise<void> => {
    const nextEvent: DriftAlarmEvent = { ...event, correctionStatus: status };
    lastDriftAlarmEventRef.current = nextEvent;
    driftAlarmEventRef.current = null;

    if (!isTauriRuntime()) {
      setDriftAlarmEvent(nextEvent);
      return Promise.resolve();
    }

    if (extremeNudgeEvent) {
      const nextToastEvent: ExtremeNudgeToastEvent = { ...extremeNudgeEvent, correctionStatus: status };
      lastExtremeNudgeToastEventRef.current = nextToastEvent;
      return showNativeExtremeNudgeToast(nextToastEvent).then(() => undefined);
    }

    return showNativeCompanionDriftAlarm(nextEvent).then(() => undefined);
  }, []);

  async function applyDriftAlarmManualCorrection(event: DriftAlarmEvent | null): Promise<void> {
    pendingExtremeNudgeRef.current = null;
    pendingDriftAlarmGateRef.current = null;
    pendingDriftAlarmGateGenerationRef.current += 1;
    if (automaticCloseReentryRef.current) automaticCloseReentryRef.current = { ...automaticCloseReentryRef.current, entry: null };
    const sourceSegmentId = event?.sourceSegmentId?.trim();
    if (!sourceSegmentId) {
      recordDriftAlarmDebugEvent({
        kind: "manual_correction_failed",
        alertKey: event?.id ?? null,
        reason: "source_segment_id_missing",
        delivery: event ? summarizeDriftAlarmEvent(event) : null,
      });
      throw new Error("source_segment_id_missing");
    }

    const sourceSegment = segmentsRef.current.find((segment) => segment.id === sourceSegmentId)
      ?? driftAlarmSourceSegmentsRef.current.get(sourceSegmentId)
      ?? null;
    if (!sourceSegment) {
      recordDriftAlarmDebugEvent({
        kind: "manual_correction_failed",
        alertKey: event?.id ?? null,
        reason: "source_segment_missing",
        delivery: event ? summarizeDriftAlarmEvent(event) : null,
      });
      throw new Error("source_segment_missing");
    }

    // The correction's durable writes can involve multiple tracker round trips.
    // Arm the temporary guard first so the next poll cannot close another item
    // on the same surface while those writes are still in flight. The guard
    // intentionally preserves the user's intent even if persistence later fails.
    driftAlarmSessionProtectionRef.current = armDriftAlarmSessionProtection(
      driftAlarmSessionProtectionRef.current,
      sourceSegment,
      Date.now(),
    );
    // "Not a drift" ends the conversation about this episode; no reminder.
    driftAlarmReminderRef.current = null;

    await trackerClient.saveClassifications([
      buildDriftAlarmManualCorrectionRecord({
        classifiedAt: new Date().toISOString(),
        classificationOptions: selectedDayClassificationOptions,
        segment: sourceSegment,
      }),
    ]);

    const ruleInput = buildDriftAlarmManualCorrectionRuleInput({
      classificationOptions: selectedDayClassificationOptions,
      segment: sourceSegment,
    });
    if (!ruleInput) throw new Error("classification_rule_target_missing");
    const ruleSaved = await saveClassificationRule(ruleInput);
    if (!ruleSaved) throw new Error("classification_rule_save_failed");

    const correctedRecord = buildDriftAlarmManualCorrectionRecord({
      classifiedAt: new Date().toISOString(),
      classificationOptions: selectedDayClassificationOptions,
      segment: sourceSegment,
    });
    const feedback = {
      kind: "not_drift" as const,
      segment: sourceSegment,
      correctedCategory: correctedRecord.category,
      correctedProductivity: "neutral" as const,
      occurredAt: correctedRecord.classifiedAt ?? new Date().toISOString(),
    };
    await captureCorrectionEvidence({
      feedback,
      correctionScope: "alarm",
      contextSegments: segmentsRef.current,
      classificationOptions: selectedDayClassificationOptions,
      predictionBeforeFeedback: event?.decisionClassification,
    }).catch((error) => console.warn("Unable to capture Not a drift evidence.", error));
    void learnLivingSoulFromFeedback({
      feedback,
      contextSegments: segmentsRef.current,
      provider: currentSoulLearningProvider(selectedLocalAiClassificationOptions, canUseSelectedCloudAiClassification),
    }).catch((error) => console.warn("Unable to learn from Not a drift feedback.", error));

    driftAlarmSourceSegmentsRef.current.delete(sourceSegmentId);
    await refresh(selectedDayRef.current);
  }

  const returnToFocusTarget = useCallback((target: DriftAlarmFocusTarget | null) => {
    if (target?.siteDomain) {
      void activateFocusTargetSite(target).catch((error) => console.warn("Failed to activate focus target site", error));
      return;
    }
    if (target?.bundleId && isTauriRuntime()) {
      void invoke("focus_target_open_app", { bundleId: target.bundleId }).catch((error) => console.warn("Failed to open focus target app", error));
      return;
    }
    navigateToTab("dashboard");
  }, [navigateToTab]);

  const handleDriftAlarmAction = useCallback((action: DriftAlarmAction, momentKey?: string | null) => {
    const currentAlarmEvent = driftAlarmEventRef.current ?? lastDriftAlarmEventRef.current;
    if (momentKey && momentKey !== `driftAlarm:${currentAlarmEvent?.id}`
      && momentKey !== `extremeNudgeToast:${lastExtremeNudgeToastEventRef.current?.id}`) {
      // Navigation from a preview remains useful; an obsolete card must never
      // correct, snooze, or dismiss the main window's newer alarm.
      if (action.type === "settings") {
        setSettingsSection("notifications");
        navigateToTab("settings");
      }
      return;
    }
    if (currentAlarmEvent) {
      const actedAt = new Date().toISOString();
      const interaction: DriftAlarmInteraction = action.type === "start_break"
        ? {
          kind: "action",
          alarmId: currentAlarmEvent.id,
          mode: currentAlarmEvent.mode,
          action: action.type,
          minutes: action.minutes,
          actedAt,
        }
        : {
          kind: "action",
          alarmId: currentAlarmEvent.id,
          mode: currentAlarmEvent.mode,
          action: action.type,
          actedAt,
        };
      recordDriftInteraction(interaction);
    }
    if (action.type !== "manual_correction") dismissDriftAlarm();

    switch (action.type) {
      case "settings":
        setSettingsSection("notifications");
        navigateToTab("settings");
        return;
      case "manual_correction":
        if (!currentAlarmEvent) return;
        {
          const extremeNudgeEvent = lastExtremeNudgeToastEventRef.current;
          void presentDriftAlarmCorrectionStatus({
            event: currentAlarmEvent,
            extremeNudgeEvent,
            status: "acknowledged",
          }).catch((error: unknown) => {
            console.warn("Failed to present drift alarm correction acknowledgement", toErrorMessage(error));
          });
          void applyDriftAlarmManualCorrection(currentAlarmEvent).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.warn("Failed to save drift alarm manual correction", message);
            /* A correction failure is diagnostic, not a new decision for the
               user. The panel already owns its short acknowledgement timer,
               so leave its lifecycle alone rather than letting a late write
               failure hide a newer, unrelated Companion moment. */
            if (lastDriftAlarmEventRef.current?.id === currentAlarmEvent.id) {
              lastDriftAlarmEventRef.current = null;
            }
            if (lastExtremeNudgeToastEventRef.current?.id === extremeNudgeEvent?.id) {
              lastExtremeNudgeToastEventRef.current = null;
            }
          });
        }
        return;
      case "return_to_focus": {
        const target = currentAlarmEvent?.focusTargets.find((focusTarget) => focusTarget.targetId === action.targetId) ?? null;
        returnToFocusTarget(target);
        return;
      }
      case "start_break": {
        if (!currentAlarmEvent) return;
        const attempt = buildBreakRecoveryAttempt({
          action,
          event: currentAlarmEvent,
          segments: segmentsRef.current,
          classificationOptions: selectedDayClassificationOptions,
          startedAtMs: Date.now(),
        });
        const nextSnooze = buildBreakSnooze({ attempt, event: currentAlarmEvent });
        pendingBreakReturnAlarmRef.current = null;
        breakRecoveryAssessmentRef.current = null;
        // An explicit break starts a new intervention cycle at expiry. Do not
        // carry a catch grace across the break the user deliberately chose.
        petInterceptionGraceRef.current = null;
        driftAlarmReminderRef.current = null;
        pendingExtremeNudgeRef.current = null;
        pendingDriftAlarmGateRef.current = null;
        pendingDriftAlarmGateGenerationRef.current += 1;
        if (automaticCloseReentryRef.current) automaticCloseReentryRef.current = { ...automaticCloseReentryRef.current, entry: null };
        driftAlarmSnoozeRef.current = nextSnooze;
        setBreakRecoveryAssessment(null);
        setDriftAlarmSnooze(nextSnooze);
        return;
      }
    }
  }, [dismissDriftAlarm, navigateToTab, presentDriftAlarmCorrectionStatus, recordDriftInteraction, returnToFocusTarget, selectedDayClassificationOptions]);

  const dismissWatcherPeek = useCallback((momentKey?: string | null) => {
    const event = watcherEventRef.current;
    if (momentKey && momentKey !== `watcherPeek:${event?.id}`) return;
    clearWatcherEvent();
    if (event) void hideNativeWatcherPeek(`watcherPeek:${event.id}`);
  }, [clearWatcherEvent]);

  async function refresh(day = selectedDay, options: { requireCurrentSnapshot?: boolean; foreground?: boolean } = {}): Promise<boolean> {
    const isRequiredCurrentSnapshotRefresh = options.requireCurrentSnapshot === true;
    const isForegroundRefresh = options.foreground !== false || isRequiredCurrentSnapshotRefresh;
    if (!isRequiredCurrentSnapshotRefresh && requiredCurrentSnapshotRefreshInFlightRef.current) return false;

    if (shouldBlockLocalTrackerAccess) {
      refreshRequestRef.current += 1;
      historyRefreshRequestRef.current += 1;
      setLoading(false);
      setError(null);
      return false;
    }

    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    const trackerMutationGeneration = trackerMutationGenerationRef.current;
    historyRefreshRequestRef.current += 1;
    if (isRequiredCurrentSnapshotRefresh) requiredCurrentSnapshotRefreshInFlightRef.current = true;
    // The live snapshot is a fresh capture of the frontmost app (several
    // osascript round trips), usually the slowest request here. Only a
    // required refresh hands its caller the day and the snapshot together;
    // any other foreground refresh paints the day first and applies the
    // snapshot when it lands (see the end of the try block below).
    const defersCurrentSnapshot = isForegroundRefresh && !isRequiredCurrentSnapshotRefresh;
    let deferredCurrentSnapshotPending = defersCurrentSnapshot;
    if (defersCurrentSnapshot) deferredCurrentSnapshotRequestRef.current = requestId;
    // Only the newest deferring refresh releases the sidebar placeholder, so an
    // older capture settling first cannot expose the day's top app meanwhile.
    const settleDeferredCurrentSnapshot = () => {
      deferredCurrentSnapshotPending = false;
      if (deferredCurrentSnapshotRequestRef.current !== requestId) return;
      deferredCurrentSnapshotRequestRef.current = null;
      setAwaitingFirstCurrentSnapshot(false);
    };
    if (isForegroundRefresh) setLoading(true);
    setError(null);

    const {
      historySummaryRange,
      historyTimelineRange,
      selectedDayRange,
      shouldLoadDashboardWeekHistory,
      shouldLoadHistory,
      shouldLoadHistorySummaries,
    } = buildActivityRefreshPlan({
      activeTab,
      dashPeriod,
      day,
      // Before the first day load finishes, a dashboard Week load here is
      // always wasted: clearLocalActivityCaches runs at mount and again when
      // the classification rules arrive, so its result never reaches the
      // cache. Leave it to the history effect, which asks after that load.
      shouldLoadHistory: isForegroundRefresh
        && !(isDashboardWeekView && !hasLoadedOnce)
        && shouldRefreshHistoryData(activeTab, dashPeriod, classificationRange),
      startOfDayMinutes,
      startOfWeek,
      trendsRange,
    });
    const shouldLoadCompactHistory = shouldLoadDashboardWeekHistory || (shouldLoadHistory && activeTab === "trends" && trendsRange === "Week");
    const trendsRecentWeekRange = shouldLoadHistory && activeTab === "trends" && trendsRange !== "Week"
      ? getInsightPeriodRange(day, "Week", startOfDayMinutes)
      : null;
    const dashboardWeekRefreshKey = shouldLoadDashboardWeekHistory ? compactHistoryRangeKey(historyTimelineRange) : null;
    if (dashboardWeekRefreshKey && !findFreshCompactHistoryLoad(compactHistoryCacheRef.current, historyTimelineRange)) {
      setDashboardWeekRefreshState({ key: dashboardWeekRefreshKey, status: "loading" });
    }

    try {
      const archiveTimelineRequest: Promise<{
        readonly hasMore: boolean;
        readonly loadedRange: DashboardHistoryRange;
        readonly materialized: BuiltInHeuristicClassificationMaterialization;
        readonly nextCursor: TimelinePageCursor | null;
      } | null> = shouldLoadHistory
        ? activeTab === "history"
          ? trackerClient.getTimelinePage({ ...historyTimelineRange, limit: HISTORY_TIMELINE_PAGE_SIZE }).then((page) => ({
              hasMore: page.hasMore,
              loadedRange: historyTimelineRange,
              materialized: materializeBuiltInHeuristicTimeline(page.items),
              nextCursor: page.nextCursor,
            }))
          : shouldLoadCompactHistory
            ? loadCompactHistoryRange(historyTimelineRange).then((load) => ({
                hasMore: false,
                loadedRange: historyTimelineRange,
                materialized: load.materialized,
                nextCursor: null,
              }))
            : trackerClient.getTimeline(historyTimelineRange).then((timeline) => ({
                hasMore: false,
                loadedRange: historyTimelineRange,
                materialized: materializeBuiltInHeuristicTimeline(timeline),
                nextCursor: null,
              }))
        : Promise.resolve(null);
      const trendsRecentWeekRequest = trendsRecentWeekRange
        ? loadCompactHistoryRange({ start: trendsRecentWeekRange.start, end: trendsRecentWeekRange.end }).catch(() => null)
        : Promise.resolve(null);
      const historyHourlySummaryRequest = shouldLoadHistorySummaries
        ? trackerClient.getHourlySummary(historySummaryRange)
        : Promise.resolve<HourBucket[] | null>(null);
      const historySiteSummaryRequest = shouldLoadHistorySummaries
        ? trackerClient.getTopSites({ ...historySummaryRange, limit: 8 })
        : Promise.resolve<SiteDuration[] | null>(null);

      const statusRequest = isForegroundRefresh
        ? trackerClient.getStatus().then((nextStatus) => {
          if (
            refreshRequestRef.current !== requestId
            || trackerMutationGenerationRef.current !== trackerMutationGeneration
          ) return nextStatus;
          setStatus(nextStatus);
          setAccessibilityGranted(nextStatus.accessibilityGranted);
          return nextStatus;
        })
        : Promise.resolve(status);

      const currentSnapshotRequest = isForegroundRefresh
        ? statusRequest.then((nextStatus) => {
            if (
              refreshRequestRef.current !== requestId
              || trackerMutationGenerationRef.current !== trackerMutationGeneration
            ) return null;
            if (!nextStatus?.running) return null;
            return isRequiredCurrentSnapshotRefresh && hostPlatform !== "windows"
              ? trackerClient.getCurrentSnapshot()
              : trackerClient.getCurrentSnapshot().catch(() => null);
          })
        : Promise.resolve(currentSnapshot);
      if (defersCurrentSnapshot) void currentSnapshotRequest.catch(() => undefined);

      const [timeline, archiveTimelineLoad, historyHourlySummary, historySiteSummary, nextCurrentSnapshot, nextClassificationMetrics, nextAiClassificationUsage] = await Promise.all([
        trackerClient.getTimeline(selectedDayRange),
        archiveTimelineRequest,
        historyHourlySummaryRequest,
        historySiteSummaryRequest,
        defersCurrentSnapshot ? Promise.resolve(null) : currentSnapshotRequest,
        loadClassificationMetrics(day),
        loadAiClassificationUsage(day),
        trendsRecentWeekRequest,
        statusRequest,
      ]);

      if (refreshRequestRef.current !== requestId) return false;
      lastFullDayRefreshAtRef.current = Date.now();

      const materializedTimeline = materializeBuiltInHeuristicTimeline(timeline);
      const materializedArchiveTimelines = archiveTimelineLoad?.materialized ?? null;
      const alarmDay = currentDriftAlarmDay();
      const isAlarmDayRefresh = day === alarmDay;

      if (
        isForegroundRefresh
        && !defersCurrentSnapshot
        && trackerMutationGenerationRef.current === trackerMutationGeneration
      ) {
        setCurrentSnapshot(nextCurrentSnapshot);
        setAwaitingFirstCurrentSnapshot(false);
      }
      if (isAlarmDayRefresh) {
        liveDriftAlarmTimelineUnavailableRef.current = false;
        liveDriftAlarmSegmentsRef.current = [];
        updateDriftAlarmBaseSegments(day, materializedTimeline.segments);
        if (materializedArchiveTimelines !== null) {
          updateDriftAlarmHistorySegments(day, materializedArchiveTimelines.segments);
        }
      }
      setSegments(materializedTimeline.segments);
      setSegmentsLoadedDay(day);
      if (archiveTimelineLoad !== null && !shouldLoadDashboardWeekHistory) {
        setHistorySegments(archiveTimelineLoad.materialized.segments);
        setHistorySegmentsLoadedRange(archiveTimelineLoad.loadedRange);
        setHistoryNextCursor(archiveTimelineLoad.nextCursor);
        setHistoryHasMoreSegments(archiveTimelineLoad.hasMore);
        setHistoryLoadingMore(false);
        setHistoryLoadMoreError(null);
      }
      if (dashboardWeekRefreshKey) setDashboardWeekRefreshState({ key: dashboardWeekRefreshKey, status: "idle" });
      setHourly(buildHourlySummary(materializedTimeline.segments));
      if (historyHourlySummary !== null) setInsightHourly(historyHourlySummary);
      if (historySiteSummary !== null) setInsightTopSites(historySiteSummary);
      setClassificationMetrics(nextClassificationMetrics);
      setAiClassificationUsage(nextAiClassificationUsage);
      setAiClassificationUsageDay(nextAiClassificationUsage ? day : null);
      scheduleAvailableBuiltInHeuristicPersistence([
        ...materializedTimeline.classifications,
        ...(materializedArchiveTimelines?.classifications ?? []),
      ]);

      void (async () => {
        try {
          const hourlySummary = await trackerClient.getHourlySummary(selectedDayRange);
          if (refreshRequestRef.current !== requestId) return;
          setHourly(hourlySummary.length > 0 ? hourlySummary : buildHourlySummary(materializedTimeline.segments));
        } catch {
          if (refreshRequestRef.current !== requestId) return;
        }
      })();

      loadMissingAppIcons({
        segments: materializedArchiveTimelines === null
          ? materializedTimeline.segments
          : [...materializedTimeline.segments, ...materializedArchiveTimelines.segments],
        shouldReportFailure: () => refreshRequestRef.current === requestId,
        failureMessage: "Failed to load dashboard app icons",
      });
      loadMissingSiteIcons(materializedArchiveTimelines === null
        ? materializedTimeline.segments
        : [...materializedTimeline.segments, ...materializedArchiveTimelines.segments]);
      if (defersCurrentSnapshot) {
        // The snapshot now settles on its own; finally must not settle it.
        deferredCurrentSnapshotPending = false;
        // Same guards the combined update used: a newer refresh or a tracker
        // start/pause since this request owns the snapshot now.
        void currentSnapshotRequest.then((deferredSnapshot) => {
          if (
            refreshRequestRef.current === requestId
            && trackerMutationGenerationRef.current === trackerMutationGeneration
          ) {
            setCurrentSnapshot(deferredSnapshot);
          }
          settleDeferredCurrentSnapshot();
        }, settleDeferredCurrentSnapshot);
      }
      return true;
    } catch (nextError) {
      if (refreshRequestRef.current !== requestId) return false;
      const message = toErrorMessage(nextError);
      if (dashboardWeekRefreshKey) setDashboardWeekRefreshState({ key: dashboardWeekRefreshKey, status: "error" });
      setError(message);
      return false;
    } finally {
      // A refresh that failed or was superseded before applying its day never
      // attaches its snapshot; release the placeholder as main's fallback would.
      if (deferredCurrentSnapshotPending) settleDeferredCurrentSnapshot();
      if (isRequiredCurrentSnapshotRefresh) {
        requiredCurrentSnapshotRefreshInFlightRef.current = false;
      }
      if (refreshRequestRef.current === requestId) {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }
  function startClassificationCorrection(scope: ClassificationCorrectionScope, rowId: string | null = null) {
    const sourceRow = rowId ? classificationActivityRows.find((row) => row.id === rowId) ?? null : null;
    // A row we could not name has no title or URL to write a rule about, so its
    // pencil edits the captured records instead of promising a future rule.
    const effectiveScope = classificationCorrectionScopeForRow(scope, sourceRow);
    if (classificationCorrectionDraft?.scope === effectiveScope && classificationCorrectionDraft.rowId === rowId) {
      setClassificationCorrectionDraft(null);
      setClassificationCorrectionNotice(null);
      return;
    }
    const sourceSegment = sourceRow?.segments[0]
      ?? (rowId ? null : classificationActivityRows[0]?.segments[0] ?? classificationSourceSegments.find((segment) => classifySegmentSourceKey(segment) === effectiveClassifySourceId) ?? null);
    if (!sourceSegment) return;
    const draft = buildClassificationCorrectionDraft({
      rowId,
      scope: effectiveScope,
      segment: sourceSegment,
      classificationOptions,
      displayLabel: sourceRow?.label ?? selectedClassificationSourceSummary?.label ?? null,
    });
    if (!draft) return;
    setClassificationCorrectionNotice(null);
    setClassificationCorrectionDraft(draft);
    if (effectiveScope !== "surface" && rowId) {
      setExpandedClassificationActivityRows((current) => {
        const next = new Set(current);
        next.add(rowId);
        return next;
      });
    }
  }

  function updateClassificationCorrectionDraft(next: Partial<Pick<ClassificationCorrectionDraft, "category" | "productivity">>) {
    setClassificationCorrectionNotice(null);
    setClassificationCorrectionDraft((current) => current ? { ...current, ...next } : current);
  }

  async function saveClassificationCorrection() {
    const draft = classificationCorrectionDraft;
    if (!draft || classificationCorrectionSaving) return;

    setClassificationCorrectionNotice(null);
    setClassificationCorrectionSaving(true);
    try {
      if (draft.scope === "records") {
        const row = draft.rowId ? classificationActivityRows.find((item) => item.id === draft.rowId) ?? null : null;
        const saved = row
          ? await persistUnidentifiedRecordsCorrection(draft, row.segments, { saveClassifications: trackerClient.saveClassifications })
          : false;
        if (!saved) {
          setClassificationCorrectionNotice({ kind: "error", message: localization.t("classification.correction.saveError") });
          return;
        }
        // Nothing is taught to the soul here on purpose: these captures carry no
        // title, so they are not an example of anything.
        setClassificationCorrectionDraft(null);
        setClassificationCorrectionNotice({
          kind: "success",
          message: localization.t("classification.correction.savedRecords", { count: row?.segments.length ?? 0 }),
        });
        clearLocalActivityCaches();
        await refresh(selectedDayRef.current);
        return;
      }

      let feedbackSegment: ActivitySegment | null = null;
      if (draft.scope === "detail" && draft.rowId) {
        const row = classificationActivityRows.find((item) => item.id === draft.rowId) ?? null;
        if (row && row.segments.length > 0) {
          feedbackSegment = row.segments[row.segments.length - 1] ?? null;
        }
      } else {
        feedbackSegment = [...segmentsRef.current].reverse().find((segment) => (
          draft.targetKind === "site"
            ? segment.siteDomain?.trim().toLocaleLowerCase() === draft.targetValue.trim().toLocaleLowerCase()
            : (segment.bundleId?.trim() || segment.appName.trim()).toLocaleLowerCase() === draft.targetValue.trim().toLocaleLowerCase()
        )) ?? null;
      }

      const saved = await persistClassificationCorrection(draft, {
        saveRule: saveClassificationRule,
      });
      if (!saved) {
        setClassificationCorrectionNotice({ kind: "error", message: localization.t("classification.correction.saveError") });
        return;
      }

      if (feedbackSegment) {
        const feedback = {
          kind: "manual_correction" as const,
          segment: feedbackSegment,
          correctedCategory: draft.category,
          correctedProductivity: draft.productivity,
          occurredAt: new Date().toISOString(),
        };
        await captureCorrectionEvidence({
          feedback,
          correctionScope: draft.scope,
          contextSegments: segmentsRef.current,
          classificationOptions,
        }).catch((error) => console.warn("Unable to capture classification correction evidence.", error));
        void learnLivingSoulFromFeedback({
          feedback,
          contextSegments: segmentsRef.current,
          provider: currentSoulLearningProvider(selectedLocalAiClassificationOptions, canUseSelectedCloudAiClassification),
        }).catch((error) => console.warn("Unable to learn from classification correction.", error));
      }
      setClassificationCorrectionDraft(null);
      setClassificationCorrectionNotice({
        kind: "success",
        message: localization.t("classification.correction.savedAlways"),
      });
      clearLocalActivityCaches();
      await refresh(selectedDayRef.current);
    } catch (nextError) {
      console.warn("Unable to finish classification correction.", toErrorMessage(nextError));
      setClassificationCorrectionNotice({
        kind: "error",
        message: localization.t("classification.correction.saveError"),
      });
    } finally {
      setClassificationCorrectionSaving(false);
    }
  }

  async function refreshHistoryData(day = selectedDay): Promise<boolean> {
    if (shouldBlockLocalTrackerAccess) {
      historyRefreshRequestRef.current += 1;
      setHistoryLoadingMore(false);
      return false;
    }

    const shouldLoadHistory = shouldRefreshHistoryData(activeTab, dashPeriod, classificationRange);
    if (!shouldLoadHistory) {
      historyRefreshRequestRef.current += 1;
      setHistoryLoadingMore(false);
      return false;
    }

    const requestId = historyRefreshRequestRef.current + 1;
    historyRefreshRequestRef.current = requestId;
    setHistoryLoadingMore(false);
    setError(null);

    const {
      historySummaryRange,
      historyTimelineRange,
      shouldLoadDashboardWeekHistory,
      shouldLoadHistorySummaries,
    } = buildActivityRefreshPlan({
      activeTab,
      dashPeriod,
      day,
      shouldLoadHistory,
      startOfDayMinutes,
      startOfWeek,
      trendsRange,
    });
    const shouldLoadCompactHistory = shouldLoadDashboardWeekHistory || (activeTab === "trends" && trendsRange === "Week");
    const dashboardWeekRefreshKey = shouldLoadDashboardWeekHistory ? compactHistoryRangeKey(historyTimelineRange) : null;
    if (dashboardWeekRefreshKey && !findFreshCompactHistoryLoad(compactHistoryCacheRef.current, historyTimelineRange)) {
      setDashboardWeekRefreshState({ key: dashboardWeekRefreshKey, status: "loading" });
    }
    const loadMissingHistoryIcons = (segmentsToInspect: readonly ActivitySegment[]) => {
      loadMissingAppIcons({
        segments: segmentsToInspect,
        shouldReportFailure: () => historyRefreshRequestRef.current === requestId,
        failureMessage: "Failed to load history app icons",
      });
      loadMissingSiteIcons(segmentsToInspect);
    };

    try {
      if (activeTab === "history") {
        const timelinePage = await trackerClient.getTimelinePage({
          ...historyTimelineRange,
          limit: HISTORY_TIMELINE_PAGE_SIZE,
        });
        const materializedRecentTimeline = materializeBuiltInHeuristicTimeline(timelinePage.items);

        if (historyRefreshRequestRef.current !== requestId) return false;

        setHistorySegments(materializedRecentTimeline.segments);
        setHistorySegmentsLoadedRange(historyTimelineRange);
        setHistoryNextCursor(timelinePage.nextCursor);
        setHistoryHasMoreSegments(timelinePage.hasMore);
        setHistoryLoadMoreError(null);
        scheduleAvailableBuiltInHeuristicPersistence(materializedRecentTimeline.classifications);
        loadMissingHistoryIcons(materializedRecentTimeline.segments);

        void (async () => {
          try {
            const [historyHourlySummary, historySiteSummary] = await Promise.all([
              shouldLoadHistorySummaries
                ? trackerClient.getHourlySummary(historySummaryRange)
                : Promise.resolve<HourBucket[] | null>(null),
              shouldLoadHistorySummaries
                ? trackerClient.getTopSites({ ...historySummaryRange, limit: 8 })
                : Promise.resolve<SiteDuration[] | null>(null),
            ]);

            if (historyRefreshRequestRef.current !== requestId) return;

            if (historyHourlySummary !== null) setInsightHourly(historyHourlySummary);
            if (historySiteSummary !== null) setInsightTopSites(historySiteSummary);
          } catch (nextError) {
            if (historyRefreshRequestRef.current !== requestId) return;
            setError(nextError instanceof Error ? nextError.message : toErrorMessage(nextError));
          }
        })();

        return true;
      }

      const [materializedArchiveTimelines, historyHourlySummary, historySiteSummary] = await Promise.all([
        shouldLoadCompactHistory
          ? loadCompactHistoryRange(historyTimelineRange).then((load) => load.materialized)
          : trackerClient.getTimeline(historyTimelineRange).then((timeline) => materializeBuiltInHeuristicTimeline(timeline)),
        shouldLoadHistorySummaries
          ? trackerClient.getHourlySummary(historySummaryRange)
          : Promise.resolve<HourBucket[] | null>(null),
        shouldLoadHistorySummaries
          ? trackerClient.getTopSites({ ...historySummaryRange, limit: 8 })
          : Promise.resolve<SiteDuration[] | null>(null),
      ]);

      if (historyRefreshRequestRef.current !== requestId) return false;

      if (!shouldLoadDashboardWeekHistory) {
        setHistorySegments(materializedArchiveTimelines.segments);
        setHistorySegmentsLoadedRange(historyTimelineRange);
        setHistoryNextCursor(null);
        setHistoryHasMoreSegments(false);
        setHistoryLoadingMore(false);
        setHistoryLoadMoreError(null);
      }
      updateDriftAlarmHistorySegments(day, materializedArchiveTimelines.segments);
      if (dashboardWeekRefreshKey) setDashboardWeekRefreshState({ key: dashboardWeekRefreshKey, status: "idle" });
      if (historyHourlySummary !== null) setInsightHourly(historyHourlySummary);
      if (historySiteSummary !== null) setInsightTopSites(historySiteSummary);
      scheduleAvailableBuiltInHeuristicPersistence(materializedArchiveTimelines.classifications);
      loadMissingHistoryIcons(materializedArchiveTimelines.segments);
      return true;
    } catch (nextError) {
      if (historyRefreshRequestRef.current !== requestId) return false;
      const message = nextError instanceof Error ? nextError.message : toErrorMessage(nextError);
      if (dashboardWeekRefreshKey) setDashboardWeekRefreshState({ key: dashboardWeekRefreshKey, status: "error" });
      setError(message);
      return false;
    }
  }

  const clearLocalActivityCaches = useCallback(() => {
    compactHistoryCacheGenerationRef.current += 1;
    compactHistoryCacheRef.current.clear();
    compactHistoryInFlightRef.current.clear();
    setCompactHistoryCacheRevision((revision) => revision + 1);
    setHistorySegmentsLoadedRange(null);
    setDashboardWeekRefreshState({ key: null, status: "idle" });
  }, []);

  const isPreviewSurface = shouldUsePreviewData();
  const markFirstDayHistorySettled = useCallback(() => {
    if (!user?.id) return;
    const marker = readFirstDayCloudBacklog(user.id);
    if (marker?.importPending) updateFirstDayCloudBacklog(user.id, marker.runId, { importPending: false });
  }, [user?.id]);
  const shouldStartBrowserHistoryBootstrap =
    activeTab === "dashboard"
    && dashPeriod === "Today"
    && hasLoadedOnce
    && !loading
    && selectedDay === logicalTodayIsoDate(startOfDayMinutes)
    && segmentsLoadedDay === selectedDay
    && segments.length === 0;
  const { notice: browserHistoryBootstrapNotice, reset: resetBrowserHistoryBootstrap } = useBrowserHistoryBootstrap({
    blocked: shouldBlockLocalTrackerAccess,
    clearLocalActivityCaches,
    enabled: browserHistoryBootstrapEnabled && !preparingFirstDay,
    isPreviewSurface,
    onHistorySettled: markFirstDayHistorySettled,
    refresh,
    refreshHistoryData,
    selectedDayRef,
    setError,
    shouldStart: shouldStartBrowserHistoryBootstrap,
  });

  // Live view of the local AI options for the first-day gate: the managed-model
  // attach watcher can fill the setup while the gate is running.
  const localAiClassificationOptionsRef = useRef(selectedLocalAiClassificationOptions);
  useEffect(() => {
    localAiClassificationOptionsRef.current = selectedLocalAiClassificationOptions;
  }, [selectedLocalAiClassificationOptions]);
  const canUseCloudAiClassificationRef = useRef(canUseSelectedCloudAiClassification);
  useEffect(() => {
    canUseCloudAiClassificationRef.current = canUseSelectedCloudAiClassification;
  }, [canUseSelectedCloudAiClassification]);
  // The managed-local key intentionally stays stable while its downloaded model
  // attaches; changing the chosen route/provider still invalidates the preparation.
  const firstDaySelectedAiProviderKey = selectedClassificationRoute === "cloud"
    ? "cloud"
    : localAiSetup.provider === "managed_local"
      ? "local:managed_local"
      : `local:${localAiSetup.provider}:${localAiConnectionFingerprint ?? "unconfigured"}`;
  const firstDaySelectedAiProviderKeyRef = useRef(firstDaySelectedAiProviderKey);
  firstDaySelectedAiProviderKeyRef.current = firstDaySelectedAiProviderKey;
  // Picking Local AI in onboarding routes classification to the managed model the
  // moment the download starts (driftyRoute "local"), so the route — not the
  // provider default — is the "user chose Local AI" signal.
  const managedLocalSelected = isManagedLocalAiRoute(localAiSetup);
  const cloudAiSelected = localAiSetup.provider === "managed_local" && localAiSetup.driftyRoute === "cloud";
  // Once onboarding closes with a managed download still in flight, this watcher
  // writes the ready model into the AI setup and sends the ready notification.
  useManagedLocalModelAttach(
    !onboardingOpen && managedLocalSelected && localAiClassificationOptions === null,
    setLocalAiSetup,
  );

  // The first-day gate owns its retries, but every real provider contact still
  // feeds the same Cloud-health hysteresis as later background/manual runs.
  const runFirstDayAiClassification = useCallback(async (
    ...args: Parameters<typeof runAiClassification>
  ): Promise<AiClassificationSummary> => {
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;
    const providerKeyAtStart = currentAiClassificationProviderKeyRef.current;
    try {
      const summary = await runAiClassification(args[0], args[1], {
        ...args[2],
        persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart,
      });
      if (args[2]?.localProvider) recordLocalAiClassificationSummary(summary);
      else recordCloudAiClassificationSummary(summary, cloudAiConnectionGeneration);
      return summary;
    } catch (error) {
      if (args[2]?.localProvider) recordLocalAiClassificationError(describeLocalAiClassificationFailure(error));
      else await recordCloudAiClassificationError(error, cloudAiConnectionGeneration);
      throw error;
    }
  }, [recordCloudAiClassificationError, recordCloudAiClassificationSummary, recordLocalAiClassificationError, recordLocalAiClassificationSummary]);
  const runFirstDayAiClassificationUntilEmpty = useCallback(async (
    ...args: Parameters<typeof runAiClassificationUntilEmpty>
  ): Promise<AiClassificationSummary> => {
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;
    const providerKeyAtStart = currentAiClassificationProviderKeyRef.current;
    try {
      const summary = await runAiClassificationUntilEmpty(args[0], args[1], {
        ...args[2],
        persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart,
      });
      if (args[2]?.localProvider) recordLocalAiClassificationSummary(summary);
      else recordCloudAiClassificationSummary(summary, cloudAiConnectionGeneration);
      return summary;
    } catch (error) {
      if (args[2]?.localProvider) recordLocalAiClassificationError(describeLocalAiClassificationFailure(error));
      else await recordCloudAiClassificationError(error, cloudAiConnectionGeneration);
      throw error;
    }
  }, [recordCloudAiClassificationError, recordCloudAiClassificationSummary, recordLocalAiClassificationError, recordLocalAiClassificationSummary]);

  const {
    continueAnyway: continueFirstDayPreparationAnyway,
    failure: firstDayPreparationFailure,
    rearm: rearmFirstDayPreparation,
    retry: retryFirstDayPreparation,
  } = useFirstDayPreparation({
    browserHistoryImportEnabled: browserHistoryBootstrapEnabled,
    canUseCloudAiClassificationRef,
    clearLocalActivityCaches,
    cloudAiSelected,
    cloudBacklogOwnerId: user?.id,
    localAiClassificationOptionsRef,
    managedLocalSelected,
    onBrowserHistoryImportFailed: () => {
      firstDayHistoryImportFailedRef.current = true;
      setBrowserHistoryBootstrapEnabled(true);
    },
    onReveal: (outcome) => {
      if (firstDayRevealTimerRef.current !== null) {
        window.clearTimeout(firstDayRevealTimerRef.current);
        firstDayRevealTimerRef.current = null;
      }
      // A successful import needs no dashboard scan. If import failed before
      // reveal, leave its one-shot recovery available; a late failure re-arms it.
      setBrowserHistoryBootstrapEnabled(firstDayHistoryImportFailedRef.current);
      // Moving on from a paused run has nothing to celebrate, so it cuts
      // straight through.
      if (outcome !== "complete") {
        setPreparingFirstDay(false);
        return;
      }
      // Otherwise land the wait: fill the bar, say the day is ready, and only
      // then hand over to the dashboard.
      setFirstDayPreparationPhase("ready");
      setFirstDayPreparationProgress(1);
      firstDayRevealTimerRef.current = window.setTimeout(() => {
        firstDayRevealTimerRef.current = null;
        setPreparingFirstDay(false);
      }, FIRST_DAY_PREPARATION_READY_HOLD_MS);
    },
    preparingFirstDay,
    refresh,
    runAiClassification: runFirstDayAiClassification,
    runAiClassificationUntilEmpty: runFirstDayAiClassificationUntilEmpty,
    selectedAiProviderKeyRef: firstDaySelectedAiProviderKeyRef,
    selectDay,
    selectedDayRef,
    setPhase: setFirstDayPreparationPhase,
    setProgress: setFirstDayPreparationProgress,
    setReadingSegmentIds: setFirstDayReadingSegmentIds,
    setPreparedDay: setFirstDayPreparedDay,
    shouldBlockLocalTrackerAccess,
    startOfDayMinutes,
  });

  useEffect(() => () => {
    if (firstDayRevealTimerRef.current !== null) window.clearTimeout(firstDayRevealTimerRef.current);
  }, []);

  const loadMoreHistorySegments = useCallback(async (): Promise<void> => {
    if (historyLoadingMore || !historyHasMoreSegments || historyNextCursor === null || historySegmentsLoadedRange === null) return;

    const requestId = historyRefreshRequestRef.current;
    const loadMoreRequestId = ++historyLoadMoreRequestRef.current;
    setHistoryLoadingMore(true);
    setHistoryLoadMoreError(null);

    try {
      const timelinePage = await trackerClient.getTimelinePage({
        start: historySegmentsLoadedRange.start,
        end: historySegmentsLoadedRange.end,
        beforeEndedAt: historyNextCursor.beforeEndedAt,
        beforeSegmentId: historyNextCursor.beforeSegmentId,
        limit: HISTORY_TIMELINE_PAGE_SIZE,
      });
      const materializedPage = materializeBuiltInHeuristicTimeline(timelinePage.items);

      if (historyRefreshRequestRef.current !== requestId) return;

      setHistorySegments((currentSegments) => mergeHistoryTimelinePages(currentSegments, materializedPage.segments));
      setHistoryNextCursor(timelinePage.nextCursor);
      setHistoryHasMoreSegments(timelinePage.hasMore);
      scheduleAvailableBuiltInHeuristicPersistence(materializedPage.classifications);

      loadMissingAppIcons({
        segments: materializedPage.segments,
        shouldReportFailure: () => historyRefreshRequestRef.current === requestId,
        failureMessage: "Failed to load additional history app icons",
      });
      loadMissingSiteIcons(materializedPage.segments);
    } catch (nextError) {
      if (historyRefreshRequestRef.current !== requestId) return;
      setHistoryLoadMoreError(describeActionError(nextError instanceof Error ? nextError : toErrorMessage(nextError), localization.t("history.loadOlderError")));
    } finally {
      if (historyLoadMoreRequestRef.current === loadMoreRequestId) {
        setHistoryLoadingMore(false);
      }
    }
  }, [
    historyHasMoreSegments,
    historyLoadingMore,
    historyNextCursor,
    historySegmentsLoadedRange,
    loadMissingAppIcons,
    loadMissingSiteIcons,
    materializeBuiltInHeuristicTimeline,
  ]);

  const loadMoreHistorySearchSegments = useCallback(async (): Promise<void> => {
    if (historySearchLoading || normalizedHistorySearchQuery.length === 0) return;
    const searchCursor = historySearchNextCursor;
    const retryFirstPage = searchCursor === null;
    if (retryFirstPage) {
      if (historySearchError === null) return;
    } else if (!historySearchHasMoreSegments) {
      return;
    }

    const requestId = retryFirstPage
      ? historySearchRequestRef.current + 1
      : historySearchRequestRef.current;
    if (retryFirstPage) historySearchRequestRef.current = requestId;
    setHistorySearchLoading(true);
    setHistorySearchError(null);

    try {
      const timelinePage = await trackerClient.searchTimeline({
        query: normalizedHistorySearchQuery,
        ...FULL_HISTORY_SEARCH_RANGE,
        ...(searchCursor === null
          ? {}
          : {
              beforeEndedAt: searchCursor.beforeEndedAt,
              beforeSegmentId: searchCursor.beforeSegmentId,
            }),
        limit: HISTORY_TIMELINE_PAGE_SIZE,
      });
      const materializedPage = materializeBuiltInHeuristicTimeline(timelinePage.items);

      if (historySearchRequestRef.current !== requestId) return;

      setHistorySearchSegments((currentSegments) => (
        retryFirstPage
          ? materializedPage.segments
          : mergeHistoryTimelinePages(currentSegments, materializedPage.segments)
      ));
      setHistorySearchNextCursor(timelinePage.nextCursor);
      setHistorySearchHasMoreSegments(timelinePage.hasMore);
      scheduleAvailableBuiltInHeuristicPersistence(materializedPage.classifications);

      loadMissingAppIcons({
        segments: materializedPage.segments,
        shouldReportFailure: () => historySearchRequestRef.current === requestId,
        failureMessage: retryFirstPage
          ? "Failed to load history search app icons"
          : "Failed to load additional history search app icons",
      });
      loadMissingSiteIcons(materializedPage.segments);
    } catch (nextError) {
      if (historySearchRequestRef.current !== requestId) return;
      setHistorySearchError(describeActionError(nextError instanceof Error ? nextError : toErrorMessage(nextError), localization.t("history.searchError")));
    } finally {
      if (historySearchRequestRef.current === requestId) {
        setHistorySearchLoading(false);
      }
    }
  }, [
    historySearchError,
    historySearchHasMoreSegments,
    historySearchLoading,
    historySearchNextCursor,
    loadMissingAppIcons,
    loadMissingSiteIcons,
    materializeBuiltInHeuristicTimeline,
    normalizedHistorySearchQuery,
  ]);

  const prefetchCurrentWeekHistory = useCallback(async (day: string): Promise<boolean> => {
    if (shouldBlockLocalTrackerAccess) return false;

    const rollingWeekRange = getInsightPeriodRange(day, "Week", startOfDayMinutes);
    const historyTimelineRange = { start: rollingWeekRange.start, end: rollingWeekRange.end };
    const prefetchKey = compactHistoryRangeKey(historyTimelineRange);
    const cachedWeekHistory = findFreshCompactHistoryLoad(compactHistoryCacheRef.current, historyTimelineRange);
    if (cachedWeekHistory) return false;
    if (compactHistoryInFlightRef.current.has(prefetchKey)) return false;

    const requestId = dashboardWeekPrefetchRequestRef.current + 1;
    dashboardWeekPrefetchRequestRef.current = requestId;

    try {
      const { materialized: materializedArchiveTimelines } = await loadCompactHistoryRange(historyTimelineRange);
      if (dashboardWeekPrefetchRequestRef.current !== requestId) return false;

      updateDriftAlarmHistorySegments(day, materializedArchiveTimelines.segments);
      scheduleAvailableBuiltInHeuristicPersistence(materializedArchiveTimelines.classifications);
      // Resolve the week's app icons (a local lookup) with its segments so Week
      // does not swap initials for icons after its own entry request. Site
      // icons are resolved from the on-disk cache only: an uncached domain is
      // fetched from a remote favicon service, which should not happen for a
      // view nobody opened, so those stay omitted and Week entry requests them.
      loadMissingAppIcons({
        segments: materializedArchiveTimelines.segments,
        failureMessage: "Failed to prefetch current week app icons",
      });
      loadMissingSiteIcons(materializedArchiveTimelines.segments, { cachedOnly: true });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn("Failed to prefetch current week history", message);
      return false;
    }
  }, [loadCompactHistoryRange, loadMissingAppIcons, loadMissingSiteIcons, shouldBlockLocalTrackerAccess, startOfDayMinutes]);

  const refreshLiveDriftAlarmActivity = useCallback(async (day: string): Promise<boolean> => {
    if (liveDriftAlarmRefreshInFlightRef.current) return false;
    if (shouldBlockLocalTrackerAccess) return false;
    if (status?.running !== true) return false;
    if (day !== currentDriftAlarmDay()) return false;

    liveDriftAlarmRefreshInFlightRef.current = true;
    const trackerMutationGeneration = trackerMutationGenerationRef.current;
    const fullRefreshRequest = refreshRequestRef.current;
    try {
      const timelineRange = getDriftAlarmPollTimelineRange(day, startOfDayMinutes);
      const [timelineResult, snapshotResult] = await Promise.allSettled([
        trackerClient.getTimeline(timelineRange),
        trackerClient.getCurrentSnapshot(),
      ]);

      if (
        day !== currentDriftAlarmDay()
        || trackerMutationGenerationRef.current !== trackerMutationGeneration
      ) return false;
      const nextCurrentSnapshot = snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
      if (snapshotResult.status === "rejected") {
        console.warn("Failed to refresh current activity for drift alarm poll", toErrorMessage(snapshotResult.reason));
      }
      liveDriftAlarmTimelineUnavailableRef.current = timelineResult.status === "rejected";
      if (hostPlatform === "windows" && refreshRequestRef.current === fullRefreshRequest) {
        setCurrentSnapshot(nextCurrentSnapshot);
      }
      if (timelineResult.status === "rejected") {
        console.warn("Failed to refresh live drift alarm activity", toErrorMessage(timelineResult.reason));
        return false;
      }
      const liveTimeline = timelineResult.value;
      liveDriftAlarmSegmentsRef.current = liveTimeline;
      evaluateDriftAlarmRef.current?.({
        checkedAt: new Date(),
        snapshot: nextCurrentSnapshot,
        liveSegments: liveTimeline,
        updateRendererState: false,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn("Failed to refresh live drift alarm activity", message);
      return false;
    } finally {
      liveDriftAlarmRefreshInFlightRef.current = false;
    }
  }, [hostPlatform, shouldBlockLocalTrackerAccess, startOfDayMinutes, status?.running]);

  const refreshLiveTail = useCallback(async (day: string): Promise<boolean> => {
    if (liveTailRefreshInFlightRef.current) return false;
    if (shouldBlockLocalTrackerAccess) return false;
    if (selectedDayRef.current !== day) return false;

    liveTailRefreshInFlightRef.current = true;
    const trackerMutationGeneration = trackerMutationGenerationRef.current;
    try {
      const selectedDayRange = getLogicalDayRange(day, day, startOfDayMinutes);
      const cursor = latestActivitySegmentCursor(segmentsRef.current);
      const liveTail = await trackerClient.getLiveTail({
        ...selectedDayRange,
        ...cursor,
        limit: LIVE_TAIL_LIMIT,
      });

      if (
        selectedDayRef.current !== day
        || trackerMutationGenerationRef.current !== trackerMutationGeneration
      ) return false;

      setStatus((current) => {
        if (!current) return current;
        return {
          ...current,
          running: liveTail.running,
          trackerMode: liveTail.trackerMode ?? current.trackerMode,
          lastEventAt: liveTail.lastEventAt ?? current.lastEventAt,
        };
      });

      if (liveTail.segments.length > 0) {
        const mergedSegments = mergeActivitySegments(segmentsRef.current, liveTail.segments);
        segmentsRef.current = mergedSegments;
        updateDriftAlarmBaseSegments(day, mergedSegments);
        setSegments(mergedSegments);
        setHistorySegments((current) => current.length > 0 ? mergeActivitySegments(current, liveTail.segments) : current);
        setHourly(buildHourlySummary(mergedSegments));
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn("Failed to refresh focused live tracker tail", message);
      return false;
    } finally {
      liveTailRefreshInFlightRef.current = false;
    }
  }, [shouldBlockLocalTrackerAccess, startOfDayMinutes]);

  const refreshWindowsLiveSnapshot = useCallback(async (): Promise<void> => {
    if (hostPlatform !== "windows" || status?.running !== true || shouldBlockLocalTrackerAccess) return;
    if (windowsLiveSnapshotRefreshInFlightRef.current) return;
    windowsLiveSnapshotRefreshInFlightRef.current = true;
    const trackerMutationGeneration = trackerMutationGenerationRef.current;
    const fullRefreshRequest = refreshRequestRef.current;
    try {
      const snapshot = await trackerClient.getCurrentSnapshot();
      if (
        trackerMutationGenerationRef.current === trackerMutationGeneration
        && refreshRequestRef.current === fullRefreshRequest
      ) setCurrentSnapshot(snapshot);
    } catch (error) {
      console.warn("Failed to refresh Windows current activity", toErrorMessage(error));
      if (
        trackerMutationGenerationRef.current === trackerMutationGeneration
        && refreshRequestRef.current === fullRefreshRequest
      ) setCurrentSnapshot(null);
    } finally {
      windowsLiveSnapshotRefreshInFlightRef.current = false;
    }
  }, [hostPlatform, shouldBlockLocalTrackerAccess, status?.running]);

  const refreshRef = useRef(refresh);
  const refreshLiveTailRef = useRef(refreshLiveTail);
  const refreshWindowsLiveSnapshotRef = useRef(refreshWindowsLiveSnapshot);
  const selectTodayAfterDateRolloverRef = useRef(selectTodayAfterDateRollover);
  useLayoutEffect(() => {
    refreshRef.current = refresh;
    refreshLiveTailRef.current = refreshLiveTail;
    refreshWindowsLiveSnapshotRef.current = refreshWindowsLiveSnapshot;
    selectTodayAfterDateRolloverRef.current = selectTodayAfterDateRollover;
  });

  useEffect(() => {
    window.__DRIFTY_SET_BOOT_STATUS__?.("Renderer mounted. Showing minimal shell\u2026");
    if (hostPlatform !== "windows") {
      window.__DRIFTY_BOOTSTRAPPED__ = true;
      hideBootShell();
    }
  }, [hostPlatform]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return;
    const nextInputs: DashboardRefreshInputs = { selectedDay, startOfDayMinutes, startOfWeek };
    const refreshMode = resolveDashboardRefreshMode({
      hasLoadedOnce,
      nextInputs,
      previousInputs: dashboardRefreshInputsRef.current,
    });
    dashboardRefreshInputsRef.current = nextInputs;
    if (refreshMode === "skip") return;
    void refresh(selectedDay, { foreground: refreshMode === "foreground" });
  }, [hasLoadedOnce, selectedDay, shouldBlockLocalTrackerAccess, startOfDayMinutes, startOfWeek]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return undefined;
    const isInteractiveHistoryOpen = activeTab === "history";
    if (!hasLoadedOnce && !isInteractiveHistoryOpen) return undefined;
    if (!shouldRefreshHistoryData(activeTab, dashPeriod, classificationRange)) return undefined;

    // This effect fires on view-affecting transitions (tab / dashboard period /
    // classification range / selected day). When the active view needs history data
    // (e.g. switching Today -> Week), that history IS the on-screen content, so fetch
    // it immediately. Deferring via requestIdleCallback could delay the fetch by up to
    // its 1200ms timeout precisely when the main thread is busy re-rendering the new
    // view. refreshHistoryData early-returns when no history is needed and guards
    // against stale/duplicate responses, so an immediate call is safe.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      void refreshHistoryData(selectedDay);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, classificationRange, dashPeriod, hasLoadedOnce, selectedDay, shouldBlockLocalTrackerAccess, startOfDayMinutes, startOfWeek, trendsRange]);

  useEffect(() => {
    clearLocalActivityCaches();
  }, [classificationRules, clearLocalActivityCaches, startOfDayMinutes, startOfWeek]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return undefined;
    if (!hasLoadedOnce) return undefined;
    if (activeTab !== "dashboard" || dashPeriod !== "Today") return undefined;
    if (selectedDay !== logicalTodayIsoDate(startOfDayMinutes)) return undefined;

    // Until this prefetch lands, entering Week paints only today, so start it
    // in a microtask right after this effect flush. That keeps it out of the
    // commit that set hasLoadedOnce and behind Today's own follow-up requests
    // (hourly summary, icons), which were queued first on the one-at-a-time
    // tracker. A timer only adds idle time, and an animation frame does not
    // fire while the window is still hidden after launch. A cleanup before the
    // microtask still cancels it; a later day or period change leaves the
    // request running, and Week entry reuses it while it is in flight.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      void prefetchCurrentWeekHistory(selectedDay);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, dashPeriod, hasLoadedOnce, prefetchCurrentWeekHistory, selectedDay, shouldBlockLocalTrackerAccess, startOfDayMinutes]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return;
    if (autoStartAttemptedRef.current) return;
    if (!hasLoadedOnce) return;
    if (!status) return;
    if (status.running) {
      autoStartAttemptedRef.current = true;
      return;
    }
    // Onboarding owns the first start on a new device: it explains what capture
    // does and starts tracking when the user grants Accessibility. Recovering a
    // stopped tracker here would begin recording before that explanation.
    if (onboardingOpen) return;
    // A persisted pause is an explicit user choice, not a failed startup. Only
    // the Resume action may clear it; background recovery must leave it alone.
    if (status.trackingPaused) {
      autoStartAttemptedRef.current = true;
      return;
    }
    if (status.trackerMode === "unavailable") return;

    autoStartAttemptedRef.current = true;
    void handleBackgroundStartTracking();
  }, [hasLoadedOnce, onboardingOpen, shouldBlockLocalTrackerAccess, status]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return undefined;
    // Preview/demo surfaces (browser embeds with driftyPreview=1) render fixture
    // data on a fixed preview clock. Re-polling rebuilds the full dashboard
    // payload on every tick and leaks memory in long-lived website embeds, so
    // the recurring refresh is app-only; preview keeps the initial load only.
    if (isPreviewSurface) return undefined;
    const intervalId = setInterval(() => {
      if (selectTodayAfterDateRolloverRef.current()) return;
      // Unfocused ticks use the same cursor live-tail merge as focused ones;
      // the full-day rebuild runs only as a low-cadence background reconcile
      // (see resolveAppRefreshTickAction) because rebuilding the whole
      // dashboard payload every 30s while unfocused is what grew the
      // main-window WKWebView to multi-GB footprints.
      const tickAction = resolveAppRefreshTickAction({
        rendererFocused: rendererFocusedRef.current,
        nowMs: Date.now(),
        lastFullDayRefreshAtMs: lastFullDayRefreshAtRef.current,
      });
      // The alarm poll handles unfocused Windows captures when alerts are on.
      // It deliberately skips the focused renderer, so the regular tick owns
      // that case as well as the alerts-off case.
      if (hostPlatform === "windows" && (!driftAlertsRuntimeEnabled || rendererFocusedRef.current)) {
        void refreshWindowsLiveSnapshotRef.current();
      }
      if (tickAction === "reconcile") {
        void refreshRef.current(selectedDay, { foreground: false });
        return;
      }
      void refreshLiveTailRef.current(selectedDay);
    }, APP_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [activeTab, classificationRange, dashPeriod, driftAlertsRuntimeEnabled, hostPlatform, isPreviewSurface, selectedDay, shouldBlockLocalTrackerAccess, trendsRange]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return undefined;
    // Drift alarms are a desktop companion feature; preview/demo surfaces have
    // no tracker to watch (previewStatus() reports running=true), so skip the
    // recurring snapshot poll there.
    if (isPreviewSurface) return undefined;
    if (!driftAlertsRuntimeEnabled) return undefined;
    if (status?.running !== true) return undefined;

    const intervalId = setInterval(() => {
      if (selectTodayAfterDateRollover()) return;
      // Keep this heavy snapshot poll out of the focused renderer path; alarms resume on the normal cadence once Drifty loses focus.
      if (rendererFocusedRef.current) return;
      void refreshLiveDriftAlarmActivity(currentDriftAlarmDay());
    }, DRIFT_ALARM_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [driftAlertsRuntimeEnabled, isPreviewSurface, refreshLiveDriftAlarmActivity, selectTodayAfterDateRollover, shouldBlockLocalTrackerAccess, startOfDayMinutes, status?.running]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return undefined;
    if (isPreviewSurface) return undefined;
    const wasFocused = previousRendererFocusedRef.current;
    previousRendererFocusedRef.current = rendererFocused;
    if (wasFocused || !rendererFocused) return undefined;
    if (!hasLoadedOnce) return undefined;
    // Background ticks only merge the append-only live tail, so a renderer
    // regaining focus after a background stretch may hold stale snapshot,
    // metrics, or reclassified categories — reconcile once, unless a full
    // refresh already ran within the normal tick interval.
    if (Date.now() - lastFullDayRefreshAtRef.current < APP_REFRESH_INTERVAL_MS) return undefined;
    void refresh(selectedDayRef.current);
    return undefined;
  }, [hasLoadedOnce, isPreviewSurface, rendererFocused, shouldBlockLocalTrackerAccess]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        selectTodayAfterDateRollover();
      }
    }

    window.addEventListener("focus", selectTodayAfterDateRollover);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    selectTodayAfterDateRollover();

    return () => {
      window.removeEventListener("focus", selectTodayAfterDateRollover);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectTodayAfterDateRollover]);

  useEffect(() => {
    if (autoSelectedLatestDayRef.current) return;
    if (!hasLoadedOnce) return;
    if (segments.length > 0) return;
    if (!status?.lastEventAt) return;
    const latestTrackedDay = isoDateFromTimestamp(status.lastEventAt);
    if (!latestTrackedDay) return;
    if (latestTrackedDay === selectedDay) return;
    autoSelectedLatestDayRef.current = true;
    setSelectedDay(latestTrackedDay);
  }, [hasLoadedOnce, segments.length, selectedDay, status?.lastEventAt]);

  useEffect(() => {
    if (status === null) return;

    const lastEventAt = status?.lastEventAt ?? null;
    const previousLastEventAt = brandCaptureEventAtRef.current;

    if (!hasObservedBrandCaptureRef.current) {
      hasObservedBrandCaptureRef.current = true;
      brandCaptureEventAtRef.current = lastEventAt;
      return;
    }

    brandCaptureEventAtRef.current = lastEventAt;

    if (status?.running !== true) return;
    if (lastEventAt === null || lastEventAt === previousLastEventAt) return;
    if (!isLastCaptureJustNow(lastEventAt)) return;

    setBrandCaptureMotionKey((currentKey) => currentKey + 1);
  }, [hasTrackerStatus, status?.lastEventAt, status?.running]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    let disposed = false;
    // The window chrome has to follow the app theme. Windows stays on its
    // opaque boot shell until Rust confirms both transparency and its theme.
    // Only then can the first translucent frame be revealed safely.
    const revealWindowsShell = (material: "solid" | "translucent") => {
      if (disposed) return;
      document.documentElement.dataset.windowMaterial = material;
      window.__DRIFTY_BOOTSTRAPPED__ = true;
      hideBootShell();
    };
    if (hostPlatform === "windows") {
      document.documentElement.dataset.windowsBlurWanted = String(windowsBlurEnabled);
      document.documentElement.dataset.windowMaterial = "solid";
      document.documentElement.removeAttribute("data-windows-native-blur");
    }
    let appearanceRequest = 0;
    const applyAppearance = () => {
      const request = ++appearanceRequest;
      void setMainWindowThemeAppearance(theme === "dark", hostPlatform === "windows" && windowsBlurEnabled).then((materialStatus) => {
        if (disposed || request !== appearanceRequest || hostPlatform !== "windows") return;
        const root = document.documentElement;
        const nativeBlurActive = root.dataset.windowsNativeBlur === "active";
        revealWindowsShell(windowsBlurEnabled && root.dataset.windowsBlurSystemBlocked !== "true" && materialStatus?.kind === "translucent" && nativeBlurActive ? "translucent" : "solid");
      }).catch(() => {
        if (disposed || request !== appearanceRequest || hostPlatform !== "windows") return;
        revealWindowsShell("solid");
      });
    };
    // Native Windows settings changes reapply the existing preference without
    // changing it. The native watcher restores opacity before sending this event.
    if (hostPlatform === "windows") {
      window.addEventListener("drifty-windows-blur-system-change", applyAppearance);
      // WebView2 can mount React before the native main window is ready.
      // A normal reveal retries the current preference without changing it.
      window.addEventListener("drifty-windows-appearance-ready", applyAppearance);
    }
    applyAppearance();
    return () => {
      disposed = true;
      window.removeEventListener("drifty-windows-blur-system-change", applyAppearance);
      window.removeEventListener("drifty-windows-appearance-ready", applyAppearance);
    };
  }, [hostPlatform, theme, windowsBlurEnabled]);

  const handleWindowsBlurEnabledChange = useCallback((enabled: boolean) => {
    // Disabled blur must never expose an unblurred transparent frame while IPC catches up.
    if (!enabled) {
      document.documentElement.dataset.windowsBlurWanted = "false";
      document.documentElement.dataset.windowMaterial = "solid";
      document.documentElement.removeAttribute("data-windows-native-blur");
    } else {
      document.documentElement.dataset.windowsBlurWanted = "true";
    }
    persistWindowsBlurEnabled(enabled);
    setWindowsBlurEnabled(enabled);
  }, []);

  useLayoutEffect(() => {
    applyDarkPalettePreview(document.documentElement, darkPalettePreview, isDevModeActive);
  }, [darkPalettePreview, isDevModeActive]);

  const handleDarkPalettePreviewChange = useCallback((preview: DarkPalettePreview) => {
    setDarkPalettePreview(preview);
    persistDarkPalettePreview(preview);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(START_OF_DAY_STORAGE_KEY, String(startOfDayMinutes));
  }, [startOfDayMinutes]);

  useEffect(() => {
    window.localStorage.setItem(END_OF_DAY_REVIEW_MINUTE_STORAGE_KEY, String(endOfDayReviewMinute));
  }, [endOfDayReviewMinute]);

  useEffect(() => {
    window.localStorage.setItem(START_OF_WEEK_STORAGE_KEY, startOfWeek);
  }, [startOfWeek]);

  useEffect(() => {
    for (const option of CATEGORY_COLOR_OPTIONS) {
      const color = categoryColorOverrides[option.key];
      if (color) document.documentElement.style.setProperty(option.cssVariable, color);
      else document.documentElement.style.removeProperty(option.cssVariable);
    }
    window.localStorage.setItem(CATEGORY_COLOR_STORAGE_KEY, JSON.stringify(categoryColorOverrides));
  }, [categoryColorOverrides]);

  useEffect(() => {
    applyAppThemeColorOverrides(document.documentElement.style, appThemeColorOverrides);
    window.localStorage.setItem(APP_THEME_COLOR_STORAGE_KEY, JSON.stringify(appThemeColorOverrides));
  }, [appThemeColorOverrides]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);


  useEffect(() => {
    if (!deviceSyncAccountId || deviceSyncPreferenceOwnerId !== deviceSyncAccountId) return;
    persistDeviceSyncEnabled(deviceSyncAccountId, deviceSyncEnabled);
  }, [deviceSyncAccountId, deviceSyncEnabled, deviceSyncPreferenceOwnerId]);

  useEffect(() => {
    window.localStorage.setItem(AI_AVAILABILITY_GATE_DEV_DISABLED_STORAGE_KEY, aiAvailabilityGateDevDisabled ? "1" : "0");
  }, [aiAvailabilityGateDevDisabled]);

  useEffect(() => {
    window.localStorage.setItem(WEB_ACCOUNT_PREVIEW_STORAGE_KEY, devWebAccountPreviewEnabled ? "1" : "0");
  }, [devWebAccountPreviewEnabled]);

  useEffect(() => {
    if (devSettingsReviewSubsection) return;
    window.localStorage.setItem(DEV_SETTINGS_SUBSECTION_STORAGE_KEY, devSettingsSubsection);
  }, [devSettingsReviewSubsection, devSettingsSubsection]);

  // Leaving the Projects tab visible after the preview is switched off would strand
  // the user on a hidden surface — send them back to the dashboard.

  useEffect(() => {
    const effectiveDevModeEnabled = DEV_SETTINGS_ENABLED && devModeEnabled;
    if (!devSettingsReviewSubsection) {
      window.localStorage.setItem(DEV_MODE_STORAGE_KEY, effectiveDevModeEnabled ? "1" : "0");
    }
    if (effectiveDevModeEnabled) return;
    if (settingsSection === "dev") setSettingsSection("general");
    if (teamsBetaEnabled) setTeamsBetaEnabled(false);
    if (profileBetaEnabled) setProfileBetaEnabled(false);
    if (agentsBetaEnabled) setAgentsBetaEnabled(false);
    if (navigationRefreshEnabled) setNavigationRefreshEnabled(false);
    if (breakdownPatternsPreviewEnabled) setBreakdownPatternsPreviewEnabled(false);
    if (floatingCompanionDevEnabled) setFloatingCompanionDevEnabled(false);
    if (devWebAccountPreviewEnabled) setDevWebAccountPreviewEnabled(false);
    if (forceChromiumAxCaptureEnabled) setForceChromiumAxCaptureEnabled(false);
    if (forceFrontmostFallbackCaptureEnabled) setForceFrontmostFallbackCaptureEnabled(false);
    if (forceBrowserHistoryUrlFallbackEnabled) setForceBrowserHistoryUrlFallbackEnabled(false);
    if (forceChromiumAxExtremeNudgeEnabled) setForceChromiumAxExtremeNudgeEnabled(false);
    // The pet is deliberately absent here. It is a production feature now, so
    // turning Dev mode off must leave it exactly as the user set it; only the
    // Pet Mode Lab is gated behind Dev.
  }, [agentsBetaEnabled, breakdownPatternsPreviewEnabled, devModeEnabled, devSettingsReviewSubsection, devWebAccountPreviewEnabled, floatingCompanionDevEnabled, forceBrowserHistoryUrlFallbackEnabled, forceChromiumAxCaptureEnabled, forceChromiumAxExtremeNudgeEnabled, forceFrontmostFallbackCaptureEnabled, navigationRefreshEnabled, profileBetaEnabled, settingsSection, teamsBetaEnabled]);

  useEffect(() => {
    if (!floatingCompanionDevSupported) {
      if (floatingCompanionDevEnabled) setFloatingCompanionDevEnabled(false);
      window.localStorage.removeItem(FLOATING_COMPANION_DEV_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(FLOATING_COMPANION_DEV_STORAGE_KEY, floatingCompanionDevActive ? "1" : "0");
  }, [floatingCompanionDevActive, floatingCompanionDevEnabled, floatingCompanionDevSupported]);

  useEffect(() => {
    persistDailyRecordPreviewEnabled(dailyRecordPreviewEnabled);
  }, [dailyRecordPreviewEnabled]);
  // The Daily record page covers the tab under it; any move to a tab (a link, a shortcut, history) closes it.
  useEffect(() => {
    setDayRecordOpen(false);
  }, [activeTab]);

  useEffect(() => {
    const effectiveTeamsBetaEnabled = DEV_SETTINGS_ENABLED && devModeEnabled && teamsBetaEnabled;
    window.localStorage.setItem(TEAMS_BETA_STORAGE_KEY, effectiveTeamsBetaEnabled ? "1" : "0");
  }, [devModeEnabled, teamsBetaEnabled]);

  useEffect(() => {
    window.localStorage.setItem(PROFILE_BETA_STORAGE_KEY, canOpenProfileBeta ? "1" : "0");
  }, [canOpenProfileBeta]);

  useEffect(() => {
    window.localStorage.setItem(AGENTS_BETA_STORAGE_KEY, canOpenAgentsBeta ? "1" : "0");
  }, [canOpenAgentsBeta]);

  useEffect(() => {
    persistNavigationRefreshEnabled(canUseNavigationRefresh);
  }, [canUseNavigationRefresh]);

  useEffect(() => {
    persistBreakdownPatternsPreviewEnabled(canUseBreakdownPatternsPreview);
  }, [canUseBreakdownPatternsPreview]);

  useLayoutEffect(() => {
    if (canOpenAgents) return;
    setNavigationHistory((current) => replaceNavigationHistoryTab(
      current,
      "agents",
      { tabId: "dashboard", dashPeriod: "Today" },
    ));
  }, [canOpenAgents]);

  // Profile is a Dev-mode beta surface; without the gate, profile requests land
  // on the leaderboard (replacing the history entry so back/forward stays sane).
  useEffect(() => {
    if (rawActiveTab !== "profile" || canOpenProfileBeta) return;
    setNavigationHistory((current) => {
      const safeEntry: NavigationHistoryState["entries"][number] = { tabId: "leaderboard", dashPeriod };
      if (current.entries.length === 0) return { entries: [safeEntry], index: 0 };
      const entries = current.entries.slice();
      entries[current.index] = safeEntry;
      return { ...current, entries };
    });
  }, [rawActiveTab, canOpenProfileBeta, dashPeriod]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("app_menu_set_dev_mode_checked", {
      checked: DEV_SETTINGS_ENABLED && devModeEnabled,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : toErrorMessage(error);
      console.warn("Failed to sync Dev Mode menu state", message);
    });
  }, [devModeEnabled]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke("quit_confirmation_set_language", {
      language: localization.effectiveLanguage,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : toErrorMessage(error);
      console.warn("Failed to sync quit confirmation language", message);
    });
    const client = trackerClient as Partial<typeof trackerClient>;
    if (typeof client.updateTrayLanguage === "function") {
      void client.updateTrayLanguage(localization.effectiveLanguage).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : toErrorMessage(error);
        console.warn("Failed to sync tray language", message);
      });
    }
  }, [localization.effectiveLanguage]);

  const forceChromiumAxCapture = DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxCaptureEnabled;
  const forceFrontmostFallbackCapture = DEV_SETTINGS_ENABLED && devModeEnabled && forceFrontmostFallbackCaptureEnabled;
  const forceBrowserHistoryUrlFallback = DEV_SETTINGS_ENABLED && devModeEnabled && forceBrowserHistoryUrlFallbackEnabled;
  useEffect(() => {
    window.localStorage.setItem(FORCE_CHROMIUM_AX_CAPTURE_STORAGE_KEY, forceChromiumAxCapture ? "1" : "0");
    window.localStorage.setItem(FORCE_FRONTMOST_FALLBACK_CAPTURE_STORAGE_KEY, forceFrontmostFallbackCapture ? "1" : "0");
    window.localStorage.setItem(FORCE_BROWSER_HISTORY_URL_FALLBACK_STORAGE_KEY, forceBrowserHistoryUrlFallback ? "1" : "0");
  }, [forceBrowserHistoryUrlFallback, forceChromiumAxCapture, forceFrontmostFallbackCapture]);

  const [developerDiagnosticsSync] = useState(() => createDeveloperDiagnosticsSync(
    (settings: DeveloperDiagnosticsSettings) => trackerClient.setDeveloperDiagnostics?.(settings) ?? Promise.resolve(),
    (nextError) => console.warn("Failed to persist tracker developer diagnostics", nextError),
  ));
  // Requested after every render on purpose. The effective enhanced-context
  // settings are rebuilt each render, so an effect keyed on them used to write
  // the same six tracker settings after every render, each one a round trip on
  // the one-at-a-time tracker. The sync sends a changed value, retries a failed
  // one, and reconfirms an unchanged one at most once a minute.
  useEffect(() => {
    developerDiagnosticsSync.request({
      forceChromiumAxCapture,
      forceFrontmostFallbackCapture,
      forceBrowserHistoryUrlFallback,
      browserContentContextEnabled,
      enhancedContextEnabled: effectiveEnhancedContextSettings.enabled,
      enhancedContextCaptureLocal: effectiveEnhancedContextSettings.captureLocal,
      enhancedContextSourceFamilies: ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS
        .filter((option) => effectiveEnhancedContextSettings.sourceFamilies[option.family])
        .map((option) => option.family),
    });
  });

  useEffect(() => {
    const forceChromiumAxExtremeNudge = DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxExtremeNudgeEnabled;
    window.localStorage.setItem(FORCE_CHROMIUM_AX_EXTREME_NUDGE_STORAGE_KEY, forceChromiumAxExtremeNudge ? "1" : "0");
  }, [devModeEnabled, forceChromiumAxExtremeNudgeEnabled]);

  useEffect(() => {
    persistEnhancedContextSettings(enhancedContextSettings, isDevModeActive);
  }, [enhancedContextSettings, isDevModeActive]);

  useEffect(() => {
    driftAlarmSnoozeRef.current = driftAlarmSnooze;
    if (driftAlarmSnooze === null) return undefined;

    const delayMs = Math.max(0, driftAlarmSnooze.untilMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      void refresh(selectedDay, { requireCurrentSnapshot: true }).then((refreshed) => {
        if (!refreshed) {
          const retrySnooze = { ...driftAlarmSnooze, untilMs: Date.now() + 30_000 } satisfies DriftAlarmBreakSnooze;
          driftAlarmSnoozeRef.current = retrySnooze;
          setDriftAlarmSnooze(retrySnooze);
          return;
        }

        pendingBreakReturnAlarmRef.current = driftAlarmSnooze;
        breakRecoveryAssessmentRef.current = driftAlarmSnooze;
        driftAlarmSnoozeRef.current = null;
        setBreakRecoveryAssessment(driftAlarmSnooze);
        setDriftAlarmSnooze(null);
        lastDriftAlertSegmentRef.current = null;
        driftAlarmReminderRef.current = null;
      });
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [driftAlarmSnooze, selectedDay]);

  useEffect(() => {
    breakRecoveryAssessmentRef.current = breakRecoveryAssessment;
    if (breakRecoveryAssessment === null) return undefined;

    const assessmentEndsAtMs = new Date(breakRecoveryAssessment.assessmentEndsAt).getTime();
    const delayMs = Math.max(0, assessmentEndsAtMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      if (breakRecoveryAssessmentRef.current?.attemptId !== breakRecoveryAssessment.attemptId) return;
      recordBreakRecoveryOutcome(breakRecoveryAssessment, "recovered");
      breakRecoveryAssessmentRef.current = null;
      pendingBreakReturnAlarmRef.current = null;
      setBreakRecoveryAssessment(null);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [breakRecoveryAssessment, recordBreakRecoveryOutcome]);

  useEffect(() => {
    window.localStorage.setItem(AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY, showAiClassificationImpact ? "1" : "0");
  }, [showAiClassificationImpact]);

  useEffect(() => { watcherEventRef.current = watcherEvent; }, [watcherEvent]);

  useEffect(() => () => clearWatcherRecoveryTimer(), [clearWatcherRecoveryTimer]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void accessibilityClient.getStatus().then((nextStatus) => {
      setAccessibilityGranted(nextStatus.granted);
      setAccessibilityRequired(nextStatus.required);
      setHostPlatform(nextStatus.platform ?? "macos");
    }).catch(() => {
      // Permission errors remain visible through the explicit permissions flow;
      // the app shell keeps its conservative build-platform contract here.
    });
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    if (!consumePostUpdateRelaunchFocusPending()) return undefined;

    const timeoutId = window.setTimeout(() => {
      void invoke<void>("app_reveal_main_window").catch((nextError: unknown) => {
        console.warn("Unable to bring Drifty forward after update relaunch.", toErrorMessage(nextError));
      });
    }, POST_UPDATE_RELAUNCH_FOCUS_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen("tray-open-settings", openSettingsTab).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [openSettingsTab]);

  // The native menu's trial row opens Account. Its expired form reads "View plans",
  // so it also opens the Pro sheet on top, like every other View plans entry; the
  // remaining-days form is a status line and opens Account alone.
  const openTrialRowFromMenuRef = useRef(openAccountSettings);
  openTrialRowFromMenuRef.current = () => {
    openAccountSettings();
    if (billingEntitlement?.status === "locked" && billingEntitlement.lockedReason === "trial_expired") handleOpenUpgradePlanModal();
  };
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen("tray-open-account-settings", () => openTrialRowFromMenuRef.current()).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    });
    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen("tray-check-for-updates", handleManualCheckForUpdates).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [handleManualCheckForUpdates]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen("app-menu-toggle-dev-mode", handleAppMenuToggleDevMode).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [handleAppMenuToggleDevMode]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen("app-menu-check-latest-build", handleAppMenuCheckLatestBuild).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [handleAppMenuCheckLatestBuild]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen("app-menu-open-whats-new", openWhatsNew).then((nextUnlisten) => {
      if (disposed) {
        cleanupTauriEventListener(nextUnlisten);
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      cleanupTauriEventListener(unlisten);
    };
  }, [openWhatsNew]);

  useEffect(() => {
    if (!manualUpdateNoticeVisible) return undefined;
    if (updaterChecking) return undefined;
    if (!updaterMessage && !updaterError) return undefined;

    const timeoutId = window.setTimeout(() => setManualUpdateNoticeVisible(false), MANUAL_UPDATE_STATUS_NOTICE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [manualUpdateNoticeVisible, updaterChecking, updaterError, updaterMessage]);

  useEffect(() => {
    if (!latestBuildNoticeVisible) return undefined;
    if (developerPreReleaseUpdateController.busy) return undefined;
    if (!developerPreReleaseUpdateController.message && !developerPreReleaseUpdateController.error) return undefined;

    const timeoutId = window.setTimeout(() => setLatestBuildNoticeVisible(false), MANUAL_UPDATE_STATUS_NOTICE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [
    developerPreReleaseUpdateController.busy,
    developerPreReleaseUpdateController.error,
    developerPreReleaseUpdateController.message,
    latestBuildNoticeVisible,
  ]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void listenToNativeEndOfDayReviewAction(handleEndOfDayReviewAction).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        cleanupTauriEventListener(unlisten);
        return;
      }
      unlisteners.push(unlisten);
    });

    /* The Companion already wrote the acknowledgement into the shared webview
       storage; this mirror covers surfaces with their own storage. */
    void listenToNativeEndOfDayReviewDisplayed((day) => {
      acknowledgeDayReview(day, new Date().toISOString());
    }).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        cleanupTauriEventListener(unlisten);
        return;
      }
      unlisteners.push(unlisten);
    });

    /* An unseen card leaves the day waiting for an acknowledgement that will
       never come; the scheduler's next tick rebuilds it once. */
    void listenToNativeEndOfDayReviewDropped((day) => {
      recordDayReviewUnseen(day);
    }).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        cleanupTauriEventListener(unlisten);
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeCompanionVisibilityAction(handleCompanionVisibilityAction).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        cleanupTauriEventListener(unlisten);
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeWatcherResponse(handleWatcherResponse).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        cleanupTauriEventListener(unlisten);
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeWatcherDismissed(dismissWatcherPeek).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        cleanupTauriEventListener(unlisten);
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeDriftAlarmAction(handleDriftAlarmAction).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        cleanupTauriEventListener(unlisten);
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeDriftAlarmDismissed(handleDriftAlarmDismissed).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        cleanupTauriEventListener(unlisten);
        return;
      }
      unlisteners.push(unlisten);
    });

    return () => {
      disposed = true;
      unlisteners.forEach(cleanupTauriEventListener);
    };
  }, [dismissWatcherPeek, handleCompanionVisibilityAction, handleDriftAlarmAction, handleDriftAlarmDismissed, handleEndOfDayReviewAction, handleWatcherResponse]);

  const evaluateDriftAlarm = useCallback((input: DriftAlarmEvaluationInput) => {
    const checkedAt = input.checkedAt ?? new Date();
    const shouldUpdateRendererState = input.updateRendererState !== false;
    const alarmSnapshot = input.snapshot;
    const liveSegments = input.liveSegments;
    const evaluationToday = currentDriftAlarmDay();
    const baseSegments = driftAlarmBaseSegmentsRef.current;
    const driftAlarmSegments = liveSegments.length > 0
      ? mergeDriftAlarmSegments(baseSegments, liveSegments)
      : baseSegments;
    if (petModeActive && alarmSnapshot) {
      const observedAtMs = snapshotObservedAtMs(alarmSnapshot);
      if (shouldReplacePetModeLiveSnapshot(observedAtMs, petModeLiveObservedAtMsRef.current) && observedAtMs !== null) {
        petModeLiveObservedAtMsRef.current = observedAtMs;
        const livePetSnapshot = buildLiveWatcherSnapshot(
          alarmSnapshot,
          driftAlarmSegments,
          {
            includeAiClassifications: showAiClassificationImpact,
            includeBuiltInHeuristics: allowBuiltInHeuristics,
            builtInHeuristicsUnavailableSince,
            rules: classificationRules,
          },
        );
        petModeLiveSnapshotRef.current = livePetSnapshot;
        void updateNativePetMode(buildPetModeSnapshot(livePetSnapshot)).catch((nextError) => {
          console.warn("Failed to update Pet Mode snapshot", nextError);
        });
      }
    }
    const evaluation = buildDriftAlarmDebugEvaluationSummary({
      selectedDay: selectedDayRef.current,
      today: evaluationToday,
      currentSnapshot: alarmSnapshot,
      liveSegmentCount: liveSegments.length,
      storedSegmentCount: baseSegments.length,
      minimumDurationSeconds: driftAlertDelaySeconds,
    });
    const publishEvaluationDriftAlarmTrayStatus = (result: DriftAlarmTrayResult, statusCheckedAt: Date | null = checkedAt) => {
      publishDriftAlarmTrayStatus(result, statusCheckedAt, { updateRendererState: shouldUpdateRendererState });
    };
    const clearPendingTransientDriftAlarm = () => {
      pendingDriftAlarmTransientRef.current = null;
      clearPendingTransientRefresh();
    };
    const scheduleTransientRefresh = (delayMs: number) => {
      clearPendingTransientRefresh();
      pendingDriftAlarmTransientRefreshRef.current = window.setTimeout(() => {
        pendingDriftAlarmTransientRefreshRef.current = 0;
        const alarmDay = currentDriftAlarmDay();
        if (shouldUpdateRendererState && selectedDayRef.current === alarmDay) {
          void refresh(alarmDay, { requireCurrentSnapshot: true });
          return;
        }
        void refreshLiveDriftAlarmActivity(alarmDay);
      }, Math.max(0, delayMs));
    };
    if (!driftAlertsRuntimeEnabled) {
      recordDriftAlarmDebugEvent({
        kind: "evaluation_skipped",
        reason: "disabled",
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({ kind: "disabled" }, null);
      pendingDriftAlarmGateRef.current = null;
      pendingDriftAlarmGateGenerationRef.current += 1;
      lastEligibleDriftCandidateRef.current = null;
      driftAlarmSessionProtectionRef.current = null;
      clearPendingTransientDriftAlarm();
      return;
    }
    if (!status?.running || trackerPauseIntentRef.current) {
      publishEvaluationDriftAlarmTrayStatus({ kind: "tracker_paused" }, null);
      clearPausedDriftAlarmRuntime();
      return;
    }
    // Once sent, native close cannot be withdrawn. A pause/restore may cancel
    // its presentation, but must never dispatch another close before it settles.
    if (nativeExtremeNudgeInFlightRef.current) return;

    const checkedAtMs = checkedAt.getTime();
    const previousSessionProtection = driftAlarmSessionProtectionRef.current;
    driftAlarmSessionProtectionRef.current = advanceDriftAlarmSessionProtection(
      previousSessionProtection,
      alarmSnapshot,
      Number.isFinite(checkedAtMs) ? checkedAtMs : Date.now(),
    );
    const justExpiredSessionProtection = previousSessionProtection !== null
      && driftAlarmSessionProtectionRef.current === null
      ? previousSessionProtection
      : null;

    const systemTransientActivity = alarmSnapshot?.systemTransientActivity ?? null;
    const driftAlarmClassificationOptions = {
      fallbackCandidates: driftAlarmSegments,
      includeAiClassifications: showAiClassificationImpact,
      includeBuiltInHeuristics: allowBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
      rules: classificationRules,
    } satisfies ClassificationOptions;
    const driftAlarmFocusTargets = buildRecentFocusTargets(
      driftAlarmSegments,
      driftAlarmHistorySegmentsRef.current,
      driftAlarmClassificationOptions,
      appIconsRef.current,
      siteIconsRef.current,
    );

    const availableDriftAlarmFocusTargetsForAlarm = availableDriftAlarmFocusTargets.length > 0
      ? availableDriftAlarmFocusTargets
      : filterDefinitelyAvailableFocusTargets(driftAlarmFocusTargets);
    // Probe without the configured delay so reentry starts when first seen,
    // rather than when the old analysis episode has already paid that delay.
    const recovery = automaticCloseReentryRef.current;
    const potentialReentry = recovery ? buildDriftAlarmCandidates({
      segments: driftAlarmSegments,
      currentSnapshot: alarmSnapshot,
      classificationOptions: driftAlarmClassificationOptions,
      minimumDurationSeconds: 0,
    })[0] ?? null : null;
    const reentryProbe = potentialReentry && canApplyExtremeNudgeToSurface({
      segment: potentialReentry.segment, category: potentialReentry.category,
      classificationSource: potentialReentry.classification.source, aiConfirmedDrift: true,
    }) ? potentialReentry : null;
    const reentry = recovery ? observeAutomaticCloseReentry(
      recovery, reentryProbe, alarmSnapshot, Date.now(), driftAlertDelaySeconds,
    ) : null;
    if (reentry) automaticCloseReentryRef.current = reentry.state;
    const driftCandidates = buildDriftAlarmCandidates({
      segments: driftAlarmSegments,
      currentSnapshot: alarmSnapshot,
      classificationOptions: driftAlarmClassificationOptions,
      minimumDurationSeconds: driftAlertDelaySeconds,
    });
    const liveDrift = driftCandidates[0] ?? null;
    if (liveDrift && systemTransientActivity === null) {
      lastEligibleDriftCandidateRef.current = liveDrift;
    }
    const latestDrift = liveDrift ?? (systemTransientActivity ? lastEligibleDriftCandidateRef.current : null);
    if (latestDrift) {
      recordDriftAlarmDebugEvent({
        kind: "candidate_detected",
        alertKey: latestDrift.alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        currentSnapshot: summarizeDriftAlarmSnapshot(alarmSnapshot),
        evaluation,
      });
    }
    const activeSnooze = driftAlarmSnooze ?? driftAlarmSnoozeRef.current;
    if (activeSnooze !== null) {
      recordDriftAlarmDebugEvent({
        kind: "delivery_suppressed",
        alertKey: latestDrift?.alertKey ?? null,
        reason: "snoozed",
        candidate: latestDrift ? summarizeDriftAlarmCandidate(latestDrift) : null,
        evaluation,
      });
      pendingDriftAlarmGateRef.current = null;
      pendingDriftAlarmGateGenerationRef.current += 1;
      clearPendingTransientDriftAlarm();
      publishEvaluationDriftAlarmTrayStatus({
        kind: "snoozed",
        detail: `Until ${formatTimeLabel(new Date(activeSnooze.untilMs))}`,
      }, checkedAt);
      if (Date.now() < activeSnooze.untilMs) return;
      return;
    }

    if (!latestDrift) {
      const liveAiCandidate = systemTransientActivity === null && classificationAvailability.state === "ready"
        ? resolveLiveDriftAlarmAiCandidate({
          segments: driftAlarmSegments,
          currentSnapshot: alarmSnapshot,
          classificationOptions: driftAlarmClassificationOptions,
          minimumDurationSeconds: driftAlertDelaySeconds,
        })
        : null;

      if (liveAiCandidate) {
        recordDriftAlarmDebugEvent({
          kind: "live_ai_candidate_detected",
          alertKey: liveAiCandidate.key,
          segment: summarizeDriftAlarmSegment(liveAiCandidate.segment, liveAiCandidate.sourceSegmentId),
          currentSnapshot: summarizeDriftAlarmSnapshot(alarmSnapshot),
          evaluation,
        });
        const liveAiCandidateDetail = buildDriftAlarmTrayCandidateDetail(
          getWatcherContextLabel(liveAiCandidate.segment, "unknown"),
          liveAiCandidate.segment.durationSeconds,
        );
        const liveAiRetryAfterMs = liveDriftAlarmAiRetryAfterRef.current.get(liveAiCandidate.key) ?? 0;
        if (liveAiRetryAfterMs > Date.now()) {
          recordDriftAlarmDebugEvent({
            kind: "delivery_suppressed",
            alertKey: liveAiCandidate.key,
            reason: "ai-unavailable:retry-cooldown",
            segment: summarizeDriftAlarmSegment(liveAiCandidate.segment, liveAiCandidate.sourceSegmentId),
            evaluation,
          });
          publishEvaluationDriftAlarmTrayStatus({
            kind: "suppressed",
            reason: "ai-unavailable:retry-cooldown",
            candidateDetail: liveAiCandidateDetail,
          }, checkedAt);
          return;
        }

        publishEvaluationDriftAlarmTrayStatus({ kind: "checking", candidateDetail: liveAiCandidateDetail }, checkedAt);
        if (liveDriftAlarmAiRequestInFlightRef.current === null) {
          liveDriftAlarmAiRequestInFlightRef.current = liveAiCandidate.key;
          recordDriftAlarmDebugEvent({
            kind: "live_ai_request_started",
            alertKey: liveAiCandidate.key,
            segment: summarizeDriftAlarmSegment(liveAiCandidate.segment, liveAiCandidate.sourceSegmentId),
            evaluation,
          });
          const providerKeyAtStart = aiClassificationProviderKey;
          const liveAiOptions = selectedLocalAiClassificationOptions
            ? {
              ...selectedLocalAiClassificationOptions,
              persistLiveResult: true,
              contextSegments: driftAlarmSegments,
              persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart,
            }
            : {
              persistLiveResult: true,
              contextSegments: driftAlarmSegments,
              persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart,
            };
          const liveAiProviderKind = toAiProviderAnalytics(Boolean(selectedLocalAiClassificationOptions), canUseSelectedCloudAiClassification);
          const refreshAfterLiveAiClassification = async () => {
            const alarmDay = currentDriftAlarmDay();
            if (shouldUpdateRendererState && selectedDayRef.current === alarmDay) {
              await refresh(alarmDay, { requireCurrentSnapshot: true });
              return;
            }
            void refreshLiveDriftAlarmActivity(alarmDay);
          };
          void classifyLiveActivityWithAi(liveAiCandidate.segment, liveAiOptions).then(async (result) => {
            if (liveDriftAlarmAiRequestInFlightRef.current !== liveAiCandidate.key) return;
            liveDriftAlarmAiRequestInFlightRef.current = null;
            recordDriftAlarmDebugEvent({
              kind: "live_ai_result",
              alertKey: liveAiCandidate.key,
              segment: summarizeDriftAlarmSegment(liveAiCandidate.segment, liveAiCandidate.sourceSegmentId),
              ai: summarizeLiveAiClassificationResult(result),
              evaluation,
            });

            switch (result.kind) {
              case "classified":
                captureAiClassificationRunOncePerDay({
                  trigger: "live",
                  provider_kind: liveAiProviderKind,
                  result: "success",
                  selected_count_bucket: "1",
                  saved_count_bucket: result.classification.category === "unknown" ? "none" : "1",
                  range: "current_day",
                });
                if (result.classification.category === "unknown") {
                  pruneExpiredDriftAlarmAiRetries(liveDriftAlarmAiRetryAfterRef.current, Date.now());
                  liveDriftAlarmAiRetryAfterRef.current.set(liveAiCandidate.key, Date.now() + LIVE_DRIFT_ALARM_AI_UNKNOWN_RETRY_MS);
                } else {
                  liveDriftAlarmAiRetryAfterRef.current.delete(liveAiCandidate.key);
                }
                await refreshAfterLiveAiClassification();
                return;
              case "unavailable":
                captureAiClassificationRunOncePerDay({
                  trigger: "live",
                  provider_kind: liveAiProviderKind,
                  result: "unavailable",
                  selected_count_bucket: "1",
                  saved_count_bucket: "none",
                  range: "current_day",
                  error_kind: toAnalyticsErrorKind(result.reason),
                });
                pruneExpiredDriftAlarmAiRetries(liveDriftAlarmAiRetryAfterRef.current, Date.now());
                liveDriftAlarmAiRetryAfterRef.current.set(liveAiCandidate.key, Date.now() + LIVE_DRIFT_ALARM_AI_UNAVAILABLE_RETRY_MS);
                publishEvaluationDriftAlarmTrayStatus({
                  kind: "suppressed",
                  reason: `ai-unavailable:${result.reason}`,
                  candidateDetail: liveAiCandidateDetail,
                }, new Date());
                if (shouldUpdateRendererState && selectedDayRef.current === currentDriftAlarmDay()) {
                  await refresh(currentDriftAlarmDay(), { requireCurrentSnapshot: true });
                }
                return;
              default:
                assertNever(result);
            }
          }).catch((error) => {
            if (liveDriftAlarmAiRequestInFlightRef.current !== liveAiCandidate.key) return;
            liveDriftAlarmAiRequestInFlightRef.current = null;
            pruneExpiredDriftAlarmAiRetries(liveDriftAlarmAiRetryAfterRef.current, Date.now());
            liveDriftAlarmAiRetryAfterRef.current.set(liveAiCandidate.key, Date.now() + LIVE_DRIFT_ALARM_AI_UNAVAILABLE_RETRY_MS);
            recordDriftAlarmDebugEvent({
              kind: "live_ai_error",
              alertKey: liveAiCandidate.key,
              message: toErrorMessage(error),
              segment: summarizeDriftAlarmSegment(liveAiCandidate.segment, liveAiCandidate.sourceSegmentId),
              ai: {
                resultKind: "error",
                category: null,
                productivity: null,
                confidence: null,
                source: null,
                model: null,
                promptVersion: null,
                reason: toErrorMessage(error),
              },
              evaluation,
            });
            captureAiClassificationRunOncePerDay({
              trigger: "live",
              provider_kind: liveAiProviderKind,
              result: "error",
              selected_count_bucket: "1",
              saved_count_bucket: "none",
              range: "current_day",
              error_kind: toAnalyticsErrorKind(error),
            });
            publishEvaluationDriftAlarmTrayStatus({
              kind: "error",
              reason: error instanceof Error ? error.message : "Live AI classification failed",
            }, new Date());
          });
        }
        return;
      }

      const pendingTransient = pendingDriftAlarmTransientRef.current;
      if (pendingTransient && systemTransientActivity) {
        publishEvaluationDriftAlarmTrayStatus({
          kind: "deferred",
          reason: pendingTransient.systemTransientActivity,
          candidateDetail: pendingTransient.candidateDetail,
        }, checkedAt);
        scheduleTransientRefresh(Math.max(1_000, pendingTransient.readyAtMs - Date.now()));
        return;
      }
      recordDriftAlarmDebugEvent({
        kind: "candidate_missing",
        currentSnapshot: summarizeDriftAlarmSnapshot(alarmSnapshot),
        candidateProbe: buildDriftAlarmCandidateProbe({
          segments: driftAlarmSegments,
          currentSnapshot: alarmSnapshot,
          classificationOptions: driftAlarmClassificationOptions,
          minimumDurationSeconds: driftAlertDelaySeconds,
          liveAiAvailable: classificationAvailability.state === "ready",
          systemTransientActivity,
        }),
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({ kind: "no_candidate" }, checkedAt);
      unavailableYouTubeDriftAlarmGateRef.current = null;
      const pendingClose = pendingExtremeNudgeRef.current;
      const preservePendingClose = pendingClose !== null
        && automaticCloseEnabledRef.current
        && lastDriftAlertSegmentRef.current === pendingClose.alertKey
        && getUnconfirmedDriftAlarmReason(pendingClose.candidate, alarmSnapshot) === "current-snapshot-unavailable";
      const caughtPetGrace = petInterceptionGraceRef.current;
      const preserveCaughtPetGrace = caughtPetGrace !== null
        && automaticCloseEnabledRef.current
        && isPetInterceptionGraceActive(caughtPetGrace, caughtPetGrace.episodeKey)
        && getUnconfirmedDriftAlarmReason(caughtPetGrace.candidate, alarmSnapshot) === "current-snapshot-unavailable";
      pendingDriftAlarmGateRef.current = null;
      pendingDriftAlarmGateGenerationRef.current += 1;
      lastEligibleDriftCandidateRef.current = null;
      clearPendingTransientDriftAlarm();
      // Missing capture is not proof that the pending target changed. Retain
      // only its delivery key until that attempt settles; a verified change or
      // pause still retires it and later capture loss cannot resurrect it.
      if (!preservePendingClose) {
        lastDriftAlertSegmentRef.current = null;
        pendingExtremeNudgeRef.current = null;
      }
      driftAlarmReminderRef.current = null;
      // A missing address cannot revoke a real catch. Keep its own target
      // through consecutive capture gaps without extending the deadline or
      // retaining a stale candidate for other delivery paths.
      if (!preserveCaughtPetGrace) petInterceptionGraceRef.current = null;
      if (driftAlarmSnoozeRef.current !== null) {
        driftAlarmSnoozeRef.current = null;
        setDriftAlarmSnooze(null);
      }
      return;
    }

    const browserReentry = automaticCloseEnabled && reentry !== null && Boolean(reentryProbe?.segment.browserName);
    if (browserReentry && (pendingExtremeNudgeRef.current !== null
      || (!reentry.ready && (reentry.state.entry !== null || lastDriftAlertSegmentRef.current !== latestDrift.alertKey)))) {
      pendingDriftAlarmGateRef.current = null;
      pendingDriftAlarmGateGenerationRef.current += 1;
      publishEvaluationDriftAlarmTrayStatus({
        kind: "suppressed", reason: "automatic-close-recovery", candidateDetail: null,
      }, checkedAt);
      return;
    }
    const { alertKey, episodeKey } = latestDrift;
    let deliveryCandidate = latestDrift;
    let confirmedCurrentSnapshot: CurrentActivitySnapshot | null = null;
    let { category, segment } = deliveryCandidate;
    let deliveryDriftDurationSeconds = deliveryCandidate.driftDurationSeconds;
    let deliverySourceSegmentId = deliveryCandidate.sourceSegmentId;
    let confirmedDecisionClassification = latestDrift.classification;
    const candidateDetail = buildDriftAlarmTrayCandidateDetail(
      getWatcherContextLabel(segment, category),
      latestDrift.driftDurationSeconds,
    );
    const sessionProtectionReason = driftAlarmSessionSuppressionReason(
      driftAlarmSessionProtectionRef.current,
      justExpiredSessionProtection,
      segment,
    );
    if (sessionProtectionReason) {
      recordDriftAlarmDebugEvent({
        kind: "delivery_suppressed",
        alertKey,
        reason: sessionProtectionReason,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        currentSnapshot: summarizeDriftAlarmSnapshot(alarmSnapshot),
        evaluation,
      });
      pendingDriftAlarmGateRef.current = null;
      pendingDriftAlarmGateGenerationRef.current += 1;
      lastEligibleDriftCandidateRef.current = null;
      lastDriftAlertSegmentRef.current = null;
      driftAlarmReminderRef.current = null;
      petInterceptionGraceRef.current = null;
      clearPendingTransientDriftAlarm();
      publishEvaluationDriftAlarmTrayStatus({
        kind: "suppressed",
        reason: sessionProtectionReason,
        candidateDetail,
      }, checkedAt);
      return;
    }
    if (isQuietHoursActiveAt(new Date(), quietHoursRef.current)) {
      // Quiet hours pause the card, the notification, and automatic close.
      // Nothing about the episode is consumed, so the same drift delivers on
      // the first poll after the window closes.
      /* Record the episode once. A quiet night on one site would otherwise
         write a suppression every poll and push real intervention history out
         of the 30-day ledger; the tray still refreshes on every check. */
      if (quietHoursSuppressedAlertKeyRef.current !== alertKey) {
        quietHoursSuppressedAlertKeyRef.current = alertKey;
        recordDriftAlarmDebugEvent({
          kind: "delivery_suppressed",
          alertKey,
          reason: "quiet-hours",
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
      }
      publishEvaluationDriftAlarmTrayStatus({
        kind: "suppressed",
        reason: "quiet-hours",
        candidateDetail,
      }, checkedAt);
      return;
    }
    quietHoursSuppressedAlertKeyRef.current = null;
    const transientDecision = resolveDriftAlarmTransientDefer({
      pending: pendingDriftAlarmTransientRef.current,
      candidate: {
        alertKey,
        sourceKey: sourceKeyForDriftAlarmCandidate({
          segmentId: segment.id,
          sourceSegmentId: latestDrift.sourceSegmentId,
        }),
        candidateDetail,
      },
      systemTransientActivity,
      nowMs: Date.now(),
    });
    switch (transientDecision.kind) {
      case "defer":
        pendingDriftAlarmGateRef.current = null;
        pendingDriftAlarmGateGenerationRef.current += 1;
        pendingDriftAlarmTransientRef.current = transientDecision.pending;
        publishEvaluationDriftAlarmTrayStatus({
          kind: "deferred",
          reason: transientDecision.pending.systemTransientActivity,
          candidateDetail,
        }, checkedAt);
        scheduleTransientRefresh(Math.max(1_000, transientDecision.pending.readyAtMs - Date.now()));
        return;
      case "await_delay":
        pendingDriftAlarmGateRef.current = null;
        pendingDriftAlarmGateGenerationRef.current += 1;
        pendingDriftAlarmTransientRef.current = transientDecision.pending;
        publishEvaluationDriftAlarmTrayStatus({
          kind: "deferred",
          reason: transientDecision.pending.systemTransientActivity,
          candidateDetail,
        }, checkedAt);
        scheduleTransientRefresh(transientDecision.remainingMs);
        return;
      case "expired":
        pendingDriftAlarmGateRef.current = null;
        pendingDriftAlarmGateGenerationRef.current += 1;
        pendingDriftAlarmTransientRef.current = null;
        clearPendingTransientRefresh();
        lastDriftAlertSegmentRef.current = alertKey;
        publishEvaluationDriftAlarmTrayStatus({
          kind: "suppressed",
          reason: "system-transient-defer-expired",
          candidateDetail,
        }, checkedAt);
        return;
      case "cancel":
        pendingDriftAlarmTransientRef.current = null;
        clearPendingTransientRefresh();
        break;
      case "ready":
        pendingDriftAlarmTransientRef.current = null;
        clearPendingTransientRefresh();
        break;
      case "inactive":
        break;
      default:
        assertNever(transientDecision);
    }
    const currentGrace = petInterceptionGraceRef.current;
    if (isPetInterceptionGraceActive(currentGrace, episodeKey)) {
      // A catch vetoes delivery for the full grace period. Stop here before
      // any AI delivery gate so background polls neither resend the pet nor
      // spend provider work on a close that cannot run yet.
      lastDriftAlertSegmentRef.current = null;
      recordDriftAlarmDebugEvent({
        kind: "delivery_suppressed",
        alertKey,
        reason: "pet_intercept_grace",
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({
        kind: "suppressed",
        reason: "pet_intercept_grace",
        candidateDetail,
      }, checkedAt);
      return;
    }
    if (currentGrace !== null) petInterceptionGraceRef.current = null;
    const buildCurrentDriftAlarmEvent = (
      focusTargets: readonly DriftAlarmFocusTarget[] = availableDriftAlarmFocusTargetsForAlarm,
      petIntercepted = false,
      breakReturnAlarm: DriftAlarmBreakSnooze | null = null,
    ) => {
      const contextLabel = getWatcherContextLabel(segment, category);
      const sourceSiteDomain = segment.siteDomain?.trim() ?? null;
      const sourceAppName = segment.appName.trim() || "Unknown app";
      const sourceIconKey = segment.bundleId?.trim() ?? sourceAppName;
      // Resolve the site icon here: the Companion alert surface has no site-icon lookup context.
      const sourceIconSrc = (sourceSiteDomain ? siteIconsRef.current[sourceSiteDomain.toLowerCase()] : null)
        ?? appIconsRef.current[sourceIconKey]
        ?? appIconsRef.current[sourceAppName]
        ?? null;
      const sourceSegmentId = deliverySourceSegmentId ?? segment.id;
      rememberDriftAlarmSourceSegment(driftAlarmSourceSegmentsRef.current, sourceSegmentId, segment);

      if (breakReturnAlarm && !petIntercepted) {
        return buildBreakReturnAlarmEvent({
          id: `break-return:${alertKey}:${breakReturnAlarm.untilMs}`,
          contextLabel,
          driftDurationSeconds: deliveryDriftDurationSeconds,
          preservedFocusStrikeSeconds: 0,
          generatedAt: new Date().toISOString(),
          focusTargets,
          sourceSiteDomain,
          sourceAppName,
          sourceIconSrc,
          copySettings: driftAlarmCopy,
          language: companionLanguage,
          sourceSegmentId,
          decisionClassification: confirmedDecisionClassification,
          breakDurationMinutes: breakReturnAlarm.minutes,
          pausedFromLabel: breakReturnAlarm.pausedFromLabel,
          nextFocusLabel: focusTargets[0]?.label ?? "",
        });
      }

      return buildDriftAlarmEvent({
        id: alertKey,
        contextLabel,
        driftDurationSeconds: deliveryDriftDurationSeconds,
        preservedFocusStrikeSeconds: 0,
        generatedAt: new Date().toISOString(),
        focusTargets,
        sourceSiteDomain,
        sourceAppName,
        sourceIconSrc,
        copySettings: driftAlarmCopy,
        language: companionLanguage,
        sourceSegmentId,
        decisionClassification: confirmedDecisionClassification,
        petIntercepted,
      });
    };
    const showCurrentDriftAlarm = (
      petIntercepted = false,
      breakReturnAlarm: DriftAlarmBreakSnooze | null = null,
    ) => {
      showDriftAlarm(buildCurrentDriftAlarmEvent(
        breakReturnAlarm?.focusTargets.length
          ? breakReturnAlarm.focusTargets
          : availableDriftAlarmFocusTargetsForAlarm,
        petIntercepted,
        breakReturnAlarm,
      ));
    };
    const markCurrentDriftAlarmDelivered = () => {
      // Every real card or toast restarts the reminder clock for this episode.
      const reminder = scheduleDriftAlarmReminder(
        driftAlarmReminderRef.current,
        episodeKey,
        Date.now(),
      );
      driftAlarmReminderRef.current = reminder;
      recordDriftAlarmDebugEvent({
        kind: "delivery_delivered",
        alertKey,
        message: reminder.nextReminderAtMs === null
          ? null
          : `reminder ${reminder.reminderCount} at ${new Date(reminder.nextReminderAtMs).toISOString()}`,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({ kind: "delivered", candidateDetail }, checkedAt);
    };
    /* The host notification is opt-in beside the card. When the switch is
       on it accompanies every drift card for this episode, including
       reminders; the card-failure fallback lives in showDriftAlarm. */
    const sendUserEnabledDriftNotification = () => {
      if (!macosNotificationEnabledRef.current) return;
      recordDriftAlarmDebugEvent({
        kind: "native_notification_requested",
        alertKey,
        message: "user_enabled",
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      void sendDriftNotification(segment, driftAlarmCopy, companionLanguage).catch((error: unknown) => {
        recordDriftAlarmDebugEvent({
          kind: "native_notification_failed",
          alertKey,
          message: toErrorMessage(error),
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
      });
    };
    const showFallbackDriftAlarm = (
      notify: boolean,
      petIntercepted = false,
      breakReturnAlarm: DriftAlarmBreakSnooze | null = null,
    ) => {
      showCurrentDriftAlarm(petIntercepted, breakReturnAlarm);
      markCurrentDriftAlarmDelivered();
      if (notify) sendUserEnabledDriftNotification();
    };
    const applyCurrentExtremeNudge = (
      notifyOnFallback: boolean,
      breakReturnAlarm: DriftAlarmBreakSnooze | null = null,
    ) => {
      lastDriftAlertSegmentRef.current = alertKey;
      const pendingClose = { alertKey, candidate: latestDrift };
      pendingExtremeNudgeRef.current = pendingClose;
      recordDriftAlarmDebugEvent({
        kind: "extreme_nudge_started",
        alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      const closeStillAuthorized = () => automaticCloseEnabledRef.current
        && !trackerPauseIntentRef.current
        // Quiet hours can begin while the native approach or fresh read waits.
        && !isQuietHoursActiveAt(new Date(), quietHoursRef.current)
        && pendingExtremeNudgeRef.current === pendingClose
        && (driftAlarmSnoozeRef.current === null || Date.now() >= driftAlarmSnoozeRef.current.untilMs);
      const cancelledCloseResult = () => ({
        applied: false as const,
        diagnostic: !automaticCloseEnabledRef.current || trackerPauseIntentRef.current || driftAlarmSnoozeRef.current || driftAlarmSessionProtectionRef.current
          || isQuietHoursActiveAt(new Date(), quietHoursRef.current)
          ? "automatic_close_paused" : "pet_target_changed",
      });
      let targetConfirmedAfterApproach = false;
      let petWasIntercepted = false;
      let petInterventionId: string | null = null;
      const runExtremeNudge = async () => {
        if (!closeStillAuthorized()) {
          return cancelledCloseResult();
        }
        if (petModeActive) {
          petInterventionId = `${alertKey}:pet:${crypto.randomUUID()}`;
          const intervention = await playNativePetModeIntervention(buildPetModeInterventionTarget({
            id: petInterventionId,
            appName: segment.appName,
            browserName: segment.browserName,
            browserIdentity: segment.bundleId,
            siteDomain: segment.siteDomain,
            siteUrl: buildExtremeNudgeTarget(segment, { confirmedCurrentSnapshot }).siteUrl,
          }));
          petWasIntercepted = intervention.outcome === "user_intercepted";
          // A pause can arrive while the cat approaches. A sleeping renderer's
          // cancellation is user intent, not a reason to close without the cat.
          if (!closeStillAuthorized()) return cancelledCloseResult();
          // The paw contact frame is the stated cause of the close. When the
          // user catches the cat before that frame, nothing has pressed the X,
          // so closing anyway would make the whole animation a lie. Hand the
          // moment to the companion instead of destroying a tab or an app.
          //
          // Only a real catch earns that mercy. A silent renderer rejection,
          // an over-budget approach, or a hung webview is a technical failure
          // of the animation, not a user decision: skip the theatre and run
          // the close the user turned on. A verified context change is handled
          // separately below because the original target is no longer safe to
          // close. (Observed 2026-08-29: an 8-second contact timeout was misread
          // as a catch and the drift tab survived with only the companion card
          // showing.)
          if (intervention.outcome === "user_intercepted") {
            return { applied: false, diagnostic: "pet_intercepted" } as const;
          }
          if (intervention.outcome !== "contacted") {
            recordDriftAlarmDebugEvent({
              kind: "extreme_nudge_pet_skipped",
              alertKey,
              reason: intervention.outcome,
              message: intervention.reason === null
                ? `elapsedMs=${intervention.elapsedMs}`
                : `${intervention.reason} elapsedMs=${intervention.elapsedMs}`,
              candidate: summarizeDriftAlarmCandidate(latestDrift),
              evaluation,
            });
          }
          // An expired/blocked read recovery proves neither native readiness
          // nor a user catch. Keep the fallback without starting another action.
          if (intervention.reason === "target_unavailable:windows_uia_geometry_recovery_timeout"
            || intervention.reason === "target_unavailable:windows_uia_geometry_recovery_blocked") {
            return { applied: false, diagnostic: "pet_geometry_unavailable" } as const;
          }
          // Focus or another non-drift context can become current during the
          // native approach. That is neither a catch nor a technical failure:
          // the target is no longer current, so do not close it in the
          // background and do not create a catch grace for an unrelated target.
          if (intervention.outcome === "cancelled") {
            return { applied: false, diagnostic: "pet_context_changed" } as const;
          }
          // The renderer can observe broad context changes, but it does not
          // receive the exact local activity identity. Re-check after every
          // approach (including an 8s timeout) so a tab/app that was current
          // before the animation can never be closed after the user moved on.
          const postInterventionGateResult = await confirmPetTargetWithRecovery({
            confirm: confirmFreshDriftAlarmCandidate,
            isAuthorized: closeStillAuthorized,
            retryUnavailable: Boolean(segment.browserName),
          });
          if (!closeStillAuthorized() || postInterventionGateResult === "cancelled") return cancelledCloseResult();
          if (postInterventionGateResult === "current-snapshot-unavailable") {
            // Fail closed when the tracker cannot prove the target is still
            // current, but keep the ordinary fallback alarm visible. Treating
            // telemetry loss as a context change would silently reproduce the
            // user's "Automatic close did nothing" symptom.
            return { applied: false, diagnostic: "pet_target_unverified" } as const;
          }
          if (postInterventionGateResult !== "confirmed") {
            return { applied: false, diagnostic: "pet_target_changed" } as const;
          }
          targetConfirmedAfterApproach = true;
        }
        if (!closeStillAuthorized()) {
          return cancelledCloseResult();
        }
        if (browserReentry && !targetConfirmedAfterApproach) {
          const fresh = await confirmFreshDriftAlarmCandidate();
          if (!closeStillAuthorized()) return cancelledCloseResult();
          if (fresh !== "confirmed") return { applied: false, diagnostic: "pet_target_changed" } as const;
        }
        // Consume this reentry once. A failed native close earns a fallback
        // card, never another destructive attempt on every tracker poll.
        if (browserReentry) automaticCloseReentryRef.current = null;
        nativeExtremeNudgeInFlightRef.current = true;
        try {
          return await applyNativeExtremeNudge(buildExtremeNudgeTarget(segment, {
            confirmedCurrentSnapshot,
            forceChromiumAxTabClose: DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxExtremeNudgeEnabled,
          }));
        } finally {
          nativeExtremeNudgeInFlightRef.current = false;
        }
      };
      void runExtremeNudge().then(async (nativeResult) => {
        // Record the physical close before fullscreen/focus cleanup can wait.
        if (nativeResult.applied && segment.browserName) {
          automaticCloseReentryRef.current = { closedAtMs: Date.now(), entry: null };
        }

        if (petInterventionId) await completeNativePetFullscreenClose(petInterventionId).catch(() => undefined);
        const result = !nativeResult.applied && (!automaticCloseEnabledRef.current
          || isQuietHoursActiveAt(new Date(), quietHoursRef.current))
          ? { applied: false, diagnostic: "automatic_close_paused" } as const
          : nativeResult;
        recordDriftAlarmDebugEvent({
          kind: "extreme_nudge_result",
          alertKey,
          result: result.applied ? "applied" : "not_applied",
          reason: result.diagnostic,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        if (pendingExtremeNudgeRef.current !== pendingClose) {
          if (!result.applied && pendingExtremeNudgeRef.current === null && lastDriftAlertSegmentRef.current === alertKey
            && !driftAlarmSnoozeRef.current && !driftAlarmSessionProtectionRef.current) {
            lastDriftAlertSegmentRef.current = null;
          }
          return;
        }
        if (!result.applied) {
          if (lastDriftAlertSegmentRef.current === alertKey) {
            const intercepted = result.diagnostic === "pet_intercepted";
            const targetChanged = result.diagnostic === "pet_context_changed"
              || result.diagnostic === "pet_target_changed";
            if (targetChanged || result.diagnostic === "automatic_close_paused") {
              lastDriftAlertSegmentRef.current = null;
              // Quiet hours silence delivery without erasing a real catch.
              petInterceptionGraceRef.current = petWasIntercepted && automaticCloseEnabledRef.current
                ? { ...buildPetInterceptionGrace(episodeKey), candidate: deliveryCandidate } : null;
              publishEvaluationDriftAlarmTrayStatus({
                kind: "suppressed",
                reason: result.diagnostic,
                candidateDetail,
              }, new Date());
              return;
            }
            if (intercepted) {
              petInterceptionGraceRef.current = { ...buildPetInterceptionGrace(episodeKey), candidate: deliveryCandidate };
              lastDriftAlertSegmentRef.current = null;
            }
            // A caught cat is a deliberate user signal, not a delivery failure.
            // Reuse the same alarm surface, but never fire an OS notification
            // on top of it: the user is already looking at the screen and has a
            // hand on the pointer.
            showFallbackDriftAlarm(intercepted ? false : notifyOnFallback, intercepted, breakReturnAlarm);
          }
          return;
        }
        let resolvedDriftAlarmFocusTargets = availableDriftAlarmFocusTargetsForAlarm;
        try {
          resolvedDriftAlarmFocusTargets = await resolvePostCloseFocusTargets(
            driftAlarmFocusTargets,
            hostPlatform,
          );
        } catch (error: unknown) {
          if (error instanceof Error) {
            console.warn("Failed to resolve current drift alarm focus target availability", error);
          } else {
            console.warn("Failed to resolve current drift alarm focus target availability", String(error));
          }
        }
        if (pendingExtremeNudgeRef.current !== pendingClose) return;
        const driftAlarmEvent = buildCurrentDriftAlarmEvent(
          resolvedDriftAlarmFocusTargets,
          false,
          breakReturnAlarm,
        );
        driftAlarmEventRef.current = driftAlarmEvent;
        lastDriftAlarmEventRef.current = driftAlarmEvent;
        const latestFocusTarget = resolvedDriftAlarmFocusTargets[0] ?? null;
        const extremeNudgeToastEvent = buildExtremeNudgeToastEvent(segment, latestFocusTarget, driftAlarmCopy, driftAlarmEvent.breakOptions);
        lastExtremeNudgeToastEventRef.current = extremeNudgeToastEvent;
        // Persist delivery before the companion window starts recording its
        // own lifecycle. Both renderers share localStorage; launching the
        // native surface first lets its accepted event race this write and
        // erase the delivery receipt (and intervention-ledger entry).
        markCurrentDriftAlarmDelivered();
        void showNativeExtremeNudgeToast(extremeNudgeToastEvent).catch((error) => console.warn("Failed to show extreme nudge toast", error));
        if (latestFocusTarget) {
          window.setTimeout(() => {
            if (lastDriftAlertSegmentRef.current === alertKey) returnToFocusTarget(latestFocusTarget);
          }, 120);
        }
      }).catch(async (error) => {
        if (petInterventionId) await completeNativePetFullscreenClose(petInterventionId).catch(() => undefined);
        const failure = getExtremeNudgeFailure(error);
        console.warn("Failed to apply extreme nudge", failure.code);
        recordDriftAlarmDebugEvent({
          kind: "extreme_nudge_error",
          alertKey,
          reason: failure.code,
          message: failure.diagnostic,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        if (pendingExtremeNudgeRef.current !== pendingClose) return;
        if (lastDriftAlertSegmentRef.current === alertKey) {
          if (!automaticCloseEnabledRef.current || isQuietHoursActiveAt(new Date(), quietHoursRef.current)) {
            lastDriftAlertSegmentRef.current = null;
            petInterceptionGraceRef.current = null;
            publishEvaluationDriftAlarmTrayStatus({
              kind: "suppressed",
              reason: "automatic_close_paused",
              candidateDetail,
            }, new Date());
            return;
          }
          showFallbackDriftAlarm(notifyOnFallback, false, breakReturnAlarm);
        }
      }).finally(() => {
        if (pendingExtremeNudgeRef.current === pendingClose) pendingExtremeNudgeRef.current = null;
      });
    };

    const completeBreakRecoveryAssessment = (attempt: DriftAlarmBreakSnooze, outcome: BreakRecoveryOutcome) => {
      recordBreakRecoveryOutcome(attempt, outcome);
      if (breakRecoveryAssessmentRef.current?.attemptId !== attempt.attemptId) return;
      breakRecoveryAssessmentRef.current = null;
      setBreakRecoveryAssessment(null);
    };

    async function confirmFreshDriftAlarmCandidate(): Promise<"confirmed" | "current-window-changed" | "current-snapshot-unavailable" | "system-transient-active"> {
      let freshSnapshot: CurrentActivitySnapshot | null = null;
      try {
        freshSnapshot = await trackerClient.getCurrentSnapshot();
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn("Failed to refresh current activity before drift alarm", message);
        recordDriftAlarmDebugEvent({
          kind: "fresh_candidate_result",
          alertKey,
          result: "current-snapshot-unavailable",
          message,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          currentSnapshot: null,
          evaluation,
        });
        return "current-snapshot-unavailable";
      }

      if (shouldUpdateRendererState) setCurrentSnapshot(freshSnapshot);
      if (freshSnapshot?.systemTransientActivity) {
        recordDriftAlarmDebugEvent({
          kind: "fresh_candidate_result",
          alertKey,
          result: "system-transient-active",
          reason: freshSnapshot.systemTransientActivity,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          currentSnapshot: summarizeDriftAlarmSnapshot(freshSnapshot),
          evaluation,
        });
        return "system-transient-active";
      }

      // A normal poll can track the next Short while the cat approaches.
      // Refresh that Shorts episode without carrying an earlier video's
      // delivery verdict into a different ordinary YouTube video.
      const currentIsShorts = freshSnapshot !== null && isYouTubeShortsSegment({
        ...latestDrift.segment,
        siteDomain: freshSnapshot.siteDomain,
        siteUrl: freshSnapshot.siteUrl,
        youtubeIsShorts: freshSnapshot.youtubeIsShorts ?? null,
      });
      const freshSegments = currentIsShorts ? mergeDriftAlarmSegments(
        driftAlarmBaseSegmentsRef.current,
        liveDriftAlarmSegmentsRef.current,
      ) : driftAlarmSegments;
      const freshCandidate = resolveFreshDriftAlarmCandidate({
        candidate: latestDrift,
        segments: freshSegments,
        currentSnapshot: freshSnapshot,
        classificationOptions: { ...driftAlarmClassificationOptions, fallbackCandidates: freshSegments },
        minimumDurationSeconds: driftAlertDelaySeconds,
      });
      if (browserReentry && !reminderDelivery) {
        const currentRecovery = automaticCloseReentryRef.current;
        if (!currentRecovery || currentRecovery.closedAtMs !== recovery?.closedAtMs) return "current-window-changed";
        const freshReentry = observeAutomaticCloseReentry(
          currentRecovery, freshCandidate, freshSnapshot, Date.now(), driftAlertDelaySeconds,
        );
        automaticCloseReentryRef.current = freshReentry.state;
        if (!freshReentry.ready) return "current-snapshot-unavailable";
      }
      if (freshCandidate) {
        confirmedCurrentSnapshot = freshSnapshot;
        deliveryCandidate = freshCandidate;
        ({ category, segment } = deliveryCandidate);
        deliveryDriftDurationSeconds = deliveryCandidate.driftDurationSeconds;
        deliverySourceSegmentId = deliveryCandidate.sourceSegmentId;
        confirmedDecisionClassification = deliveryCandidate.classification;
      }
      const result = freshCandidate ? "confirmed" : getUnconfirmedDriftAlarmReason(latestDrift, freshSnapshot);
      recordDriftAlarmDebugEvent({
        kind: "fresh_candidate_result",
        alertKey,
        result,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        currentSnapshot: summarizeDriftAlarmSnapshot(freshSnapshot),
        evaluation,
      });
      return result;
    }

    let reminderDelivery = false;
    const deliverCurrentDriftAlarm = (aiConfirmedDrift = false) => {
      recordDriftAlarmDebugEvent({
        kind: "delivery_started",
        alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      const shouldApplyExtremeNudge = !reminderDelivery
        && automaticCloseEnabled
        && canApplyExtremeNudgeToSurface({
          segment,
          category,
          aiConfirmedDrift,
          classificationSource: confirmedDecisionClassification?.source ?? null,
        });
      const pendingBreakReturnAlarm = pendingBreakReturnAlarmRef.current;
      if (pendingBreakReturnAlarm) {
        // Break expiry ends the exact snooze. The separate 10-minute recovery
        // assessment is analytics, not hidden intervention grace: after the
        // fresh candidate gates pass, apply the user's current delivery policy.
        const outcome = resolveBreakRecoveryOutcome({
          attempt: pendingBreakReturnAlarm,
          driftCandidate: deliveryCandidate,
          nowMs: Date.now(),
        });
        if (outcome) completeBreakRecoveryAssessment(pendingBreakReturnAlarm, outcome);
        // Consume the pending context before starting an async close so the
        // next poll cannot launch a duplicate. The captured value still gives
        // every close-failure path the correct break-return fallback context.
        pendingBreakReturnAlarmRef.current = null;
        if (shouldApplyExtremeNudge) {
          applyCurrentExtremeNudge(false, pendingBreakReturnAlarm);
          return;
        }
        lastDriftAlertSegmentRef.current = alertKey;
        showCurrentDriftAlarm(false, pendingBreakReturnAlarm);
        markCurrentDriftAlarmDelivered();
        return;
      }

      const activeAssessment = breakRecoveryAssessmentRef.current;
      if (activeAssessment) {
        const outcome = resolveBreakRecoveryOutcome({
          attempt: activeAssessment,
          driftCandidate: deliveryCandidate,
          nowMs: Date.now(),
        });
        if (outcome) completeBreakRecoveryAssessment(activeAssessment, outcome);
      }

      if (lastDriftAlertSegmentRef.current === null) {
        if (shouldApplyExtremeNudge) {
          applyCurrentExtremeNudge(false);
          return;
        }
        lastDriftAlertSegmentRef.current = alertKey;
        showCurrentDriftAlarm();
        markCurrentDriftAlarmDelivered();
        sendUserEnabledDriftNotification();
        return;
      }
      if (lastDriftAlertSegmentRef.current === alertKey) {
        if (driftAlarmEventRef.current?.id === alertKey) {
          showCurrentDriftAlarm();
        }
        recordDriftAlarmDebugEvent({
          kind: "delivery_suppressed",
          alertKey,
          reason: "already_delivered",
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        publishEvaluationDriftAlarmTrayStatus({ kind: "already_delivered", candidateDetail }, checkedAt);
        return;
      }

      lastDriftAlertSegmentRef.current = alertKey;
      if (shouldApplyExtremeNudge) {
        applyCurrentExtremeNudge(true);
        return;
      }
      showCurrentDriftAlarm();
      markCurrentDriftAlarmDelivered();
      sendUserEnabledDriftNotification();
    };

    if (browserReentry && reentry.ready && !pendingExtremeNudgeRef.current
      && gateSuppressedDriftAlarmRef.current?.alertKey !== alertKey) {
      lastDriftAlertSegmentRef.current = null;
      driftAlarmReminderRef.current = null;
    }

    if (lastDriftAlertSegmentRef.current === alertKey && !pendingBreakReturnAlarmRef.current) {
      const reminderState = driftAlarmReminderRef.current;
      const gateSuppressed = gateSuppressedDriftAlarmRef.current;
      if (gateSuppressed?.alertKey === alertKey
        && DRIFT_ALARM_GATE_EXEMPT_SOURCES.has(latestDrift.classification.source)) {
        // The earlier suppression came from the AI gate, not from a delivered
        // alarm, and the verdict has since become one the gate never applies
        // to. Reopen the delivery path; a suppressed reminder stays a
        // reminder so automatic close is not attempted again.
        gateSuppressedDriftAlarmRef.current = null;
        lastDriftAlertSegmentRef.current = null;
        reminderDelivery = gateSuppressed.reminder;
        recordDriftAlarmDebugEvent({
          kind: "youtube_gate_started",
          alertKey,
          reason: `gate-suppression-released:${latestDrift.classification.source}`,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
      } else if (reminderState && isDriftAlarmReminderDue(reminderState, episodeKey, Date.now())) {
        // The card for this episode is long gone and the drift is still
        // going. Re-open the delivery path as if this were a first delivery,
        // except automatic close stays off: a reminder is a quiet card, not
        // a second attempt to destroy the same tab.
        driftAlarmReminderRef.current = consumeDriftAlarmReminder(reminderState);
        lastDriftAlertSegmentRef.current = null;
        reminderDelivery = true;
        recordDriftAlarmDebugEvent({
          kind: "delivery_reminder_due",
          alertKey,
          result: String(reminderState.reminderCount + 1),
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
      } else {
        if (driftAlarmEventRef.current?.id === alertKey) {
          showCurrentDriftAlarm();
        }
        recordDriftAlarmDebugEvent({
          kind: "delivery_suppressed",
          alertKey,
          reason: "already_delivered",
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        publishEvaluationDriftAlarmTrayStatus({ kind: "already_delivered", candidateDetail }, checkedAt);
        return;
      }
    }

    const unavailableGate = unavailableYouTubeDriftAlarmGateRef.current;
    if (unavailableGate?.alertKey === alertKey) {
      const exemptSource = DRIFT_ALARM_GATE_EXEMPT_SOURCES.has(latestDrift.classification.source);
      if (!exemptSource
        && (unavailableGate.videoId !== segment.youtubeVideoId || !selectedYouTubeDriftReason(segment))) {
      // A quota/availability failure is not a delivered alarm. Keep it quiet
      // until this same video gains metadata eligible for the AI-free gate;
      // ordinary polls must not retry AI or override an explicit AI verdict.
      recordDriftAlarmDebugEvent({
        kind: "delivery_suppressed",
        alertKey,
        reason: unavailableGate.reason,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({
        kind: "suppressed", reason: unavailableGate.reason, candidateDetail,
      }, checkedAt);
      return;
      }
      // Retrying the same episode keeps its reminder status: a reminder never
      // becomes a second automatic close.
      reminderDelivery = unavailableGate.reminder;
    }

    if (pendingDriftAlarmGateRef.current === alertKey) {
      recordDriftAlarmDebugEvent({
        kind: "delivery_suppressed",
        alertKey,
        reason: "youtube-gate-in-flight",
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      return;
    }
    if (pendingDriftAlarmGateRef.current !== null && pendingDriftAlarmGateRef.current !== alertKey) {
      pendingDriftAlarmGateRef.current = null;
      pendingDriftAlarmGateGenerationRef.current += 1;
    }

    unavailableYouTubeDriftAlarmGateRef.current = null;
    gateSuppressedDriftAlarmRef.current = null;
    pendingDriftAlarmGateRef.current = alertKey;
    const gateGeneration = pendingDriftAlarmGateGenerationRef.current;
    const isCurrentGateAttempt = () => (
      !trackerPauseIntentRef.current
      && pendingDriftAlarmGateRef.current === alertKey
      && pendingDriftAlarmGateGenerationRef.current === gateGeneration
    );
    recordDriftAlarmDebugEvent({
      kind: "youtube_gate_started",
      alertKey,
      candidate: summarizeDriftAlarmCandidate(latestDrift),
      evaluation,
    });
    publishEvaluationDriftAlarmTrayStatus({ kind: "checking", candidateDetail }, checkedAt);
    const providerKeyAtStart = aiClassificationProviderKey;
    void evaluateYouTubeDriftAlarmGate({
      segment,
      category,
      classificationSource: latestDrift.classification.source,
      allowAiClassification: classificationAvailability.state === "ready",
      aiOptions: {
        ...(selectedLocalAiClassificationOptions ?? {}),
        persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart,
      },
    }).then(async (gateResult) => {
      if (!isCurrentGateAttempt()) return;
      const applySettledGateResult = async (settledResult: YouTubeDriftAlarmGateSettledResult) => {
        if (!isCurrentGateAttempt()) return;
        recordDriftAlarmDebugEvent({
          kind: "youtube_gate_result",
          alertKey,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          ai: summarizeYouTubeDriftAlarmGateResult(settledResult),
          evaluation,
        });

        if (settledResult.kind === "suppress") {
          pendingDriftAlarmGateRef.current = null;
          pendingDriftAlarmGateGenerationRef.current += 1;
          if (settledResult.reason.startsWith("ai-unavailable:")
            && segment.youtubeVideoId
            && !selectedYouTubeDriftReason(segment)) {
            unavailableYouTubeDriftAlarmGateRef.current = {
              alertKey, videoId: segment.youtubeVideoId, reason: settledResult.reason, reminder: reminderDelivery,
            };
          } else {
            lastDriftAlertSegmentRef.current = alertKey;
            gateSuppressedDriftAlarmRef.current = { alertKey, reminder: reminderDelivery };
          }
          recordDriftAlarmDebugEvent({
            kind: "delivery_suppressed",
            alertKey,
            reason: settledResult.reason,
            candidate: summarizeDriftAlarmCandidate(latestDrift),
            ai: summarizeYouTubeDriftAlarmGateResult(settledResult),
            evaluation,
          });
          publishEvaluationDriftAlarmTrayStatus({
            kind: "suppressed",
            reason: settledResult.reason,
            candidateDetail,
          }, new Date());
          return;
        }

        const finalGateResult = await confirmFreshDriftAlarmCandidate();
        if (!isCurrentGateAttempt()) return;
        pendingDriftAlarmGateRef.current = null;
        pendingDriftAlarmGateGenerationRef.current += 1;

        if (finalGateResult === "system-transient-active") {
          recordDriftAlarmDebugEvent({
            kind: "delivery_suppressed",
            alertKey,
            reason: finalGateResult,
            candidate: summarizeDriftAlarmCandidate(latestDrift),
            evaluation,
          });
          return;
        }

        if (finalGateResult !== "confirmed") {
          recordDriftAlarmDebugEvent({
            kind: "delivery_suppressed",
            alertKey,
            reason: finalGateResult,
            candidate: summarizeDriftAlarmCandidate(latestDrift),
            evaluation,
          });
          publishEvaluationDriftAlarmTrayStatus({
            kind: "suppressed",
            reason: finalGateResult,
            candidateDetail,
          }, new Date());
          return;
        }

        deliverCurrentDriftAlarm(settledResult.kind === "allow_drift" && settledResult.aiConfirmed);
      };

      if (gateResult.kind === "pending") {
        recordDriftAlarmDebugEvent({
          kind: "youtube_gate_result",
          alertKey,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          ai: summarizeYouTubeDriftAlarmGateResult(gateResult),
          evaluation,
        });
        publishEvaluationDriftAlarmTrayStatus({ kind: "checking", candidateDetail }, checkedAt);
        void gateResult.settled.then(applySettledGateResult).catch((error) => {
          if (error instanceof Error) {
            console.warn("Failed to evaluate YouTube drift alarm AI gate", error);
          }
          if (!isCurrentGateAttempt()) return;
          pendingDriftAlarmGateRef.current = null;
          pendingDriftAlarmGateGenerationRef.current += 1;
          lastDriftAlertSegmentRef.current = alertKey;
          gateSuppressedDriftAlarmRef.current = { alertKey, reminder: reminderDelivery };
          recordDriftAlarmDebugEvent({
            kind: "youtube_gate_error",
            alertKey,
            message: toErrorMessage(error),
            candidate: summarizeDriftAlarmCandidate(latestDrift),
            ai: {
              resultKind: "error",
              category: null,
              productivity: null,
              confidence: null,
              source: null,
              model: null,
              promptVersion: null,
              reason: toErrorMessage(error),
            },
            evaluation,
          });
          publishEvaluationDriftAlarmTrayStatus({
            kind: "error",
            reason: error instanceof Error ? error.message : "AI gate failed",
          }, new Date());
        });
        return;
      }

      await applySettledGateResult(gateResult);
    }).catch((error) => {
      if (error instanceof Error) {
        console.warn("Failed to evaluate YouTube drift alarm AI gate", error);
      }
      if (!isCurrentGateAttempt()) return;
      pendingDriftAlarmGateRef.current = null;
      pendingDriftAlarmGateGenerationRef.current += 1;
      lastDriftAlertSegmentRef.current = alertKey;
      gateSuppressedDriftAlarmRef.current = { alertKey, reminder: reminderDelivery };
      recordDriftAlarmDebugEvent({
        kind: "youtube_gate_error",
        alertKey,
        message: toErrorMessage(error),
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        ai: {
          resultKind: "error",
          category: null,
          productivity: null,
          confidence: null,
          source: null,
          model: null,
          promptVersion: null,
          reason: toErrorMessage(error),
        },
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({
        kind: "error",
        reason: error instanceof Error ? error.message : "AI gate failed",
      }, checkedAt);
    });
  }, [aiClassificationProviderKey, allowBuiltInHeuristics, automaticCloseEnabled, availableDriftAlarmFocusTargets, builtInHeuristicsUnavailableSince, canUseSelectedCloudAiClassification, classificationAvailability.state, classificationRules, companionLanguage, devModeEnabled, driftAlertDelaySeconds, driftAlarmCopy, driftAlarmSnooze, driftAlertsRuntimeEnabled, forceChromiumAxExtremeNudgeEnabled, hostPlatform, petModeActive, publishDriftAlarmTrayStatus, recordBreakRecoveryOutcome, refreshLiveDriftAlarmActivity, returnToFocusTarget, selectedLocalAiClassificationOptions, showAiClassificationImpact, showDriftAlarm, startOfDayMinutes, status?.running, status?.trackingPaused, trackerPausePending]);

  useEffect(() => {
    evaluateDriftAlarmRef.current = evaluateDriftAlarm;
  }, [evaluateDriftAlarm]);

  useEffect(() => {
    if (!status) return;
    if (status.running !== true) {
      if (driftAlertsRuntimeEnabled) {
        clearPausedDriftAlarmRuntime();
        publishDriftAlarmTrayStatus({ kind: "tracker_paused" }, null);
      }
      return;
    }
    // A snapshot from a poll whose timeline failed still updates the current
    // Windows UI, but it cannot certify a drift candidate against old rows.
    if (liveDriftAlarmTimelineUnavailableRef.current) return;
    if (selectedDay !== currentDriftAlarmDay()) return;

    evaluateDriftAlarm({
      snapshot: currentSnapshot,
      liveSegments: liveDriftAlarmSegmentsRef.current,
    });
  }, [currentSnapshot, driftAlertsRuntimeEnabled, evaluateDriftAlarm, publishDriftAlarmTrayStatus, selectedDay, status?.running]);

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (postOnboardingSidebarGuideActive && postOnboardingSidebarGuideStep) return;
        setCmdOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [postOnboardingSidebarGuideActive, postOnboardingSidebarGuideStep]);

  const todayDay = logicalTodayIsoDate(startOfDayMinutes);
  const isTodaySelected = selectedDay === todayDay;
  const liveClock = isTodaySelected ? new Date() : null;
  const currentMinuteOfDay = liveClock ? liveClock.getHours() * 60 + liveClock.getMinutes() : null;

  useEffect(() => {
    if (!watcherPeekEnabled) return;
    if (selectedDay !== todayDay) return;
    if (!status?.running) return;

    let cancelled = false;
    let timeoutId = 0;
    function scheduleNextPeek(delayMs?: number) {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        if (watcherMode === "drift_only") {
          void showDueDriftWatcherPeek(segmentsRef.current, showWatcherPeek, driftReminderStateRef, {
            fallbackCandidates: segmentsRef.current,
            includeAiClassifications: showAiClassificationImpact,
            includeBuiltInHeuristics: allowBuiltInHeuristics,
            builtInHeuristicsUnavailableSince,
            rules: classificationRules,
          });
        } else {
          showWatcherPeek();
        }
        scheduleNextPeek();
      }, delayMs ?? getWatcherScheduleDelayMs(watcherMode, watcherPeriodicMinMinutes, watcherPeriodicMaxMinutes));
    }

    scheduleNextPeek(WATCHER_INITIAL_PEEK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, classificationRules, selectedDay, showAiClassificationImpact, showWatcherPeek, status?.running, todayDay, watcherMode, watcherPeekEnabled, watcherPeriodicMaxMinutes, watcherPeriodicMinMinutes]);

  const dashboardRange = useMemo(() => getDashboardPeriodRange(selectedDay, dashPeriod, startOfDayMinutes, startOfWeek), [dashPeriod, selectedDay, startOfDayMinutes, startOfWeek]);
  const dashboardWeekRange = useMemo(() => getDashboardPeriodRange(selectedDay, "Week", startOfDayMinutes, startOfWeek), [selectedDay, startOfDayMinutes, startOfWeek]);
  const dashboardWeekHistoryRange = useMemo<DashboardHistoryRange>(() => {
    return buildActivityRefreshPlan({
      activeTab: "dashboard",
      dashPeriod: "Week",
      day: selectedDay,
      shouldLoadHistory: true,
      startOfDayMinutes,
      startOfWeek,
      trendsRange,
    }).historyTimelineRange;
  }, [selectedDay, startOfDayMinutes, startOfWeek, trendsRange]);
  // An expired load still paints every closed day while the entry refresh
  // replaces it; requiring a fresh one blanked those days after five minutes
  // on Today, or while Week stayed open, until the reload landed.
  const dashboardWeekCompactHistoryLoad = dashPeriod === "Week"
    ? findDisplayableCompactHistoryLoad(compactHistoryCacheRef.current, dashboardWeekHistoryRange)
    : null;
  const dashboardPreviousWeekRange = useMemo(() => {
    const startDay = shiftIsoDate(dashboardWeekRange.startDay, -7);
    const endDay = shiftIsoDate(dashboardWeekRange.startDay, -1);
    return {
      startDay,
      endDay,
      ...getLogicalDayRange(startDay, endDay, startOfDayMinutes),
    };
  }, [dashboardWeekRange.startDay, startOfDayMinutes]);
  const dashboardPreviousWeekFocusKey = `${dashboardPreviousWeekRange.start}:${dashboardPreviousWeekRange.end}:${showAiClassificationImpact}:${allowBuiltInHeuristics}:${builtInHeuristicsUnavailableSince ?? "ready"}`;
  const dashboardPreviousDayRange = useMemo(() => {
    const day = shiftIsoDate(selectedDay, -1);
    return {
      day,
      ...getLogicalDayRange(day, day, startOfDayMinutes),
    };
  }, [selectedDay, startOfDayMinutes]);
  const dashboardPreviousDayFocusKey = `${dashboardPreviousDayRange.start}:${dashboardPreviousDayRange.end}:${showAiClassificationImpact}:${allowBuiltInHeuristics}:${builtInHeuristicsUnavailableSince ?? "ready"}`;
  const dashboardWeekCompactSource = useMemo<DashboardSegmentSource | null>(() => (
    dashboardWeekCompactHistoryLoad
      ? {
          range: { start: dashboardWeekCompactHistoryLoad.start, end: dashboardWeekCompactHistoryLoad.end },
          segments: dashboardWeekCompactHistoryLoad.materialized.segments,
        }
      : null
  ), [dashboardWeekCompactHistoryLoad]);
  const dashboardHistorySource = useMemo<DashboardSegmentSource>(() => ({
    range: historySegmentsLoadedRange,
    segments: historySegments,
  }), [historySegments, historySegmentsLoadedRange]);
  const dashboardSegments = useMemo(() => {
    return selectDashboardSegments({
      compactHistorySource: dashboardWeekCompactSource,
      dashPeriod,
      historySource: dashboardHistorySource,
      requiredHistoryRange: dashPeriod === "Week" ? dashboardWeekHistoryRange : dashboardRange,
      selectedDaySegments: segments,
      visibleRange: dashboardRange,
    });
  }, [dashPeriod, dashboardHistorySource, dashboardRange, dashboardWeekCompactSource, dashboardWeekHistoryRange, segments]);
  const {
    effectiveSelectedDaySegments: unfilteredEffectiveSelectedDaySegments,
    effectiveDashboardSegments: unfilteredEffectiveDashboardSegments,
    effectiveCurrentMinuteOfDay,
    effectiveDashboardRange,
    effectiveTodayDayForWeekModel,
    isDashboardDemoReplayActive,
  } = useMemo(() => resolveDashboardDemoReplayEffectiveData({
    currentMinuteOfDay,
    dashboardRange,
    dashboardSegments,
    replayState: dashboardDemoReplayState,
    selectedDaySegments: segments,
    todayDayForWeekModel: todayDay,
  }), [currentMinuteOfDay, dashboardDemoReplayState, dashboardRange, dashboardSegments, segments, todayDay]);
  const googleCalendarWeek = useGoogleCalendarWeek({
    enabled: activeTab === "dashboard"
      && dashPeriod === "Week"
      && !isPreviewSurface
      && !isDashboardDemoReplayActive
      && authStatus === "authenticated"
      && hasRequiredAccountAuth,
    userId: user?.id ?? null,
    startDay: effectiveDashboardRange.startDay,
    endDay: effectiveDashboardRange.endDay,
    startOfDayMinutes,
  });
  // Device filter choke point: every dashboard view model (day flow, week,
  // stats) derives from these two arrays, so filtering here covers them all.
  const effectiveSelectedDaySegments = useMemo(
    () => aggregateDeviceElapsedTime(filterSegmentsByDevice(unfilteredEffectiveSelectedDaySegments, deviceTimelineFilter)
      .filter((segment) => !isFailedForegroundCaptureSegment(segment)))
      .map(segment => clipDeviceElapsedTimeSegment(segment, { start: logicalDayStartMs(selectedDay, startOfDayMinutes), end: logicalDayEndExclusiveMs(selectedDay, startOfDayMinutes) })),
    [deviceTimelineFilter, selectedDay, startOfDayMinutes, unfilteredEffectiveSelectedDaySegments],
  );
  const effectiveDashboardSegments = useMemo(
    () => aggregateDeviceElapsedTime(filterSegmentsByDevice(unfilteredEffectiveDashboardSegments, deviceTimelineFilter)
      .filter((segment) => !isFailedForegroundCaptureSegment(segment)))
      .map(segment => clipDeviceElapsedTimeSegment(segment, { start: Date.parse(effectiveDashboardRange.start), end: Date.parse(effectiveDashboardRange.end) })),
    [deviceTimelineFilter, effectiveDashboardRange.end, effectiveDashboardRange.start, unfilteredEffectiveDashboardSegments],
  );
  const handleStartDashboardDemoReplay = useCallback((replayKind: DemoDashboardReplayKind) => {
    switch (replayKind) {
      case "day": {
        const anchor = buildSelectedDashboardReplayAnchor({
          kind: replayKind,
          anchorDay: selectedDay,
          startDay: selectedDay,
          endDay: selectedDay,
          startOfDayMinutes,
        });
        startDashboardDemoReplay(replayKind, { anchor, segments });
        if (!shouldBlockLocalTrackerAccess && segments.length > 0) {
          loadMissingAppIcons({
            segments,
            failureMessage: "Failed to load selected day replay app icons",
          });
          loadMissingSiteIcons(segments);
        }
        return;
      }
      case "week": {
        const anchor = buildSelectedDashboardReplayAnchor({
          kind: replayKind,
          anchorDay: selectedDay,
          startDay: dashboardWeekRange.startDay,
          endDay: dashboardWeekRange.endDay,
          startOfDayMinutes,
        });
        const cachedWeek = findFreshCompactHistoryLoad(compactHistoryCacheRef.current, dashboardWeekHistoryRange);
        if (cachedWeek) {
          const weekSegments = cachedWeek.materialized.segments;
          startDashboardDemoReplay(replayKind, { anchor, segments: weekSegments });
          if (!shouldBlockLocalTrackerAccess && weekSegments.length > 0) {
            loadMissingAppIcons({
              segments: weekSegments,
              failureMessage: "Failed to load selected week replay app icons",
            });
          }
          return;
        }
        if (shouldBlockLocalTrackerAccess) {
          startDashboardDemoReplay(replayKind, { anchor, segments: [] });
          return;
        }

        void loadCompactHistoryRange(dashboardWeekHistoryRange).then((load) => {
          const weekSegments = load.materialized.segments;
          startDashboardDemoReplay(replayKind, { anchor, segments: weekSegments });
          if (weekSegments.length > 0) {
            loadMissingAppIcons({
              segments: weekSegments,
              failureMessage: "Failed to load selected week replay app icons",
            });
          }
        }).catch((error) => {
          let message = "unknown error";
          if (error instanceof Error) {
            message = error.message;
          }
          console.warn("Failed to load selected week replay data", message);
          startDashboardDemoReplay(replayKind, { anchor, segments: [] });
        });
        return;
      }
      default:
        assertNever(replayKind);
    }
  }, [
    dashboardWeekHistoryRange,
    dashboardWeekRange.endDay,
    dashboardWeekRange.startDay,
    loadCompactHistoryRange,
    loadMissingAppIcons,
    loadMissingSiteIcons,
    segments,
    selectedDay,
    shouldBlockLocalTrackerAccess,
    startDashboardDemoReplay,
    startOfDayMinutes,
  ]);
  const dashboardReplay = useMemo(() => (
    dashboardDemoReplayState.kind === "active"
      ? {
          phase: dashboardDemoReplayState.phase,
          progress: dashboardDemoReplayState.progress,
          onRestart: restartDashboardDemoReplay,
          onStop: stopDashboardDemoReplay,
        }
      : null
  ), [dashboardDemoReplayState, restartDashboardDemoReplay, stopDashboardDemoReplay]);
  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return;
    if (activeTab !== "dashboard" || dashPeriod !== "Week") return;
    if (dashboardSegments.length === 0) return;

    loadMissingAppIcons({
      segments: dashboardSegments,
      failureMessage: "Failed to load visible week app icons",
    });
    loadMissingSiteIcons(dashboardSegments);
  }, [activeTab, dashPeriod, dashboardSegments, loadMissingAppIcons, loadMissingSiteIcons, shouldBlockLocalTrackerAccess]);
  const dashboardWeekRefreshKey = compactHistoryRangeKey(dashboardWeekHistoryRange);
  // Status follows freshness, not what is painted: an expired copy on screen
  // still shows "Updating" while its reload runs and the error chip if it fails.
  const dashboardWeekHasFreshHistory = dashPeriod === "Week"
    && findFreshCompactHistoryLoad(compactHistoryCacheRef.current, dashboardWeekHistoryRange) !== null;
  const weekRefreshStatus: DashboardWeekRefreshStatus = dashPeriod !== "Week" || dashboardWeekHasFreshHistory
    ? "idle"
    : dashboardWeekRefreshState.key === dashboardWeekRefreshKey
      ? dashboardWeekRefreshState.status
      : "loading";
  const dashboardClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: effectiveDashboardSegments, includeAiClassifications: showAiClassificationImpact, includeBuiltInHeuristics: allowBuiltInHeuristics, builtInHeuristicsUnavailableSince }),
    [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, effectiveDashboardSegments, showAiClassificationImpact],
  );
  const effectiveSelectedDayClassificationOptions = useMemo<ClassificationOptions>(
    () => buildSelectedDayDashboardClassificationOptions({
      fallbackCandidates: effectiveSelectedDaySegments,
      includeAiClassifications: showAiClassificationImpact,
      includeBuiltInHeuristics: allowBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
      rules: classificationRules,
    }),
    [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, classificationRules, effectiveSelectedDaySegments, showAiClassificationImpact],
  );
  const insightRange = useMemo(() => getInsightPeriodRange(selectedDay, trendsRange, startOfDayMinutes), [selectedDay, startOfDayMinutes, trendsRange]);
  const insightRecentWeekRange = useMemo(() => getInsightPeriodRange(selectedDay, "Week", startOfDayMinutes), [selectedDay, startOfDayMinutes]);
  const shouldBuildInsightModels = activeTab === "trends";
  const cachedInsightWeekHistory = useMemo(
    () => findFreshCompactHistoryLoad(compactHistoryCacheRef.current, insightRecentWeekRange),
    [compactHistoryCacheRevision, insightRecentWeekRange],
  );
  const isInsightHistoryRangeReady = historySegmentsLoadedRange !== null && compactHistoryRangeContains(historySegmentsLoadedRange, insightRange);
  const isTrendsDataReady = trendsRange === "Week" ? cachedInsightWeekHistory !== null || isInsightHistoryRangeReady : isInsightHistoryRangeReady;
  const insightSegments = useMemo(
    () => {
      if (!shouldBuildInsightModels || !isTrendsDataReady) return EMPTY_ACTIVITY_SEGMENTS;
      const historySourceSegments = trendsRange === "Week" && cachedInsightWeekHistory
        ? cachedInsightWeekHistory.materialized.segments
        : historySegments;
      const supplementalSegments = trendsRange === "Week"
        ? EMPTY_ACTIVITY_SEGMENTS
        : cachedInsightWeekHistory?.materialized.segments ?? EMPTY_ACTIVITY_SEGMENTS;
      return selectInsightSegments({
        historySegments: historySourceSegments,
        supplementalSegments,
        selectedDaySegments: segments,
        range: { start: insightRange.start, end: insightRange.end },
      });
    },
    [cachedInsightWeekHistory, historySegments, insightRange, isTrendsDataReady, segments, shouldBuildInsightModels, trendsRange],
  );
  const isTrendsBodyReady = activeTab === "trends" && isDeferredTabBodyReady && isTrendsDataReady;
  const activeInsightSegments = isTrendsBodyReady ? insightSegments : EMPTY_ACTIVITY_SEGMENTS;
  const insightWeekVisibility = useMemo(
    () => trendsRange === "Week" ? { startDay: insightRange.startDay } : undefined,
    [insightRange.startDay, trendsRange],
  );
  const insightRhythmVisibility = useMemo(
    () => ({
      ...(trendsRange === "Week" ? { startDay: insightRange.startDay } : {}),
      averagingRange: { startDay: insightRange.startDay, endDay: insightRange.endDay },
    }),
    [insightRange.endDay, insightRange.startDay, trendsRange],
  );
  const insightClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: activeInsightSegments, includeAiClassifications: showAiClassificationImpact, includeBuiltInHeuristics: allowBuiltInHeuristics, builtInHeuristicsUnavailableSince }),
    [activeInsightSegments, allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, showAiClassificationImpact],
  );
  const historyClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: historySegments, includeAiClassifications: showAiClassificationImpact, includeBuiltInHeuristics: allowBuiltInHeuristics, builtInHeuristicsUnavailableSince }),
    [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, historySegments, showAiClassificationImpact],
  );
  const weekDashboardPrewarmSegments = dashboardWeekCompactHistoryLoad?.materialized.segments ?? historySegments;
  const shouldPrewarmWeekDashboard = dashboardWeekCompactHistoryLoad !== null || historySegments.length > 0;
  const weekDashboardPrewarmClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: weekDashboardPrewarmSegments, includeAiClassifications: showAiClassificationImpact, includeBuiltInHeuristics: allowBuiltInHeuristics, builtInHeuristicsUnavailableSince }),
    [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, showAiClassificationImpact, weekDashboardPrewarmSegments],
  );
  useEffect(() => {
    if (activeTab !== "dashboard" || dashPeriod !== "Week") return undefined;
    if (shouldBlockLocalTrackerAccess) return undefined;
    if (dashboardPreviousWeekFocusLoad?.key === dashboardPreviousWeekFocusKey) return undefined;

    let cancelled = false;
    let cancelIdleWork: (() => void) | null = null;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      cancelIdleWork = scheduleIdleWork(() => {
        void loadCompactHistoryRange({
          start: dashboardPreviousWeekRange.start,
          end: dashboardPreviousWeekRange.end,
        }).then((load) => {
          if (cancelled) return;
          const previousWeekClassificationOptions: ClassificationOptions = {
            fallbackCandidates: load.materialized.segments,
            includeAiClassifications: showAiClassificationImpact,
            includeBuiltInHeuristics: allowBuiltInHeuristics,
            builtInHeuristicsUnavailableSince,
          };
          setDashboardPreviousWeekFocusLoad({
            key: dashboardPreviousWeekFocusKey,
            focusSeconds: buildRollingFocusSeconds(
              load.materialized.segments,
              dashboardPreviousWeekRange.startDay,
              dashboardPreviousWeekRange.endDay,
              previousWeekClassificationOptions,
              startOfDayMinutes,
            ),
          });
        }).catch(() => undefined);
      });
    }, DASHBOARD_PREVIOUS_WEEK_FOCUS_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      cancelIdleWork?.();
    };
  }, [
    activeTab,
    allowBuiltInHeuristics,
    builtInHeuristicsUnavailableSince,
    dashPeriod,
    dashboardPreviousWeekFocusKey,
    dashboardPreviousWeekFocusLoad?.key,
    dashboardPreviousWeekRange.end,
    dashboardPreviousWeekRange.endDay,
    dashboardPreviousWeekRange.start,
    dashboardPreviousWeekRange.startDay,
    loadCompactHistoryRange,
    shouldBlockLocalTrackerAccess,
    showAiClassificationImpact,
    startOfDayMinutes,
  ]);
  useEffect(() => {
    if (activeTab !== "dashboard" || dashPeriod !== "Today") return undefined;
    if (shouldBlockLocalTrackerAccess) return undefined;
    if (dashboardPreviousDayFocusLoad?.key === dashboardPreviousDayFocusKey) return undefined;

    let cancelled = false;
    let cancelIdleWork: (() => void) | null = null;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      cancelIdleWork = scheduleIdleWork(() => {
        void loadCompactHistoryRange({
          start: dashboardPreviousDayRange.start,
          end: dashboardPreviousDayRange.end,
        }).then((load) => {
          if (cancelled) return;
          const previousDayClassificationOptions: ClassificationOptions = {
            fallbackCandidates: load.materialized.segments,
            includeAiClassifications: showAiClassificationImpact,
            includeBuiltInHeuristics: allowBuiltInHeuristics,
            builtInHeuristicsUnavailableSince,
          };
          setDashboardPreviousDayFocusLoad({
            key: dashboardPreviousDayFocusKey,
            focusSeconds: buildRollingFocusSeconds(
              load.materialized.segments,
              dashboardPreviousDayRange.day,
              dashboardPreviousDayRange.day,
              previousDayClassificationOptions,
              startOfDayMinutes,
            ),
          });
        }).catch(() => undefined);
      });
    }, DASHBOARD_PREVIOUS_WEEK_FOCUS_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      cancelIdleWork?.();
    };
  }, [
    activeTab,
    allowBuiltInHeuristics,
    builtInHeuristicsUnavailableSince,
    dashPeriod,
    dashboardPreviousDayFocusKey,
    dashboardPreviousDayFocusLoad?.key,
    dashboardPreviousDayRange.day,
    dashboardPreviousDayRange.end,
    dashboardPreviousDayRange.start,
    loadCompactHistoryRange,
    shouldBlockLocalTrackerAccess,
    showAiClassificationImpact,
    startOfDayMinutes,
  ]);
  const weekDashboardDayModelCacheRef = useRef(new WeekDashboardDayModelCache());
  const weekDashboardDayModelCacheSettingsRef = useRef<WeekDashboardDayModelCacheSettings | null>(null);
  const weekDashboardDayModelCache = weekDashboardDayModelCacheRef.current;
  weekDashboardDayModelCacheSettingsRef.current = syncWeekDashboardDayModelCacheSettings(
    weekDashboardDayModelCache,
    weekDashboardDayModelCacheSettingsRef.current,
    { includeAiClassifications: showAiClassificationImpact, includeBuiltInHeuristics: allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, startOfDayMinutes },
  );
  useEffect(() => {
    if (!shouldPrewarmWeekDashboard) return undefined;

    let cancelled = false;
    const cancelIdleWork = scheduleIdleWork(() => {
      if (cancelled) return;
      const warmedDays = prewarmClosedWeekDashboardDays({
        cache: weekDashboardDayModelCache,
        classificationOptions: weekDashboardPrewarmClassificationOptions,
        endDay: dashboardWeekRange.endDay,
        segments: weekDashboardPrewarmSegments,
        startDay: dashboardWeekRange.startDay,
        startOfDayMinutes,
        todayDay,
      });
      if (warmedDays > 0) setWeekDashboardCacheRevision((revision) => revision + 1);
    });

    return () => {
      cancelled = true;
      cancelIdleWork();
    };
  }, [
    dashboardWeekRange.endDay,
    dashboardWeekRange.startDay,
    shouldPrewarmWeekDashboard,
    startOfDayMinutes,
    todayDay,
    weekDashboardPrewarmClassificationOptions,
    weekDashboardDayModelCache,
    weekDashboardPrewarmSegments,
  ]);
  const totalSeconds = useMemo(() => totalDurationSeconds(effectiveDashboardSegments), [effectiveDashboardSegments]);
  const activeDashboardAiUnavailablePreviewInput = useMemo(
    () => !isDashboardDemoReplayActive && dashboardAiUnavailablePreview?.appliedDay === selectedDay
      ? buildDashboardAiUnavailablePreviewInput(dashboardAiUnavailablePreview.caseId)
      : null,
    [dashboardAiUnavailablePreview, isDashboardDemoReplayActive, selectedDay],
  );
  const dashboardAiUnavailableState = isDashboardDemoReplayActive
    ? null
    : activeDashboardAiUnavailablePreviewInput
    ? resolveDashboardAiUnavailableState(activeDashboardAiUnavailablePreviewInput)
    : totalSeconds > 0 || (loading && !hasLoadedOnce)
      ? resolveDashboardAiUnavailableState({
        billingEntitlement,
        billingEntitlementError,
        billingEntitlementLoading,
        canUseCloudAiClassification,
        hasRequiredAccountAuth,
        isSupabaseConfigured,
        localAiReady: Boolean(localAiClassificationOptions),
        classificationAvailability,
      })
      : null;
  // A trial that ended is followed by the Pro sheet and its daily notice instead (trialEndFollowUp.ts).
  const dashboardAiRecoveryKey = dashboardAiUnavailableState && isCloudBillingVariant(dashboardAiUnavailableState.variant)
    && dashboardAiUnavailableState.variant !== "trial-ended"
    ? dashboardAiUnavailableState.variant
    : null;
  useEffect(() => {
    if (dismissedDashboardAiRecoveryKey === null) return undefined;

    const releaseReminderIfEligible = () => {
      if (isDashboardAiRecoveryDismissed(dismissedDashboardAiRecoveryKey)) return;
      setDismissedDashboardAiRecoveryKey((currentKey) => (
        currentKey === dismissedDashboardAiRecoveryKey ? null : currentKey
      ));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") releaseReminderIfEligible();
    };

    window.addEventListener("focus", releaseReminderIfEligible);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", releaseReminderIfEligible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dismissedDashboardAiRecoveryKey]);
  const dashboardAiRecoveryDismissed = dashboardAiRecoveryKey !== null
    && (dismissedDashboardAiRecoveryKey === dashboardAiRecoveryKey || isDashboardAiRecoveryDismissed(dashboardAiRecoveryKey));
  const dashboardAiRecoveryState = dashboardAiRecoveryKey !== null && !dashboardAiRecoveryDismissed
    ? dashboardAiUnavailableState
    : null;
  const updateDialogBlocked = Boolean(
    dashboardAiRecoveryState
    || isDashboardDemoReplayUpdateDialogBlocking(dashboardDemoReplayState)
    || authModalOpen
    || feedbackModalOpen
    || upgradePlanModalOpen
    || accountDeletionModalOpen
    || aiSetupDialogOpen
    || onboardingOpen
    || selectedLeaderboardRow
    || isProfileEditorOpen
    || cmdOpen
    || whatsNewOpen,
  );
  // A user-requested native prompt must remain reachable through account and onboarding gates.
  // Automatic prompts still respect the existing modal/first-run quiet policy.
  const visibleUpdate = !shouldShowAvailableUpdateDialog
    || (availableUpdateSource !== "manual" && updateDialogBlocked) ? null : availableUpdate;
  const titlebarUpdateVersion = updateDialogBlocked
    || visibleUpdate
    || updaterDownloading
    || updaterInstalling
    || canAutoUpdateSilently
    ? null
    : availableUpdate?.version ?? null;
  const latestBuildPromptUpdate = developerPreReleaseUpdateController.promptUpdate;

  const recordedDaySegments = useMemo(
    () => segments.filter((segment) => !isFailedForegroundCaptureSegment(segment)),
    [segments],
  );
  const dayTotalSeconds = useMemo(() => totalDurationSeconds(recordedDaySegments), [recordedDaySegments]);
  const selectedDayProductivityTotals = useMemo(
    () => buildProductivityDurations(recordedDaySegments, selectedDayClassificationOptions),
    [recordedDaySegments, selectedDayClassificationOptions],
  );
  const trayProductivityMix = useMemo<ProductivityShareMix>(() => {
    const total = selectedDayProductivityTotals.reduce((sum, entry) => sum + entry.totalSeconds, 0);
    if (total <= 0) return { focus: 0, drift: 0, neutral: 0 };

    return {
      focus: (selectedDayProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0) / total,
      drift: (selectedDayProductivityTotals.find((entry) => entry.productivity === "drift")?.totalSeconds ?? 0) / total,
      neutral: (selectedDayProductivityTotals.find((entry) => entry.productivity === "neutral")?.totalSeconds ?? 0) / total,
    };
  }, [selectedDayProductivityTotals]);
  useEffect(() => {
    if (hostPlatform !== "windows" || currentSnapshot || status?.running !== true) {
      setLiveCaptureGapExpired(false);
      return undefined;
    }
    setLiveCaptureGapExpired(false);
    const timeoutId = window.setTimeout(() => setLiveCaptureGapExpired(true), LIVE_CAPTURE_GAP_GRACE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [currentSnapshot, hostPlatform, status?.running]);

  const windowsTrackingStopped = hostPlatform === "windows" && status?.running === false;
  const petModeLiveSnapshot = useMemo(() => {
    const todaySegments = selectedDay === todayDay ? segments : driftAlarmBaseSegmentsRef.current;
    if (windowsTrackingStopped || (!currentSnapshot && liveCaptureGapExpired)) return buildCaptureGapWatcherSnapshot(todaySegments, {
      includeAiClassifications: showAiClassificationImpact,
      includeBuiltInHeuristics: allowBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
      rules: classificationRules,
    });
    if (!currentSnapshot) return petModeLiveSnapshotRef.current;
    const observedAtMs = snapshotObservedAtMs(currentSnapshot);
    if (!shouldReplacePetModeLiveSnapshot(observedAtMs, petModeLiveObservedAtMsRef.current)) {
      return petModeLiveSnapshotRef.current;
    }
    if (observedAtMs !== null) petModeLiveObservedAtMsRef.current = observedAtMs;
    return buildLiveWatcherSnapshot(
      currentSnapshot,
      todaySegments,
      {
        includeAiClassifications: showAiClassificationImpact,
        includeBuiltInHeuristics: allowBuiltInHeuristics,
        builtInHeuristicsUnavailableSince,
        rules: classificationRules,
      },
    );
  }, [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, classificationRules, currentSnapshot, liveCaptureGapExpired, segments, selectedDay, showAiClassificationImpact, todayDay, windowsTrackingStopped]);
  const watcherSnapshot = useMemo(() => buildWatcherSnapshot(segments, selectedDayClassificationOptions), [selectedDayClassificationOptions, segments]);
  useEffect(() => { watcherSnapshotRef.current = watcherSnapshot; }, [watcherSnapshot]);
  useEffect(() => { petModeLiveSnapshotRef.current = petModeLiveSnapshot; }, [petModeLiveSnapshot]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    const pendingReveals = pendingPetModeRevealRevisionsRef.current;
    const readinessAbort = new AbortController();
    const snapshot = petModeActive ? buildPetModeSnapshot(petModeLiveSnapshotRef.current) : null;
    const revealRevision = petModeRevealRevision;
    const isInitialStartupSync = !initialPetModeSyncCompletedRef.current;
    const forceReveal = petModeActive
      && (isInitialStartupSync
        || (revealRevision > handledPetModeRevealRevisionRef.current
          && !pendingReveals.has(revealRevision)));
    if (forceReveal) pendingReveals.add(revealRevision);
    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { width, height } = getPetModeWindowSize(petModeSize);
    const diagnosticToken = beginPetModeSyncDiagnostic({ enabled: petModeActive, width, height, forceReveal,
      attempt: (petModeRevealRetryAttemptsRef.current.get(revealRevision) ?? 0) + 1 });
    void setNativePetModeEnabled(
      petModeActive,
      snapshot,
      reducedMotion,
      width,
      height,
      forceReveal,
    ).then(() => {
      if (disposed) return;
      resolvePetModeSyncDiagnostic(diagnosticToken);
      if (petModeActive) {
        initialPetModeSyncCompletedRef.current = true;
      }
      if (!forceReveal) return;
      pendingReveals.delete(revealRevision);
      petModeRevealRetryAttemptsRef.current.delete(revealRevision);
      handledPetModeRevealRevisionRef.current = Math.max(
        handledPetModeRevealRevisionRef.current,
        revealRevision,
      );
    }).catch((nextError) => {
      console.warn("Failed to sync Pet Mode window", nextError);
      if (disposed) return;
      rejectPetModeSyncDiagnostic(diagnosticToken, nextError);
      if (isInitialStartupSync) {
        initialPetModeSyncCompletedRef.current = false;
      }
      if (!forceReveal) return;
      pendingReveals.delete(revealRevision);
      const retryAttempts = petModeRevealRetryAttemptsRef.current.get(revealRevision) ?? 0;
      if (
        petModeSyncMountedRef.current
        && (isInitialStartupSync || revealRevision <= latestPetModeRevealRevisionRef.current)
        && (isInitialStartupSync || revealRevision > handledPetModeRevealRevisionRef.current)
        && retryAttempts < 1
      ) {
        // Startup uses revision zero, so it must not depend on a manual
        // Show revision. Retry once for either startup or an explicit request.
        void waitForPetModeStartupRetryReadiness(nextError, isInitialStartupSync,
          readinessAbort.signal, (status) => recordPetModeSyncReadiness(diagnosticToken, status))
          .then(() => {
            // Waiting never occupies the serialized enable queue. Off/size
            // cleanup must revoke this request before it can enqueue a retry.
            if (disposed || !petModeSyncMountedRef.current) return;
            petModeRevealRetryAttemptsRef.current.set(revealRevision, retryAttempts + 1);
            setPetModeSyncRetryNonce((nonce) => nonce + 1);
          }).catch(() => undefined);
      }
    });
    return () => {
      // A changed toggle or size owns the next sync. A late rejection from
      // this request must not retry it or consume the replacement's reveal.
      disposed = true;
      readinessAbort.abort();
      cancelPetModeSyncDiagnostic(diagnosticToken);
      if (forceReveal) pendingReveals.delete(revealRevision);
    };
  }, [beginPetModeSyncDiagnostic, cancelPetModeSyncDiagnostic, petModeActive, petModeRevealRevision, petModeSize,
    petModeSyncRetryNonce, recordPetModeSyncReadiness, rejectPetModeSyncDiagnostic, resolvePetModeSyncDiagnostic]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const points = isDevModeActive ? petModeFloorHomePt : PET_MODE_FLOOR_HOME_PT;
    void setNativePetModeFloorHome(points).catch((nextError) => {
      console.warn("Failed to sync Pet Mode floor home", nextError);
    });
  }, [isDevModeActive, petModeFloorHomePt]);
  useEffect(() => {
    if (!petModeActive || !isTauriRuntime()) return;
    void updateNativePetMode(buildPetModeSnapshot(petModeLiveSnapshot)).catch((nextError) => {
      console.warn("Failed to update Pet Mode snapshot", nextError);
    });
  }, [petModeActive, petModeLiveSnapshot]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetQuickControlsMenuState((open) => {
      if (disposed) return;
      petOccupancyRef.current = { ...petOccupancyRef.current, menuOpen: open };
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetPointer(({ at }) => {
      if (!disposed) setPetModeLabPointerStatus(`Pet input received · ${new Date(at).toLocaleTimeString()}`);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetVisibilityAction((action) => {
      if (!disposed) handlePetVisibilityAction(action);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handlePetVisibilityAction]);
  useEffect(() => {
    if (!petModeActive) {
      void setNativePetQuickControlsVisible(false).catch(() => undefined);
      return;
    }
    void syncNativePetQuickControlsState({
      automaticCloseEnabled,
      automaticCloseSavedEnabled,
      automaticCloseOverride: activeAutomaticCloseOverride ? {
        enabled: activeAutomaticCloseOverride.enabled,
        kind: activeAutomaticCloseOverride.kind,
        endsAtMs: activeAutomaticCloseOverride.endsAtMs,
      } : null,
      language: localization.effectiveLanguage,
      theme,
    }).catch(() => undefined);
  }, [activeAutomaticCloseOverride, automaticCloseEnabled, automaticCloseSavedEnabled, localization.effectiveLanguage, petModeActive, theme]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetQuickControlsAction((action) => {
      if (disposed) return;
      if (action === "hideOneHour" || action === "turnOff") {
        handlePetVisibilityAction(action);
        return;
      }
      if (action === "openDashboard") {
        navigateToTab("dashboard", "Today");
        return;
      }
      if (action === "openSettings") {
        openPetSettings();
        return;
      }
      const temporaryActions: Partial<Record<typeof action, readonly [boolean, AutomaticCloseOverrideKind]>> = {
        automaticClosePause15: [false, "15"],
        automaticClosePause60: [false, "60"],
        automaticClosePauseToday: [false, "today"],
        automaticClosePauseForever: [false, "forever"],
        automaticCloseEnable15: [true, "15"],
        automaticCloseEnable60: [true, "60"],
        automaticCloseEnableToday: [true, "today"],
        automaticCloseEnableForever: [true, "forever"],
      };
      const temporaryAction = temporaryActions[action];
      if (temporaryAction) {
        setTemporaryAutomaticClose(...temporaryAction);
        return;
      }
      if (action === "automaticCloseRestore") {
        restoreSavedAutomaticClose();
        return;
      }
      if (action === "automaticCloseExtend60" || action === "automaticCloseExtendToday") {
        extendTemporaryAutomaticClose(action === "automaticCloseExtend60" ? "60" : "today");
        return;
      }
      if (action !== "toggleAutomaticClose") return;
      restoreSavedAutomaticClose();
      const nextEnabled = !automaticCloseSavedEnabled;
      if (nextEnabled && !driftAlertsEnabled) setDriftAlertsEnabled(true);
      setExtremeNudgeEnabled(nextEnabled);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    automaticCloseSavedEnabled,
    driftAlertsEnabled,
    extendTemporaryAutomaticClose,
    handlePetVisibilityAction,
    navigateToTab,
    openPetSettings,
    restoreSavedAutomaticClose,
    setDriftAlertsEnabled,
    setExtremeNudgeEnabled,
    setTemporaryAutomaticClose,
  ]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToNativePetAlignment((alignment) => {
      if (disposed) return;
      const measuredTarget = !/(fallback|unavailable)/i.test(alignment.diagnostic);
      const quality = !measuredTarget
        ? "geometry fallback"
        : alignment.errorDistance <= 1
          ? "99% contact"
          : "needs calibration";
      setPetModeLabPointerStatus(
        `${quality} · ${alignment.errorDistance.toFixed(2)} px · Δ ${alignment.errorX.toFixed(2)}, ${alignment.errorY.toFixed(2)} · ${alignment.diagnostic}`,
      );
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten?.();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  /* Milestones may only read today's figure while the loaded segments are known
     to belong to today; see canEvaluateCompanionDailyFocus. At launch they also
     wait for the first live snapshot, which lands after the day's records: its
     uncaptured seconds belong in the baseline, not in an announced crossing. */
  const companionDailyFocusEvaluable = !awaitingFirstCurrentSnapshot && canEvaluateCompanionDailyFocus({
    loaded: hasLoadedOnce,
    blocked: shouldBlockLocalTrackerAccess,
    viewingToday: selectedDay === todayDay,
    segmentsLoadedDay,
    day: todayDay,
  });
  const companionTodaySnapshot = useMemo(() => {
    const todaySegments = selectedDay === todayDay ? segments : driftAlarmBaseSegmentsRef.current;
    const classificationOptions = {
      includeAiClassifications: showAiClassificationImpact,
      includeBuiltInHeuristics: allowBuiltInHeuristics,
      builtInHeuristicsUnavailableSince,
      rules: classificationRules,
    };
    if (windowsTrackingStopped || (!currentSnapshot && liveCaptureGapExpired)) {
      return buildCaptureGapWatcherSnapshot(todaySegments, classificationOptions);
    }
    if (currentSnapshot) return buildLiveWatcherSnapshot(currentSnapshot, todaySegments, classificationOptions);
    return selectedDay === todayDay
      ? watcherSnapshot
      : buildWatcherSnapshot(todaySegments, classificationOptions);
  }, [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, classificationRules, currentSnapshot, liveCaptureGapExpired, segments, selectedDay, showAiClassificationImpact, todayDay, watcherSnapshot, windowsTrackingStopped]);

  useEffect(() => {
    const client = trackerClient as Partial<typeof trackerClient>;
    if (typeof client.updateTrayDisplayMode !== "function") return;
    void client.updateTrayDisplayMode("donut", companionTodaySnapshot.focusSecondsToday).catch((error: unknown) => {
      console.warn("Failed to update the menu bar Companion display", toErrorMessage(error));
    });
  }, [
    companionTodaySnapshot.focusSecondsToday,
  ]);

  const companionAchievementAnnouncementsEnabled = status?.running === true
    && celebrationsEnabled
    && !quietHoursActive
    && !isInitialDailyFocusQuietPeriod(onboardingCompletedAt);

  // How fast new installs reach 10 and 30 tracked hours, the bar proposed for
  // friend-invite rewards. Reads the local tracker's total (idle excluded);
  // only a milestone id and a days-since-start bucket are reported.
  const loadTrackedSecondsTotal = useCallback(async () => {
    const buckets = await trackerClient.getHourlySummary({
      start: "2000-01-01T00:00:00",
      end: formatLocalDateTime(Date.now()),
    });
    return buckets.reduce((total, bucket) => total + (Number.isFinite(bucket.totalSeconds) ? bucket.totalSeconds : 0), 0);
  }, []);
  useUsageMilestones({
    enabled: hasLoadedOnce && isTauriRuntime() && !shouldUsePreviewData(),
    loadTrackedSeconds: loadTrackedSecondsTotal,
  });

  useCompanionCommunityMilestones({
    ready: classificationAssessmentReady && companionDailyFocusEvaluable && isSupabaseConfigured && !shouldUsePreviewData(),
    recoveryPending: classificationAvailabilityGateEnabled && (
      classificationRecoveryPending || builtInHeuristicsUnavailableSince !== null
    ),
    day: todayDay,
    focusSecondsToday: companionTodaySnapshot.focusSecondsToday,
    announcementsEnabled: companionAchievementAnnouncementsEnabled,
    translate: companionTranslate,
  });

  useCompanionDailyFocusMilestones({
    ready: classificationAssessmentReady && companionDailyFocusEvaluable,
    day: todayDay,
    focusSecondsToday: companionTodaySnapshot.focusSecondsToday,
    /* Visibility controls only the resident capsule. A milestone is an alert,
       so a running tracker may announce it through the standalone surface. */
    announcementsEnabled: companionAchievementAnnouncementsEnabled,
    translate: companionTranslate,
  });

  useCompanionFocusRunMilestones({
    ready: classificationAssessmentReady && companionDailyFocusEvaluable,
    day: todayDay,
    startOfDayMinutes,
    currentRunSeconds: companionTodaySnapshot.focusStrikeSeconds ?? 0,
    classificationOptions: companionFocusRecordClassificationOptions,
    announcementsEnabled: companionAchievementAnnouncementsEnabled,
    translate: companionTranslate,
  });

  useCompanionLeaderboardMilestones({
    ready: classificationAssessmentReady && isSupabaseConfigured && isPolicySignedIn && !shouldUsePreviewData(),
    recoveryPending: classificationAvailabilityGateEnabled && (
      classificationRecoveryPending || builtInHeuristicsUnavailableSince !== null
    ),
    userScopeKey: user?.id ?? null,
    calendarDay: localDateKey(new Date()),
    startOfDayMinutes,
    startOfWeek,
    /* The weekly result lands once, at its morning slot; quiet hours do not
       gate it because a skipped evaluation is consumed, not deferred. */
    announcementsEnabled: celebrationsEnabled,
    publishCheckpoint: publishLeaderboardCheckpoint,
    translate: companionTranslate,
  });

  useEffect(() => {
    if (!companionPillVisible || !isTauriRuntime()) return;
    const event: WatcherPeekEvent = {
      id: Date.now(),
      ...companionTodaySnapshot,
      slotIndex: 0,
      trackingPaused: status?.running !== true,
    };
    void updateNativeCompanionPill(event).catch((error: unknown) => {
        console.warn("Failed to refresh the companion pill", toErrorMessage(error));
      });
  }, [
    companionPillVisible,
    companionTodaySnapshot,
    status?.running,
  ]);
  useEffect(() => {
    if (!hasLoadedOnce) return;
    if (shouldBlockLocalTrackerAccess) return;
    if (selectedDay !== todayDay) return;

    const client = trackerClient as Partial<typeof trackerClient>;
    if (typeof client.updateTrayProductivityIcon !== "function") return;
    void client.updateTrayProductivityIcon(trayProductivityMix).catch(() => undefined);
  }, [hasLoadedOnce, selectedDay, shouldBlockLocalTrackerAccess, todayDay, trayProductivityMix]);
  useEffect(() => {
    publishNativeDriftAlarmTrayStatus({
      ...driftAlarmTrayStatus,
      developerDetailsEnabled: isDevModeActive,
      trackerRunning: status?.running ?? null,
    });
  }, [driftAlarmTrayStatus, isDevModeActive, publishNativeDriftAlarmTrayStatus, status?.running]);
  const dashboardAppUsage = useMemo(() => buildAppUsageSummaries(effectiveDashboardSegments, { limit: 6 }), [effectiveDashboardSegments]);
  const dashboardTopApps = useMemo(() => buildAppUsageSummaries(effectiveDashboardSegments, { limit: 1, groupBy: "app" }), [effectiveDashboardSegments]);
  const dayField = useMemo(() => buildQuarterHourDayField(effectiveSelectedDaySegments, selectedDay, startOfDayMinutes), [effectiveSelectedDaySegments, selectedDay, startOfDayMinutes]);
  const selectedDayLabel = formatLocalizedDayLabel(selectedDay, localization.effectiveLanguage);
  const aiClassificationUsageDayLabel = formatDayLabel(aiClassificationUsageDay ?? selectedDay);
  const aiClassificationCostProjection = useMemo(
    () => projectAiClassificationCost(aiClassificationUsage, classificationMetrics),
    [aiClassificationUsage, classificationMetrics],
  );
  const selectedDayContext = describeRelativeDay(selectedDay, startOfDayMinutes);
  const classificationWeekRange = useMemo(() => getDashboardPeriodRange(selectedDay, "Week", startOfDayMinutes, startOfWeek), [selectedDay, startOfDayMinutes, startOfWeek]);
  const shouldBuildClassificationModels = activeTab === "classification";
  const classificationSegments = useMemo(() => aggregateDeviceElapsedTime((
    shouldBuildClassificationModels && classificationRange === "Week"
      ? filterSegmentsForRange(historySegments, classificationWeekRange.start, classificationWeekRange.end)
      : shouldBuildClassificationModels ? segments : EMPTY_ACTIVITY_SEGMENTS
  ).filter((segment) => !isFailedForegroundCaptureSegment(segment)))
    .map(segment => clipDeviceElapsedTimeSegment(segment, classificationRange === "Week"
      ? { start: Date.parse(classificationWeekRange.start), end: Date.parse(classificationWeekRange.end) }
      : { start: logicalDayStartMs(selectedDay, startOfDayMinutes), end: logicalDayEndExclusiveMs(selectedDay, startOfDayMinutes) })),
  [classificationRange, classificationWeekRange.end, classificationWeekRange.start, historySegments, segments, selectedDay, startOfDayMinutes, shouldBuildClassificationModels]);
  const classificationRuleSegments = useMemo(() => {
    if (classificationSegments.length === 0) return recordedDaySegments;
    if (recordedDaySegments.length === 0) return classificationSegments;
    const seenIds = new Set(classificationSegments.map((segment) => segment.id));
    return [
      ...classificationSegments,
      ...recordedDaySegments.filter((segment) => !seenIds.has(segment.id)),
    ];
  }, [classificationSegments, recordedDaySegments]);
  const classificationTotalSeconds = useMemo(() => totalDurationSeconds(classificationSegments), [classificationSegments]);
  const classificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: classificationSegments, includeAiClassifications: showAiClassificationImpact, includeBuiltInHeuristics: allowBuiltInHeuristics, builtInHeuristicsUnavailableSince }),
    [allowBuiltInHeuristics, builtInHeuristicsUnavailableSince, classificationSegments, showAiClassificationImpact],
  );
  const classificationProductivityTotals = useMemo(
    () => buildProductivityDurations(classificationSegments, classificationOptions),
    [classificationOptions, classificationSegments],
  );
  const classificationFocusRatePercent = useMemo(
    () => buildFocusRatePercent(classificationProductivityTotals),
    [classificationProductivityTotals],
  );
  const lastCaptureDistanceLabel = status?.lastEventAt
    ? formatRelativeTime(status.lastEventAt, localization.effectiveLanguage === "ko" ? "ko-KR" : "en-US")
    : localization.t("tracker.noCapturesYet");
  const uniqueAppsCount = useMemo(() => new Set(effectiveDashboardSegments.map((s) => s.bundleId ?? s.appName)).size, [effectiveDashboardSegments]);
  const averageSessionMinutes = effectiveDashboardSegments.length > 0 ? Math.round(totalSeconds / 60 / effectiveDashboardSegments.length) : 0;
  const topApp = dashboardTopApps[0];
  const topAppLabel = topApp?.appName ?? localization.t("tracker.noActivity");
  const { appLabel: liveAppLabel, siteLabel: liveSiteLabel } = resolveSidebarLiveActivityLabels({
    running: status?.running === true,
    snapshot: currentSnapshot,
    awaitingFirstSnapshot: awaitingFirstCurrentSnapshot,
    pendingAppLabel: localization.t("tracker.noActivity"),
    fallbackAppLabel: hostPlatform === "windows" && (liveCaptureGapExpired || windowsTrackingStopped)
      ? localization.t("tracker.noActivity")
      : topAppLabel,
  });
  const hasTimelineData = effectiveSelectedDaySegments.length > 0;
  const isBootstrappingTracker = loading && status === null;
  const trackerModeLabel = status?.trackerMode ?? "unknown";
  const isTrackerUnavailable = !status || trackerModeLabel === "unavailable";
  const isTrackerDegraded = trackerModeLabel === "degraded";
  const isDemoMode = trackerModeLabel === "demo" || status?.databasePath === "/tmp/drifty-demo.sqlite3";
  const isTrackerIdle = status?.running === true && trackerModeLabel === "idle";
  const trackerStateLabel = isBootstrappingTracker
    ? localization.t("tracker.loading")
    : isTrackerUnavailable
      ? localization.t("tracker.unavailable")
      : isTrackerDegraded
        ? localization.t("tracker.needsAttention")
        : status.running
          ? isTrackerIdle
            ? localization.t("tracker.idleNow")
            : isDemoMode
              ? localization.t("tracker.previewActive")
              : localization.t("tracker.trackingNow")
          : isDemoMode
            ? localization.t("tracker.previewPaused")
            : localization.t("tracker.trackingPaused");
  const liveTrackerActionLabel = trackerPausePending
    ? localization.t("tracker.pausing")
    : isTrackerUnavailable
      ? localization.t("tracker.unavailable")
      : status.running
        ? localization.t("tracker.pause")
        : status.trackingPaused
          ? localization.t("tracker.resume")
          : isTrackerDegraded
            ? localization.t("tracker.retry")
            : localization.t("tracker.resume");
  const replaySidebarTrackerCard = useMemo(() => buildDashboardDemoReplaySidebarCard({
    currentDay: effectiveTodayDayForWeekModel,
    currentMinuteOfDay: effectiveCurrentMinuteOfDay,
    replayState: dashboardDemoReplayState,
    segments: effectiveSelectedDaySegments,
    startOfDayMinutes,
  }), [
    dashboardDemoReplayState,
    effectiveCurrentMinuteOfDay,
    effectiveSelectedDaySegments,
    effectiveTodayDayForWeekModel,
    startOfDayMinutes,
  ]);
  const sidebarTrackerControlState = replaySidebarTrackerCard?.controlState ?? (isTrackerUnavailable ? "unavailable" : status?.running ? "pause" : "resume");
  // A degraded tracker leads with a short title that fits beside the control;
  // its message is the second line, which wraps in the menu block.
  const sidebarTrackerStatusLabel = replaySidebarTrackerCard?.statusLabel ?? (isTrackerUnavailable ? localization.t("tracker.setupNeeded") : isTrackerDegraded ? localization.t("tracker.needsAttentionShort") : trackerStateLabel);
  const sidebarTrackerDurationLabel = replaySidebarTrackerCard?.durationLabel ?? (isTrackerUnavailable || isTrackerDegraded ? null : formatDuration(dayTotalSeconds));
  const sidebarTrackerAppLabel = replaySidebarTrackerCard?.appLabel ?? (isTrackerUnavailable ? localization.t("tracker.startToCollect") : isTrackerDegraded ? (status?.message ?? localization.t("tracker.couldNotStart")) : liveAppLabel);
  const sidebarTrackerSiteLabel = replaySidebarTrackerCard?.siteLabel ?? liveSiteLabel;
  const sidebarTrackerMetaLabel = replaySidebarTrackerCard?.metaLabel ?? localization.t("tracker.lastCapture", { time: lastCaptureDistanceLabel });
  const sidebarTrackerActionLabel = replaySidebarTrackerCard?.actionLabel ?? liveTrackerActionLabel;
  const isSidebarTrackerActionDisabled = replaySidebarTrackerCard === null && (isTrackerUnavailable || trackerPausePending);
  // The account row speaks only when tracking needs the user (product decision
  // 2026-10-07). Loading, recording, idle and a dashboard replay stay quiet.
  const accountTrackerAttention: AccountTrackerAttention | null = replaySidebarTrackerCard || isBootstrappingTracker
    ? null
    : isTrackerUnavailable
      ? "setup"
      : isTrackerDegraded
        ? "attention"
        : status?.running
          ? null
          : "paused";
  // Paused or broken tracking takes the sidebar card slot ahead of every AI
  // and billing card (product decision 2026-10-07): those cards say activity
  // tracking continues. A browser build has no tracker to set up, so its
  // "Setup needed" stays in the account menu. A dev CTA preview keeps the slot.
  const sidebarTrackerCtaSlot = isSidebarCtaPreviewActive ? null : resolveTrackerCtaSlot({
    attention: accountTrackerAttention === "setup" && !isTauriRuntime() ? null : accountTrackerAttention,
    running: status?.running === true,
    trackingPaused: status?.trackingPaused === true,
    pausePending: trackerPausePending,
  });
  const visibleSidebarCtaSlot = isSettingsTab
    ? null
    : sidebarTrackerCtaSlot ?? (shouldShowSidebarCtaSlot ? sidebarCtaSlot : null);
  // The avatar badge stands in for the card only where no card shows the
  // state: the collapsed rail hides the slot. Settings swaps out this sidebar.
  const markAccountRowAttention = accountTrackerAttention !== null
    && (isSidebarVisuallyCollapsed || visibleSidebarCtaSlot?.kind !== "tracker");

  const activeSlots = dayField.filter((slot) => slot.totalSeconds > 0);
  const activeHours = Array.from(new Set(activeSlots.map((slot) => slot.hour)));
  const activeHourCount = activeHours.length;
  const peakSlot = dayField.reduce((cur, slot) => (slot.totalSeconds > cur.totalSeconds ? slot : cur), dayField[0]);
  const peakTrackedSeconds = peakSlot?.totalSeconds ?? 0;
  const peakWindowLabel = peakTrackedSeconds > 0
    ? formatLocalizedQuarterHourLabel(peakSlot.minuteOfDay, localization.effectiveLanguage)
    : "\u2014";
  const isCurrentClassificationRange = classificationRange === "Week"
    ? classificationWeekRange.startDay <= todayDay && todayDay <= classificationWeekRange.endDay
    : isTodaySelected;
  const rawNextClassificationDay = shiftIsoDate(selectedDay, classificationRange === "Week" ? 7 : 1);
  const canShiftClassificationForward = classificationRange === "Week"
    ? getDashboardPeriodRange(rawNextClassificationDay, "Week", startOfDayMinutes, startOfWeek).startDay <= todayDay
    : rawNextClassificationDay <= todayDay;
  const classificationDateLabel = classificationRange === "Week"
    ? formatLocalizedDateRangeLabel(classificationWeekRange.startDay, classificationWeekRange.endDay, localization.effectiveLanguage)
    : selectedDayLabel;
  const isCurrentDashboardPeriod = dashPeriod === "Week"
    ? dashboardRange.startDay <= todayDay && todayDay <= dashboardRange.endDay
    : isTodaySelected;
  const nextDashboardDay = shiftDashboardPeriodDay(selectedDay, dashPeriod, 1);
  const canShiftDashboardForward = dashPeriod === "Week"
    ? getDashboardPeriodRange(nextDashboardDay, dashPeriod, startOfDayMinutes, startOfWeek).startDay <= todayDay
    : nextDashboardDay <= todayDay;
  const nextInsightDay = shiftInsightPeriodDay(selectedDay, trendsRange, 1);
  const canShiftInsightForward = nextInsightDay <= todayDay;
  const dashboardDateLabel = dashPeriod === "Week"
    ? formatLocalizedDateRangeLabel(dashboardRange.startDay, dashboardRange.endDay, localization.effectiveLanguage)
    : dashPeriod === "Today"
      ? formatLocalizedDayLabel(selectedDay, localization.effectiveLanguage)
      : selectedDayLabel;
  const insightDateLabel = formatLocalizedDateRangeLabel(insightRange.startDay, insightRange.endDay, localization.effectiveLanguage);
  const endOfDayReviewQueryPreviewMode = new URLSearchParams(window.location.search).get("driftyEndOfDayReviewPreview");
  const shouldShowEndOfDayReviewPreview = END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED && isDevModeActive && import.meta.env.VITE_DRIFTY_END_OF_DAY_REVIEW_PREVIEW === "1";

  useEffect(() => {
    if (!END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED) return;
    if (!isDevModeActive) return;
    if (!hasLoadedOnce) return;
    if (endOfDayReviewQueryPreviewShownRef.current) return;
    if (!shouldShowEndOfDayReviewPreview && endOfDayReviewQueryPreviewMode !== "1" && endOfDayReviewQueryPreviewMode !== "pending") return;

    endOfDayReviewQueryPreviewShownRef.current = true;
    const showPendingAssessment = endOfDayReviewQueryPreviewMode === "pending";
    void buildEndOfDayReviewEvent({
      day: todayDay,
      generatedAt: new Date().toISOString(),
      segments: showPendingAssessment
        ? buildMockPendingEndOfDayReviewSegments(todayDay)
        : buildMockEndOfDayReviewSegments(todayDay),
      assessment: showPendingAssessment ? {
        state: "pending",
        route: "cloud",
        reason: "cloud_trial_expired",
        recoveryAction: "upgrade",
        unavailableSince: new Date(`${todayDay}T14:20:00`).toISOString(),
      } : null,
      isMock: true,
    }).then(showEndOfDayReview);
  }, [buildEndOfDayReviewEvent, endOfDayReviewQueryPreviewMode, hasLoadedOnce, isDevModeActive, showEndOfDayReview, shouldShowEndOfDayReviewPreview, todayDay]);

  /* The leaderboard checkpoint keeps its fixed evening slot so every
     participant's daily score lands at the same time. It is independent of
     the Day Review, which has its own scheduler below. */
  const leaderboardCheckpointInFlightRef = useRef(false);
  useEffect(() => {
    if (!END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED) return;
    // Product captures should stay deterministic. Preview/demo surfaces must
    // not inherit time-based automatic moments from the live app.
    if (isPreviewSurface) return;
    if (!hasLoadedOnce) return;
    if (selectedDay !== todayDay || segmentsLoadedDay !== todayDay) return;
    if (!status?.running) return;
    if (currentMinuteOfDay === null) return;
    if (currentMinuteOfDay < END_OF_DAY_REVIEW_TRIGGER_MINUTE) return;
    if (classificationAvailabilityGateEnabled
      && (classificationAvailability.state === "checking" || classificationAvailability.state === "retrying")) return;
    if (!classificationAssessmentReady) return;
    if (window.localStorage.getItem(END_OF_DAY_LEADERBOARD_CHECKPOINT_STORAGE_KEY) === todayDay) return;
    if (segments.length === 0) return;
    if (leaderboardCheckpointInFlightRef.current) return;

    leaderboardCheckpointInFlightRef.current = true;
    void (async () => {
      try {
        if (isSupabaseConfigured && isPolicySignedIn && !shouldUsePreviewData()) {
          // Keep the current public board fresh, then materialize the exact
          // local aggregate separately. The checkpoint write bypasses
          // unchanged-score suppression without temporarily replacing the
          // public board row.
          await syncLeaderboardPublication("slot");
          await publishLeaderboardCheckpoint("daily", todayDay);
        }
      } finally {
        window.localStorage.setItem(END_OF_DAY_LEADERBOARD_CHECKPOINT_STORAGE_KEY, todayDay);
        leaderboardCheckpointInFlightRef.current = false;
      }
    })();
  }, [classificationAssessmentReady, classificationAvailability.state, classificationAvailabilityGateEnabled, currentMinuteOfDay, hasLoadedOnce, isPolicySignedIn, isPreviewSurface, isSupabaseConfigured, publishLeaderboardCheckpoint, segments, segmentsLoadedDay, selectedDay, status?.running, syncLeaderboardPublication, todayDay]);

  /* Day Review scheduling lives in one place (features/companion/dayReviewScheduler.ts).
     The app only supplies the day's timeline, the user-presence probe, and the
     card builder; the hook owns the clock, the window, and the per-day record. */
  const loadDayReviewSegments = useCallback(async (day: string): Promise<ActivitySegment[]> => {
    const range = getLogicalDayRange(day, day, startOfDayMinutes);
    return materializeBuiltInHeuristicTimeline(await trackerClient.getTimeline(range)).segments;
  }, [materializeBuiltInHeuristicTimeline, startOfDayMinutes]);

  const readDayReviewUserActive = useCallback(async (): Promise<boolean> => {
    try {
      const current = await trackerClient.getStatus();
      if (!current.running) return false;
      if (current.trackerMode === "idle") return false;
      return isDayReviewUserActive({
        idleSeconds: current.idleSeconds,
        idleDetectionAvailable: current.idleDetectionAvailable,
      });
    } catch {
      /* An unreachable tracker is not evidence of absence; the card still
         needs its display acknowledgement before the day closes. */
      return true;
    }
  }, []);

  /* The review compares with the previous logical day; a missing timeline only drops the comparison. */
  const loadPreviousReviewDaySegments = useCallback(async (day: string): Promise<ActivitySegment[] | undefined> => {
    const previousDay = shiftIsoDate(day, -1);
    try {
      return materializeBuiltInHeuristicTimeline(await trackerClient.getTimeline(getLogicalDayRange(previousDay, previousDay, startOfDayMinutes))).segments;
    } catch {
      return undefined;
    }
  }, [materializeBuiltInHeuristicTimeline, startOfDayMinutes]);
  const presentScheduledDayReview = useCallback(async (request: DayReviewPresentationRequest): Promise<DayReviewDeliveryResult> => {
    let leaderboardCelebration: LeaderboardCelebration | undefined;
    try {
      if (classificationAssessmentReadyRef.current && isSupabaseConfigured && isPolicySignedIn && !shouldUsePreviewData()) {
        const checkpoint = await fetchOwnLeaderboardCheckpoint("daily", request.day);
        if (checkpoint?.success) {
          leaderboardCelebration = toLeaderboardCelebration(checkpoint.data ?? null, "daily", request.day) ?? undefined;
        }
      }
    } catch {
      leaderboardCelebration = undefined;
    }
    const previousDaySegments = await loadPreviousReviewDaySegments(request.day);
    const event = await buildEndOfDayReviewEvent({
      day: request.day,
      generatedAt: new Date().toISOString(),
      segments: request.segments,
      previousDaySegments,
      startOfDayMinutes,
      leaderboardCelebration,
    });
    return showEndOfDayReview({ ...event, presentationDay: request.day, expiresAt: request.expiresAt });
  }, [buildEndOfDayReviewEvent, isPolicySignedIn, isSupabaseConfigured, loadPreviousReviewDaySegments, showEndOfDayReview, startOfDayMinutes]);

  useDayReviewScheduler({
    active: END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED
      && hasLoadedOnce
      && !shouldBlockLocalTrackerAccess
      && status?.running === true,
    previewSurface: isPreviewSurface,
    dayReviewEnabled,
    reviewMinute: endOfDayReviewMinute,
    startOfDayMinutes,
    quietHours,
    onboardingCompletedAt,
    loadDaySegments: loadDayReviewSegments,
    readUserActive: readDayReviewUserActive,
    present: presentScheduledDayReview,
  });

  const insightCategoryTotals = useMemo(() => buildCategoryDurations(activeInsightSegments, insightClassificationOptions), [activeInsightSegments, insightClassificationOptions]);
  const activeInsightCategoryTotals = useMemo(
    () => insightCategoryTotals.filter((entry) => entry.totalSeconds > 0).sort((left, right) => right.totalSeconds - left.totalSeconds),
    [insightCategoryTotals],
  );
  const insightProductivityTotals = useMemo(() => buildProductivityDurations(activeInsightSegments, insightClassificationOptions), [activeInsightSegments, insightClassificationOptions]);
  const activeInsightProductivityTotals = useMemo(() => insightProductivityTotals.filter((entry) => entry.totalSeconds > 0), [insightProductivityTotals]);
  // weeklyBreakdown is declared below, after insightProjectBySegmentId, so the
  // Project weekly buckets can read the segment→project map without a TDZ.
  const attentionRhythm = useMemo(
    () => buildAttentionRhythm(activeInsightSegments, insightClassificationOptions, insightRhythmVisibility),
    [activeInsightSegments, insightClassificationOptions, insightRhythmVisibility],
  );
  const driftSourceLists = useMemo(
    () => buildInsightSourceLists(activeInsightSegments, "drift", insightClassificationOptions),
    [activeInsightSegments, insightClassificationOptions],
  );
  const focusSourceLists = useMemo(
    () => buildInsightSourceLists(activeInsightSegments, "focus", insightClassificationOptions),
    [activeInsightSegments, insightClassificationOptions],
  );
  const alarmFollowThrough = useMemo(
    () => buildAlarmFollowThrough({
      interactions: driftAlarmInteractions,
      segments: activeInsightSegments,
      classificationOptions: insightClassificationOptions,
      rangeStart: insightRange.start,
      rangeEnd: insightRange.end,
    }),
    [activeInsightSegments, driftAlarmInteractions, insightClassificationOptions, insightRange.end, insightRange.start],
  );
  const insightSiteSummary = insightTopSites.slice(0, 5);
  const selectedDayRange = useMemo(() => getLogicalDayRange(selectedDay, selectedDay, startOfDayMinutes), [selectedDay, startOfDayMinutes]);
  const updateSharedCustomEndpoint = useCallback((next: { readonly baseUrl: string; readonly apiKey: string }) => {
    setLocalAiSetup((current) => ({
      ...current,
      selfHostedBaseUrl: next.baseUrl,
      selfHostedApiKey: next.apiKey,
    }));
  }, [setLocalAiSetup]);
  const sharedCustomEndpointConnection = useMemo(() => ({
    baseUrl: localAiSetup.selfHostedBaseUrl,
    apiKey: localAiSetup.selfHostedApiKey,
    credentialState: customEndpointCredentialState,
    retryCredentialRead: retryCustomEndpointKeyRead,
    preferStoredConnection: shouldPreferLegacyAnalysisCustomConnection(localAiSetup),
    onChange: updateSharedCustomEndpoint,
  }), [
    customEndpointCredentialState,
    retryCustomEndpointKeyRead,
    localAiSetup.selfHostedApiKey,
    localAiSetup.selfHostedBaseUrl,
    localAiSetup.selfHostedModel,
    updateSharedCustomEndpoint,
  ]);
  const analysisModel = useAnalysisModelSetup(
    isSupabaseConfigured,
    localAiSetup.provider,
    sharedCustomEndpointConnection,
    { ownerKey: user?.id ?? "local", cloudFallbackAllowed: cloudAiSelected, cloudReady: cloudClassificationAvailability.state === "ready" },
  );
  const projectAnalysisConnected = resolveProjectAnalysisConnected({
    analysisConnected: analysisModel.analysisConnected,
    analysisProvider: analysisModel.effectiveAnalysisSetup.provider,
    cloudAvailability: cloudClassificationAvailability,
    gateEnabled: classificationAvailabilityGateEnabled,
  });
  // One-shot: "AI setup" on the Projects page lands on the Intelligence tab.
  const [aiSetupRequestedTab, setAiSetupRequestedTab] = useState<"providers" | "intelligence" | null>(null);
  const projectClassification = useProjectClassification({
    tracker: trackerClient,
    selectedDayRange,
    startOfDayMinutes,
    insightRange: { start: insightRange.start, end: insightRange.end },
    analysisSetup: analysisModel.effectiveAnalysisSetup,
    requestScopeKey: analysisModel.requestScopeKey,
    analysisOwnerId: user?.id ?? null,
    analysisCloudRecovery: analysisModel.usingCloudRecovery,
    onProviderUnavailable: analysisModel.markUnavailable,
    canFallbackToCloud: analysisModel.canFallbackNow,
    resolveOpenRouterKey: analysisModel.resolveOpenRouterKey,
    analysisConnected: projectAnalysisConnected,
    onClassificationChanged: () => { void refreshHistoryData(); },
  });
  const dashboardProjectRange = useMemo(
    () => getLogicalDayRange(effectiveDashboardRange.startDay, effectiveDashboardRange.endDay, startOfDayMinutes),
    [effectiveDashboardRange.endDay, effectiveDashboardRange.startDay, startOfDayMinutes],
  );
  const dashboardProjectRangeKey = `${dashboardProjectRange.start}:${dashboardProjectRange.end}`;
  const [dashboardProjectAssignmentLoad, setDashboardProjectAssignmentLoad] = useState<{
    readonly key: string;
    readonly assignments: ProjectAssignmentRecord[];
    readonly windowAssignments: ProjectWindowAssignmentRecord[];
  }>({ key: "", assignments: [], windowAssignments: [] });

  useEffect(() => {
    if (activeTab !== "dashboard" || dashPeriod !== "Week") return undefined;
    if (isDashboardDemoReplayActive || (!isPreviewSurface && shouldBlockLocalTrackerAccess)) {
      setDashboardProjectAssignmentLoad({
        key: dashboardProjectRangeKey,
        assignments: [],
        windowAssignments: [],
      });
      return undefined;
    }

    let cancelled = false;
    void Promise.all([
      trackerClient.getProjectAssignments?.(dashboardProjectRange) ?? Promise.resolve<ProjectAssignmentRecord[]>([]),
      trackerClient.getProjectWindowAssignments?.(dashboardProjectRange) ?? Promise.resolve([]),
    ]).then(([assignments, windowAssignments]) => {
      if (cancelled) return;
      setDashboardProjectAssignmentLoad({
        key: dashboardProjectRangeKey,
        assignments: assignments ?? [],
        windowAssignments,
      });
    }).catch(() => {
      if (cancelled) return;
      setDashboardProjectAssignmentLoad({
        key: dashboardProjectRangeKey,
        assignments: [],
        windowAssignments: [],
      });
    });
    return () => { cancelled = true; };
  }, [
    activeTab,
    dashPeriod,
    dashboardProjectRange,
    dashboardProjectRangeKey,
    isDashboardDemoReplayActive,
    isPreviewSurface,
    projectClassification.lastSuccessfulPassAtMs,
    shouldBlockLocalTrackerAccess,
  ]);

  const activityInspectorProjectOptions = useMemo<readonly ActivityInspectorProjectOption[]>(
    () => projectClassification.projects
      .filter((project) => project.status === "active")
      .map((project) => ({ id: project.id, name: project.name, color: project.color })),
    [projectClassification.projects],
  );
  const dashboardInspectorProjectBySegmentId = useMemo(() => {
    const usesWeekAssignments = dashPeriod === "Week" && dashboardProjectAssignmentLoad.key === dashboardProjectRangeKey;
    return buildDashboardProjectBySegmentId(
      effectiveDashboardSegments,
      usesWeekAssignments ? dashboardProjectAssignmentLoad.assignments : projectClassification.assignments,
      usesWeekAssignments ? dashboardProjectAssignmentLoad.windowAssignments : projectClassification.windowAssignments,
    );
  }, [
    dashPeriod,
    dashboardProjectAssignmentLoad,
    dashboardProjectRangeKey,
    effectiveDashboardSegments,
    projectClassification.assignments,
    projectClassification.windowAssignments,
  ]);
  // Preserve the fixed 3-minute decisions as virtual activity slices. Legacy
  // segment rows remain as fallback for days that have not been re-analyzed yet,
  // and manual segment assignments override every overlapping AI slice.
  const insightProjectProjection = useMemo(
    () => buildPersonalProjectSliceProjection(
      activeInsightSegments,
      projectClassification.insightWindowAssignments,
      projectClassification.insightAssignments,
    ),
    [activeInsightSegments, projectClassification.insightAssignments, projectClassification.insightWindowAssignments],
  );
  const insightProjectBySegmentId = insightProjectProjection.projectBySegmentId;
  const weeklyProjectChart = useMemo(() => {
    const NO_PROJECT_SERIES_COLOR = "#9ca3af";
    const totals = new Map<string, number>();
    for (const segment of insightProjectProjection.segments) {
      const projectId = insightProjectBySegmentId.get(segment.id);
      if (!projectId) continue;
      totals.set(projectId, (totals.get(projectId) ?? 0) + segment.durationSeconds);
    }
    const projectById = new Map(projectClassification.projects.map((project) => [project.id, project]));
    const ordered = [...totals.entries()].filter(([, seconds]) => seconds > 0).sort((left, right) => right[1] - left[1]);
    const realSeries = ordered.map(([id]) => ({ key: id, color: projectById.get(id)?.color ?? "#6366f1" }));
    const available = realSeries.length > 0;
    const meta = new Map(ordered.map(([id]) => [id, { label: projectById.get(id)?.name ?? "Project", color: projectById.get(id)?.color ?? "#6366f1" }]));
    // Append a gray "No project" series so the Project lens covers all classified
    // time (assigned + unassigned) and matches the Category/Productivity totals.
    const series = available ? [...realSeries, { key: NO_PROJECT_KEY, color: NO_PROJECT_SERIES_COLOR }] : [];
    if (available) meta.set(NO_PROJECT_KEY, { label: localization.t("projects.chart.noProject"), color: NO_PROJECT_SERIES_COLOR });
    return { series, meta, available };
  }, [insightProjectBySegmentId, insightProjectProjection.segments, localization, projectClassification.projects]);
  const weeklyBreakdown = useMemo(
    () => buildWeeklyBreakdown(
      activeInsightSegments,
      insightClassificationOptions,
      insightWeekVisibility,
      insightProjectBySegmentId,
      insightProjectProjection.segments,
    ),
    [activeInsightSegments, insightClassificationOptions, insightWeekVisibility, insightProjectBySegmentId, insightProjectProjection.segments],
  );
  const selectedDayProjectProjection = useMemo(
    () => buildPersonalProjectSliceProjection(
      effectiveSelectedDaySegments,
      projectClassification.windowAssignments,
      projectClassification.assignments,
    ),
    [effectiveSelectedDaySegments, projectClassification.assignments, projectClassification.windowAssignments],
  );
  const flowProjectColorBySegment = useMemo(
    () => {
      const colors = projectColorMap(projectClassification.projects);
      return new Map(
        [...selectedDayProjectProjection.projectBySegmentId].map(([segmentId, projectId]) => [
          segmentId,
          colors.get(projectId) ?? NO_PROJECT_COLOR,
        ] as const),
      );
    },
    [projectClassification.projects, selectedDayProjectProjection.projectBySegmentId],
  );
  // Flow consumes the same fixed-window virtual slices as every project total,
  // so adjacent decisions never collapse back onto one raw source segment.
  const flowProjectIdBySegment = selectedDayProjectProjection.projectBySegmentId;
  const flowProjectLegend = useMemo(
    () => {
      const assignedIds = new Set(selectedDayProjectProjection.projectBySegmentId.values());
      const entries: ProjectLegendEntry[] = projectClassification.projects
        .filter((project) => project.status === "active" && assignedIds.has(project.id))
        .map((project) => ({ projectId: project.id, name: project.name, color: project.color }));
      const hasUnassigned = selectedDayProjectProjection.segments.some(
        (segment) => !selectedDayProjectProjection.projectBySegmentId.has(segment.id),
      );
      if (hasUnassigned || entries.length === 0) {
        entries.push({ projectId: null, name: localization.t("projects.chart.noProject"), color: NO_PROJECT_COLOR });
      }
      return entries;
    },
    [localization, projectClassification.projects, selectedDayProjectProjection.projectBySegmentId, selectedDayProjectProjection.segments],
  );
  const selectedDayProjectBySegmentId = selectedDayProjectProjection.projectBySegmentId;
  // The Projects tab isn't the Trends tab, so the rolling insight segments aren't
  // loaded here. Load a dedicated trend window (segments + assignments) for the
  // project trend chart + table, refreshing whenever a pass finishes. The window
  // is owned by the page's Day/Week/Month range controls: no fetch happens until
  // the page reports its window, so the first load is the one that gets drawn
  // (the sidecar serializes requests, so a discarded speculative fetch would
  // delay the real one behind it).
  const [projectsTrend, setProjectsTrend] = useState<{
    readonly segments: ActivitySegment[];
    readonly assignments: ProjectAssignmentRecord[];
    readonly windowAssignments: ProjectWindowAssignmentRecord[];
    readonly loadedRange: { readonly startDay: string; readonly endDay: string } | null;
  }>({ segments: [], assignments: [], windowAssignments: [], loadedRange: null });
  const [projectsTrendRange, setProjectsTrendRange] = useState<{ readonly startDay: string; readonly endDay: string } | null>(null);
  const handleProjectsTrendWindowChange = useCallback((next: { readonly startDay: string; readonly endDay: string }) => {
    setProjectsTrendRange((previous) =>
      previous && previous.startDay === next.startDay && previous.endDay === next.endDay ? previous : next,
    );
  }, []);
  useEffect(() => {
    if (activeTab !== "projects" || projectClassification.running || !projectsTrendRange) return;
    let cancelled = false;
    const { startDay, endDay } = projectsTrendRange;
    const range = getLogicalDayRange(startDay, endDay, startOfDayMinutes);
    void (async () => {
      try {
        const [segments, assignments, windowAssignments] = await Promise.all([
          // Slim per-segment view (identity/timing/app/site only): the full
          // timeline payload is ~7x larger and multi-day windows made the tab
          // visibly slow to load.
          trackerClient.getProjectTrendTimeline?.(range) ?? trackerClient.getTimeline(range),
          trackerClient.getProjectAssignments?.(range) ?? Promise.resolve<ProjectAssignmentRecord[]>([]),
          trackerClient.getProjectWindowAssignments(range),
        ]);
        if (!cancelled) setProjectsTrend({ segments, assignments: assignments ?? [], windowAssignments, loadedRange: { startDay, endDay } });
      } catch {
        if (!cancelled) setProjectsTrend({ segments: [], assignments: [], windowAssignments: [], loadedRange: { startDay, endDay } });
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, startOfDayMinutes, projectClassification.running, projectsTrendRange, trackerClient]); // eslint-disable-line react-hooks/exhaustive-deps
  const projectsTrendProjection = useMemo(
    () => buildPersonalProjectSliceProjection(
      projectsTrend.segments,
      projectsTrend.windowAssignments,
      projectsTrend.assignments,
    ),
    [projectsTrend.assignments, projectsTrend.segments, projectsTrend.windowAssignments],
  );
  const projectsTrendProjectBySegmentId = projectsTrendProjection.projectBySegmentId;
  // Per-project split of the selected day, for the dashboard donut's Project mode
  // (the flow chart's Project toggle swaps the productivity donut to this).
  const dashboardProjectRing = useMemo(() => {
    const secondsByProject = new Map<string, number>();
    for (const segment of selectedDayProjectProjection.segments) {
      const projectId = selectedDayProjectProjection.projectBySegmentId.get(segment.id);
      if (projectId) secondsByProject.set(projectId, (secondsByProject.get(projectId) ?? 0) + segment.durationSeconds);
    }
    const projectById = new Map(projectClassification.projects.map((project) => [project.id, project]));
    const total = [...secondsByProject.values()].reduce((sum, value) => sum + value, 0);
    const entries: CompactRingEntry[] = [...secondsByProject.entries()]
      .filter(([, seconds]) => seconds > 0)
      .sort((left, right) => right[1] - left[1])
      .map(([id, seconds]) => {
        const color = projectById.get(id)?.color ?? "#9ca3af";
        return {
          key: id,
          label: projectById.get(id)?.name ?? "Project",
          color,
          totalSeconds: seconds,
          ratio: total > 0 ? seconds / total : 0,
          matchesBlock: (block) => block.projectColor === color,
        };
      });
    const centerPercent = total > 0 ? Math.round(((entries[0]?.totalSeconds ?? 0) / total) * 100) : 0;
    return { entries, centerPercent };
  }, [projectClassification.projects, selectedDayProjectProjection.projectBySegmentId, selectedDayProjectProjection.segments]);
  const [flowBlocks, summaryFlowBlocks] = useMemo(() => {
    const blocksByInterval = buildFlowBlocksForIntervals(
      effectiveSelectedDaySegments,
      selectedDay,
      [YOUR_DAY_FLOW_INTERVAL_MINUTES, DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES],
      effectiveSelectedDayClassificationOptions,
      startOfDayMinutes,
      flowProjectColorBySegment,
      flowProjectIdBySegment,
      selectedDayProjectProjection.segments,
    );
    return [
      blocksByInterval.get(YOUR_DAY_FLOW_INTERVAL_MINUTES) ?? [],
      blocksByInterval.get(DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES) ?? [],
    ] as const;
  }, [effectiveSelectedDayClassificationOptions, effectiveSelectedDaySegments, selectedDayProjectProjection.segments, selectedDay, startOfDayMinutes, flowProjectColorBySegment, flowProjectIdBySegment]);
  // Which newly created project is waiting on (or running) automatic matching,
  // so the Projects row can show an honest state instead of a finished-looking
  // "0m" for a project that has never been analyzed.
  const [projectAutoAnalysis, setProjectAutoAnalysis] = useState<ProjectAutoAnalysisState>(IDLE_PROJECT_AUTO_ANALYSIS);
  // The waiting state itself is the source of truth for "which projects still
  // need a run", so retrying from the matching card resumes them instead of
  // leaving their rows stuck on the pending label.
  const projectsAwaitingAnalysis = projectsAwaitingAutoAnalysis(projectAutoAnalysis);
  // One pass covers the whole latest-7-days window, so every waiting project
  // resolves together rather than queueing a separate run per project.
  const runProjectAutoAnalysis = useCallback(async (projectIds: readonly string[]) => {
    if (projectIds.length === 0) return;
    setProjectAutoAnalysis((current) => projectIds.reduce(
      (next, projectId) => setProjectAutoAnalysisPhase(next, projectId, "running"),
      current,
    ));
    const summary = await projectClassification.backfillLast7Days({ quiet: true });
    // A pass that ran but had chunks fail is not a completed empty result; the
    // row must keep offering a retry instead of claiming "No recent match".
    const resolvedPhase = summary === null || (summary.failedChunks ?? 0) > 0 ? "error" : "complete";
    setProjectAutoAnalysis((current) => resolveProjectAutoAnalysisAfterPass(current, projectIds, resolvedPhase));
  }, [projectClassification]);
  // Creating projects is bursty: people often add several in a row. One pass
  // already covers the whole latest-7-days window for every project, so the
  // burst is collected and run once after it settles instead of paying for a
  // separate provider round per project.
  const runProjectAutoAnalysisRef = useRef(runProjectAutoAnalysis);
  useEffect(() => {
    runProjectAutoAnalysisRef.current = runProjectAutoAnalysis;
  });
  const queuedAutoAnalysisIdsRef = useRef<string[]>([]);
  const queuedAutoAnalysisTimerRef = useRef<number | null>(null);
  // Creating the first project also satisfies the scheduler's "has an active
  // project" gate, which would otherwise fire its own on-open tick over the
  // same window while the debounce is still collecting. Marking the tick as
  // already spent keeps a burst of creations to exactly one pass.
  const projectPassOpenTickedRef = useRef(false);
  const flushQueuedProjectAutoAnalysis = useCallback(() => {
    queuedAutoAnalysisTimerRef.current = null;
    const projectIds = queuedAutoAnalysisIdsRef.current;
    queuedAutoAnalysisIdsRef.current = [];
    if (projectIds.length > 0) void runProjectAutoAnalysisRef.current(projectIds);
  }, []);
  // A project deleted (or archived) inside the debounce window should not pull
  // a provider pass along with it.
  const dropQueuedProjectAutoAnalysis = useCallback((projectId: string) => {
    queuedAutoAnalysisIdsRef.current = queuedAutoAnalysisIdsRef.current.filter((id) => id !== projectId);
    if (queuedAutoAnalysisIdsRef.current.length === 0 && queuedAutoAnalysisTimerRef.current !== null) {
      window.clearTimeout(queuedAutoAnalysisTimerRef.current);
      queuedAutoAnalysisTimerRef.current = null;
    }
    setProjectAutoAnalysis((current) => {
      if (!(projectId in current)) return current;
      const next = { ...current };
      delete next[projectId];
      return next;
    });
  }, []);
  const handleDeleteProject = useCallback(async (projectId: string): Promise<ProjectDeleteResult> => {
    dropQueuedProjectAutoAnalysis(projectId);
    let deleteError = "";
    const deleted = await projectClassification.deleteProject(projectId, (message) => { deleteError = message; });
    return deleted ? true : { deleted: false, error: deleteError };
  }, [dropQueuedProjectAutoAnalysis, projectClassification]);
  const scheduleProjectAutoAnalysis = useCallback((projectId: string) => {
    projectPassOpenTickedRef.current = true;
    if (!queuedAutoAnalysisIdsRef.current.includes(projectId)) {
      queuedAutoAnalysisIdsRef.current.push(projectId);
    }
    setProjectAutoAnalysis((current) => setProjectAutoAnalysisPhase(current, projectId, "queued"));
    // A newer project restarts the window, so a steady stream of creations
    // still resolves in a single pass once the user stops.
    if (queuedAutoAnalysisTimerRef.current !== null) window.clearTimeout(queuedAutoAnalysisTimerRef.current);
    queuedAutoAnalysisTimerRef.current = window.setTimeout(flushQueuedProjectAutoAnalysis, PROJECT_AUTO_ANALYSIS_DEBOUNCE_MS);
  }, [flushQueuedProjectAutoAnalysis]);
  useEffect(() => () => {
    if (queuedAutoAnalysisTimerRef.current !== null) window.clearTimeout(queuedAutoAnalysisTimerRef.current);
  }, []);
  // Connecting a model is what unblocks projects parked on "Setup needed", so
  // they resume through the same debounce instead of waiting for a manual click.
  const scheduleProjectAutoAnalysisRef = useRef(scheduleProjectAutoAnalysis);
  useEffect(() => {
    scheduleProjectAutoAnalysisRef.current = scheduleProjectAutoAnalysis;
  });
  useEffect(() => {
    if (!projectAnalysisConnected) return;
    const blocked = projectsBlockedOnModel(projectAutoAnalysis);
    if (blocked.length === 0) return;
    for (const projectId of blocked) scheduleProjectAutoAnalysisRef.current(projectId);
  }, [projectAnalysisConnected, projectAutoAnalysis]);
  const requestProjectPassRun = useCallback(() => {
    // An explicit click should not wait out the debounce window.
    if (queuedAutoAnalysisTimerRef.current !== null) {
      window.clearTimeout(queuedAutoAnalysisTimerRef.current);
      flushQueuedProjectAutoAnalysis();
      return;
    }
    if (projectsAwaitingAnalysis.length > 0) {
      void runProjectAutoAnalysis(projectsAwaitingAnalysis);
      return;
    }
    void projectClassification.backfillLast7Days();
  }, [flushQueuedProjectAutoAnalysis, projectsAwaitingAnalysis, projectClassification, runProjectAutoAnalysis]);
  // Creating a project is the moment the user expects results, so persistence
  // success starts the same latest-7-days pass the manual action runs. Project
  // matching sends the same minimized fields to the same configured provider as
  // live AI classification, under the same privacy settings, so it follows that
  // surface's boundary instead of adding a separate approval step. Missing model
  // setup stays explicit: it becomes a visible state on the new project rather
  // than a silent no-op.
  const handleSaveProject = useCallback(async (input: ProjectInput): Promise<ProjectSaveResult> => {
    const isNewActiveProject = !input.id && (input.status ?? "active") === "active";
    let saveError: string | null = null;
    const saved = await projectClassification.saveProject(input, (message) => { saveError = message; });
    if (!saved) return { saved: false, error: localization.t("projects.editor.saveError"), detail: saveError };
    // Archiving is an edit, not a creation: it must also release any queued
    // matching for that project so an archived project cannot pull a provider
    // pass along behind it.
    if (saved.id && saved.status !== "active") {
      dropQueuedProjectAutoAnalysis(saved.id);
      return true;
    }
    if (!isNewActiveProject || !saved.id) return true;

    if (!projectAnalysisConnected) {
      setProjectAutoAnalysis((current) => setProjectAutoAnalysisPhase(current, saved.id, "waiting_for_model"));
      return true;
    }
    scheduleProjectAutoAnalysis(saved.id);
    return true;
  }, [dropQueuedProjectAutoAnalysis, localization, projectAnalysisConnected, projectClassification, scheduleProjectAutoAnalysis]);
  // Keyed on the last pass that actually completed cleanly, not on the newest
  // recorded row: a partially failed pass still records a row (its tokens were
  // spent) but leaves the window stale, and locking the retry behind it would
  // hide the button exactly when it is needed.
  const lastSuccessfulProjectPassAtMs = projectClassification.lastSuccessfulPassAtMs;
  const [projectMatchCooldown, setProjectMatchCooldown] = useState(NO_PROJECT_MATCH_COOLDOWN);
  useEffect(() => {
    const next = resolveProjectMatchCooldown(lastSuccessfulProjectPassAtMs, Date.now());
    setProjectMatchCooldown(next);
    if (!next.active) return undefined;
    // Tick only while the guard is live; the label counts down to zero and the
    // button re-enables without needing a tab switch.
    const intervalId = window.setInterval(() => {
      const current = resolveProjectMatchCooldown(lastSuccessfulProjectPassAtMs, Date.now());
      setProjectMatchCooldown(current);
      if (!current.active) window.clearInterval(intervalId);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [lastSuccessfulProjectPassAtMs]);
  const dashboardCategoryTotals = useMemo(() => buildCategoryDurations(effectiveDashboardSegments, dashboardClassificationOptions), [dashboardClassificationOptions, effectiveDashboardSegments]);
  const classificationCategoryBreakdowns = useMemo(
    () => buildClassificationCategoryBreakdowns(classificationSegments, classificationOptions, classificationTotalSeconds),
    [classificationOptions, classificationSegments, classificationTotalSeconds],
  );
  const effectiveClassifyCategoryId = useMemo(() => {
    if (classificationCategoryBreakdowns.some((b) => b.category === classifySelectedCategoryId)) return classifySelectedCategoryId;
    return classificationCategoryBreakdowns[0]?.category ?? null;
  }, [classifySelectedCategoryId, classificationCategoryBreakdowns]);
  const selectedClassificationBreakdown = useMemo(
    () => classificationCategoryBreakdowns.find((b) => b.category === effectiveClassifyCategoryId) ?? null,
    [classificationCategoryBreakdowns, effectiveClassifyCategoryId],
  );
  const selectedClassificationTone = selectedClassificationBreakdown
    ? CATEGORY_COLORS[selectedClassificationBreakdown.category]
    : "var(--accent)";
  const classificationPanelStyle: ClassificationPanelStyle = {
    "--classification-selected-tone": selectedClassificationTone,
  };
  const selectedClassificationSegments = useMemo(
    () => selectedClassificationBreakdown
      ? classificationSegments.filter((s) => classifyActivity(s, classificationOptions).category === selectedClassificationBreakdown.category)
      : [],
    [classificationOptions, classificationSegments, selectedClassificationBreakdown],
  );
  const classificationSourceSegments = selectedClassificationSegments;
  const classificationSourceSummaries = useMemo(
    () => buildClassificationSourceSummaries(classificationSourceSegments, classificationOptions),
    [classificationOptions, classificationSourceSegments],
  );
  const effectiveClassifySourceId = useMemo(() => {
    if (classificationSourceSummaries.some((s) => classifySourceKey(s) === classifySelectedSourceId)) return classifySelectedSourceId;
    return classificationSourceSummaries.length > 0 ? classifySourceKey(classificationSourceSummaries[0]) : null;
  }, [classifySelectedSourceId, classificationSourceSummaries]);
  const selectedClassificationSourceSummary = useMemo(
    () => classificationSourceSummaries.find((s) => classifySourceKey(s) === effectiveClassifySourceId) ?? null,
    [classificationSourceSummaries, effectiveClassifySourceId],
  );
  const classificationActivityRows = useMemo(() => {
    if (!selectedClassificationSourceSummary) return [];
    return buildClassificationActivityRows(
      classificationSourceSegments.filter((s) => classifySegmentSourceKey(s) === effectiveClassifySourceId),
    );
  }, [selectedClassificationSourceSummary, classificationSourceSegments, effectiveClassifySourceId]);
  const classificationActivityPeakSeconds = useMemo(
    () => Math.max(...classificationActivityRows.map((r) => r.totalSeconds), 0),
    [classificationActivityRows],
  );
  useEffect(() => {
    if (activeTab !== "classification") return;
    setExpandedClassificationActivityRows(new Set());
    setClassificationCorrectionDraft(null);
    setClassificationCorrectionNotice(null);
  }, [activeTab, classificationRange, selectedDay]);
  useEffect(() => {
    if (activeTab !== "classification") return;
    setExpandedClassificationActivityRows(new Set());
    setClassificationCorrectionDraft(null);
    setClassificationCorrectionNotice(null);
  }, [activeTab, effectiveClassifyCategoryId, effectiveClassifySourceId]);
  const classificationTopApp = useMemo(() => buildAppUsageSummaries(classificationSegments, { limit: 1, groupBy: "app" })[0] ?? null, [classificationSegments]);
  const classificationTopAppLabel = classificationTopApp?.appName ?? "No activity";
  const dashboardProductivityTotals = useMemo(() => buildProductivityDurations(effectiveDashboardSegments, dashboardClassificationOptions), [dashboardClassificationOptions, effectiveDashboardSegments]);
  // Same segments and options as the Breakdown productivity ring, so the Dev
  // preview's Longest streak and pattern tiles agree with its Focus and Drift totals.
  const dayPatternMetrics = useMemo(
    () => (canUseBreakdownPatternsPreview && dashPeriod === "Today"
      ? buildDayPatternMetrics(effectiveDashboardSegments, dashboardClassificationOptions)
      : EMPTY_DAY_PATTERN_METRICS),
    [canUseBreakdownPatternsPreview, dashPeriod, dashboardClassificationOptions, effectiveDashboardSegments],
  );
  const dashboardFocusSeconds = dashboardProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const previousWeekFocusSeconds = dashPeriod === "Week" && dashboardPreviousWeekFocusLoad?.key === dashboardPreviousWeekFocusKey
    ? dashboardPreviousWeekFocusLoad.focusSeconds
    : null;
  const weekFocusDeltaSeconds = previousWeekFocusSeconds !== null ? dashboardFocusSeconds - previousWeekFocusSeconds : null;
  const previousDayFocusSeconds = dashPeriod === "Today" && dashboardPreviousDayFocusLoad?.key === dashboardPreviousDayFocusKey
    ? dashboardPreviousDayFocusLoad.focusSeconds
    : null;
  const dayFocusDeltaSeconds = previousDayFocusSeconds !== null ? dashboardFocusSeconds - previousDayFocusSeconds : null;
  const weekDashboardModel = useMemo(() => {
    if (dashPeriod !== "Week") return emptyWeekDashboardModel();
    return buildWeekDashboardModel({
      cache: weekDashboardDayModelCache,
      classificationOptions: dashboardClassificationOptions,
      endDay: effectiveDashboardRange.endDay,
      segments: effectiveDashboardSegments,
      startDay: effectiveDashboardRange.startDay,
      startOfDayMinutes,
      todayDay: effectiveTodayDayForWeekModel,
    });
  }, [
    dashPeriod,
    dashboardClassificationOptions,
    effectiveDashboardRange.endDay,
    effectiveDashboardRange.startDay,
    effectiveDashboardSegments,
    effectiveTodayDayForWeekModel,
    startOfDayMinutes,
    weekDashboardCacheRevision,
    weekDashboardDayModelCache,
  ]);
  const weekRows = weekDashboardModel.rows;
  const weekCalendarEvents = weekDashboardModel.calendarEvents;
  const focusDriftChart = useMemo(() => {
    if (dashboardDemoReplayState.kind !== "active") {
      return buildFocusDriftChart(effectiveSelectedDaySegments, selectedDay, effectiveSelectedDayClassificationOptions, effectiveCurrentMinuteOfDay, startOfDayMinutes);
    }

    return applyFocusDriftReplayReveal({
      chart: buildFocusDriftChart(dashboardDemoReplayState.fixture.segments, selectedDay, effectiveSelectedDayClassificationOptions, null, startOfDayMinutes),
      revealMinuteOfDay: effectiveCurrentMinuteOfDay,
      startOfDayMinutes,
    });
  }, [
    dashboardDemoReplayState,
    effectiveCurrentMinuteOfDay,
    effectiveSelectedDayClassificationOptions,
    effectiveSelectedDaySegments,
    selectedDay,
    startOfDayMinutes,
  ]);

  const dashboardActivityActionsEnabled = !isDashboardDemoReplayActive
    && (isPreviewSurface || !shouldBlockLocalTrackerAccess);

  const handleSaveDashboardActivityValues = useCallback(async (
    field: ActivityInspectorAttribute,
    targetValues: readonly ActivityInspectorSegmentValues[],
  ) => {
    if (targetValues.length === 0) throw new Error("No source activity records are available.");
    if (isDashboardDemoReplayActive || (!isPreviewSurface && shouldBlockLocalTrackerAccess)) {
      throw new Error("Activity editing is unavailable on this dashboard surface.");
    }

    setError(null);
    try {
      if (field === "project") {
        const assignedAt = new Date().toISOString();
        const assignments: ProjectAssignmentRecord[] = targetValues.map(({ projectId, segment }) => ({
          segmentId: segment.id,
          projectId,
          source: "manual",
          confidence: 1,
          reason: "Manual project correction.",
          assignedAt,
        }));
        const result = await trackerClient.saveProjectAssignments(assignments);
        if (result.saved !== assignments.length) {
          try {
            const [storedAssignments, storedWindowAssignments] = await Promise.all([
              trackerClient.getProjectAssignments?.(dashboardProjectRange) ?? Promise.resolve([]),
              trackerClient.getProjectWindowAssignments?.(dashboardProjectRange) ?? Promise.resolve([]),
            ]);
            setDashboardProjectAssignmentLoad({
              key: dashboardProjectRangeKey,
              assignments: storedAssignments ?? [],
              windowAssignments: storedWindowAssignments ?? [],
            });
          } catch {
            // Keep the incomplete-save error below. The week range effect reloads this cache later.
          }
          try {
            await projectClassification.reload();
          } catch {
            // The stored rows remain authoritative on the next successful reload.
          }
          throw new Error(`Only ${result.saved} of ${assignments.length} project assignments were saved.`);
        }
        const changedIds = new Set(assignments.map((assignment) => assignment.segmentId));
        setDashboardProjectAssignmentLoad((current) => {
          if (current.key !== dashboardProjectRangeKey) return current;
          return {
            ...current,
            assignments: [
              ...current.assignments.filter((assignment) => !changedIds.has(assignment.segmentId)),
              ...assignments,
            ],
          };
        });
        await projectClassification.reload();
        return;
      }

      const classifiedAt = new Date().toISOString();
      const classifications = targetValues.map(({ category, productivity, segment }) => buildClassificationCorrectionRecord({
        category,
        classifiedAt,
        productivity,
        segment,
      }));
      const result = await trackerClient.saveClassifications(classifications);
      clearLocalActivityCaches();
      await refresh(selectedDayRef.current);
      if (result.saved !== classifications.length) {
        throw new Error(`Only ${result.saved} of ${classifications.length} activity classifications were saved.`);
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
      throw caught;
    }
  }, [
    clearLocalActivityCaches,
    dashboardProjectRangeKey,
    dashboardProjectRange,
    isDashboardDemoReplayActive,
    isPreviewSurface,
    projectClassification.reload,
    refresh,
    shouldBlockLocalTrackerAccess,
  ]);

  const handleDeleteDashboardActivity = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0) throw new Error("No source activity records are available.");
    if (isDashboardDemoReplayActive || (!isPreviewSurface && shouldBlockLocalTrackerAccess)) {
      throw new Error("Activity editing is unavailable on this dashboard surface.");
    }

    setError(null);
    try {
      await trackerClient.deleteActivitySegments(ids);
      clearLocalActivityCaches();
      const deletedIds = new Set(ids);
      setHistorySearchSegments((currentSegments) => currentSegments.filter((segment) => !deletedIds.has(segment.id)));
      await refresh(selectedDayRef.current);
      if (isPolicySignedIn) await focusCard.refresh();
    } catch (caught) {
      setError(toErrorMessage(caught));
      throw caught;
    }
  }, [focusCard.refresh, isPolicySignedIn, clearLocalActivityCaches, isDashboardDemoReplayActive, isPreviewSurface, refresh, shouldBlockLocalTrackerAccess]);

  const refreshAfterHistoryDeletion = useCallback(async () => {
    if (!await refresh(selectedDayRef.current)) {
      throw new Error(localization.t("history.refreshError"));
    }
    if (isPolicySignedIn) await focusCard.refresh();
  }, [focusCard.refresh, isPolicySignedIn, localization, refresh]);

  const handleDeleteHistorySegments = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0 || historyDeleting) return;

    setHistoryDeleting(true);
    setError(null);
    try {
      return await deleteHistorySelection(ids, {
        deleteRecords: (recordIds) => trackerClient.deleteActivitySegments(recordIds),
        onDeleted: (recordIds) => {
          clearLocalActivityCaches();
          const deletedIds = new Set(recordIds);
          setHistorySearchSegments((currentSegments) => currentSegments.filter((segment) => !deletedIds.has(segment.id)));
        },
        refresh: refreshAfterHistoryDeletion,
      });
    } finally {
      setHistoryDeleting(false);
    }
  }, [clearLocalActivityCaches, historyDeleting, refreshAfterHistoryDeletion]);

  const [historyDeletionResult, setHistoryDeletionResult] = useState<DeleteHistoryRangeResult | null>(null);
  const [deleteHistoryModalOpen, setDeleteHistoryModalOpen] = useState(false);

  const handleHistoryRangeDeleted = useCallback(async () => {
    clearLocalActivityCaches();
    setHistorySearchSegments([]);
    try {
      setClassificationMetrics(await trackerClient.getClassificationMetrics({ day: selectedDayRef.current }));
    } catch {
      // Metrics refresh is best-effort after a bulk delete; the views below still reload.
    }
    await refreshAfterHistoryDeletion();
    await syncLeaderboardPublication("history_deleted", { bypassSlotGate: true });
    await refreshLeaderboardData();
  }, [clearLocalActivityCaches, refreshAfterHistoryDeletion, refreshLeaderboardData, syncLeaderboardPublication]);

  useEffect(() => {
    selectedDayRef.current = selectedDay;
  }, [selectedDay]);

  useEffect(() => {
    function updateRendererFocusState() {
      const nextFocused = isRendererFocused();
      rendererFocusedRef.current = nextFocused;
      setRendererFocused(nextFocused);
    }

    function recordRendererInteraction() {
      lastRendererInteractionAtRef.current = Date.now();
      updateRendererFocusState();
    }

    const interactionOptions = { passive: true } as const;
    recordRendererInteraction();
    window.addEventListener("focus", recordRendererInteraction);
    window.addEventListener("blur", updateRendererFocusState);
    document.addEventListener("visibilitychange", recordRendererInteraction);
    document.addEventListener("pointerdown", recordRendererInteraction, interactionOptions);
    document.addEventListener("keydown", recordRendererInteraction);
    document.addEventListener("wheel", recordRendererInteraction, interactionOptions);
    document.addEventListener("touchstart", recordRendererInteraction, interactionOptions);

    return () => {
      window.removeEventListener("focus", recordRendererInteraction);
      window.removeEventListener("blur", updateRendererFocusState);
      document.removeEventListener("visibilitychange", recordRendererInteraction);
      document.removeEventListener("pointerdown", recordRendererInteraction);
      document.removeEventListener("keydown", recordRendererInteraction);
      document.removeEventListener("wheel", recordRendererInteraction);
      document.removeEventListener("touchstart", recordRendererInteraction);
    };
  }, []);

  const runAutoAiClassificationBatch = useCallback(async (options: {
    readonly forceBacklogBatch?: boolean;
    readonly firstDayResume?: boolean;
    readonly query?: UnclassifiedSegmentsQuery;
    readonly analyticsRange?: "current_day" | "recent";
  } = {}): Promise<AiClassificationSummary | null> => {
    const forceBacklogBatch = options.forceBacklogBatch === true;
    if (!allowAutomaticClassificationAttempt) return null;
    if (shouldBlockLocalTrackerAccess) return null;
    if (!hasLoadedOnce) return null;
    if (classificationActionLoading) return null;
    // The first-day preparation gate is already classifying today in the foreground;
    // running the periodic batch concurrently would double-classify the same day.
    if (preparingFirstDay) return null;
    if (aiClassificationInFlightRef.current) return null;
    if (getClassificationActivitySnapshot().running) return null;

    const today = logicalTodayIsoDate(startOfDayMinutes);
    const recoveryCutoff = builtInHeuristicsUnavailableSinceRef.current;
    const probeRecoveryBacklog = !forceBacklogBatch && !options.query
      && classificationAvailability.route === "cloud" && recoveryCutoff !== null
      && (classificationAvailability.state === "retrying" || classificationAvailability.allowRecoveryProbe)
      && Date.now() >= cloudRecoveryProbeNextAtRef.current;
    const isFocused = rendererFocusedRef.current;
    const threshold = forceBacklogBatch || probeRecoveryBacklog ? AI_CLASSIFICATION_BACKGROUND_THRESHOLD
      : isFocused ? AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD : AI_CLASSIFICATION_BACKGROUND_THRESHOLD;
    if (!forceBacklogBatch && !probeRecoveryBacklog && isFocused && Date.now() - lastRendererInteractionAtRef.current < AI_CLASSIFICATION_FOCUSED_IDLE_MS) return null;
    const providerKeyAtStart = aiClassificationProviderKey;
    const providerKind = toAiProviderAnalytics(Boolean(selectedLocalAiClassificationOptions), canUseSelectedCloudAiClassification);
    const trigger = options.firstDayResume ? "first_day_resume" as const
      : isFocused ? "focused_idle" as const : "background_threshold" as const;
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;
    const isCurrentProvider = () => cloudAiConnectionGeneration === cloudAiConnectionGenerationRef.current
      && providerKeyAtStart === currentAiClassificationProviderKeyRef.current;
    const deferFailedRecoveryProbe = () => {
      if (!isCurrentProvider()) return;
      const failures = Math.min(cloudRecoveryProbeFailuresRef.current + 1, 4);
      cloudRecoveryProbeFailuresRef.current = failures;
      cloudRecoveryProbeNextAtRef.current = Date.now() + Math.min(
        CLOUD_AI_RECOVERY_TEST_INTERVAL_MS * 2 ** (failures - 1),
        CLOUD_AI_RECOVERY_FAILED_PROBE_MAX_INTERVAL_MS,
      );
    };

    aiClassificationInFlightRef.current = true;
    try {
      const query = options.query
        ? { ...options.query, limit: threshold }
        : probeRecoveryBacklog
          ? { start: recoveryCutoff, end: new Date().toISOString(), limit: threshold }
          : toClassificationQueryForDay(today, threshold);
      const analyticsRange = options.analyticsRange ?? (probeRecoveryBacklog ? "recent" : "current_day");
      const runOptions = {
        ...(selectedLocalAiClassificationOptions ?? {}),
        allowProviderlessPersistence: !classificationAvailabilityGateEnabled || classificationAvailability.state === "ready",
        persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart,
      };
      const summary = forceBacklogBatch
        ? await runAiClassificationUntilEmpty(query, threshold, runOptions)
        : probeRecoveryBacklog
          ? await runAiClassification(query, threshold, runOptions)
          : await runAiClassificationForUnknownThreshold(query, threshold, runOptions);
      if (probeRecoveryBacklog && isCurrentProvider()) {
        if (summary.status === "error") deferFailedRecoveryProbe();
        else {
          cloudRecoveryProbeFailuresRef.current = 0;
          cloudRecoveryProbeNextAtRef.current = 0;
        }
      }
      if (selectedLocalAiClassificationOptions) recordLocalAiClassificationSummary(summary);
      else recordCloudAiClassificationSummary(summary, cloudAiConnectionGeneration);
      if (probeRecoveryBacklog && isCurrentProvider() && !selectedLocalAiClassificationOptions
        && summary.status === "empty" && summary.usedAiProvider !== true) {
        // The first backlog batch may be empty or entirely local/reusable.
        // Check the provider before lifting the availability gate; the
        // existing recovery drain still verifies and saves the remaining rows.
        const now = Date.now();
        if (!cloudRateLimitBackoff && now >= cloudRecoveryTestNextAtRef.current) {
          cloudRecoveryTestNextAtRef.current = now + CLOUD_AI_RECOVERY_TEST_INTERVAL_MS;
          const probe = await testCloudAiConnection();
          if (probe.kind === "success" && cloudAiConnectionGeneration === cloudAiConnectionGenerationRef.current) {
            cloudRecoveryTestNextAtRef.current = 0;
            setCloudAiConnectionCheck(null);
          }
        }
      }
      if (summary.status === "empty" && summary.savedRecords === 0) return summary;
      if (analyticsRange === "current_day" && selectedDayRef.current === today) {
        setClassificationSummary(summary);
        if (summary.metrics) setClassificationMetrics(summary.metrics);
        const nextUsage = await loadAiClassificationUsage(today);
        if (selectedDayRef.current === today) {
          setAiClassificationUsage(nextUsage);
          setAiClassificationUsageDay(today);
        }
        // While unfocused, take the lite path: the reclassified categories only
        // need the day timeline rebuilt, not the status/snapshot/history loads,
        // and the foreground-grade rebuild every batch is a background heap-churn
        // driver on par with the removed 30s full refresh.
        if (summary.savedRecords > 0 && selectedDayRef.current === today) await refresh(today, { foreground: rendererFocusedRef.current });
      } else if (summary.savedRecords > 0 && selectedDayRef.current === today) {
        await refresh(today, { foreground: rendererFocusedRef.current });
      }
      captureAiClassificationRun(trigger, providerKind, analyticsRange, summary);
      if (summary.savedRecords > 0) {
        await syncLeaderboardPublication("classification_updated");
        await refreshLeaderboardData();
      }
      return summary;
    } catch (nextError) {
      if (probeRecoveryBacklog) deferFailedRecoveryProbe();
      const localFailure = selectedLocalAiClassificationOptions ? describeLocalAiClassificationFailure(nextError) : null;
      const failure = localFailure ?? await recordCloudAiClassificationError(nextError, cloudAiConnectionGeneration);
      if (localFailure) recordLocalAiClassificationError(localFailure);
      captureAiClassificationRun(trigger, providerKind, options.analyticsRange ?? "current_day", {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        ...failure,
      });
      if ((options.analyticsRange ?? "current_day") === "current_day" && selectedDayRef.current === today) {
        setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, ...failure });
      }
      return null;
    } finally {
      aiClassificationInFlightRef.current = false;
    }
  }, [aiClassificationProviderKey, allowAutomaticClassificationAttempt, canUseSelectedCloudAiClassification, classificationActionLoading, classificationAvailability.allowRecoveryProbe, classificationAvailability.route, classificationAvailability.state, classificationAvailabilityGateEnabled, cloudRateLimitBackoff, hasLoadedOnce, preparingFirstDay, recordCloudAiClassificationError, recordCloudAiClassificationSummary, recordLocalAiClassificationError, recordLocalAiClassificationSummary, refreshLeaderboardData, rendererFocused, selectedDay, selectedLocalAiClassificationOptions, shouldBlockLocalTrackerAccess, startOfDayMinutes, syncLeaderboardPublication]);
  const firstDayResumeBatchRef = useRef(runAutoAiClassificationBatch);
  firstDayResumeBatchRef.current = runAutoAiClassificationBatch;
  const browserHistoryBootstrapTone = browserHistoryBootstrapNotice?.tone ?? null;

  useEffect(() => {
    if (isPreviewSurface || !user?.id || selectedClassificationRoute !== "cloud"
      || onboardingOpen || preparingFirstDay || !hasLoadedOnce || shouldBlockLocalTrackerAccess) return undefined;
    const ownerId = user.id;
    const dashboardHistoryOwnsImport = browserHistoryBootstrapEnabled
      && shouldStartBrowserHistoryBootstrap
      && (browserHistoryBootstrapTone === null || browserHistoryBootstrapTone === "working");
    let cancelled = false;
    let nextAttemptAt = 0;
    const runRecovery = async () => {
      const marker = readFirstDayCloudBacklog(ownerId);
      if (cancelled || Date.now() < nextAttemptAt || !marker
        || (marker.importPending && dashboardHistoryOwnsImport)) return;
      nextAttemptAt = Date.now() + AUTO_AI_CLASSIFICATION_INTERVAL_MS;
      try {
        const outcome = await resumeFirstDayCloudBacklog({
          ownerId,
          importHistory: async () => {
            const result = await trackerClient.importBrowserHistory({ lookbackDays: 2 });
            if (result.insertedCount > 0) clearLocalActivityCaches();
            if (result.errorCount > 0) {
              nextAttemptAt = Date.now() + 30 * 60 * 1000;
              throw new Error("Browser history import had read errors");
            }
          },
          resolveTargetDay: resolveFirstDayTargetDay,
          runClassification: async (day) => {
            const summary = await firstDayResumeBatchRef.current({
              forceBacklogBatch: true,
              firstDayResume: true,
              query: toClassificationQueryForDay(day),
              analyticsRange: day === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent",
            });
            if (summary?.failureKind === "content") nextAttemptAt = Date.now() + 30 * 60 * 1000;
            return summary;
          },
          hasRemainingCandidates: async (day) => {
            const remaining = await trackerClient.getUnclassifiedSegments({ ...toClassificationQueryForDay(day), limit: 1 });
            return remaining.length > 0;
          },
        });
        if (outcome === "completed") capturePostHogEvent("first_day_backlog", { source: "resume" });
      } catch (error) {
        console.warn("First-day Cloud backlog recovery deferred", error);
      }
    };
    void runRecovery();
    const intervalId = window.setInterval(() => { void runRecovery(); }, AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [browserHistoryBootstrapEnabled, browserHistoryBootstrapTone, clearLocalActivityCaches, hasLoadedOnce, isPreviewSurface, onboardingOpen, preparingFirstDay, selectedClassificationRoute, shouldBlockLocalTrackerAccess, shouldStartBrowserHistoryBootstrap, startOfDayMinutes, user?.id]);

  useEffect(() => {
    const previousState = previousClassificationAvailabilityStateRef.current;
    previousClassificationAvailabilityStateRef.current = classificationAvailability.state;
    if (!classificationAvailabilityGateEnabled) {
      setClassificationRecoveryPending(false);
      return;
    }
    if (classificationAvailability.state !== "ready") {
      if (classificationAvailability.state !== "checking") setClassificationRecoveryPending(true);
      return;
    }
    if (!classificationRecoveryPending) {
      if (builtInHeuristicsUnavailableSinceRef.current !== null
        || shouldRunClassificationRecoveryBatch(previousState, classificationAvailability.state)) {
        setClassificationRecoveryPending(true);
      }
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function runRecoveryPass() {
      if (cancelled) return;
      try {
        const unavailableSince = builtInHeuristicsUnavailableSinceRef.current;
        if (!unavailableSince) {
          setClassificationRecoveryPending(false);
          return;
        }

        const summary = await runAutoAiClassificationBatch({
          forceBacklogBatch: true,
          query: {
            start: unavailableSince,
            end: new Date().toISOString(),
          },
          analyticsRange: "recent",
        });
        if (cancelled || currentClassificationAvailabilityStateRef.current !== "ready") return;
        if (summary && summary.status !== "error" && summary.status !== "disabled") {
          // Reuse the canonical candidate selector for the completion check.
          // Aggregate metrics also include synced rows from other devices, while
          // this device intentionally classifies local-origin rows only.
          const remainingCandidates = await trackerClient.getUnclassifiedSegments({
            start: unavailableSince,
            end: new Date().toISOString(),
            limit: 1,
          });
          if (cancelled || currentClassificationAvailabilityStateRef.current !== "ready") return;
          if (remainingCandidates.length === 0) {
            // Only the pass that owns the current recovery generation may
            // clear it. A cleaned-up pass must not erase a newer outage.
            if (builtInHeuristicsUnavailableSinceRef.current !== unavailableSince) return;
            builtInHeuristicsUnavailableSinceRef.current = null;
            persistBuiltInHeuristicsUnavailableSince(null);
            setClassificationRecoveryPending(false);
            return;
          }
        }
      } catch {
        // A transient tracker/completion-probe failure must not strand the
        // persisted cutoff. The same bounded recovery pass retries below.
      }
      if (cancelled) return;

      // Another classification pass may still own the single-flight lock, a
      // safety-capped drain may still have rows, or provider backoff may be in
      // force. Keep the persisted cutoff and retry; the service itself owns the
      // request-rate/backoff rules, so this timer never bypasses them.
      retryTimer = setTimeout(() => {
        void runRecoveryPass();
      }, AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    }

    void runRecoveryPass();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [classificationAvailability.state, classificationAvailabilityGateEnabled, classificationRecoveryPending, runAutoAiClassificationBatch]);

  useEffect(() => {
    // Preview/demo fixtures ship pre-classified segments and seed a cloud-
    // connected session; auto-classification would churn (and could reach the
    // cloud) from public website embeds, so it stays app-only.
    if (isPreviewSurface) return undefined;
    void runAutoAiClassificationBatch();
    const intervalId = setInterval(() => {
      void runAutoAiClassificationBatch();
    }, AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isPreviewSurface, runAutoAiClassificationBatch]);

  // Heavy project pass scheduler (Item 1). Keeps TODAY's project attributions
  // fresh with an on-open tick + an hourly tick. Ticks are SILENT: runScheduledPass
  // never disturbs the manual-run UI. runScheduledPass gets a fresh identity each
  // render (its `now` closure), so we call it through a ref and keep the effect's
  // deps stable — otherwise the interval would reset every render and never fire.
  const runScheduledProjectPassRef = useRef(projectClassification.runScheduledPass);
  useEffect(() => {
    runScheduledProjectPassRef.current = projectClassification.runScheduledPass;
  });
  // Matching has nothing to attribute to until at least one active project
  // exists, so an empty library is the gate that keeps a fresh install from
  // sending anything on a schedule. Team projects count: a member who only
  // joined a team still needs matching before they can share project time.
  const hasActiveProject = projectClassification.projects.some((project) => project.status === "active")
    || projectClassification.activeTeamProjectCount > 0;
  useEffect(() => {
    if (isPreviewSurface) return undefined;
    if (!projectClassificationFeatureEnabled || !hasActiveProject) {
      // A first project should re-tick on open, but only once creation-triggered
      // work has settled: resetting mid-burst would let this effect run the same
      // window again the moment the new project lands.
      if (queuedAutoAnalysisTimerRef.current === null) projectPassOpenTickedRef.current = false;
      return undefined;
    }
    const tick = (trigger: "schedule" | "open") => {
      const day = logicalTodayIsoDate(startOfDayMinutes);
      void runScheduledProjectPassRef.current(
        trigger,
        getLogicalDayRange(day, day, startOfDayMinutes),
      ).then((outcome) => {
        captureScheduledProjectPass(trigger, outcome);
        if (outcome.status === "failed") {
          console.warn("[project-pass] Scheduled pass failed", {
            trigger,
            category: outcome.category,
          });
        }
      });
    };
    // Only fire the on-open tick once the analysis model is connected, else a
    // slow cold start would burn the one-shot guard on a no-op and defer today's
    // first pass to the hourly tick. analysisConnected is a dep so a late connect
    // re-runs this effect and ticks then.
    if (projectAnalysisConnected && !projectPassOpenTickedRef.current) {
      projectPassOpenTickedRef.current = true;
      tick("open");
    }
    const intervalId = setInterval(() => tick("schedule"), PROJECT_PASS_SCHEDULE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [hasActiveProject, isPreviewSurface, projectAnalysisConnected, projectClassificationFeatureEnabled, startOfDayMinutes]);

  useEffect(() => {
    if (authStatus === "authenticated" && (!isEffectiveAuthRequired || hasRequiredAccountAuth)) {
      setAuthModalOpen(false);
      setAuthModalShowsGoogle(true);
      setAuthModalIntent("default");
      setResumeOnboardingAfterAuthModal(false);
    }
  }, [authStatus, hasRequiredAccountAuth, isEffectiveAuthRequired]);

  useEffect(() => {
    if (!resumeUpgradePlanAfterAuth) return;
    if (authStatus !== "authenticated" || (isEffectiveAuthRequired && !hasRequiredAccountAuth)) return;
    if (isSidebarCtaPreviewActive) {
      setUpgradePlanModalOpen(true);
      setResumeUpgradePlanAfterAuth(false);
      return;
    }
    if (billingEntitlementLoading) return;
    if (billingEntitlementError) {
      setResumeUpgradePlanAfterAuth(false);
      return;
    }
    if (!billingEntitlement) return;
    setResumeUpgradePlanAfterAuth(false);
    if (billingEntitlementSupportsUpgrade) setUpgradePlanModalOpen(true);
  }, [
    authStatus,
    billingEntitlement,
    billingEntitlementError,
    billingEntitlementLoading,
    billingEntitlementSupportsUpgrade,
    hasRequiredAccountAuth,
    isEffectiveAuthRequired,
    isSidebarCtaPreviewActive,
    resumeUpgradePlanAfterAuth,
  ]);

  useEffect(() => {
    if (isSidebarCtaPreviewActive) return;
    if (!upgradePlanModalOpen) return;
    if (authStatus !== "authenticated" || (isEffectiveAuthRequired && !hasRequiredAccountAuth)) {
      setUpgradePlanModalOpen(false);
      return;
    }
    if (billingEntitlementLoading) return;
    if (billingEntitlementError || !billingEntitlementSupportsUpgrade) setUpgradePlanModalOpen(false);
  }, [
    authStatus,
    billingEntitlementError,
    billingEntitlementLoading,
    billingEntitlementSupportsUpgrade,
    hasRequiredAccountAuth,
    isEffectiveAuthRequired,
    isSidebarCtaPreviewActive,
    upgradePlanModalOpen,
  ]);

  const shouldRenderUpgradePlanModal = upgradePlanModalOpen
    && (isSidebarCtaPreviewActive
      || (authStatus === "authenticated"
        && (!isEffectiveAuthRequired || hasRequiredAccountAuth)
        && billingEntitlementSupportsUpgrade
        && billingEntitlementError === null));

  const handleCloseAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    setAuthModalShowsGoogle(true);
    setAuthModalIntent("default");
    if (resumeOnboardingAfterAuthModal && !hasRequiredAccountAuth) {
      setOnboardingOpen(true);
    }
    setResumeOnboardingAfterAuthModal(false);
    setResumeUpgradePlanAfterAuth(false);
  }, [hasRequiredAccountAuth, resumeOnboardingAfterAuthModal]);

  const openDashboardAiSetup = useCallback(() => {
    setSettingsSection("aiSetup");
    navigateToTab("settings");
  }, [navigateToTab]);

  const handleDismissDashboardAiRecovery = useCallback(() => {
    if (dashboardAiRecoveryKey === null) return;
    storeDashboardAiRecoveryDismissal(dashboardAiRecoveryKey);
    setDismissedDashboardAiRecoveryKey(dashboardAiRecoveryKey);
  }, [dashboardAiRecoveryKey]);

  useEffect(() => {
    // Account switches disarm the one-shot bootstrap; onboarding completion re-arms it.
    setBrowserHistoryBootstrapEnabled(false);
  }, [user?.id]);

  useEffect(() => {
    if (devSettingsReviewSubsection) {
      setOnboardingOpen(false);
      return;
    }

    if (isDevOnboardingBypassEnabled()) {
      setOnboardingOpen(false);
      return;
    }

    if (isDevOnboardingForceOpenEnabled()) {
      setOnboardingOpen(true);
      return;
    }

    if (authStatus === "loading") {
      return;
    }

    if (authStatus === "authenticated") {
      if (!user?.id) {
        setOnboardingOpen(false);
        return;
      }

      if (profileReadyUserId !== user.id) {
        return;
      }

      const completedForAuthPolicy = hasCompletedUserOnboarding(user.id)
        && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
      setOnboardingOpen(!completedForAuthPolicy);
      return;
    }

    if (isEffectiveAuthRequired) {
      setOnboardingOpen(true);
      return;
    }

    setOnboardingOpen(!hasCompletedUserOnboarding("local"));
  }, [authStatus, devSettingsReviewSubsection, hasRequiredAccountAuth, isEffectiveAuthRequired, profileReadyUserId, user?.id]);

  function handleOnboardingComplete(state: UserOnboardingState) {
    firstDayHistoryImportFailedRef.current = false;
    const displayName = state.displayName.trim();
    if (displayName) {
      updateProfileDraft({ displayName });
    }
    setDriftAlertsEnabled(state.driftAlarmEnabled);
    setExtremeNudgeEnabled(state.extremeNudgeEnabled);
    requestPetModeEnabled(state.petModeEnabled);
    setBrowserHistoryBootstrapEnabled(state.browserHistoryBootstrapEnabled);
    resetBrowserHistoryBootstrap();
    selectDay(logicalTodayIsoDate(startOfDayMinutes));
    navigateToTab("dashboard", "Today");
    setSidebarCollapsed(false);
    beginPostOnboardingSidebarGuide();
    setOnboardingOpen(false);
    const shouldPrepareFirstDay = !shouldBlockLocalTrackerAccess && (
      state.browserHistoryBootstrapEnabled
      || cloudAiSelected
      || managedLocalSelected
      || Boolean(localAiClassificationOptions)
    );
    if (shouldPrepareFirstDay) {
      rearmFirstDayPreparation();
      setFirstDayWorkLabel(state.workType);
      const preparationPlan: FirstDayPreparationPhase[] = [];
      if (state.browserHistoryBootstrapEnabled) preparationPlan.push("importing");
      if (managedLocalSelected || localAiClassificationOptions?.localProvider.provider === "managed_local") {
        preparationPlan.push("downloading");
      }
      if (cloudAiSelected || managedLocalSelected || localAiClassificationOptions) {
        preparationPlan.push("classifying");
      }
      setFirstDayPreparationPlan(preparationPlan.length > 0 ? preparationPlan : ["classifying"]);
      setFirstDayPreparationPhase(state.browserHistoryBootstrapEnabled ? "importing" : "classifying");
      setFirstDayPreparationProgress(null);
      setPreparingFirstDay(true);
    }
  }

  async function handleOpenDeveloperOnboarding() {
    await refresh();
    setOnboardingOpen(true);
  }

  async function handleBackgroundStartTracking() {
    const trackerMutationGeneration = trackerMutationGenerationRef.current + 1;
    trackerMutationGenerationRef.current = trackerMutationGeneration;
    try {
      const nextStatus = await trackerClient.start();
      if (trackerMutationGenerationRef.current !== trackerMutationGeneration) return;
      setStatus(nextStatus);
      setAccessibilityGranted(nextStatus.accessibilityGranted);
      // Startup may have restored a pause after the renderer read an older
      // status. The native start guard reports that user choice.
      if (nextStatus.trackingPaused) return;
      const degraded = nextStatus.trackerMode === "degraded" || nextStatus.running !== true;
      capturePostHogEvent("tracker_action", {
        action: "start",
        result: degraded ? "unavailable" : "success",
        tracker_mode: toTrackerModeAnalytics(nextStatus.trackerMode),
        running: nextStatus.running ?? false,
        ...(degraded ? { error_kind: "tracker_unavailable" } : {}),
      });
      if (!degraded) await refresh();
    } catch (startError) {
      if (trackerMutationGenerationRef.current !== trackerMutationGeneration) return;
      const nextStatus = await trackerClient.getStatus().catch((): TrackerStatus => ({
        running: false,
        accessibilityGranted: false,
        lastEventAt: null,
        databasePath: null,
        trackerMode: "degraded",
        message: "Activity tracking could not start. Try starting it again.",
      }));
      if (trackerMutationGenerationRef.current !== trackerMutationGeneration) return;
      setStatus(nextStatus);
      setAccessibilityGranted(nextStatus.accessibilityGranted);
      capturePostHogEvent("tracker_action", {
        action: "start",
        result: "error",
        tracker_mode: toTrackerModeAnalytics(nextStatus.trackerMode),
        running: nextStatus.running ?? false,
        error_kind: toAnalyticsErrorKind(startError),
      });
      console.warn("[tracker] Background start failed", {
        errorKind: toAnalyticsErrorKind(startError),
      });
    }
  }

  // Throws on failure (after surfacing the error) so onboarding completion can abort.
  async function handleStartTrackingFromOnboarding() {
    setError(null);
    const trackerMutationGeneration = trackerMutationGenerationRef.current + 1;
    trackerMutationGenerationRef.current = trackerMutationGeneration;
    let nextStatus: TrackerStatus;
    try {
      nextStatus = await trackerClient.start({ resumePaused: true });
    } catch (startError) {
      if (trackerMutationGenerationRef.current !== trackerMutationGeneration) throw startError;
      const message = toErrorMessage(startError);
      setError(message);
      capturePostHogEvent("tracker_action", {
        action: "start",
        result: "error",
        error_kind: toAnalyticsErrorKind(startError),
      });
      throw new Error(message);
    }

    if (trackerMutationGenerationRef.current !== trackerMutationGeneration) return;
    setStatus(nextStatus);
    setAccessibilityGranted(nextStatus.accessibilityGranted);
    if (nextStatus.trackerMode === "degraded" || nextStatus.running !== true) {
      const message = nextStatus.message ?? "Activity tracking could not start. Try starting it again.";
      setError(message);
      capturePostHogEvent("tracker_action", {
        action: "start",
        result: "unavailable",
        tracker_mode: toTrackerModeAnalytics(nextStatus.trackerMode),
        running: nextStatus.running ?? false,
        error_kind: "tracker_unavailable",
      });
      throw new Error(message);
    }

    await refresh();
    capturePostHogEvent("tracker_action", {
      action: "start",
      result: "success",
      tracker_mode: toTrackerModeAnalytics(nextStatus.trackerMode),
      running: nextStatus.running ?? true,
    });
  }

  async function handleStartTracking() {
    try {
      await handleStartTrackingFromOnboarding();
    } catch {
      // Error already surfaced via setError and analytics.
    }
  }

  async function handleCheckAccessibility() {
    const nextStatus = await accessibilityClient.getStatus();
    setAccessibilityGranted(nextStatus.granted);
    setAccessibilityRequired(nextStatus.required);
    setHostPlatform(nextStatus.platform ?? "macos");
    return nextStatus.granted;
  }

  async function handleRequestAccessibility() {
    const nextStatus = await accessibilityClient.requestAccess();
    setAccessibilityGranted(nextStatus.granted);
    setAccessibilityRequired(nextStatus.required);
    setHostPlatform(nextStatus.platform ?? "macos");
    return nextStatus.granted;
  }

  async function handleStopTracking() {
    if (trackerStopInFlightRef.current) return;
    trackerStopInFlightRef.current = true;
    // Pause intent cancels destructive actions immediately, even while native
    // shutdown still reports running. Keep that running truth in the UI.
    trackerPauseIntentRef.current = true;
    clearPausedDriftAlarmRuntime();
    setTrackerPausePending(true);
    setError(null);
    const trackerMutationGeneration = trackerMutationGenerationRef.current + 1;
    trackerMutationGenerationRef.current = trackerMutationGeneration;
    try {
      const nextStatus = await trackerClient.stop();
      if (trackerMutationGenerationRef.current !== trackerMutationGeneration) return;
      setStatus(nextStatus);
      setAccessibilityGranted(nextStatus.accessibilityGranted);
      if (!nextStatus.running) setCurrentSnapshot(null);
      capturePostHogEvent("tracker_action", {
        action: "stop",
        result: "success",
        tracker_mode: toTrackerModeAnalytics(nextStatus.trackerMode ?? status?.trackerMode),
        running: nextStatus.running ?? false,
      });
      void refresh(selectedDayRef.current, { foreground: false });
    } catch (e) {
      if (trackerMutationGenerationRef.current !== trackerMutationGeneration) return;
      const reconciledStatus = await trackerClient.getStatus().catch(() => null);
      if (trackerMutationGenerationRef.current !== trackerMutationGeneration) return;
      if (reconciledStatus) {
        setStatus(reconciledStatus);
        setAccessibilityGranted(reconciledStatus.accessibilityGranted);
        if (!reconciledStatus.running) setCurrentSnapshot(null);
      }
      const reconciledTrackerMode = reconciledStatus?.trackerMode ?? null;
      const didConfirmPaused = reconciledStatus?.running === false
        && reconciledTrackerMode !== "unavailable"
        && reconciledTrackerMode !== "degraded";
      if (didConfirmPaused && reconciledStatus) {
        capturePostHogEvent("tracker_action", {
          action: "stop",
          result: "success",
          tracker_mode: toTrackerModeAnalytics(reconciledStatus.trackerMode),
          running: false,
          error_kind: toAnalyticsErrorKind(e),
        });
        void refresh(selectedDayRef.current, { foreground: false });
        return;
      }
      setError(toErrorMessage(e));
      capturePostHogEvent("tracker_action", {
        action: "stop",
        result: "error",
        error_kind: toAnalyticsErrorKind(e),
      });
    } finally {
      trackerStopInFlightRef.current = false;
      setTrackerPausePending(false);
    }
  }

  async function resolveAiClassificationUsageFromExecutionDelta(executionUsageDay: string, usageBefore: AiClassificationUsageSummary | null): Promise<AiClassificationUsageSummary | null> {
    const usageAfter = await loadAiClassificationUsage(executionUsageDay);
    const usageDelta = diffAiClassificationUsageSummary(usageBefore, usageAfter);
    return hasAiClassificationUsageMeasurement(usageDelta) ? usageDelta : null;
  }

  function setAiClassificationUsageMeasurement(executionUsageDay: string, nextUsage: AiClassificationUsageSummary | null) {
    setAiClassificationUsage(nextUsage);
    setAiClassificationUsageDay(nextUsage ? executionUsageDay : null);
  }

  async function handleRunAiClassificationNow() {
    if (!hasSelectedAiClassificationProvider) {
      const disabledSummary = { status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Configure or reconnect the selected AI provider to run classification." } satisfies AiClassificationSummary;
      setClassificationSummary(disabledSummary);
      captureAiClassificationRun("manual", "none", selectedDay === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent", disabledSummary);
      return;
    }

    if (aiClassificationInFlightRef.current) return;

    const executionUsageDay = todayIsoDate();
    const providerKeyAtStart = aiClassificationProviderKey;
    const providerKind = toAiProviderAnalytics(Boolean(selectedLocalAiClassificationOptions), canUseSelectedCloudAiClassification);
    const range = selectedDay === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent";
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;
    aiClassificationInFlightRef.current = true;
    setClassificationActionLoading(true);
    setClassificationSummary({ status: "running", selectedSegments: 0, savedRecords: 0, message: "Running AI classification..." });
    try {
      const usageBefore = await loadAiClassificationUsage(executionUsageDay);
      const summary = selectedLocalAiClassificationOptions
        ? await runAiClassification(toClassificationQueryForDay(selectedDay), undefined, { ...selectedLocalAiClassificationOptions, allowProviderlessPersistence: !classificationAvailabilityGateEnabled || classificationAvailability.state === "ready", persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart })
        : await runAiClassification(toClassificationQueryForDay(selectedDay), undefined, { allowProviderlessPersistence: !classificationAvailabilityGateEnabled || classificationAvailability.state === "ready", bypassCloudRequestBackoff: true, persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart });
      if (selectedLocalAiClassificationOptions) recordLocalAiClassificationSummary(summary);
      else recordCloudAiClassificationSummary(summary, cloudAiConnectionGeneration);
      setClassificationSummary(summary);
      if (summary.metrics) setClassificationMetrics(summary.metrics);
      const nextUsage = await resolveAiClassificationUsageFromExecutionDelta(executionUsageDay, usageBefore);
      if (summary.savedRecords > 0) {
        await refresh(selectedDay);
        await syncLeaderboardPublication("classification_updated");
        await refreshLeaderboardData();
      }
      setAiClassificationUsageMeasurement(executionUsageDay, nextUsage);
      captureAiClassificationRun("manual", providerKind, range, summary);
    } catch (nextError) {
      const localFailure = selectedLocalAiClassificationOptions ? describeLocalAiClassificationFailure(nextError) : null;
      const failure = localFailure ?? await recordCloudAiClassificationError(nextError, cloudAiConnectionGeneration);
      if (localFailure) recordLocalAiClassificationError(localFailure);
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, ...failure });
      captureAiClassificationRun("manual", providerKind, range, {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        ...failure,
      });
    } finally {
      aiClassificationInFlightRef.current = false;
      setClassificationActionLoading(false);
    }
  }

  async function handleRunSelectedDayAiClassification() {
    if (!hasSelectedAiClassificationProvider) {
      const disabledSummary = { status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Configure or reconnect the selected AI provider to run classification." } satisfies AiClassificationSummary;
      setClassificationSummary(disabledSummary);
      captureAiClassificationRun("manual", "none", selectedDay === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent", disabledSummary);
      return;
    }

    const targetDay = selectedDay;
    if (aiClassificationInFlightRef.current) return;

    const executionUsageDay = todayIsoDate();
    const providerKeyAtStart = aiClassificationProviderKey;
    const providerKind = toAiProviderAnalytics(Boolean(selectedLocalAiClassificationOptions), canUseSelectedCloudAiClassification);
    const range = targetDay === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent";
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;
    aiClassificationInFlightRef.current = true;
    setClassificationActionLoading(true);
    setClassificationSummary({ status: "running", selectedSegments: 0, savedRecords: 0, message: `Classifying all unclassified activity for ${formatDayLabel(targetDay)}...` });
    try {
      const usageBefore = await loadAiClassificationUsage(executionUsageDay);
      const summary = selectedLocalAiClassificationOptions
        ? await runAiClassificationUntilEmpty(toClassificationQueryForDay(targetDay), undefined, { ...selectedLocalAiClassificationOptions, allowProviderlessPersistence: !classificationAvailabilityGateEnabled || classificationAvailability.state === "ready", persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart })
        : await runAiClassificationUntilEmpty(toClassificationQueryForDay(targetDay), undefined, { allowProviderlessPersistence: !classificationAvailabilityGateEnabled || classificationAvailability.state === "ready", bypassCloudRequestBackoff: true, persistenceAllowed: () => currentAiClassificationProviderKeyRef.current === providerKeyAtStart });
      if (selectedLocalAiClassificationOptions) recordLocalAiClassificationSummary(summary);
      else recordCloudAiClassificationSummary(summary, cloudAiConnectionGeneration);
      setClassificationSummary({
        ...summary,
        message: `${summary.message} Target: ${formatDayLabel(targetDay)}.`,
      });
      if (summary.metrics) setClassificationMetrics(summary.metrics);
      const nextUsage = await resolveAiClassificationUsageFromExecutionDelta(executionUsageDay, usageBefore);
      if (summary.savedRecords > 0) {
        await refresh(targetDay);
        await syncLeaderboardPublication("classification_updated");
        await refreshLeaderboardData();
      }
      setAiClassificationUsageMeasurement(executionUsageDay, nextUsage);
      captureAiClassificationRun("manual", providerKind, range, summary);
    } catch (nextError) {
      const localFailure = selectedLocalAiClassificationOptions ? describeLocalAiClassificationFailure(nextError) : null;
      const failure = localFailure ?? await recordCloudAiClassificationError(nextError, cloudAiConnectionGeneration);
      if (localFailure) recordLocalAiClassificationError(localFailure);
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, ...failure });
      captureAiClassificationRun("manual", providerKind, range, {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        ...failure,
      });
    } finally {
      aiClassificationInFlightRef.current = false;
      setClassificationActionLoading(false);
    }
  }

  async function handleRefreshNonAiClassifications() {
    setClassificationActionLoading(true);
    try {
      const result = await trackerClient.refreshNonAiClassifications({ day: selectedDay });
      const metrics = await trackerClient.getClassificationMetrics({ day: selectedDay });
      setClassificationMetrics(metrics);
      setAiClassificationUsage(await loadAiClassificationUsage(selectedDay));
      setAiClassificationUsageDay(selectedDay);
      setClassificationSummary({
        status: "saved",
        selectedSegments: metrics.totalSegments,
        savedRecords: result.deleted,
        message: `Refreshed ${result.deleted} non-AI ${result.deleted === 1 ? "classification" : "classifications"} for the selected day.`,
        metrics,
      });
      await refresh(selectedDay);
      await syncLeaderboardPublication("classification_updated");
      await refreshLeaderboardData();
    } catch (nextError) {
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message: toErrorMessage(nextError) });
    } finally {
      setClassificationActionLoading(false);
    }
  }

  function handleCmdNav(tabId: TabId) {
    if (tabId === "settings") openSettingsTab();
    else navigateToTab(tabId);
    setCmdOpen(false);
  }

  const startOfDayValue = minutesToHourlyStartOfDayValue(startOfDayMinutes);
  const handleStartOfDayChange = useCallback((value: string) => {
    setStartOfDayMinutes(hourlyStartOfDayValueToMinutes(value));
  }, []);
  const handleStartOfWeekChange = useCallback((value: StartOfWeek) => {
    setStartOfWeek(value);
  }, []);
  const dayReviewTimeValue = endOfDayReviewMinuteToValue(endOfDayReviewMinute);
  const handleDayReviewTimeChange = useCallback((value: string) => {
    setEndOfDayReviewMinute(endOfDayReviewValueToMinute(value));
  }, []);
  const handleCategoryColorChange = useCallback((category: ActivityCategory, value: string) => {
    if (!isHexColor(value)) return;
    setCategoryColorOverrides((current) => ({ ...current, [category]: value }));
  }, []);
  const handleAppThemeColorChange = useCallback((key: AppThemeColorKey, value: string) => {
    if (!isHexColor(value)) return;
    setAppThemeColorOverrides((current) => ({ ...current, [key]: value }));
  }, []);
  const handleCategoryColorReset = useCallback((category: ActivityCategory) => {
    setCategoryColorOverrides((current) => {
      const next = { ...current };
      delete next[category];
      return next;
    });
  }, []);
  const handleAppThemeColorReset = useCallback((key: AppThemeColorKey) => {
    setAppThemeColorOverrides((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);
  const handleEnhancedContextDebugLoggingChange = useCallback((enabled: boolean) => {
    setEnhancedContextSettings((current) => ({ ...current, debugLogging: enabled }));
  }, []);
  const handleEnhancedContextSourceFamilyChange = useCallback((family: EnhancedContextSourceFamily, enabled: boolean) => {
    setEnhancedContextSettings((current) => ({
      ...current,
      sourceFamilies: {
        ...current.sourceFamilies,
        [family]: enabled,
      },
    }));
  }, []);
  const handleOpenDebugLogs = useCallback(async () => {
    const snapshotForDebug = status?.running === true
      ? await trackerClient.getCurrentSnapshot().catch((snapshotError: unknown) => {
          if (snapshotError instanceof Error) return null;
          throw snapshotError;
        })
      : null;
    const payload = buildDebugLogPayload({
      selectedDay,
      startOfDayMinutes,
      startOfWeek,
      theme,
      categoryColorOverrides,
      appThemeColorOverrides,
      developerDiagnostics: {
        devModeEnabled,
        forceChromiumAxCapture: DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxCaptureEnabled,
        forceFrontmostFallbackCapture: DEV_SETTINGS_ENABLED && devModeEnabled && forceFrontmostFallbackCaptureEnabled,
        forceBrowserHistoryUrlFallback: DEV_SETTINGS_ENABLED && devModeEnabled && forceBrowserHistoryUrlFallbackEnabled,
        forceChromiumAxExtremeNudge: DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxExtremeNudgeEnabled,
      },
      enhancedContext: {
        settings: effectiveEnhancedContextSettings,
        events: readRecentEnhancedContextDebugEvents(),
      },
      status,
      accessibilityGranted,
      currentSnapshot: snapshotForDebug,
      driftAlarm: driftAlarmTrayStatus,
      driftAlarmDebugEvents: readRecentDriftAlarmDebugEvents(),
      interventionLedger: buildInterventionLedgerDebugInput(),
      contextualGuardAuditEvents: readContextualGuardAuditEvents(),
      dayReview: readDayReviewDiagnostics({
        now: new Date(),
        reviewMinute: endOfDayReviewMinute,
        startOfDayMinutes,
      }),
      segments,
      historySegments,
      leaderboardSegments,
      ai: {
        route: hasSelectedAiClassificationProvider ? selectedClassificationRoute : "disabled",
        connectionStatus: aiConnectionStatus,
        cloud: {
          isSupabaseConfigured,
          hasRequiredAccountAuth,
          canUseCloudAiClassification,
          entitlement: billingEntitlement,
          entitlementLoading: billingEntitlementLoading,
          entitlementError: billingEntitlementError,
        },
        local: {
          providerLabel: localAiConnectionProviderLabel,
          providerStatus: localAiProviderStatus,
        },
        classification: {
          actionLoading: classificationActionLoading,
          summary: classificationSummary,
          observedFailure: localAiConnectionPersistentFailure,
        },
        usage: {
          day: aiClassificationUsageDay,
          summary: aiClassificationUsage,
        },
      },
      deviceSync: {
        featureVisible: deviceSyncFeatureVisible,
        optedIn: deviceSyncEnabled,
        gateActive: deviceSyncActive,
        accountResetPending: deviceSyncAccountResetPending,
        gates: {
          accountScopeReady: deviceSyncAccountId !== null && deviceSyncPreferenceOwnerId === deviceSyncAccountId,
          cloudOnline: isCloudOnline,
          supabaseConfigured: isSupabaseConfigured,
          signedIn: isPolicySignedIn,
          billingEligible: billingEntitlement?.canUseApp === true,
        },
        status: deviceSyncStatus,
        cycleRecord: findDeviceSyncCycleRecord(readDeviceSyncCycleRecords(), deviceSyncUserScopeKey),
      },
      error,
    });
    setDebugLogPreview({ text: JSON.stringify(payload, null, 2), exportedAt: payload.exportedAt });
  }, [accessibilityGranted, aiClassificationUsage, aiClassificationUsageDay, aiConnectionStatus, appThemeColorOverrides, billingEntitlement, billingEntitlementError, billingEntitlementLoading, canUseCloudAiClassification, categoryColorOverrides, classificationActionLoading, classificationSummary, devModeEnabled, deviceSyncAccountId, deviceSyncAccountResetPending, deviceSyncActive, deviceSyncEnabled, deviceSyncFeatureVisible, deviceSyncPreferenceOwnerId, deviceSyncStatus, deviceSyncUserScopeKey, driftAlarmTrayStatus, effectiveEnhancedContextSettings, endOfDayReviewMinute, error, forceBrowserHistoryUrlFallbackEnabled, forceChromiumAxCaptureEnabled, forceChromiumAxExtremeNudgeEnabled, forceFrontmostFallbackCaptureEnabled, hasRequiredAccountAuth, hasSelectedAiClassificationProvider, historySegments, isCloudOnline, isPolicySignedIn, isSupabaseConfigured, leaderboardSegments, localAiClassificationOptions, localAiConnectionPersistentFailure, localAiConnectionProviderLabel, localAiProviderStatus, segments, selectedClassificationRoute, selectedDay, startOfDayMinutes, startOfWeek, status, theme]);
  const handleDownloadDebugLogs = useCallback(() => {
    if (!debugLogPreview) return;
    const blob = new Blob([debugLogPreview.text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `drifty-debug-log-${debugLogPreview.exportedAt.replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [debugLogPreview]);
  const handleCopyDebugLogs = useCallback(async () => {
    if (!debugLogPreview) return;
    try {
      await copyTextToClipboard(debugLogPreview.text);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    }
  }, [debugLogPreview]);

  const manualUpdateStatusNotice = manualUpdateNoticeVisible
    ? buildManualUpdateStatusNotice({
      checking: updaterChecking,
      error: updaterError,
      hasAvailableUpdate: availableUpdate !== null,
      message: updaterMessage,
      localization,
    })
    : null;
  const latestBuildStatusNotice = latestBuildNoticeVisible
    ? buildLatestBuildStatusNotice(
      developerPreReleaseUpdateController.status,
      developerPreReleaseUpdateController.message,
      developerPreReleaseUpdateController.error,
    )
    : null;
  const manualUpdateStatusRenderedInSettings = activeTab === "settings" && settingsSection === "general";
  const latestBuildStatusRenderedInSettings =
    activeTab === "settings"
    && settingsSection === "dev"
    && devSettingsSubsection === "diagnostics"
    && DEV_SETTINGS_ENABLED
    && devModeEnabled;
  const appStatusNotice = latestBuildStatusNotice ?? manualUpdateStatusNotice;
  const shellStatusNotice =
    (latestBuildStatusNotice && !latestBuildStatusRenderedInSettings ? latestBuildStatusNotice : null)
    ?? (manualUpdateStatusNotice && !manualUpdateStatusRenderedInSettings ? manualUpdateStatusNotice : null);
  // Keep developer update recovery available even when onboarding or account policy owns the app shell.
  const windowsStablePromptBusy = hostPlatform === "windows" && (updaterChecking || updaterInstalling);
  const windowsLatestBuildPromptBusy = hostPlatform === "windows" && (
    developerPreReleaseUpdateController.status === "checking"
    || developerPreReleaseUpdateController.status === "installing"
  );
  const latestBuildPromptContent = latestBuildPromptUpdate?.version
    && !(hostPlatform === "windows" && visibleUpdate)
    && !windowsLatestBuildPromptBusy ? (
    <AvailableUpdateDialog
      updateChannel="developer"
      isWindows={hostPlatform === "windows"}
      backgroundUpdatesEnabled={backgroundUpdatesEnabled}
      policy={fallbackUpdatePolicy(latestBuildPromptUpdate.version)}
      update={{
        body: latestBuildPromptUpdate.body,
        date: latestBuildPromptUpdate.date,
        version: latestBuildPromptUpdate.version,
      }}
      updaterChecking={developerPreReleaseUpdateController.status === "checking"}
      updaterError={developerPreReleaseUpdateController.error}
      updaterInstalling={developerPreReleaseUpdateController.status === "installing"}
      onBackgroundUpdatesEnabledChange={setBackgroundUpdatesEnabled}
      onDismiss={developerPreReleaseUpdateController.dismissPrompt}
      onInstall={() => void developerPreReleaseUpdateController.installLatestBuild()}
    />
  ) : null;

  const availableUpdatePromptContent = visibleUpdate && !windowsStablePromptBusy ? (
    <AvailableUpdateDialog
      updateChannel="stable"
      isWindows={hostPlatform === "windows"}
      backgroundUpdatesEnabled={backgroundUpdatesEnabled}
      policy={currentUpdatePolicy}
      update={visibleUpdate}
      updaterChecking={updaterChecking}
      updaterError={updaterError}
      updaterInstalling={updaterInstalling}
      onBackgroundUpdatesEnabledChange={setBackgroundUpdatesEnabled}
      onDismiss={dismissAvailableUpdate}
      onInstall={() => void handleInstallUpdate()}
    />
  ) : null;
  // Windows renders an in-app modal. Keep its presence boundary mounted when
  // Later clears the prompt so the shared exit motion and focus cleanup run.
  const availableUpdatePrompt = hostPlatform === "windows"
    ? <ModalPresence>{availableUpdatePromptContent}</ModalPresence>
    : availableUpdatePromptContent;
  const latestBuildPrompt = hostPlatform === "windows"
    ? <ModalPresence>{latestBuildPromptContent}</ModalPresence>
    : latestBuildPromptContent;

  const dashboardDateNavigator = (
    <DateNavigator
      ariaLabel={dashPeriod === "Today" ? localization.t("dashboard.today.dateSelector") : localization.t("dashboard.week.dateSelector")}
      label={dashboardDateLabel}
      todayLabel={localization.t("common.now")}
      todayActionLabel={localization.effectiveLanguage === "ko"
        ? localization.t(dashPeriod === "Today" ? "dashboard.today.goToday" : "dashboard.week.goCurrent")
        : undefined}
      isTodayDisabled={isCurrentDashboardPeriod}
      isNextDisabled={!canShiftDashboardForward}
      onPrevious={() => shiftDashboardPeriod(-1)}
      onNext={() => shiftDashboardPeriod(1)}
      onToday={() => selectDay(todayDay)}
      previousLabel={dashPeriod === "Today" ? localization.t("dashboard.today.previousDay") : localization.t("dashboard.week.previous")}
      nextLabel={dashPeriod === "Today" ? localization.t("dashboard.today.nextDay") : localization.t("dashboard.week.next")}
    />
  );

  const focusDriftSection = (
    <FocusDriftSection
      appIcons={appIcons}
      chart={focusDriftChart}
      startOfDayMinutes={startOfDayMinutes}
    />
  );

  // Dev preview only: Longest streak and the pattern tiles replace the KPI
  // tiles while Dev mode and its Breakdown patterns flag are both on.
  const dayBreakdownTiles = canUseBreakdownPatternsPreview ? (
    <DayBreakdownPatterns metrics={dayPatternMetrics} />
  ) : (
    <FocusDriftSummaryTiles
      activeHourCount={activeHourCount}
      averageSessionMinutes={averageSessionMinutes}
      chart={focusDriftChart}
      peakTrackedSeconds={peakTrackedSeconds}
      peakWindowLabel={peakWindowLabel}
      sessionCount={effectiveDashboardSegments.length}
      topAppLabel={topAppLabel}
      totalSeconds={totalSeconds}
      uniqueAppsCount={uniqueAppsCount}
      startOfDayMinutes={startOfDayMinutes}
    />
  );

  // Day-nav transient: the visible range jumps to the new day before its
  // segments load, so for that gap the breakdown collapses to zeros and the
  // donut/bar tween snaps A→empty→B. Hold the previous day's breakdown while the
  // new day's segments are still loading so the charts morph straight A→B. The
  // flow chart keeps its own empty frame (legend + axis) — only the breakdown
  // side panel inputs are held. A genuinely data-less day is unaffected: once its
  // empty segments finish loading the guard clears and the real zeros show.
  // Stale whenever the loaded segments don't match the selected day — this is
  // true from the very first render after a date click (when the range has moved
  // but the new day's segments haven't loaded yet), NOT only once `loading` flips
  // on in a later effect. Gating on `loading` missed that first render, which both
  // flashed empty AND poisoned the sticky cache with the empty value, so
  // yesterday→older navigations still snapped. `segmentsLoadedDay` catching up to
  // `selectedDay` (after setSegments) clears it.
  const isDayBreakdownLoading = dashPeriod === "Today" && hasLoadedOnce && segmentsLoadedDay !== selectedDay;
  const stickyDashboardCategoryTotals = useStickyDuringLoad(dashboardCategoryTotals, isDayBreakdownLoading);
  const stickyDashboardProductivityTotals = useStickyDuringLoad(dashboardProductivityTotals, isDayBreakdownLoading);
  const stickyDashboardAppUsage = useStickyDuringLoad(dashboardAppUsage, isDayBreakdownLoading);
  const stickyTotalSeconds = useStickyDuringLoad(totalSeconds, isDayBreakdownLoading);
  const stickyDayBreakdownTiles = useStickyDuringLoad(dayBreakdownTiles, isDayBreakdownLoading);
  // Today's unclassified time, which the plan sheet names after a trial that ended.
  const unclassifiedTodaySeconds = dashPeriod === "Today" && selectedDay === logicalTodayIsoDate(startOfDayMinutes)
    ? stickyDashboardCategoryTotals.find((entry) => entry.category === "unknown")?.totalSeconds ?? 0
    : null;
  // Only a trial that ended within today can be the start of today's unclassified time.
  const trialEndedWithinToday = (trialEndsAt: string | null | undefined) => {
    const end = trialEndsAt ? new Date(trialEndsAt) : null;
    return end !== null && Number.isFinite(end.getTime())
      && logicalDayIsoDateForDate(end, startOfDayMinutes) === logicalTodayIsoDate(startOfDayMinutes);
  };
  // After a Pro trial ends: the Pro sheet once, then from the next day a two-line notice once a
  // day while today's unclassified time is past 30 minutes (owner decision 2026-10-10). It asks
  // nothing once the account buys Pro or classification moves to Local AI or the user's own key.
  const trialEndedUnresolved = !isPreviewSurface && !activeDashboardAiUnavailablePreviewInput && !isSidebarCtaPreviewActive
    && resolveDashboardAiUnavailableState({
      billingEntitlement,
      billingEntitlementError,
      billingEntitlementLoading,
      canUseCloudAiClassification,
      hasRequiredAccountAuth,
      isSupabaseConfigured,
      localAiReady: Boolean(localAiClassificationOptions),
      classificationAvailability,
    })?.variant === "trial-ended";
  const trialEndFollowUpKey = trialEndedUnresolved && user && user.is_anonymous !== true
    ? getTrialEndFollowUpKey(user.id, billingEntitlement)
    : null;
  const {
    stage: trialEndStage,
    markSheetSeen: markTrialEndSheetSeen,
    markNoticeSeen: markTrialEndNoticeSeen,
  } = useTrialEndFollowUp(trialEndFollowUpKey, logicalTodayIsoDate(startOfDayMinutes), unclassifiedTodaySeconds);
  const trialEndSheetCanOpen = trialEndStage === "sheet" && !upgradePlanModalOpen
    && activeTab === "dashboard" && hasLoadedOnce && !onboardingOpen && !preparingFirstDay && !isDashboardDemoReplayActive
    && !authModalOpen && !feedbackModalOpen && !accountDeletionModalOpen && !aiSetupDialogOpen && !cmdOpen && !deleteHistoryModalOpen
    && !whatsNewOpen
    && !automaticSheetShownThisLaunch
    && authStatus === "authenticated" && (!isEffectiveAuthRequired || hasRequiredAccountAuth)
    && billingEntitlementSupportsUpgrade && !billingEntitlementLoading && billingEntitlementError === null;
  useEffect(() => {
    if (!trialEndSheetCanOpen) return;
    setAutomaticSheetShownThisLaunch(true);
    setTrialEndSheetAuto(true);
    setUpgradePlanModalOpen(true);
  }, [trialEndSheetCanOpen]);
  useEffect(() => {
    if (!upgradePlanModalOpen) setTrialEndSheetAuto(false);
  }, [upgradePlanModalOpen]);
  // What's new never opens by itself (owner decision 2026-10-14). It opens from
  // Drifty > What's New and Settings > General, and reads the drifty.so
  // changelog only once it is open.
  const whatsNewChangelog = useWhatsNewChangelog(
    localization.effectiveLanguage === "ko" ? "ko" : "en",
    whatsNewOpen,
  );
  const whatsNewEntries = useMemo(
    () => whatsNewChangelog.entries
      ? entriesForBuild(whatsNewChangelog.entries, toWhatsNewPlatform(hostPlatform), BUILD_INFO.version)
      : null,
    [hostPlatform, whatsNewChangelog.entries],
  );

  if (isEffectiveAuthRequired && hasEffectiveBlockingAuthConfigurationError) {
    return (
      <SiteIconProvider value={siteIcons}>
        <LocalizationProvider controller={localization}>
          <>
            {hostPlatform === "windows" ? <WindowsTitlebar /> : null}
            {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
            <AuthConfigurationGate />
            {availableUpdatePrompt}
            {latestBuildPrompt}
          </>
        </LocalizationProvider>
      </SiteIconProvider>
    );
  }

  if (isEffectiveAuthRequired && authStatus === "loading" && !onboardingOpen) {
    return (
      <SiteIconProvider value={siteIcons}>
        <LocalizationProvider controller={localization}>
          <>
            {hostPlatform === "windows" ? <WindowsTitlebar /> : null}
            {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
            <AuthLoadingGate />
            {availableUpdatePrompt}
            {latestBuildPrompt}
          </>
        </LocalizationProvider>
      </SiteIconProvider>
    );
  }

  if (isEffectiveAuthRequired && !hasRequiredAccountAuth && !onboardingOpen) {
    return (
      <SiteIconProvider value={siteIcons}>
        <LocalizationProvider controller={localization}>
          <>
            {hostPlatform === "windows" ? <WindowsTitlebar /> : null}
            {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
            <AuthRequiredGate onSignIn={openDefaultAuthModal} />
            <ModalPresence>{authModalOpen ? <AuthModal intent={authModalIntent} onClose={handleCloseAuthModal} showGoogleSignIn={authModalShowsGoogle} /> : null}</ModalPresence>
            {availableUpdatePrompt}
            {latestBuildPrompt}
          </>
        </LocalizationProvider>
      </SiteIconProvider>
    );
  }

  const effectiveBillingEntitlement = activeDashboardAiUnavailablePreviewInput?.billingEntitlement ?? billingEntitlement;
  const effectiveBillingEntitlementError = activeDashboardAiUnavailablePreviewInput?.billingEntitlementError ?? billingEntitlementError;
  const effectiveBillingEntitlementLoading = activeDashboardAiUnavailablePreviewInput?.billingEntitlementLoading ?? billingEntitlementLoading;
  // The sheet's header follows the account state; the Dev sidebar preview feeds its synthetic state.
  const upgradeSheetEntitlement = sidebarCtaPreviewInput ? sidebarCtaPreviewInput.billingEntitlement : effectiveBillingEntitlement;
  const upgradeSheetPlanState = resolvePlanCardState(upgradeSheetEntitlement);
  const upgradeSheetContext: ProSheetContext = upgradeSheetPlanState === "pro_trial"
    ? "trial-active"
    : upgradeSheetPlanState === "trial_expired"
      ? "trial-ended"
      : (sidebarCtaPreviewInput?.localAiConfigured ?? localAiConnectionFingerprint !== null) ? "upgrade-local" : "upgrade";
  const effectiveIsSupabaseConfigured = activeDashboardAiUnavailablePreviewInput?.isSupabaseConfigured ?? isSupabaseConfigured;
  const effectiveHasRequiredAccountAuth = activeDashboardAiUnavailablePreviewInput?.hasRequiredAccountAuth ?? hasRequiredAccountAuth;
  const isDeviceLimitLocked = effectiveBillingEntitlement?.lockedReason === "device_limit_reached";
  const isDashboardAiUnavailablePreviewActive = activeDashboardAiUnavailablePreviewInput !== null;
  const funnelEnabled = !isPreviewSurface && !isDashboardDemoReplayActive
    && !isSidebarCtaPreviewActive && !isDashboardAiUnavailablePreviewActive
    && hasRequiredAccountAuth && Boolean(user) && user?.is_anonymous !== true;
  // After a trial ended, the window-chrome pill names it and opens the Pro sheet instead of reading as a setup failure.
  const chromeAiStatus: AiConnectionStatus = trialEndFollowUpKey !== null
    ? { tone: "warning", label: "Trial ended", providerLabel: "View plans", memoryLabel: null, issueKind: null }
    : effectiveAiConnectionStatus;
  const openChromeAiStatus = trialEndFollowUpKey !== null
    ? () => {
      if (funnelEnabled) void recordProFunnelStep({ step: "pro_offer_acted", offer_surface: "status_pill", offer_context: "trial_ended", offer_action: "view_plans" });
      handleOpenUpgradePlanModal();
    }
    : openAiSetupSettings;
  const chromeAiStatusAria = trialEndFollowUpKey !== null ? localization.t("ai.connection.trialEndedAria") : undefined;
  // The daily notice waits for other notices, alerts and dialogs, and shows on today's dashboard only.
  const trialEndNoticeVisible = trialEndStage === "notice" && unclassifiedTodaySeconds !== null
    && activeTab === "dashboard" && !upgradePlanModalOpen && !onboardingOpen && !isDashboardDemoReplayActive
    && !cloudTrialStartedNotice && !proStartedNoticeVisible && driftAlarmEvent === null
    && !authModalOpen && !feedbackModalOpen && !accountDeletionModalOpen && !aiSetupDialogOpen && !cmdOpen && !deleteHistoryModalOpen;
  const effectiveCloudConnectionStatus: AuthConnectionStatus = isDashboardAiUnavailablePreviewActive ? "online" : cloudConnectionStatus;
  const cloudStatusLabel = effectiveCloudConnectionStatus === "offline"
    ? "Offline mode"
    : effectiveCloudConnectionStatus === "checking"
      ? "Checking cloud"
      : driftyCloudStatusLabel(effectiveBillingEntitlement, effectiveBillingEntitlementLoading, effectiveIsSupabaseConfigured, effectiveHasRequiredAccountAuth);
  const aiServerStatusLabel = effectiveCloudConnectionStatus === "offline"
    ? "Offline"
    : effectiveCloudConnectionStatus === "checking"
      ? "Checking"
      : aiServerStatusLabelForCloud(effectiveBillingEntitlement, effectiveBillingEntitlementLoading, effectiveIsSupabaseConfigured, effectiveHasRequiredAccountAuth);
  const isPaymentRequiredLocked = effectiveBillingEntitlement?.lockedReason === "payment_required";
  const shouldShowCloudCheckoutPlans = effectiveBillingEntitlement?.status === "locked" && !isDeviceLimitLocked && !isPaymentRequiredLocked;
  const currentBillingPlan =
    effectiveBillingEntitlement?.status === "active" || effectiveBillingEntitlement?.status === "trialing" || isDeviceLimitLocked || isPaymentRequiredLocked
      ? "individual"
      : !effectiveHasRequiredAccountAuth || !effectiveIsSupabaseConfigured
        ? "free"
        : null;
  const displayedHistorySegments = isHistorySearchActive ? historySearchSegments : historySegments;
  const displayedHistoryHasMoreSegments = isHistorySearchActive ? historySearchHasMoreSegments : historyHasMoreSegments;
  const displayedHistoryLoading = isHistorySearchActive ? historySearchLoading : historyLoadingMore;
  const displayedHistoryLoadMoreError = isHistorySearchActive ? historySearchError : historyLoadMoreError;
  const displayedHistoryLoadMore = isHistorySearchActive ? loadMoreHistorySearchSegments : loadMoreHistorySegments;
  const historyInitialLoading = isHistorySearchActive && historySearchLoading && historySearchSegments.length === 0;
  // Permissions no longer have their own Settings page, so a missing required
  // Accessibility grant marks General in the settings rail.
  const settingsAttentionSections = settingsSectionsNeedingAttention({
    desktopRuntime: isTauriRuntime(),
    accessibilityRequired,
    accessibilityGranted,
    trackerMode: status ? status.trackerMode ?? "unknown" : null,
  });
  const shouldShowPostOnboardingSidebarGuide = postOnboardingSidebarGuideActive
    && postOnboardingSidebarGuideStep !== null
    && introStory.resolved
    && !onboardingOpen
    && !preparingFirstDay
    && !isSettingsTab
    && !authModalOpen
    && !feedbackModalOpen
    && !upgradePlanModalOpen
    && !accountDeletionModalOpen
    && !cmdOpen;
  const onboardingModal = onboardingOpen ? (
    <OnboardingModal
      userId={user?.id ?? "local"}
      accountConnected={hasRequiredAccountAuth}
      initialDisplayName={profileDraft.displayName}
      trackerStatus={status}
      accessibilityGranted={accessibilityGranted}
      accessibilityRequired={accessibilityRequired}
      onStartTracking={handleStartTrackingFromOnboarding}
      onActivateCloudTrial={activateCloudTrial}
      onRefreshBillingEntitlement={refreshBillingEntitlement}
      cloudDeviceRevokingId={cloudDeviceRevokingId}
      cloudDeviceActionError={cloudDeviceActionError}
      onRevokeCloudDevice={handleRevokeCloudDevice}
      onEarlyTrackingStart={() => {
        // Opportunistic: capture the rest of onboarding in the first day. Failures
        // stay silent — the completion-time start still surfaces real errors.
        void (async () => {
          const trackerMutationGeneration = trackerMutationGenerationRef.current + 1;
          trackerMutationGenerationRef.current = trackerMutationGeneration;
          try {
            const nextStatus = await trackerClient.start();
            if (trackerMutationGenerationRef.current !== trackerMutationGeneration) return;
            setStatus(nextStatus);
            setAccessibilityGranted(nextStatus.accessibilityGranted);
            if (nextStatus.trackingPaused) return;
            await refresh();
          } catch {
            // silent early start; completion retries with full error handling
          }
        })();
      }}
      onCheckAccessibility={handleCheckAccessibility}
      onRequestAccessibility={handleRequestAccessibility}
      localAiSetup={localAiSetup}
      onLocalAiSetupChange={setLocalAiSetup}
      cloudTrialStartedNotice={cloudTrialStartedNotice}
      billingEntitlement={billingEntitlement}
      billingEntitlementError={billingEntitlementError}
      billingEntitlementLoading={billingEntitlementLoading}
      expectsPromotion={promoHandoffPending}
      authCallbackStatus={callbackStatus}
      onStartCloudTrialWithGoogle={() => void signInWithGoogle({ requestCalendar: true })}
      onStartCloudTrialWithWebsite={promoHandoffPending ? () => void signInWithWebsite() : undefined}
      onDeleteAnonymousAccount={user?.is_anonymous === true
        ? () => setAccountDeletionModalOpen(true)
        : undefined}
      onAcknowledgeCloudTrialStartedNotice={dismissCloudTrialStartedNotice}
      onComplete={handleOnboardingComplete}
    />
  ) : null;
  const promoHandoffAccountDialog = promoHandoffMismatch ? (
    <PromoHandoffAccountDialog
      onKeepAccount={keepCurrentPromoHandoffAccount}
      onSwitchAccount={switchPromoHandoffAccount}
    />
  ) : null;
  const shellClassName = [
    "app-shell",
    isSettingsTab ? "app-shell--settings" : null,
    isSidebarVisuallyCollapsed ? "app-shell--sidebar-collapsed" : null,
    shouldShowPostOnboardingSidebarGuide ? "app-shell--sidebar-guide" : null,
  ].filter(Boolean).join(" ");
  const windowsTitlebarNavClassName = [
    "windows-titlebar-nav",
    isSettingsTab ? "windows-titlebar-nav--settings" : null,
    isSidebarVisuallyCollapsed ? "windows-titlebar-nav--sidebar-collapsed" : null,
  ].filter(Boolean).join(" ");


  if (onboardingOpen) {
    const promoAuthOnboardingOpen = authModalOpen && authModalIntent === "promo";
    return (
      <SiteIconProvider value={siteIcons}>
      <LocalizationProvider controller={localization}>
        <>
          {hostPlatform === "windows" ? <WindowsTitlebar maximizable={false} /> : null}
          {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
          {promoAuthOnboardingOpen ? (
            <AuthModal
              intent="promo"
              onClose={handleCloseAuthModal}
              presentation="onboarding"
              showGoogleSignIn={authModalShowsGoogle}
            />
          ) : onboardingModal}
          <ModalPresence>{authModalOpen && !promoAuthOnboardingOpen ? (
            <AuthModal intent={authModalIntent} onClose={handleCloseAuthModal} showGoogleSignIn={authModalShowsGoogle} />
          ) : null}</ModalPresence>
          <ModalPresence>{promoHandoffAccountDialog}</ModalPresence>
          <ModalPresence>{accountDeletionModalOpen ? (
            <AccountDeletionModal
              accountEmail={user?.email ?? null}
              isAnonymousAccount={user?.is_anonymous === true}
              onClose={() => setAccountDeletionModalOpen(false)}
              onDelete={handleDeleteAccount}
            />
          ) : null}</ModalPresence>
            {availableUpdatePrompt}
          {latestBuildPrompt}
        </>
      </LocalizationProvider>
      </SiteIconProvider>
    );
  }

  if (firstDayReviewEnabled) {
    return (
      <SiteIconProvider value={siteIcons}>
        <LocalizationProvider controller={localization}>
          <FirstDayPreparationReview appIcons={appIcons} />
        </LocalizationProvider>
      </SiteIconProvider>
    );
  }

  if (preparingFirstDay) {
    return (
      <SiteIconProvider value={siteIcons}>
      <LocalizationProvider controller={localization}>
        <>
          {hostPlatform === "windows" ? <WindowsTitlebar maximizable={false} /> : null}
          {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
          <FirstDayPreparationScreen
            failure={firstDayPreparationFailure}
            onContinueAnyway={continueFirstDayPreparationAnyway}
            onRetry={retryFirstDayPreparation}
            phase={firstDayPreparationPhase}
            plan={firstDayPreparationPlan}
            progress={firstDayPreparationProgress}
            workActivityLabel={firstDayWorkLabel}
            discoveries={firstDayDiscoveries}
            chart={firstDayChart}
            dayRelation={firstDayDayRelation(firstDayPreparedDay ?? selectedDay, logicalTodayIsoDate(startOfDayMinutes))}
            appIcons={appIcons}
            reading={firstDayReading}
          />
          <ModalPresence>{promoHandoffAccountDialog}</ModalPresence>
          {latestBuildPrompt}
        </>
      </LocalizationProvider>
      </SiteIconProvider>
    );
  }

  return (
    <SiteIconProvider value={siteIcons}>
      <LocalizationProvider controller={localization}>
    <SettingsSearchProvider
      activeSection={activeTab === "settings" ? settingsSection : null}
      availability={{ dev: DEV_SETTINGS_ENABLED && devModeEnabled, intelligence: projectClassificationFeatureEnabled, windows: hostPlatform === "windows", macos: hostPlatform === "macos",
        backgroundUpdates: hostPlatform === "macos", signedIn: hasRequiredAccountAuth, deviceSync: deviceSyncFeatureVisible, authenticated: Boolean(user), accessibility: accessibilityRequired,
        promoCode: canOfferPromoCode(effectiveBillingEntitlement), friendInvite: Boolean(friendInvite) }}
      onNavigate={(entry) => {
        setSettingsSection(entry.section);
        if (entry.devSubsection) handleDevSettingsSubsectionChange(entry.devSubsection);
      }}
    >
      <SettingsSearchNavigatorBridge navigateRef={settingsSearchNavigateRef} />
      {/* Keep native window controls outside the narrow Settings scroll container. */}
      {hostPlatform === "windows" ? (
        <WindowsTitlebar
          leading={(
            <div className={windowsTitlebarNavClassName} role="group" aria-label={localization.t("shell.windowNavigation")}>
              {!isSettingsTab ? (
                <WindowSidebarToggle
                  collapsed={isSidebarVisuallyCollapsed}
                  placement="titlebar"
                  onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
                />
              ) : null}
              <span className="windows-titlebar-nav__history">
                <button type="button" className="windows-titlebar-nav-button" onClick={navigateBack} disabled={!canNavigateBack} aria-label={localization.t("shell.goBack")}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.8 3.8 5.6 8l4.2 4.2" /></svg>
                </button>
                <button type="button" className="windows-titlebar-nav-button" onClick={navigateForward} disabled={!canNavigateForward} aria-label={localization.t("shell.goForward")}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.2 3.8 10.4 8l-4.2 4.2" /></svg>
                </button>
              </span>
            </div>
          )}
          trailing={(
            <>
              <AiConnectionStatusBar status={chromeAiStatus} onOpenSettings={openChromeAiStatus} ariaLabel={chromeAiStatusAria} settingsOpen={activeTab === "settings" && settingsSection === "aiSetup"} />
              {titlebarUpdateVersion ? (
                <TopbarUpdateButton
                  onInstall={() => void handleInstallUpdate()}
                  progress={updaterDownloadProgress}
                  status={updateLifecycleStatus}
                  version={titlebarUpdateVersion}
                />
              ) : null}
            </>
          )}
        />
      ) : null}
    <div className={shellClassName}>
      {hostPlatform !== "windows" ? (
        <div className="window-chrome">
          <div className="window-nav-controls" aria-label={localization.t("shell.windowNavigation")}>
            {!isSettingsTab ? (
              <WindowSidebarToggle
                collapsed={isSidebarVisuallyCollapsed}
                placement="chrome"
                onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
              />
            ) : null}
          <button type="button" className="window-nav-button" onClick={navigateBack} disabled={!canNavigateBack} aria-label={localization.t("shell.goBack")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.8 3.8 5.6 8l4.2 4.2" /></svg>
          </button>
          <button type="button" className="window-nav-button" onClick={navigateForward} disabled={!canNavigateForward} aria-label={localization.t("shell.goForward")}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.2 3.8 10.4 8l-4.2 4.2" /></svg>
          </button>
          <WindowThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div className="window-drag-region" data-tauri-drag-region />
        <div className="window-chrome-actions">
          <AiConnectionStatusBar status={chromeAiStatus} onOpenSettings={openChromeAiStatus} ariaLabel={chromeAiStatusAria} settingsOpen={activeTab === "settings" && settingsSection === "aiSetup"} />
          {titlebarUpdateVersion ? (
            <TopbarUpdateButton
              onInstall={() => void handleInstallUpdate()}
              progress={updaterDownloadProgress}
              status={updateLifecycleStatus}
              version={titlebarUpdateVersion}
            />
          ) : null}
        </div>
        </div>
      ) : null}
      {cloudTrialStartedNotice && !onboardingOpen && !isDashboardDemoReplayActive ? (
        <CloudTrialStartedNotice
          notice={cloudTrialStartedNotice}
          onDismiss={dismissCloudTrialStartedNotice}
        />
      ) : null}
      {proStartedNoticeVisible && !onboardingOpen && !isDashboardDemoReplayActive ? (
        <ProStartedNotice
          look={proLooks.unlockedLook}
          onDismiss={() => {
            setProStartedNoticeVisible(false);
            proLooks.forgetUnlockedLook();
          }}
        />
      ) : null}
      {trialEndNoticeVisible ? (
        <TrialEndNotice
          funnelEnabled={funnelEnabled}
          unclassifiedSeconds={unclassifiedTodaySeconds ?? 0}
          onViewPlans={() => {
            markTrialEndNoticeSeen();
            handleOpenUpgradePlanModal();
          }}
          onDismiss={markTrialEndNoticeSeen}
        />
      ) : null}
      {shellStatusNotice ? <AppStatusNotice notice={shellStatusNotice} /> : null}
      {/* ── Sidebar ── */}
      {activeTab === "settings" ? (
        <SettingsSidebar
          activeSection={settingsSection}
          activeDevSubsection={devSettingsSubsection}
          isCollapsed={isSidebarVisuallyCollapsed}
          sectionsNeedingAttention={settingsAttentionSections}
          showDevSection={DEV_SETTINGS_ENABLED && devModeEnabled}
          onBack={handleSettingsBack}
          onDevSubsectionChange={handleDevSettingsSubsectionChange}
          onSectionChange={setSettingsSection}
          onSendFeedback={() => setFeedbackModalOpen(true)}
        />
      ) : (
        <aside id="app-sidebar" className={isSidebarVisuallyCollapsed ? "sidebar sidebar--collapsed" : "sidebar"}>
          <div
            className="brand"
            role="button"
            tabIndex={0}
            aria-label="Drifty"
            title="Drifty"
            data-capture-motion-key={brandCaptureMotionKey}
            data-capture-motion={brandCaptureMotionKey > 0 ? "capture-flip" : undefined}
            onClick={triggerBrandCaptureMotion}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                triggerBrandCaptureMotion();
              }
            }}
          >
            <img key={brandCaptureMotionKey} className="brand__logo" src={logoUrl} alt="" aria-hidden="true" />
          </div>

        <div className="sidebar-scroll">
          <SidebarNavigation
            activeTab={dayNotePageOpen || dayRecordVisible ? "settings" : activeTab}
            canOpenAgentsBeta={canOpenAgentsBeta}
            canOpenProfileBeta={canOpenProfileBeta}
            canOpenTeamsBeta={canOpenTeamsBeta}
            dashPeriod={dashPeriod}
            isCollapsed={isSidebarVisuallyCollapsed}
            navigationRefreshEnabled={canUseNavigationRefresh}
            projectClassificationFeatureEnabled={projectClassificationFeatureEnabled}
            socialSection={socialSection}
            teamReviewVariant={sidebarTeamReviewVariant}
            t={localization.t}
            onNavigate={dayNotePreview?.place === "page" || isDailyRecordPreviewActive
              ? (tabId, period) => { setDayNotePageOpen(false); setDayRecordOpen(false); navigateToTab(tabId, period); }
              : navigateToTab}
            activityExtra={DayNoteNavItemPreview && dayNotePreview?.place === "page" ? (
              <Suspense fallback={null}>
                <DayNoteNavItemPreview active={dayNotePageOpen} collapsed={isSidebarVisuallyCollapsed} onOpen={() => setDayNotePageOpen(true)} />
              </Suspense>
            ) : isDailyRecordPreviewActive ? (
              <Suspense fallback={null}>
                <LazyDayRecordNavItem active={dayRecordVisible} collapsed={isSidebarVisuallyCollapsed} onOpen={() => setDayRecordOpen(true)} />
              </Suspense>
            ) : null}
          />
        </div>

        <div className="sidebar-foot">
          {DayNoteDevBarPreview && dayNotePreview ? (
            <Suspense fallback={null}><DayNoteDevBarPreview /></Suspense>
          ) : null}
          {visibleSidebarCtaSlot ? (
            <SidebarCtaSlot
              funnelEnabled={funnelEnabled}
              state={visibleSidebarCtaSlot}
              onDismiss={visibleSidebarCtaSlot.kind === "upgrade" && !isSidebarCtaPreviewActive
                ? () => setSidebarUpgradeDismissedUntil(storeSidebarUpgradeDismissal())
                : undefined}
              onAction={() => {
                if (visibleSidebarCtaSlot.kind === "tracker") {
                  // Tracker permissions live in General settings.
                  if (accountTrackerAttention === "setup") {
                    openSettingsTab();
                    return;
                  }
                  void (status?.running ? handleStopTracking() : handleStartTracking());
                  return;
                }
                if (visibleSidebarCtaSlot.kind === "ai") {
                  openAiSetupSettings();
                  return;
                }
                if (visibleSidebarCtaSlot.kind === "device-limit") {
                  openSyncSettings();
                  return;
                }
                if (visibleSidebarCtaSlot.kind === "download" || visibleSidebarCtaSlot.kind === "preparing") return;
                if (visibleSidebarCtaSlot.kind === "billing") {
                  // Existing subscription with a blocked payment: recover it in
                  // the portal instead of starting a second one.
                  void handleManageCloudBilling();
                  return;
                }
                handleOpenUpgradePlanModal();
              }}
            />
          ) : null}
          <AccountMenu
            isOpen={accountMenuOpen}
            isSidebarCollapsed={isSidebarVisuallyCollapsed}
            userAvatarUrl={profile?.avatar_url || profileDraft.avatarUrl || authMetadataAvatarUrl}
            userEmail={user?.email ?? null}
            tracker={{
              state: sidebarTrackerControlState,
              attention: accountTrackerAttention,
              markRow: markAccountRowAttention,
              statusLabel: sidebarTrackerStatusLabel,
              appLabel: sidebarTrackerAppLabel,
              description: [
                sidebarTrackerStatusLabel,
                sidebarTrackerAppLabel,
                sidebarTrackerSiteLabel,
                sidebarTrackerDurationLabel,
                sidebarTrackerMetaLabel,
              ].filter(Boolean).join(" · "),
              actionLabel: sidebarTrackerActionLabel,
              actionDisabled: isSidebarTrackerActionDisabled,
              busy: trackerPausePending,
              onAction: () => {
                if (replaySidebarTrackerCard) {
                  stopDashboardDemoReplay();
                  return;
                }
                void (status?.running ? handleStopTracking() : handleStartTracking());
              },
              // Tracker permissions live in General settings.
              onSetup: openSettingsTab,
            }}
            isDarkMode={theme === "dark"}
            isPetVisible={petModeEnabled}
            showPetNewBadge={featureNewBadges.showPet}
            onToggle={toggleAccountMenu}
            showProfile={canOpenProfileBeta}
            onProfile={() => {
              navigateToTab("profile");
              if (isPolicySignedIn) void focusCard.refresh();
              setAccountMenuOpen(false);
            }}
            onAiSetting={() => {
              openAiSetupSettings();
            }}
            onSettings={() => {
              openSettingsTab();
            }}
            onToggleTheme={() => {
              toggleTheme();
            }}
            onTogglePet={() => {
              togglePetModeEnabled();
            }}
            onCheckForUpdates={() => {
              handleManualCheckForUpdates();
            }}
            onFeedback={() => {
              setFeedbackModalOpen(true);
              setAccountMenuOpen(false);
            }}
            onInviteFriends={friendInvite ? () => {
              const entry = SETTINGS_SEARCH_ENTRIES.find((candidate) => candidate.id === FRIEND_INVITE_SETTING_ID);
              navigateToTab("settings");
              setSettingsSection("account");
              if (entry) settingsSearchNavigateRef.current?.(entry);
              setAccountMenuOpen(false);
              capturePostHogEvent("billing_action", { action: "friend_invite_menu_opened", result: "success" });
            } : undefined}
            onSignIn={() => {
              openDefaultAuthModal();
              setAccountMenuOpen(false);
            }}
            onSignOut={() => {
              setAccountMenuOpen(false);
              void signOut().catch((nextError) => {
                setError(toErrorMessage(nextError));
              });
            }}
          />
        </div>
        </aside>
      )}

      {/* The development review's synthetic day uses public favicons; the app reads the native icon cache. */}
      <SiteIconProvider value={postOnboardingSidebarGuideReviewEnabled ? { ...buildIntroReviewSiteIcons(), ...siteIcons } : siteIcons}>
      <PostOnboardingSidebarGuide
        step={shouldShowPostOnboardingSidebarGuide ? postOnboardingSidebarGuideStep : null}
        navigationRefreshEnabled={canUseNavigationRefresh}
        hostPlatform={introHostPlatform}
        theme={theme}
        sequence={introSequence}
        recap={introStory.recap}
        decision={introDecision}
        onAdvance={advanceIntro}
        onBack={retreatPostOnboardingSidebarGuide}
        onDismiss={dismissIntro}
      />
      </SiteIconProvider>

      {/* ── Main content ── */}
      <MainContentShell activeTab={activeTab} loading={loading} hasLoadedOnce={hasLoadedOnce} error={error} contentRef={contentRef}>
        <Suspense fallback={<DeferredPageImportFallback label={activeTab} />}>
        {/* Dev-server review only: the day note's own page covers the tab under it. */}
        {DayNotePagePreview && dayNotePageOpen ? (
          <Suspense fallback={null}><DayNotePagePreview appIcons={appIcons} onConnect={openAiSetupSettings} /></Suspense>
        ) : null}
        {dayRecordVisible ? (
          <Suspense fallback={null}>
            <LazyDayRecordPage loadHistory={loadCompactHistoryRange} recentSegments={insightSegments} classificationOptions={insightClassificationOptions} startOfDayMinutes={startOfDayMinutes} appIcons={appIcons} />
          </Suspense>
        ) : null}

        {/* Dashboard */}
        {activeTab === "dashboard" ? (
          <DashboardPage
            funnelEnabled={funnelEnabled}
            funnelResultEnabled={!loading && !upgradePlanModalOpen && !onboardingOpen && !preparingFirstDay}
            appIcons={appIcons}
            appTheme={theme}
            billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
            billingPlansDisabled={billingCheckoutAwaitingConfirmation || individualPricingQuoteLoading}
            billingPortalLoading={billingPortalLoading}
            individualPricingQuote={individualPricingQuote}
            currentMinuteOfDay={effectiveCurrentMinuteOfDay}
            dashboardAiRecoveryState={upgradePlanModalOpen ? null : dashboardAiRecoveryState}
            dashboardAppUsage={stickyDashboardAppUsage}
            dashboardSegments={effectiveDashboardSegments}
            dashboardClassificationOptions={dashboardClassificationOptions}
            browserHistoryBootstrapNotice={browserHistoryBootstrapNotice}
            dashboardCategoryTotals={stickyDashboardCategoryTotals}
            dashboardDateNavigator={dashboardDateNavigator}
            dashboardProductivityTotals={stickyDashboardProductivityTotals}
            dashboardReplay={dashboardReplay}
            dashboardActivityActionsEnabled={dashboardActivityActionsEnabled}
            dashboardRange={effectiveDashboardRange}
            dashPeriod={dashPeriod}
            flowBlocks={flowBlocks}
            summaryFlowBlocks={summaryFlowBlocks}
            deviceLabelById={remoteDeviceLabelById}
            deviceTimelineFilter={deviceTimelineFilter}
            onDeviceTimelineFilterChange={setDeviceTimelineFilter}
            projectModeAvailable={projectClassification.projectModeAvailable}
            projectLegend={flowProjectLegend}
            activityInspectorProjectOptions={activityInspectorProjectOptions}
            activityInspectorProjectBySegmentId={dashboardInspectorProjectBySegmentId}
            weekProjectAssignments={dashboardProjectAssignmentLoad.key === dashboardProjectRangeKey ? dashboardProjectAssignmentLoad.assignments : undefined}
            weekProjectWindowAssignments={dashboardProjectAssignmentLoad.key === dashboardProjectRangeKey ? dashboardProjectAssignmentLoad.windowAssignments : undefined}
            flowProjectRingEntries={dashboardProjectRing.entries}
            flowProjectCenterPercent={dashboardProjectRing.centerPercent}
            focusDriftSection={focusDriftSection}
            dayBreakdownTiles={stickyDayBreakdownTiles}
            dayFocusDeltaSeconds={isPreviewSurface ? 48 * 60 : dayFocusDeltaSeconds}
            hasTimelineData={hasTimelineData}
            historyClassificationOptions={historyClassificationOptions}
            historySegments={historySegments}
            initialDataLoading={loading && !hasLoadedOnce}
            selectedDay={selectedDay}
            selectedDayLabel={selectedDayLabel}
            startOfDayMinutes={startOfDayMinutes}
            statusRunning={status?.running === true}
            totalSeconds={stickyTotalSeconds}
            weekCalendarEvents={weekCalendarEvents}
            googleCalendarWeekEvents={googleCalendarWeek.events}
            googleCalendarWeekStatus={googleCalendarWeek.status}
            weekFocusDeltaSeconds={isPreviewSurface ? 3 * 3600 + 5 * 60 : weekFocusDeltaSeconds}
            weekRefreshStatus={weekRefreshStatus}
            weekRows={weekRows}
            weekCurrentCalendarDay={isDashboardDemoReplayActive && dashPeriod === "Week" ? effectiveTodayDayForWeekModel : null}
            weekCurrentMinuteOfDay={isDashboardDemoReplayActive && dashPeriod === "Week" ? effectiveCurrentMinuteOfDay : null}
            onDismissDashboardAiRecovery={handleDismissDashboardAiRecovery}
            onOpenDashboardAiSetup={openDashboardAiSetup}
            shareAccountScope={shareAccountScope}
            onJoinLeaderboard={handleLeaderboardOptIn}
            onManageCloudBilling={() => {
              // Same preview guard as checkout: the overlay is synthetic and must
              // not open Polar against the signed-in account.
              if (dashboardAiUnavailablePreview) return;
              void handleManageCloudBilling();
            }}
            onSelectBillingPlan={(billingInterval) => {
              // The dashboard recovery preview renders a synthetic entitlement,
              // so its plan cards must not bill the real account behind it.
              if (dashboardAiUnavailablePreview) return;
              void startCloudCheckout(billingInterval);
            }}
            navigationRefreshEnabled={canUseNavigationRefresh}
            onPeriodChange={selectDashboardPeriod}
            onSaveDashboardActivityValues={handleSaveDashboardActivityValues}
            onDeleteDashboardActivity={handleDeleteDashboardActivity}
            onSelectDay={selectDay}
          />
        ) : null}

        {/* Agents: local agent time and commit output. */}
        {activeTab === "agents" && canOpenAgents ? (
          <LazyAgentsPage
            navigationRefreshEnabled={canUseNavigationRefresh}
            flowIntervalMinutes={agentsFlowIntervalMinutes}
            onFlowIntervalChange={handleAgentsFlowIntervalChange}
            onSelectDay={selectDay}
            selectedDay={selectedDay}
            startOfDayMinutes={startOfDayMinutes}
            startOfWeek={startOfWeek}
            todayDay={todayDay}
            sshSyncStatus={sshAgentSourceSync.status}
            syncSshHost={sshAgentSourceSync.syncHostNow}
          />
        ) : null}

        {/* Classification */}
        {activeTab === "classification" ? (
          <LazyClassificationPage
            appIcons={appIcons}
            canShiftClassificationForward={canShiftClassificationForward}
            classificationActivityPeakSeconds={classificationActivityPeakSeconds}
            classificationActivityRows={classificationActivityRows}
            classificationCategoryBreakdowns={classificationCategoryBreakdowns}
            classificationDateLabel={classificationDateLabel}
            classificationOptions={classificationOptions}
            classificationPanelStyle={classificationPanelStyle}
            classificationFocusRatePercent={classificationFocusRatePercent}
            classificationRange={classificationRange}
            classificationSessionCount={classificationSegments.length}
            classificationSourceSummaries={classificationSourceSummaries}
            classificationTopAppIconSrc={classificationTopApp ? appIcons[classificationTopApp.bundleId ?? classificationTopApp.appName] ?? null : null}
            classificationTopAppLabel={classificationTopAppLabel}
            classificationTopAppName={classificationTopApp?.appName ?? classificationTopAppLabel}
            classificationTotalSeconds={classificationTotalSeconds}
            effectiveClassifyCategoryId={effectiveClassifyCategoryId}
            effectiveClassifySourceId={effectiveClassifySourceId}
            expandedClassificationActivityRows={expandedClassificationActivityRows}
            isCurrentClassificationRange={isCurrentClassificationRange}
            devModeEnabled={isDevModeActive}
            classificationCorrectionDraft={classificationCorrectionDraft}
            classificationCorrectionNotice={classificationCorrectionNotice}
            classificationCorrectionSaving={classificationCorrectionSaving}
            selectedClassificationBreakdown={selectedClassificationBreakdown}
            selectedClassificationSourceSummary={selectedClassificationSourceSummary}
            selectedClassificationTone={selectedClassificationTone}
            onActivityRowToggle={(rowId) => {
              setExpandedClassificationActivityRows((current) => {
                const next = new Set(current);
                if (next.has(rowId)) next.delete(rowId);
                else next.add(rowId);
                return next;
              });
            }}
            onCategorySelect={(category) => {
              setClassifySelectedCategoryId(category);
              setClassifySelectedSourceId(null);
            }}
            onCancelClassificationCorrection={() => {
              setClassificationCorrectionDraft(null);
              setClassificationCorrectionNotice(null);
            }}
            onClassificationCorrectionCategoryChange={(category) => updateClassificationCorrectionDraft({ category })}
            onClassificationCorrectionProductivityChange={(productivity) => updateClassificationCorrectionDraft({ productivity })}
            onNextClassificationRange={() => {
              if (canShiftClassificationForward) selectDay((p) => getSafeClassificationNavigationDay(p, classificationRange, 1, todayDay, startOfDayMinutes, startOfWeek));
            }}
            onPreviousClassificationRange={() => selectDay((p) => getSafeClassificationNavigationDay(p, classificationRange, -1, todayDay, startOfDayMinutes, startOfWeek))}
            onRangeChange={setClassificationRange}
            onSaveClassificationCorrection={() => void saveClassificationCorrection()}
            onSourceSelect={setClassifySelectedSourceId}
            onStartClassificationDetailCorrection={(rowId) => startClassificationCorrection("detail", rowId)}
            onStartClassificationSurfaceCorrection={() => startClassificationCorrection("surface")}
            onTodayClassificationRange={() => selectDay(getSafeClassificationNavigationDay(selectedDay, classificationRange, 0, todayDay, startOfDayMinutes, startOfWeek))}
          />
        ) : null}

        {activeTab === "history" ? (
          <div className="page page--history">
            {historyDeletionResult ? <HistoryDeletionNotice result={historyDeletionResult} onDismiss={() => setHistoryDeletionResult(null)} /> : null}
            {isDeferredTabBodyReady ? (
              <LazyHistoryView
                appIcons={appIcons}
                classificationOptions={historyClassificationOptions}
                deleting={historyDeleting}
                hasMoreSegments={displayedHistoryHasMoreSegments}
                initialLoading={historyInitialLoading}
                loadingMore={displayedHistoryLoading}
                loadMoreError={displayedHistoryLoadMoreError?.message ?? null}
                loadMoreErrorDetail={displayedHistoryLoadMoreError?.detail ?? null}
                searchQuery={historySearchQuery}
                searchUsesBackend={true}
                segments={displayedHistorySegments}
                startOfDayMinutes={startOfDayMinutes}
                onDeleteSelected={handleDeleteHistorySegments}
                onRefreshAfterDelete={refreshAfterHistoryDeletion}
                onOpenDeleteHistory={() => { setHistoryDeletionResult(null); setDeleteHistoryModalOpen(true); }}
                onLoadMore={displayedHistoryLoadMore}
                onSearchQueryChange={setHistorySearchQuery}
              />
            ) : (
              <DeferredTabBodyFallback label="history records" variant="history" />
            )}
          </div>
        ) : null}

        {/* Projects */}
        {activeTab === "projects" && projectClassificationFeatureEnabled ? (
          <LazyProjectsPage
            createRequested={newProjectRequested}
            onCreateRequestHandled={() => setNewProjectRequested(false)}
            projects={projectClassification.projects}
            activeTeamProjectCount={projectClassification.activeTeamProjectCount}
            assignments={projectClassification.assignments}
            selectedDay={selectedDay}
            startOfDayMinutes={startOfDayMinutes}
            daySegments={selectedDayProjectProjection.segments}
            dayProjectBySegmentId={selectedDayProjectBySegmentId}
            trendSegments={projectsTrendProjection.segments}
            trendProjectBySegmentId={projectsTrendProjectBySegmentId}
            trendLoadedRange={projectsTrend.loadedRange}
            projectsLoading={projectClassification.projectsLoading}
            running={projectClassification.running}
            runError={projectClassification.runError}
            analysisConnected={projectAnalysisConnected}
            analysisSetup={analysisModel.effectiveAnalysisSetup}
            autoAnalysis={projectAutoAnalysis}
            matchCooldown={projectMatchCooldown}
            onTrendWindowChange={handleProjectsTrendWindowChange}
            onConfigureModel={() => {
              navigateToTab("settings");
              setSettingsSection("aiSetup");
              setAiSetupRequestedTab("intelligence");
            }}
            onOpenTrends={openProjectTrends}
            onSaveProject={handleSaveProject}
            onDeleteProject={handleDeleteProject}
            onRunAnalysis={() => requestProjectPassRun()}
          />
        ) : null}

        {/* Insights */}
        {activeTab === "trends" ? (
          <TrendsPage
            calendarEndDay={selectedDay}
            calendarStartOfDayMinutes={startOfDayMinutes}
            loadCalendarHistory={loadCompactHistoryRange}
            activeInsightCategoryTotals={activeInsightCategoryTotals}
            activeInsightProductivityTotals={activeInsightProductivityTotals}
            appIcons={appIcons}
            attentionRhythm={attentionRhythm}
            bodyFallback={<DeferredTabBodyFallback label="trend analysis" variant="trends" />}
            bodyReady={isTrendsBodyReady}
            alarmFollowThrough={alarmFollowThrough}
            canShiftInsightForward={canShiftInsightForward}
            driftSourceLists={driftSourceLists}
            focusSourceLists={focusSourceLists}
            insightClassificationOptions={insightClassificationOptions}
            insightDateLabel={insightDateLabel}
            insightSegments={activeInsightSegments}
            isTodaySelected={isTodaySelected}
            trendsRange={trendsRange}
            weeklyBreakdown={weeklyBreakdown}
            weeklyProjectSeries={weeklyProjectChart.series}
            weeklyProjectMeta={weeklyProjectChart.meta}
            weeklyProjectBySegmentId={insightProjectBySegmentId}
            weeklyProjectSegments={insightProjectProjection.segments}
            projectModeAvailable={weeklyProjectChart.available}
            weeklyChartMode={weeklyChartMode}
            onNextInsightRange={() => {
              if (canShiftInsightForward) selectDay((p) => shiftInsightPeriodDay(p, trendsRange, 1));
            }}
            onPreviousInsightRange={() => selectDay((p) => shiftInsightPeriodDay(p, trendsRange, -1))}
            onTodayInsightRange={() => selectDay(todayDay)}
            onTrendsRangeChange={setTrendsRange}
            onWeeklyChartModeChange={setWeeklyChartMode}
          />
        ) : null}

        {/* Social: public profile, embeds, and leaderboard */}
        {activeTab === "leaderboard" ? (
          <LazySocialPage
            activeSection={socialSection}
            actionError={leaderboardActionError}
            activePeriod={activeLeaderboardPeriod}
            email={user?.email ?? null}
            error={leaderboardError}
            isActionLoading={leaderboardActionLoading}
            isCatchingUp={isClassificationCatchingUp}
            isLoading={leaderboardLoading}
            isOptedIn={isLeaderboardOptedIn}
            isParticipationResolved={isLeaderboardParticipationResolved}
            isSignedIn={isPolicySignedIn}
            isSupabaseEnabled={isSupabaseConfigured || leaderboardUsesPreviewProfile}
            leaderboard={leaderboardRows}
            ownFocusSeconds={leaderboardUsesPreviewProfile
              ? leaderboardRows.find((row) => row.rank === 6)?.focus_seconds ?? 90360
              : ownLeaderboardEntry?.focus_seconds ?? null}
            ownParticipantCount={leaderboardUsesPreviewProfile
              ? leaderboardRows.length || 50
              : ownLeaderboardEntry?.participant_count ?? null}
            ownRank={leaderboardUsesPreviewProfile ? 6 : ownLeaderboardEntry?.rank ?? null}
            publiclyValid={leaderboardUsesPreviewProfile ? true : ownLeaderboardEntry?.publicly_valid ?? null}
            profileDisplayName={leaderboardProfileDisplayName}
            publicProfile={{
              card: focusCard,
              dailyProductivity: effectiveDailyProductivity,
              // The preview renders a joined user (#6), and joining publishes the
              // page, so its draft is public like a real participant's.
              draft: leaderboardUsesPreviewProfile ? { ...profileDraft, isPublic: true } : profileDraft,
              focusSeconds7d: localRollingFocusSeconds,
              localMetricsStatus: leaderboardLocalMetricsStatus,
              isPreviewProfile: leaderboardUsesPreviewProfile,
              profileError: isProfileEditorOpen ? null : profileError,
              profileLoading,
              profileMessage: isProfileEditorOpen ? null : profileMessage,
              profileSaving,
              publicId: profile?.public_id ?? (leaderboardUsesPreviewProfile ? "00000000-0000-4000-8000-000000000000" : null),
              shareMessage: profileShareMessage,
              onCopyProfileLink: () => void handleShareLeaderboardProfile(),
              onEditProfile: openProfileEditor,
              onEnsureProfile: handleSaveProfile,
              shareCard: leaderboardShareCardContext,
            }}
            statusMessage={leaderboardStatusMessage}
            statusTone={leaderboardStatusTone}
            totalFocusSeconds7d={totalLeaderboardFocusSeconds}
            onOptIn={() => void handleLeaderboardOptIn()}
            onOptOut={() => void handleLeaderboardOptOut()}
            onPeriodChange={setActiveLeaderboardPeriod}
            onSelectProfile={(row) => void handleSelectLeaderboardProfile(row)}
            onSignIn={() => void handleLeaderboardOptIn()}
          />
        ) : null}

        {activeTab === "team" && canOpenTeamsBeta ? (
          <LazyTeamsBetaSurface
            hasRequiredAccountAuth={hasRequiredAccountAuth}
            isPolicySignedIn={isPolicySignedIn}
            isSupabaseConfigured={isSupabaseConfigured}
            startOfDayMinutes={startOfDayMinutes}
            user={user}
            controller={teamController}
            teamSubView={teamSubView}
            onTeamSubViewChange={setTeamSubView}
            pendingInvite={pendingTeamInvite}
            onAuthRequired={requestTeamAuth}
            onPendingInviteClear={() => setPendingTeamInvite(null)}
          />
        ) : null}

        {/* Settings */}
        {activeTab === "settings" ? (
          <div className="page">
            <h1 className="sr-only">{localization.t("common.settings")}</h1>
            <ProLooksProvider value={proLooks}>
            <SettingsSearchDestination>
                {settingsSection === "classification" && (
                  <ClassificationRulesManager
                    onSaveRule={saveClassificationRule}
                    appIcons={appIcons}
                    appRuleCategory={appRuleCategory}
                    appRuleDisplayName={appRuleDisplayName}
                    appRuleProductivity={appRuleProductivity}
                    appRuleSearch={appRuleSearch}
                    appRuleSearchPanelOpen={appRuleSearchPanelOpen}
                    appRuleSearchRef={appRuleSearchRef}
                    appRuleTargetValue={appRuleTargetValue}
                    appThemeColorOverrides={appThemeColorOverrides}
                    categoryColorOverrides={categoryColorOverrides}
                    classificationRuleApplyResult={classificationRuleApplyResult}
                    classificationRuleCandidates={classificationRuleCandidates}
                    classificationRuleCandidatesLoading={classificationRuleCandidatesLoading}
                    classificationRuleDeletingId={classificationRuleDeletingId}
                    classificationRuleMessage={classificationRuleMessage}
                    classificationRuleSavingKind={classificationRuleSavingKind}
                    classificationRuleSegments={classificationRuleSegments}
                    classificationRules={classificationRules}
                    classificationRulesError={classificationRulesError}
                    classificationRulesLoading={classificationRulesLoading}
                    domainRuleCandidates={domainRuleCandidates}
                    domainRuleCandidatesLoading={domainRuleCandidatesLoading}
                    domainRuleCategory={domainRuleCategory}
                    domainRuleInput={domainRuleInput}
                    domainRuleMode={domainRuleMode}
                    domainRuleProductivity={domainRuleProductivity}
                    domainRuleSearchPanelOpen={domainRuleSearchPanelOpen}
                    domainRuleSearchRef={domainRuleSearchRef}
                    onAppRuleCategoryChange={setAppRuleCategory}
                    onAppRuleProductivityChange={setAppRuleProductivity}
                    onAppRuleSearchBlur={handleAppRuleSearchBlur}
                    onAppRuleSearchChange={updateAppRuleSearch}
                    onAppRuleSearchFocus={handleAppRuleSearchFocus}
                    onDeleteClassificationRule={(rule) => void handleDeleteClassificationRule(rule)}
                    onDomainRuleCategoryChange={setDomainRuleCategory}
                    onDomainRuleInputChange={updateDomainRuleInput}
                    onDomainRuleModeChange={setDomainRuleMode}
                    onDomainRuleProductivityChange={setDomainRuleProductivity}
                    onDomainRuleSearchBlur={handleDomainRuleSearchBlur}
                    onDomainRuleSearchFocus={handleDomainRuleSearchFocus}
                    onLoadClassificationRules={() => void loadClassificationRules()}
                    onSaveAppRule={() => void handleSaveAppRule()}
                    onSaveDomainRule={() => void handleSaveDomainRule()}
                    onSelectClassificationCandidate={handleSelectClassificationCandidate}
                    onSelectDomainRuleCandidate={handleSelectDomainRuleCandidate}
                    onToggleClassificationRule={(rule, enabled) => void handleToggleClassificationRule(rule, enabled)}
                  />
                )}
                {settingsSection === "account" && (
                  <AccountSettingsSection
                    key={user?.id ?? "signed-out"}
                    billingCheckoutAwaitingConfirmation={billingCheckoutAwaitingConfirmation}
                    billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
                    billingEntitlementError={effectiveBillingEntitlementError}
                    billingActionError={billingActionError}
                    billingEntitlement={effectiveBillingEntitlement}
                    billingEntitlementLockedReason={effectiveBillingEntitlement?.lockedReason ?? null}
                    billingEntitlementStatus={effectiveBillingEntitlement?.status ?? null}
                    billingPlansDisabled={isDashboardAiUnavailablePreviewActive || billingCheckoutAwaitingConfirmation || individualPricingQuoteLoading}
                    billingPortalLoading={billingPortalLoading}
                    couponRedemption={couponRedemption}
                    couponRedemptionErrorCode={couponRedemptionErrorCode}
                    couponRedemptionLoading={couponRedemptionLoading}
                    cloudStatusRefreshing={effectiveBillingEntitlementLoading}
                    hasAuthenticatedSession={Boolean(user)}
                    hasSignedInAccount={hasRequiredAccountAuth}
                    isSupabaseConfigured={effectiveIsSupabaseConfigured}
                    loadFriendInvite={fetchFriendInvite}
                    authUserId={user?.id ?? null}
                    userEmail={user?.email ?? null}
                    onDeleteAccount={() => setAccountDeletionModalOpen(true)}
                    onManageCloudBilling={handleManageCloudBilling}
                    onOpenAiSetup={openAiSetupSettings}
                    onRefreshCloudStatus={refreshBillingEntitlement}
                    onRedeemTrialCoupon={handleRedeemTrialCoupon}
                    onSignIn={openDefaultAuthModal}
                    onUpgradeToPro={handleOpenUpgradePlanModal}
                  />
                )}
                {settingsSection === "sync" && (
                  <SyncSettingsSection
                    key={user?.id ?? "signed-out"}
                    appVersion={BUILD_INFO.version}
                    billingEntitlement={effectiveBillingEntitlement}
                    billingEntitlementError={effectiveBillingEntitlementError}
                    cloudDeviceAccess={effectiveBillingEntitlement?.deviceAccess ?? null}
                    cloudDeviceActionError={cloudDeviceActionError}
                    cloudDeviceRevokingId={cloudDeviceRevokingId}
                    cloudDevices={effectiveBillingEntitlement?.cloudDevices ?? cloudDevices}
                    cloudStatusRefreshing={effectiveBillingEntitlementLoading}
                    hasSignedInAccount={hasRequiredAccountAuth}
                    hostPlatform={hostPlatform}
                    isSupabaseConfigured={effectiveIsSupabaseConfigured}
                    userEmail={user?.email ?? null}
                    deviceSyncEnabled={deviceSyncEnabled}
                    deviceSyncCanEnable={deviceSyncCanEnable}
                    deviceSyncGateActive={deviceSyncActive}
                    deviceSyncStatus={deviceSyncStatus}
                    deviceSyncPurging={deviceSyncPurging}
                    onDeviceSyncEnabledChange={deviceSyncFeatureVisible ? handleDeviceSyncEnabledChange : undefined}
                    onDeviceSyncNow={deviceSyncNow}
                    onPurgeDeviceSyncData={handlePurgeDeviceSyncData}
                    onRefreshCloudStatus={refreshBillingEntitlement}
                    onRevokeCloudDevice={handleRevokeCloudDevice}
                    onSignIn={openDefaultAuthModal}
                    onUpgradeToPro={handleOpenUpgradePlanModal}
                  />
                )}
                {settingsSection === "general" && (
                  <GeneralSettingsSection
                    backgroundUpdatesSupported={hostPlatform === "macos" || hostPlatform === "windows"}
                    currentVersion={BUILD_INFO.version === "unknown" ? null : BUILD_INFO.version}
                    backgroundUpdatesEnabled={backgroundUpdatesEnabled}
                    devModeEnabled={isDevModeActive}
                    hostPlatform={hostPlatform}
                    permissions={(
                      <PermissionsSettingsSection
                        accessibilityGranted={accessibilityGranted}
                        accessibilityRequired={accessibilityRequired}
                        hostPlatform={hostPlatform}
                        onCheckAccessibility={handleCheckAccessibility}
                        onRequestAccessibility={handleRequestAccessibility}
                      />
                    )}
                    showDevMode={DEV_SETTINGS_ENABLED && hostPlatform === "windows"}
                    startOfDayValue={startOfDayValue}
                    startOfWeek={startOfWeek}
                    updaterChecking={updaterChecking}
                    updaterError={updaterError}
                    updaterInstalling={updaterInstalling || updaterDownloading}
                    updaterMessage={updaterMessage}
                    onBackgroundUpdatesEnabledChange={setBackgroundUpdatesEnabled}
                    onCheckForUpdates={() => void handleCheckForUpdates()}
                    onOpenWhatsNew={openWhatsNew}
                    onDevModeChange={handleDevModeEnabledChange}
                    onStartOfDayChange={handleStartOfDayChange}
                    onStartOfWeekChange={handleStartOfWeekChange}
                  />
                )}
                {settingsSection === "appearance" && (
                  <AppearanceSettingsSection
                    hostPlatform={hostPlatform}
                    windowsBlurEnabled={windowsBlurEnabled}
                    onWindowsBlurEnabledChange={handleWindowsBlurEnabledChange}
                    appThemeColorOverrides={appThemeColorOverrides}
                    categoryColorOverrides={categoryColorOverrides}
                    theme={theme}
                    onAppThemeColorChange={handleAppThemeColorChange}
                    onAppThemeColorReset={handleAppThemeColorReset}
                    onCategoryColorChange={handleCategoryColorChange}
                    onCategoryColorReset={handleCategoryColorReset}
                    onThemeChange={setTheme}
                  />
                )}
                {settingsSection === "aiSetup" && (
                  <AiSetupSettingsSection
                    cloudTrialAvailable={canStartCloudTrial(effectiveBillingEntitlement)}
                    cloudTrialStarting={cloudTrialStarting}
                    cloudTrialError={cloudTrialError}
                    onStartCloudTrial={async () => {
                      if (isDashboardAiUnavailablePreviewActive) return false;
                      try { await activateCloudTrial(); return true; } catch { return false; }
                    }}
                    billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
                    billingEntitlementStatus={effectiveBillingEntitlement?.status ?? null}
                    billingEntitlementOwner={effectiveBillingEntitlement?.entitlementOwner}
                    billingEntitlementLockedReason={effectiveBillingEntitlement?.lockedReason}
                    billingEntitlementError={billingEntitlementError}
                    onRefreshCloudStatus={refreshBillingEntitlement}
                    onManageCloudDevices={() => setSettingsSection("sync")}
                    billingPlansDisabled={isDashboardAiUnavailablePreviewActive || billingCheckoutAwaitingConfirmation}
                    cloudStatusRefreshing={effectiveBillingEntitlementLoading}
                    connectionStatus={runtimeAwareAiConnectionStatus}
                    connectionTest={aiConnectionTest}
                    currentBillingPlan={currentBillingPlan}
                    localAiSetup={localAiSetup}
                    shouldShowCloudCheckoutPlans={shouldShowCloudCheckoutPlans}
                    workProfileUserId={user?.id ?? "local"}
                    memorySuggestionProvider={memorySuggestionProvider}
                    analysisSetup={analysisModel.analysisSetup}
                    effectiveAnalysisSetup={analysisModel.effectiveAnalysisSetup}
                    onAnalysisProviderVisible={analysisModel.onProviderVisible}
                    analysisOpenRouterConnected={analysisModel.openRouterConnected}
                    showIntelligenceTab={projectClassificationFeatureEnabled}
                    requestedTab={aiSetupRequestedTab}
                    onRequestedTabConsumed={() => setAiSetupRequestedTab(null)}
                    onAnalysisChange={analysisModel.setAnalysisSetup}
                    onDialogOpenChange={setAiSetupDialogOpen}
                    onLocalAiSetupChange={setLocalAiSetup}
                    onManageCloudBilling={handleManageCloudBilling}
                    onStartCloudSetup={handleOpenUpgradePlanModal}
                  />
                )}
                {settingsSection === "pet" && (
                  <PetSettingsSection
                    enabled={petModeEnabled}
                    coat={petModeCoat}
                    size={petModeSize}
                    automaticCloseEnabled={automaticCloseEnabled}
                    driftAlertsEnabled={driftAlertsEnabled}
                    onAutomaticCloseChange={handleAutomaticCloseSettingsChange}
                    showNewBadge={featureNewBadges.showPet}
                    onEnabledChange={requestPetModeEnabled}
                    onCoatChange={setPetModeCoat}
                    onSizeChange={setPetModeSize}
                    onOpenAlerts={openCompanionNotificationSettings}
                    hostPlatform={hostPlatform}
                  />
                )}
                {settingsSection === "notifications" && (
                  <NotificationsSettingsSection
                    hostPlatform={hostPlatform}
                    driftAlertDelaySeconds={driftAlertDelaySeconds}
                    driftAlertsEnabled={driftAlertsEnabled}
                    driftAlarmCopy={driftAlarmCopy}
                    driftAlarmCopyDefaults={driftAlarmCopyDefaults}
                    extremeNudgeEnabled={automaticCloseEnabled}
                    petEnabled={petModeEnabled}
                    macosNotificationEnabled={macosNotificationEnabled}
                    celebrationsEnabled={celebrationsEnabled}
                    dayReviewEnabled={dayReviewEnabled}
                    dayReviewTimeValue={dayReviewTimeValue}
                    quietHours={quietHours}
                    onDriftAlertDelaySecondsChange={setDriftAlertDelaySeconds}
                    onDriftAlarmCopyOverridesChange={setDriftAlarmCopyOverrides}
                    onDriftAlertsChange={setDriftAlertsEnabled}
                    onExtremeNudgeChange={handleAutomaticCloseSettingsChange}
                    onMacosNotificationChange={setMacosNotificationEnabled}
                    onCelebrationsChange={setCelebrationsEnabled}
                    onDayReviewEnabledChange={setDayReviewEnabled}
                    onDayReviewTimeChange={handleDayReviewTimeChange}
                    onQuietHoursChange={setQuietHours}
                  />
                )}
                {settingsSection === "privacy" && (
                  <PrivacySettingsSection
                    deviceSyncEnabled={deviceSyncActive}
                    onHistoryDeleted={handleHistoryRangeDeleted}
                  />
                )}
                {settingsSection === "developer" && <DeveloperSettingsSection />}
                {settingsSection === "dev" && DEV_SETTINGS_ENABLED && devModeEnabled && (
                  <DevSettingsSection
                    hostPlatform={hostPlatform}
                    activeSubsection={devSettingsSubsection}
                    onSubsectionChange={handleDevSettingsSubsectionChange}
                    darkPalettePreview={darkPalettePreview}
                    onDarkPalettePreviewChange={handleDarkPalettePreviewChange}
                    dashboardAiUnavailablePreview={dashboardAiUnavailablePreview}
                    dashboardAiUnavailablePreviewCase={dashboardAiUnavailablePreviewCase}
                    sidebarCtaPreviewCase={sidebarCtaPreviewCase}
                    demoDashboardReplaySettings={demoDashboardReplaySettings}
                    projectPassRuns={projectClassification.passRuns}
                    enhancedContextSettings={effectiveEnhancedContextSettings}
                    forceBrowserHistoryUrlFallbackEnabled={forceBrowserHistoryUrlFallbackEnabled}
                    forceChromiumAxCaptureEnabled={forceChromiumAxCaptureEnabled}
                    forceChromiumAxExtremeNudgeEnabled={forceChromiumAxExtremeNudgeEnabled}
                    forceFrontmostFallbackCaptureEnabled={forceFrontmostFallbackCaptureEnabled}
                    aiAvailabilityGateDevDisabled={aiAvailabilityGateDevDisabled}
                    webAccountPreviewEnabled={devWebAccountPreviewEnabled}
                    projectClassificationAiReviewEvents={projectClassification.aiReviewEvents}
                    projectClassificationCorrectionsBusy={projectClassification.running}
                    petModeEnabled={petModeEnabled}
                    petModeFastRunEnabled={petModeFastRunEnabled}
                    petModeLabPointerStatus={petModeLabPointerStatus}
                    petModeLabInputBounds={petModeLabInputBounds}
                    petModeLabDpiEvents={petModeLabDpiEvents}
                    petModeNativeSyncDiagnostics={petModeNativeSyncDiagnostics}
                    floatingCompanionDevEnabled={floatingCompanionDevEnabled}
                    floatingCompanionDevSupported={floatingCompanionDevSupported}
                    onFloatingCompanionDevEnabledChange={handleFloatingCompanionDevEnabledChange}
                    onPreviewCompanionMilestone={previewCompanionMilestone}
                    onPreviewCompanionMoment={previewCompanionMoment}
                    onPreviewCompanionDayReview={handleEndOfDayReviewPreview}
                    preReleaseUpdateStatus={developerPreReleaseUpdateController.status}
                    preReleaseUpdateMessage={developerPreReleaseUpdateController.message}
                    preReleaseUpdateError={developerPreReleaseUpdateController.error}
                    preReleaseUpdateBusy={developerPreReleaseUpdateController.busy}
                    canInstallPreReleaseUpdate={developerPreReleaseUpdateController.canInstallPreReleaseUpdate}
                    onClearDashboardAiUnavailablePreview={clearDashboardAiUnavailablePreview}
                    onDashboardAiUnavailablePreviewCaseChange={setDashboardAiUnavailablePreviewCase}
                    onSidebarCtaPreviewCaseChange={setSidebarCtaPreviewCase}
                    onDemoDashboardReplayDurationSecondsChange={handleDemoDashboardReplayDurationSecondsChange}
                    onDemoDashboardReplayPreRollSecondsChange={handleDemoDashboardReplayPreRollSecondsChange}
                    onEnhancedContextDebugLoggingChange={handleEnhancedContextDebugLoggingChange}
                    onEnhancedContextSourceFamilyChange={handleEnhancedContextSourceFamilyChange}
                    onForceBrowserHistoryUrlFallbackChange={setForceBrowserHistoryUrlFallbackEnabled}
                    onForceChromiumAxCaptureChange={setForceChromiumAxCaptureEnabled}
                    onForceChromiumAxExtremeNudgeChange={setForceChromiumAxExtremeNudgeEnabled}
                    onForceFrontmostFallbackCaptureChange={setForceFrontmostFallbackCaptureEnabled}
                    onAiAvailabilityGateDevDisabledChange={setAiAvailabilityGateDevDisabled}
                    onWebAccountPreviewEnabledChange={setDevWebAccountPreviewEnabled}
                    onRevertProjectClassificationCorrection={(id) => void projectClassification.revertReviewEvent(id)}
                    onOpenDebugLogs={() => void handleOpenDebugLogs()}
                    onCheckLatestBuild={() => void developerPreReleaseUpdateController.checkLatestBuild()}
                    onInstallLatestBuild={() => void developerPreReleaseUpdateController.installLatestBuild()}
                    onOpenReplayOnboarding={() => void handleOpenDeveloperOnboarding()}
                    onReplayTutorial={replayPostOnboardingSidebarGuide}
                    onPetModeFastRunEnabledChange={setPetModeFastRunEnabled}
                    onPreviewPetModeIntervention={() => {
                      const target = buildPetModePreviewInterventionTarget(segments);
                      if (target) {
                        void playNativePetModeIntervention(target);
                        return;
                      }
                      void previewNativePetModeIntervention();
                    }}
                    onRehearsePetModeIntercept={() => {
                      // Shows exactly what a caught cat produces, without making the
                      // reviewer win the grab first. Same native surface the real
                      // interception hands off to, so this is the shipped card.
                      setPetModeLabPointerStatus("Showing the card a caught cat produces");
                      previewPetInterceptCard();
                    }}
                    onPreviewPetModeBrowserTabClose={() => {
                      void runPetModeLabBrowserTabClose();
                    }}
                    petModeBrowserXShortcutEnabled={petModeBrowserXShortcutEnabled}
                    onPetModeBrowserXShortcutEnabledChange={setPetModeBrowserXShortcutEnabled}
                    onPreviewPetModeDriftyWindowClose={() => {
                      const target = buildPetModeLabDriftyWindowTarget();
                      void playNativePetModeIntervention(target).then((intervention) => {
                        if (intervention.outcome === "contacted") return applyNativePetModeLabTarget(target);
                        return undefined;
                      }).catch(() => undefined);
                    }}
                    onPlacePetModeCenter={() => {
                      void placeNativePetModeAtCenterForLab().then((bounds) => {
                        if (bounds) {
                          setPetModeLabInputBounds(formatPetModeInputBounds(bounds));
                          setPetModeLabDpiEvents(bounds.windowsDpiEvents ?? null);
                        }
                      }).catch(() => undefined);
                    }}
                    onPreviewPetModeAction={(action) => {
                      void previewNativePetModeAction(action);
                    }}
                    petModeGuidesEnabled={petModeGuidesEnabled}
                    onTogglePetModeGuides={handleTogglePetModeGuides}
                    petModeFloorHomePt={petModeFloorHomePt}
                    onPetModeFloorHomePtChange={handlePetModeFloorHomePtChange}
                    teamsBetaEnabled={teamsBetaEnabled}
                    profileBetaEnabled={profileBetaEnabled}
                    agentsBetaEnabled={agentsBetaEnabled}
                    navigationRefreshEnabled={navigationRefreshEnabled}
                    breakdownPatternsPreviewEnabled={breakdownPatternsPreviewEnabled}
                    onTeamsBetaChange={setTeamsBetaEnabled}
                    onProfileBetaChange={setProfileBetaEnabled}
                    onAgentsBetaChange={setAgentsBetaEnabled}
                    onNavigationRefreshChange={setNavigationRefreshEnabled}
                    dailyRecordPreviewEnabled={dailyRecordPreviewEnabled}
                    onDailyRecordPreviewChange={setDailyRecordPreviewEnabled}
                    onBreakdownPatternsPreviewChange={setBreakdownPatternsPreviewEnabled}
                    onPreviewDashboardAiUnavailableCase={previewDashboardAiUnavailableCase}
                    onReplayDashboardDemo={handleStartDashboardDemoReplay}
                    onResetDemoDashboardReplaySettings={handleResetDemoDashboardReplaySettings}
                  />
                )}
            </SettingsSearchDestination>
            </ProLooksProvider>
          </div>
        ) : null}
        </Suspense>
      </MainContentShell>

      {!isTauriRuntime() ? (
        <>
          {DayNoteMomentPreview && dayNotePreview?.place === "moment" ? (
            <Suspense fallback={null}><DayNoteMomentPreview onConnect={openAiSetupSettings} /></Suspense>
          ) : null}
          {END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED && endOfDayReviewEvent ? (
            <CompanionDayReviewBrowserSurface
              event={endOfDayReviewEvent}
              onOpenDashboard={() => handleEndOfDayReviewAction("openDashboard")}
              onOpenAiSettings={() => handleEndOfDayReviewAction("openAiSettings")}
              onDismiss={() => setEndOfDayReviewEvent(null)}
            />
          ) : null}
          {driftAlarmEvent ? (
            <div className="companion-drift-alarm-browser-surface">
              <CompanionDriftAlarmCard
                event={driftAlarmEvent}
                onAction={handleDriftAlarmAction}
                onDismiss={cancelDriftAlarm}
                onOpenDashboard={() => returnToFocusTarget(null)}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {/* Command Bar */}
      <ModalPresence>{cmdOpen ? (
        <CommandBar
          includeProjects={projectClassificationFeatureEnabled}
          navigationRefreshEnabled={canUseNavigationRefresh}
          onDismiss={() => setCmdOpen(false)}
          onNavigate={handleCmdNav}
          onToggleTracking={() => {
            void (status?.running && !isTrackerDegraded ? handleStopTracking() : handleStartTracking());
            setCmdOpen(false);
          }}
          isTrackingRunning={Boolean(status?.running && !isTrackerDegraded)}
          onToggleTheme={() => {
            toggleTheme();
            setCmdOpen(false);
          }}
          onOpenAiSettings={() => {
            openAiSetupSettings();
            setCmdOpen(false);
          }}
          onNewProject={() => {
            setNewProjectRequested(true);
            handleCmdNav("projects");
          }}
          onReclassifyRecent={() => {
            handleCmdNav("classification");
          }}
        />
      ) : null}</ModalPresence>

      <ModalPresence>{authModalOpen ? <AuthModal intent={authModalIntent} onClose={handleCloseAuthModal} showGoogleSignIn={authModalShowsGoogle} /> : null}</ModalPresence>
      <ModalPresence>{promoHandoffAccountDialog}</ModalPresence>

      <ProDecisionSheet
        open={shouldRenderUpgradePlanModal}
        context={upgradeSheetContext}
        look={upgradeSheetLook}
        looksIncludeAppIcons={hostPlatform === "macos"}
        funnelEnabled={funnelEnabled}
        offerSurface={trialEndSheetAuto ? "trial_end_sheet" : "upgrade_modal"}
        trialEndsAt={upgradeSheetEntitlement?.trialEndsAt ?? null}
        trialEndedToday={trialEndedWithinToday(upgradeSheetEntitlement?.trialEndsAt)}
        unclassifiedSeconds={upgradeSheetContext === "trial-ended" ? unclassifiedTodaySeconds : null}
        billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
        billingPlansDisabled={billingCheckoutAwaitingConfirmation || billingEntitlementLoading || individualPricingQuoteLoading || isSidebarCtaPreviewActive}
        individualPricingQuote={individualPricingQuote}
        billingActionError={billingActionError}
        billingActionErrorCode={billingActionErrorCode}
        onCheckForUpdates={handleManualCheckForUpdates}
        onSelectBillingPlan={(billingInterval) => {
          if (isSidebarCtaPreviewActive) return;
          void startCloudCheckout(billingInterval);
        }}
        onDismiss={() => {
          if (trialEndSheetAuto && funnelEnabled) {
            void recordProFunnelStep({ step: "pro_offer_acted", offer_surface: "trial_end_sheet", offer_context: "trial_ended", offer_action: "dismiss" });
          }
          // Closing the sheet after a trial ended ends that day's follow-up, however it was opened.
          if (trialEndFollowUpKey !== null) markTrialEndSheetSeen();
          setUpgradePlanModalOpen(false);
        }}
      />

      <ModalPresence>{accountDeletionModalOpen ? (
        <AccountDeletionModal
          accountEmail={user?.email ?? null}
          isAnonymousAccount={user?.is_anonymous === true}
          onClose={() => setAccountDeletionModalOpen(false)}
          onDelete={handleDeleteAccount}
        />
      ) : null}</ModalPresence>

      <ModalPresence>{feedbackModalOpen ? (
        <Suspense fallback={null}>
          <LazyFeedbackModal initialEmail={user?.email ?? ""} onClose={() => setFeedbackModalOpen(false)} />
        </Suspense>
      ) : null}</ModalPresence>
      <ModalPresence>{whatsNewOpen ? (
        <WhatsNewDialog
          entries={whatsNewEntries}
          status={whatsNewChangelog.status}
          onRetry={whatsNewChangelog.retry}
          onClose={() => setWhatsNewOpen(false)}
        />
      ) : null}</ModalPresence>
      <ModalPresence>{deleteHistoryModalOpen ? (
        <DeleteHistoryModal
          onClose={() => setDeleteHistoryModalOpen(false)}
          onDeleted={handleHistoryRangeDeleted}
          onCompleted={(result) => { setHistoryDeletionResult(result); setDeleteHistoryModalOpen(false); }}
          deviceSyncEnabled={deviceSyncActive}
        />
      ) : null}</ModalPresence>

      <ModalPresence>{deviceSyncPurgeConfirmOpen ? (
        <DeviceSyncPurgeConfirmation
          onCancel={cancelPurgeDeviceSyncData}
          onConfirm={confirmPurgeDeviceSyncData}
        />
      ) : null}</ModalPresence>

      <ModalPresence>{debugLogPreview ? (
        <Suspense fallback={null}>
          <LazyDebugLogModal
            text={debugLogPreview.text}
            note={`Generated ${new Date(debugLogPreview.exportedAt).toLocaleTimeString()} · v${BUILD_INFO.version}`}
            onClose={() => setDebugLogPreview(null)}
            onCopy={() => void handleCopyDebugLogs()}
            onDownload={handleDownloadDebugLogs}
          />
        </Suspense>
      ) : null}</ModalPresence>


      <ProfileDialogs
        avatarUrl={profileDraft.avatarUrl}
        displayName={leaderboardProfileDisplayName}
        isProfileEditorOpen={isProfileEditorOpen}
        leaderboardRows={leaderboardRows}
        profileDraft={profileDraft}
        profileError={profileError}
        profileLoading={profileLoading}
        profileMessage={profileMessage}
        profileSaving={profileSaving}
        publicId={profile?.public_id ?? null}
        selectedLeaderboardRow={selectedLeaderboardRow}
        selectedProfileError={selectedProfileError}
        selectedProfileLoading={selectedProfileLoading}
        selectedPublicProfile={selectedPublicProfile}
        onCloseEditor={closeProfileEditor}
        onCloseSelectedProfile={closeSelectedProfile}
        onDraftChange={updateProfileDraft}
        onPhotoSelected={(event) => void handleProfilePhotoSelected(event)}
        onRemovePhoto={removeProfilePhoto}
        onSaveProfile={() => void handleSaveProfileFromModal()}
      />

      {availableUpdatePrompt}

      {latestBuildPrompt}

    </div>
    </SettingsSearchProvider>
    </LocalizationProvider>
      </SiteIconProvider>
  );
}
