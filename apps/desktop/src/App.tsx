import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationMetrics, ClassificationOptions, ClassificationRuleInput, CurrentActivitySnapshot, DeviceTimelineFilter, DriftAlarmTrayStatus, FlowIntervalMinutes, HourBucket, ProductivityShareMix, ProjectAssignmentRecord, ProjectWindowAssignmentRecord, SiteDuration, TimelinePageCursor, TrackerStatus } from "@drifty/domain";
import {
  buildAppUsageSummaries,
  buildFlowBlocksForIntervals,
  filterSegmentsByDevice,
  buildRollingFocusSeconds,
  buildCategoryDurations,
  buildProductivityDurations,
  buildEffectiveProductivityDurations,
  classifyActivity,
  buildDailyTotals,
  buildDayRibbonSegments,
  buildHourlySummary,
  buildProductivityPersona,
  buildPersonalProjectSliceProjection,
  logicalDayIsoDateForDate,
  shiftIsoDate,
  todayIsoDate,
  totalDurationSeconds,
} from "@drifty/domain";
import logoUrl from "./assets/drifty-mark.svg";
import {
  resolveDashboardAiUnavailableState,
  isCloudBillingVariant,
} from "./features/dashboard/dashboardAiUnavailableState";
import {
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
import { fetchOwnLeaderboardCheckpoint } from "./features/leaderboard/leaderboardService";
import type { SocialSection } from "./features/social/SocialPage";
import { useFocusCard } from "./features/share/useFocusCard";
import { useAccountStatsPublisher } from "./features/account-stats/useAccountStatsPublisher";
import { useDailyProductivitySeries } from "./features/share/dailyProductivity";
import { isTeamQaMockEnabled, useTeamQaMockController } from "./features/team/teamQaMock";
import type { TeamWorkspaceAction } from "./features/team/TeamWorkspace";
import { useTeamController } from "./features/team/useTeamController";
import type { TeamProjectsSubView } from "./features/team/useTeamProjects";
import { TEAM_INVITE_DEEP_LINK_EVENT, readPendingTeamInviteFromEvent, type PendingTeamInvite } from "./features/team/teamInviteDeepLinks";
import { HISTORY_TIMELINE_PAGE_SIZE, mergeHistoryTimelinePages } from "./features/history/historyPagination";
import { AiConnectionStatusBar, resolveAiConnectionStatus } from "./features/ai-connection/AiConnectionStatusBar";
import { SidebarCtaSlot, resolveSidebarCtaSlot } from "./features/sidebar/SidebarCtaSlot";
import { UpgradePlanModal } from "./features/billing/UpgradePlanModal";
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
  aiConnectionIssueKindFromMessage,
  isEstablishedCloudAiDisconnect,
  nextCloudAiConnectionCheck,
  type CloudAiConnectionCheck,
} from "./features/ai-connection/aiConnectionHealth";
import { appIconIdentityKey, collectMissingAppIconRequests, mergeAppIconResults, type AppIconLoadRequest } from "./features/app-icons/appIconRequests";
import { collectMissingSiteIconRequests, mergeSiteIconResults, normalizeSiteIconDomain, type SiteIconMap } from "./features/app-icons/siteIconRequests";
import { SiteIconProvider } from "./components/SiteIconContext";
import { AI_CLASSIFICATION_BACKGROUND_THRESHOLD, AI_CLASSIFICATION_FOCUSED_IDLE_MS, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD, classifyLiveActivityWithAi, clearCloudAiRequestBackoff, describeAiClassificationFailure, diffAiClassificationUsageSummary, projectAiClassificationCost, runAiClassification, runAiClassificationForUnknownThreshold, runAiClassificationUntilEmpty, toClassificationQueryForDay, type AiClassificationSummary, type AiClassificationUsageSummary } from "./features/classification/aiClassificationService";
import { useClassificationActivity } from "./features/classification/classificationActivity";
import { materializeBuiltInHeuristicClassifications, scheduleBuiltInHeuristicClassificationPersistence, type BuiltInHeuristicClassificationMaterialization } from "./features/classification/heuristicClassificationMaterialization";
import { useClassificationRulesController } from "./features/classification/useClassificationRulesController";
import { AvailableUpdateDialog } from "./features/updates/AvailableUpdateDialog";
import { TopbarUpdateButton } from "./features/updates/TopbarUpdateButton";
import { useUpdateController } from "./features/updates/useUpdateController";
import { consumePostUpdateRelaunchFocusPending, fallbackUpdatePolicy } from "./features/updates/updatePolicy";
import { useDeveloperPreReleaseUpdateController } from "./features/updates/useDeveloperPreReleaseUpdateController";
import { AppStatusNotice, buildLatestBuildStatusNotice, buildManualUpdateStatusNotice } from "./features/updates/AppUpdateStatusNotice";
import { trackerClient } from "./lib/api/trackerClient";
import { accessibilityClient } from "./lib/api/accessibilityClient";
import type { HostPlatform } from "./lib/api/accessibilityClient";
import { shouldUsePreviewData } from "./lib/api/previewData";
import { setMainWindowNativeBlur, setMainWindowThemeAppearance, setOnboardingWindowPresentation } from "./lib/api/windowChromeClient";
import {
  capturePostHogEvent,
  toAnalyticsErrorKind,
} from "./lib/analytics/posthogClient";
import { cleanupTauriEventListener } from "./lib/tauriEventCleanup";
import { DEV_SETTINGS_ENABLED, END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED, END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED, isDevOnboardingBypassEnabled, isDevOnboardingForceOpenEnabled } from "./appFeatureSwitches";
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
import { AccountDeletionModal } from "./features/auth/AccountDeletionModal";
import { deleteDriftyAccount, type AccountDeletionResult } from "./features/auth/accountDeletionService";
import { hideBootShell } from "./features/loading/bootShell";
import { BUILD_INFO } from "./buildInfo";
import { AccountSettingsSection } from "./features/settings/AccountSettingsSection";
import { AppearanceSettingsSection } from "./features/settings/AppearanceSettingsSection";
import { ClassificationSettingsSection } from "./features/settings/ClassificationSettingsSection";
import { DevSettingsSection } from "./features/settings/DevSettingsSection";
import { DeveloperSettingsSection } from "./features/settings/DeveloperSettingsSection";
import { GeneralSettingsSection } from "./features/settings/GeneralSettingsSection";
import type { AppThemeColorKey } from "./features/settings/SettingsColorControls";
import { NotificationsSettingsSection } from "./features/settings/NotificationsSettingsSection";
import { PermissionsSettingsSection } from "./features/settings/PermissionsSettingsSection";
import { SettingsSidebar, type SettingsSection } from "./features/settings/SettingsSidebar";
import { analysisModelDisplayLabel } from "./features/settings/analysisModelSetup";
import {
  AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT,
  readAiPrivacyRequestSettings,
} from "./features/settings/aiPrivacyRequestSettings";
import { useAnalysisModelSetup } from "./features/settings/useAnalysisModelSetup";
import { useProjectClassification } from "./features/classification/useProjectClassification";
import { CommandBar } from "./features/command-bar/CommandBar";
import { NO_PROJECT_COLOR, NO_PROJECT_LABEL as FLOW_NO_PROJECT_LABEL, projectColorMap, type ProjectLegendEntry } from "./features/flow-chart/projectFlowView";
import {
  DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES,
  persistDashboardFlowIntervalMinutes,
  resolveInitialDashboardFlowIntervalMinutes,
} from "./features/flow-chart/flowChartDetailPreference";

const PROJECT_PASS_CONSENT_STORAGE_KEY = "drifty.projectPass.consent.v1";
import { buildDebugLogPayload, readRecentEnhancedContextDebugEvents } from "./features/settings/debugLog";
import { readContextualGuardAuditEvents } from "./features/classification/contextualGuardAuditLog";
import {
  OnboardingModal,
  hasCompletedUserOnboarding,
  readUserOnboardingState,
  type UserOnboardingState,
} from "./features/onboarding/OnboardingModal";
import { FirstDayPreparationScreen, type FirstDayPreparationPhase } from "./features/onboarding/FirstDayPreparationScreen";
import { isInitialDailyFocusQuietPeriod, isInstallDayReviewEligible } from "./features/onboarding/initialExperiencePolicy";
import { useFirstDayPreparation } from "./features/onboarding/useFirstDayPreparation";
import {
  WatcherPeek,
  type WatcherPeekEvent,
  type WatcherPeekResponse,
} from "./features/companion/WatcherPeek";
import {
  buildCompanionMilestonePreview,
  type CompanionMilestonePreviewId,
  buildCompanionDriftAlarmPreview,
  buildCompanionExtremeNudgePreview,
  buildCompanionReentryPreview,
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
import {
  EndOfDayReview,
  buildEndOfDayReviewSummary,
  type EndOfDayReviewEvent,
} from "./features/companion/EndOfDayReview";
import {
  buildBreakReturnAlarmEvent,
  buildDriftAlarmEvent,
  type DriftAlarmAction,
  type DriftAlarmEvent,
  type DriftAlarmFocusTarget,
} from "./features/companion/driftAlarmEvent";
import { CompanionDriftAlarmCard } from "./features/companion/CompanionDriftAlarmCard";
import {
  hideNativeWatcherPeek,
  isTauriRuntime,
  listenToNativeCompanionVisibilityAction,
  listenToNativeEndOfDayReviewAction,
  listenToNativeEndOfDayReviewDisplayed,
  listenToNativeWatcherDismissed,
  listenToNativeWatcherResponse,
  setNativeCompanionSurfacePolicy,
  showNativeCompanionDriftAlarm,
  showNativeCompanionMilestone,
  showNativeCompanionReentry,
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
import { evaluateYouTubeDriftAlarmGate } from "./features/companion/youtubeDriftAlarmGate";
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
import {
  CloudTrialStartedNotice,
} from "./features/billing/CloudTrialStartedNotice";
import { useCloudBillingController } from "./features/billing/useCloudBillingController";
import { useDeviceSyncController } from "./features/device-sync/useDeviceSyncController";
import { fetchSyncDevices, purgeCloudSyncData, resumeCloudSyncData } from "./features/device-sync/deviceSyncApi";
import { resetAccountSyncIdentity } from "./features/device-sync/accountDeletionSyncReset";
import {
  clearDeviceSyncCycleRecordsForUser,
  clearPendingDeviceSyncAccountReset,
  hasPendingDeviceSyncAccountReset,
  markDeviceSyncAccountResetPending,
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
import { DeleteHistoryModal } from "./features/settings/DeleteHistoryModal";
import { PrivacySettingsSection } from "./features/settings/PrivacySettingsSection";
import { getAuthMetadataAvatarUrl } from "./features/auth/accountDisplay";
import { buildClassificationActivityRows, buildClassificationCategoryBreakdowns, buildClassificationSourceSummaries, classifySegmentSourceKey, classifySourceKey } from "./features/classification/classificationViewData";
import { buildDriftAlarmCandidates, buildExtremeNudgeTarget, buildExtremeNudgeToastEvent, activateFocusTargetSite, buildRecentFocusTargets, canApplyExtremeNudgeToCategory, hasDriftAlarmFocusTargetUpdate } from "./features/companion/driftAlarmData";
import type { DriftAlarmCandidate } from "./features/companion/driftAlarmData";
import { filterDefinitelyAvailableFocusTargets, haveSameDriftAlarmFocusTargets, resolveAvailableFocusTargets } from "./features/companion/driftAlarmFocusTargetAvailability";
import { buildDriftAlarmCandidateProbe } from "./features/companion/driftAlarmCandidateProbe";
import { buildDriftAlarmDebugEvaluationSummary, readRecentDriftAlarmDebugEvents, recordDriftAlarmDebugEvent, summarizeDriftAlarmCandidate, summarizeDriftAlarmEvent, summarizeDriftAlarmSegment, summarizeDriftAlarmSnapshot, summarizeDriftAlarmTrayResult, summarizeLiveAiClassificationResult, summarizeYouTubeDriftAlarmGateResult } from "./features/companion/driftAlarmDebugLog";
import { buildDriftAlarmTrayCandidateDetail, buildDriftAlarmTrayStatus, type DriftAlarmTrayResult } from "./features/companion/driftAlarmTrayStatus";
import { resolveFreshDriftAlarmCandidate } from "./features/companion/driftAlarmFreshCandidate";
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
  persistPetModeHiddenUntil,
  resolveInitialPetModeHiddenUntil,
} from "./features/pet-mode/petModeData";
import {
  applyNativePetModeLabTarget,
  getNativePetInputBounds,
  listenToNativePetAlignment,
  listenToNativePetPointer,
  listenToNativePetVisibilityAction,
  placeNativePetModeAtCenterForLab,
  playNativePetModeIntervention,
  previewNativePetModeAction,
  previewNativePetModeIntervention,
  setNativePetModeEnabled,
  setNativePetModeGuides,
  updateNativePetMode,
  type PetVisibilityAction,
} from "./features/pet-mode/petModeBridge";
import { usePetModeVisibilityRequests } from "./features/pet-mode/usePetModeVisibilityRequests";
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
import { useCompanionReentryMoment } from "./features/companion/useCompanionReentryMoment";
import { buildBreakRecoveryAttempt, buildBreakRecoveryInsight, buildBreakSnooze, readDriftAlarmInteractions, recordDriftAlarmInteraction, resolveBreakRecoveryOutcome } from "./features/companion/driftAlarmRecovery";
import type { BreakRecoveryOutcome, DriftAlarmBreakSnooze, DriftAlarmInteraction } from "./features/companion/driftAlarmRecovery";
import { END_OF_DAY_LEADERBOARD_CHECKPOINT_STORAGE_KEY, END_OF_DAY_REVIEW_MIN_TRACKED_SECONDS, END_OF_DAY_REVIEW_REPRESENT_COOLDOWN_MS, END_OF_DAY_REVIEW_STORAGE_KEY, END_OF_DAY_REVIEW_TRIGGER_MINUTE, buildMockEndOfDayReviewSegments, collectMissingEndOfDayReviewIconRequests, mergeResolvedAppIcons, sumEndOfDayReviewTrackedSeconds } from "./features/companion/endOfDayReviewData";
import type { EndOfDayReviewSummaryInput } from "./features/companion/endOfDayReviewData";
import { WATCHER_INITIAL_PEEK_DELAY_MS, WATCHER_STALE_EVENT_RECOVERY_MS, buildWatcherSnapshot, buildWatcherSnapshotFromCurrent, getDefaultWatcherSnapshot, getWatcherContextLabel, getWatcherScheduleDelayMs, persistWatcherResponse, resolveWatcherSnapshot, sendDriftNotification, showDueDriftWatcherPeek } from "./features/companion/watcherData";
import type { DriftReminderState, WatcherSnapshot } from "./features/companion/watcherData";
import { getDashboardCurrentPeriodLabel, getDashboardPeriodRange, getInsightPeriodRange, getSafeClassificationNavigationDay, shiftDashboardPeriodDay, shiftInsightPeriodDay } from "./features/dashboard/dashboardPeriods";
import type { ClassificationRange, InsightRange } from "./features/dashboard/dashboardPeriods";
import { buildActivityRefreshPlan } from "./features/dashboard/activityRefreshPlan";
import { buildQuarterHourDayField } from "./features/dashboard/dayField";
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
import { buildAttentionRhythm, buildInsightSourceLists, buildWeeklyBreakdown, NO_PROJECT_KEY, NO_PROJECT_LABEL, type WeeklyChartMode } from "./features/insights/insightData";
import { selectInsightSegments } from "./features/insights/insightSegments";
import { useAiSetupController } from "./features/settings/useAiSetupController";
import { useManagedLocalModelAttach } from "./features/settings/useManagedLocalModelAttach";
import { useManagedLocalAiStatusObserver } from "./features/settings/useManagedLocalAiStatusObserver";
import type { ManagedLocalAiStatus } from "./features/settings/managedLocalAiClient";
import { isManagedLocalAiRoute } from "./features/settings/localAiSetup";
import { LocalizationProvider, useLocalizationController } from "./features/localization/LocalizationContext";
import { AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY, APP_THEME_COLOR_OPTIONS, APP_THEME_COLOR_STORAGE_KEY, CATEGORY_COLOR_OPTIONS, CATEGORY_COLOR_STORAGE_KEY, FLOATING_COMPANION_DEV_STORAGE_KEY, DEV_MODE_STORAGE_KEY, DEVICE_SYNC_PREVIEW_STORAGE_KEY, WEB_ACCOUNT_PREVIEW_STORAGE_KEY, TEAMS_BETA_STORAGE_KEY, PROFILE_BETA_STORAGE_KEY, AGENTS_BETA_STORAGE_KEY, LEGACY_SHELL_BLUR_PREVIEW_STORAGE_KEY, FORCE_BROWSER_HISTORY_URL_FALLBACK_STORAGE_KEY, FORCE_CHROMIUM_AX_CAPTURE_STORAGE_KEY, FORCE_CHROMIUM_AX_EXTREME_NUDGE_STORAGE_KEY, FORCE_FRONTMOST_FALLBACK_CAPTURE_STORAGE_KEY, SIDEBAR_COLLAPSED_STORAGE_KEY, START_OF_DAY_STORAGE_KEY, START_OF_WEEK_STORAGE_KEY, THEME_STORAGE_KEY, hourlyStartOfDayValueToMinutes, isHexColor, minutesToHourlyStartOfDayValue, persistDemoDashboardReplaySettings, persistDeviceSyncEnabled, resetDemoDashboardReplaySettings, resolveDeviceSyncEnabled, resolveInitialAiClassificationVisibility, resolveInitialAppThemeColorOverrides, resolveInitialCategoryColorOverrides, resolveInitialFloatingCompanionDevEnabled, resolveInitialDemoDashboardReplaySettings, resolveInitialDevModeEnabled, resolveInitialDeviceSyncPreviewEnabled, resolveInitialWebAccountPreviewEnabled, resolveInitialTeamsBetaEnabled, resolveInitialProfileBetaEnabled, resolveInitialAgentsBetaEnabled, resolveInitialLegacyShellBlurPreviewEnabled, resolveInitialForceBrowserHistoryUrlFallbackEnabled, resolveInitialForceChromiumAxCaptureEnabled, resolveInitialForceChromiumAxExtremeNudgeEnabled, resolveInitialForceFrontmostFallbackCaptureEnabled, resolveInitialSidebarCollapsed, resolveInitialStartOfDayMinutes, resolveInitialStartOfWeek, resolveInitialTheme, retireLegacyDeviceSyncEnabledPreference , LEGACY_DEVICE_SYNC_ENABLED_STORAGE_KEY} from "./features/settings/settingsStorage";
import { ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS, persistEnhancedContextSettings, resolveEffectiveEnhancedContextSettings, resolveInitialEnhancedContextSettings } from "./features/settings/settingsStorage";
import type { AppThemeColorOverrides, CategoryColorOverrides, DemoDashboardReplaySettings, EnhancedContextSettings, EnhancedContextSourceFamily, StartOfWeek, ThemeMode } from "./features/settings/settingsStorage";
import { CATEGORY_COLORS, categoryLabel, productivityLabel } from "./lib/activityLabels";
import { describeRelativeDay, filterSegmentsForRange, formatCompactDurationFromSeconds, formatDateRangeLabel, formatDayLabel, formatDuration, formatQuarterHourLabel, formatRelativeTime, formatTimeLabel, getLogicalDayRange, isoDateFromTimestamp, localDateKey, logicalTodayIsoDate, toErrorMessage } from "./lib/formatting";
import { DateNavigator } from "./components/DateNavigator";
import { MainContentShell, NavIcon, WindowThemeToggle } from "./app/AppShell";
import { activityNav, dashboardPeriodOptions, type NavigationHistoryState, type TabId } from "./app/navigation";
import { useFeatureNewBadges } from "./features/discovery/useFeatureNewBadges";
import {
  captureAiClassificationRun,
  toAiProviderAnalytics,
  toAppSurfaceAnalytics,
  toDashboardPeriodAnalytics,
  toScheduledProjectPassAnalytics,
  toTrackerModeAnalytics,
} from "./app/appAnalytics";
import { aiServerStatusLabelForCloud, driftyCloudStatusLabel, hasAiClassificationUsageMeasurement } from "./features/ai-connection/aiStatusLabels";
import { AccountMenu } from "./features/auth/AccountMenu";
import { AuthConfigurationGate, AuthLoadingGate, AuthRequiredGate } from "./features/auth/AuthGates";
import type { ClassificationPanelStyle } from "./features/classification/ClassificationBreakdownCards";
import { FocusDriftSection, FocusDriftSummaryTiles } from "./features/dashboard/FocusDriftSection";
import type { TimelineHoverState } from "./features/dashboard/HoverCards";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { useStickyDuringLoad } from "./features/dashboard/useStickyDuringLoad";
import type { CompactRingEntry } from "./features/dashboard/CompactRingChart";
import { selectDashboardSegments, type DashboardHistoryRange, type DashboardSegmentSource } from "./features/dashboard/dashboardWeekData";
import { DASHBOARD_PREVIOUS_WEEK_FOCUS_DELAY_MS, resolveAppRefreshTickAction, resolveDashboardRefreshMode, shouldRefreshHistoryData, type DashboardPreviousWeekFocusLoad, type DashboardRefreshInputs, type DashboardWeekRefreshState, type DashboardWeekRefreshStatus } from "./features/dashboard/dashboardRefreshPolicy";
import { DeferredTabBodyFallback } from "./features/loading/DeferredTabBodyFallback";
import { DeferredPageImportFallback } from "./features/loading/DeferredPageImportFallback";
import { TrendsPage } from "./features/insights/TrendsPage";
import { ProfileDialogs } from "./features/profile/ProfileDialogs";
import { copyTextToClipboard } from "./features/profile/ProfileModals";
import { useDeferredTabBodyReady } from "./app/useDeferredTabBodyReady";
import { buildClassificationCorrectionDraft, buildClassificationCorrectionRecord, type ClassificationCorrectionDraft, type ClassificationCorrectionNotice, type ClassificationCorrectionScope } from "./features/classification/classificationCorrection";
import { captureCorrectionEvidence } from "./features/classification/correctionEvidence";
import { learnLivingSoulFromFeedback, type SoulLearningProvider } from "./features/classification/soulLearning";
import type { LocalAiClassificationOptions } from "./features/settings/localAiClassificationOptions";
import { compactHistoryRangeContains, compactHistoryRangeKey, findFreshCompactHistoryLoad, pruneStaleCompactHistoryLoads, type CompactHistoryLoad, type CompactHistoryRange } from "./features/dashboard/compactHistoryCache";
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
const AUTO_UPDATE_CHECK_DELAY_MS = 2500;
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
// Heavy project pass cadence: hourly keeps "today" fresh without the cost/churn
// of finer cadences. Eval-cadence experiment (2026-07-10): 15m ≈ 3.7× the cost
// and ~13× the mid-day assignment revisions of 60m for no end-of-day accuracy
// gain, so 60m is the efficient pick.
const PROJECT_PASS_SCHEDULE_INTERVAL_MS = 60 * 60 * 1000;
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

function managedLocalAiTopbarLabel(status: ManagedLocalAiStatus | null): string | null {
  if (status?.state !== "error") return null;

  switch (status.errorKind) {
    case "download_failed":
      return "Download failed";
    case "model_artifact_missing":
      return "Model missing";
    case "insufficient_memory":
      return "Memory needed";
    case "insufficient_storage":
      return "Storage needed";
    case "runtime_missing":
      return "Runtime missing";
    case "runtime_failed":
      return "Start failed";
    case null:
      return "Issue";
    default:
      return assertNever(status.errorKind);
  }
}

export default function App() {
  const localization = useLocalizationController();
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
  const autoUpdateLaunchCheckScheduledRef = useRef(false);
  const previousSurfaceAnalyticsKeyRef = useRef<string | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryState>({ entries: [{ tabId: "dashboard", dashPeriod: "Today" }], index: 0 });
  const activeSnapshot = navigationHistory.entries[navigationHistory.index] ?? { tabId: "dashboard", dashPeriod: "Today" };
  const rawActiveTab = activeSnapshot.tabId;
  const activeTab = rawActiveTab === "profile" ? "leaderboard" : rawActiveTab;
  const socialSection: SocialSection = rawActiveTab === "profile" ? "profile" : "leaderboard";
  const dashPeriod = activeSnapshot.dashPeriod;
  const isDeferredTabBodyReady = useDeferredTabBodyReady(activeTab);
  const canNavigateBack = navigationHistory.index > 0;
  const canNavigateForward = navigationHistory.index < navigationHistory.entries.length - 1;
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme);
  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(resolveInitialSidebarCollapsed);
  const [selectedDay, setSelectedDay] = useState(() => logicalTodayIsoDate(resolveInitialStartOfDayMinutes()));
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [trackerPausePending, setTrackerPausePending] = useState(false);
  const hasTrackerStatus = status !== null;
  const [brandCaptureMotionKey, setBrandCaptureMotionKey] = useState(0);
  const triggerBrandCaptureMotion = useCallback(() => {
    setBrandCaptureMotionKey((currentKey) => currentKey + 1);
  }, []);
  const brandCaptureEventAtRef = useRef<string | null>(null);
  const hasObservedBrandCaptureRef = useRef(false);
  const [hostPlatform, setHostPlatform] = useState<HostPlatform>(accessibilityClient.detectHostPlatform);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [accessibilityRequired, setAccessibilityRequired] = useState(hostPlatform !== "windows");
  const [currentSnapshot, setCurrentSnapshot] = useState<CurrentActivitySnapshot | null>(null);
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [segmentsLoadedDay, setSegmentsLoadedDay] = useState<string | null>(null);
  const [historySegments, setHistorySegments] = useState<ActivitySegment[]>([]);
  const [historySegmentsLoadedRange, setHistorySegmentsLoadedRange] = useState<DashboardHistoryRange | null>(null);
  const [historyNextCursor, setHistoryNextCursor] = useState<TimelinePageCursor | null>(null);
  const [historyHasMoreSegments, setHistoryHasMoreSegments] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyLoadMoreError, setHistoryLoadMoreError] = useState<string | null>(null);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historySearchSegments, setHistorySearchSegments] = useState<ActivitySegment[]>([]);
  const [historySearchNextCursor, setHistorySearchNextCursor] = useState<TimelinePageCursor | null>(null);
  const [historySearchHasMoreSegments, setHistorySearchHasMoreSegments] = useState(false);
  const [historySearchLoading, setHistorySearchLoading] = useState(false);
  const [historySearchError, setHistorySearchError] = useState<string | null>(null);
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
  const [flowIntervalMinutes, setFlowIntervalMinutes] = useState<FlowIntervalMinutes>(resolveInitialDashboardFlowIntervalMinutes);
  const handleFlowIntervalChange = useCallback((intervalMinutes: FlowIntervalMinutes) => {
    setFlowIntervalMinutes(persistDashboardFlowIntervalMinutes(intervalMinutes));
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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const {
    autoInstallFutureUpdates,
    availableUpdate,
    currentUpdatePolicy,
    dismissAvailableUpdate,
    handleCheckForUpdates,
    handleInstallUpdate,
    setAutoInstallFutureUpdates,
    shouldShowAvailableUpdateDialog,
    updaterChecking,
    updaterError,
    updaterInstalling,
    updaterMessage,
  } = useUpdateController();
  const developerPreReleaseUpdateController = useDeveloperPreReleaseUpdateController();
  const [manualUpdateNoticeVisible, setManualUpdateNoticeVisible] = useState(false);
  const [latestBuildNoticeVisible, setLatestBuildNoticeVisible] = useState(false);
  const [devModeEnabled, setDevModeEnabled] = useState(
    () => isDevOnboardingBypassEnabled() || resolveInitialDevModeEnabled(),
  );
  const [teamsBetaEnabled, setTeamsBetaEnabled] = useState(resolveInitialTeamsBetaEnabled);
  const [profileBetaEnabled, setProfileBetaEnabled] = useState(resolveInitialProfileBetaEnabled);
  const [agentsBetaEnabled, setAgentsBetaEnabled] = useState(resolveInitialAgentsBetaEnabled);
  const [legacyShellBlurPreviewEnabled, setLegacyShellBlurPreviewEnabled] = useState(resolveInitialLegacyShellBlurPreviewEnabled);
  const [floatingCompanionDevEnabled, setFloatingCompanionDevEnabled] = useState(resolveInitialFloatingCompanionDevEnabled);
  const [teamSubView, setTeamSubView] = useState<TeamProjectsSubView>("dashboards");
  const [pendingTeamInvite, setPendingTeamInvite] = useState<PendingTeamInvite | null>(null);
  const [pendingTeamAction, setPendingTeamAction] = useState<TeamWorkspaceAction | null>(null);
  const [teamNavMenuOpen, setTeamNavMenuOpen] = useState(false);
  // Viewport coordinates for the fixed team-options popover (opens to the right
  // of the rail so it never joins the sidebar scroll area or hides the foot).
  const [teamNavMenuPos, setTeamNavMenuPos] = useState<{ readonly left: number; readonly top: number } | null>(null);
  // undefined = follow the selected team (auto-expanded); null = user collapsed it.
  const [teamNavExpandedId, setTeamNavExpandedId] = useState<string | null | undefined>(undefined);
  const isDevModeActive = DEV_SETTINGS_ENABLED && devModeEnabled;
  const [enhancedContextSettings, setEnhancedContextSettings] = useState<EnhancedContextSettings>(resolveInitialEnhancedContextSettings);
  const effectiveEnhancedContextSettings = resolveEffectiveEnhancedContextSettings(isDevModeActive, enhancedContextSettings);
  const canOpenTeamsBeta = (devModeEnabled && teamsBetaEnabled) || isTeamQaMockEnabled();
  const canOpenProfileBeta = DEV_SETTINGS_ENABLED && devModeEnabled && profileBetaEnabled;
  const canOpenAgentsBeta = DEV_SETTINGS_ENABLED && devModeEnabled && agentsBetaEnabled;
  const [companionSurfacePolicy, setCompanionSurfacePolicy] = useState(resolveInitialCompanionSurfacePolicy);
  const [companionHiddenUntil, setCompanionHiddenUntil] = useState(resolveInitialCompanionHiddenUntil);
  const floatingCompanionDevActive = isDevModeActive && floatingCompanionDevEnabled;
  const companionResidentEnabled = companionSurfacePolicy !== "off";
  const companionTemporarilyHidden = companionHiddenUntil !== null && companionHiddenUntil > Date.now();
  const effectiveCompanionSurfacePolicy = resolveEffectiveCompanionSurfacePolicy(
    companionSurfacePolicy,
    floatingCompanionDevActive,
    companionTemporarilyHidden,
  );
  const companionPillVisible = effectiveCompanionSurfacePolicy === "floating";
  const companionResidentMomentsEnabled = effectiveCompanionSurfacePolicy !== "momentsOnly";

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
    setFloatingCompanionDevEnabled(enabled);
  }, []);

  const handleHideCompanionForOneHour = useCallback(() => {
    if (!companionResidentEnabled) return;
    setCompanionHiddenUntil(persistCompanionHiddenUntil(Date.now() + COMPANION_HIDE_ONE_HOUR_MS));
    recordCompanionEngagementMetric("companion_hidden_one_hour");
  }, [companionResidentEnabled]);

  const handleShowCompanionNow = useCallback(() => {
    setCompanionHiddenUntil(persistCompanionHiddenUntil(null));
    recordCompanionEngagementMetric("companion_shown_now");
  }, []);

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
  const [devDeviceSyncPreviewEnabled, setDevDeviceSyncPreviewEnabled] = useState(resolveInitialDeviceSyncPreviewEnabled);
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
  const [demoDashboardReplaySettings, setDemoDashboardReplaySettings] = useState<DemoDashboardReplaySettings>(resolveInitialDemoDashboardReplaySettings);
  const [categoryColorOverrides, setCategoryColorOverrides] = useState<CategoryColorOverrides>(resolveInitialCategoryColorOverrides);
  const [appThemeColorOverrides, setAppThemeColorOverrides] = useState<AppThemeColorOverrides>(resolveInitialAppThemeColorOverrides);
  const {
    driftAlertDelaySeconds,
    driftAlertsEnabled,
    driftAlarmCopy,
    extremeNudgeEnabled,
    petModeEnabled,
    petModeCoat,
    petModeSize,
    setDriftAlertDelaySeconds,
    setDriftAlarmCopy,
    setDriftAlertsEnabled,
    setExtremeNudgeEnabled,
    setPetModeEnabled,
    setPetModeCoat,
    setPetModeSize,
    watcherMode,
    watcherPeekEnabled,
    watcherPeriodicMaxMinutes,
    watcherPeriodicMinMinutes,
  } = useCompanionSettingsController();
  // No Dev gate: the pet ships as a production surface and is controlled from
  // the account menu and Companion settings.
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
  const handledPetModeRevealRevisionRef = useRef(0);
  const pendingPetModeRevealRevisionsRef = useRef(new Set<number>());
  const petModeRevealRetryAttemptsRef = useRef(new Map<number, number>());
  const latestPetModeRevealRevisionRef = useRef(petModeRevealRevision);
  const petModeSyncMountedRef = useRef(false);
  const [petModeSyncRetryNonce, setPetModeSyncRetryNonce] = useState(0);
  latestPetModeRevealRevisionRef.current = petModeRevealRevision;

  useEffect(() => {
    petModeSyncMountedRef.current = true;
    return () => {
      petModeSyncMountedRef.current = false;
    };
  }, []);

  const handleHidePetForOneHour = useCallback(() => {
    setPetModeHiddenUntil(persistPetModeHiddenUntil(Date.now() + PET_MODE_HIDE_ONE_HOUR_MS));
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
  const [driftAlarmSnooze, setDriftAlarmSnooze] = useState<DriftAlarmBreakSnooze | null>(null);
  const [driftAlarmTrayStatus, setDriftAlarmTrayStatus] = useState<DriftAlarmTrayStatus>(() => {
    const enabled = driftAlertsEnabled;
    return buildDriftAlarmTrayStatus({
      enabled,
      checkedAt: null,
      result: enabled ? { kind: "no_candidate" } : { kind: "disabled" },
    });
  });
  const [breakRecoveryAssessment, setBreakRecoveryAssessment] = useState<DriftAlarmBreakSnooze | null>(null);
  const [driftAlarmInteractions, setDriftAlarmInteractions] = useState<DriftAlarmInteraction[]>(readDriftAlarmInteractions);
  const [showAiClassificationImpact, setShowAiClassificationImpact] = useState(resolveInitialAiClassificationVisibility);
  const {
    aiConnectionTest,
    aiSetupDialogOpen,
    localAiClassificationOptions,
    localAiConnectionFingerprint,
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
    classificationRuleApplying,
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
    handleApplyClassificationRules,
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
    activeTab,
    settingsSection,
    onRefreshSelectedDay: () => refresh(selectedDay),
  });
  const [dashboardAiUnavailablePreviewCase, setDashboardAiUnavailablePreviewCase] = useState<DashboardAiUnavailablePreviewCase>("trial-ended");
  const [dashboardAiUnavailablePreview, setDashboardAiUnavailablePreview] = useState<DashboardAiUnavailablePreviewState | null>(null);
  const [sidebarCtaPreviewCase, setSidebarCtaPreviewCase] = useState<SidebarCtaPreviewCase | null>(null);
  const [sidebarUpgradeDismissedUntil, setSidebarUpgradeDismissedUntil] = useState(readSidebarUpgradeDismissedUntil);
  const [dismissedDashboardAiRecoveryKey, setDismissedDashboardAiRecoveryKey] = useState<string | null>(null);
  const [watcherEvent, setWatcherEvent] = useState<WatcherPeekEvent | null>(null);
  const [endOfDayReviewEvent, setEndOfDayReviewEvent] = useState<EndOfDayReviewEvent | null>(null);
  const [driftAlarmEvent, setDriftAlarmEvent] = useState<DriftAlarmEvent | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);

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

    capturePostHogEvent("app_surface_opened", {
      surface: toAppSurfaceAnalytics(activeTab),
      ...(dashboardPeriod ? { dashboard_period: dashboardPeriod } : {}),
      ...(activeTab === "settings" ? { settings_section: settingsSection } : {}),
    });
  }, [activeTab, dashPeriod, settingsSection]);

  useEffect(() => {
    if (!error) return;
    capturePostHogEvent("app_error", {
      surface: toAppSurfaceAnalytics(activeTab),
      error_kind: toAnalyticsErrorKind(error),
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
  }) => (
    `Native input bounds · ${bounds.x}, ${bounds.y} · ${bounds.width}×${bounds.height} · ${bounds.visible ? "visible" : "hidden"}`
  ), []);

  useEffect(() => {
    if (!petModeActive) {
      setPetModeLabInputBounds(null);
      return;
    }
    if (activeTab !== "settings" || settingsSection !== "dev") return;
    let disposed = false;
    const refresh = () => {
      void getNativePetInputBounds().then((bounds) => {
        if (!disposed && bounds) setPetModeLabInputBounds(formatPetModeInputBounds(bounds));
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
  }, [activeTab, formatPetModeInputBounds, petModeActive, settingsSection]);

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
    void handleCheckForUpdates().then((result) => {
      if (!result) return;
      if (result.kind === "available") return;
      void invoke("update_status_show_native", {
        title: result.kind === "error" ? "Update check failed" : "Drifty is up to date",
        body: result.kind === "error" ? result.message : "No signed update is available.",
      }).catch((error: unknown) => {
        console.warn("Failed to show update status window.", error);
      });
    });
  }, [handleCheckForUpdates]);

  const handleAppMenuCheckLatestBuild = useCallback(() => {
    setLatestBuildNoticeVisible(true);
    if (DEV_SETTINGS_ENABLED && devModeEnabled) {
      setSettingsSection("dev");
      navigateToTab("settings");
      setAccountMenuOpen(false);
    }
    void developerPreReleaseUpdateController.checkLatestBuild();
  }, [developerPreReleaseUpdateController.checkLatestBuild, devModeEnabled, navigateToTab]);

  const handleAppMenuToggleDevMode = useCallback(() => {
    setDevModeEnabled((enabled) => !enabled);
  }, []);

  const openEndOfDayReviewSettings = useCallback(() => {
    openCompanionNotificationSettings();
  }, [openCompanionNotificationSettings]);

  const openEndOfDayReviewDashboard = useCallback(() => {
    setEndOfDayReviewEvent(null);
    selectDay(logicalTodayIsoDate(startOfDayMinutes));
    navigateToTab("dashboard", "Today");
  }, [navigateToTab, startOfDayMinutes]);

  const handleEndOfDayReviewAction = useCallback((action: EndOfDayReviewAction, activityAt?: string) => {
    setEndOfDayReviewEvent(null);

    if (action === "openActivityDay" && activityAt) {
      const activityDate = new Date(activityAt);
      if (Number.isFinite(activityDate.getTime())) {
        selectDay(logicalDayIsoDateForDate(activityDate, startOfDayMinutes));
        navigateToTab("dashboard", "Today");
        return;
      }
    }

    if (action === "openSettings") {
      openCompanionNotificationSettings();
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
  }, [navigateToTab, openCompanionNotificationSettings, openEndOfDayReviewDashboard, openEndOfDayReviewSettings, startOfDayMinutes]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalShowsGoogle, setAuthModalShowsGoogle] = useState(true);
  const [authModalIntent, setAuthModalIntent] = useState<"default" | "promo">("default");
  const [promoHandoffPending, setPromoHandoffPending] = useState(hasPendingPromoHandoff);
  const [promoHandoffMismatch, setPromoHandoffMismatch] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [upgradePlanModalOpen, setUpgradePlanModalOpen] = useState(false);
  const [resumeUpgradePlanAfterAuth, setResumeUpgradePlanAfterAuth] = useState(false);
  const [accountDeletionModalOpen, setAccountDeletionModalOpen] = useState(false);
  const [debugLogPreview, setDebugLogPreview] = useState<{ readonly text: string; readonly exportedAt: string } | null>(null);
  const [resumeOnboardingAfterAuthModal, setResumeOnboardingAfterAuthModal] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // One-shot: armed only by completing onboarding in this session — never re-read
  // from storage, so the bootstrap import cannot re-fire on later launches.
  const [browserHistoryBootstrapEnabled, setBrowserHistoryBootstrapEnabled] = useState(false);
  const [preparingFirstDay, setPreparingFirstDay] = useState(false);
  const [firstDayPreparationPhase, setFirstDayPreparationPhase] = useState<FirstDayPreparationPhase>("importing");
  const [firstDayPreparationProgress, setFirstDayPreparationProgress] = useState<number | null>(null);
  // First work activity from the just-finished onboarding, echoed in the gate's loading copy.
  const [firstDayWorkLabel, setFirstDayWorkLabel] = useState<string | null>(null);
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [classificationMetrics, setClassificationMetrics] = useState<ClassificationMetrics | null>(null);
  const [aiClassificationUsage, setAiClassificationUsage] = useState<AiClassificationUsageSummary | null>(null);
  const [aiClassificationUsageDay, setAiClassificationUsageDay] = useState<string | null>(null);
  const [classificationActionLoading, setClassificationActionLoading] = useState(false);
  const [classificationSummary, setClassificationSummary] = useState<AiClassificationSummary | null>(null);
  const [cloudAiConnectionCheck, setCloudAiConnectionCheck] = useState<CloudAiConnectionCheck | null>(null);
  const cloudAiConnectionGenerationRef = useRef(0);
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
  const openOnboardingEmailAuthModal = useCallback(() => {
    setAuthModalIntent("default");
    setAuthModalShowsGoogle(false);
    setAuthModalOpen(true);
  }, []);
  const selectedDayClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      fallbackCandidates: segments,
      includeAiClassifications: showAiClassificationImpact,
      rules: classificationRules,
    }),
    [classificationRules, segments, showAiClassificationImpact],
  );
  const companionFocusRecordClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      includeAiClassifications: showAiClassificationImpact,
      rules: classificationRules,
    }),
    [classificationRules, showAiClassificationImpact],
  );
  const materializeBuiltInHeuristicTimeline = useCallback((sourceSegments: ActivitySegment[]) => materializeBuiltInHeuristicClassifications({
    classificationOptions: { fallbackCandidates: sourceSegments, includeAiClassifications: false, rules: classificationRules },
    segments: sourceSegments,
  }), [classificationRules]);
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
  const deviceSyncAccountId = authStatus === "authenticated" && hasRequiredAccountAuth && user?.id
    ? user.id
    : null;
  const deviceSyncAccountIdRef = useRef(deviceSyncAccountId);
  deviceSyncAccountIdRef.current = deviceSyncAccountId;
  const onboardingCompletedAt = readUserOnboardingState(user?.id ?? "local", ["local"])?.completedAt ?? null;
  const featureNewBadges = useFeatureNewBadges(onboardingCompletedAt, petModeEnabled);
  const authMetadataAvatarUrl = getAuthMetadataAvatarUrl(user);
  const isEffectiveAuthRequired = isAuthRequired;
  const allowsEffectiveAnonymousAuth = allowsAnonymousAuth && !isEffectiveAuthRequired;
  const hasEffectiveBlockingAuthConfigurationError = hasBlockingAuthConfigurationError;
  const cloudConnectionStatus: AuthConnectionStatus = reportedCloudConnectionStatus
    ?? (isSupabaseConfigured ? (authStatus === "loading" ? "checking" : "online") : "disabled");
  const isCloudOnline = cloudConnectionStatus === "online";
  const shouldCheckBillingEntitlement = isCloudOnline && isSupabaseConfigured && authStatus === "authenticated" && hasRequiredAccountAuth;
  const shouldBlockLocalTrackerAccess = isEffectiveAuthRequired && (hasEffectiveBlockingAuthConfigurationError || !hasRequiredAccountAuth);
  const isPolicySignedIn = Boolean(user) && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
  const requestCloudBillingAuth = openDefaultAuthModal;
  const {
    billingActionError,
    billingCheckoutAwaitingConfirmation,
    billingCheckoutLoadingInterval,
    billingEntitlement,
    billingEntitlementError,
    billingEntitlementLoading,
    billingPortalLoading,
    couponRedemption,
    couponRedemptionErrorCode,
    couponRedemptionLoading,
    cloudDeviceActionError,
    cloudDeviceRevokingId,
    cloudDevices,
    cloudTrialStartedNotice,
    dismissCloudTrialStartedNotice,
    handleManageCloudBilling,
    handleRedeemTrialCoupon,
    handleRevokeCloudDevice,
    openCloudTrialStartedNoticeAiSetup,
    refreshBillingEntitlement,
    startCloudCheckout,
  } = useCloudBillingController({
    hasRequiredAccountAuth,
    isSupabaseConfigured,
    shouldCheckBillingEntitlement,
    user,
    onAuthRequired: requestCloudBillingAuth,
    onOpenAiSetup: openAiSetupSettings,
  });
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
  // Paid device sync: same entitlement gate as cloud AI, plus the per-device
  // explicit opt-in toggle (raw activity leaves the device only when both hold).
  // While the feature is in preview it is additionally gated behind a dedicated
  // Dev-settings toggle (project-classification pattern), so a mistake cannot
  // upload raw activity for regular users. Turning the toggle (or Dev mode) off
  // pauses a previously enabled sync rather than just hiding the section.
  const deviceSyncFeatureVisible = isDevModeActive && devDeviceSyncPreviewEnabled;
  const deviceSyncActive =
    deviceSyncFeatureVisible &&
    deviceSyncAccountId !== null &&
    deviceSyncPreferenceOwnerId === deviceSyncAccountId &&
    deviceSyncEnabled && !deviceSyncAccountResetPending
    && isCloudOnline && isSupabaseConfigured && isPolicySignedIn && billingEntitlement?.canUseApp === true;
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
  // The filter row lists other devices only (the current device is implicit).
  const remoteDeviceLabelById = useMemo(() => {
    if (syncDeviceLabelById.size === 0) return syncDeviceLabelById;
    const next = new Map(syncDeviceLabelById);
    if (deviceSyncStatus.deviceId) next.delete(deviceSyncStatus.deviceId);
    return next;
  }, [deviceSyncStatus.deviceId, syncDeviceLabelById]);
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
      const accountState = await fetchSyncDevices(purgeAccountId);
      if (
        deviceSyncAccountIdRef.current !== purgeAccountId
        || deviceSyncToggleGenerationRef.current !== purgeOperationGeneration
      ) return;
      await trackerClient.setSyncState({ [SYNC_GENERATION_KEY]: null });
      const purge = await purgeCloudSyncData(purgeAccountId, accountState.syncGeneration);
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
  // Owned here (not inside the Team surface) so the sidebar team nav can list teams.
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
  const openTeamAction = useCallback((action: TeamWorkspaceAction) => {
    setTeamNavMenuOpen(false);
    setPendingTeamAction(action);
    navigateToTab("team");
  }, [navigateToTab]);
  useEffect(() => {
    if (!teamNavMenuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".team-nav-menu") || target?.closest(".team-nav-more")) return;
      setTeamNavMenuOpen(false);
    };
    // The popover is fixed-positioned, so any scroll would detach it from its
    // anchor row — just dismiss it.
    const onScroll = () => setTeamNavMenuOpen(false);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [teamNavMenuOpen]);
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
    handleProfileVisibilityChange,
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
    showAiClassificationImpact,
    signInAnonymously,
    startOfDayMinutes,
    user,
    onAuthRequired: requestLeaderboardAuth,
  });
  const focusCard = useFocusCard({
    windowEndDay: leaderboardWindowEndDay,
    startOfDayMinutes,
    includeAiClassifications: showAiClassificationImpact,
  });
  // Web account preview (Dev-gated): while active, periodically publish the aggregate-only
  // account summary that powers the drifty.so account dashboard. Private self-view data —
  // owner-only RLS on the table, nothing public and nothing raw.
  const webAccountStatsActive = isDevModeActive && devWebAccountPreviewEnabled && isCloudOnline && isSupabaseConfigured && isPolicySignedIn;
  useAccountStatsPublisher({
    active: webAccountStatsActive,
    userScopeKey: user?.id ?? "anonymous",
    startOfDayMinutes,
    includeAiClassifications: showAiClassificationImpact,
  });
  const profileDailyProductivity = useDailyProductivitySeries({
    windowEndDay: leaderboardWindowEndDay,
    startOfDayMinutes,
    includeAiClassifications: showAiClassificationImpact,
    enabled: activeTab === "leaderboard",
  });
  const aiClassificationProviderKey = localAiClassificationOptions
    ? `local:${localAiConnectionFingerprint ?? "unconfigured"}`
    : canUseCloudAiClassification
      ? "cloud"
      : "disabled";
  const classificationActivity = useClassificationActivity();
  const establishedCloudClassificationIssueKind = isEstablishedCloudAiDisconnect(cloudAiConnectionCheck)
    ? cloudAiConnectionCheck?.issueKind ?? null
    : null;
  const aiConnectionStatus = resolveAiConnectionStatus({
    canUseCloudAi: canUseCloudAiClassification,
    localProviderStatus: localAiProviderStatus,
    localProviderLabel: localAiConnectionFingerprint ? localAiConnectionProviderLabel : null,
    localMemoryUsageBytes: localAiMemoryUsageBytes,
    classificationRunning: classificationActivity.running || classificationActionLoading || classificationSummary?.status === "running",
    classificationRemaining: classificationActivity.remaining,
    // Local providers report connectivity through localProviderStatus (with
    // failure hysteresis); only cloud runs surface summary errors here, and
    // content-level failures (provider answered, output unusable) never do.
    classificationIssueKind: !localAiClassificationOptions ? establishedCloudClassificationIssueKind : null,
    cloudIssueKind: billingEntitlementError
      ? aiConnectionIssueKindFromMessage(billingEntitlementError)
      : billingEntitlement?.lockedReason === "device_limit_reached"
        ? "provider"
        : null,
  });
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
    previousAiClassificationProviderKeyRef.current = aiClassificationProviderKey;
  }, [aiClassificationProviderKey]);
  const isSettingsTab = activeTab === "settings";
  const managedLocalAiStatus = useManagedLocalAiStatusObserver(!onboardingOpen && !isSettingsTab);
  const isSidebarVisuallyCollapsed = !isSettingsTab && sidebarCollapsed;
  // Dev preview feeds the same resolver a synthetic input instead of swapping in
  // a canned state, so what you see is the production branching.
  const isSidebarCtaPreviewActive = isDevModeActive && sidebarCtaPreviewCase !== null;
  const sidebarCtaPreviewInput = isSidebarCtaPreviewActive && sidebarCtaPreviewCase
    ? buildSidebarCtaPreviewInput(sidebarCtaPreviewCase, Date.now())
    : null;
  const managedLocalTopbarLabel = sidebarCtaPreviewInput
    ? managedLocalAiTopbarLabel(sidebarCtaPreviewInput.managedLocalAiStatus)
    : isManagedLocalAiRoute(localAiSetup)
      ? managedLocalAiTopbarLabel(managedLocalAiStatus)
      : null;
  const effectiveAiConnectionStatus = managedLocalTopbarLabel
    ? {
      tone: "error" as const,
      label: managedLocalTopbarLabel,
      providerLabel: "Local AI",
      memoryLabel: sidebarCtaPreviewInput ? null : aiConnectionStatus.memoryLabel,
      issueKind: "provider" as const,
    }
    : sidebarCtaPreviewInput
      ? { ...sidebarCtaPreviewInput.aiStatus, memoryLabel: null }
      : aiConnectionStatus;
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
        managedLocalAiStatus: isManagedLocalAiRoute(localAiSetup) ? managedLocalAiStatus : null,
      },
  );
  const sidebarUpgradeDismissed = !isSidebarCtaPreviewActive
    && sidebarCtaSlot?.kind === "upgrade"
    && isSidebarUpgradeDismissed(sidebarUpgradeDismissedUntil, Date.now());
  const shouldShowSidebarCtaSlot = !isSettingsTab
    && sidebarCtaSlot !== null
    && !sidebarUpgradeDismissed;
  const billingEntitlementSupportsUpgrade = canStartIndividualCheckout(billingEntitlement);
  const handleStartDriftyCloudSetup = useCallback(async () => {
    if (!isSupabaseConfigured || !user || !hasRequiredAccountAuth) {
      requestCloudBillingAuth();
      return;
    }
    openAccountSettings();
  }, [hasRequiredAccountAuth, isSupabaseConfigured, openAccountSettings, requestCloudBillingAuth, user]);
  const handleOpenUpgradePlanModal = useCallback(() => {
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
  const historySearchRequestRef = useRef(0);
  const dashboardRefreshInputsRef = useRef<DashboardRefreshInputs | null>(null);
  const requiredCurrentSnapshotRefreshInFlightRef = useRef(false);
  const dashboardWeekPrefetchRequestRef = useRef(0);
  const compactHistoryCacheRef = useRef<Map<string, CompactHistoryLoad>>(new Map());
  const compactHistoryInFlightRef = useRef<Map<string, { readonly range: CompactHistoryRange; readonly promise: Promise<CompactHistoryLoad> }>>(new Map());
  const compactHistoryCacheGenerationRef = useRef(0);
  const autoSelectedLatestDayRef = useRef(false);
  const userSelectedDayRef = useRef(false);
  const lastDriftAlertSegmentRef = useRef<string | null>(null);
  const driftAlarmSessionProtectionRef = useRef<DriftAlarmSessionProtection | null>(null);
  // Catching the cat buys one quiet round per drift stretch. Keyed by source
  // segment rather than alert key, because the alert key embeds `endedAt` and
  // rotates every poll while the same drift continues; keying on it would hand
  // out a fresh reprieve every 15 seconds and make interception a free bypass.
  const petInterceptedSegmentRef = useRef<string | null>(null);
  const pendingDriftAlarmGateRef = useRef<string | null>(null);
  const lastEligibleDriftCandidateRef = useRef<DriftAlarmCandidate | null>(null);
  const pendingDriftAlarmTransientRef = useRef<DriftAlarmTransientPending | null>(null);
  const pendingDriftAlarmTransientRefreshRef = useRef(0);
  const driftAlarmSnoozeRef = useRef<DriftAlarmBreakSnooze | null>(null);
  const breakRecoveryAssessmentRef = useRef<DriftAlarmBreakSnooze | null>(null);
  const autoStartAttemptedRef = useRef(false);
  const watcherSnapshotRef = useRef<WatcherSnapshot>(getDefaultWatcherSnapshot());
  const watcherEventRef = useRef<WatcherPeekEvent | null>(null);
  const watcherRequestInFlightRef = useRef(false);
  const watcherRecoveryTimeoutRef = useRef(0);
  const endOfDayReviewQueryPreviewShownRef = useRef(false);
  const endOfDayReviewAutomaticInFlightRef = useRef(false);
  const endOfDayReviewLastPresentedAtRef = useRef<number | null>(null);
  const driftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const lastDriftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const driftAlarmSourceSegmentsRef = useRef<Map<string, ActivitySegment>>(new Map());
  const appIconRequestsInFlightRef = useRef<Set<string>>(new Set());
  const siteIconRequestsInFlightRef = useRef<Set<string>>(new Set());
  const driftAlarmRequestInFlightRef = useRef(false);
  const liveDriftAlarmRefreshInFlightRef = useRef(false);
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
        pruneStaleCompactHistoryLoads(compactHistoryCacheRef.current);
        compactHistoryCacheRef.current.set(key, nextLoad);
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
  const loadMissingSiteIconDomains = useCallback((domains: readonly string[]) => {
    void (async () => {
      const missingDomains = domains.filter((domain) => {
        if (siteIconRequestsInFlightRef.current.has(domain)) return false;
        siteIconRequestsInFlightRef.current.add(domain);
        return true;
      });
      if (missingDomains.length === 0) return;

      try {
        const rawIconMap = await trackerClient.getSiteIcons(missingDomains);
        setSiteIcons((current) => mergeSiteIconResults(current, missingDomains, rawIconMap));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn("Failed to load site icons.", message);
      } finally {
        for (const domain of missingDomains) {
          siteIconRequestsInFlightRef.current.delete(domain);
        }
      }
    })();
  }, []);

  const loadMissingSiteIcons = useCallback((segmentsToInspect: readonly ActivitySegment[]) => {
    loadMissingSiteIconDomains(collectMissingSiteIconRequests(segmentsToInspect, siteIconsRef.current));
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
          scheduleBuiltInHeuristicClassificationPersistence(materializedPage.classifications);
          loadMissingAppIcons({
            segments: materializedPage.segments,
            shouldReportFailure: () => historySearchRequestRef.current === requestId,
            failureMessage: "Failed to load history search app icons",
          });
          loadMissingSiteIcons(materializedPage.segments);
        } catch (nextError) {
          if (historySearchRequestRef.current !== requestId) return;
          setHistorySearchError(nextError instanceof Error ? nextError.message : toErrorMessage(nextError));
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
    const nextStatus = buildDriftAlarmTrayStatus({
      enabled: driftAlertsEnabled,
      checkedAt,
      result,
    });
    const nextNativeStatus = {
      ...nextStatus,
      developerDetailsEnabled: isDevModeActive,
      trackerRunning: status?.running ?? null,
    };
    recordDriftAlarmDebugEvent({
      kind: "tray_status_published",
      trayResult: summarizeDriftAlarmTrayResult(result),
    });

    if (options?.updateRendererState === false) {
      publishNativeDriftAlarmTrayStatus(nextNativeStatus);
      return;
    }

    setDriftAlarmTrayStatus(nextStatus);
  }, [driftAlertsEnabled, isDevModeActive, publishNativeDriftAlarmTrayStatus, status?.running]);
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
    driftAlarmDayRef.current = nextAlarmDay;
    driftAlarmBaseSegmentsRef.current = [];
    driftAlarmHistorySegmentsRef.current = [];
    liveDriftAlarmSegmentsRef.current = [];
    pendingDriftAlarmGateRef.current = null;
    lastEligibleDriftCandidateRef.current = null;
    pendingDriftAlarmTransientRef.current = null;
    lastDriftAlertSegmentRef.current = null;
    driftAlarmSessionProtectionRef.current = null;
    clearPendingTransientRefresh();
  }

  function clearPausedDriftAlarmRuntime() {
    pendingDriftAlarmGateRef.current = null;
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
      userSelectedDayRef.current = (options?.userSelected ?? true) && nextDay !== logicalTodayIsoDate(startOfDayMinutes);
      return nextDay;
    });
  }

  const selectTodayAfterDateRollover = useCallback(() => {
    const currentDay = logicalTodayIsoDate(startOfDayMinutes);
    if (selectedDay === currentDay) return false;
    if (activeTab !== "dashboard" || dashPeriod !== "Today") return false;
    if (userSelectedDayRef.current) return false;

    autoSelectedLatestDayRef.current = true;
    setSelectedDay(currentDay);
    return true;
  }, [activeTab, dashPeriod, selectedDay, startOfDayMinutes]);

  function shiftDashboardPeriod(direction: -1 | 1) {
    if (direction === 1 && !canShiftDashboardForward) return;
    selectDay((currentDay) => shiftDashboardPeriodDay(currentDay, dashPeriod, direction));
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
      void hideNativeWatcherPeek();
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
  }, [armWatcherRecoveryTimer, clearWatcherEvent, showAiClassificationImpact, status?.running]);

  const showEndOfDayReview = useCallback(async (event: EndOfDayReviewEvent): Promise<boolean> => {
    if (!isTauriRuntime()) {
      setEndOfDayReviewEvent(event);
      return true;
    }

    try {
      return await showNativeEndOfDayReview(event);
    } catch {
      return false;
    }
  }, []);

  const buildEndOfDayReviewEvent = useCallback(async (input: EndOfDayReviewSummaryInput): Promise<EndOfDayReviewEvent> => {
    const currentAppIcons = appIconsRef.current;
    const baseEvent = buildEndOfDayReviewSummary({ ...input, appIcons: currentAppIcons });
    const missingIconRequests = input.isMock ? [] : collectMissingEndOfDayReviewIconRequests(baseEvent);
    if (!isTauriRuntime() || missingIconRequests.length === 0) {
      return { ...baseEvent, layout: "minimal" };
    }

    try {
      const resolvedIcons = await trackerClient.getAppIcons(missingIconRequests);
      return {
        ...buildEndOfDayReviewSummary({
        ...input,
        appIcons: mergeResolvedAppIcons(currentAppIcons, missingIconRequests, resolvedIcons),
        }),
        layout: "minimal",
      };
    } catch {
      return { ...baseEvent, layout: "minimal" };
    }
  }, []);

  const handleEndOfDayReviewPreview = useCallback(() => {
    if (!END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED) return;
    if (!isDevModeActive) return;
    const previewSegments = segments.length > 0 ? segments : buildMockEndOfDayReviewSegments(selectedDay);
    void buildEndOfDayReviewEvent({
      day: selectedDay,
      generatedAt: new Date().toISOString(),
      segments: previewSegments,
      isMock: true,
    }).then(showEndOfDayReview);
  }, [buildEndOfDayReviewEvent, isDevModeActive, segments, selectedDay, showEndOfDayReview]);

  const recordDriftInteraction = useCallback((interaction: DriftAlarmInteraction) => {
    setDriftAlarmInteractions(recordDriftAlarmInteraction(interaction));
  }, []);

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

    if (!isTauriRuntime()) {
      setDriftAlarmEvent(event);
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
    }).catch((error: unknown) => {
      recordDriftAlarmDebugEvent({
        kind: "native_show_failed",
        alertKey: event.id,
        message: toErrorMessage(error),
        delivery,
      });
      if (driftAlarmEventRef.current?.id === event.id) clearDriftAlarmEvent();
    }).finally(() => {
      driftAlarmRequestInFlightRef.current = false;
      const pendingEvent = pendingDriftAlarmEventRef.current;
      pendingDriftAlarmEventRef.current = null;
      if (pendingEvent) showDriftAlarm(pendingEvent);
    });
  }, [clearDriftAlarmEvent]);

  const previewCompanionMilestone = useCallback((previewId: CompanionMilestonePreviewId) => {
    void showNativeCompanionMilestone(buildCompanionMilestonePreview(previewId))
      .catch((error: unknown) => {
        console.warn("Failed to preview companion milestone", toErrorMessage(error));
      });
  }, []);

  /* The decision cards could not be reviewed without waiting for real drift, so
     they are fired through the same native path the tracker uses. */
  const previewCompanionMoment = useCallback((previewId: CompanionMomentPreviewId) => {
    const sent = previewId === "reentry"
      ? showNativeCompanionReentry(buildCompanionReentryPreview())
      : previewId === "extreme-nudge"
        ? showNativeExtremeNudgeToast(buildCompanionExtremeNudgePreview())
        : showNativeCompanionDriftAlarm(buildCompanionDriftAlarmPreview(previewId));
    void sent.catch((error: unknown) => {
      console.warn("Failed to preview companion moment", toErrorMessage(error));
    });
  }, []);

  /* The caught-cat card differs from the ordinary drift card only in its copy,
     so it needs its own preview to be reviewable at all. */
  const previewPetInterceptCard = useCallback(() => {
    const alarm = buildCompanionDriftAlarmPreview("drift-alarm", Date.now(), true);
    const sent = showNativeCompanionDriftAlarm(alarm);
    void sent.catch((error: unknown) => {
      console.warn("Failed to preview pet intercept card", toErrorMessage(error));
    });
  }, []);

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

  const handleDriftAlarmDismissed = useCallback(() => {
    recordCurrentDriftAlarmDismiss();
    clearDriftAlarmEvent();
  }, [clearDriftAlarmEvent, recordCurrentDriftAlarmDismiss]);

  const cancelDriftAlarm = useCallback(() => {
    recordCurrentDriftAlarmDismiss();
    dismissDriftAlarm();
  }, [dismissDriftAlarm, recordCurrentDriftAlarmDismiss]);

  async function applyDriftAlarmManualCorrection(event: DriftAlarmEvent | null): Promise<void> {
    const sourceSegmentId = event?.sourceSegmentId?.trim();
    if (!sourceSegmentId) {
      recordDriftAlarmDebugEvent({
        kind: "manual_correction_failed",
        alertKey: event?.id ?? null,
        reason: "source_segment_id_missing",
        delivery: event ? summarizeDriftAlarmEvent(event) : null,
      });
      return;
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
      return;
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
    pendingDriftAlarmGateRef.current = null;

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
    if (ruleInput) await saveClassificationRule(ruleInput);

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
      provider: currentSoulLearningProvider(localAiClassificationOptions, canUseCloudAiClassification),
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

  const handleDriftAlarmAction = useCallback((action: DriftAlarmAction) => {
    const currentAlarmEvent = driftAlarmEventRef.current ?? lastDriftAlarmEventRef.current;
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
    dismissDriftAlarm();

    switch (action.type) {
      case "settings":
        setSettingsSection("notifications");
        navigateToTab("settings");
        return;
      case "manual_correction":
        void applyDriftAlarmManualCorrection(currentAlarmEvent).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("Failed to save drift alarm manual correction", message);
        });
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
        driftAlarmSnoozeRef.current = nextSnooze;
        setBreakRecoveryAssessment(null);
        setDriftAlarmSnooze(nextSnooze);
        return;
      }
    }
  }, [dismissDriftAlarm, navigateToTab, recordDriftInteraction, returnToFocusTarget, selectedDayClassificationOptions]);

  const dismissWatcherPeek = useCallback(() => {
    clearWatcherEvent();
    void hideNativeWatcherPeek();
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
      shouldLoadHistory: isForegroundRefresh && shouldRefreshHistoryData(activeTab, dashPeriod, classificationRange),
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
            return isRequiredCurrentSnapshotRefresh
              ? trackerClient.getCurrentSnapshot()
              : trackerClient.getCurrentSnapshot().catch(() => null);
          })
        : Promise.resolve(currentSnapshot);

      const [timeline, archiveTimelineLoad, historyHourlySummary, historySiteSummary, nextCurrentSnapshot, nextClassificationMetrics, nextAiClassificationUsage] = await Promise.all([
        trackerClient.getTimeline(selectedDayRange),
        archiveTimelineRequest,
        historyHourlySummaryRequest,
        historySiteSummaryRequest,
        currentSnapshotRequest,
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

      if (isForegroundRefresh && trackerMutationGenerationRef.current === trackerMutationGeneration) {
        setCurrentSnapshot(nextCurrentSnapshot);
      }
      if (isAlarmDayRefresh) {
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
      scheduleBuiltInHeuristicClassificationPersistence([
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
      return true;
    } catch (nextError) {
      if (refreshRequestRef.current !== requestId) return false;
      const message = toErrorMessage(nextError);
      if (dashboardWeekRefreshKey) setDashboardWeekRefreshState({ key: dashboardWeekRefreshKey, status: "error" });
      setError(message);
      return false;
    } finally {
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
    if (classificationCorrectionDraft?.scope === scope && classificationCorrectionDraft.rowId === rowId) {
      setClassificationCorrectionDraft(null);
      setClassificationCorrectionNotice(null);
      return;
    }
    const sourceRow = rowId ? classificationActivityRows.find((row) => row.id === rowId) ?? null : null;
    const sourceSegment = sourceRow?.segments[0]
      ?? (rowId ? null : classificationActivityRows[0]?.segments[0] ?? classificationSourceSegments.find((segment) => classifySegmentSourceKey(segment) === effectiveClassifySourceId) ?? null);
    if (!sourceSegment) return;
    const draft = buildClassificationCorrectionDraft({
      rowId,
      scope,
      segment: sourceSegment,
      classificationOptions,
      displayLabel: sourceRow?.label ?? selectedClassificationSourceSummary?.label ?? null,
    });
    if (!draft) return;
    setClassificationCorrectionNotice(null);
    setClassificationCorrectionDraft(draft);
    if (scope === "detail" && rowId) {
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

    const ruleInput: ClassificationRuleInput = {
      targetKind: draft.targetKind,
      targetValue: draft.targetValue,
      matchScope: draft.scope,
      detailKind: draft.scope === "detail" ? draft.detailKind : null,
      detailValue: draft.scope === "detail" ? draft.detailValue : null,
      category: draft.category,
      productivity: draft.productivity,
      enabled: true,
      confidence: 1,
    };

    setClassificationCorrectionNotice(null);
    setClassificationCorrectionSaving(true);
    let ruleSaved = false;
    try {
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

      const saved = await saveClassificationRule(ruleInput);
      if (!saved) {
        setClassificationCorrectionNotice({
          kind: "error",
          message: "We couldn’t finish applying this correction. Your choices are still here, so you can try again.",
        });
        return;
      }
      ruleSaved = true;

      if (draft.scope === "detail" && draft.rowId) {
        const row = classificationActivityRows.find((item) => item.id === draft.rowId) ?? null;
        if (row && row.segments.length > 0) {
          const classifiedAt = new Date().toISOString();
          await trackerClient.saveClassifications(row.segments.map((segment) => buildClassificationCorrectionRecord({
            category: draft.category,
            classifiedAt,
            productivity: draft.productivity,
            segment,
          })));
        }
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
          provider: currentSoulLearningProvider(localAiClassificationOptions, canUseCloudAiClassification),
        }).catch((error) => console.warn("Unable to learn from classification correction.", error));
      }
      setClassificationCorrectionDraft(null);
      setClassificationCorrectionNotice({
        kind: "success",
        message: `${draft.displayLabel ?? draft.targetValue} is now ${categoryLabel(draft.category)} · ${productivityLabel(draft.productivity)}. This correction helps Memory classify similar activity.`,
      });
      await refresh(selectedDayRef.current);
    } catch (nextError) {
      console.warn("Unable to finish classification correction.", toErrorMessage(nextError));
      setClassificationCorrectionNotice({
        kind: "error",
        message: ruleSaved
          ? "The rule was saved, but this activity couldn’t be fully updated. Try again to finish the correction."
          : "We couldn’t save this correction. Your choices are still here, so you can try again.",
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
        scheduleBuiltInHeuristicClassificationPersistence(materializedRecentTimeline.classifications);
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
      scheduleBuiltInHeuristicClassificationPersistence(materializedArchiveTimelines.classifications);
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
    refresh,
    refreshHistoryData,
    selectedDayRef,
    setError,
    shouldStart: shouldStartBrowserHistoryBootstrap,
  });

  // Live view of the local AI options for the first-day gate: the managed-model
  // attach watcher can fill the setup while the gate is running.
  const localAiClassificationOptionsRef = useRef(localAiClassificationOptions);
  useEffect(() => {
    localAiClassificationOptionsRef.current = localAiClassificationOptions;
  }, [localAiClassificationOptions]);
  const canUseCloudAiClassificationRef = useRef(canUseCloudAiClassification);
  useEffect(() => {
    canUseCloudAiClassificationRef.current = canUseCloudAiClassification;
  }, [canUseCloudAiClassification]);
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
    try {
      const summary = await runAiClassification(...args);
      if (args[2]?.localProvider) recordLocalAiClassificationSummary(summary);
      else recordCloudAiClassificationSummary(summary, cloudAiConnectionGeneration);
      return summary;
    } catch (error) {
      if (args[2]?.localProvider) recordLocalAiClassificationError(toErrorMessage(error));
      else await recordCloudAiClassificationError(error, cloudAiConnectionGeneration);
      throw error;
    }
  }, [recordCloudAiClassificationError, recordCloudAiClassificationSummary, recordLocalAiClassificationError, recordLocalAiClassificationSummary]);
  const runFirstDayAiClassificationUntilEmpty = useCallback(async (
    ...args: Parameters<typeof runAiClassificationUntilEmpty>
  ): Promise<AiClassificationSummary> => {
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;
    try {
      const summary = await runAiClassificationUntilEmpty(...args);
      if (args[2]?.localProvider) recordLocalAiClassificationSummary(summary);
      else recordCloudAiClassificationSummary(summary, cloudAiConnectionGeneration);
      return summary;
    } catch (error) {
      if (args[2]?.localProvider) recordLocalAiClassificationError(toErrorMessage(error));
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
    localAiClassificationOptionsRef,
    managedLocalSelected,
    onReveal: () => setPreparingFirstDay(false),
    preparingFirstDay,
    refresh,
    runAiClassification: runFirstDayAiClassification,
    runAiClassificationUntilEmpty: runFirstDayAiClassificationUntilEmpty,
    selectDay,
    selectedDayRef,
    setPhase: setFirstDayPreparationPhase,
    setProgress: setFirstDayPreparationProgress,
    shouldBlockLocalTrackerAccess,
    startOfDayMinutes,
  });

  const loadMoreHistorySegments = useCallback(async (): Promise<void> => {
    if (historyLoadingMore || !historyHasMoreSegments || historyNextCursor === null || historySegmentsLoadedRange === null) return;

    const requestId = historyRefreshRequestRef.current;
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
      scheduleBuiltInHeuristicClassificationPersistence(materializedPage.classifications);

      loadMissingAppIcons({
        segments: materializedPage.segments,
        shouldReportFailure: () => historyRefreshRequestRef.current === requestId,
        failureMessage: "Failed to load additional history app icons",
      });
      loadMissingSiteIcons(materializedPage.segments);
    } catch (nextError) {
      if (historyRefreshRequestRef.current !== requestId) return;
      setHistoryLoadMoreError(nextError instanceof Error ? nextError.message : toErrorMessage(nextError));
    } finally {
      if (historyRefreshRequestRef.current === requestId) {
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
    if (historySearchLoading || !historySearchHasMoreSegments || historySearchNextCursor === null || normalizedHistorySearchQuery.length === 0) return;

    const requestId = historySearchRequestRef.current;
    setHistorySearchLoading(true);
    setHistorySearchError(null);

    try {
      const timelinePage = await trackerClient.searchTimeline({
        query: normalizedHistorySearchQuery,
        ...FULL_HISTORY_SEARCH_RANGE,
        beforeEndedAt: historySearchNextCursor.beforeEndedAt,
        beforeSegmentId: historySearchNextCursor.beforeSegmentId,
        limit: HISTORY_TIMELINE_PAGE_SIZE,
      });
      const materializedPage = materializeBuiltInHeuristicTimeline(timelinePage.items);

      if (historySearchRequestRef.current !== requestId) return;

      setHistorySearchSegments((currentSegments) => mergeHistoryTimelinePages(currentSegments, materializedPage.segments));
      setHistorySearchNextCursor(timelinePage.nextCursor);
      setHistorySearchHasMoreSegments(timelinePage.hasMore);
      scheduleBuiltInHeuristicClassificationPersistence(materializedPage.classifications);

      loadMissingAppIcons({
        segments: materializedPage.segments,
        shouldReportFailure: () => historySearchRequestRef.current === requestId,
        failureMessage: "Failed to load additional history search app icons",
      });
      loadMissingSiteIcons(materializedPage.segments);
    } catch (nextError) {
      if (historySearchRequestRef.current !== requestId) return;
      setHistorySearchError(nextError instanceof Error ? nextError.message : toErrorMessage(nextError));
    } finally {
      if (historySearchRequestRef.current === requestId) {
        setHistorySearchLoading(false);
      }
    }
  }, [
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
      scheduleBuiltInHeuristicClassificationPersistence(materializedArchiveTimelines.classifications);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn("Failed to prefetch current week history", message);
      return false;
    }
  }, [loadCompactHistoryRange, shouldBlockLocalTrackerAccess, startOfDayMinutes]);

  const refreshLiveDriftAlarmActivity = useCallback(async (day: string): Promise<boolean> => {
    if (liveDriftAlarmRefreshInFlightRef.current) return false;
    if (shouldBlockLocalTrackerAccess) return false;
    if (status?.running !== true) return false;
    if (day !== currentDriftAlarmDay()) return false;

    liveDriftAlarmRefreshInFlightRef.current = true;
    const trackerMutationGeneration = trackerMutationGenerationRef.current;
    try {
      const timelineRange = getDriftAlarmPollTimelineRange(day, startOfDayMinutes);
      const [liveTimeline, nextCurrentSnapshot] = await Promise.all([
        trackerClient.getTimeline(timelineRange),
        trackerClient.getCurrentSnapshot().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "unknown error";
          console.warn("Failed to refresh current activity for drift alarm poll", message);
          return null;
        }),
      ]);

      if (
        day !== currentDriftAlarmDay()
        || trackerMutationGenerationRef.current !== trackerMutationGeneration
      ) return false;
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
  }, [shouldBlockLocalTrackerAccess, startOfDayMinutes, status?.running]);

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

  const refreshRef = useRef(refresh);
  const refreshLiveTailRef = useRef(refreshLiveTail);
  const selectTodayAfterDateRolloverRef = useRef(selectTodayAfterDateRollover);
  useLayoutEffect(() => {
    refreshRef.current = refresh;
    refreshLiveTailRef.current = refreshLiveTail;
    selectTodayAfterDateRolloverRef.current = selectTodayAfterDateRollover;
  });

  useEffect(() => {
    window.__DRIFTY_SET_BOOT_STATUS__?.("Renderer mounted. Showing minimal shell\u2026");
    window.__DRIFTY_BOOTSTRAPPED__ = true;
    hideBootShell();
  }, []);

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

    const timeoutId = window.setTimeout(() => {
      void prefetchCurrentWeekHistory(selectedDay);
    }, 300);

    return () => window.clearTimeout(timeoutId);
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
    // A persisted pause is an explicit user choice, not a failed startup. Only
    // the Resume action may clear it; background recovery must leave it alone.
    if (status.trackingPaused) {
      autoStartAttemptedRef.current = true;
      return;
    }
    if (status.trackerMode === "unavailable") return;

    autoStartAttemptedRef.current = true;
    void handleBackgroundStartTracking();
  }, [hasLoadedOnce, shouldBlockLocalTrackerAccess, status]);

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
      if (tickAction === "reconcile") {
        void refreshRef.current(selectedDay, { foreground: false });
        return;
      }
      void refreshLiveTailRef.current(selectedDay);
    }, APP_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [activeTab, classificationRange, dashPeriod, isPreviewSurface, selectedDay, shouldBlockLocalTrackerAccess, trendsRange]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return undefined;
    // Drift alarms are a desktop companion feature; preview/demo surfaces have
    // no tracker to watch (previewStatus() reports running=true), so skip the
    // recurring snapshot poll there.
    if (isPreviewSurface) return undefined;
    if (!driftAlertsEnabled) return undefined;
    if (status?.running !== true) return undefined;

    const intervalId = setInterval(() => {
      if (selectTodayAfterDateRollover()) return;
      // Keep this heavy snapshot poll out of the focused renderer path; alarms resume on the normal cadence once Drifty loses focus.
      if (rendererFocusedRef.current) return;
      void refreshLiveDriftAlarmActivity(currentDriftAlarmDay());
    }, DRIFT_ALARM_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [driftAlertsEnabled, isPreviewSurface, refreshLiveDriftAlarmActivity, selectTodayAfterDateRollover, shouldBlockLocalTrackerAccess, startOfDayMinutes, status?.running]);

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
    // The native shell material renders in the window's macOS appearance, so it
    // has to follow the app theme; otherwise a dark app on a light system draws
    // a light material under the dark tint and the glass reads as a solid slab.
    void setMainWindowThemeAppearance(theme === "dark").catch(() => {
      // Appearance is cosmetic; a failed invoke must not break theming.
    });
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(START_OF_DAY_STORAGE_KEY, String(startOfDayMinutes));
  }, [startOfDayMinutes]);

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
    for (const option of APP_THEME_COLOR_OPTIONS) {
      const color = appThemeColorOverrides[option.key];
      if (color) document.documentElement.style.setProperty(option.cssVariable, color);
      else document.documentElement.style.removeProperty(option.cssVariable);
    }
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
    window.localStorage.setItem(DEVICE_SYNC_PREVIEW_STORAGE_KEY, devDeviceSyncPreviewEnabled ? "1" : "0");
  }, [devDeviceSyncPreviewEnabled]);

  useEffect(() => {
    window.localStorage.setItem(WEB_ACCOUNT_PREVIEW_STORAGE_KEY, devWebAccountPreviewEnabled ? "1" : "0");
  }, [devWebAccountPreviewEnabled]);

  // Leaving the Projects tab visible after the preview is switched off would strand
  // the user on a hidden surface — send them back to the dashboard.

  useEffect(() => {
    const effectiveDevModeEnabled = DEV_SETTINGS_ENABLED && devModeEnabled;
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, effectiveDevModeEnabled ? "1" : "0");
    if (effectiveDevModeEnabled) return;
    if (settingsSection === "dev") setSettingsSection("general");
    if (teamsBetaEnabled) setTeamsBetaEnabled(false);
    if (profileBetaEnabled) setProfileBetaEnabled(false);
    if (agentsBetaEnabled) setAgentsBetaEnabled(false);
    if (floatingCompanionDevEnabled) setFloatingCompanionDevEnabled(false);
    if (devWebAccountPreviewEnabled) setDevWebAccountPreviewEnabled(false);
    if (forceChromiumAxCaptureEnabled) setForceChromiumAxCaptureEnabled(false);
    if (forceFrontmostFallbackCaptureEnabled) setForceFrontmostFallbackCaptureEnabled(false);
    if (forceBrowserHistoryUrlFallbackEnabled) setForceBrowserHistoryUrlFallbackEnabled(false);
    if (forceChromiumAxExtremeNudgeEnabled) setForceChromiumAxExtremeNudgeEnabled(false);
    // The pet is deliberately absent here. It is a production feature now, so
    // turning Dev mode off must leave it exactly as the user set it; only the
    // Pet Mode Lab is gated behind Dev.
  }, [devModeEnabled, devWebAccountPreviewEnabled, floatingCompanionDevEnabled, forceBrowserHistoryUrlFallbackEnabled, forceChromiumAxCaptureEnabled, forceChromiumAxExtremeNudgeEnabled, forceFrontmostFallbackCaptureEnabled, agentsBetaEnabled, profileBetaEnabled, settingsSection, teamsBetaEnabled]);

  useEffect(() => {
    window.localStorage.setItem(FLOATING_COMPANION_DEV_STORAGE_KEY, floatingCompanionDevActive ? "1" : "0");
  }, [floatingCompanionDevActive]);

  useEffect(() => {
    const effectiveTeamsBetaEnabled = DEV_SETTINGS_ENABLED && devModeEnabled && teamsBetaEnabled;
    window.localStorage.setItem(TEAMS_BETA_STORAGE_KEY, effectiveTeamsBetaEnabled ? "1" : "0");
  }, [devModeEnabled, teamsBetaEnabled]);

  // Dev-only before/after switch for the sidebar glass. Legacy preview ON
  // swaps the blur source back to the pre-fix implementation: the native
  // under-window effect comes off and the retired CSS backdrop-filter is
  // reinstated via data-legacy-shell-blur (see app-shell.css). Leaving Dev
  // mode returns to the production default (native blur, no CSS filter).
  useEffect(() => {
    const legacyActive = DEV_SETTINGS_ENABLED && devModeEnabled && legacyShellBlurPreviewEnabled;
    window.localStorage.setItem(LEGACY_SHELL_BLUR_PREVIEW_STORAGE_KEY, legacyActive ? "1" : "0");
    if (legacyActive) {
      document.documentElement.dataset.legacyShellBlur = "true";
    } else {
      delete document.documentElement.dataset.legacyShellBlur;
    }
    void setMainWindowNativeBlur(!legacyActive).catch(() => {
      // Effects are cosmetic; a failed invoke must not break settings.
    });
  }, [devModeEnabled, legacyShellBlurPreviewEnabled]);

  useEffect(() => {
    window.localStorage.setItem(PROFILE_BETA_STORAGE_KEY, canOpenProfileBeta ? "1" : "0");
  }, [canOpenProfileBeta]);

  useEffect(() => {
    window.localStorage.setItem(AGENTS_BETA_STORAGE_KEY, canOpenAgentsBeta ? "1" : "0");
  }, [canOpenAgentsBeta]);

  // Leaving the agents tab open when the toggle goes off would strand the user
  // on a surface the sidebar no longer offers, so send them back to the day.
  useEffect(() => {
    if (activeTab !== "agents" || canOpenAgentsBeta) return;
    navigateToTab("dashboard", "Today");
  }, [activeTab, canOpenAgentsBeta, navigateToTab]);

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
    const forceChromiumAxCapture = DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxCaptureEnabled;
    const forceFrontmostFallbackCapture = DEV_SETTINGS_ENABLED && devModeEnabled && forceFrontmostFallbackCaptureEnabled;
    const forceBrowserHistoryUrlFallback = DEV_SETTINGS_ENABLED && devModeEnabled && forceBrowserHistoryUrlFallbackEnabled;
    const enhancedContextSourceFamilies = ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS
      .filter((option) => effectiveEnhancedContextSettings.sourceFamilies[option.family])
      .map((option) => option.family);
    const developerDiagnosticsSettings = {
      forceChromiumAxCapture,
      forceFrontmostFallbackCapture,
      forceBrowserHistoryUrlFallback,
      enhancedContextEnabled: effectiveEnhancedContextSettings.enabled,
      enhancedContextCaptureLocal: effectiveEnhancedContextSettings.captureLocal,
      enhancedContextSourceFamilies,
    };
    window.localStorage.setItem(FORCE_CHROMIUM_AX_CAPTURE_STORAGE_KEY, forceChromiumAxCapture ? "1" : "0");
    window.localStorage.setItem(FORCE_FRONTMOST_FALLBACK_CAPTURE_STORAGE_KEY, forceFrontmostFallbackCapture ? "1" : "0");
    window.localStorage.setItem(FORCE_BROWSER_HISTORY_URL_FALLBACK_STORAGE_KEY, forceBrowserHistoryUrlFallback ? "1" : "0");
    void trackerClient.setDeveloperDiagnostics?.(developerDiagnosticsSettings).catch((nextError) => {
      console.warn("Failed to persist tracker developer diagnostics", nextError);
    });
  }, [devModeEnabled, effectiveEnhancedContextSettings, forceBrowserHistoryUrlFallbackEnabled, forceChromiumAxCaptureEnabled, forceFrontmostFallbackCaptureEnabled]);

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
    if (autoUpdateLaunchCheckScheduledRef.current) return undefined;
    autoUpdateLaunchCheckScheduledRef.current = true;

    let checkStarted = false;
    const timeoutId = window.setTimeout(() => {
      checkStarted = true;
      void handleCheckForUpdates("automatic");
    }, AUTO_UPDATE_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      if (!checkStarted) autoUpdateLaunchCheckScheduledRef.current = false;
    };
  }, [handleCheckForUpdates]);

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

    void listenToNativeEndOfDayReviewDisplayed((day) => {
      window.localStorage.setItem(END_OF_DAY_REVIEW_STORAGE_KEY, day);
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
    if (!driftAlertsEnabled) {
      recordDriftAlarmDebugEvent({
        kind: "evaluation_skipped",
        reason: "disabled",
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({ kind: "disabled" }, null);
      pendingDriftAlarmGateRef.current = null;
      lastEligibleDriftCandidateRef.current = null;
      driftAlarmSessionProtectionRef.current = null;
      clearPendingTransientDriftAlarm();
      return;
    }
    if (!status?.running) {
      publishEvaluationDriftAlarmTrayStatus({ kind: "tracker_paused" }, null);
      clearPausedDriftAlarmRuntime();
      return;
    }

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
    const driftAlarmSegments = liveSegments.length > 0
      ? mergeDriftAlarmSegments(baseSegments, liveSegments)
      : baseSegments;
    const driftAlarmClassificationOptions = {
      fallbackCandidates: driftAlarmSegments,
      includeAiClassifications: showAiClassificationImpact,
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
      clearPendingTransientDriftAlarm();
      publishEvaluationDriftAlarmTrayStatus({
        kind: "snoozed",
        detail: `Until ${formatTimeLabel(new Date(activeSnooze.untilMs))}`,
      }, checkedAt);
      if (Date.now() < activeSnooze.untilMs) return;
      return;
    }

    if (!latestDrift) {
      const liveAiCandidate = systemTransientActivity === null && (localAiClassificationOptions || canUseCloudAiClassification)
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
          const liveAiOptions = localAiClassificationOptions
            ? { ...localAiClassificationOptions, persistLiveResult: true, contextSegments: driftAlarmSegments }
            : { persistLiveResult: true, contextSegments: driftAlarmSegments };
          const liveAiProviderKind = toAiProviderAnalytics(Boolean(localAiClassificationOptions), canUseCloudAiClassification);
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
                capturePostHogEvent("ai_classification_run", {
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
                capturePostHogEvent("ai_classification_run", {
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
            capturePostHogEvent("ai_classification_run", {
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
          liveAiAvailable: Boolean(localAiClassificationOptions || canUseCloudAiClassification),
          systemTransientActivity,
        }),
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({ kind: "no_candidate" }, checkedAt);
      pendingDriftAlarmGateRef.current = null;
      lastEligibleDriftCandidateRef.current = null;
      clearPendingTransientDriftAlarm();
      lastDriftAlertSegmentRef.current = null;
      petInterceptedSegmentRef.current = null;
      if (driftAlarmSnoozeRef.current !== null) {
        driftAlarmSnoozeRef.current = null;
        setDriftAlarmSnooze(null);
      }
      return;
    }

    const { alertKey } = latestDrift;
    let deliveryCandidate = latestDrift;
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
      lastEligibleDriftCandidateRef.current = null;
      lastDriftAlertSegmentRef.current = null;
      petInterceptedSegmentRef.current = null;
      clearPendingTransientDriftAlarm();
      publishEvaluationDriftAlarmTrayStatus({
        kind: "suppressed",
        reason: sessionProtectionReason,
        candidateDetail,
      }, checkedAt);
      return;
    }
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
    const buildCurrentDriftAlarmEvent = (
      focusTargets: readonly DriftAlarmFocusTarget[] = availableDriftAlarmFocusTargetsForAlarm,
      petIntercepted = false,
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
        sourceSegmentId,
        decisionClassification: confirmedDecisionClassification,
        petIntercepted,
      });
    };
    const showCurrentDriftAlarm = (petIntercepted = false) => {
      showDriftAlarm(buildCurrentDriftAlarmEvent(availableDriftAlarmFocusTargetsForAlarm, petIntercepted));
    };
    const markCurrentDriftAlarmDelivered = () => {
      recordDriftAlarmDebugEvent({
        kind: "delivery_delivered",
        alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      publishEvaluationDriftAlarmTrayStatus({ kind: "delivered", candidateDetail }, checkedAt);
    };
    const showFallbackDriftAlarm = (notify: boolean, petIntercepted = false) => {
      showCurrentDriftAlarm(petIntercepted);
      markCurrentDriftAlarmDelivered();
      if (notify) {
        recordDriftAlarmDebugEvent({
          kind: "native_notification_requested",
          alertKey,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        void sendDriftNotification(segment, driftAlarmCopy).catch((error: unknown) => {
          recordDriftAlarmDebugEvent({
            kind: "native_notification_failed",
            alertKey,
            message: toErrorMessage(error),
            candidate: summarizeDriftAlarmCandidate(latestDrift),
            evaluation,
          });
        });
      }
    };
    const applyCurrentExtremeNudge = (notifyOnFallback: boolean) => {
      lastDriftAlertSegmentRef.current = alertKey;
      // One caught cat per drift stretch keeps the reprieve meaningful without
      // letting it become permanent: this round stays quiet, and the next poll
      // sends the cat again if the drift is still going.
      if (petInterceptedSegmentRef.current === (deliverySourceSegmentId ?? segment.id)) {
        petInterceptedSegmentRef.current = null;
        // The alert key now stays stable for the whole continuous episode.
        // Re-open the gate after spending this one-poll reprieve so catching
        // the cat cannot silence an episode forever.
        lastDriftAlertSegmentRef.current = null;
        recordDriftAlarmDebugEvent({
          kind: "extreme_nudge_result",
          alertKey,
          result: "not_applied",
          reason: "pet_intercept_reprieve",
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        return;
      }
      recordDriftAlarmDebugEvent({
        kind: "extreme_nudge_started",
        alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      const runExtremeNudge = async () => {
        if (petModeActive) {
          const intervention = await playNativePetModeIntervention(buildPetModeInterventionTarget({
            id: alertKey,
            appName: segment.appName,
            browserName: segment.browserName,
          }));
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
          // Focus or another non-drift context can become current during the
          // native approach. That is neither a catch nor a technical failure:
          // the target is no longer current, so do not close it in the
          // background and do not spend the user's one-round catch reprieve.
          if (intervention.outcome === "cancelled") {
            return { applied: false, diagnostic: "pet_context_changed" } as const;
          }
          // The renderer can observe broad context changes, but it does not
          // receive the exact local activity identity. Re-check after every
          // approach (including an 8s timeout) so a tab/app that was current
          // before the animation can never be closed after the user moved on.
          const postInterventionGateResult = await confirmFreshDriftAlarmCandidate();
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
        }
        return applyNativeExtremeNudge(buildExtremeNudgeTarget(segment, {
          forceChromiumAxTabClose: DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxExtremeNudgeEnabled,
        }));
      };
      void runExtremeNudge().then(async (result) => {
        recordDriftAlarmDebugEvent({
          kind: "extreme_nudge_result",
          alertKey,
          result: result.applied ? "applied" : "not_applied",
          reason: result.diagnostic,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        if (!result.applied) {
          if (lastDriftAlertSegmentRef.current === alertKey) {
            const intercepted = result.diagnostic === "pet_intercepted";
            const targetChanged = result.diagnostic === "pet_context_changed"
              || result.diagnostic === "pet_target_changed";
            if (targetChanged) {
              lastDriftAlertSegmentRef.current = null;
              petInterceptedSegmentRef.current = null;
              publishEvaluationDriftAlarmTrayStatus({
                kind: "suppressed",
                reason: result.diagnostic,
                candidateDetail,
              }, new Date());
              return;
            }
            if (intercepted) {
              petInterceptedSegmentRef.current = deliverySourceSegmentId ?? segment.id;
              // Let the next poll consume the promised one-round reprieve.
              lastDriftAlertSegmentRef.current = null;
            }
            // A caught cat is a deliberate user signal, not a delivery failure.
            // Reuse the same alarm surface, but never fire an OS notification
            // on top of it: the user is already looking at the screen and has a
            // hand on the pointer.
            showFallbackDriftAlarm(intercepted ? false : notifyOnFallback, intercepted);
          }
          return;
        }
        let resolvedDriftAlarmFocusTargets = availableDriftAlarmFocusTargetsForAlarm;
        try {
          resolvedDriftAlarmFocusTargets = await resolveAvailableFocusTargets(driftAlarmFocusTargets);
        } catch (error: unknown) {
          if (error instanceof Error) {
            console.warn("Failed to resolve current drift alarm focus target availability", error);
          } else {
            console.warn("Failed to resolve current drift alarm focus target availability", String(error));
          }
        }
        const driftAlarmEvent = buildCurrentDriftAlarmEvent(resolvedDriftAlarmFocusTargets);
        lastDriftAlarmEventRef.current = driftAlarmEvent;
        const latestFocusTarget = resolvedDriftAlarmFocusTargets[0] ?? null;
        void showNativeExtremeNudgeToast(buildExtremeNudgeToastEvent(segment, latestFocusTarget, driftAlarmCopy, driftAlarmEvent.breakOptions)).catch((error) => console.warn("Failed to show extreme nudge toast", error));
        markCurrentDriftAlarmDelivered();
        if (latestFocusTarget) {
          window.setTimeout(() => {
            if (lastDriftAlertSegmentRef.current === alertKey) returnToFocusTarget(latestFocusTarget);
          }, 120);
        }
      }).catch((error) => {
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
        if (lastDriftAlertSegmentRef.current === alertKey) {
          showFallbackDriftAlarm(notifyOnFallback);
        }
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

      const freshCandidate = resolveFreshDriftAlarmCandidate({
        candidate: latestDrift,
        segments: driftAlarmSegments,
        currentSnapshot: freshSnapshot,
        classificationOptions: driftAlarmClassificationOptions,
        minimumDurationSeconds: driftAlertDelaySeconds,
      });
      if (freshCandidate) {
        deliveryCandidate = freshCandidate;
        ({ category, segment } = deliveryCandidate);
        deliveryDriftDurationSeconds = deliveryCandidate.driftDurationSeconds;
        deliverySourceSegmentId = deliveryCandidate.sourceSegmentId;
        confirmedDecisionClassification = deliveryCandidate.classification;
      }
      const result = freshCandidate ? "confirmed" : freshSnapshot ? "current-window-changed" : "current-snapshot-unavailable";
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

    const deliverCurrentDriftAlarm = () => {
      recordDriftAlarmDebugEvent({
        kind: "delivery_started",
        alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      const pendingBreakReturnAlarm = pendingBreakReturnAlarmRef.current;
      if (pendingBreakReturnAlarm) {
        const outcome = resolveBreakRecoveryOutcome({
          attempt: pendingBreakReturnAlarm,
          driftCandidate: deliveryCandidate,
          nowMs: Date.now(),
        });
        if (outcome) completeBreakRecoveryAssessment(pendingBreakReturnAlarm, outcome);
        const focusTargets = pendingBreakReturnAlarm.focusTargets.length
          ? pendingBreakReturnAlarm.focusTargets
          : availableDriftAlarmFocusTargetsForAlarm;
        const breakReturnContextLabel = getWatcherContextLabel(segment, category);
        const breakReturnSiteDomain = segment.siteDomain?.trim() ?? null;
        const breakReturnAppName = segment.appName.trim() || "Unknown app";
        const breakReturnIconKey = segment.bundleId?.trim() ?? breakReturnAppName;
        const breakReturnIconSrc = (breakReturnSiteDomain ? siteIconsRef.current[breakReturnSiteDomain.toLowerCase()] : null)
          ?? appIconsRef.current[breakReturnIconKey]
          ?? appIconsRef.current[breakReturnAppName]
          ?? null;

        showDriftAlarm(buildBreakReturnAlarmEvent({
          id: `break-return:${alertKey}:${pendingBreakReturnAlarm.untilMs}`,
          contextLabel: breakReturnContextLabel,
          driftDurationSeconds: deliveryDriftDurationSeconds,
          preservedFocusStrikeSeconds: 0,
          generatedAt: new Date().toISOString(),
          focusTargets,
          sourceSiteDomain: breakReturnSiteDomain,
          sourceAppName: breakReturnAppName,
          sourceIconSrc: breakReturnIconSrc,
          copySettings: driftAlarmCopy,
          sourceSegmentId: deliverySourceSegmentId ?? segment.id,
          decisionClassification: confirmedDecisionClassification,
          breakDurationMinutes: pendingBreakReturnAlarm.minutes,
          pausedFromLabel: pendingBreakReturnAlarm.pausedFromLabel,
          nextFocusLabel: focusTargets[0]?.label ?? "your focus",
        }));
        pendingBreakReturnAlarmRef.current = null;
        lastDriftAlertSegmentRef.current = alertKey;
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

      const shouldApplyExtremeNudge = extremeNudgeEnabled && canApplyExtremeNudgeToCategory(category);
      if (lastDriftAlertSegmentRef.current === null) {
        if (shouldApplyExtremeNudge) {
          applyCurrentExtremeNudge(false);
          return;
        }
        lastDriftAlertSegmentRef.current = alertKey;
        showCurrentDriftAlarm();
        markCurrentDriftAlarmDelivered();
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
      recordDriftAlarmDebugEvent({
        kind: "native_notification_requested",
        alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      void sendDriftNotification(segment, driftAlarmCopy).catch((error: unknown) => {
        recordDriftAlarmDebugEvent({
          kind: "native_notification_failed",
          alertKey,
          message: toErrorMessage(error),
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
      });
    };

    if (lastDriftAlertSegmentRef.current === alertKey && !pendingBreakReturnAlarmRef.current) {
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
    }

    pendingDriftAlarmGateRef.current = alertKey;
    recordDriftAlarmDebugEvent({
      kind: "youtube_gate_started",
      alertKey,
      candidate: summarizeDriftAlarmCandidate(latestDrift),
      evaluation,
    });
    publishEvaluationDriftAlarmTrayStatus({ kind: "checking", candidateDetail }, checkedAt);
    void evaluateYouTubeDriftAlarmGate({
      segment,
      category,
      aiOptions: localAiClassificationOptions,
    }).then(async (gateResult) => {
      if (pendingDriftAlarmGateRef.current !== alertKey) return;
      recordDriftAlarmDebugEvent({
        kind: "youtube_gate_result",
        alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        ai: summarizeYouTubeDriftAlarmGateResult(gateResult),
        evaluation,
      });

      if (gateResult.kind === "suppress") {
        pendingDriftAlarmGateRef.current = null;
        lastDriftAlertSegmentRef.current = alertKey;
        recordDriftAlarmDebugEvent({
          kind: "delivery_suppressed",
          alertKey,
          reason: gateResult.reason,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          ai: summarizeYouTubeDriftAlarmGateResult(gateResult),
          evaluation,
        });
        publishEvaluationDriftAlarmTrayStatus({
          kind: "suppressed",
          reason: gateResult.reason,
          candidateDetail,
        }, checkedAt);
        return;
      }

      const finalGateResult = await confirmFreshDriftAlarmCandidate();
      if (pendingDriftAlarmGateRef.current !== alertKey) return;
      pendingDriftAlarmGateRef.current = null;

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

      deliverCurrentDriftAlarm();
    }).catch((error) => {
      if (error instanceof Error) {
        console.warn("Failed to evaluate YouTube drift alarm AI gate", error);
      }
      if (pendingDriftAlarmGateRef.current !== alertKey) return;
      pendingDriftAlarmGateRef.current = null;
      lastDriftAlertSegmentRef.current = alertKey;
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
  }, [availableDriftAlarmFocusTargets, canUseCloudAiClassification, classificationRules, devModeEnabled, driftAlertDelaySeconds, driftAlertsEnabled, driftAlarmCopy, driftAlarmSnooze, extremeNudgeEnabled, forceChromiumAxExtremeNudgeEnabled, localAiClassificationOptions, petModeActive, publishDriftAlarmTrayStatus, recordBreakRecoveryOutcome, refreshLiveDriftAlarmActivity, returnToFocusTarget, showAiClassificationImpact, showDriftAlarm, startOfDayMinutes, status?.running]);

  useEffect(() => {
    evaluateDriftAlarmRef.current = evaluateDriftAlarm;
  }, [evaluateDriftAlarm]);

  useEffect(() => {
    if (!status) return;
    if (status.running !== true) {
      if (driftAlertsEnabled) {
        clearPausedDriftAlarmRuntime();
        publishDriftAlarmTrayStatus({ kind: "tracker_paused" }, null);
      }
      return;
    }
    if (selectedDay !== currentDriftAlarmDay()) return;

    evaluateDriftAlarm({
      snapshot: currentSnapshot,
      liveSegments: liveDriftAlarmSegmentsRef.current,
    });
  }, [currentSnapshot, driftAlertsEnabled, evaluateDriftAlarm, publishDriftAlarmTrayStatus, selectedDay, status?.running]);

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((v) => !v); }
      if (e.key === "Escape") setCmdOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
  }, [selectedDay, showAiClassificationImpact, showWatcherPeek, status?.running, todayDay, watcherMode, watcherPeekEnabled, watcherPeriodicMaxMinutes, watcherPeriodicMinMinutes]);

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
  const dashboardWeekCompactHistoryLoad = dashPeriod === "Week"
    ? findFreshCompactHistoryLoad(compactHistoryCacheRef.current, dashboardWeekHistoryRange)
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
  const dashboardPreviousWeekFocusKey = `${dashboardPreviousWeekRange.start}:${dashboardPreviousWeekRange.end}:${showAiClassificationImpact}`;
  const dashboardPreviousDayRange = useMemo(() => {
    const day = shiftIsoDate(selectedDay, -1);
    return {
      day,
      ...getLogicalDayRange(day, day, startOfDayMinutes),
    };
  }, [selectedDay, startOfDayMinutes]);
  const dashboardPreviousDayFocusKey = `${dashboardPreviousDayRange.start}:${dashboardPreviousDayRange.end}:${showAiClassificationImpact}`;
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
  // Device filter choke point: every dashboard view model (day flow, week,
  // stats) derives from these two arrays, so filtering here covers them all.
  const effectiveSelectedDaySegments = useMemo(
    () => filterSegmentsByDevice(unfilteredEffectiveSelectedDaySegments, deviceTimelineFilter),
    [deviceTimelineFilter, unfilteredEffectiveSelectedDaySegments],
  );
  const effectiveDashboardSegments = useMemo(
    () => filterSegmentsByDevice(unfilteredEffectiveDashboardSegments, deviceTimelineFilter),
    [deviceTimelineFilter, unfilteredEffectiveDashboardSegments],
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
  const weekRefreshStatus: DashboardWeekRefreshStatus = dashPeriod !== "Week" || dashboardWeekCompactHistoryLoad
    ? "idle"
    : dashboardWeekRefreshState.key === dashboardWeekRefreshKey
      ? dashboardWeekRefreshState.status
      : "loading";
  const dashboardClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: effectiveDashboardSegments, includeAiClassifications: showAiClassificationImpact }),
    [effectiveDashboardSegments, showAiClassificationImpact],
  );
  const effectiveSelectedDayClassificationOptions = useMemo<ClassificationOptions>(
    () => buildSelectedDayDashboardClassificationOptions({
      fallbackCandidates: effectiveSelectedDaySegments,
      includeAiClassifications: showAiClassificationImpact,
      rules: classificationRules,
    }),
    [classificationRules, effectiveSelectedDaySegments, showAiClassificationImpact],
  );
  const dashboardActiveDays = useMemo(
    () => buildDailyTotals(effectiveDashboardSegments, effectiveDashboardRange.startDay, effectiveDashboardRange.endDay, startOfDayMinutes).filter((day) => day.totalSeconds > 0).length,
    [effectiveDashboardRange.endDay, effectiveDashboardRange.startDay, effectiveDashboardSegments, startOfDayMinutes],
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
    () => ({ fallbackCandidates: activeInsightSegments, includeAiClassifications: showAiClassificationImpact }),
    [activeInsightSegments, showAiClassificationImpact],
  );
  const productivityPersonaReport = useMemo(
    () => buildProductivityPersona(activeInsightSegments, insightClassificationOptions),
    [activeInsightSegments, insightClassificationOptions],
  );
  const historyClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: historySegments, includeAiClassifications: showAiClassificationImpact }),
    [historySegments, showAiClassificationImpact],
  );
  const weekDashboardPrewarmSegments = dashboardWeekCompactHistoryLoad?.materialized.segments ?? historySegments;
  const shouldPrewarmWeekDashboard = dashboardWeekCompactHistoryLoad !== null || historySegments.length > 0;
  const weekDashboardPrewarmClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: weekDashboardPrewarmSegments, includeAiClassifications: showAiClassificationImpact }),
    [showAiClassificationImpact, weekDashboardPrewarmSegments],
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
    { includeAiClassifications: showAiClassificationImpact, startOfDayMinutes },
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
      })
      : null;
  const dashboardAiRecoveryKey = dashboardAiUnavailableState && isCloudBillingVariant(dashboardAiUnavailableState.variant)
    ? dashboardAiUnavailableState.variant
    : null;
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
    || cmdOpen,
  );
  const visibleUpdate = updateDialogBlocked || !shouldShowAvailableUpdateDialog ? null : availableUpdate;
  const titlebarUpdate = updateDialogBlocked || visibleUpdate ? null : availableUpdate;
  const latestBuildPromptUpdate = developerPreReleaseUpdateController.promptUpdate;

  const dayTotalSeconds = useMemo(() => totalDurationSeconds(segments), [segments]);
  const selectedDayProductivityTotals = useMemo(
    () => buildProductivityDurations(segments, selectedDayClassificationOptions),
    [segments, selectedDayClassificationOptions],
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
  const watcherSnapshot = useMemo(() => buildWatcherSnapshot(segments, selectedDayClassificationOptions), [selectedDayClassificationOptions, segments]);
  useEffect(() => { watcherSnapshotRef.current = watcherSnapshot; }, [watcherSnapshot]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const snapshot = petModeActive ? buildPetModeSnapshot(watcherSnapshot) : null;
    const revealRevision = petModeRevealRevision;
    const forceReveal = petModeActive
      && revealRevision > handledPetModeRevealRevisionRef.current
      && !pendingPetModeRevealRevisionsRef.current.has(revealRevision);
    if (forceReveal) pendingPetModeRevealRevisionsRef.current.add(revealRevision);
    const reducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { width, height } = getPetModeWindowSize(petModeSize);
    void setNativePetModeEnabled(
      petModeActive,
      snapshot,
      reducedMotion,
      width,
      height,
      forceReveal,
    ).then(() => {
      if (!forceReveal) return;
      pendingPetModeRevealRevisionsRef.current.delete(revealRevision);
      petModeRevealRetryAttemptsRef.current.delete(revealRevision);
      handledPetModeRevealRevisionRef.current = Math.max(
        handledPetModeRevealRevisionRef.current,
        revealRevision,
      );
    }).catch((nextError) => {
      console.warn("Failed to sync Pet Mode window", nextError);
      if (!forceReveal) return;
      pendingPetModeRevealRevisionsRef.current.delete(revealRevision);
      const retryAttempts = petModeRevealRetryAttemptsRef.current.get(revealRevision) ?? 0;
      if (
        petModeSyncMountedRef.current
        && revealRevision <= latestPetModeRevealRevisionRef.current
        && revealRevision > handledPetModeRevealRevisionRef.current
        && retryAttempts < 1
      ) {
        // A failed Tauri call must not spend the user's explicit Show request.
        // Retry once; another click creates a new revision and remains usable.
        petModeRevealRetryAttemptsRef.current.set(revealRevision, retryAttempts + 1);
        setPetModeSyncRetryNonce((nonce) => nonce + 1);
      }
    });
  }, [petModeActive, petModeRevealRevision, petModeSize, petModeSyncRetryNonce]);
  useEffect(() => {
    if (!petModeActive || !isTauriRuntime()) return;
    void updateNativePetMode(buildPetModeSnapshot(watcherSnapshot)).catch((nextError) => {
      console.warn("Failed to update Pet Mode snapshot", nextError);
    });
  }, [petModeActive, watcherSnapshot]);
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
     to belong to today; see canEvaluateCompanionDailyFocus. */
  const companionDailyFocusEvaluable = canEvaluateCompanionDailyFocus({
    loaded: hasLoadedOnce,
    blocked: shouldBlockLocalTrackerAccess,
    viewingToday: selectedDay === todayDay,
    segmentsLoadedDay,
    day: todayDay,
  });
  const companionTodaySnapshot = useMemo(() => {
    const todaySegments = selectedDay === todayDay ? segments : driftAlarmBaseSegmentsRef.current;
    if (currentSnapshot) {
      return buildWatcherSnapshotFromCurrent(
        currentSnapshot,
        todaySegments,
        null,
        selectedDayClassificationOptions,
      );
    }
    return selectedDay === todayDay
      ? watcherSnapshot
      : buildWatcherSnapshot(todaySegments, selectedDayClassificationOptions);
  }, [currentSnapshot, segments, selectedDay, selectedDayClassificationOptions, todayDay, watcherSnapshot]);

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
    && !isInitialDailyFocusQuietPeriod(onboardingCompletedAt);

  useCompanionCommunityMilestones({
    ready: companionDailyFocusEvaluable && isSupabaseConfigured && !shouldUsePreviewData(),
    day: todayDay,
    focusSecondsToday: companionTodaySnapshot.focusSecondsToday,
    announcementsEnabled: companionAchievementAnnouncementsEnabled,
  });

  useCompanionDailyFocusMilestones({
    ready: companionDailyFocusEvaluable,
    day: todayDay,
    focusSecondsToday: companionTodaySnapshot.focusSecondsToday,
    /* Visibility controls only the resident capsule. A milestone is an alert,
       so a running tracker may announce it through the standalone surface. */
    announcementsEnabled: companionAchievementAnnouncementsEnabled,
  });

  useCompanionReentryMoment({
    ready: hasLoadedOnce && !shouldBlockLocalTrackerAccess,
    announcementsEnabled: companionResidentMomentsEnabled && status?.running === true,
    activitySignal: status?.lastEventAt ?? currentSnapshot?.observedAt ?? null,
    locale: localization.effectiveLanguage === "ko" ? "ko-KR" : "en-US",
  });

  useCompanionFocusRunMilestones({
    ready: companionDailyFocusEvaluable,
    day: todayDay,
    startOfDayMinutes,
    currentRunSeconds: companionTodaySnapshot.focusStrikeSeconds ?? 0,
    classificationOptions: companionFocusRecordClassificationOptions,
    announcementsEnabled: companionAchievementAnnouncementsEnabled,
  });

  useCompanionLeaderboardMilestones({
    ready: isSupabaseConfigured && isPolicySignedIn && !shouldUsePreviewData(),
    userScopeKey: user?.id ?? null,
    calendarDay: localDateKey(new Date()),
    startOfDayMinutes,
    startOfWeek,
    announcementsEnabled: true,
    publishCheckpoint: publishLeaderboardCheckpoint,
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
  const selectedDayLabel = formatDayLabel(selectedDay);
  const aiClassificationUsageDayLabel = formatDayLabel(aiClassificationUsageDay ?? selectedDay);
  const aiClassificationCostProjection = useMemo(
    () => projectAiClassificationCost(aiClassificationUsage, classificationMetrics),
    [aiClassificationUsage, classificationMetrics],
  );
  const selectedDayContext = describeRelativeDay(selectedDay, startOfDayMinutes);
  const classificationWeekRange = useMemo(() => getDashboardPeriodRange(selectedDay, "Week", startOfDayMinutes, startOfWeek), [selectedDay, startOfDayMinutes, startOfWeek]);
  const shouldBuildClassificationModels = activeTab === "classification";
  const classificationSegments = useMemo(() => (
    shouldBuildClassificationModels && classificationRange === "Week"
      ? filterSegmentsForRange(historySegments, classificationWeekRange.start, classificationWeekRange.end)
      : shouldBuildClassificationModels ? segments : EMPTY_ACTIVITY_SEGMENTS
  ), [classificationRange, classificationWeekRange.end, classificationWeekRange.start, historySegments, segments, shouldBuildClassificationModels]);
  const classificationRuleSegments = useMemo(() => {
    if (classificationSegments.length === 0) return segments;
    if (segments.length === 0) return classificationSegments;
    const seenIds = new Set(classificationSegments.map((segment) => segment.id));
    return [
      ...classificationSegments,
      ...segments.filter((segment) => !seenIds.has(segment.id)),
    ];
  }, [classificationSegments, segments]);
  const classificationTotalSeconds = useMemo(() => totalDurationSeconds(classificationSegments), [classificationSegments]);
  const classificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: classificationSegments, includeAiClassifications: showAiClassificationImpact }),
    [classificationSegments, showAiClassificationImpact],
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
  const liveAppLabel = status?.running && currentSnapshot?.appName ? currentSnapshot.appName : topAppLabel;
  const liveSiteLabel = status?.running ? (currentSnapshot?.siteDomain || currentSnapshot?.siteTitle || null) : null;
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
      : isTrackerDegraded
        ? localization.t("tracker.retry")
        : status.running
          ? localization.t("tracker.pause")
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
  const sidebarTrackerIndicatorClassName = replaySidebarTrackerCard?.indicatorClassName ?? (status?.running ? (isTrackerIdle ? "idle" : "tracking") : isTrackerUnavailable || isTrackerDegraded ? "unavailable" : "idle");
  const sidebarTrackerCollapsedLabel = replaySidebarTrackerCard?.collapsedLabel ?? (status?.running ? (isTrackerIdle ? localization.t("tracker.idleNow") : localization.t("tracker.nowTracking")) : isTrackerUnavailable ? localization.t("tracker.unavailable") : isTrackerDegraded ? localization.t("tracker.needsAttention") : localization.t("tracker.paused"));
  const sidebarTrackerStatusLabel = replaySidebarTrackerCard?.statusLabel ?? (isTrackerUnavailable ? localization.t("tracker.setupNeeded") : isTrackerDegraded ? (status?.message ?? localization.t("tracker.couldNotStart")) : trackerStateLabel);
  const sidebarTrackerDurationLabel = replaySidebarTrackerCard?.durationLabel ?? (isTrackerUnavailable || isTrackerDegraded ? null : formatDuration(dayTotalSeconds));
  const sidebarTrackerAppLabel = replaySidebarTrackerCard?.appLabel ?? (isTrackerUnavailable ? localization.t("tracker.startToCollect") : isTrackerDegraded ? localization.t("tracker.retryActivity") : liveAppLabel);
  const sidebarTrackerSiteLabel = replaySidebarTrackerCard?.siteLabel ?? liveSiteLabel;
  const sidebarTrackerMetaLabel = replaySidebarTrackerCard?.metaLabel ?? localization.t("tracker.lastCapture", { time: lastCaptureDistanceLabel });
  const sidebarTrackerActionLabel = replaySidebarTrackerCard?.actionLabel ?? liveTrackerActionLabel;
  const isSidebarTrackerActionDisabled = replaySidebarTrackerCard === null && (isTrackerUnavailable || trackerPausePending);

  const activeSlots = dayField.filter((slot) => slot.totalSeconds > 0);
  const activeHours = Array.from(new Set(activeSlots.map((slot) => slot.hour)));
  const activeHourCount = activeHours.length;
  const peakSlot = dayField.reduce((cur, slot) => (slot.totalSeconds > cur.totalSeconds ? slot : cur), dayField[0]);
  const peakTrackedSeconds = peakSlot?.totalSeconds ?? 0;
  const peakWindowLabel = peakTrackedSeconds > 0 ? formatQuarterHourLabel(peakSlot.minuteOfDay) : "\u2014";
  const isCurrentClassificationRange = classificationRange === "Week"
    ? classificationWeekRange.startDay <= todayDay && todayDay <= classificationWeekRange.endDay
    : isTodaySelected;
  const rawNextClassificationDay = shiftIsoDate(selectedDay, classificationRange === "Week" ? 7 : 1);
  const canShiftClassificationForward = classificationRange === "Week"
    ? getDashboardPeriodRange(rawNextClassificationDay, "Week", startOfDayMinutes, startOfWeek).startDay <= todayDay
    : rawNextClassificationDay <= todayDay;
  const classificationDateLabel = classificationRange === "Week" ? formatDateRangeLabel(classificationWeekRange.startDay, classificationWeekRange.endDay) : selectedDayLabel;
  const isCurrentDashboardPeriod = dashPeriod === "Week"
    ? dashboardRange.startDay <= todayDay && todayDay <= dashboardRange.endDay
    : isTodaySelected;
  const nextDashboardDay = shiftDashboardPeriodDay(selectedDay, dashPeriod, 1);
  const canShiftDashboardForward = dashPeriod === "Week"
    ? getDashboardPeriodRange(nextDashboardDay, dashPeriod, startOfDayMinutes, startOfWeek).startDay <= todayDay
    : nextDashboardDay <= todayDay;
  const nextInsightDay = shiftInsightPeriodDay(selectedDay, trendsRange, 1);
  const canShiftInsightForward = nextInsightDay <= todayDay;
  const dashboardDateLabel = dashPeriod === "Week" ? formatDateRangeLabel(dashboardRange.startDay, dashboardRange.endDay) : selectedDayLabel;
  const insightDateLabel = formatDateRangeLabel(insightRange.startDay, insightRange.endDay);
  const shouldShowEndOfDayReviewPreview = END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED && isDevModeActive && import.meta.env.VITE_DRIFTY_END_OF_DAY_REVIEW_PREVIEW === "1";

  useEffect(() => {
    if (!END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED) return;
    if (!isDevModeActive) return;
    if (!hasLoadedOnce) return;
    if (endOfDayReviewQueryPreviewShownRef.current) return;
    if (!shouldShowEndOfDayReviewPreview && new URLSearchParams(window.location.search).get("driftyEndOfDayReviewPreview") !== "1") return;

    endOfDayReviewQueryPreviewShownRef.current = true;
    void buildEndOfDayReviewEvent({
      day: todayDay,
      generatedAt: new Date().toISOString(),
      segments: buildMockEndOfDayReviewSegments(todayDay),
      isMock: true,
    }).then(showEndOfDayReview);
  }, [buildEndOfDayReviewEvent, hasLoadedOnce, isDevModeActive, showEndOfDayReview, shouldShowEndOfDayReviewPreview, todayDay]);

  useEffect(() => {
    if (!END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED) return;
    if (!hasLoadedOnce) return;
    if (selectedDay !== todayDay || segmentsLoadedDay !== todayDay) return;
    if (!status?.running) return;
    if (currentMinuteOfDay === null || currentMinuteOfDay < END_OF_DAY_REVIEW_TRIGGER_MINUTE) return;
    if (endOfDayReviewAutomaticInFlightRef.current) return;

    const reviewShown = window.localStorage.getItem(END_OF_DAY_REVIEW_STORAGE_KEY) === todayDay;
    const leaderboardCheckpointDone =
      window.localStorage.getItem(END_OF_DAY_LEADERBOARD_CHECKPOINT_STORAGE_KEY) === todayDay;
    if (reviewShown && leaderboardCheckpointDone) return;
    if (segments.length === 0) return;

    /* The review waits until the day has enough tracked time to say anything
       honest about; from the evening trigger until the logical day rolls
       over, the first evaluation that finds the bar crossed fires. Thin days
       are skipped silently. The leaderboard checkpoint keeps its own once-a-
       day marker so a skipped review never suppresses the publish. */
    const trackedSeconds = sumEndOfDayReviewTrackedSeconds(segments);
    const reviewDue = !reviewShown
      && isInstallDayReviewEligible(onboardingCompletedAt, todayDay, startOfDayMinutes)
      && trackedSeconds >= END_OF_DAY_REVIEW_MIN_TRACKED_SECONDS;
    if (!reviewDue && leaderboardCheckpointDone) return;

    if (reviewDue) {
      const lastPresentedAt = endOfDayReviewLastPresentedAtRef.current;
      if (lastPresentedAt !== null && Date.now() - lastPresentedAt < END_OF_DAY_REVIEW_REPRESENT_COOLDOWN_MS) return;
    }

    endOfDayReviewAutomaticInFlightRef.current = true;
    void (async () => {
      if (!leaderboardCheckpointDone) {
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
        }
      }

      if (!reviewDue) return;

      let leaderboardCelebration: LeaderboardCelebration | undefined;
      try {
        if (isSupabaseConfigured && isPolicySignedIn && !shouldUsePreviewData()) {
          const checkpoint = await fetchOwnLeaderboardCheckpoint("daily", todayDay);
          if (checkpoint?.success) {
            leaderboardCelebration = toLeaderboardCelebration(
              checkpoint.data ?? null,
              "daily",
              todayDay,
            ) ?? undefined;
          }
        }
      } catch {
        leaderboardCelebration = undefined;
      }

      const event = await buildEndOfDayReviewEvent({
        day: todayDay,
        generatedAt: new Date().toISOString(),
        segments,
        leaderboardCelebration,
      });
      endOfDayReviewLastPresentedAtRef.current = Date.now();
      const shown = await showEndOfDayReview(event);
      /* The day is marked shown only when a surface confirms an actual
         visible display: in Tauri the pill/watcher overlay reports it (see
         useEndOfDayReviewDisplayedReporter), while the browser fallback
         renders the overlay into the visible main window, so a successful
         show is the confirmation. A presentation nobody saw leaves the day
         open for a fresh retry. */
      if (shown && !isTauriRuntime()) {
        window.localStorage.setItem(END_OF_DAY_REVIEW_STORAGE_KEY, todayDay);
      }
    })().finally(() => {
      endOfDayReviewAutomaticInFlightRef.current = false;
    });
  }, [buildEndOfDayReviewEvent, currentMinuteOfDay, hasLoadedOnce, isPolicySignedIn, isSupabaseConfigured, onboardingCompletedAt, publishLeaderboardCheckpoint, segments, segmentsLoadedDay, selectedDay, showEndOfDayReview, startOfDayMinutes, status?.running, syncLeaderboardPublication, todayDay]);

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
  const breakRecoveryInsight = useMemo(
    () => buildBreakRecoveryInsight({
      interactions: driftAlarmInteractions,
      rangeStart: insightRange.start,
      rangeEnd: insightRange.end,
    }),
    [driftAlarmInteractions, insightRange.end, insightRange.start],
  );
  const insightSiteSummary = insightTopSites.slice(0, 5);
  const dayRibbonSegments = useMemo(() => buildDayRibbonSegments(segments, selectedDay, selectedDayClassificationOptions, startOfDayMinutes), [selectedDayClassificationOptions, segments, selectedDay, startOfDayMinutes]);
  const selectedDayRange = useMemo(() => getLogicalDayRange(selectedDay, selectedDay, startOfDayMinutes), [selectedDay, startOfDayMinutes]);
  const analysisModel = useAnalysisModelSetup(isSupabaseConfigured, localAiSetup.provider);
  // One-shot: "AI setup" on the Projects page lands on the Intelligence tab.
  const [aiSetupRequestedTab, setAiSetupRequestedTab] = useState<"providers" | "intelligence" | null>(null);
  const projectClassification = useProjectClassification({
    tracker: trackerClient,
    selectedDayRange,
    startOfDayMinutes,
    insightRange: { start: insightRange.start, end: insightRange.end },
    analysisSetup: analysisModel.analysisSetup,
    resolveOpenRouterKey: analysisModel.resolveOpenRouterKey,
    analysisConnected: analysisModel.analysisConnected,
    onClassificationChanged: () => { void refreshHistoryData(); },
  });
  const [projectPassPrivacySettings, setProjectPassPrivacySettings] = useState(
    () => readAiPrivacyRequestSettings(),
  );
  useEffect(() => {
    const syncSettings = () => setProjectPassPrivacySettings(readAiPrivacyRequestSettings());
    window.addEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, syncSettings);
    return () => window.removeEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, syncSettings);
  }, []);
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
    if (available) meta.set(NO_PROJECT_KEY, { label: NO_PROJECT_LABEL, color: NO_PROJECT_SERIES_COLOR });
    return { series, meta, available };
  }, [insightProjectBySegmentId, insightProjectProjection.segments, projectClassification.projects]);
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
        entries.push({ projectId: null, name: FLOW_NO_PROJECT_LABEL, color: NO_PROJECT_COLOR });
      }
      return entries;
    },
    [projectClassification.projects, selectedDayProjectProjection.projectBySegmentId, selectedDayProjectProjection.segments],
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
      [flowIntervalMinutes, DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES],
      effectiveSelectedDayClassificationOptions,
      startOfDayMinutes,
      flowProjectColorBySegment,
      flowProjectIdBySegment,
      selectedDayProjectProjection.segments,
    );
    return [
      blocksByInterval.get(flowIntervalMinutes) ?? [],
      blocksByInterval.get(DASHBOARD_SUMMARY_FLOW_INTERVAL_MINUTES) ?? [],
    ] as const;
  }, [effectiveSelectedDayClassificationOptions, effectiveSelectedDaySegments, selectedDayProjectProjection.segments, flowIntervalMinutes, selectedDay, startOfDayMinutes, flowProjectColorBySegment, flowProjectIdBySegment]);
  const [projectPassConsented, setProjectPassConsented] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(PROJECT_PASS_CONSENT_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [projectPassConsentOpen, setProjectPassConsentOpen] = useState(false);
  const requestProjectPassRun = useCallback(() => {
    if (projectPassConsented) {
      void projectClassification.backfillLast7Days();
      return;
    }
    setProjectPassConsentOpen(true);
  }, [projectPassConsented, projectClassification]);
  const confirmProjectPassConsent = useCallback(() => {
    try {
      window.localStorage.setItem(PROJECT_PASS_CONSENT_STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setProjectPassConsented(true);
    setProjectPassConsentOpen(false);
    void projectClassification.backfillLast7Days();
  }, [projectClassification]);
  const analysisProviderLabel = analysisModel.analysisSetup.provider === "cloud"
    ? "Drifty Cloud"
    : analysisModel.analysisSetup.provider === "openrouter"
      ? `OpenRouter (${analysisModelDisplayLabel(analysisModel.analysisSetup.openRouterModel)})`
      : analysisModel.analysisSetup.provider === "openai"
        ? `OpenAI (${analysisModelDisplayLabel(analysisModel.analysisSetup.openaiModel)})`
        : analysisModel.analysisSetup.provider === "anthropic"
          ? `Anthropic (${analysisModelDisplayLabel(analysisModel.analysisSetup.anthropicModel)})`
          : "your custom endpoint";
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
  const dashboardEffectiveProductivityTotals = useMemo(
    () => buildEffectiveProductivityDurations(effectiveDashboardSegments, dashboardClassificationOptions),
    [dashboardClassificationOptions, effectiveDashboardSegments],
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

  const handleDeleteHistorySegments = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0 || historyDeleting) return;

    setHistoryDeleting(true);
    setError(null);
    try {
      await trackerClient.deleteActivitySegments(ids);
      clearLocalActivityCaches();
      const deletedIds = new Set(ids);
      setHistorySearchSegments((currentSegments) => currentSegments.filter((segment) => !deletedIds.has(segment.id)));
      await refresh(selectedDayRef.current);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setHistoryDeleting(false);
    }
  }, [clearLocalActivityCaches, historyDeleting, refresh]);

  const [deleteHistoryModalOpen, setDeleteHistoryModalOpen] = useState(false);

  const handleHistoryRangeDeleted = useCallback(async () => {
    clearLocalActivityCaches();
    setHistorySearchSegments([]);
    try {
      setClassificationMetrics(await trackerClient.getClassificationMetrics({ day: selectedDayRef.current }));
    } catch {
      // Metrics refresh is best-effort after a bulk delete; the views below still reload.
    }
    await refresh(selectedDayRef.current);
    await syncLeaderboardPublication("history_deleted", { bypassSlotGate: true });
    await refreshLeaderboardData();
  }, [clearLocalActivityCaches, refresh, refreshLeaderboardData, syncLeaderboardPublication]);

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

  const runAutoAiClassificationBatch = useCallback(async () => {
    if (!localAiClassificationOptions && !canUseCloudAiClassification) return;
    if (shouldBlockLocalTrackerAccess) return;
    if (!hasLoadedOnce) return;
    if (classificationActionLoading) return;
    // The first-day preparation gate is already classifying today in the foreground;
    // running the periodic batch concurrently would double-classify the same day.
    if (preparingFirstDay) return;
    if (aiClassificationInFlightRef.current) return;

    const today = logicalTodayIsoDate(startOfDayMinutes);
    const isFocused = rendererFocusedRef.current;
    const threshold = isFocused ? AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD : AI_CLASSIFICATION_BACKGROUND_THRESHOLD;
    if (isFocused && Date.now() - lastRendererInteractionAtRef.current < AI_CLASSIFICATION_FOCUSED_IDLE_MS) return;
    const providerKind = toAiProviderAnalytics(Boolean(localAiClassificationOptions), canUseCloudAiClassification);
    const trigger = isFocused ? "focused_idle" : "background_threshold";
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;

    aiClassificationInFlightRef.current = true;
    try {
      const query = toClassificationQueryForDay(today, threshold);
      const summary = localAiClassificationOptions
        ? await runAiClassificationForUnknownThreshold(query, threshold, localAiClassificationOptions)
        : await runAiClassificationForUnknownThreshold(query, threshold);
      if (localAiClassificationOptions) recordLocalAiClassificationSummary(summary);
      else recordCloudAiClassificationSummary(summary, cloudAiConnectionGeneration);
      if (summary.status === "empty" && summary.savedRecords === 0) return;
      if (selectedDayRef.current === today) {
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
      }
      captureAiClassificationRun(trigger, providerKind, "current_day", summary);
      if (summary.savedRecords > 0) {
        await syncLeaderboardPublication("classification_updated");
        await refreshLeaderboardData();
      }
    } catch (nextError) {
      const failure = localAiClassificationOptions
        ? { message: toErrorMessage(nextError), failureKind: "transport" as const }
        : await recordCloudAiClassificationError(nextError, cloudAiConnectionGeneration);
      if (localAiClassificationOptions) recordLocalAiClassificationError(failure.message);
      captureAiClassificationRun(trigger, providerKind, "current_day", {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        ...failure,
      });
      if (selectedDayRef.current === today) {
        setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, ...failure });
      }
    } finally {
      aiClassificationInFlightRef.current = false;
    }
  }, [canUseCloudAiClassification, classificationActionLoading, hasLoadedOnce, localAiClassificationOptions, preparingFirstDay, recordCloudAiClassificationError, recordCloudAiClassificationSummary, recordLocalAiClassificationError, recordLocalAiClassificationSummary, refreshLeaderboardData, rendererFocused, selectedDay, shouldBlockLocalTrackerAccess, startOfDayMinutes, syncLeaderboardPublication]);

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
  // fresh with an on-open tick + an hourly tick. Dev-preview + consent gated;
  // ticks are SILENT (runScheduledPass never pops the consent modal and never
  // disturbs the manual-run UI). runScheduledPass gets a fresh identity each
  // render (its `now` closure), so we call it through a ref and keep the effect's
  // deps stable — otherwise the interval would reset every render and never fire.
  const runScheduledProjectPassRef = useRef(projectClassification.runScheduledPass);
  useEffect(() => {
    runScheduledProjectPassRef.current = projectClassification.runScheduledPass;
  });
  const projectPassOpenTickedRef = useRef(false);
  useEffect(() => {
    if (isPreviewSurface) return undefined;
    if (!projectClassificationFeatureEnabled || !projectPassConsented) {
      projectPassOpenTickedRef.current = false; // re-enabling should re-tick on open
      return undefined;
    }
    const tick = (trigger: "schedule" | "open") => {
      const day = logicalTodayIsoDate(startOfDayMinutes);
      void runScheduledProjectPassRef.current(
        trigger,
        getLogicalDayRange(day, day, startOfDayMinutes),
      ).then((outcome) => {
        capturePostHogEvent(
          "project_classification_run",
          toScheduledProjectPassAnalytics(trigger, outcome),
        );
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
    if (analysisModel.analysisConnected && !projectPassOpenTickedRef.current) {
      projectPassOpenTickedRef.current = true;
      tick("open");
    }
    const intervalId = setInterval(() => tick("schedule"), PROJECT_PASS_SCHEDULE_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isPreviewSurface, projectClassificationFeatureEnabled, projectPassConsented, startOfDayMinutes, analysisModel.analysisConnected]);

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
  }, [authStatus, hasRequiredAccountAuth, isEffectiveAuthRequired, profileReadyUserId, user?.id]);

  function handleOnboardingComplete(state: UserOnboardingState) {
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
      nextStatus = await trackerClient.start();
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
    if (!canUseCloudAiClassification && !localAiClassificationOptions) {
      const disabledSummary = { status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Sign in or configure local AI to run AI classification." } satisfies AiClassificationSummary;
      setClassificationSummary(disabledSummary);
      captureAiClassificationRun("manual", "none", selectedDay === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent", disabledSummary);
      return;
    }

    if (aiClassificationInFlightRef.current) return;

    const executionUsageDay = todayIsoDate();
    const providerKind = toAiProviderAnalytics(Boolean(localAiClassificationOptions), canUseCloudAiClassification);
    const range = selectedDay === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent";
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;
    aiClassificationInFlightRef.current = true;
    setClassificationActionLoading(true);
    setClassificationSummary({ status: "running", selectedSegments: 0, savedRecords: 0, message: "Running AI classification..." });
    try {
      const usageBefore = await loadAiClassificationUsage(executionUsageDay);
      const summary = localAiClassificationOptions
        ? await runAiClassification(toClassificationQueryForDay(selectedDay), undefined, localAiClassificationOptions)
        : await runAiClassification(toClassificationQueryForDay(selectedDay), undefined, { bypassCloudRequestBackoff: true });
      if (localAiClassificationOptions) recordLocalAiClassificationSummary(summary);
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
      const failure = localAiClassificationOptions
        ? { message: toErrorMessage(nextError), failureKind: "transport" as const }
        : await recordCloudAiClassificationError(nextError, cloudAiConnectionGeneration);
      if (localAiClassificationOptions) recordLocalAiClassificationError(failure.message);
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
    if (!canUseCloudAiClassification && !localAiClassificationOptions) {
      const disabledSummary = { status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Sign in or configure local AI to run AI classification." } satisfies AiClassificationSummary;
      setClassificationSummary(disabledSummary);
      captureAiClassificationRun("manual", "none", selectedDay === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent", disabledSummary);
      return;
    }

    const targetDay = selectedDay;
    if (aiClassificationInFlightRef.current) return;

    const executionUsageDay = todayIsoDate();
    const providerKind = toAiProviderAnalytics(Boolean(localAiClassificationOptions), canUseCloudAiClassification);
    const range = targetDay === logicalTodayIsoDate(startOfDayMinutes) ? "current_day" : "recent";
    const cloudAiConnectionGeneration = cloudAiConnectionGenerationRef.current;
    aiClassificationInFlightRef.current = true;
    setClassificationActionLoading(true);
    setClassificationSummary({ status: "running", selectedSegments: 0, savedRecords: 0, message: `Classifying all unclassified activity for ${formatDayLabel(targetDay)}...` });
    try {
      const usageBefore = await loadAiClassificationUsage(executionUsageDay);
      const summary = localAiClassificationOptions
        ? await runAiClassificationUntilEmpty(toClassificationQueryForDay(targetDay), undefined, localAiClassificationOptions)
        : await runAiClassificationUntilEmpty(toClassificationQueryForDay(targetDay), undefined, { bypassCloudRequestBackoff: true });
      if (localAiClassificationOptions) recordLocalAiClassificationSummary(summary);
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
      const failure = localAiClassificationOptions
        ? { message: toErrorMessage(nextError), failureKind: "transport" as const }
        : await recordCloudAiClassificationError(nextError, cloudAiConnectionGeneration);
      if (localAiClassificationOptions) recordLocalAiClassificationError(failure.message);
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
      contextualGuardAuditEvents: readContextualGuardAuditEvents(),
      segments,
      historySegments,
      leaderboardSegments,
      ai: {
        route: localAiClassificationOptions ? "local" : canUseCloudAiClassification ? "cloud" : "disabled",
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
      error,
    });
    setDebugLogPreview({ text: JSON.stringify(payload, null, 2), exportedAt: payload.exportedAt });
  }, [accessibilityGranted, aiClassificationUsage, aiClassificationUsageDay, aiConnectionStatus, appThemeColorOverrides, billingEntitlement, billingEntitlementError, billingEntitlementLoading, canUseCloudAiClassification, categoryColorOverrides, classificationActionLoading, classificationSummary, devModeEnabled, driftAlarmTrayStatus, effectiveEnhancedContextSettings, error, forceBrowserHistoryUrlFallbackEnabled, forceChromiumAxCaptureEnabled, forceChromiumAxExtremeNudgeEnabled, forceFrontmostFallbackCaptureEnabled, hasRequiredAccountAuth, historySegments, isSupabaseConfigured, leaderboardSegments, localAiClassificationOptions, localAiConnectionPersistentFailure, localAiConnectionProviderLabel, localAiProviderStatus, segments, selectedDay, startOfDayMinutes, startOfWeek, status, theme]);
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
    activeTab === "settings" && settingsSection === "dev" && DEV_SETTINGS_ENABLED && devModeEnabled;
  const appStatusNotice = latestBuildStatusNotice ?? manualUpdateStatusNotice;
  const shellStatusNotice =
    (latestBuildStatusNotice && !latestBuildStatusRenderedInSettings ? latestBuildStatusNotice : null)
    ?? (manualUpdateStatusNotice && !manualUpdateStatusRenderedInSettings ? manualUpdateStatusNotice : null);
  // Keep developer update recovery available even when onboarding or account policy owns the app shell.
  const latestBuildPrompt = latestBuildPromptUpdate?.version ? (
    <AvailableUpdateDialog
      autoInstallFutureUpdates={developerPreReleaseUpdateController.autoInstallFutureUpdates}
      policy={fallbackUpdatePolicy(latestBuildPromptUpdate.version)}
      update={{
        body: latestBuildPromptUpdate.body,
        date: latestBuildPromptUpdate.date,
        version: latestBuildPromptUpdate.version,
      }}
      updaterChecking={developerPreReleaseUpdateController.status === "checking"}
      updaterError={developerPreReleaseUpdateController.error}
      updaterInstalling={developerPreReleaseUpdateController.status === "installing"}
      onAutoInstallFutureUpdatesChange={developerPreReleaseUpdateController.setAutoInstallFutureUpdates}
      onDismiss={developerPreReleaseUpdateController.dismissPrompt}
      onInstall={() => void developerPreReleaseUpdateController.installLatestBuild()}
    />
  ) : null;

  const dashboardDateNavigator = (
    <DateNavigator
      ariaLabel={`${dashPeriod} date selector`}
      label={dashboardDateLabel}
      todayLabel={getDashboardCurrentPeriodLabel(dashPeriod)}
      isTodayDisabled={isCurrentDashboardPeriod}
      isNextDisabled={!canShiftDashboardForward}
      onPrevious={() => shiftDashboardPeriod(-1)}
      onNext={() => shiftDashboardPeriod(1)}
      onToday={() => selectDay(todayDay)}
      previousLabel={`Show previous ${dashPeriod.toLowerCase()}`}
      nextLabel={`Show next ${dashPeriod.toLowerCase()}`}
    />
  );

  const focusDriftSection = (
    <FocusDriftSection
      appIcons={appIcons}
      chart={focusDriftChart}
    />
  );

  const dayBreakdownTiles = (
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
  const stickyDashboardEffectiveProductivityTotals = useStickyDuringLoad(dashboardEffectiveProductivityTotals, isDayBreakdownLoading);
  const stickyDashboardAppUsage = useStickyDuringLoad(dashboardAppUsage, isDayBreakdownLoading);
  const stickyTotalSeconds = useStickyDuringLoad(totalSeconds, isDayBreakdownLoading);
  const stickyDayBreakdownTiles = useStickyDuringLoad(dayBreakdownTiles, isDayBreakdownLoading);

  if (isEffectiveAuthRequired && hasEffectiveBlockingAuthConfigurationError) {
    return (
      <>
        {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
        <AuthConfigurationGate />
        {latestBuildPrompt}
      </>
    );
  }

  if (isEffectiveAuthRequired && authStatus === "loading" && !onboardingOpen) {
    return (
      <>
        <AuthLoadingGate />
        {latestBuildPrompt}
      </>
    );
  }

  if (isEffectiveAuthRequired && !hasRequiredAccountAuth && !onboardingOpen) {
    return (
      <>
        {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
        <AuthRequiredGate onSignIn={openDefaultAuthModal} />
        {authModalOpen ? <AuthModal intent={authModalIntent} onClose={handleCloseAuthModal} showGoogleSignIn={authModalShowsGoogle} /> : null}
        {latestBuildPrompt}
      </>
    );
  }

  const effectiveBillingEntitlement = activeDashboardAiUnavailablePreviewInput?.billingEntitlement ?? billingEntitlement;
  const effectiveBillingEntitlementError = activeDashboardAiUnavailablePreviewInput?.billingEntitlementError ?? billingEntitlementError;
  const effectiveBillingSettingsError = effectiveBillingEntitlementError ?? billingActionError;
  const effectiveBillingEntitlementLoading = activeDashboardAiUnavailablePreviewInput?.billingEntitlementLoading ?? billingEntitlementLoading;
  const effectiveIsSupabaseConfigured = activeDashboardAiUnavailablePreviewInput?.isSupabaseConfigured ?? isSupabaseConfigured;
  const effectiveHasRequiredAccountAuth = activeDashboardAiUnavailablePreviewInput?.hasRequiredAccountAuth ?? hasRequiredAccountAuth;
  const isDeviceLimitLocked = effectiveBillingEntitlement?.lockedReason === "device_limit_reached";
  const isDashboardAiUnavailablePreviewActive = activeDashboardAiUnavailablePreviewInput !== null;
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
  const onboardingModal = onboardingOpen ? (
    <OnboardingModal
      userId={user?.id ?? "local"}
      accountConnected={hasRequiredAccountAuth}
      initialDisplayName={profileDraft.displayName}
      trackerStatus={status}
      accessibilityGranted={accessibilityGranted}
      accessibilityRequired={accessibilityRequired}
      onStartTracking={handleStartTrackingFromOnboarding}
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
            await refresh();
          } catch {
            // silent early start; completion retries with full error handling
          }
        })();
      }}
      onCheckAccessibility={handleCheckAccessibility}
      onRequestAccessibility={handleRequestAccessibility}
      onEnableDriftAlerts={() => setDriftAlertsEnabled(true)}
      localAiSetup={localAiSetup}
      onLocalAiSetupChange={setLocalAiSetup}
      cloudTrialStartedNotice={cloudTrialStartedNotice}
      billingEntitlement={billingEntitlement}
      billingEntitlementError={billingEntitlementError}
      billingEntitlementLoading={billingEntitlementLoading}
      expectsPromotion={promoHandoffPending}
      authCallbackStatus={callbackStatus}
      onStartCloudTrialWithGoogle={() => void signInWithGoogle()}
      onStartCloudTrialWithEmail={openOnboardingEmailAuthModal}
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
  ].filter(Boolean).join(" ");

  if (onboardingOpen) {
    const promoAuthOnboardingOpen = authModalOpen && authModalIntent === "promo";
    return (
      <SiteIconProvider value={siteIcons}>
      <LocalizationProvider controller={localization}>
        <>
          {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
          {promoAuthOnboardingOpen ? (
            <AuthModal
              intent="promo"
              onClose={handleCloseAuthModal}
              presentation="onboarding"
              showGoogleSignIn={authModalShowsGoogle}
            />
          ) : onboardingModal}
          {authModalOpen && !promoAuthOnboardingOpen ? (
            <AuthModal intent={authModalIntent} onClose={handleCloseAuthModal} showGoogleSignIn={authModalShowsGoogle} />
          ) : null}
          {promoHandoffAccountDialog}
          {accountDeletionModalOpen ? (
            <AccountDeletionModal
              accountEmail={user?.email ?? null}
              isAnonymousAccount={user?.is_anonymous === true}
              onClose={() => setAccountDeletionModalOpen(false)}
              onDelete={handleDeleteAccount}
            />
          ) : null}
          {latestBuildPrompt}
        </>
      </LocalizationProvider>
      </SiteIconProvider>
    );
  }

  if (preparingFirstDay) {
    return (
      <SiteIconProvider value={siteIcons}>
      <LocalizationProvider controller={localization}>
        <>
          {appStatusNotice ? <AppStatusNotice notice={appStatusNotice} /> : null}
          <FirstDayPreparationScreen
            failure={firstDayPreparationFailure}
            onContinueAnyway={continueFirstDayPreparationAnyway}
            onRetry={retryFirstDayPreparation}
            phase={firstDayPreparationPhase}
            progress={firstDayPreparationProgress}
            workActivityLabel={firstDayWorkLabel}
          />
          {promoHandoffAccountDialog}
          {latestBuildPrompt}
        </>
      </LocalizationProvider>
      </SiteIconProvider>
    );
  }

  return (
    <SiteIconProvider value={siteIcons}>
      <LocalizationProvider controller={localization}>
    <div className={shellClassName}>
      <div className="window-chrome">
        <div className="window-nav-controls" aria-label={localization.t("shell.windowNavigation")}>
          {!isSettingsTab ? (
            <button
              type="button"
              className="window-sidebar-toggle"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={localization.t(isSidebarVisuallyCollapsed ? "shell.expandSidebar" : "shell.collapseSidebar")}
              aria-pressed={isSidebarVisuallyCollapsed}
            >
              <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="12" height="12" rx="2.5" />
                <path d="M7 3v12" />
              </svg>
            </button>
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
          <AiConnectionStatusBar status={effectiveAiConnectionStatus} onOpenSettings={openAiSetupSettings} />
          {titlebarUpdate ? (
            <TopbarUpdateButton
              isInstalling={updaterInstalling}
              onInstall={() => void handleInstallUpdate()}
              version={titlebarUpdate.version}
            />
          ) : null}
        </div>
      </div>
      {cloudTrialStartedNotice && !onboardingOpen && !isDashboardDemoReplayActive ? (
        <CloudTrialStartedNotice
          notice={cloudTrialStartedNotice}
          onDismiss={dismissCloudTrialStartedNotice}
          onOpenAiSetup={openCloudTrialStartedNoticeAiSetup}
        />
      ) : null}
      {shellStatusNotice ? <AppStatusNotice notice={shellStatusNotice} /> : null}
      {/* ── Sidebar ── */}
      {activeTab === "settings" ? (
        <SettingsSidebar
          activeSection={settingsSection}
          isCollapsed={isSidebarVisuallyCollapsed}
          showDevSection={DEV_SETTINGS_ENABLED && devModeEnabled}
          onBack={handleSettingsBack}
          onSectionChange={setSettingsSection}
        />
      ) : (
        <aside className={isSidebarVisuallyCollapsed ? "sidebar sidebar--collapsed" : "sidebar"}>
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
        <div className="nav-label">{localization.t("nav.group.dashboard")}</div>
        <nav className="sidebar-nav sidebar-nav--periods" aria-label={localization.t("nav.dashboardViews")}>
          {dashboardPeriodOptions.map((item) => {
            const itemLabel = localization.t(item.period === "Week" ? "nav.yourWeek" : "nav.yourDay");
            return (
            <button
              key={item.period}
              type="button"
              className={activeTab === "dashboard" && dashPeriod === item.period ? "nav-item nav-item--period active" : "nav-item nav-item--period"}
              aria-current={activeTab === "dashboard" && dashPeriod === item.period ? "page" : undefined}
              onClick={() => navigateToTab("dashboard", item.period)}
            >
              <NavIcon type={item.period === "Week" ? "calendar" : "home"} />
              <span>{itemLabel}</span>
              {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{itemLabel}</span> : null}
            </button>
            );
          })}
          {canOpenAgentsBeta ? (
            <button
              type="button"
              className={activeTab === "agents" ? "nav-item nav-item--period active" : "nav-item nav-item--period"}
              aria-current={activeTab === "agents" ? "page" : undefined}
              onClick={() => navigateToTab("agents")}
            >
              <NavIcon type="agents" />
              <span>{localization.t("nav.yourAgents")}</span>
              {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{localization.t("nav.yourAgents")}</span> : null}
            </button>
          ) : null}
        </nav>

        <div className="nav-label">{localization.t("nav.group.activity")}</div>
        <nav className="sidebar-nav" aria-label={localization.t("nav.primaryNavigation")}>
          {activityNav.filter((item) => projectClassificationFeatureEnabled || item.id !== "projects").map((item) => {
            const itemLabel = localization.t(item.labelKey);
            return (
            <button key={item.id} type="button" className={activeTab === item.id ? "nav-item active" : "nav-item"} aria-current={activeTab === item.id ? "page" : undefined} onClick={() => navigateToTab(item.id)}>
              <NavIcon type={item.icon} /><span>{itemLabel}</span>
              {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{itemLabel}</span> : null}
            </button>
            );
          })}
        </nav>

        <div className="nav-label">{localization.t("nav.group.social")}</div>
        <nav className="sidebar-nav sidebar-nav--social" aria-label={localization.t("nav.socialNavigation")}>
          {canOpenProfileBeta ? (
            <button
              type="button"
              className={activeTab === "leaderboard" && socialSection === "profile" ? "nav-item active" : "nav-item"}
              aria-current={activeTab === "leaderboard" && socialSection === "profile" ? "page" : undefined}
              onClick={() => navigateToTab("profile")}
            >
              <NavIcon type="profile" /><span>{localization.t("nav.profile")}</span>
              {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{localization.t("nav.profile")}</span> : null}
            </button>
          ) : null}
          <button
            type="button"
            className={activeTab === "leaderboard" && socialSection === "leaderboard" ? "nav-item active" : "nav-item"}
            aria-current={activeTab === "leaderboard" && socialSection === "leaderboard" ? "page" : undefined}
            onClick={() => navigateToTab("leaderboard")}
          >
            <NavIcon type="leaderboard" /><span>{localization.t("nav.leaderboard")}</span>
            {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{localization.t("nav.leaderboard")}</span> : null}
          </button>
        </nav>

        {canOpenTeamsBeta ? (
          <>
            <div className="nav-label nav-label--teams">
              <span>Your teams</span>
              {!isSidebarVisuallyCollapsed ? (
                <button
                  type="button"
                  className="nav-label__add"
                  aria-label="Create or join a team"
                  title="Create or join a team"
                  onClick={() => openTeamAction("add")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              ) : null}
            </div>
            <nav className="sidebar-nav sidebar-nav--teams" aria-label="Your teams">
              {teamController.teams.length === 0 ? (
                <button type="button" className={activeTab === "team" ? "nav-item active" : "nav-item"} aria-current={activeTab === "team" ? "page" : undefined} onClick={() => navigateToTab("team")}>
                  <NavIcon type="team" /><span>Teams</span>
                  {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">Teams</span> : null}
                </button>
              ) : (
                teamController.teams.map((team) => {
                  const isSelectedTeam = teamController.selectedTeam?.organization_id === team.organization_id;
                  const expandedTeamId = teamNavExpandedId === undefined
                    ? teamController.selectedTeam?.organization_id ?? null
                    : teamNavExpandedId;
                  const isExpandedTeam = expandedTeamId === team.organization_id;
                  // The team row is only an expander — selection highlight lives on the sub-items.
                  const toggleTeam = () => {
                    if (isSidebarVisuallyCollapsed) {
                      teamController.selectTeam(team.organization_id);
                      navigateToTab("team");
                      return;
                    }
                    teamController.selectTeam(team.organization_id);
                    setTeamNavExpandedId(isExpandedTeam ? null : team.organization_id);
                  };
                  return (
                    <Fragment key={team.organization_id}>
                      <div
                        className="nav-item nav-item--team"
                        role="button"
                        tabIndex={0}
                        aria-label={team.organization_name}
                        aria-expanded={isExpandedTeam}
                        onClick={toggleTeam}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleTeam();
                          }
                        }}
                      >
                        <NavIcon type="team" />
                        <span className="nav-item--team__name">{team.organization_name}</span>
                        {isSidebarVisuallyCollapsed ? (
                          <span className="nav-item__hover-label" aria-hidden="true">{team.organization_name}</span>
                        ) : (
                          <>
                            <svg
                              className={isExpandedTeam ? "team-nav-caret team-nav-caret--open" : "team-nav-caret"}
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M6 3.5 10.5 8 6 12.5" />
                            </svg>
                            {isSelectedTeam ? (
                              <button
                                type="button"
                                className="team-nav-more"
                                aria-label="Team options"
                                aria-haspopup="menu"
                                aria-expanded={teamNavMenuOpen}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const anchorRect = event.currentTarget.getBoundingClientRect();
                                  const sidebarRect = event.currentTarget.closest(".sidebar")?.getBoundingClientRect();
                                  setTeamNavMenuPos({
                                    left: Math.max(anchorRect.right, sidebarRect?.right ?? 0) + 8,
                                    top: Math.max(8, anchorRect.top - 6),
                                  });
                                  setTeamNavMenuOpen((open) => !open);
                                }}
                              >
                                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg>
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                      {isExpandedTeam && !isSidebarVisuallyCollapsed ? (
                        <div className="sidebar-subnav">
                          <button
                            type="button"
                            aria-label="Team dashboards"
                            className={activeTab === "team" && isSelectedTeam && teamSubView === "dashboards" ? "nav-item nav-item--sub active" : "nav-item nav-item--sub"}
                            aria-current={activeTab === "team" && isSelectedTeam && teamSubView === "dashboards" ? "page" : undefined}
                            onClick={() => {
                              teamController.selectTeam(team.organization_id);
                              setTeamSubView("dashboards");
                              navigateToTab("team");
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true"><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.5" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5" /></svg>
                            <span>Dashboards</span>
                          </button>
                          <button
                            type="button"
                            aria-label="Team projects"
                            className={activeTab === "team" && isSelectedTeam && teamSubView === "projects" ? "nav-item nav-item--sub active" : "nav-item nav-item--sub"}
                            aria-current={activeTab === "team" && isSelectedTeam && teamSubView === "projects" ? "page" : undefined}
                            onClick={() => {
                              teamController.selectTeam(team.organization_id);
                              setTeamSubView("projects");
                              navigateToTab("team");
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>
                            <span>Projects</span>
                          </button>
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
              {teamNavMenuOpen && teamNavMenuPos && !isSidebarVisuallyCollapsed ? (
                <div className="team-nav-menu" role="menu" aria-label="Team options" style={{ left: teamNavMenuPos.left, top: teamNavMenuPos.top }}>
                  <button type="button" role="menuitem" onClick={() => openTeamAction("invite")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 19.5v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.1a3.6 3.6 0 0 0-3.6 3.6v1.4" /><circle cx="8.8" cy="7.6" r="3.3" /><path d="M18.5 8v6M15.5 11h6" /></svg>
                    Invite teammate
                  </button>
                  <button type="button" role="menuitem" onClick={() => openTeamAction("settings")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
                    Team settings
                  </button>
                  <button type="button" role="menuitem" onClick={() => openTeamAction("add")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    Create or join a team
                  </button>
                </div>
              ) : null}
            </nav>
          </>
        ) : null}
        </div>

        <div className="sidebar-foot">
          {shouldShowSidebarCtaSlot && sidebarCtaSlot ? (
            <SidebarCtaSlot
              state={sidebarCtaSlot}
              onDismiss={sidebarCtaSlot.kind === "upgrade" && !isSidebarCtaPreviewActive
                ? () => setSidebarUpgradeDismissedUntil(storeSidebarUpgradeDismissal())
                : undefined}
              onAction={() => {
                if (sidebarCtaSlot.kind === "ai") {
                  openAiSetupSettings();
                  return;
                }
                if (sidebarCtaSlot.kind === "device-limit") {
                  openAccountSettings();
                  return;
                }
                if (sidebarCtaSlot.kind === "download") return;
                if (sidebarCtaSlot.kind === "billing") {
                  // Existing subscription with a blocked payment: recover it in
                  // the portal instead of starting a second one.
                  void handleManageCloudBilling();
                  return;
                }
                handleOpenUpgradePlanModal();
              }}
            />
          ) : null}
          <div
            className="tracker-control"
            role="group"
            data-state={sidebarTrackerControlState}
            aria-label={[
              sidebarTrackerStatusLabel,
              sidebarTrackerAppLabel,
              sidebarTrackerSiteLabel,
              sidebarTrackerDurationLabel,
              sidebarTrackerMetaLabel,
            ].filter(Boolean).join(" · ")}
          >
            <div className="live-pill">
              <div className="live-pill__summary">
                <div className={`k ${sidebarTrackerIndicatorClassName}`}>
                  {sidebarTrackerCollapsedLabel}
                </div>
                <div className="live-pill__summary-copy">
                  <span className="live-pill__status-row">
                    <span className="live-pill__status-dot" aria-hidden="true" />
                    <span className="live-pill__status-label">
                      {sidebarTrackerStatusLabel}
                    </span>
                  </span>
                  <span className="live-pill__summary-name">
                    <span className="live-pill__summary-app">{sidebarTrackerAppLabel}</span>
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="sidebar-tracker-toggle"
              data-state={sidebarTrackerControlState}
              onClick={() => {
                if (replaySidebarTrackerCard) {
                  stopDashboardDemoReplay();
                  return;
                }
                void (status?.running && !isTrackerDegraded ? handleStopTracking() : handleStartTracking());
              }}
              disabled={isSidebarTrackerActionDisabled}
              aria-busy={trackerPausePending || undefined}
              aria-label={sidebarTrackerActionLabel}
              title={sidebarTrackerActionLabel}
            >
              <svg className="sidebar-tracker-toggle__icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <g className="sidebar-tracker-toggle__icon--pause">
                  <rect x="2.5" y="2" width="2.25" height="8" rx="0.8" />
                  <rect x="7.25" y="2" width="2.25" height="8" rx="0.8" />
                </g>
                <path className="sidebar-tracker-toggle__icon--play" d="M3 1.8 10 6 3 10.2Z" />
                <rect className="sidebar-tracker-toggle__icon--stop" x="3" y="3" width="6" height="6" rx="1" />
              </svg>
              <span>{sidebarTrackerActionLabel}</span>
            </button>
          </div>
          <AccountMenu
            isOpen={accountMenuOpen}
            isSidebarCollapsed={isSidebarVisuallyCollapsed}
            userAvatarUrl={profile?.avatar_url || profileDraft.avatarUrl || authMetadataAvatarUrl}
            userEmail={user?.email ?? null}
            isDarkMode={theme === "dark"}
            isPetVisible={petModeEnabled}
            showPetNewBadge={featureNewBadges.showPet}
            onToggle={() => setAccountMenuOpen((open) => !open)}
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
            onSignIn={() => {
              openDefaultAuthModal();
              setAccountMenuOpen(false);
            }}
            onSignOut={() => {
              setAccountMenuOpen(false);
              void signOut();
            }}
          />
        </div>
        </aside>
      )}

      {/* ── Main content ── */}
      <MainContentShell activeTab={activeTab} loading={loading} hasLoadedOnce={hasLoadedOnce} error={error} contentRef={contentRef}>
        <Suspense fallback={<DeferredPageImportFallback label={activeTab} />}>

        {/* Dashboard */}
        {activeTab === "dashboard" ? (
          <DashboardPage
            appIcons={appIcons}
            appTheme={theme}
            billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
            billingPlansDisabled={billingCheckoutAwaitingConfirmation}
            billingPortalLoading={billingPortalLoading}
            currentMinuteOfDay={effectiveCurrentMinuteOfDay}
            dashboardAiRecoveryState={upgradePlanModalOpen ? null : dashboardAiRecoveryState}
            dashboardAppUsage={stickyDashboardAppUsage}
            dashboardSegments={effectiveDashboardSegments}
            dashboardClassificationOptions={dashboardClassificationOptions}
            browserHistoryBootstrapNotice={browserHistoryBootstrapNotice}
            dashboardCategoryTotals={stickyDashboardCategoryTotals}
            dashboardDateNavigator={dashboardDateNavigator}
            dashboardEffectiveProductivityTotals={stickyDashboardEffectiveProductivityTotals}
            dashboardProductivityTotals={stickyDashboardProductivityTotals}
            dashboardReplay={dashboardReplay}
            dashboardRange={effectiveDashboardRange}
            dashPeriod={dashPeriod}
            flowBlocks={flowBlocks}
            summaryFlowBlocks={summaryFlowBlocks}
            flowIntervalMinutes={flowIntervalMinutes}
            deviceLabelById={remoteDeviceLabelById}
            deviceTimelineFilter={deviceTimelineFilter}
            onDeviceTimelineFilterChange={setDeviceTimelineFilter}
            projectModeAvailable={projectClassification.projectModeAvailable}
            projectLegend={flowProjectLegend}
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
            weekFocusDeltaSeconds={isPreviewSurface ? 3 * 3600 + 5 * 60 : weekFocusDeltaSeconds}
            weekRefreshStatus={weekRefreshStatus}
            weekRows={weekRows}
            weekCurrentCalendarDay={isDashboardDemoReplayActive && dashPeriod === "Week" ? effectiveTodayDayForWeekModel : null}
            weekCurrentMinuteOfDay={isDashboardDemoReplayActive && dashPeriod === "Week" ? effectiveCurrentMinuteOfDay : null}
            onDismissDashboardAiRecovery={handleDismissDashboardAiRecovery}
            onFlowIntervalChange={handleFlowIntervalChange}
            onOpenDashboardAiSetup={openDashboardAiSetup}
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
            onSelectDay={selectDay}
          />
        ) : null}

        {/* Your Agents: agent time and commit output, sibling of the dashboard
            views. Dev-mode beta preview, so the surface is gated too — not just
            its sidebar entry. */}
        {activeTab === "agents" && canOpenAgentsBeta ? (
          <LazyAgentsPage
            flowIntervalMinutes={flowIntervalMinutes}
            onFlowIntervalChange={handleFlowIntervalChange}
            onSelectDay={selectDay}
            selectedDay={selectedDay}
            startOfWeek={startOfWeek}
            todayDay={todayDay}
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
            {isDeferredTabBodyReady ? (
              <LazyHistoryView
                appIcons={appIcons}
                deleting={historyDeleting}
                hasMoreSegments={displayedHistoryHasMoreSegments}
                initialLoading={historyInitialLoading}
                loadingMore={displayedHistoryLoading}
                loadMoreError={displayedHistoryLoadMoreError}
                searchQuery={historySearchQuery}
                searchUsesBackend={true}
                segments={displayedHistorySegments}
                startOfDayMinutes={startOfDayMinutes}
                onDeleteSelected={handleDeleteHistorySegments}
                onOpenDeleteHistory={() => setDeleteHistoryModalOpen(true)}
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
            projects={projectClassification.projects}
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
            analysisConnected={analysisModel.analysisConnected}
            analysisSetup={analysisModel.analysisSetup}
            consentOpen={projectPassConsentOpen}
            consentProviderLabel={analysisProviderLabel}
            consentIncludesSiteUrl={projectPassPrivacySettings.optional.siteUrl}
            consentIncludesWindowTitles={projectPassPrivacySettings.optional.windowTitle}
            consentIncludesContentContext={projectPassPrivacySettings.optional.contentContext}
            consentStoresCloudSamples={analysisModel.analysisSetup.provider === "cloud"}
            onTrendWindowChange={handleProjectsTrendWindowChange}
            onConfigureModel={() => {
              navigateToTab("settings");
              setSettingsSection("aiSetup");
              setAiSetupRequestedTab("intelligence");
            }}
            onOpenTrends={openProjectTrends}
            onSaveProject={(input) => void projectClassification.saveProject(input)}
            onDeleteProject={(id) => void projectClassification.deleteProject(id)}
            onRunAnalysis={() => requestProjectPassRun()}
            onConsentConfirm={confirmProjectPassConsent}
            onConsentCancel={() => setProjectPassConsentOpen(false)}
          />
        ) : null}

        {/* Insights */}
        {activeTab === "trends" ? (
          <TrendsPage
            activeInsightCategoryTotals={activeInsightCategoryTotals}
            activeInsightProductivityTotals={activeInsightProductivityTotals}
            appIcons={appIcons}
            attentionRhythm={attentionRhythm}
            bodyFallback={<DeferredTabBodyFallback label="trend analysis" variant="trends" />}
            bodyReady={isTrendsBodyReady}
            breakRecoveryInsight={breakRecoveryInsight}
            canShiftInsightForward={canShiftInsightForward}
            driftSourceLists={driftSourceLists}
            focusSourceLists={focusSourceLists}
            insightClassificationOptions={insightClassificationOptions}
            insightDateLabel={insightDateLabel}
            insightSegments={activeInsightSegments}
            isTodaySelected={isTodaySelected}
            productivityPersonaReport={productivityPersonaReport}
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
            isLoading={leaderboardLoading}
            isOptedIn={isLeaderboardOptedIn}
            isParticipationResolved={isLeaderboardParticipationResolved}
            isSignedIn={isPolicySignedIn}
            isSupabaseEnabled={isSupabaseConfigured || leaderboardUsesPreviewProfile}
            leaderboard={leaderboardRows}
            ownFocusSeconds={leaderboardUsesPreviewProfile
              ? leaderboardRows.find((row) => row.rank === 6)?.focus_seconds ?? null
              : ownLeaderboardEntry?.focus_seconds ?? null}
            ownParticipantCount={leaderboardUsesPreviewProfile
              ? leaderboardRows.length
              : ownLeaderboardEntry?.participant_count ?? null}
            ownRank={leaderboardUsesPreviewProfile ? 6 : ownLeaderboardEntry?.rank ?? null}
            profileDisplayName={leaderboardProfileDisplayName}
            publicProfile={{
              card: focusCard,
              dailyProductivity: profileDailyProductivity,
              draft: profileDraft,
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
              onSetProfileVisibility: handleProfileVisibilityChange,
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
            pendingAction={pendingTeamAction}
            onPendingActionConsumed={() => setPendingTeamAction(null)}
            onAuthRequired={requestTeamAuth}
            onPendingInviteClear={() => setPendingTeamInvite(null)}
          />
        ) : null}

        {/* Settings */}
        {activeTab === "settings" ? (
          <div className="page">
            <h1 className="sr-only">{localization.t("common.settings")}</h1>
            <div className="settings-panel-stack">
                {settingsSection === "account" && (
                  <AccountSettingsSection
                    billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
                    billingEntitlementError={effectiveBillingSettingsError}
                    billingEntitlementLockedReason={effectiveBillingEntitlement?.lockedReason ?? null}
                    billingEntitlementStatus={effectiveBillingEntitlement?.status ?? null}
                    billingPlansDisabled={isDashboardAiUnavailablePreviewActive || billingCheckoutAwaitingConfirmation}
                    billingPortalLoading={billingPortalLoading}
                    couponRedemption={couponRedemption}
                    couponRedemptionErrorCode={couponRedemptionErrorCode}
                    couponRedemptionLoading={couponRedemptionLoading}
                    cloudDeviceAccess={effectiveBillingEntitlement?.deviceAccess ?? null}
                    cloudDeviceActionError={cloudDeviceActionError}
                    cloudDeviceRevokingId={cloudDeviceRevokingId}
                    cloudDevices={effectiveBillingEntitlement?.cloudDevices ?? cloudDevices}
                    cloudStatusRefreshing={effectiveBillingEntitlementLoading}
	                    currentBillingPlan={currentBillingPlan}
	                    hasAuthenticatedSession={Boolean(user)}
	                    hasSignedInAccount={hasRequiredAccountAuth}
	                    isSupabaseConfigured={effectiveIsSupabaseConfigured}
	                    publicProfileDisplayName={leaderboardProfileDisplayName}
	                    publicProfileStatus={
	                      isLeaderboardOptedIn
	                        ? ownLeaderboardEntry?.rank
	                          ? `On the board as #${ownLeaderboardEntry.rank}`
	                          : "On the board"
	                        : "Not on the board yet"
	                    }
	                    shouldShowCloudCheckoutPlans={shouldShowCloudCheckoutPlans}
	                    userEmail={user?.email ?? null}
	                    deviceSyncEnabled={deviceSyncEnabled}
	                    deviceSyncGateActive={deviceSyncActive}
	                    deviceSyncStatus={deviceSyncStatus}
	                    deviceSyncPurging={deviceSyncPurging}
	                    onDeviceSyncEnabledChange={deviceSyncFeatureVisible ? handleDeviceSyncEnabledChange : undefined}
	                    onDeviceSyncNow={deviceSyncNow}
	                    onPurgeDeviceSyncData={handlePurgeDeviceSyncData}
	                    onDeleteAccount={() => setAccountDeletionModalOpen(true)}
	                    onEditPublicProfile={openProfileEditor}
	                    onManageCloudBilling={handleManageCloudBilling}
	                    onOpenAiSetup={openAiSetupSettings}
	                    onOpenLeaderboard={() => {
                          navigateToTab("leaderboard");
                        }}
	                    onRefreshCloudStatus={refreshBillingEntitlement}
                    onRedeemTrialCoupon={handleRedeemTrialCoupon}
                    onRevokeCloudDevice={handleRevokeCloudDevice}
                    onSignIn={openDefaultAuthModal}
                    onStartCloudSetup={startCloudCheckout}
                  />
                )}
                {settingsSection === "general" && (
                  <GeneralSettingsSection
                    autoInstallFutureUpdates={autoInstallFutureUpdates}
                    startOfDayValue={startOfDayValue}
                    startOfWeek={startOfWeek}
                    updaterChecking={updaterChecking}
                    updaterError={updaterError}
                    updaterInstalling={updaterInstalling}
                    updaterMessage={updaterMessage}
                    onAutoInstallFutureUpdatesChange={setAutoInstallFutureUpdates}
                    onCheckForUpdates={() => void handleCheckForUpdates()}
                    onSendFeedback={() => setFeedbackModalOpen(true)}
                    onStartOfDayChange={handleStartOfDayChange}
                    onStartOfWeekChange={handleStartOfWeekChange}
                  />
                )}
                {settingsSection === "permissions" && (
                  <PermissionsSettingsSection
                    accessibilityGranted={accessibilityGranted}
                    accessibilityRequired={accessibilityRequired}
                    onCheckAccessibility={handleCheckAccessibility}
                    onRequestAccessibility={handleRequestAccessibility}
                  />
                )}
                {settingsSection === "appearance" && (
                  <AppearanceSettingsSection
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
                {settingsSection === "classification" && (
                  <ClassificationSettingsSection
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
                    classificationRuleApplying={classificationRuleApplying}
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
                    onApplyClassificationRules={() => void handleApplyClassificationRules()}
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
                {settingsSection === "aiSetup" && (
                  <AiSetupSettingsSection
                    billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
                    billingEntitlementStatus={effectiveBillingEntitlement?.status ?? null}
                    billingPlansDisabled={isDashboardAiUnavailablePreviewActive || billingCheckoutAwaitingConfirmation}
                    cloudStatusRefreshing={effectiveBillingEntitlementLoading}
                    connectionStatus={aiConnectionStatus}
                    connectionTest={aiConnectionTest}
                    currentBillingPlan={currentBillingPlan}
                    localAiSetup={localAiSetup}
                    shouldShowCloudCheckoutPlans={shouldShowCloudCheckoutPlans}
                    workProfileUserId={user?.id ?? "local"}
                    analysisSetup={analysisModel.analysisSetup}
                    analysisOpenRouterConnected={analysisModel.openRouterConnected}
                    showIntelligenceTab={projectClassificationFeatureEnabled}
                    requestedTab={aiSetupRequestedTab}
                    onRequestedTabConsumed={() => setAiSetupRequestedTab(null)}
                    onAnalysisChange={analysisModel.setAnalysisSetup}
                    onDialogOpenChange={setAiSetupDialogOpen}
                    onLocalAiSetupChange={setLocalAiSetup}
                    onManageCloudBilling={handleManageCloudBilling}
                    onStartCloudSetup={handleStartDriftyCloudSetup}
                  />
                )}
                {settingsSection === "notifications" && (
                  <NotificationsSettingsSection
                    companionHiddenUntil={companionHiddenUntil}
                    petModeEnabled={petModeEnabled}
                    petModeCoat={petModeCoat}
                    petModeSize={petModeSize}
                    showPetNewBadge={featureNewBadges.showPet}
                    onPetModeEnabledChange={requestPetModeEnabled}
                    onPetModeCoatChange={setPetModeCoat}
                    onPetModeSizeChange={setPetModeSize}
                    companionSurfacePolicy={companionSurfacePolicy}
                    driftAlertDelaySeconds={driftAlertDelaySeconds}
                    driftAlertsEnabled={driftAlertsEnabled}
                    driftAlarmCopy={driftAlarmCopy}
                    extremeNudgeEnabled={extremeNudgeEnabled}
                    onDriftAlertDelaySecondsChange={setDriftAlertDelaySeconds}
                    onDriftAlarmCopyChange={setDriftAlarmCopy}
                    onDriftAlertsChange={setDriftAlertsEnabled}
                    onExtremeNudgeChange={setExtremeNudgeEnabled}
                    onHideCompanionForOneHour={handleHideCompanionForOneHour}
                    onShowCompanionNow={handleShowCompanionNow}
                    onCompanionSurfacePolicyChange={handleCompanionSurfacePolicyChange}
                  />
                )}
                {settingsSection === "privacy" && (
                  <PrivacySettingsSection
                    databasePath={status?.databasePath}
                    deviceSyncEnabled={deviceSyncActive}
                    onHistoryDeleted={handleHistoryRangeDeleted}
                    todaySessionCount={segments.length}
                  />
                )}
                {settingsSection === "developer" && <DeveloperSettingsSection />}
                {settingsSection === "dev" && DEV_SETTINGS_ENABLED && devModeEnabled && (
                  <DevSettingsSection
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
                    deviceSyncPreviewEnabled={devDeviceSyncPreviewEnabled}
                    webAccountPreviewEnabled={devWebAccountPreviewEnabled}
                    projectClassificationAiReviewEvents={projectClassification.aiReviewEvents}
                    projectClassificationCorrectionsBusy={projectClassification.running}
                    petModeEnabled={petModeEnabled}
                    petModeLabPointerStatus={petModeLabPointerStatus}
                    petModeLabInputBounds={petModeLabInputBounds}
                    floatingCompanionDevEnabled={floatingCompanionDevEnabled}
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
                    onDeviceSyncPreviewEnabledChange={setDevDeviceSyncPreviewEnabled}
                    onWebAccountPreviewEnabledChange={setDevWebAccountPreviewEnabled}
                    onRevertProjectClassificationCorrection={(id) => void projectClassification.revertReviewEvent(id)}
                    onOpenDebugLogs={() => void handleOpenDebugLogs()}
                    onCheckLatestBuild={() => void developerPreReleaseUpdateController.checkLatestBuild()}
                    onInstallLatestBuild={() => void developerPreReleaseUpdateController.installLatestBuild()}
                    onOpenReplayOnboarding={() => void handleOpenDeveloperOnboarding()}
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
                        if (bounds) setPetModeLabInputBounds(formatPetModeInputBounds(bounds));
                      }).catch(() => undefined);
                    }}
                    onPreviewPetModeAction={(action) => {
                      void previewNativePetModeAction(action);
                    }}
                    petModeGuidesEnabled={petModeGuidesEnabled}
                    onTogglePetModeGuides={handleTogglePetModeGuides}
                    teamsBetaEnabled={teamsBetaEnabled}
                    profileBetaEnabled={profileBetaEnabled}
                    agentsBetaEnabled={agentsBetaEnabled}
                    onTeamsBetaChange={setTeamsBetaEnabled}
                    onProfileBetaChange={setProfileBetaEnabled}
                    onAgentsBetaChange={setAgentsBetaEnabled}
                    legacyShellBlurPreviewEnabled={legacyShellBlurPreviewEnabled}
                    onLegacyShellBlurPreviewEnabledChange={setLegacyShellBlurPreviewEnabled}
                    onPreviewDashboardAiUnavailableCase={previewDashboardAiUnavailableCase}
                    onReplayDashboardDemo={handleStartDashboardDemoReplay}
                    onResetDemoDashboardReplaySettings={handleResetDemoDashboardReplaySettings}
                  />
                )}
            </div>
          </div>
        ) : null}
        </Suspense>
      </MainContentShell>

      {!isTauriRuntime() ? (
        <>
          <WatcherPeek event={watcherEvent} onDismiss={dismissWatcherPeek} onRespond={handleWatcherResponse} />
          {END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED && endOfDayReviewEvent ? (
            <EndOfDayReview
              event={endOfDayReviewEvent}
              onOpenDashboard={() => handleEndOfDayReviewAction("openDashboard")}
              onViewDetails={() => handleEndOfDayReviewAction("viewDetails")}
              onOpenNotificationSettings={() => handleEndOfDayReviewAction("openNotificationSettings")}
              onClose={() => setEndOfDayReviewEvent(null)}
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
      {cmdOpen ? (
        <CommandBar
          includeProjects={projectClassificationFeatureEnabled}
          onDismiss={() => setCmdOpen(false)}
          onNavigate={handleCmdNav}
        />
      ) : null}

      {authModalOpen ? <AuthModal intent={authModalIntent} onClose={handleCloseAuthModal} showGoogleSignIn={authModalShowsGoogle} /> : null}
      {promoHandoffAccountDialog}

      {shouldRenderUpgradePlanModal ? (
        <UpgradePlanModal
          billingActionError={billingActionError}
          billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
          billingPlansDisabled={billingCheckoutAwaitingConfirmation || billingEntitlementLoading || isSidebarCtaPreviewActive}
          onClose={() => setUpgradePlanModalOpen(false)}
          onSelectBillingPlan={(billingInterval) => {
            if (isSidebarCtaPreviewActive) return;
            void startCloudCheckout(billingInterval);
          }}
        />
      ) : null}

      {accountDeletionModalOpen ? (
        <AccountDeletionModal
          accountEmail={user?.email ?? null}
          isAnonymousAccount={user?.is_anonymous === true}
          onClose={() => setAccountDeletionModalOpen(false)}
          onDelete={handleDeleteAccount}
        />
      ) : null}

      {feedbackModalOpen ? (
        <Suspense fallback={null}>
          <LazyFeedbackModal initialEmail={user?.email ?? ""} onClose={() => setFeedbackModalOpen(false)} />
        </Suspense>
      ) : null}
      {deleteHistoryModalOpen ? <DeleteHistoryModal onClose={() => setDeleteHistoryModalOpen(false)} onDeleted={handleHistoryRangeDeleted} deviceSyncEnabled={deviceSyncActive} /> : null}

      {deviceSyncPurgeConfirmOpen ? (
        <DeviceSyncPurgeConfirmation
          onCancel={cancelPurgeDeviceSyncData}
          onConfirm={confirmPurgeDeviceSyncData}
        />
      ) : null}

      {debugLogPreview ? (
        <Suspense fallback={null}>
          <LazyDebugLogModal
            text={debugLogPreview.text}
            note={`Generated ${new Date(debugLogPreview.exportedAt).toLocaleTimeString()} · v${BUILD_INFO.version}`}
            onClose={() => setDebugLogPreview(null)}
            onCopy={() => void handleCopyDebugLogs()}
            onDownload={handleDownloadDebugLogs}
          />
        </Suspense>
      ) : null}


      <ProfileDialogs
        avatarUrl={profileDraft.avatarUrl}
        displayName={leaderboardProfileDisplayName}
        isProfileEditorOpen={isProfileEditorOpen}
        profileDraft={profileDraft}
        profileError={profileError}
        profileLoading={profileLoading}
        profileMessage={profileMessage}
        profileSaving={profileSaving}
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

      {visibleUpdate ? (
        <AvailableUpdateDialog
          autoInstallFutureUpdates={autoInstallFutureUpdates}
          policy={currentUpdatePolicy}
          update={visibleUpdate}
          updaterChecking={updaterChecking}
          updaterError={updaterError}
          updaterInstalling={updaterInstalling}
          onAutoInstallFutureUpdatesChange={setAutoInstallFutureUpdates}
          onDismiss={dismissAvailableUpdate}
          onInstall={() => void handleInstallUpdate()}
        />
      ) : null}

      {latestBuildPrompt}

    </div>
    </LocalizationProvider>
      </SiteIconProvider>
  );
}
