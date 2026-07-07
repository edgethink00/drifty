import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationMetrics, ClassificationOptions, ClassificationRuleInput, CurrentActivitySnapshot, DriftAlarmTrayStatus, FlowIntervalMinutes, HourBucket, ProductivityShareMix, ProjectAssignmentRecord, SiteDuration, TimelinePageCursor, TrackerStatus } from "@drifty/domain";
import {
  buildAppUsageSummaries,
  buildFlowBlocks,
  buildRollingFocusSeconds,
  buildCategoryDurations,
  buildProductivityDurations,
  buildEffectiveProductivityDurations,
  classifyActivity,
  buildDailyTotals,
  buildDayRibbonSegments,
  buildHourlySummary,
  buildProductivityPersona,
  shiftIsoDate,
  todayIsoDate,
  totalDurationSeconds,
} from "@drifty/domain";
import logoUrl from "./assets/drifty-mark.svg";
import {
  isCloudBillingVariant,
  resolveDashboardAiUnavailableState,
  type DashboardAiUnavailableVariant,
} from "./features/dashboard/DashboardAiUnavailableNotice";
import {
  isDashboardAiRecoveryOverlayVariant,
} from "./features/dashboard/DashboardAiRecoveryOverlay";
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
import { LeaderboardPage } from "./features/leaderboard/LeaderboardPage";
import { useLeaderboardProfileController } from "./features/leaderboard/useLeaderboardProfileController";
import { TeamsBetaSurface } from "./features/team/TeamsBetaSurface";
import { HistoryView } from "./features/history/HistoryView";
import { HISTORY_TIMELINE_PAGE_SIZE, mergeHistoryTimelinePages } from "./features/history/historyPagination";
import { AiConnectionStatusBar, resolveAiConnectionStatus } from "./features/ai-connection/AiConnectionStatusBar";
import {
  aiConnectionIssueKindFromMessage,
} from "./features/ai-connection/aiConnectionHealth";
import { appIconIdentityKey, collectMissingAppIconRequests, mergeAppIconResults, type AppIconLoadRequest } from "./features/app-icons/appIconRequests";
import { AI_CLASSIFICATION_BACKGROUND_THRESHOLD, AI_CLASSIFICATION_FOCUSED_IDLE_MS, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD, classifyLiveActivityWithAi, diffAiClassificationUsageSummary, projectAiClassificationCost, runAiClassification, runAiClassificationForUnknownThreshold, runAiClassificationUntilEmpty, toClassificationQueryForDay, type AiClassificationSummary, type AiClassificationUsageSummary } from "./features/classification/aiClassificationService";
import { useClassificationActivity } from "./features/classification/classificationActivity";
import { ClassificationPage } from "./features/classification/ClassificationPage";
import { materializeBuiltInHeuristicClassifications, scheduleBuiltInHeuristicClassificationPersistence, type BuiltInHeuristicClassificationMaterialization } from "./features/classification/heuristicClassificationMaterialization";
import { useClassificationRulesController } from "./features/classification/useClassificationRulesController";
import { AvailableUpdateDialog } from "./features/updates/AvailableUpdateDialog";
import { TopbarUpdateButton } from "./features/updates/TopbarUpdateButton";
import { useUpdateController } from "./features/updates/useUpdateController";
import { consumePostUpdateRelaunchFocusPending, fallbackUpdatePolicy } from "./features/updates/updatePolicy";
import { useDeveloperPreReleaseUpdateController } from "./features/updates/useDeveloperPreReleaseUpdateController";
import { trackerClient } from "./lib/api/trackerClient";
import { accessibilityClient } from "./lib/api/accessibilityClient";
import { shouldUsePreviewData } from "./lib/api/previewData";
import { setOnboardingWindowPresentation } from "./lib/api/windowChromeClient";
import {
  capturePostHogEvent,
  toAnalyticsErrorKind,
} from "./lib/analytics/posthog";
import { cleanupTauriEventListener } from "./lib/tauriEventCleanup";
import { DEV_SETTINGS_ENABLED, END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED, END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED, isDevOnboardingBypassEnabled, TEAMS_BETA_ENABLED, WATCHER_PEEK_PROTOTYPE_ENABLED } from "./appFeatureSwitches";
import { useAuth } from "./features/auth/AuthContext";
import type { AuthConnectionStatus } from "./features/auth/authConnectionStatus";
import { AuthModal } from "./features/auth/AuthModal";
import { FeedbackModal } from "./features/feedback/FeedbackModal";
import { DebugLogModal } from "./features/settings/DebugLogModal";
import { AccountSettingsSection } from "./features/settings/AccountSettingsSection";
import { AppearanceSettingsSection } from "./features/settings/AppearanceSettingsSection";
import { ClassificationSettingsSection } from "./features/settings/ClassificationSettingsSection";
import { DataExportSettingsSection } from "./features/settings/DataExportSettingsSection";
import { DevSettingsSection } from "./features/settings/DevSettingsSection";
import { GeneralSettingsSection } from "./features/settings/GeneralSettingsSection";
import type { AppThemeColorKey } from "./features/settings/SettingsColorControls";
import { NotificationsSettingsSection } from "./features/settings/NotificationsSettingsSection";
import { SettingsSidebar, type SettingsSection } from "./features/settings/SettingsSidebar";
import { useAnalysisModelSetup } from "./features/settings/useAnalysisModelSetup";
import { useProjectClassification } from "./features/classification/useProjectClassification";
import { ProjectsPage } from "./features/projects/ProjectsPage";
import { contextualProjectColorBySegment, projectColorMap } from "./features/flow-chart/projectFlowView";

const PROJECT_PASS_CONSENT_STORAGE_KEY = "drifty.projectPass.consent.v1";
import { buildDebugLogPayload } from "./features/settings/debugLog";
import {
  OnboardingModal,
  hasCompletedUserOnboarding,
  type UserOnboardingState,
} from "./features/onboarding/OnboardingModal";
import { FirstDayPreparationScreen, type FirstDayPreparationPhase } from "./features/onboarding/FirstDayPreparationScreen";
import { useFirstDayPreparation } from "./features/onboarding/useFirstDayPreparation";
import { OnboardingV22Preview } from "./features/onboarding/previews/OnboardingV22Preview";
import {
  WatcherPeek,
  type WatcherPeekEvent,
  type WatcherPeekResponse,
} from "./features/companion/WatcherPeek";
import {
  EndOfDayReview,
  buildEndOfDayReviewSummary,
  type EndOfDayReviewEvent,
} from "./features/companion/EndOfDayReview";
import {
  DriftAlarm,
  buildBreakReturnAlarmEvent,
  buildDriftAlarmEvent,
  type DriftAlarmAction,
  type DriftAlarmEvent,
  type DriftAlarmFocusTarget,
} from "./features/companion/DriftAlarm";
import {
  hideNativeWatcherPeek,
  isTauriRuntime,
  listenToNativeEndOfDayReviewAction,
  listenToNativeWatcherDismissed,
  listenToNativeWatcherResponse,
  showNativeEndOfDayReview,
  showNativeExtremeNudgeToast,
  showNativeWatcherPeek,
  type EndOfDayReviewAction,
} from "./features/companion/watcherBridge";
import {
  applyNativeExtremeNudge,
  hideNativeDriftAlarm,
  listenToNativeDriftAlarmAction,
  listenToNativeDriftAlarmDismissed,
  showNativeDriftAlarm,
} from "./features/companion/driftAlarmBridge";
import { evaluateYouTubeDriftAlarmGate } from "./features/companion/youtubeDriftAlarmGate";
import {
  buildDriftAlarmManualCorrectionRecord,
  buildDriftAlarmManualCorrectionRuleInput,
} from "./features/companion/driftAlarmManualCorrection";
import {
  CloudTrialStartedNotice,
} from "./features/billing/CloudTrialStartedNotice";
import { useCloudBillingController } from "./features/billing/useCloudBillingController";
import { AiSetupSettingsSection } from "./features/settings/AiSetupSettingsSection";
import { DeleteHistoryModal } from "./features/settings/DeleteHistoryModal";
import { PrivacySettingsSection } from "./features/settings/PrivacySettingsSection";
import { getAuthMetadataAvatarUrl } from "./features/auth/accountDisplay";
import { buildClassificationActivityRows, buildClassificationCategoryBreakdowns, buildClassificationSourceSummaries, classifySegmentSourceKey, classifySourceKey } from "./features/classification/classificationViewData";
import { DRIFT_ALARM_PREVIEW_OPTIONS, buildDriftAlarmCandidates, buildExtremeNudgeTarget, buildExtremeNudgeToastEvent, activateFocusTargetSite, buildRecentFocusTargets, canApplyExtremeNudgeToCategory, hasDriftAlarmFocusTargetUpdate } from "./features/companion/driftAlarmData";
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
import { buildBreakRecoveryAttempt, buildBreakRecoveryInsight, buildBreakSnooze, readDriftAlarmInteractions, recordDriftAlarmInteraction, resolveBreakRecoveryOutcome } from "./features/companion/driftAlarmRecovery";
import type { BreakRecoveryOutcome, DriftAlarmBreakSnooze, DriftAlarmInteraction } from "./features/companion/driftAlarmRecovery";
import { END_OF_DAY_REVIEW_STORAGE_KEY, END_OF_DAY_REVIEW_TRIGGER_MINUTE, buildMockEndOfDayReviewSegments, collectMissingEndOfDayReviewIconRequests, mergeResolvedAppIcons } from "./features/companion/endOfDayReviewData";
import type { EndOfDayReviewSummaryInput } from "./features/companion/endOfDayReviewData";
import { WATCHER_INITIAL_PEEK_DELAY_MS, WATCHER_STALE_EVENT_RECOVERY_MS, buildWatcherSnapshot, getDefaultWatcherSnapshot, getWatcherContextLabel, getWatcherScheduleDelayMs, persistWatcherResponse, resolveWatcherSnapshot, sendDriftNotification, showDueDriftWatcherPeek } from "./features/companion/watcherData";
import type { DriftReminderState, WatcherSnapshot } from "./features/companion/watcherData";
import { getDashboardCurrentPeriodLabel, getDashboardPeriodRange, getInsightPeriodRange, getSafeClassificationNavigationDay, shiftDashboardPeriodDay, shiftInsightPeriodDay } from "./features/dashboard/dashboardPeriods";
import type { ClassificationRange, InsightRange } from "./features/dashboard/dashboardPeriods";
import { buildActivityRefreshPlan } from "./features/dashboard/activityRefreshPlan";
import { buildQuarterHourDayField } from "./features/dashboard/dayField";
import { applyFocusDriftReplayReveal, buildFocusDriftChart, buildProductivityQualityPercent } from "./features/dashboard/focusDriftChart";
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
import { buildAttentionRhythm, buildInsightSourceLists, buildWeeklyBreakdown, NO_PROJECT_KEY, NO_PROJECT_LABEL } from "./features/insights/insightData";
import { selectInsightSegments } from "./features/insights/insightSegments";
import { useAiSetupController } from "./features/settings/useAiSetupController";
import { useManagedLocalModelAttach } from "./features/settings/useManagedLocalModelAttach";
import { isManagedLocalAiRoute } from "./features/settings/localAiSetup";
import { AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY, APP_THEME_COLOR_OPTIONS, APP_THEME_COLOR_STORAGE_KEY, CATEGORY_COLOR_OPTIONS, CATEGORY_COLOR_STORAGE_KEY, DEV_MODE_STORAGE_KEY, PROJECT_CLASSIFICATION_ENABLED_STORAGE_KEY, TEAMS_BETA_STORAGE_KEY, FORCE_BROWSER_HISTORY_URL_FALLBACK_STORAGE_KEY, FORCE_CHROMIUM_AX_CAPTURE_STORAGE_KEY, FORCE_CHROMIUM_AX_EXTREME_NUDGE_STORAGE_KEY, FORCE_FRONTMOST_FALLBACK_CAPTURE_STORAGE_KEY, SIDEBAR_COLLAPSED_STORAGE_KEY, START_OF_DAY_STORAGE_KEY, START_OF_WEEK_STORAGE_KEY, THEME_STORAGE_KEY, hourlyStartOfDayValueToMinutes, isHexColor, minutesToHourlyStartOfDayValue, persistDemoDashboardReplaySettings, persistWeekDashboardAxisScalePercent, resetDemoDashboardReplaySettings, resetWeekDashboardAxisScalePercent, resolveEffectiveWeekDashboardAxisScalePercent, resolveInitialAiClassificationVisibility, resolveInitialAppThemeColorOverrides, resolveInitialCategoryColorOverrides, resolveInitialDemoDashboardReplaySettings, resolveInitialDevModeEnabled, resolveInitialProjectClassificationEnabled, resolveInitialTeamsBetaEnabled, resolveInitialForceBrowserHistoryUrlFallbackEnabled, resolveInitialForceChromiumAxCaptureEnabled, resolveInitialForceChromiumAxExtremeNudgeEnabled, resolveInitialForceFrontmostFallbackCaptureEnabled, resolveInitialSidebarCollapsed, resolveInitialStartOfDayMinutes, resolveInitialStartOfWeek, resolveInitialTheme, resolveInitialWeekDashboardAxisScalePercent } from "./features/settings/settingsStorage";
import type { AppThemeColorOverrides, CategoryColorOverrides, DemoDashboardReplaySettings, StartOfWeek, ThemeMode } from "./features/settings/settingsStorage";
import { CATEGORY_COLORS } from "./lib/activityLabels";
import { describeRelativeDay, filterSegmentsForRange, formatCompactDurationFromSeconds, formatDateRangeLabel, formatDayLabel, formatDuration, formatQuarterHourLabel, formatRelativeTime, formatTimeLabel, getLogicalDayRange, isoDateFromTimestamp, logicalTodayIsoDate, toErrorMessage } from "./lib/formatting";
import { DateNavigator } from "./components/DateNavigator";
import { MainContentShell, NavIcon, WindowThemeToggle } from "./app/AppShell";
import { activityNav, commandBarTabs, dashboardPeriodOptions, type NavigationHistoryState, type TabId } from "./app/navigation";
import {
  captureAiClassificationRun,
  toAiProviderAnalytics,
  toAppSurfaceAnalytics,
  toDashboardPeriodAnalytics,
  toTrackerModeAnalytics,
} from "./app/appAnalytics";
import { aiServerStatusLabelForCloud, driftyCloudStatusLabel, hasAiClassificationUsageMeasurement } from "./features/ai-connection/aiStatusLabels";
import { AccountMenu } from "./features/auth/AccountMenu";
import { AuthConfigurationGate, AuthRequiredGate } from "./features/auth/AuthGates";
import type { ClassificationPanelStyle } from "./features/classification/ClassificationBreakdownCards";
import { FocusDriftSection } from "./features/dashboard/FocusDriftSection";
import type { TimelineHoverState } from "./features/dashboard/HoverCards";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import type { CompactRingEntry } from "./features/dashboard/CompactRingChart";
import { selectDashboardSegments, type DashboardHistoryRange, type DashboardSegmentSource } from "./features/dashboard/dashboardWeekData";
import { DASHBOARD_PREVIOUS_WEEK_FOCUS_DELAY_MS, resolveDashboardRefreshMode, shouldRefreshHistoryData, type DashboardPreviousWeekFocusLoad, type DashboardRefreshInputs, type DashboardWeekRefreshState, type DashboardWeekRefreshStatus } from "./features/dashboard/dashboardRefreshPolicy";
import { DeferredTabBodyFallback } from "./features/loading/DeferredTabBodyFallback";
import { TrendsPage } from "./features/insights/TrendsPage";
import { ProfileDialogs } from "./features/profile/ProfileDialogs";
import { copyTextToClipboard } from "./features/profile/ProfileModals";
import { useDeferredTabBodyReady } from "./app/useDeferredTabBodyReady";
import { buildClassificationCorrectionDraft, buildClassificationCorrectionRecord, type ClassificationCorrectionDraft, type ClassificationCorrectionScope } from "./features/classification/classificationCorrection";
import { compactHistoryRangeContains, compactHistoryRangeKey, findFreshCompactHistoryLoad, type CompactHistoryLoad, type CompactHistoryRange } from "./features/dashboard/compactHistoryCache";
import { extremeNudgeErrorDiagnostic, getDriftAlarmPollTimelineRange, mergeDriftAlarmSegments, rememberDriftAlarmSourceSegment, type DriftAlarmEvaluationInput, type DriftAlarmEvaluator, type DriftAlarmTrayPublishOptions } from "./features/companion/driftAlarmEvaluation";
import { EMPTY_ACTIVITY_SEGMENTS, latestActivitySegmentCursor, mergeActivitySegments } from "./lib/activitySegments";
import { scheduleIdleWork } from "./lib/scheduleIdleWork";

const AUTO_UPDATE_CHECK_DELAY_MS = 2500;
const POST_UPDATE_RELAUNCH_FOCUS_DELAY_MS = 250;
const APP_REFRESH_INTERVAL_MS = 30_000;
const FOCUSED_LIVE_TAIL_LIMIT = 8;
const LAST_CAPTURE_JUST_NOW_MS = 10_000;
const DRIFT_ALARM_POLL_INTERVAL_MS = 15_000;
const AUTO_AI_CLASSIFICATION_INTERVAL_MS = 2 * 60 * 1000;
const LIVE_DRIFT_ALARM_AI_UNAVAILABLE_RETRY_MS = 2 * 60 * 1000;
const LIVE_DRIFT_ALARM_AI_UNKNOWN_RETRY_MS = 5 * 60 * 1000;
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

export default function App() {
  const contentRef = useRef<HTMLElement>(null);
  const endOfDayReviewSettingsRowRef = useRef<HTMLDivElement>(null);
  const autoUpdateLaunchCheckScheduledRef = useRef(false);
  const previousSurfaceAnalyticsKeyRef = useRef<string | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryState>({ entries: [{ tabId: "dashboard", dashPeriod: "Today" }], index: 0 });
  const activeSnapshot = navigationHistory.entries[navigationHistory.index] ?? { tabId: "dashboard", dashPeriod: "Today" };
  const activeTab = activeSnapshot.tabId;
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
  const hasTrackerStatus = status !== null;
  const [brandCaptureMotionKey, setBrandCaptureMotionKey] = useState(0);
  const triggerBrandCaptureMotion = useCallback(() => {
    setBrandCaptureMotionKey((currentKey) => currentKey + 1);
  }, []);
  const brandCaptureEventAtRef = useRef<string | null>(null);
  const hasObservedBrandCaptureRef = useRef(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
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
  const [dashboardWeekRefreshState, setDashboardWeekRefreshState] = useState<DashboardWeekRefreshState>({ key: null, status: "idle" });
  const [hourly, setHourly] = useState<HourBucket[]>([]);
  const [insightHourly, setInsightHourly] = useState<HourBucket[]>([]);
  const [insightTopSites, setInsightTopSites] = useState<SiteDuration[]>([]);
  const [appIcons, setAppIcons] = useState<AppIconMap>({});
  const appIconsRef = useRef<AppIconMap>({});
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flowIntervalMinutes, setFlowIntervalMinutes] = useState<FlowIntervalMinutes>(3);
  const [classificationRange, setClassificationRange] = useState<ClassificationRange>("Day");
  const [trendsRange, setTrendsRange] = useState<InsightRange>("Week");
  const [classifySelectedCategoryId, setClassifySelectedCategoryId] = useState<ActivityCategory | null>(null);
  const [classifySelectedSourceId, setClassifySelectedSourceId] = useState<string | null>(null);
  const [expandedClassificationActivityRows, setExpandedClassificationActivityRows] = useState<Set<string>>(() => new Set());
  const [classificationCorrectionDraft, setClassificationCorrectionDraft] = useState<ClassificationCorrectionDraft | null>(null);
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
  const [devModeEnabled, setDevModeEnabled] = useState(resolveInitialDevModeEnabled);
  const [teamsBetaEnabled, setTeamsBetaEnabled] = useState(resolveInitialTeamsBetaEnabled);
  const [onboardingV22PreviewOpen, setOnboardingV22PreviewOpen] = useState(false);
  const isDevModeActive = DEV_SETTINGS_ENABLED && devModeEnabled;
  const canOpenTeamsBeta = TEAMS_BETA_ENABLED && devModeEnabled && teamsBetaEnabled;
  const [weekDashboardAxisScalePercent, setWeekDashboardAxisScalePercent] = useState(resolveInitialWeekDashboardAxisScalePercent);
  const effectiveWeekDashboardAxisScalePercent = resolveEffectiveWeekDashboardAxisScalePercent(isDevModeActive, weekDashboardAxisScalePercent);
  // Project classification is a Dev-mode preview control (opt-in, off by default):
  // the Dev-settings toggle is the sole gate, so it is available in any build —
  // including public/prerelease binaries — only after the user turns it on.
  const [devProjectClassificationEnabled, setDevProjectClassificationEnabled] = useState(resolveInitialProjectClassificationEnabled);
  const projectClassificationFeatureEnabled = devProjectClassificationEnabled;
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
    handleWatcherPeriodicMaxChange,
    handleWatcherPeriodicMinChange,
    setDriftAlertDelaySeconds,
    setDriftAlarmCopy,
    setDriftAlertsEnabled,
    setExtremeNudgeEnabled,
    setWatcherMode,
    setWatcherPeekEnabled,
    watcherMode,
    watcherPeekEnabled,
    watcherPeriodicMaxMinutes,
    watcherPeriodicMinMinutes,
  } = useCompanionSettingsController();
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
  const [dismissedDashboardAiRecoveryKey, setDismissedDashboardAiRecoveryKey] = useState<string | null>(null);
  const [watcherEvent, setWatcherEvent] = useState<WatcherPeekEvent | null>(null);
  const [endOfDayReviewEvent, setEndOfDayReviewEvent] = useState<EndOfDayReviewEvent | null>(null);
  const [driftAlarmEvent, setDriftAlarmEvent] = useState<DriftAlarmEvent | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    appIconsRef.current = appIcons;
  }, [appIcons]);

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

  function handleWeekDashboardAxisScalePercentChange(scalePercent: number) {
    setWeekDashboardAxisScalePercent(persistWeekDashboardAxisScalePercent(scalePercent));
  }

  function handleResetWeekDashboardAxisScalePercent() {
    setWeekDashboardAxisScalePercent(resetWeekDashboardAxisScalePercent());
  }

  const navigateBack = useCallback(() => {
    setNavigationHistory((current) => (current.index > 0 ? { ...current, index: current.index - 1 } : current));
  }, []);

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

  const handleTrayCheckForUpdates = useCallback(() => {
    setSettingsSection("general");
    navigateToTab("settings");
    setAccountMenuOpen(false);
    void handleCheckForUpdates();
  }, [handleCheckForUpdates, navigateToTab]);

  const handleAppMenuCheckLatestBuild = useCallback(() => {
    void developerPreReleaseUpdateController.checkLatestBuild();
  }, [developerPreReleaseUpdateController.checkLatestBuild]);

  const handleAppMenuToggleDevMode = useCallback(() => {
    setDevModeEnabled((enabled) => !enabled);
  }, []);

  const openEndOfDayReviewSettings = useCallback(() => {
    if (!END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED) return;
    if (!isDevModeActive) return;
    shouldFocusEndOfDayReviewSettingsRef.current = true;
    setSettingsSection("dev");
    navigateToTab("settings");
    setAccountMenuOpen(false);
  }, [isDevModeActive, navigateToTab]);

  const openEndOfDayReviewDashboard = useCallback(() => {
    setEndOfDayReviewEvent(null);
    selectDay(logicalTodayIsoDate(startOfDayMinutes));
    navigateToTab("dashboard", "Today");
  }, [navigateToTab, startOfDayMinutes]);

  const handleEndOfDayReviewAction = useCallback((action: EndOfDayReviewAction) => {
    setEndOfDayReviewEvent(null);

    if (action === "openNotificationSettings") {
      openEndOfDayReviewSettings();
      return;
    }

    openEndOfDayReviewDashboard();
  }, [openEndOfDayReviewDashboard, openEndOfDayReviewSettings]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
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
  const [observedAiClassificationFailure, setObservedAiClassificationFailure] = useState(false);
  const [rendererFocused, setRendererFocused] = useState(isRendererFocused);
  const [timelineHover, setTimelineHover] = useState<TimelineHoverState | null>(null);
  const [compactHistoryCacheRevision, setCompactHistoryCacheRevision] = useState(0);
  const [weekDashboardCacheRevision, setWeekDashboardCacheRevision] = useState(0);
  const selectedDayClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      fallbackCandidates: segments,
      includeAiClassifications: showAiClassificationImpact,
      rules: classificationRules,
    }),
    [classificationRules, segments, showAiClassificationImpact],
  );
  const materializeBuiltInHeuristicTimeline = useCallback((sourceSegments: ActivitySegment[]) => materializeBuiltInHeuristicClassifications({
    classificationOptions: { fallbackCandidates: sourceSegments, includeAiClassifications: false, rules: classificationRules },
    segments: sourceSegments,
  }), [classificationRules]);
  const recentDriftAlarmFocusTargets = useMemo(
    () => buildRecentFocusTargets(segments, historySegments, selectedDayClassificationOptions, appIcons),
    [appIcons, historySegments, segments, selectedDayClassificationOptions],
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
    signInWithWebsite,
    signInWithGoogle,
    signInAnonymously,
    signOut,
    isEnabled: isSupabaseConfigured,
    isAuthRequired,
    allowsAnonymousAuth,
    hasRequiredAccountAuth,
    hasBlockingAuthConfigurationError,
  } = useAuth();
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
  const requestCloudBillingAuth = useCallback(() => setAuthModalOpen(true), []);
  const {
    billingCheckoutLoadingInterval,
    billingEntitlement,
    billingEntitlementError,
    billingEntitlementLoading,
    billingPortalLoading,
    cloudDeviceActionError,
    cloudDeviceRevokingId,
    cloudDevices,
    cloudTrialStartedNotice,
    dismissCloudTrialStartedNotice,
    handleManageCloudBilling,
    handleRevokeCloudDevice,
    handleStartDriftyCloudSetup,
    openCloudTrialStartedNoticeAiSetup,
    refreshBillingEntitlement,
  } = useCloudBillingController({
    hasRequiredAccountAuth,
    isSupabaseConfigured,
    shouldCheckBillingEntitlement,
    user,
    onAuthRequired: requestCloudBillingAuth,
    onOpenAiSetup: openAiSetupSettings,
  });
  const canUseCloudAiClassification = isCloudOnline && isSupabaseConfigured && isPolicySignedIn && billingEntitlement?.canUseApp === true;
  const requestLeaderboardAuth = useCallback(() => setAuthModalOpen(true), []);
  const requestTeamAuth = useCallback(() => setAuthModalOpen(true), []);
  const {
    activeLeaderboardPeriod,
    isLeaderboardOptedIn,
    isProfileEditorOpen,
    leaderboardActionError,
    leaderboardActionLoading,
    leaderboardError,
    leaderboardLoading,
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
    leaderboardWindowStartDay,
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
    handleSaveProfileFromModal,
    handleSelectLeaderboardProfile,
    handleShareLeaderboardProfile,
    handleViewOwnLeaderboardProfile,
    openProfileEditor,
    isEmbedOpen,
    embedFocusSeconds,
    openEmbed,
    closeEmbed,
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
    isEffectiveAuthRequired,
    isSupabaseConfigured,
    showAiClassificationImpact,
    signInAnonymously,
    startOfDayMinutes,
    user,
    onAuthRequired: requestLeaderboardAuth,
  });
  const aiClassificationProviderKey = localAiClassificationOptions
    ? `local:${localAiConnectionFingerprint ?? "unconfigured"}`
    : canUseCloudAiClassification
      ? "cloud"
      : "disabled";
  const classificationActivity = useClassificationActivity();
  const aiConnectionStatus = resolveAiConnectionStatus({
    canUseCloudAi: canUseCloudAiClassification,
    localProviderStatus: localAiProviderStatus,
    localProviderLabel: localAiConnectionFingerprint ? localAiConnectionProviderLabel : null,
    localMemoryUsageBytes: localAiMemoryUsageBytes,
    classificationRunning: classificationActivity.running || classificationActionLoading || classificationSummary?.status === "running",
    classificationRemaining: classificationActivity.remaining,
    classificationIssueKind: classificationSummary?.status === "error" ? aiConnectionIssueKindFromMessage(classificationSummary.message) : null,
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
    previousAiClassificationProviderKeyRef.current = aiClassificationProviderKey;
    setObservedAiClassificationFailure(false);
  }, [aiClassificationProviderKey]);
  const isSettingsTab = activeTab === "settings";
  const isSidebarVisuallyCollapsed = !isSettingsTab && sidebarCollapsed;
  const refreshRequestRef = useRef(0);
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
  const shouldFocusEndOfDayReviewSettingsRef = useRef(false);
  const driftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const lastDriftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const driftAlarmSourceSegmentsRef = useRef<Map<string, ActivitySegment>>(new Map());
  const appIconRequestsInFlightRef = useRef<Set<string>>(new Set());
  const driftAlarmRequestInFlightRef = useRef(false);
  const liveDriftAlarmRefreshInFlightRef = useRef(false);
  const liveDriftAlarmAiRequestInFlightRef = useRef<string | null>(null);
  const liveDriftAlarmAiRetryAfterRef = useRef<Map<string, number>>(new Map());
  const pendingDriftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const pendingBreakReturnAlarmRef = useRef<DriftAlarmBreakSnooze | null>(null);
  const evaluateDriftAlarmRef = useRef<DriftAlarmEvaluator | null>(null);
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
    materializeBuiltInHeuristicTimeline,
    normalizedHistorySearchQuery,
    shouldBlockLocalTrackerAccess,
  ]);

  const publishDriftAlarmTrayStatus = useCallback((result: DriftAlarmTrayResult, checkedAt: Date | null = new Date(), options?: DriftAlarmTrayPublishOptions) => {
    const nextStatus = buildDriftAlarmTrayStatus({
      enabled: driftAlertsEnabled,
      checkedAt,
      result,
    });
    const nextNativeStatus = {
      ...nextStatus,
      trackerRunning: status?.running ?? null,
    };
    recordDriftAlarmDebugEvent({
      kind: "tray_status_published",
      trayResult: summarizeDriftAlarmTrayResult(result),
    });

    if (options?.updateRendererState === false) {
      const client = trackerClient as Partial<typeof trackerClient>;
      if (typeof client.updateTrayDriftAlarmStatus === "function") {
        void client.updateTrayDriftAlarmStatus(nextNativeStatus).catch(() => undefined);
      }
      return;
    }

    setDriftAlarmTrayStatus(nextStatus);
  }, [driftAlertsEnabled, status?.running]);
  const driftAlarmPreviewCounterRef = useRef(0);
  const driftReminderStateRef = useRef<DriftReminderState | null>(null);
  const segmentsRef = useRef<ActivitySegment[]>([]);
  const liveDriftAlarmSegmentsRef = useRef<ActivitySegment[]>([]);
  const driftAlarmDayRef = useRef(logicalTodayIsoDate(startOfDayMinutes));
  const driftAlarmBaseSegmentsRef = useRef<ActivitySegment[]>([]);
  const driftAlarmHistorySegmentsRef = useRef<ActivitySegment[]>([]);
  const focusedLiveTailRefreshInFlightRef = useRef(false);
  const rendererFocusedRef = useRef(rendererFocused);
  const selectedDayRef = useRef(selectedDay);
  const lastRendererInteractionAtRef = useRef(Date.now());
  const aiClassificationInFlightRef = useRef(false);

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
    clearPendingTransientRefresh();
  }

  function clearPausedDriftAlarmRuntime() {
    pendingDriftAlarmGateRef.current = null;
    lastEligibleDriftCandidateRef.current = null;
    pendingDriftAlarmTransientRef.current = null;
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
    if (!isTauriRuntime() || missingIconRequests.length === 0) return baseEvent;

    try {
      const resolvedIcons = await trackerClient.getAppIcons(missingIconRequests);
      return buildEndOfDayReviewSummary({
        ...input,
        appIcons: mergeResolvedAppIcons(currentAppIcons, missingIconRequests, resolvedIcons),
      });
    } catch {
      return baseEvent;
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
    void showNativeDriftAlarm(event).then(() => {
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

  const previewDriftAlarm = useCallback((option: typeof DRIFT_ALARM_PREVIEW_OPTIONS[number]) => {
    driftAlarmPreviewCounterRef.current += 1;
    showDriftAlarm(buildDriftAlarmEvent({
      id: `drift-alarm-preview-${option.id}-${Date.now()}-${driftAlarmPreviewCounterRef.current}`,
      contextLabel: option.contextLabel,
      driftDurationSeconds: option.driftDurationSeconds,
      preservedFocusStrikeSeconds: option.preservedFocusStrikeSeconds,
      generatedAt: new Date().toISOString(),
      focusTargets: availableDriftAlarmFocusTargets,
      sourceSiteDomain: option.sourceSiteDomain,
      sourceAppName: option.sourceAppName,
      sourceIconSrc: option.sourceIconSrc,
      copySettings: driftAlarmCopy,
    }));
  }, [availableDriftAlarmFocusTargets, driftAlarmCopy, showDriftAlarm]);

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
    void hideNativeDriftAlarm();
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
          if (refreshRequestRef.current !== requestId) return nextStatus;
          setStatus(nextStatus);
          setAccessibilityGranted(nextStatus.accessibilityGranted);
          return nextStatus;
        })
        : Promise.resolve(status);

      const currentSnapshotRequest = isForegroundRefresh
        ? statusRequest.then((nextStatus) => {
            if (refreshRequestRef.current !== requestId) return null;
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

      const materializedTimeline = materializeBuiltInHeuristicTimeline(timeline);
      const materializedArchiveTimelines = archiveTimelineLoad?.materialized ?? null;
      const alarmDay = currentDriftAlarmDay();
      const isAlarmDayRefresh = day === alarmDay;

      if (isForegroundRefresh) setCurrentSnapshot(nextCurrentSnapshot);
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
    const sourceRow = rowId ? classificationActivityRows.find((row) => row.id === rowId) ?? null : null;
    const sourceSegment = sourceRow?.segments[0]
      ?? (rowId ? null : classificationActivityRows[0]?.segments[0] ?? classificationSourceSegments.find((segment) => classifySegmentSourceKey(segment) === effectiveClassifySourceId) ?? null);
    if (!sourceSegment) return;
    const draft = buildClassificationCorrectionDraft({
      rowId,
      scope,
      segment: sourceSegment,
      classificationOptions,
      detailDisplayLabel: sourceRow?.label ?? null,
    });
    if (!draft) return;
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

    setClassificationCorrectionSaving(true);
    try {
      if (draft.scope === "detail" && draft.rowId) {
        const row = classificationActivityRows.find((item) => item.id === draft.rowId) ?? null;
        const classifiedAt = new Date().toISOString();
        if (row && row.segments.length > 0) {
          await trackerClient.saveClassifications(row.segments.map((segment) => buildClassificationCorrectionRecord({
            category: draft.category,
            classifiedAt,
            productivity: draft.productivity,
            segment,
          })));
        }
      }

      const saved = await saveClassificationRule(ruleInput);
      if (saved) {
        setClassificationCorrectionDraft(null);
        await refresh(selectedDayRef.current);
      }
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
  // Picking Local AI in onboarding routes classification to the managed model the
  // moment the download starts (driftyRoute "local"), so the route — not the
  // provider default — is the "user chose Local AI" signal.
  const managedLocalSelected = isManagedLocalAiRoute(localAiSetup);
  // Once onboarding closes with a managed download still in flight, this watcher
  // writes the ready model into the AI setup and sends the ready notification.
  useManagedLocalModelAttach(
    !onboardingOpen && managedLocalSelected && localAiClassificationOptions === null,
    setLocalAiSetup,
  );

  const { rearm: rearmFirstDayPreparation } = useFirstDayPreparation({
    canUseCloudAiClassification,
    clearLocalActivityCaches,
    localAiClassificationOptionsRef,
    managedLocalSelected,
    onReveal: () => setPreparingFirstDay(false),
    preparingFirstDay,
    refresh,
    runAiClassification,
    runAiClassificationUntilEmpty,
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

      if (day !== currentDriftAlarmDay()) return false;
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

  const refreshFocusedLiveTail = useCallback(async (day: string): Promise<boolean> => {
    if (focusedLiveTailRefreshInFlightRef.current) return false;
    if (shouldBlockLocalTrackerAccess) return false;
    if (selectedDayRef.current !== day) return false;

    focusedLiveTailRefreshInFlightRef.current = true;
    try {
      const selectedDayRange = getLogicalDayRange(day, day, startOfDayMinutes);
      const cursor = latestActivitySegmentCursor(segmentsRef.current);
      const liveTail = await trackerClient.getLiveTail({
        ...selectedDayRange,
        ...cursor,
        limit: FOCUSED_LIVE_TAIL_LIMIT,
      });

      if (selectedDayRef.current !== day) return false;

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
      focusedLiveTailRefreshInFlightRef.current = false;
    }
  }, [shouldBlockLocalTrackerAccess, startOfDayMinutes]);

  useEffect(() => {
    window.__DRIFTY_SET_BOOT_STATUS__?.("Renderer mounted. Showing minimal shell\u2026");
    window.__DRIFTY_BOOTSTRAPPED__ = true;
    document.getElementById("boot-shell")?.remove();
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
    if (status.trackerMode === "unavailable") return;

    autoStartAttemptedRef.current = true;
    void handleStartTracking();
  }, [hasLoadedOnce, shouldBlockLocalTrackerAccess, status]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return undefined;
    const intervalId = setInterval(() => {
      if (selectTodayAfterDateRollover()) return;
      if (rendererFocusedRef.current) {
        void refreshFocusedLiveTail(selectedDay);
        return;
      }
      void refresh(selectedDay);
    }, APP_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [activeTab, classificationRange, dashPeriod, refreshFocusedLiveTail, selectTodayAfterDateRollover, selectedDay, shouldBlockLocalTrackerAccess, trendsRange]);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return undefined;
    if (!driftAlertsEnabled) return undefined;
    if (status?.running !== true) return undefined;

    const intervalId = setInterval(() => {
      if (selectTodayAfterDateRollover()) return;
      // Keep this heavy snapshot poll out of the focused renderer path; alarms resume on the normal cadence once Drifty loses focus.
      if (rendererFocusedRef.current) return;
      void refreshLiveDriftAlarmActivity(currentDriftAlarmDay());
    }, DRIFT_ALARM_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [driftAlertsEnabled, refreshLiveDriftAlarmActivity, selectTodayAfterDateRollover, shouldBlockLocalTrackerAccess, startOfDayMinutes, status?.running]);

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
    window.localStorage.setItem(PROJECT_CLASSIFICATION_ENABLED_STORAGE_KEY, devProjectClassificationEnabled ? "1" : "0");
  }, [devProjectClassificationEnabled]);

  // Leaving the Projects tab visible after the preview is switched off would strand
  // the user on a hidden surface — send them back to the dashboard.
  useEffect(() => {
    if (!projectClassificationFeatureEnabled && activeTab === "projects") navigateToTab("dashboard");
  }, [projectClassificationFeatureEnabled, activeTab, navigateToTab]);

  useEffect(() => {
    const effectiveDevModeEnabled = DEV_SETTINGS_ENABLED && devModeEnabled;
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, effectiveDevModeEnabled ? "1" : "0");
    if (effectiveDevModeEnabled) return;
    if (settingsSection === "dev") setSettingsSection("general");
    if (teamsBetaEnabled) setTeamsBetaEnabled(false);
    if (forceChromiumAxCaptureEnabled) setForceChromiumAxCaptureEnabled(false);
    if (forceFrontmostFallbackCaptureEnabled) setForceFrontmostFallbackCaptureEnabled(false);
    if (forceBrowserHistoryUrlFallbackEnabled) setForceBrowserHistoryUrlFallbackEnabled(false);
    if (forceChromiumAxExtremeNudgeEnabled) setForceChromiumAxExtremeNudgeEnabled(false);
  }, [devModeEnabled, forceBrowserHistoryUrlFallbackEnabled, forceChromiumAxCaptureEnabled, forceChromiumAxExtremeNudgeEnabled, forceFrontmostFallbackCaptureEnabled, settingsSection, teamsBetaEnabled]);

  useEffect(() => {
    const effectiveTeamsBetaEnabled = TEAMS_BETA_ENABLED && DEV_SETTINGS_ENABLED && devModeEnabled && teamsBetaEnabled;
    window.localStorage.setItem(TEAMS_BETA_STORAGE_KEY, effectiveTeamsBetaEnabled ? "1" : "0");
  }, [devModeEnabled, teamsBetaEnabled]);

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
    window.localStorage.setItem(FORCE_CHROMIUM_AX_CAPTURE_STORAGE_KEY, forceChromiumAxCapture ? "1" : "0");
    window.localStorage.setItem(FORCE_FRONTMOST_FALLBACK_CAPTURE_STORAGE_KEY, forceFrontmostFallbackCapture ? "1" : "0");
    window.localStorage.setItem(FORCE_BROWSER_HISTORY_URL_FALLBACK_STORAGE_KEY, forceBrowserHistoryUrlFallback ? "1" : "0");
    void trackerClient.setDeveloperDiagnostics?.({ forceChromiumAxCapture, forceFrontmostFallbackCapture, forceBrowserHistoryUrlFallback }).catch((nextError) => {
      console.warn("Failed to persist tracker developer diagnostics", nextError);
    });
  }, [devModeEnabled, forceBrowserHistoryUrlFallbackEnabled, forceChromiumAxCaptureEnabled, forceFrontmostFallbackCaptureEnabled]);

  useEffect(() => {
    const forceChromiumAxExtremeNudge = DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxExtremeNudgeEnabled;
    window.localStorage.setItem(FORCE_CHROMIUM_AX_EXTREME_NUDGE_STORAGE_KEY, forceChromiumAxExtremeNudge ? "1" : "0");
  }, [devModeEnabled, forceChromiumAxExtremeNudgeEnabled]);

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
    if (activeTab !== "settings" || settingsSection !== "dev") return;
    if (!shouldFocusEndOfDayReviewSettingsRef.current) return;

    shouldFocusEndOfDayReviewSettingsRef.current = false;
    const row = endOfDayReviewSettingsRowRef.current;
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "center" });
    row?.focus();
  }, [activeTab, settingsSection]);

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

    void listen("tray-check-for-updates", handleTrayCheckForUpdates).then((nextUnlisten) => {
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
  }, [handleTrayCheckForUpdates]);

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

    void listen("tray-toggle-theme", toggleTheme).then((nextUnlisten) => {
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
  }, [toggleTheme]);

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
  }, [dismissWatcherPeek, handleDriftAlarmAction, handleDriftAlarmDismissed, handleEndOfDayReviewAction, handleWatcherResponse]);

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
      clearPendingTransientDriftAlarm();
      return;
    }
    if (!status?.running) {
      publishEvaluationDriftAlarmTrayStatus({ kind: "tracker_paused" }, null);
      clearPausedDriftAlarmRuntime();
      return;
    }

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
            ? { ...localAiClassificationOptions, persistLiveResult: true }
            : { persistLiveResult: true };
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
      if (driftAlarmSnoozeRef.current !== null) {
        driftAlarmSnoozeRef.current = null;
        setDriftAlarmSnooze(null);
      }
      return;
    }

    const { alertKey, category, segment } = latestDrift;
    const candidateDetail = buildDriftAlarmTrayCandidateDetail(
      getWatcherContextLabel(segment, category),
      segment.durationSeconds,
    );
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
    const buildCurrentDriftAlarmEvent = (focusTargets: readonly DriftAlarmFocusTarget[] = availableDriftAlarmFocusTargetsForAlarm) => {
      const contextLabel = getWatcherContextLabel(segment, category);
      const sourceSiteDomain = segment.siteDomain?.trim() ?? null;
      const sourceAppName = segment.appName.trim() || "Unknown app";
      const sourceIconKey = segment.bundleId?.trim() ?? sourceAppName;
      const sourceIconSrc = appIconsRef.current[sourceIconKey] ?? appIconsRef.current[sourceAppName] ?? null;
      const sourceSegmentId = latestDrift.sourceSegmentId ?? segment.id;
      rememberDriftAlarmSourceSegment(driftAlarmSourceSegmentsRef.current, sourceSegmentId, segment);

      return buildDriftAlarmEvent({
        id: alertKey,
        contextLabel,
        driftDurationSeconds: segment.durationSeconds,
        preservedFocusStrikeSeconds: 0,
        generatedAt: new Date().toISOString(),
        focusTargets,
        sourceSiteDomain,
        sourceAppName,
        sourceIconSrc,
        copySettings: driftAlarmCopy,
        sourceSegmentId,
      });
    };
    const showCurrentDriftAlarm = () => {
      showDriftAlarm(buildCurrentDriftAlarmEvent());
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
    const showFallbackDriftAlarm = (notify: boolean) => {
      showCurrentDriftAlarm();
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
      recordDriftAlarmDebugEvent({
        kind: "extreme_nudge_started",
        alertKey,
        candidate: summarizeDriftAlarmCandidate(latestDrift),
        evaluation,
      });
      void applyNativeExtremeNudge(buildExtremeNudgeTarget(segment, {
        forceChromiumAxTabClose: DEV_SETTINGS_ENABLED && devModeEnabled && forceChromiumAxExtremeNudgeEnabled,
      })).then(async (result) => {
        recordDriftAlarmDebugEvent({
          kind: "extreme_nudge_result",
          alertKey,
          result: result.applied ? "applied" : "not_applied",
          reason: result.diagnostic,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        if (!result.applied) {
          if (lastDriftAlertSegmentRef.current === alertKey) showFallbackDriftAlarm(notifyOnFallback);
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
        console.warn("Failed to apply extreme nudge", error);
        const message = toErrorMessage(error);
        recordDriftAlarmDebugEvent({
          kind: "extreme_nudge_error",
          alertKey,
          reason: extremeNudgeErrorDiagnostic(error),
          message,
          candidate: summarizeDriftAlarmCandidate(latestDrift),
          evaluation,
        });
        if (lastDriftAlertSegmentRef.current === alertKey) showFallbackDriftAlarm(notifyOnFallback);
      });
    };

    const completeBreakRecoveryAssessment = (attempt: DriftAlarmBreakSnooze, outcome: BreakRecoveryOutcome) => {
      recordBreakRecoveryOutcome(attempt, outcome);
      if (breakRecoveryAssessmentRef.current?.attemptId !== attempt.attemptId) return;
      breakRecoveryAssessmentRef.current = null;
      setBreakRecoveryAssessment(null);
    };

    const confirmFreshDriftAlarmCandidate = async (): Promise<"confirmed" | "current-window-changed" | "current-snapshot-unavailable" | "system-transient-active"> => {
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
    };

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
          driftCandidate: latestDrift,
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
        const breakReturnIconSrc = appIconsRef.current[breakReturnIconKey] ?? appIconsRef.current[breakReturnAppName] ?? null;

        showDriftAlarm(buildBreakReturnAlarmEvent({
          id: `break-return:${alertKey}:${pendingBreakReturnAlarm.untilMs}`,
          contextLabel: breakReturnContextLabel,
          driftDurationSeconds: segment.durationSeconds,
          preservedFocusStrikeSeconds: 0,
          generatedAt: new Date().toISOString(),
          focusTargets,
          sourceSiteDomain: breakReturnSiteDomain,
          sourceAppName: breakReturnAppName,
          sourceIconSrc: breakReturnIconSrc,
          copySettings: driftAlarmCopy,
          sourceSegmentId: latestDrift.sourceSegmentId ?? segment.id,
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
          driftCandidate: latestDrift,
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
  }, [availableDriftAlarmFocusTargets, canUseCloudAiClassification, classificationRules, devModeEnabled, driftAlertDelaySeconds, driftAlertsEnabled, driftAlarmCopy, driftAlarmSnooze, extremeNudgeEnabled, forceChromiumAxExtremeNudgeEnabled, localAiClassificationOptions, publishDriftAlarmTrayStatus, recordBreakRecoveryOutcome, refreshLiveDriftAlarmActivity, returnToFocusTarget, showAiClassificationImpact, showDriftAlarm, startOfDayMinutes, status?.running]);

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

    evaluateDriftAlarm({
      snapshot: currentSnapshot,
      liveSegments: liveDriftAlarmSegmentsRef.current,
    });
  }, [currentSnapshot, driftAlertsEnabled, evaluateDriftAlarm, publishDriftAlarmTrayStatus, status?.running]);

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
    if (!WATCHER_PEEK_PROTOTYPE_ENABLED) return;
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
    effectiveSelectedDaySegments,
    effectiveDashboardSegments,
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
  }, [activeTab, dashPeriod, dashboardSegments, loadMissingAppIcons, shouldBlockLocalTrackerAccess]);
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
        observedAiClassificationFailure,
      })
      : null;
  const dashboardAiRecoveryKey = dashboardAiUnavailableState && isDashboardAiRecoveryOverlayVariant(dashboardAiUnavailableState.variant)
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
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => {
    if (!hasLoadedOnce) return;
    if (shouldBlockLocalTrackerAccess) return;
    if (selectedDay !== todayDay) return;

    const client = trackerClient as Partial<typeof trackerClient>;
    if (typeof client.updateTrayProductivityIcon !== "function") return;
    void client.updateTrayProductivityIcon(trayProductivityMix).catch(() => undefined);
  }, [hasLoadedOnce, selectedDay, shouldBlockLocalTrackerAccess, todayDay, trayProductivityMix]);
  useEffect(() => {
    const client = trackerClient as Partial<typeof trackerClient>;
    if (typeof client.updateTrayDriftAlarmStatus !== "function") return;
    void client.updateTrayDriftAlarmStatus({
      ...driftAlarmTrayStatus,
      trackerRunning: status?.running ?? null,
    }).catch(() => undefined);
  }, [driftAlarmTrayStatus, status?.running]);
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
  const classificationQualityPercent = useMemo(
    () => buildProductivityQualityPercent(classificationProductivityTotals),
    [classificationProductivityTotals],
  );
  const dashboardTrackedTimeLabel = totalSeconds > 0 ? formatCompactDurationFromSeconds(totalSeconds) : "0m";
  const dashboardTitle =
    selectedDayContext === "Today"
      ? selectedDayContext
      : selectedDayContext === "Yesterday"
        ? selectedDayContext
        : selectedDayLabel;
  const dashboardTitleDuration = dashboardTrackedTimeLabel;
  const lastCaptureDistanceLabel = status?.lastEventAt ? formatRelativeTime(status.lastEventAt) : "No captures yet";
  const uniqueAppsCount = useMemo(() => new Set(effectiveDashboardSegments.map((s) => s.bundleId ?? s.appName)).size, [effectiveDashboardSegments]);
  const averageSessionMinutes = effectiveDashboardSegments.length > 0 ? Math.round(totalSeconds / 60 / effectiveDashboardSegments.length) : 0;
  const topApp = dashboardTopApps[0];
  const topAppLabel = topApp?.appName ?? "No activity";
  const liveAppLabel = status?.running && currentSnapshot?.appName ? currentSnapshot.appName : topAppLabel;
  const liveSiteLabel = status?.running ? (currentSnapshot?.siteDomain || currentSnapshot?.siteTitle || null) : null;
  const hasTimelineData = effectiveSelectedDaySegments.length > 0;
  const isBootstrappingTracker = loading && status === null;
  const trackerModeLabel = status?.trackerMode ?? "unknown";
  const isTrackerUnavailable = !status || trackerModeLabel === "unavailable";
  const isDemoMode = trackerModeLabel === "demo" || status?.databasePath === "/tmp/drifty-demo.sqlite3";
  const isTrackerIdle = status?.running === true && trackerModeLabel === "idle";
  const trackerStateLabel = isBootstrappingTracker ? "Loading" : isTrackerUnavailable ? "Tracker unavailable" : status.running ? (isTrackerIdle ? "Idle now" : isDemoMode ? "Preview active" : "Tracking now") : (isDemoMode ? "Preview paused" : "Tracking paused");
  const liveTrackerActionLabel = isTrackerUnavailable ? "Tracker unavailable" : status.running ? "Pause tracking" : "Start tracking";
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
  const sidebarTrackerIndicatorClassName = replaySidebarTrackerCard?.indicatorClassName ?? (status?.running ? (isTrackerIdle ? "idle" : "tracking") : isTrackerUnavailable ? "unavailable" : "idle");
  const sidebarTrackerCollapsedLabel = replaySidebarTrackerCard?.collapsedLabel ?? (status?.running ? (isTrackerIdle ? "Idle now" : "Now tracking") : isTrackerUnavailable ? "Tracker unavailable" : "Tracker paused");
  const sidebarTrackerStatusLabel = replaySidebarTrackerCard?.statusLabel ?? `${trackerStateLabel} · ${formatDuration(dayTotalSeconds)}`;
  const sidebarTrackerAppLabel = replaySidebarTrackerCard?.appLabel ?? liveAppLabel;
  const sidebarTrackerSiteLabel = replaySidebarTrackerCard?.siteLabel ?? liveSiteLabel;
  const sidebarTrackerMetaLabel = replaySidebarTrackerCard?.metaLabel ?? `Last capture: ${lastCaptureDistanceLabel}`;
  const sidebarTrackerActionLabel = replaySidebarTrackerCard?.actionLabel ?? liveTrackerActionLabel;
  const isSidebarTrackerActionDisabled = replaySidebarTrackerCard === null && isTrackerUnavailable;

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
    if (selectedDay !== todayDay) return;
    if (segmentsLoadedDay !== todayDay) return;
    if (!status?.running) return;
    if (currentMinuteOfDay === null || currentMinuteOfDay < END_OF_DAY_REVIEW_TRIGGER_MINUTE) return;
    if (window.localStorage.getItem(END_OF_DAY_REVIEW_STORAGE_KEY) === todayDay) return;

    void buildEndOfDayReviewEvent({
      day: todayDay,
      generatedAt: new Date().toISOString(),
      segments,
    }).then(showEndOfDayReview).then((shown) => {
      if (shown) window.localStorage.setItem(END_OF_DAY_REVIEW_STORAGE_KEY, todayDay);
    });
  }, [buildEndOfDayReviewEvent, currentMinuteOfDay, hasLoadedOnce, segments, segmentsLoadedDay, selectedDay, showEndOfDayReview, status?.running, todayDay]);

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
  const analysisModel = useAnalysisModelSetup(isSupabaseConfigured);
  const projectClassification = useProjectClassification({
    tracker: trackerClient,
    selectedDayRange,
    insightRange: { start: insightRange.start, end: insightRange.end },
    analysisSetup: analysisModel.analysisSetup,
    resolveOpenRouterKey: analysisModel.resolveOpenRouterKey,
    analysisConnected: analysisModel.analysisConnected,
    onClassificationChanged: () => { void refreshHistoryData(); },
  });
  // Segment→project map + ordered project series for the Trends weekly Project view,
  // scoped to the whole insight window (not just the selected day).
  const insightProjectBySegmentId = useMemo(
    () => new Map(
      projectClassification.insightAssignments
        .filter((assignment) => assignment.projectId)
        .map((assignment) => [assignment.segmentId, assignment.projectId as string] as const),
    ),
    [projectClassification.insightAssignments],
  );
  const weeklyProjectChart = useMemo(() => {
    const NO_PROJECT_SERIES_COLOR = "#9ca3af";
    const totals = new Map<string, number>();
    for (const segment of activeInsightSegments) {
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
  }, [activeInsightSegments, insightProjectBySegmentId, projectClassification.projects]);
  const weeklyBreakdown = useMemo(
    () => buildWeeklyBreakdown(activeInsightSegments, insightClassificationOptions, insightWeekVisibility, insightProjectBySegmentId),
    [activeInsightSegments, insightClassificationOptions, insightWeekVisibility, insightProjectBySegmentId],
  );
  const flowProjectColorBySegment = useMemo(
    () => contextualProjectColorBySegment(effectiveSelectedDaySegments, projectClassification.assignments, projectColorMap(projectClassification.projects), effectiveSelectedDayClassificationOptions),
    [effectiveSelectedDaySegments, projectClassification.assignments, projectClassification.projects, effectiveSelectedDayClassificationOptions],
  );
  // segment.id → projectId for the selected day (assigned only), for the Projects
  // page charts + dashboard donut.
  const selectedDayProjectBySegmentId = useMemo(
    () => new Map(
      projectClassification.assignments
        .filter((assignment) => assignment.projectId)
        .map((assignment) => [assignment.segmentId, assignment.projectId as string] as const),
    ),
    [projectClassification.assignments],
  );
  // The Projects tab isn't the Trends tab, so the rolling insight segments aren't
  // loaded here. Load a dedicated last-14-days window (segments + assignments) for
  // the project trend chart, refreshing whenever a pass finishes.
  const [projectsTrend, setProjectsTrend] = useState<{ readonly segments: ActivitySegment[]; readonly assignments: ProjectAssignmentRecord[] }>({ segments: [], assignments: [] });
  useEffect(() => {
    if (activeTab !== "projects" || projectClassification.running) return;
    let cancelled = false;
    const range = getLogicalDayRange(shiftIsoDate(selectedDay, -13), selectedDay, startOfDayMinutes);
    void (async () => {
      try {
        const [segments, assignments] = await Promise.all([
          trackerClient.getTimeline(range),
          trackerClient.getProjectAssignments?.(range) ?? Promise.resolve<ProjectAssignmentRecord[]>([]),
        ]);
        if (!cancelled) setProjectsTrend({ segments, assignments: assignments ?? [] });
      } catch {
        if (!cancelled) setProjectsTrend({ segments: [], assignments: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, selectedDay, startOfDayMinutes, projectClassification.running, trackerClient]); // eslint-disable-line react-hooks/exhaustive-deps
  const projectsTrendProjectBySegmentId = useMemo(
    () => new Map(
      projectsTrend.assignments
        .filter((assignment) => assignment.projectId)
        .map((assignment) => [assignment.segmentId, assignment.projectId as string] as const),
    ),
    [projectsTrend.assignments],
  );
  // Per-project split of the selected day, for the dashboard donut's Project mode
  // (the flow chart's Project toggle swaps the productivity donut to this).
  const dashboardProjectRing = useMemo(() => {
    const assignmentBySegment = new Map(
      projectClassification.assignments.filter((assignment) => assignment.projectId).map((assignment) => [assignment.segmentId, assignment.projectId as string] as const),
    );
    const secondsByProject = new Map<string, number>();
    for (const segment of effectiveSelectedDaySegments) {
      const projectId = assignmentBySegment.get(segment.id);
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
  }, [effectiveSelectedDaySegments, projectClassification.assignments, projectClassification.projects]);
  const flowBlocks = useMemo(() => buildFlowBlocks(effectiveSelectedDaySegments, selectedDay, flowIntervalMinutes, effectiveSelectedDayClassificationOptions, startOfDayMinutes, flowProjectColorBySegment), [effectiveSelectedDayClassificationOptions, effectiveSelectedDaySegments, flowIntervalMinutes, selectedDay, startOfDayMinutes, flowProjectColorBySegment]);
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
      ? `OpenRouter (${analysisModel.analysisSetup.openRouterModel})`
      : analysisModel.analysisSetup.provider === "openai"
        ? `OpenAI (${analysisModel.analysisSetup.openaiModel})`
        : analysisModel.analysisSetup.provider === "anthropic"
          ? `Anthropic (${analysisModel.analysisSetup.anthropicModel})`
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
  }, [activeTab, classificationRange, selectedDay, effectiveClassifyCategoryId, effectiveClassifySourceId]);
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
  const weekFocusDeltaPercent = previousWeekFocusSeconds !== null && previousWeekFocusSeconds > 0 ? Math.round(((dashboardFocusSeconds - previousWeekFocusSeconds) / previousWeekFocusSeconds) * 100) : null;
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
      const deletedIds = new Set(ids);
      setHistorySearchSegments((currentSegments) => currentSegments.filter((segment) => !deletedIds.has(segment.id)));
      await refresh(selectedDayRef.current);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setHistoryDeleting(false);
    }
  }, [historyDeleting, refresh]);

  const [deleteHistoryModalOpen, setDeleteHistoryModalOpen] = useState(false);

  const handleHistoryRangeDeleted = useCallback(async () => {
    setHistorySearchSegments([]);
    try {
      setClassificationMetrics(await trackerClient.getClassificationMetrics({ day: selectedDayRef.current }));
    } catch {
      // Metrics refresh is best-effort after a bulk delete; the views below still reload.
    }
    await refresh(selectedDayRef.current);
    await syncLeaderboardPublication("history_deleted", { bypassMinInterval: true });
    await refreshLeaderboardData();
  }, [refresh, refreshLeaderboardData, syncLeaderboardPublication]);

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

    aiClassificationInFlightRef.current = true;
    try {
      const query = toClassificationQueryForDay(today, threshold);
      const summary = localAiClassificationOptions
        ? await runAiClassificationForUnknownThreshold(query, threshold, localAiClassificationOptions)
        : await runAiClassificationForUnknownThreshold(query, threshold);
      if (localAiClassificationOptions) recordLocalAiClassificationSummary(summary);
      if (selectedDayRef.current === today) {
        setObservedAiClassificationFailure(summary.status === "error");
      }
      if (summary.status === "empty" && summary.savedRecords === 0) return;
      if (selectedDayRef.current === today) {
        setClassificationSummary(summary);
        if (summary.metrics) setClassificationMetrics(summary.metrics);
        const nextUsage = await loadAiClassificationUsage(today);
        if (selectedDayRef.current === today) {
          setAiClassificationUsage(nextUsage);
          setAiClassificationUsageDay(today);
        }
        if (summary.savedRecords > 0 && selectedDayRef.current === today) await refresh(today);
      }
      captureAiClassificationRun(trigger, providerKind, "current_day", summary);
      if (summary.savedRecords > 0) {
        await syncLeaderboardPublication("classification_updated");
        await refreshLeaderboardData();
      }
    } catch (nextError) {
      const message = toErrorMessage(nextError);
      if (localAiClassificationOptions) recordLocalAiClassificationError(message);
      captureAiClassificationRun(trigger, providerKind, "current_day", {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        message,
      });
      if (selectedDayRef.current === today) {
        setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message });
        setObservedAiClassificationFailure(true);
      }
    } finally {
      aiClassificationInFlightRef.current = false;
    }
  }, [canUseCloudAiClassification, classificationActionLoading, hasLoadedOnce, localAiClassificationOptions, preparingFirstDay, recordLocalAiClassificationError, recordLocalAiClassificationSummary, refreshLeaderboardData, rendererFocused, selectedDay, shouldBlockLocalTrackerAccess, startOfDayMinutes, syncLeaderboardPublication]);

  useEffect(() => {
    void runAutoAiClassificationBatch();
    const intervalId = setInterval(() => {
      void runAutoAiClassificationBatch();
    }, AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [runAutoAiClassificationBatch]);

  useEffect(() => {
    if (authStatus === "authenticated" && (!isEffectiveAuthRequired || hasRequiredAccountAuth)) {
      setAuthModalOpen(false);
      setResumeOnboardingAfterAuthModal(false);
    }
  }, [authStatus, hasRequiredAccountAuth, isEffectiveAuthRequired]);

  const handleCloseAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    if (resumeOnboardingAfterAuthModal && !hasRequiredAccountAuth) {
      setOnboardingOpen(true);
    }
    setResumeOnboardingAfterAuthModal(false);
  }, [hasRequiredAccountAuth, resumeOnboardingAfterAuthModal]);

  const openDashboardAiSetup = useCallback(() => {
    setSettingsSection("aiSetup");
    navigateToTab("settings");
  }, [navigateToTab]);

  const handleDashboardAiUnavailableAction = useCallback((variant: DashboardAiUnavailableVariant) => {
    if (isCloudBillingVariant(variant)) {
      clearDashboardAiRecoveryDismissal(variant);
      setDismissedDashboardAiRecoveryKey((dismissedKey) => (dismissedKey === variant ? null : dismissedKey));
      return;
    }

    if (variant === "device-limit") {
      openAccountSettings();
      return;
    }

    openDashboardAiSetup();
  }, [openAccountSettings, openDashboardAiSetup]);

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
    setBrowserHistoryBootstrapEnabled(state.browserHistoryBootstrapEnabled);
    resetBrowserHistoryBootstrap();
    selectDay(logicalTodayIsoDate(startOfDayMinutes));
    navigateToTab("dashboard", "Today");
    setOnboardingOpen(false);
    if (state.browserHistoryBootstrapEnabled && !shouldBlockLocalTrackerAccess) {
      rearmFirstDayPreparation();
      setFirstDayWorkLabel(state.workType);
      setFirstDayPreparationPhase("importing");
      setPreparingFirstDay(true);
    }
  }

  async function handleOpenDeveloperOnboarding() {
    await refresh();
    setOnboardingOpen(true);
  }

  // Throws on failure (after surfacing the error) so onboarding completion can abort.
  async function handleStartTrackingFromOnboarding() {
    setError(null);
    try {
      const nextStatus: TrackerStatus | undefined = await trackerClient.start();
      await refresh();
      capturePostHogEvent("tracker_action", {
        action: "start",
        result: "success",
        tracker_mode: toTrackerModeAnalytics(nextStatus?.trackerMode ?? status?.trackerMode),
        running: nextStatus?.running ?? true,
      });
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      capturePostHogEvent("tracker_action", {
        action: "start",
        result: "error",
        error_kind: toAnalyticsErrorKind(e),
      });
      throw new Error(message);
    }
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
    return nextStatus.granted;
  }

  async function handleRequestAccessibility() {
    const nextStatus = await accessibilityClient.requestAccess();
    setAccessibilityGranted(nextStatus.granted);
    return nextStatus.granted;
  }

  async function handleStopTracking() {
    setError(null);
    try {
      const nextStatus: TrackerStatus | undefined = await trackerClient.stop();
      await refresh();
      capturePostHogEvent("tracker_action", {
        action: "stop",
        result: "success",
        tracker_mode: toTrackerModeAnalytics(nextStatus?.trackerMode ?? status?.trackerMode),
        running: nextStatus?.running ?? false,
      });
    } catch (e) {
      setError(toErrorMessage(e));
      capturePostHogEvent("tracker_action", {
        action: "stop",
        result: "error",
        error_kind: toAnalyticsErrorKind(e),
      });
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
    aiClassificationInFlightRef.current = true;
    setClassificationActionLoading(true);
    setClassificationSummary({ status: "running", selectedSegments: 0, savedRecords: 0, message: "Running AI classification..." });
    try {
      const usageBefore = await loadAiClassificationUsage(executionUsageDay);
      const summary = localAiClassificationOptions
        ? await runAiClassification(toClassificationQueryForDay(selectedDay), undefined, localAiClassificationOptions)
        : await runAiClassification(toClassificationQueryForDay(selectedDay));
      if (localAiClassificationOptions) recordLocalAiClassificationSummary(summary);
      setClassificationSummary(summary);
      setObservedAiClassificationFailure(summary.status === "error");
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
      const message = toErrorMessage(nextError);
      if (localAiClassificationOptions) recordLocalAiClassificationError(message);
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message });
      setObservedAiClassificationFailure(true);
      captureAiClassificationRun("manual", providerKind, range, {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        message,
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
    aiClassificationInFlightRef.current = true;
    setClassificationActionLoading(true);
    setClassificationSummary({ status: "running", selectedSegments: 0, savedRecords: 0, message: `Classifying all unclassified activity for ${formatDayLabel(targetDay)}...` });
    try {
      const usageBefore = await loadAiClassificationUsage(executionUsageDay);
      const summary = localAiClassificationOptions
        ? await runAiClassificationUntilEmpty(toClassificationQueryForDay(targetDay), undefined, localAiClassificationOptions)
        : await runAiClassificationUntilEmpty(toClassificationQueryForDay(targetDay));
      if (localAiClassificationOptions) recordLocalAiClassificationSummary(summary);
      setClassificationSummary({
        ...summary,
        message: `${summary.message} Target: ${formatDayLabel(targetDay)}.`,
      });
      setObservedAiClassificationFailure(summary.status === "error");
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
      const message = toErrorMessage(nextError);
      if (localAiClassificationOptions) recordLocalAiClassificationError(message);
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message });
      setObservedAiClassificationFailure(true);
      captureAiClassificationRun("manual", providerKind, range, {
        status: "error",
        selectedSegments: 0,
        savedRecords: 0,
        message,
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
      status,
      accessibilityGranted,
      currentSnapshot: snapshotForDebug,
      driftAlarm: driftAlarmTrayStatus,
      driftAlarmDebugEvents: readRecentDriftAlarmDebugEvents(),
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
          observedFailure: observedAiClassificationFailure,
        },
        usage: {
          day: aiClassificationUsageDay,
          summary: aiClassificationUsage,
        },
      },
      error,
    });
    setDebugLogPreview({ text: JSON.stringify(payload, null, 2), exportedAt: payload.exportedAt });
  }, [accessibilityGranted, aiClassificationUsage, aiClassificationUsageDay, aiConnectionStatus, appThemeColorOverrides, billingEntitlement, billingEntitlementError, billingEntitlementLoading, canUseCloudAiClassification, categoryColorOverrides, classificationActionLoading, classificationSummary, devModeEnabled, driftAlarmTrayStatus, error, forceBrowserHistoryUrlFallbackEnabled, forceChromiumAxCaptureEnabled, forceChromiumAxExtremeNudgeEnabled, forceFrontmostFallbackCaptureEnabled, hasRequiredAccountAuth, historySegments, isSupabaseConfigured, leaderboardSegments, localAiClassificationOptions, localAiConnectionProviderLabel, localAiProviderStatus, observedAiClassificationFailure, segments, selectedDay, startOfDayMinutes, startOfWeek, status, theme]);
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

  if (isEffectiveAuthRequired && hasEffectiveBlockingAuthConfigurationError) {
    return <AuthConfigurationGate />;
  }

  if (isEffectiveAuthRequired && !hasRequiredAccountAuth && !onboardingOpen) {
    return (
      <>
        <AuthRequiredGate onSignIn={() => setAuthModalOpen(true)} />
        {authModalOpen ? <AuthModal onClose={handleCloseAuthModal} /> : null}
      </>
    );
  }

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
      activeHourCount={activeHourCount}
      appIcons={appIcons}
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

  const effectiveBillingEntitlement = activeDashboardAiUnavailablePreviewInput?.billingEntitlement ?? billingEntitlement;
  const effectiveBillingEntitlementError = activeDashboardAiUnavailablePreviewInput?.billingEntitlementError ?? billingEntitlementError;
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
  const shouldShowCloudCheckoutPlans = effectiveBillingEntitlement?.status === "locked" && !isDeviceLimitLocked;
  const currentBillingPlan =
    effectiveBillingEntitlement?.status === "active" || effectiveBillingEntitlement?.status === "trialing" || isDeviceLimitLocked
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
      onStartTracking={handleStartTrackingFromOnboarding}
      onEarlyTrackingStart={() => {
        // Opportunistic: capture the rest of onboarding in the first day. Failures
        // stay silent — the completion-time start still surfaces real errors.
        void (async () => {
          try {
            await trackerClient.start();
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
      onStartCloudTrialWithGoogle={() => void signInWithGoogle()}
      onStartCloudTrialWithEmail={() => void signInWithWebsite()}
      onAcknowledgeCloudTrialStartedNotice={dismissCloudTrialStartedNotice}
      onComplete={handleOnboardingComplete}
    />
  ) : null;
  const shellClassName = [
    "app-shell",
    isSettingsTab ? "app-shell--settings" : null,
    isSidebarVisuallyCollapsed ? "app-shell--sidebar-collapsed" : null,
  ].filter(Boolean).join(" ");

  if (onboardingOpen) {
    return (
      <>
        {onboardingModal}
        {authModalOpen ? <AuthModal onClose={handleCloseAuthModal} /> : null}
      </>
    );
  }

  if (preparingFirstDay) {
    return (
      <FirstDayPreparationScreen
        phase={firstDayPreparationPhase}
        progress={firstDayPreparationProgress}
        workActivityLabel={firstDayWorkLabel}
      />
    );
  }

  return (
    <div className={shellClassName}>
      <div className="window-chrome">
        <div className="window-nav-controls" aria-label="Window navigation">
          {!isSettingsTab ? (
            <button
              type="button"
              className="window-sidebar-toggle"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={isSidebarVisuallyCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={isSidebarVisuallyCollapsed}
            >
              <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="12" height="12" rx="2.5" />
                <path d="M7 3v12" />
              </svg>
            </button>
          ) : null}
          <button type="button" className="window-nav-button" onClick={navigateBack} disabled={!canNavigateBack} aria-label="Go back">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.8 3.8 5.6 8l4.2 4.2" /></svg>
          </button>
          <button type="button" className="window-nav-button" onClick={navigateForward} disabled={!canNavigateForward} aria-label="Go forward">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.2 3.8 10.4 8l-4.2 4.2" /></svg>
          </button>
        </div>
        <div className="window-drag-region" data-tauri-drag-region />
        <div className="window-chrome-actions">
          <WindowThemeToggle theme={theme} onToggle={toggleTheme} />
          <AiConnectionStatusBar status={aiConnectionStatus} onOpenSettings={openAiSetupSettings} />
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

        <div className="nav-label">Dashboard</div>
        <nav className="sidebar-nav sidebar-nav--periods" aria-label="Dashboard views">
          {dashboardPeriodOptions.map((item) => (
            <button
              key={item.period}
              type="button"
              className={activeTab === "dashboard" && dashPeriod === item.period ? "nav-item nav-item--period active" : "nav-item nav-item--period"}
              onClick={() => navigateToTab("dashboard", item.period)}
            >
              <NavIcon type={item.period === "Week" ? "calendar" : "home"} />
              <span>{item.label}</span>
              {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{item.label}</span> : null}
            </button>
          ))}
        </nav>

        <div className="nav-label">Activity</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {activityNav.filter((item) => projectClassificationFeatureEnabled || item.id !== "projects").map((item) => (
            <button key={item.id} type="button" className={activeTab === item.id ? "nav-item active" : "nav-item"} onClick={() => navigateToTab(item.id)}>
              <NavIcon type={item.icon} /><span>{item.label}</span>
              {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">{item.label}</span> : null}
            </button>
          ))}
        </nav>

        {canOpenTeamsBeta ? (
          <>
            <div className="nav-label">Team</div>
            <nav className="sidebar-nav" aria-label="Team navigation">
              <button type="button" className={activeTab === "team" ? "nav-item active" : "nav-item"} onClick={() => navigateToTab("team")}>
                <NavIcon type="team" /><span>Team</span>
                {isSidebarVisuallyCollapsed ? <span className="nav-item__hover-label" aria-hidden="true">Team</span> : null}
              </button>
            </nav>
          </>
        ) : null}

        <div className="sidebar-foot">
          <div className="tracker-control" data-state={sidebarTrackerControlState}>
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
                    {sidebarTrackerSiteLabel ? <span className="live-pill__summary-site">{sidebarTrackerSiteLabel}</span> : null}
                  </span>
                  <span className="live-pill__summary-meta">
                    <span className="live-pill__summary-meta-line">{sidebarTrackerMetaLabel}</span>
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
                void (status?.running ? handleStopTracking() : handleStartTracking());
              }}
              disabled={isSidebarTrackerActionDisabled}
              aria-label={sidebarTrackerActionLabel}
              title={sidebarTrackerActionLabel}
            >
              <span>{sidebarTrackerActionLabel}</span>
            </button>
          </div>
          <AccountMenu
            isOpen={accountMenuOpen}
            isSidebarCollapsed={isSidebarVisuallyCollapsed}
            userAvatarUrl={profile?.avatar_url || profileDraft.avatarUrl || authMetadataAvatarUrl}
            userEmail={user?.email ?? null}
            isDarkMode={theme === "dark"}
            onToggle={() => setAccountMenuOpen((open) => !open)}
            onProfile={() => {
              openProfileEditor();
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
            onCheckForUpdates={() => {
              handleTrayCheckForUpdates();
            }}
            onFeedback={() => {
              setFeedbackModalOpen(true);
              setAccountMenuOpen(false);
            }}
            onSignIn={() => {
              setAuthModalOpen(true);
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

        {/* Dashboard */}
        {activeTab === "dashboard" ? (
          <DashboardPage
            appIcons={appIcons}
            billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
            classificationActionLoading={classificationActionLoading}
            currentMinuteOfDay={effectiveCurrentMinuteOfDay}
            dashboardAiRecoveryState={dashboardAiRecoveryState}
            dashboardAiUnavailableState={dashboardAiUnavailableState}
            dashboardAppUsage={dashboardAppUsage}
            browserHistoryBootstrapNotice={browserHistoryBootstrapNotice}
            dashboardCategoryTotals={dashboardCategoryTotals}
            dashboardDateNavigator={dashboardDateNavigator}
            dashboardEffectiveProductivityTotals={dashboardEffectiveProductivityTotals}
            dashboardProductivityTotals={dashboardProductivityTotals}
            dashboardReplay={dashboardReplay}
            dashboardRange={effectiveDashboardRange}
            dashboardTitle={dashboardTitle}
            dashboardTitleDuration={dashboardTitleDuration}
            dashPeriod={dashPeriod}
            flowBlocks={flowBlocks}
            flowIntervalMinutes={flowIntervalMinutes}
            projectModeAvailable={projectClassification.projectModeAvailable}
            projectLegend={projectClassification.projectLegend}
            flowProjectRingEntries={dashboardProjectRing.entries}
            flowProjectCenterPercent={dashboardProjectRing.centerPercent}
            focusDriftSection={focusDriftSection}
            hasTimelineData={hasTimelineData}
            historyClassificationOptions={historyClassificationOptions}
            historySegments={historySegments}
            initialDataLoading={loading && !hasLoadedOnce}
            isPreviewSurface={isPreviewSurface}
            selectedDay={selectedDay}
            selectedDayLabel={selectedDayLabel}
            startOfDayMinutes={startOfDayMinutes}
            statusRunning={status?.running === true}
            totalSeconds={totalSeconds}
            weekCalendarEvents={weekCalendarEvents}
            weekFocusDeltaPercent={weekFocusDeltaPercent}
            weekRefreshStatus={weekRefreshStatus}
            weekRows={weekRows}
            weekCurrentCalendarDay={isDashboardDemoReplayActive && dashPeriod === "Week" ? effectiveTodayDayForWeekModel : null}
            weekCurrentMinuteOfDay={isDashboardDemoReplayActive && dashPeriod === "Week" ? effectiveCurrentMinuteOfDay : null}
            weekDashboardAxisScalePercent={effectiveWeekDashboardAxisScalePercent}
            onDashboardAiUnavailableAction={handleDashboardAiUnavailableAction}
            onDismissDashboardAiRecovery={handleDismissDashboardAiRecovery}
            onFlowIntervalChange={setFlowIntervalMinutes}
            onOpenDashboardAiSetup={openDashboardAiSetup}
            onRetrySelectedDayAiClassification={() => void handleRunSelectedDayAiClassification()}
            onSelectBillingPlan={(billingInterval) => void handleStartDriftyCloudSetup(billingInterval)}
            onSelectDay={selectDay}
          />
        ) : null}

        {/* Classification */}
        {activeTab === "classification" ? (
          <ClassificationPage
            appIcons={appIcons}
            canShiftClassificationForward={canShiftClassificationForward}
            classificationActivityPeakSeconds={classificationActivityPeakSeconds}
            classificationActivityRows={classificationActivityRows}
            classificationCategoryBreakdowns={classificationCategoryBreakdowns}
            classificationDateLabel={classificationDateLabel}
            classificationOptions={classificationOptions}
            classificationPanelStyle={classificationPanelStyle}
            classificationQualityPercent={classificationQualityPercent}
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
            onCancelClassificationCorrection={() => setClassificationCorrectionDraft(null)}
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
              <HistoryView
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
          <ProjectsPage
            projects={projectClassification.projects}
            assignments={projectClassification.assignments}
            selectedDay={selectedDay}
            startOfDayMinutes={startOfDayMinutes}
            daySegments={effectiveSelectedDaySegments}
            dayProjectBySegmentId={selectedDayProjectBySegmentId}
            trendSegments={projectsTrend.segments}
            trendProjectBySegmentId={projectsTrendProjectBySegmentId}
            projectsLoading={projectClassification.projectsLoading}
            running={projectClassification.running}
            progress={projectClassification.progress}
            runError={projectClassification.runError}
            analysisConnected={analysisModel.analysisConnected}
            analysisSetup={analysisModel.analysisSetup}
            consentOpen={projectPassConsentOpen}
            consentProviderLabel={analysisProviderLabel}
            onConfigureModel={() => { navigateToTab("settings"); setSettingsSection("aiSetup"); }}
            onSaveProject={(input) => void projectClassification.saveProject(input)}
            onDeleteProject={(id) => void projectClassification.deleteProject(id)}
            onAddAnchor={(projectId, kind, value) => void projectClassification.addAnchor(projectId, kind, value)}
            onDeleteAnchor={(projectId, kind, value) => void projectClassification.deleteAnchor(projectId, kind, value)}
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
            projectModeAvailable={weeklyProjectChart.available}
            onNextInsightRange={() => {
              if (canShiftInsightForward) selectDay((p) => shiftInsightPeriodDay(p, trendsRange, 1));
            }}
            onPreviousInsightRange={() => selectDay((p) => shiftInsightPeriodDay(p, trendsRange, -1))}
            onTodayInsightRange={() => selectDay(todayDay)}
            onTrendsRangeChange={setTrendsRange}
          />
        ) : null}

        {/* Leaderboard */}
        {activeTab === "leaderboard" ? (
          <LeaderboardPage
            actionError={leaderboardActionError}
            activePeriod={activeLeaderboardPeriod}
            email={user?.email ?? null}
            error={leaderboardError}
            focusSeconds7d={localRollingFocusSeconds}
            isActionLoading={leaderboardActionLoading}
            isLoading={leaderboardLoading}
            isOptedIn={isLeaderboardOptedIn}
            isSignedIn={isPolicySignedIn}
            isSupabaseEnabled={isSupabaseConfigured || leaderboardUsesPreviewProfile}
            leaderboard={leaderboardRows}
            ownRank={leaderboardUsesPreviewProfile ? 6 : ownLeaderboardEntry?.rank ?? null}
            profileAvatarUrl={profile?.avatar_url ?? profileDraft.avatarUrl}
            profileBio={leaderboardProfileBio}
            profileDisplayName={leaderboardProfileDisplayName}
            profileError={profileError}
            profileGithubUrl={leaderboardProfileGithubUrl}
            profileLinkedinUrl={leaderboardProfileLinkedinUrl}
            profileMessage={profileMessage}
            profileShareMessage={profileShareMessage}
            statusMessage={leaderboardStatusMessage}
            statusTone={leaderboardStatusTone}
            profileWebsiteUrl={leaderboardProfileWebsiteUrl}
            totalFocusSeconds7d={totalLeaderboardFocusSeconds}
            windowEndDay={leaderboardWindowEndDay}
            windowStartDay={leaderboardWindowStartDay}
            onEditProfile={openProfileEditor}
            onOptIn={() => void handleLeaderboardOptIn()}
            onOptOut={() => void handleLeaderboardOptOut()}
            onPeriodChange={setActiveLeaderboardPeriod}
            onSelectProfile={(row) => void handleSelectLeaderboardProfile(row)}
            onShareProfile={() => void handleShareLeaderboardProfile()}
            onEmbedProfile={openEmbed}
            onSignIn={() => void handleLeaderboardOptIn()}
            onViewOwnProfile={() => void handleViewOwnLeaderboardProfile()}
          />
        ) : null}

        {activeTab === "team" && canOpenTeamsBeta ? (
          <TeamsBetaSurface
            hasRequiredAccountAuth={hasRequiredAccountAuth}
            isEffectiveAuthRequired={isEffectiveAuthRequired}
            isPolicySignedIn={isPolicySignedIn}
            isSupabaseConfigured={isSupabaseConfigured}
            showAiClassificationImpact={showAiClassificationImpact}
            startOfDayMinutes={startOfDayMinutes}
            user={user}
            onAuthRequired={requestTeamAuth}
          />
        ) : null}

        {/* Settings */}
        {activeTab === "settings" ? (
          <div className="page">
            <h1 className="sr-only">Settings</h1>
            <div className="settings-panel-stack">
                {settingsSection === "account" && (
                  <AccountSettingsSection
                    billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
                    billingEntitlementError={effectiveBillingEntitlementError}
                    billingEntitlementLockedReason={effectiveBillingEntitlement?.lockedReason ?? null}
                    billingEntitlementStatus={effectiveBillingEntitlement?.status ?? null}
                    billingPlansDisabled={isDashboardAiUnavailablePreviewActive}
                    billingPortalLoading={billingPortalLoading}
                    cloudDeviceAccess={effectiveBillingEntitlement?.deviceAccess ?? null}
                    cloudDeviceActionError={cloudDeviceActionError}
                    cloudDeviceRevokingId={cloudDeviceRevokingId}
                    cloudDevices={effectiveBillingEntitlement?.cloudDevices ?? cloudDevices}
                    cloudStatusRefreshing={effectiveBillingEntitlementLoading}
                    currentBillingPlan={currentBillingPlan}
                    isSupabaseConfigured={effectiveIsSupabaseConfigured}
                    shouldShowCloudCheckoutPlans={shouldShowCloudCheckoutPlans}
                    userEmail={user?.email ?? null}
                    onManageCloudBilling={handleManageCloudBilling}
                    onRefreshCloudStatus={refreshBillingEntitlement}
                    onRevokeCloudDevice={handleRevokeCloudDevice}
                    onSignIn={() => setAuthModalOpen(true)}
                    onStartCloudSetup={handleStartDriftyCloudSetup}
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
                    onRequestAccessibility={() => void handleRequestAccessibility()}
                    onStartOfDayChange={handleStartOfDayChange}
                    onStartOfWeekChange={handleStartOfWeekChange}
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
                    aiServerStatusLabel={aiServerStatusLabel}
                    billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
                    billingEntitlementError={effectiveBillingEntitlementError}
                    billingEntitlementLockedReason={effectiveBillingEntitlement?.lockedReason ?? null}
                    billingEntitlementStatus={effectiveBillingEntitlement?.status ?? null}
                    billingPlansDisabled={isDashboardAiUnavailablePreviewActive}
                    billingPortalLoading={billingPortalLoading}
                    cloudStatusRefreshing={effectiveBillingEntitlementLoading}
                    cloudStatusLabel={cloudStatusLabel}
                    cloudTrialEndsAt={effectiveBillingEntitlement?.trialEndsAt ?? null}
                    connectionStatus={aiConnectionStatus}
                    connectionTest={aiConnectionTest}
                    currentBillingPlan={currentBillingPlan}
                    isSupabaseConfigured={effectiveIsSupabaseConfigured}
                    localAiSetup={localAiSetup}
                    shouldShowCloudCheckoutPlans={shouldShowCloudCheckoutPlans}
                    userEmail={user?.email ?? null}
                    workProfileUserId={user?.id ?? "local"}
                    analysisSetup={analysisModel.analysisSetup}
                    analysisOpenRouterConnected={analysisModel.openRouterConnected}
                    showIntelligenceTab={projectClassificationFeatureEnabled}
                    onAnalysisChange={analysisModel.setAnalysisSetup}
                    onDialogOpenChange={setAiSetupDialogOpen}
                    onLocalAiSetupChange={setLocalAiSetup}
                    onManageCloudBilling={handleManageCloudBilling}
                    onRefreshCloudStatus={refreshBillingEntitlement}
                    onStartCloudSetup={handleStartDriftyCloudSetup}
                  />
                )}
                {settingsSection === "notifications" && (
                  <NotificationsSettingsSection
                    driftAlertDelaySeconds={driftAlertDelaySeconds}
                    driftAlertsEnabled={driftAlertsEnabled}
                    driftAlarmCopy={driftAlarmCopy}
                    extremeNudgeEnabled={extremeNudgeEnabled}
                    onDriftAlertDelaySecondsChange={setDriftAlertDelaySeconds}
                    onDriftAlarmCopyChange={setDriftAlarmCopy}
                    onDriftAlertsChange={setDriftAlertsEnabled}
                    onExtremeNudgeChange={setExtremeNudgeEnabled}
                  />
                )}
                {settingsSection === "privacy" && (
                  <PrivacySettingsSection onHistoryDeleted={handleHistoryRangeDeleted} />
                )}
                {settingsSection === "data" && (
                  <DataExportSettingsSection databasePath={status?.databasePath} todaySessionCount={segments.length} />
                )}
                {settingsSection === "dev" && DEV_SETTINGS_ENABLED && devModeEnabled && (
                  <DevSettingsSection
                    dashboardAiUnavailablePreview={dashboardAiUnavailablePreview}
                    dashboardAiUnavailablePreviewCase={dashboardAiUnavailablePreviewCase}
                    demoDashboardReplaySettings={demoDashboardReplaySettings}
                    projectPassRuns={projectClassification.passRuns}
                    endOfDayReviewSettingsRowRef={endOfDayReviewSettingsRowRef}
                    forceBrowserHistoryUrlFallbackEnabled={forceBrowserHistoryUrlFallbackEnabled}
                    forceChromiumAxCaptureEnabled={forceChromiumAxCaptureEnabled}
                    forceChromiumAxExtremeNudgeEnabled={forceChromiumAxExtremeNudgeEnabled}
                    forceFrontmostFallbackCaptureEnabled={forceFrontmostFallbackCaptureEnabled}
                    projectClassificationEnabled={devProjectClassificationEnabled}
                    projectClassificationAiReviewEvents={projectClassification.aiReviewEvents}
                    projectClassificationCorrectionsBusy={projectClassification.running}
                    weekDashboardAxisScalePercent={weekDashboardAxisScalePercent}
                    watcherMode={watcherMode}
                    watcherPeekEnabled={watcherPeekEnabled}
                    watcherPeriodicMaxMinutes={watcherPeriodicMaxMinutes}
                    watcherPeriodicMinMinutes={watcherPeriodicMinMinutes}
                    onClearDashboardAiUnavailablePreview={clearDashboardAiUnavailablePreview}
                    onDashboardAiUnavailablePreviewCaseChange={setDashboardAiUnavailablePreviewCase}
                    onDemoDashboardReplayDurationSecondsChange={handleDemoDashboardReplayDurationSecondsChange}
                    onDemoDashboardReplayPreRollSecondsChange={handleDemoDashboardReplayPreRollSecondsChange}
                    onEndOfDayReviewPreview={handleEndOfDayReviewPreview}
                    onForceBrowserHistoryUrlFallbackChange={setForceBrowserHistoryUrlFallbackEnabled}
                    onForceChromiumAxCaptureChange={setForceChromiumAxCaptureEnabled}
                    onForceChromiumAxExtremeNudgeChange={setForceChromiumAxExtremeNudgeEnabled}
                    onForceFrontmostFallbackCaptureChange={setForceFrontmostFallbackCaptureEnabled}
                    onProjectClassificationEnabledChange={setDevProjectClassificationEnabled}
                    onRevertProjectClassificationCorrection={(id) => void projectClassification.revertReviewEvent(id)}
                    onOpenDebugLogs={() => void handleOpenDebugLogs()}
                    onOpenOnboardingV22Preview={() => setOnboardingV22PreviewOpen(true)}
                    onOpenReplayOnboarding={() => void handleOpenDeveloperOnboarding()}
                    teamsBetaEnabled={teamsBetaEnabled}
                    onTeamsBetaChange={setTeamsBetaEnabled}
                    onPreviewDashboardAiUnavailableCase={previewDashboardAiUnavailableCase}
                    onPreviewDriftAlarm={previewDriftAlarm}
                    onReplayDashboardDemo={handleStartDashboardDemoReplay}
                    onResetDemoDashboardReplaySettings={handleResetDemoDashboardReplaySettings}
                    onResetWeekDashboardAxisScalePercent={handleResetWeekDashboardAxisScalePercent}
                    onShowWatcherPeek={showWatcherPeek}
                    onWeekDashboardAxisScalePercentChange={handleWeekDashboardAxisScalePercentChange}
                    onWatcherModeChange={setWatcherMode}
                    onWatcherPeekEnabledChange={setWatcherPeekEnabled}
                    onWatcherPeriodicMaxChange={handleWatcherPeriodicMaxChange}
                    onWatcherPeriodicMinChange={handleWatcherPeriodicMinChange}
                  />
                )}
            </div>
          </div>
        ) : null}
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
            <div className="drift-alarm-browser-surface" aria-label="Drifty drift alarm browser overlay">
              <div className="drift-alarm-browser-backdrop" aria-hidden="true" />
              <div className="drift-alarm-browser-overlay">
                <DriftAlarm event={driftAlarmEvent} onAction={handleDriftAlarmAction} onCancel={cancelDriftAlarm} />
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Command Bar */}
      {cmdOpen && (
        <div className="cmd-overlay" onClick={() => setCmdOpen(false)}>
          <div className="cmd-box" onClick={(e) => e.stopPropagation()}>
            <div className="cmd-input-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input placeholder="Type a command or search&hellip;" autoFocus />
              <span className="esc-key">esc</span>
            </div>
            <div className="cmd-section-label">Navigate</div>
            {commandBarTabs.filter((item) => projectClassificationFeatureEnabled || item.id !== "projects").map((item) => (
              <button key={item.id} className="cmd-item" onClick={() => handleCmdNav(item.id)}>
                <span className="cmd-label">{item.label}</span>
                <span className="cmd-sub">{item.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {authModalOpen ? <AuthModal onClose={handleCloseAuthModal} /> : null}

      {feedbackModalOpen ? <FeedbackModal initialEmail={user?.email ?? ""} onClose={() => setFeedbackModalOpen(false)} /> : null}
      {deleteHistoryModalOpen ? <DeleteHistoryModal onClose={() => setDeleteHistoryModalOpen(false)} onDeleted={handleHistoryRangeDeleted} /> : null}

      {debugLogPreview ? (
        <DebugLogModal
          text={debugLogPreview.text}
          onClose={() => setDebugLogPreview(null)}
          onCopy={() => void handleCopyDebugLogs()}
          onDownload={handleDownloadDebugLogs}
        />
      ) : null}

      <OnboardingV22Preview open={onboardingV22PreviewOpen} onClose={() => setOnboardingV22PreviewOpen(false)} />

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
        isEmbedOpen={isEmbedOpen}
        embedPublicId={profile?.public_id ?? null}
        embedFocusSeconds={embedFocusSeconds}
        onCloseEditor={closeProfileEditor}
        onCloseSelectedProfile={closeSelectedProfile}
        onCloseEmbed={closeEmbed}
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

      {latestBuildPromptUpdate?.version ? (
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
      ) : null}

    </div>
  );
}
