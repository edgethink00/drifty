import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, FocusEvent, MouseEvent, ReactNode, RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { ActivityCategory, ActivitySegment, AppIconMap, AppIdentity, ClassificationMetrics, ClassificationOptions, ClassificationRule, ClassificationRuleApplyResult, ClassificationRuleCandidate, ClassificationRuleInput, ClassificationRuleTargetKind, ClassificationSource, CurrentActivitySnapshot, DayRibbonSegment, DriftAlarmTrayStatus, FlowBlock, FlowIntervalMinutes, HourBucket, ProductivityLabel, ProductivityShareMix, SiteDuration, TrackerStatus } from "@drifty/domain";
import {
  buildAppUsageSummaries,
  buildFlowBlocks,
  buildRollingFocusSeconds,
  categorizeActivity,
  CATEGORY_ORDER,
  buildCategoryDurations,
  buildProductivityDurations,
  PRODUCTIVITY_ORDER,
  computePreservedFocusStrikeSeconds,
  classifyActivity,
  classifyActivityDetailed,
  isYouTubeBrowsePage,
  buildDailyTotals,
  buildDayRibbonSegments,
  buildHourlySummary,
  buildProductivityPersona,
  logicalDayEndExclusiveMs,
  logicalDayIsoDateForDate,
  logicalDayStartMs,
  logicalMinuteOfDay,
  type CategoryDuration,
  type ProductivityDuration,
  formatTimelineItems,
  secondsToLabel,
  shiftIsoDate,
  todayIsoDate,
  totalDurationSeconds,
} from "@drifty/domain";
import logoUrl from "./assets/drifty-icon.png";
import { AppGlyph } from "./components/AppGlyph";
import { SiteFavicon } from "./components/SiteFavicon";
import { AppUsagePanel } from "./features/dashboard/AppUsagePanel";
import {
  DashboardAiUnavailableNotice,
  resolveDashboardAiUnavailableState,
  type DashboardAiUnavailableVariant,
} from "./features/dashboard/DashboardAiUnavailableNotice";
import {
  DashboardAiRecoveryOverlay,
  isDashboardAiRecoveryOverlayVariant,
} from "./features/dashboard/DashboardAiRecoveryOverlay";
import {
  buildDashboardAiUnavailablePreviewInput,
  DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS,
  type DashboardAiUnavailablePreviewCase,
  type DashboardAiUnavailablePreviewState,
} from "./features/dashboard/dashboardAiUnavailablePreview";
import { FlowChartView } from "./features/flow-chart/FlowChartView";
import { LeaderboardView } from "./features/leaderboard/LeaderboardView";
import { HistoryView } from "./features/history/HistoryView";
import { AiConnectionStatusBar, resolveAiConnectionStatus } from "./features/ai-connection/AiConnectionStatusBar";
import { AI_CLASSIFICATION_BACKGROUND_THRESHOLD, AI_CLASSIFICATION_FOCUSED_IDLE_MS, AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD, diffAiClassificationUsageSummary, getAiClassificationUsageSummary, projectAiClassificationCost, runAiClassification, runAiClassificationForUnknownThreshold, runAiClassificationUntilEmpty, toClassificationQueryForDay, type AiClassificationSummary, type AiClassificationUsageSummary } from "./features/classification/aiClassificationService";
import {
  DEFAULT_LEADERBOARD_PERIOD,
  LEADERBOARD_PERIODS,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  optOutLeaderboard,
  publishOwnFocusTotal,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type OwnLeaderboardEntry,
} from "./features/leaderboard/leaderboardService";
import { trackerClient } from "./lib/api/trackerClient";
import { accessibilityClient } from "./lib/api/accessibilityClient";
import { shouldUsePreviewData } from "./lib/api/previewData";
import { AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED, DEV_SETTINGS_ENABLED, DRIFT_ALARM_PANEL_PREVIEWS_ENABLED, END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED, END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED, isDevOnboardingBypassEnabled, WATCHER_PEEK_PROTOTYPE_ENABLED } from "./appFeatureSwitches";
import { useAuth } from "./features/auth/AuthContext";
import { AuthModal } from "./features/auth/AuthModal";
import { FeedbackModal } from "./features/feedback/FeedbackModal";
import { DebugLogModal } from "./features/settings/DebugLogModal";
import { SettingsBuildInfoRow } from "./features/settings/SettingsBuildInfoRow";
import { CategoryColorControls, ClassificationPicker, ThemeColorControls, type AppThemeColorKey, type ColorOption } from "./features/settings/SettingsColorControls";
import { SettingsSelect } from "./features/settings/SettingsSelect";
import { SettingsSidebar, type SettingsSection } from "./features/settings/SettingsSidebar";
import { buildDebugLogPayload } from "./features/settings/debugLog";
import { DriftAlarmCopySettings } from "./features/companion/DriftAlarmCopySettings";
import {
  OnboardingModal,
  hasCompletedUserOnboarding,
  type UserOnboardingState,
} from "./features/onboarding/OnboardingModal";
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
import type { ExtremeNudgeToastEvent } from "./features/companion/ExtremeNudgeToast";
import {
  applyNativeExtremeNudge,
  hideNativeDriftAlarm,
  listenToNativeDriftAlarmAction,
  listenToNativeDriftAlarmDismissed,
  showNativeDriftAlarm,
  type ExtremeNudgeTarget,
} from "./features/companion/driftAlarmBridge";
import { evaluateYouTubeDriftAlarmGate } from "./features/companion/youtubeDriftAlarmGate";
import {
  buildDriftAlarmManualCorrectionRecord,
  buildDriftAlarmManualCorrectionRuleInput,
} from "./features/companion/driftAlarmManualCorrection";
import {
  fallbackDisplayName,
  fetchOwnProfile,
  fetchPublicProfile,
  saveOwnProfile,
  type PublicProfile,
  type UserProfile,
} from "./features/profile/profileService";
import {
  type BillingInterval,
  createIndividualCheckout,
  fetchBillingEntitlement,
  type BillingEntitlement,
} from "./features/billing/billingService";
import { AiSetupPanel } from "./features/settings/AiSetupPanel";
import { getAccountDisplayName, getAuthMetadataAvatarUrl } from "./features/auth/accountDisplay";
import { buildClassificationActivityRows, buildClassificationCategoryBreakdowns, buildClassificationSourceSummaries, captureRowSurfaceDetails, classificationActivityDetailsId, classificationActivityLabel, classificationRowSummary, classificationRuleAppIconSrc, classificationRuleCandidateAppIconSrc, classificationRuleTargetLabel, classificationSourceLabel, classifySegmentSourceKey, classifySourceKey, formatCategoryPercentage, formatClassificationCandidateUsageLabel, formatClassificationRuleApplyResult, formatClassificationSourceProductivityMix, hasDuplicateClassificationRule, normalizeDomainRuleInput, productivityMixAriaLabel, usageItemLabel } from "./features/classification/classificationViewData";
import type { CategoryBreakdownUsageItem, ClassificationCategoryBreakdown, TimelineItem } from "./features/classification/classificationViewData";
import { DRIFT_ALARM_PREVIEW_OPTIONS, DRIFT_ALERTS_STORAGE_KEY, DRIFT_ALERT_DELAY_OPTIONS, DRIFT_ALERT_DELAY_STORAGE_KEY, EXTREME_NUDGE_STORAGE_KEY, buildDriftAlarmCandidates, buildExtremeNudgeTarget, buildExtremeNudgeToastEvent, activateFocusTargetSite, buildRecentFocusTargets, hasDriftAlarmFocusTargetIconUpgrade, resolveInitialDriftAlertDelaySeconds, resolveInitialDriftAlertsEnabled, resolveInitialExtremeNudgeEnabled } from "./features/companion/driftAlarmData";
import type { DriftAlarmCandidate } from "./features/companion/driftAlarmData";
import type { DriftAlertDelaySeconds } from "./features/companion/driftAlarmData";
import { buildDriftAlarmTrayCandidateDetail, buildDriftAlarmTrayStatus, type DriftAlarmTrayResult } from "./features/companion/driftAlarmTrayStatus";
import { resolveFreshDriftAlarmCandidate } from "./features/companion/driftAlarmFreshCandidate";
import {
  resolveDriftAlarmTransientDefer,
  sourceKeyForDriftAlarmCandidate,
  type DriftAlarmTransientPending,
} from "./features/companion/driftAlarmTransientDefer";
import { persistDriftAlarmCopy, resolveInitialDriftAlarmCopy } from "./features/companion/driftAlarmCopyStorage";
import { buildBreakRecoveryAttempt, buildBreakRecoveryInsight, buildBreakSnooze, readDriftAlarmInteractions, recordDriftAlarmInteraction, resolveBreakRecoveryOutcome } from "./features/companion/driftAlarmRecovery";
import type { BreakRecoveryOutcome, DriftAlarmBreakSnooze, DriftAlarmInteraction } from "./features/companion/driftAlarmRecovery";
import { END_OF_DAY_REVIEW_STORAGE_KEY, END_OF_DAY_REVIEW_TRIGGER_MINUTE, buildMockEndOfDayReviewSegments, collectMissingEndOfDayReviewIconRequests, mergeResolvedAppIcons } from "./features/companion/endOfDayReviewData";
import type { EndOfDayReviewSummaryInput } from "./features/companion/endOfDayReviewData";
import { DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES, WATCHER_INITIAL_PEEK_DELAY_MS, WATCHER_MODE_STORAGE_KEY, WATCHER_PEEK_SETTINGS_VISIBLE, WATCHER_PEEK_STORAGE_KEY, WATCHER_PERIODIC_MAX_LIMIT_MINUTES, WATCHER_PERIODIC_MAX_STORAGE_KEY, WATCHER_PERIODIC_MIN_LIMIT_MINUTES, WATCHER_PERIODIC_MIN_STORAGE_KEY, WATCHER_STALE_EVENT_RECOVERY_MS, buildWatcherSnapshot, getDefaultWatcherSnapshot, getWatcherContextLabel, getWatcherScheduleDelayMs, normalizeWatcherPeriodicMinutes, persistWatcherResponse, resolveWatcherSnapshot, sendDriftNotification, showDueDriftWatcherPeek, resolveInitialWatcherMode, resolveInitialWatcherPeekEnabled, resolveInitialWatcherPeriodicMinutes } from "./features/companion/watcherData";
import type { DriftReminderState, WatcherMode, WatcherSnapshot } from "./features/companion/watcherData";
import { formatDashboardPeriodLabel, getDashboardCurrentPeriodLabel, getDashboardPeriodRange, getInsightPeriodRange, getSafeClassificationNavigationDay, shiftDashboardPeriodDay } from "./features/dashboard/dashboardPeriods";
import type { ClassificationRange, DashboardPeriod, DashboardPeriodOption } from "./features/dashboard/dashboardPeriods";
import { buildQuarterHourDayField } from "./features/dashboard/dayField";
import { FOCUS_DRIFT_AXIS_TICKS, FOCUS_DRIFT_CHART_BOUNDS, FOCUS_DRIFT_CLIP_BOUNDS, FOCUS_DRIFT_GRID_PATH, FOCUS_DRIFT_Y_AXIS_TICKS, buildFocusDriftChart, buildProductivityQualityPercent } from "./features/dashboard/focusDriftChart";
import type { FocusDriftAxisTickStyle, FocusDriftLiveStyle, FocusDriftPoint, FocusDriftSourceSummary } from "./features/dashboard/focusDriftChart";
import { buildMonthV2Overview } from "./features/dashboard/monthOverview";
import type { MonthCellStyle } from "./features/dashboard/monthOverview";
import { buildWeekCalendarEvents, buildWeekDayRows } from "./features/dashboard/weekCalendar";
import type { WeekCalendarEvent, WeekCalendarEventIdentity, WeekCalendarEventStyle, WeekCalendarNowMarkerStyle, WeekDayRow } from "./features/dashboard/weekCalendar";
import { DONUT_CIRCUMFERENCE, WEEKLY_BREAKDOWN_WEEKDAYS, buildAttentionRhythm, buildDonutView, buildInsightSourceLists, buildWeeklyBreakdown, buildWeeklyChartView, formatInsightSourceValue, insightSourceValue } from "./features/insights/insightData";
import type { AttentionRhythmCell, DonutCategorySlice, DonutView, InsightSourceLists, ProductivityAnalysisKind, ProductivityInsightReport, WeeklyBreakdownDay, WeeklyChartColumn, WeeklyChartMode } from "./features/insights/insightData";
import { getLeaderboardPeriodFocusLabel, getLeaderboardWindowStartDay } from "./features/leaderboard/leaderboardWindow";
import { LOCAL_AI_SETUP_STORAGE_KEY, normalizeOpenRouterFallbackModels, normalizeOpenRouterPrimaryModel, resolveInitialLocalAiSetup, toPersistedLocalAiSetup } from "./features/settings/localAiSetup";
import type { LocalAiSetupState } from "./features/settings/localAiSetup";
import { AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY, APP_THEME_ACCENT_COLOR_OPTIONS, APP_THEME_COLOR_OPTIONS, APP_THEME_COLOR_STORAGE_KEY, APP_THEME_PRODUCTIVITY_COLOR_OPTIONS, AUTO_UPDATE_CHECKS_STORAGE_KEY, CATEGORY_COLOR_OPTIONS, CATEGORY_COLOR_STORAGE_KEY, SIDEBAR_COLLAPSED_STORAGE_KEY, START_OF_DAY_OPTIONS, START_OF_DAY_STORAGE_KEY, START_OF_WEEK_OPTIONS, START_OF_WEEK_STORAGE_KEY, THEME_STORAGE_KEY, categoryControlColor, hourlyStartOfDayValueToMinutes, isHexColor, minutesToHourlyStartOfDayValue, productivityControlColor, resolveInitialAiClassificationVisibility, resolveInitialAppThemeColorOverrides, resolveInitialAutoUpdateChecksEnabled, resolveInitialCategoryColorOverrides, resolveInitialSidebarCollapsed, resolveInitialStartOfDayMinutes, resolveInitialStartOfWeek, resolveInitialTheme } from "./features/settings/settingsStorage";
import type { AppThemeColorOverrides, CategoryColorOverrides, StartOfWeek, ThemeMode } from "./features/settings/settingsStorage";
import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "./lib/activityLabels";
import { WEEKDAY_LABELS, clockHourForLogicalHour, describeRelativeDay, filterSegmentsForRange, formatCalendarMinuteLabel, formatCompactDurationFromSeconds, formatDateRangeLabel, formatDayLabel, formatDuration, formatHourLabel, formatQuarterHourLabel, formatRelativeTime, formatTimeLabel, getDayPart, getLogicalDayRange, isoDateFromTimestamp, localDateKey, logicalTodayIsoDate, toErrorMessage, weekdayOrderIndex } from "./lib/formatting";
import { DateNavigator } from "./components/DateNavigator";
import { EmptyState } from "./components/EmptyState";
import { MetricTile } from "./components/MetricTile";
import { Toggle } from "./components/Toggle";
import { aiServerStatusLabelForCloud, driftyCloudStatusLabel, hasAiClassificationUsageMeasurement } from "./features/ai-connection/aiStatusLabels";
import { AccountMenu } from "./features/auth/AccountMenu";
import { AuthConfigurationGate, AuthLoadingGate, AuthRequiredGate } from "./features/auth/AuthGates";
import type { ClassificationPanelStyle } from "./features/classification/ClassificationBreakdownCards";
import { FlowCompactSplitChart } from "./features/dashboard/CompactCharts";
import { HistoryCalendarPanel } from "./features/dashboard/HistoryCalendarPanel";
import { FocusDriftHoverCard, formatFocusDriftHoverLabel } from "./features/dashboard/FocusDriftHoverCard";
import type { FocusDriftHoverKind, FocusDriftHoverState, TimelineHoverState } from "./features/dashboard/HoverCards";
import { WeekDashboard } from "./features/dashboard/WeekDashboard";
import { BreakRecoveryCard } from "./features/insights/BreakRecoveryCard";
import { AttentionRhythmCard, InsightSourceGroup, ProductivityPersonaCard, WeeklyCategoryRow } from "./features/insights/InsightCards";
import { EditProfileModal, ProfileModal, buildPublicProfileUrl, copyTextToClipboard, readImageFileAsDataUrl } from "./features/profile/ProfileModals";

type TabId = "dashboard" | "classification" | "history" | "trends" | "leaderboard" | "settings";

type NavigationSnapshot = {
  tabId: TabId;
  dashPeriod: DashboardPeriod;
};

type NavigationHistoryState = {
  entries: NavigationSnapshot[];
  index: number;
};

const commandBarTabs = [
  { id: "dashboard", label: "Dashboard", sub: "Today at a glance" },
  { id: "classification", label: "Classification", sub: "Activity breakdown" },
  { id: "trends", label: "Trends", sub: "Patterns and trends" },
  { id: "history", label: "History", sub: "Local records" },
  { id: "leaderboard", label: "Leaderboard", sub: "Global focus ranking" },
  { id: "settings", label: "Settings", sub: "App preferences" },
] satisfies ReadonlyArray<{ id: TabId; label: string; sub: string }>;

type NavItem = {
  id: TabId;
  label: string;
  icon: NavIconType;
};

type NavIconType = "home" | "calendar" | "classification" | "history" | "trends" | "leaderboard" | "settings";

type PlanItem = {
  id: string;
  title: string;
  estimate: string;
  completed: boolean;
  source: "Quick add" | "Pinned";
};

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

type UpdateCheckMode = "manual" | "automatic";

const AUTO_UPDATE_CHECK_DELAY_MS = 2500;
const AUTO_UPDATE_DISMISS_SUPPRESSION_MS = 48 * 60 * 60 * 1000;
const AUTO_UPDATE_DISMISS_STORAGE_KEY = "drifty.updates.dismissedAutoUpdate.v1";

type DismissedAutoUpdate = {
  readonly version: string;
  readonly dismissedAtMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readDismissedAutoUpdate(): DismissedAutoUpdate | null {
  if (typeof window === "undefined") return null;
  try {
    const savedValue = window.localStorage.getItem(AUTO_UPDATE_DISMISS_STORAGE_KEY);
    if (!savedValue) return null;
    const parsedValue: unknown = JSON.parse(savedValue);
    if (!isRecord(parsedValue)) return null;
    const version = parsedValue["version"];
    const dismissedAtMs = parsedValue["dismissedAtMs"];
    if (typeof version !== "string" || typeof dismissedAtMs !== "number") return null;
    if (!Number.isFinite(dismissedAtMs)) return null;
    return { version, dismissedAtMs };
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function isAutomaticUpdateDismissed(version: string, nowMs: number): boolean {
  const dismissedUpdate = readDismissedAutoUpdate();
  if (!dismissedUpdate) return false;
  if (dismissedUpdate.version !== version) return false;
  return nowMs - dismissedUpdate.dismissedAtMs < AUTO_UPDATE_DISMISS_SUPPRESSION_MS;
}

function persistDismissedAutoUpdate(version: string, dismissedAtMs: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_UPDATE_DISMISS_STORAGE_KEY, JSON.stringify({ version, dismissedAtMs }));
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}

const dashboardPeriodOptions: DashboardPeriodOption[] = [
  { period: "Today", label: "Your Day", detail: "Live timeline" },
  { period: "Week", label: "Your Week", detail: "Calendar week" },
];

const activityNav: NavItem[] = [
  { id: "classification", label: "Classification", icon: "classification" },
  { id: "trends", label: "Trends", icon: "trends" },
  { id: "history", label: "History", icon: "history" },
  { id: "leaderboard", label: "Leaderboard", icon: "leaderboard" },
];

const initialPlanItems: PlanItem[] = [
  { id: "plan-1", title: "Review the morning focus block", estimate: "10m", completed: false, source: "Pinned" },
  { id: "plan-2", title: "Protect the next deep-work window", estimate: "15m", completed: false, source: "Pinned" },
  { id: "plan-3", title: "Close with one short reflection", estimate: "5m", completed: true, source: "Pinned" },
];

function loadClassificationMetrics(day: string): Promise<ClassificationMetrics | null> {
  const client = trackerClient as Partial<typeof trackerClient>;
  return typeof client.getClassificationMetrics === "function"
    ? client.getClassificationMetrics({ day }).catch(() => null)
    : Promise.resolve(null);
}

function loadAiClassificationUsage(day: string): Promise<AiClassificationUsageSummary | null> {
  return getAiClassificationUsageSummary(day).catch(() => null);
}

function isRendererFocused(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/* ── SVG Icons ── */
function NavIcon({ type }: { type: NavIconType }) {
  const props = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 18, height: 18 };
  switch (type) {
    case "home":
      return (<svg {...props}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></svg>);
    case "calendar":
      return (<svg {...props}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="M8 14h2M14 14h2M8 17h2" /></svg>);
    case "classification":
      return (<svg {...props}><path d="M4 5h16M4 12h10M4 19h14" /><circle cx="18" cy="12" r="2" /><circle cx="20" cy="19" r="2" /></svg>);
    case "history":
      return (<svg {...props}><path d="M12 8v5l3 2" /><path d="M5.6 5.6A9 9 0 1 1 3 12" /><path d="M3 4v5h5" /></svg>);
    case "trends":
      return (<svg {...props}><path d="M4 20h16" /><path d="M6 16l4-5 3 3 5-7" /></svg>);
    case "leaderboard":
      return (<svg {...props}><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" /><path d="M7 5H5a2 2 0 0 0 2 4" /><path d="M17 5h2a2 2 0 0 1-2 4" /></svg>);
    case "settings":
      return (<svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>);
  }
}

function WindowThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="window-theme-toggle"
      onClick={onToggle}
      aria-label="Toggle theme"
      aria-pressed={theme === "dark"}
      title={`Switch to ${nextTheme} mode`}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A8.2 8.2 0 1 1 11.2 3a6.4 6.4 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unexpected app state: ${JSON.stringify(value)}`);
}

type MainContentShellProps = {
  activeTab: TabId;
  loading: boolean;
  hasLoadedOnce: boolean;
  error: string | null;
  contentRef?: RefObject<HTMLElement>;
  children: ReactNode;
};

function MainContentShell({ activeTab, loading, hasLoadedOnce, error, contentRef, children }: MainContentShellProps) {
  const isRefreshing = loading && hasLoadedOnce;

  return (
    <main ref={contentRef} className={`content content--${activeTab}`}>
      <div className="refresh-indicator" data-active={isRefreshing} aria-live="polite" aria-hidden={!isRefreshing}>
        Refreshing tracker data&hellip;
      </div>
      {error ? <div className="notice notice--error">Error: {error}</div> : null}
      {children}
    </main>
  );
}

export default function App() {
  const contentRef = useRef<HTMLElement>(null);
  const endOfDayReviewSettingsRowRef = useRef<HTMLDivElement>(null);
  const updaterCheckingRef = useRef(false);
  const updaterInstallingRef = useRef(false);
  const autoUpdateLaunchCheckScheduledRef = useRef(false);
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryState>({ entries: [{ tabId: "dashboard", dashPeriod: "Today" }], index: 0 });
  const activeSnapshot = navigationHistory.entries[navigationHistory.index] ?? { tabId: "dashboard", dashPeriod: "Today" };
  const activeTab = activeSnapshot.tabId;
  const dashPeriod = activeSnapshot.dashPeriod;
  const canNavigateBack = navigationHistory.index > 0;
  const canNavigateForward = navigationHistory.index < navigationHistory.entries.length - 1;
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme);
  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(resolveInitialSidebarCollapsed);
  const [selectedDay, setSelectedDay] = useState(() => logicalTodayIsoDate(resolveInitialStartOfDayMinutes()));
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [currentSnapshot, setCurrentSnapshot] = useState<CurrentActivitySnapshot | null>(null);
  const [segments, setSegments] = useState<ActivitySegment[]>([]);
  const [segmentsLoadedDay, setSegmentsLoadedDay] = useState<string | null>(null);
  const [historySegments, setHistorySegments] = useState<ActivitySegment[]>([]);
  const [leaderboardSegments, setLeaderboardSegments] = useState<ActivitySegment[]>([]);
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
  const [classifySelectedCategoryId, setClassifySelectedCategoryId] = useState<string | null>(null);
  const [classifySelectedSourceId, setClassifySelectedSourceId] = useState<string | null>(null);
  const [expandedClassificationActivityRows, setExpandedClassificationActivityRows] = useState<Set<string>>(() => new Set());
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [availableUpdateSource, setAvailableUpdateSource] = useState<UpdateCheckMode | null>(null);
  const [autoUpdateChecksEnabled, setAutoUpdateChecksEnabled] = useState(resolveInitialAutoUpdateChecksEnabled);
  const [updaterChecking, setUpdaterChecking] = useState(false);
  const [updaterInstalling, setUpdaterInstalling] = useState(false);
  const [updaterMessage, setUpdaterMessage] = useState<string | null>(null);
  const [updaterError, setUpdaterError] = useState<string | null>(null);
  const [startOfDayMinutes, setStartOfDayMinutes] = useState(resolveInitialStartOfDayMinutes);
  const [startOfWeek, setStartOfWeek] = useState<StartOfWeek>(resolveInitialStartOfWeek);
  const [categoryColorOverrides, setCategoryColorOverrides] = useState<CategoryColorOverrides>(resolveInitialCategoryColorOverrides);
  const [appThemeColorOverrides, setAppThemeColorOverrides] = useState<AppThemeColorOverrides>(resolveInitialAppThemeColorOverrides);
  const [driftAlertsEnabled, setDriftAlertsEnabled] = useState(resolveInitialDriftAlertsEnabled);
  const [driftAlertDelaySeconds, setDriftAlertDelaySeconds] = useState<DriftAlertDelaySeconds>(resolveInitialDriftAlertDelaySeconds);
  const [driftAlarmCopy, setDriftAlarmCopy] = useState(resolveInitialDriftAlarmCopy);
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(resolveInitialExtremeNudgeEnabled);
  const [driftAlarmSnooze, setDriftAlarmSnooze] = useState<DriftAlarmBreakSnooze | null>(null);
  const [driftAlarmTrayStatus, setDriftAlarmTrayStatus] = useState<DriftAlarmTrayStatus>(() => {
    const enabled = resolveInitialDriftAlertsEnabled();
    return buildDriftAlarmTrayStatus({
      enabled,
      checkedAt: null,
      result: enabled ? { kind: "no_candidate" } : { kind: "disabled" },
    });
  });
  const [breakRecoveryAssessment, setBreakRecoveryAssessment] = useState<DriftAlarmBreakSnooze | null>(null);
  const [driftAlarmInteractions, setDriftAlarmInteractions] = useState<DriftAlarmInteraction[]>(readDriftAlarmInteractions);
  const [watcherPeekEnabled, setWatcherPeekEnabled] = useState(resolveInitialWatcherPeekEnabled);
  const [watcherMode, setWatcherMode] = useState<WatcherMode>(resolveInitialWatcherMode);
  const [showAiClassificationImpact, setShowAiClassificationImpact] = useState(resolveInitialAiClassificationVisibility);
  const [localAiSetup, setLocalAiSetup] = useState<LocalAiSetupState>(resolveInitialLocalAiSetup);
  const [classificationRules, setClassificationRules] = useState<ClassificationRule[]>([]);
  const [classificationRulesLoading, setClassificationRulesLoading] = useState(false);
  const [classificationRulesError, setClassificationRulesError] = useState<string | null>(null);
  const [classificationRuleMessage, setClassificationRuleMessage] = useState<string | null>(null);
  const [classificationRuleSavingKind, setClassificationRuleSavingKind] = useState<ClassificationRuleTargetKind | null>(null);
  const [classificationRuleDeletingId, setClassificationRuleDeletingId] = useState<string | null>(null);
  const [classificationRuleApplying, setClassificationRuleApplying] = useState(false);
  const [classificationRuleApplyResult, setClassificationRuleApplyResult] = useState<ClassificationRuleApplyResult | null>(null);
  const [domainRuleInput, setDomainRuleInput] = useState("");
  const [domainRuleCategory, setDomainRuleCategory] = useState<ActivityCategory>("workspace");
  const [domainRuleProductivity, setDomainRuleProductivity] = useState<ProductivityLabel>("focus");
  const [appRuleSearch, setAppRuleSearch] = useState("");
  const [appRuleTargetValue, setAppRuleTargetValue] = useState("");
  const [appRuleDisplayName, setAppRuleDisplayName] = useState("");
  const [appRuleCategory, setAppRuleCategory] = useState<ActivityCategory>("workspace");
  const [appRuleProductivity, setAppRuleProductivity] = useState<ProductivityLabel>("focus");
  const [classificationRuleCandidates, setClassificationRuleCandidates] = useState<ClassificationRuleCandidate[]>([]);
  const [classificationRuleCandidatesLoading, setClassificationRuleCandidatesLoading] = useState(false);
  const [aiSetupDialogOpen, setAiSetupDialogOpen] = useState(false);
  const [dashboardAiUnavailablePreviewCase, setDashboardAiUnavailablePreviewCase] = useState<DashboardAiUnavailablePreviewCase>("trial-ended");
  const [dashboardAiUnavailablePreview, setDashboardAiUnavailablePreview] = useState<DashboardAiUnavailablePreviewState | null>(null);
  const [dismissedDashboardAiRecoveryKey, setDismissedDashboardAiRecoveryKey] = useState<string | null>(null);
  const [watcherPeriodicMinMinutes, setWatcherPeriodicMinMinutes] = useState(() => resolveInitialWatcherPeriodicMinutes("min"));
  const [watcherPeriodicMaxMinutes, setWatcherPeriodicMaxMinutes] = useState(() => resolveInitialWatcherPeriodicMinutes("max"));
  const [watcherEvent, setWatcherEvent] = useState<WatcherPeekEvent | null>(null);
  const [endOfDayReviewEvent, setEndOfDayReviewEvent] = useState<EndOfDayReviewEvent | null>(null);
  const [driftAlarmEvent, setDriftAlarmEvent] = useState<DriftAlarmEvent | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    appIconsRef.current = appIcons;
  }, [appIcons]);

  const navigateToTab = useCallback((tabId: TabId, nextDashPeriod = dashPeriod) => {
    setNavigationHistory((current) => {
      const currentSnapshot = current.entries[current.index] ?? { tabId: "dashboard", dashPeriod: "Today" };
      if (currentSnapshot.tabId === tabId && currentSnapshot.dashPeriod === nextDashPeriod) return current;

      const entries = current.entries.slice(0, current.index + 1);
      return { entries: [...entries, { tabId, dashPeriod: nextDashPeriod }], index: entries.length };
    });
  }, [dashPeriod]);

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
  const handleSettingsBack = useCallback(() => {
    setAccountMenuOpen(false);
    if (canNavigateBack) {
      navigateBack();
      return;
    }

    navigateToTab("dashboard", "Today");
  }, [canNavigateBack, navigateBack, navigateToTab]);

  const handleCheckForUpdates = useCallback(async (mode: UpdateCheckMode = "manual") => {
    if (updaterCheckingRef.current || updaterInstallingRef.current) return;

    const isManualCheck = mode === "manual";
    updaterCheckingRef.current = true;
    if (isManualCheck) {
      setUpdaterChecking(true);
      setUpdaterMessage(null);
      setUpdaterError(null);
    }

    try {
      const nextUpdate = await check();
      if (nextUpdate) {
        if (isManualCheck || !isAutomaticUpdateDismissed(nextUpdate.version, Date.now())) {
          setAvailableUpdate(nextUpdate);
          setAvailableUpdateSource(mode);
        }
        return;
      }
      if (isManualCheck) {
        setAvailableUpdate(null);
        setAvailableUpdateSource(null);
        setUpdaterMessage("Drifty is up to date.");
      }
    } catch (nextError) {
      if (isManualCheck) {
        setAvailableUpdate(null);
        setAvailableUpdateSource(null);
        setUpdaterError(`Update check failed: ${toErrorMessage(nextError)}`);
      }
    } finally {
      updaterCheckingRef.current = false;
      if (isManualCheck) setUpdaterChecking(false);
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    if (!availableUpdate || updaterInstallingRef.current) return;

    updaterInstallingRef.current = true;
    setUpdaterInstalling(true);
    setUpdaterError(null);

    try {
      await availableUpdate.downloadAndInstall();
      await relaunch();
    } catch (nextError) {
      setUpdaterError(`Update install failed: ${toErrorMessage(nextError)}`);
    } finally {
      updaterInstallingRef.current = false;
      setUpdaterInstalling(false);
    }
  }, [availableUpdate]);

  const handleTrayCheckForUpdates = useCallback(() => {
    openSettingsTab();
    void handleCheckForUpdates();
  }, [handleCheckForUpdates, openSettingsTab]);

  const dismissAvailableUpdate = useCallback(() => {
    if (availableUpdate && availableUpdateSource === "automatic") {
      persistDismissedAutoUpdate(availableUpdate.version, Date.now());
    }
    setAvailableUpdate(null);
    setAvailableUpdateSource(null);
  }, [availableUpdate, availableUpdateSource]);

  const openEndOfDayReviewSettings = useCallback(() => {
    if (!END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED) return;
    shouldFocusEndOfDayReviewSettingsRef.current = true;
    setSettingsSection("dev");
    navigateToTab("settings");
    setAccountMenuOpen(false);
  }, [navigateToTab]);

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
  const [developerAuthRequiredPreview, setDeveloperAuthRequiredPreview] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [ownLeaderboardEntry, setOwnLeaderboardEntry] = useState<OwnLeaderboardEntry | null>(null);
  const [activeLeaderboardPeriod, setActiveLeaderboardPeriod] = useState<LeaderboardPeriod>(DEFAULT_LEADERBOARD_PERIOD);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardActionLoading, setLeaderboardActionLoading] = useState(false);
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboardActionError, setLeaderboardActionError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState({ displayName: "", bio: "", avatarUrl: "", websiteUrl: "", githubUrl: "", linkedinUrl: "", isPublic: true });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileReadyUserId, setProfileReadyUserId] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileShareMessage, setProfileShareMessage] = useState<string | null>(null);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [classificationMetrics, setClassificationMetrics] = useState<ClassificationMetrics | null>(null);
  const [aiClassificationUsage, setAiClassificationUsage] = useState<AiClassificationUsageSummary | null>(null);
  const [aiClassificationUsageDay, setAiClassificationUsageDay] = useState<string | null>(null);
  const [classificationActionLoading, setClassificationActionLoading] = useState(false);
  const [classificationSummary, setClassificationSummary] = useState<AiClassificationSummary | null>(null);
  const [observedAiClassificationFailure, setObservedAiClassificationFailure] = useState(false);
  const [rendererFocused, setRendererFocused] = useState(isRendererFocused);
  const [timelineHover, setTimelineHover] = useState<TimelineHoverState | null>(null);
  const [focusDriftHover, setFocusDriftHover] = useState<FocusDriftHoverState | null>(null);
  const [selectedLeaderboardRow, setSelectedLeaderboardRow] = useState<LeaderboardRow | null>(null);
  const [selectedPublicProfile, setSelectedPublicProfile] = useState<PublicProfile | null>(null);
  const [selectedProfileLoading, setSelectedProfileLoading] = useState(false);
  const [selectedProfileError, setSelectedProfileError] = useState<string | null>(null);
  const [billingEntitlement, setBillingEntitlement] = useState<BillingEntitlement | null>(null);
  const [billingEntitlementLoading, setBillingEntitlementLoading] = useState(false);
  const [billingEntitlementError, setBillingEntitlementError] = useState<string | null>(null);
  const [billingCheckoutLoadingInterval, setBillingCheckoutLoadingInterval] = useState<BillingInterval | null>(null);
  const selectedDayClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      fallbackCandidates: segments,
      includeAiClassifications: showAiClassificationImpact,
      rules: classificationRules,
    }),
    [classificationRules, segments, showAiClassificationImpact],
  );
  const recentDriftAlarmFocusTargets = useMemo(
    () => buildRecentFocusTargets(segments, historySegments, selectedDayClassificationOptions, appIcons),
    [appIcons, historySegments, segments, selectedDayClassificationOptions],
  );
  const localAiClassificationOptions = useMemo(() => {
    if (localAiSetup.provider === "openrouter_byok") {
      const apiKey = localAiSetup.openRouterApiKey.trim();
      if (!apiKey) return null;
      const model = normalizeOpenRouterPrimaryModel(localAiSetup.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(model, localAiSetup.openRouterFallbackModels);
      return { localProvider: { provider: "openrouter_byok" as const, apiKey, model, fallbackModels } };
    }

    const baseUrl = localAiSetup.selfHostedBaseUrl.trim();
    const model = localAiSetup.selfHostedModel.trim();
    if (!baseUrl || !model) return null;
    return { localProvider: { provider: "self_hosted" as const, baseUrl, model } };
  }, [localAiSetup]);
  const {
    user,
    status: authStatus,
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
  const isEffectiveAuthRequired = isAuthRequired || developerAuthRequiredPreview;
  const allowsEffectiveAnonymousAuth = allowsAnonymousAuth && !developerAuthRequiredPreview;
  const hasEffectiveBlockingAuthConfigurationError = hasBlockingAuthConfigurationError || (developerAuthRequiredPreview && !isSupabaseConfigured);
  const shouldCheckBillingEntitlement = isSupabaseConfigured && authStatus === "authenticated" && hasRequiredAccountAuth;
  const shouldBlockLocalTrackerAccess = developerAuthRequiredPreview && (hasEffectiveBlockingAuthConfigurationError || !hasRequiredAccountAuth);
  const isPolicySignedIn = Boolean(user) && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
  const canUseCloudAiClassification = isSupabaseConfigured && isPolicySignedIn && billingEntitlement?.canUseApp === true;
  useEffect(() => {
    setObservedAiClassificationFailure(false);
  }, [canUseCloudAiClassification, localAiClassificationOptions]);
  const isSidebarVisuallyCollapsed = activeTab !== "settings" && sidebarCollapsed;
  const refreshRequestRef = useRef(0);
  const requiredCurrentSnapshotRefreshInFlightRef = useRef(false);
  const leaderboardRefreshRequestRef = useRef(0);
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
  const driftAlarmRequestInFlightRef = useRef(false);
  const pendingDriftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const pendingBreakReturnAlarmRef = useRef<DriftAlarmBreakSnooze | null>(null);
  const publishDriftAlarmTrayStatus = useCallback((result: DriftAlarmTrayResult, checkedAt: Date | null = new Date()) => {
    setDriftAlarmTrayStatus(buildDriftAlarmTrayStatus({
      enabled: driftAlertsEnabled,
      checkedAt,
      result,
    }));
  }, [driftAlertsEnabled]);
  const driftAlarmPreviewCounterRef = useRef(0);
  const billingEntitlementRequestRef = useRef(0);
  const driftReminderStateRef = useRef<DriftReminderState | null>(null);
  const segmentsRef = useRef<ActivitySegment[]>([]);
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

  const loadClassificationRules = useCallback(async () => {
    setClassificationRulesLoading(true);
    setClassificationRulesError(null);
    try {
      setClassificationRules(await trackerClient.getClassificationRules());
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
    } finally {
      setClassificationRulesLoading(false);
    }
  }, []);

  const saveClassificationRule = useCallback(async (input: ClassificationRuleInput) => {
    setClassificationRuleSavingKind(input.targetKind);
    setClassificationRulesError(null);
    setClassificationRuleMessage(null);
    setClassificationRuleApplyResult(null);
    try {
      const savedRule = await trackerClient.saveClassificationRule(input);
      const applyResult = await trackerClient.applyClassificationRules();
      setClassificationRuleApplyResult(applyResult);
      setClassificationRuleMessage(`${classificationRuleTargetLabel(savedRule.targetKind)} rule saved locally.`);
      setClassificationRules(await trackerClient.getClassificationRules());
      await refresh(selectedDay);
      return true;
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
      return false;
    } finally {
      setClassificationRuleSavingKind(null);
    }
  }, [selectedDay]);

  async function handleSaveDomainRule() {
    const targetValue = normalizeDomainRuleInput(domainRuleInput);
    if (!targetValue) {
      setClassificationRulesError("Enter a domain or URL, like example.com.");
      return;
    }
    if (hasDuplicateClassificationRule(classificationRules, "site", targetValue)) {
      setClassificationRulesError("A Domain rule for this site already exists. Edit or delete the existing rule first.");
      return;
    }
    const saved = await saveClassificationRule({ targetKind: "site", targetValue, category: domainRuleCategory, productivity: domainRuleProductivity, enabled: true });
    if (saved) setDomainRuleInput("");
  }

  async function handleSaveAppRule() {
    const targetValue = appRuleTargetValue.trim();
    if (!targetValue) {
      setClassificationRulesError("Search and choose a recorded app before saving an App rule.");
      return;
    }
    if (hasDuplicateClassificationRule(classificationRules, "app", targetValue)) {
      setClassificationRulesError("An App rule for this app already exists. Edit or delete the existing rule first.");
      return;
    }
    const saved = await saveClassificationRule({ targetKind: "app", targetValue, category: appRuleCategory, productivity: appRuleProductivity, enabled: true });
    if (saved) {
      setAppRuleSearch("");
      setAppRuleTargetValue("");
      setAppRuleDisplayName("");
      setClassificationRuleCandidates([]);
    }
  }

  async function handleToggleClassificationRule(rule: ClassificationRule, enabled: boolean) {
    await saveClassificationRule({
      targetKind: rule.targetKind,
      targetValue: rule.targetValue,
      category: rule.category,
      productivity: rule.productivity,
      enabled,
      confidence: rule.confidence ?? null,
    });
  }

  async function handleDeleteClassificationRule(rule: ClassificationRule) {
    setClassificationRuleDeletingId(rule.id);
    setClassificationRulesError(null);
    setClassificationRuleMessage(null);
    setClassificationRuleApplyResult(null);
    try {
      await trackerClient.deleteClassificationRule(rule.id);
      setClassificationRuleMessage(`${classificationRuleTargetLabel(rule.targetKind)} rule deleted locally.`);
      setClassificationRules(await trackerClient.getClassificationRules());
      await refresh(selectedDay);
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
    } finally {
      setClassificationRuleDeletingId(null);
    }
  }

  async function handleApplyClassificationRules() {
    setClassificationRuleApplying(true);
    setClassificationRulesError(null);
    setClassificationRuleMessage(null);
    try {
      const applyResult = await trackerClient.applyClassificationRules();
      setClassificationRuleApplyResult(applyResult);
      setClassificationRuleMessage("Local rules reapplied to matching activity.");
      await refresh(selectedDay);
    } catch (nextError) {
      setClassificationRulesError(toErrorMessage(nextError));
    } finally {
      setClassificationRuleApplying(false);
    }
  }

  function handleSelectClassificationCandidate(candidate: ClassificationRuleCandidate) {
    setAppRuleSearch(candidate.displayName);
    setAppRuleDisplayName(candidate.displayName);
    setAppRuleTargetValue(candidate.targetValue);
    if (candidate.category) setAppRuleCategory(candidate.category);
    if (candidate.productivity) setAppRuleProductivity(candidate.productivity);
  }

  function updateFocusDriftKeyboardHover(kind: FocusDriftHoverKind, point: FocusDriftPoint, event: FocusEvent<SVGCircleElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setFocusDriftHover({ point, kind, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
  }

  function selectDay(day: string | ((currentDay: string) => string)) {
    autoSelectedLatestDayRef.current = true;
    setSelectedDay((currentDay) => {
      const nextDay = typeof day === "function" ? day(currentDay) : day;
      userSelectedDayRef.current = nextDay !== logicalTodayIsoDate(startOfDayMinutes);
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
  }, [armWatcherRecoveryTimer, clearWatcherEvent, showAiClassificationImpact]);

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
    const previewSegments = segments.length > 0 ? segments : buildMockEndOfDayReviewSegments(selectedDay);
    void buildEndOfDayReviewEvent({
      day: selectedDay,
      generatedAt: new Date().toISOString(),
      segments: previewSegments,
      isMock: true,
    }).then(showEndOfDayReview);
  }, [buildEndOfDayReviewEvent, segments, selectedDay, showEndOfDayReview]);

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
    const currentEvent = driftAlarmEventRef.current;
    if (currentEvent?.id === event.id && !hasDriftAlarmFocusTargetIconUpgrade(currentEvent, event)) return;
    if (driftAlarmRequestInFlightRef.current) {
      pendingDriftAlarmEventRef.current = event;
      return;
    }

    driftAlarmEventRef.current = event;
    lastDriftAlarmEventRef.current = event;

    if (!isTauriRuntime()) {
      setDriftAlarmEvent(event);
      return;
    }

    driftAlarmRequestInFlightRef.current = true;
    void showNativeDriftAlarm(event).catch(() => {
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
      focusTargets: recentDriftAlarmFocusTargets,
      copySettings: driftAlarmCopy,
    }));
  }, [driftAlarmCopy, recentDriftAlarmFocusTargets, showDriftAlarm]);

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
    if (!sourceSegmentId) return;

    const sourceSegment = segmentsRef.current.find((segment) => segment.id === sourceSegmentId);
    if (!sourceSegment) return;

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

    await refresh(selectedDayRef.current);
  }

  const returnToFocusTarget = useCallback((target: DriftAlarmFocusTarget | null) => {
    if (target?.siteDomain) {
      void activateFocusTargetSite(target).catch((error) => console.warn("Failed to open focus target site", error));
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
        navigateToTab("classification");
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

  const handleWatcherPeriodicMinChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = normalizeWatcherPeriodicMinutes(event.target.value, DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES.min);
    setWatcherPeriodicMinMinutes(nextValue);
    setWatcherPeriodicMaxMinutes((currentValue) => Math.max(currentValue, nextValue));
  }, []);

  const handleWatcherPeriodicMaxChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = normalizeWatcherPeriodicMinutes(event.target.value, DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES.max);
    setWatcherPeriodicMaxMinutes(Math.max(nextValue, watcherPeriodicMinMinutes));
  }, [watcherPeriodicMinMinutes]);

  async function refresh(day = selectedDay, options: { requireCurrentSnapshot?: boolean } = {}): Promise<boolean> {
    const isRequiredCurrentSnapshotRefresh = options.requireCurrentSnapshot === true;
    if (!isRequiredCurrentSnapshotRefresh && requiredCurrentSnapshotRefreshInFlightRef.current) return false;

    if (shouldBlockLocalTrackerAccess) {
      refreshRequestRef.current += 1;
      setLoading(false);
      setError(null);
      return false;
    }

    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
    if (isRequiredCurrentSnapshotRefresh) requiredCurrentSnapshotRefreshInFlightRef.current = true;
    setLoading(true);
    setError(null);

    const historyStartDay = shiftIsoDate(day, -89);
    const historySummaryRange = getLogicalDayRange(historyStartDay, day, startOfDayMinutes);
    const selectedWeekRange = getDashboardPeriodRange(day, "Week", startOfDayMinutes, startOfWeek);
    const historyTimelineEndDay = day > selectedWeekRange.endDay ? day : selectedWeekRange.endDay;
    const historyTimelineRange = getLogicalDayRange(historyStartDay, historyTimelineEndDay, startOfDayMinutes);
    const selectedDayRange = getLogicalDayRange(day, day, startOfDayMinutes);

    try {
      const archiveTimelineRequest = trackerClient
        .getTimeline(historyTimelineRange)
        .then((historyTimeline) => ({ historyTimeline }));

      const statusRequest = trackerClient.getStatus().then((nextStatus) => {
        if (refreshRequestRef.current !== requestId) return nextStatus;
        setStatus(nextStatus);
        setAccessibilityGranted(nextStatus.accessibilityGranted);
        return nextStatus;
      });

      const currentSnapshotRequest = isRequiredCurrentSnapshotRefresh
        ? trackerClient.getCurrentSnapshot()
        : trackerClient.getCurrentSnapshot().catch(() => null);

      const [timeline, archiveTimelines, historyHourlySummary, historySiteSummary, nextCurrentSnapshot, nextClassificationMetrics, nextAiClassificationUsage] = await Promise.all([
        trackerClient.getTimeline(selectedDayRange),
        archiveTimelineRequest,
        trackerClient.getHourlySummary(historySummaryRange),
        trackerClient.getTopSites({ ...historySummaryRange, limit: 8 }),
        currentSnapshotRequest,
        loadClassificationMetrics(day),
        loadAiClassificationUsage(day),
        statusRequest,
      ]);

      if (refreshRequestRef.current !== requestId) return false;
      const { historyTimeline } = archiveTimelines;

      setCurrentSnapshot(nextCurrentSnapshot);
      setSegments(timeline);
      setSegmentsLoadedDay(day);
      setHistorySegments(historyTimeline);
      setHourly(buildHourlySummary(timeline));
      setInsightHourly(historyHourlySummary);
      setInsightTopSites(historySiteSummary);
      setClassificationMetrics(nextClassificationMetrics);
      setAiClassificationUsage(nextAiClassificationUsage);
      setAiClassificationUsageDay(nextAiClassificationUsage ? day : null);
      setAppIcons({});

      void (async () => {
        try {
          const hourlySummary = await trackerClient.getHourlySummary(selectedDayRange);
          if (refreshRequestRef.current !== requestId) return;
          setHourly(hourlySummary.length > 0 ? hourlySummary : buildHourlySummary(timeline));
        } catch {
          if (refreshRequestRef.current !== requestId) return;
        }
      })();

      void (async () => {
        try {
          const iconSegments = [...timeline, ...historyTimeline];
          const uniqueApps = Array.from(
            new Map(iconSegments.map((segment) => [
              segment.bundleId || segment.appName,
              { appName: segment.appName, bundleId: segment.bundleId ?? null },
            ])).values(),
          );
          if (uniqueApps.length === 0) return;
          const rawIconMap = await trackerClient.getAppIcons(uniqueApps);
          if (refreshRequestRef.current !== requestId) return;
          const iconMap = uniqueApps.reduce<AppIconMap>((acc, item) => {
            const identityKey = item.bundleId || item.appName;
            const nextIcon = rawIconMap[identityKey] ?? null;
            acc[identityKey] = acc[identityKey] ?? nextIcon;
            acc[item.appName] = acc[item.appName] ?? nextIcon;
            return acc;
          }, {});
          setAppIcons(iconMap);
        } catch {
          if (refreshRequestRef.current !== requestId) return;
          setAppIcons({});
        }
      })();
      return true;
    } catch (nextError) {
      if (refreshRequestRef.current !== requestId) return false;
      setError(toErrorMessage(nextError));
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

  useEffect(() => {
    window.__DRIFTY_SET_BOOT_STATUS__?.("Renderer mounted. Showing minimal shell\u2026");
    window.__DRIFTY_BOOTSTRAPPED__ = true;
    document.getElementById("boot-shell")?.remove();
  }, []);

  useEffect(() => {
    if (shouldBlockLocalTrackerAccess) return;
    void refresh(selectedDay);
  }, [selectedDay, shouldBlockLocalTrackerAccess, startOfDayMinutes, startOfWeek]);

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
      void refresh(selectedDay);
    }, 30000);
    return () => clearInterval(intervalId);
  }, [selectTodayAfterDateRollover, selectedDay, shouldBlockLocalTrackerAccess]);

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
    window.localStorage.setItem(AUTO_UPDATE_CHECKS_STORAGE_KEY, autoUpdateChecksEnabled ? "1" : "0");
  }, [autoUpdateChecksEnabled]);

  useEffect(() => {
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, driftAlertsEnabled ? "1" : "0");
  }, [driftAlertsEnabled]);

  useEffect(() => {
    window.localStorage.setItem(DRIFT_ALERT_DELAY_STORAGE_KEY, String(driftAlertDelaySeconds));
  }, [driftAlertDelaySeconds]);

  useEffect(() => {
    persistDriftAlarmCopy(driftAlarmCopy);
  }, [driftAlarmCopy]);

  useEffect(() => {
    window.localStorage.setItem(EXTREME_NUDGE_STORAGE_KEY, extremeNudgeEnabled ? "1" : "0");
  }, [extremeNudgeEnabled]);

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
    window.localStorage.setItem(WATCHER_PEEK_STORAGE_KEY, watcherPeekEnabled ? "1" : "0");
  }, [watcherPeekEnabled]);

  useEffect(() => {
    window.localStorage.setItem(WATCHER_MODE_STORAGE_KEY, watcherMode);
  }, [watcherMode]);

  useEffect(() => {
    window.localStorage.setItem(AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY, showAiClassificationImpact ? "1" : "0");
  }, [showAiClassificationImpact]);

  useEffect(() => {
    window.localStorage.setItem(LOCAL_AI_SETUP_STORAGE_KEY, JSON.stringify(toPersistedLocalAiSetup(localAiSetup)));
  }, [localAiSetup]);

  // Load rules at startup too: live drift detection reads them through classification options.
  useEffect(() => {
    void loadClassificationRules();
  }, [loadClassificationRules]);

  useEffect(() => {
    if (activeTab !== "settings" || settingsSection !== "classification") return;
    void loadClassificationRules();
  }, [activeTab, loadClassificationRules, settingsSection]);

  useEffect(() => {
    if (activeTab !== "settings" || settingsSection !== "classification") return undefined;
    const query = appRuleSearch.trim();
    if (query.length < 2) {
      setClassificationRuleCandidates([]);
      setClassificationRuleCandidatesLoading(false);
      return undefined;
    }

    let disposed = false;
    setClassificationRuleCandidatesLoading(true);
    const timeoutId = window.setTimeout(() => {
      void trackerClient.searchClassificationRuleCandidates(query).then((candidates) => {
        if (disposed) return;
        setClassificationRuleCandidates(candidates.filter((candidate) => candidate.targetKind === "app"));
      }).catch((nextError) => {
        if (disposed) return;
        setClassificationRulesError(toErrorMessage(nextError));
        setClassificationRuleCandidates([]);
      }).finally(() => {
        if (!disposed) setClassificationRuleCandidatesLoading(false);
      });
    }, 180);

    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeTab, appRuleSearch, settingsSection]);

  useEffect(() => {
    window.localStorage.setItem(WATCHER_PERIODIC_MIN_STORAGE_KEY, String(watcherPeriodicMinMinutes));
  }, [watcherPeriodicMinMinutes]);

  useEffect(() => {
    window.localStorage.setItem(WATCHER_PERIODIC_MAX_STORAGE_KEY, String(watcherPeriodicMaxMinutes));
  }, [watcherPeriodicMaxMinutes]);

  useEffect(() => {
    if (watcherPeriodicMaxMinutes < watcherPeriodicMinMinutes) setWatcherPeriodicMaxMinutes(watcherPeriodicMinMinutes);
  }, [watcherPeriodicMaxMinutes, watcherPeriodicMinMinutes]);

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
    if (!autoUpdateChecksEnabled) return undefined;
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
  }, [autoUpdateChecksEnabled, handleCheckForUpdates]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen("tray-open-settings", openSettingsTab).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [openSettingsTab]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen("tray-check-for-updates", handleTrayCheckForUpdates).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleTrayCheckForUpdates]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen("tray-toggle-theme", toggleTheme).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [toggleTheme]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void listenToNativeEndOfDayReviewAction(handleEndOfDayReviewAction).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeWatcherResponse(handleWatcherResponse).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeWatcherDismissed(dismissWatcherPeek).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeDriftAlarmAction(handleDriftAlarmAction).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    void listenToNativeDriftAlarmDismissed(handleDriftAlarmDismissed).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [dismissWatcherPeek, handleDriftAlarmAction, handleDriftAlarmDismissed, handleEndOfDayReviewAction, handleWatcherResponse]);

  useEffect(() => {
    const checkedAt = new Date();
    const clearPendingTransientRefresh = () => {
      if (!pendingDriftAlarmTransientRefreshRef.current) return;
      window.clearTimeout(pendingDriftAlarmTransientRefreshRef.current);
      pendingDriftAlarmTransientRefreshRef.current = 0;
    };
    const clearPendingTransientDriftAlarm = () => {
      pendingDriftAlarmTransientRef.current = null;
      clearPendingTransientRefresh();
    };
    const scheduleTransientRefresh = (delayMs: number) => {
      clearPendingTransientRefresh();
      pendingDriftAlarmTransientRefreshRef.current = window.setTimeout(() => {
        pendingDriftAlarmTransientRefreshRef.current = 0;
        void refresh(selectedDay, { requireCurrentSnapshot: true });
      }, Math.max(0, delayMs));
    };
    if (!driftAlertsEnabled) {
      publishDriftAlarmTrayStatus({ kind: "disabled" }, null);
      pendingDriftAlarmGateRef.current = null;
      lastEligibleDriftCandidateRef.current = null;
      clearPendingTransientDriftAlarm();
      return;
    }
    if (selectedDay !== logicalTodayIsoDate(startOfDayMinutes)) {
      publishDriftAlarmTrayStatus({ kind: "not_today" }, checkedAt);
      pendingDriftAlarmGateRef.current = null;
      lastEligibleDriftCandidateRef.current = null;
      clearPendingTransientDriftAlarm();
      return;
    }
    if (!status?.running) {
      publishDriftAlarmTrayStatus({ kind: "tracker_paused" }, checkedAt);
      pendingDriftAlarmGateRef.current = null;
      lastEligibleDriftCandidateRef.current = null;
      clearPendingTransientDriftAlarm();
      return;
    }

    const systemTransientActivity = currentSnapshot?.systemTransientActivity ?? null;
    const driftCandidates = buildDriftAlarmCandidates({
      segments,
      currentSnapshot,
      classificationOptions: selectedDayClassificationOptions,
      minimumDurationSeconds: driftAlertDelaySeconds,
    });
    const liveDrift = driftCandidates[0] ?? null;
    if (liveDrift && systemTransientActivity === null) {
      lastEligibleDriftCandidateRef.current = liveDrift;
    }
    const latestDrift = liveDrift ?? (systemTransientActivity ? lastEligibleDriftCandidateRef.current : null);
    const activeSnooze = driftAlarmSnoozeRef.current;
    if (activeSnooze !== null) {
      pendingDriftAlarmGateRef.current = null;
      clearPendingTransientDriftAlarm();
      publishDriftAlarmTrayStatus({
        kind: "snoozed",
        detail: `Until ${formatTimeLabel(new Date(activeSnooze.untilMs))}`,
      }, checkedAt);
      if (Date.now() < activeSnooze.untilMs) return;
      return;
    }

    if (!latestDrift) {
      const pendingTransient = pendingDriftAlarmTransientRef.current;
      if (pendingTransient && systemTransientActivity) {
        publishDriftAlarmTrayStatus({
          kind: "deferred",
          reason: pendingTransient.systemTransientActivity,
          candidateDetail: pendingTransient.candidateDetail,
        }, checkedAt);
        scheduleTransientRefresh(Math.max(1_000, pendingTransient.readyAtMs - Date.now()));
        return;
      }
      publishDriftAlarmTrayStatus({ kind: "no_candidate" }, checkedAt);
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
        publishDriftAlarmTrayStatus({
          kind: "deferred",
          reason: transientDecision.pending.systemTransientActivity,
          candidateDetail,
        }, checkedAt);
        scheduleTransientRefresh(Math.max(1_000, transientDecision.pending.readyAtMs - Date.now()));
        return;
      case "await_delay":
        pendingDriftAlarmGateRef.current = null;
        pendingDriftAlarmTransientRef.current = transientDecision.pending;
        publishDriftAlarmTrayStatus({
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
        publishDriftAlarmTrayStatus({
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
    const buildCurrentDriftAlarmEvent = () => {
      const contextLabel = getWatcherContextLabel(segment, category);

      return buildDriftAlarmEvent({
        id: alertKey,
        contextLabel,
        driftDurationSeconds: segment.durationSeconds,
        preservedFocusStrikeSeconds: 0,
        generatedAt: new Date().toISOString(),
        focusTargets: recentDriftAlarmFocusTargets,
        copySettings: driftAlarmCopy,
        sourceSegmentId: latestDrift.sourceSegmentId ?? segment.id,
      });
    };
    const showCurrentDriftAlarm = () => {
      showDriftAlarm(buildCurrentDriftAlarmEvent());
    };
    const markCurrentDriftAlarmDelivered = () => {
      publishDriftAlarmTrayStatus({ kind: "delivered", candidateDetail }, checkedAt);
    };
    const showFallbackDriftAlarm = (notify: boolean) => {
      showCurrentDriftAlarm();
      markCurrentDriftAlarmDelivered();
      if (notify) void sendDriftNotification(segment, driftAlarmCopy);
    };
    const applyCurrentExtremeNudge = (notifyOnFallback: boolean) => {
      lastDriftAlertSegmentRef.current = alertKey;
      void applyNativeExtremeNudge(buildExtremeNudgeTarget(segment)).then((applied) => {
        if (!applied) {
          if (lastDriftAlertSegmentRef.current === alertKey) showFallbackDriftAlarm(notifyOnFallback);
          return;
        }
        const latestFocusTarget = recentDriftAlarmFocusTargets[0] ?? null;
        void showNativeExtremeNudgeToast(buildExtremeNudgeToastEvent(segment, latestFocusTarget, driftAlarmCopy)).catch((error) => console.warn("Failed to show extreme nudge toast", error));
        markCurrentDriftAlarmDelivered();
        if (latestFocusTarget) {
          window.setTimeout(() => {
            if (lastDriftAlertSegmentRef.current === alertKey) returnToFocusTarget(latestFocusTarget);
          }, 120);
        }
      }).catch((error) => {
        console.warn("Failed to apply extreme nudge", error);
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
        return "current-snapshot-unavailable";
      }

      setCurrentSnapshot(freshSnapshot);
      if (freshSnapshot?.systemTransientActivity) return "system-transient-active";

      const freshCandidate = resolveFreshDriftAlarmCandidate({
        candidate: latestDrift,
        segments,
        currentSnapshot: freshSnapshot,
        classificationOptions: selectedDayClassificationOptions,
        minimumDurationSeconds: driftAlertDelaySeconds,
      });
      return freshCandidate ? "confirmed" : freshSnapshot ? "current-window-changed" : "current-snapshot-unavailable";
    };

    const deliverCurrentDriftAlarm = () => {
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
          : recentDriftAlarmFocusTargets;
        const breakReturnContextLabel = getWatcherContextLabel(segment, category);

        showDriftAlarm(buildBreakReturnAlarmEvent({
          id: `break-return:${alertKey}:${pendingBreakReturnAlarm.untilMs}`,
          contextLabel: breakReturnContextLabel,
          driftDurationSeconds: segment.durationSeconds,
          preservedFocusStrikeSeconds: 0,
          generatedAt: new Date().toISOString(),
          focusTargets,
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

      if (lastDriftAlertSegmentRef.current === null) {
        if (extremeNudgeEnabled) {
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
        publishDriftAlarmTrayStatus({ kind: "already_delivered", candidateDetail }, checkedAt);
        return;
      }

      lastDriftAlertSegmentRef.current = alertKey;
      if (extremeNudgeEnabled) {
        applyCurrentExtremeNudge(true);
        return;
      }
      showCurrentDriftAlarm();
      markCurrentDriftAlarmDelivered();
      void sendDriftNotification(segment, driftAlarmCopy);
    };

    if (lastDriftAlertSegmentRef.current === alertKey && !pendingBreakReturnAlarmRef.current) {
      if (driftAlarmEventRef.current?.id === alertKey) {
        showCurrentDriftAlarm();
      }
      publishDriftAlarmTrayStatus({ kind: "already_delivered", candidateDetail }, checkedAt);
      return;
    }

    if (pendingDriftAlarmGateRef.current === alertKey) return;
    if (pendingDriftAlarmGateRef.current !== null && pendingDriftAlarmGateRef.current !== alertKey) {
      pendingDriftAlarmGateRef.current = null;
    }

    pendingDriftAlarmGateRef.current = alertKey;
    publishDriftAlarmTrayStatus({ kind: "checking", candidateDetail }, checkedAt);
    void evaluateYouTubeDriftAlarmGate({
      segment,
      category,
      aiOptions: localAiClassificationOptions,
    }).then(async (gateResult) => {
      if (pendingDriftAlarmGateRef.current !== alertKey) return;

      if (gateResult.kind === "suppress") {
        pendingDriftAlarmGateRef.current = null;
        lastDriftAlertSegmentRef.current = alertKey;
        publishDriftAlarmTrayStatus({
          kind: "suppressed",
          reason: gateResult.reason,
          candidateDetail,
        }, checkedAt);
        return;
      }

      const finalGateResult = await confirmFreshDriftAlarmCandidate();
      if (pendingDriftAlarmGateRef.current !== alertKey) return;
      pendingDriftAlarmGateRef.current = null;

      if (finalGateResult === "system-transient-active") return;

      if (finalGateResult !== "confirmed") {
        publishDriftAlarmTrayStatus({
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
      publishDriftAlarmTrayStatus({
        kind: "error",
        reason: error instanceof Error ? error.message : "AI gate failed",
      }, checkedAt);
    });
  }, [currentSnapshot, driftAlertDelaySeconds, driftAlertsEnabled, driftAlarmCopy, driftAlarmSnooze, extremeNudgeEnabled, localAiClassificationOptions, publishDriftAlarmTrayStatus, recentDriftAlarmFocusTargets, recordBreakRecoveryOutcome, returnToFocusTarget, selectedDay, selectedDayClassificationOptions, segments, showDriftAlarm, startOfDayMinutes, status?.running]);

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((v) => !v); }
      if (e.key === "Escape") setCmdOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!WATCHER_PEEK_PROTOTYPE_ENABLED) return;
    if (!watcherPeekEnabled) return;
    if (selectedDay !== todayIsoDate()) return;
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
  }, [selectedDay, showAiClassificationImpact, showWatcherPeek, status?.running, watcherMode, watcherPeekEnabled, watcherPeriodicMaxMinutes, watcherPeriodicMinMinutes]);

  const dashboardRange = useMemo(() => getDashboardPeriodRange(selectedDay, dashPeriod, startOfDayMinutes, startOfWeek), [dashPeriod, selectedDay, startOfDayMinutes, startOfWeek]);
  const dashboardSegments = useMemo(() => {
    const source = dashPeriod === "Today" ? segments : historySegments;
    return filterSegmentsForRange(source, dashboardRange.start, dashboardRange.end);
  }, [dashPeriod, dashboardRange.end, dashboardRange.start, historySegments, segments]);
  const dashboardClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: dashboardSegments, includeAiClassifications: showAiClassificationImpact }),
    [dashboardSegments, showAiClassificationImpact],
  );
  const dashboardActiveDays = useMemo(
    () => buildDailyTotals(dashboardSegments, dashboardRange.startDay, dashboardRange.endDay, startOfDayMinutes).filter((day) => day.totalSeconds > 0).length,
    [dashboardRange.endDay, dashboardRange.startDay, dashboardSegments, startOfDayMinutes],
  );
  const insightRange = useMemo(() => getInsightPeriodRange(selectedDay, startOfDayMinutes), [selectedDay, startOfDayMinutes]);
  const insightSegments = useMemo(
    () => filterSegmentsForRange(historySegments, insightRange.start, insightRange.end),
    [historySegments, insightRange.end, insightRange.start],
  );
  const insightClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: insightSegments, includeAiClassifications: showAiClassificationImpact }),
    [insightSegments, showAiClassificationImpact],
  );
  const productivityPersonaReport = useMemo(
    () => buildProductivityPersona(insightSegments, insightClassificationOptions),
    [insightClassificationOptions, insightSegments],
  );
  const historyClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: historySegments, includeAiClassifications: showAiClassificationImpact }),
    [historySegments, showAiClassificationImpact],
  );
  const leaderboardClassificationOptions = useMemo<ClassificationOptions>(
    () => ({ fallbackCandidates: leaderboardSegments, includeAiClassifications: showAiClassificationImpact }),
    [leaderboardSegments, showAiClassificationImpact],
  );
  const dashboardPeriodLabel = formatDashboardPeriodLabel(dashPeriod, dashboardRange.startDay, dashboardRange.endDay);
  const totalSeconds = useMemo(() => totalDurationSeconds(dashboardSegments), [dashboardSegments]);
  const activeDashboardAiUnavailablePreviewInput = useMemo(
    () => dashboardAiUnavailablePreview?.appliedDay === selectedDay
      ? buildDashboardAiUnavailablePreviewInput(dashboardAiUnavailablePreview.caseId)
      : null,
    [dashboardAiUnavailablePreview, selectedDay],
  );
  const dashboardAiUnavailableState = activeDashboardAiUnavailablePreviewInput
    ? resolveDashboardAiUnavailableState(activeDashboardAiUnavailablePreviewInput)
    : totalSeconds > 0
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
    ? `${dashPeriod}:${selectedDay}:${dashboardAiUnavailableState.variant}`
    : null;
  const dashboardAiRecoveryState = dashboardAiRecoveryKey !== null && dismissedDashboardAiRecoveryKey !== dashboardAiRecoveryKey
    ? dashboardAiUnavailableState
    : null;
  const updateDialogBlocked = Boolean(
    dashboardAiRecoveryState
    || authModalOpen
    || feedbackModalOpen
    || aiSetupDialogOpen
    || onboardingOpen
    || selectedLeaderboardRow
    || isProfileEditorOpen
    || cmdOpen,
  );
  const visibleUpdate = updateDialogBlocked ? null : availableUpdate;
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
    if (selectedDay !== todayIsoDate()) return;

    const client = trackerClient as Partial<typeof trackerClient>;
    if (typeof client.updateTrayProductivityIcon !== "function") return;
    void client.updateTrayProductivityIcon(trayProductivityMix).catch(() => undefined);
  }, [hasLoadedOnce, selectedDay, shouldBlockLocalTrackerAccess, startOfDayMinutes, trayProductivityMix]);
  useEffect(() => {
    const client = trackerClient as Partial<typeof trackerClient>;
    if (typeof client.updateTrayDriftAlarmStatus !== "function") return;
    void client.updateTrayDriftAlarmStatus(driftAlarmTrayStatus).catch(() => undefined);
  }, [driftAlarmTrayStatus]);
  const dashboardAppUsage = useMemo(() => buildAppUsageSummaries(dashboardSegments, { limit: 6 }), [dashboardSegments]);
  const dashboardTopApps = useMemo(() => buildAppUsageSummaries(dashboardSegments, { limit: 1, groupBy: "app" }), [dashboardSegments]);
  const dayField = useMemo(() => buildQuarterHourDayField(segments, selectedDay, startOfDayMinutes), [segments, selectedDay, startOfDayMinutes]);
  const selectedDayLabel = formatDayLabel(selectedDay);
  const aiClassificationUsageDayLabel = formatDayLabel(aiClassificationUsageDay ?? selectedDay);
  const aiClassificationCostProjection = useMemo(
    () => projectAiClassificationCost(aiClassificationUsage, classificationMetrics),
    [aiClassificationUsage, classificationMetrics],
  );
  const selectedDayContext = describeRelativeDay(selectedDay, startOfDayMinutes);
  const classificationWeekRange = useMemo(() => getDashboardPeriodRange(selectedDay, "Week", startOfDayMinutes, startOfWeek), [selectedDay, startOfDayMinutes, startOfWeek]);
  const classificationSegments = useMemo(() => (
    classificationRange === "Week"
      ? filterSegmentsForRange(historySegments, classificationWeekRange.start, classificationWeekRange.end)
      : segments
  ), [classificationRange, classificationWeekRange.end, classificationWeekRange.start, historySegments, segments]);
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
  const dashboardTitle =
    selectedDayContext === "Today"
      ? `Good ${getDayPart()}.`
      : selectedDayContext === "Yesterday"
        ? selectedDayContext
        : selectedDayLabel;
  const lastCaptureDistanceLabel = status?.lastEventAt ? formatRelativeTime(status.lastEventAt) : "No captures yet";
  const uniqueAppsCount = useMemo(() => new Set(dashboardSegments.map((s) => s.bundleId ?? s.appName)).size, [dashboardSegments]);
  const averageSessionMinutes = dashboardSegments.length > 0 ? Math.round(totalSeconds / 60 / dashboardSegments.length) : 0;
  const topApp = dashboardTopApps[0];
  const topAppLabel = topApp?.appName ?? "No activity";
  const liveAppLabel = status?.running && currentSnapshot?.appName ? currentSnapshot.appName : topAppLabel;
  const liveSiteLabel = status?.running ? (currentSnapshot?.siteDomain || currentSnapshot?.siteTitle || null) : null;
  const hasTimelineData = segments.length > 0;
  const isBootstrappingTracker = loading && status === null;
  const trackerModeLabel = status?.trackerMode ?? "unknown";
  const isTrackerUnavailable = !status || trackerModeLabel === "unavailable";
  const isDemoMode = trackerModeLabel === "demo" || status?.databasePath === "/tmp/drifty-demo.sqlite3";
  const isTrackerIdle = status?.running === true && trackerModeLabel === "idle";
  const trackerStateLabel = isBootstrappingTracker ? "Loading" : isTrackerUnavailable ? "Tracker unavailable" : status.running ? (isTrackerIdle ? "Idle due to inactivity" : isDemoMode ? "Preview active" : "Tracking live") : (isDemoMode ? "Preview paused" : "Tracking paused");
  const trackerActionLabel = isTrackerUnavailable ? "Tracker unavailable" : status.running ? "Pause tracking" : "Resume tracking";

  const activeSlots = dayField.filter((slot) => slot.totalSeconds > 0);
  const activeHours = Array.from(new Set(activeSlots.map((slot) => slot.hour)));
  const activeHourCount = activeHours.length;
  const peakSlot = dayField.reduce((cur, slot) => (slot.totalSeconds > cur.totalSeconds ? slot : cur), dayField[0]);
  const peakTrackedSeconds = peakSlot?.totalSeconds ?? 0;
  const peakWindowLabel = peakTrackedSeconds > 0 ? formatQuarterHourLabel(peakSlot.minuteOfDay) : "\u2014";
  const todayDay = logicalTodayIsoDate(startOfDayMinutes);
  const isTodaySelected = selectedDay === todayDay;
  const isCurrentClassificationRange = classificationRange === "Week"
    ? classificationWeekRange.startDay <= todayDay && todayDay <= classificationWeekRange.endDay
    : isTodaySelected;
  const rawNextClassificationDay = shiftIsoDate(selectedDay, classificationRange === "Week" ? 7 : 1);
  const canShiftClassificationForward = classificationRange === "Week"
    ? getDashboardPeriodRange(rawNextClassificationDay, "Week", startOfDayMinutes, startOfWeek).startDay <= todayDay
    : rawNextClassificationDay <= todayDay;
  const classificationDateContext = classificationRange === "Week" ? "Selected week" : selectedDayContext;
  const classificationDateLabel = classificationRange === "Week" ? formatDateRangeLabel(classificationWeekRange.startDay, classificationWeekRange.endDay) : selectedDayLabel;
  const isCurrentDashboardPeriod = dashPeriod === "Week"
    ? dashboardRange.startDay <= todayDay && todayDay <= dashboardRange.endDay
    : isTodaySelected;
  const nextDashboardDay = shiftDashboardPeriodDay(selectedDay, dashPeriod, 1);
  const canShiftDashboardForward = dashPeriod === "Week"
    ? getDashboardPeriodRange(nextDashboardDay, dashPeriod, startOfDayMinutes, startOfWeek).startDay <= todayDay
    : nextDashboardDay <= todayDay;
  const nextInsightDay = shiftDashboardPeriodDay(selectedDay, "Week", 1);
  const canShiftInsightForward = nextInsightDay <= todayDay;
  const dashboardDateContext = dashPeriod === "Week" ? "Selected week" : selectedDayContext;
  const dashboardDateLabel = dashPeriod === "Week" ? formatDateRangeLabel(dashboardRange.startDay, dashboardRange.endDay) : selectedDayLabel;
  const insightDateLabel = formatDateRangeLabel(insightRange.startDay, insightRange.endDay);
  const liveClock = isTodaySelected ? new Date() : null;
  const currentMinuteOfDay = liveClock ? liveClock.getHours() * 60 + liveClock.getMinutes() : null;
  const shouldShowEndOfDayReviewPreview = END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED && import.meta.env.VITE_DRIFTY_END_OF_DAY_REVIEW_PREVIEW === "1";

  useEffect(() => {
    if (!END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED) return;
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
  }, [buildEndOfDayReviewEvent, hasLoadedOnce, showEndOfDayReview, shouldShowEndOfDayReviewPreview, todayDay]);

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

  const insightCategoryTotals = useMemo(() => buildCategoryDurations(insightSegments, insightClassificationOptions), [insightClassificationOptions, insightSegments]);
  const activeInsightCategoryTotals = useMemo(
    () => insightCategoryTotals.filter((entry) => entry.totalSeconds > 0).sort((left, right) => right.totalSeconds - left.totalSeconds),
    [insightCategoryTotals],
  );
  const insightProductivityTotals = useMemo(() => buildProductivityDurations(insightSegments, insightClassificationOptions), [insightClassificationOptions, insightSegments]);
  const activeInsightProductivityTotals = useMemo(() => insightProductivityTotals.filter((entry) => entry.totalSeconds > 0), [insightProductivityTotals]);
  const weeklyBreakdown = useMemo(
    () => buildWeeklyBreakdown(insightSegments, insightClassificationOptions, { visibleThroughDay: insightRange.endDay }),
    [insightClassificationOptions, insightRange.endDay, insightSegments],
  );
  const attentionRhythm = useMemo(
    () => buildAttentionRhythm(insightSegments, insightClassificationOptions, { visibleThroughDay: insightRange.endDay }),
    [insightClassificationOptions, insightRange.endDay, insightSegments],
  );
  const driftSourceLists = useMemo(
    () => buildInsightSourceLists(insightSegments, "drift", insightClassificationOptions),
    [insightClassificationOptions, insightSegments],
  );
  const focusSourceLists = useMemo(
    () => buildInsightSourceLists(insightSegments, "focus", insightClassificationOptions),
    [insightClassificationOptions, insightSegments],
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
  const flowBlocks = useMemo(() => buildFlowBlocks(segments, selectedDay, flowIntervalMinutes, selectedDayClassificationOptions, startOfDayMinutes), [flowIntervalMinutes, selectedDayClassificationOptions, segments, selectedDay, startOfDayMinutes]);
  const dashboardCategoryTotals = useMemo(() => buildCategoryDurations(dashboardSegments, dashboardClassificationOptions), [dashboardClassificationOptions, dashboardSegments]);
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
    setExpandedClassificationActivityRows(new Set());
  }, [classificationRange, selectedDay, effectiveClassifyCategoryId, effectiveClassifySourceId]);
  const classificationTopApp = useMemo(() => buildAppUsageSummaries(classificationSegments, { limit: 1, groupBy: "app" })[0] ?? null, [classificationSegments]);
  const classificationTopAppLabel = classificationTopApp?.appName ?? "No activity";
  const dashboardProductivityTotals = useMemo(() => buildProductivityDurations(dashboardSegments, dashboardClassificationOptions), [dashboardClassificationOptions, dashboardSegments]);
  const dashboardFocusSeconds = dashboardProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const previousWeekFocusSeconds = useMemo(() => buildRollingFocusSeconds(historySegments, shiftIsoDate(dashboardRange.startDay, -7), shiftIsoDate(dashboardRange.startDay, -1), historyClassificationOptions, startOfDayMinutes), [dashboardRange.startDay, historyClassificationOptions, historySegments, startOfDayMinutes]);
  const weekFocusDeltaPercent = previousWeekFocusSeconds > 0 ? Math.round(((dashboardFocusSeconds - previousWeekFocusSeconds) / previousWeekFocusSeconds) * 100) : null;
  const weekRows = useMemo(() => buildWeekDayRows(dashboardSegments, dashboardRange.startDay, dashboardRange.endDay, dashboardClassificationOptions, startOfDayMinutes), [dashboardClassificationOptions, dashboardRange.endDay, dashboardRange.startDay, dashboardSegments, startOfDayMinutes]);
  const focusDriftChart = useMemo(
    () => buildFocusDriftChart(segments, selectedDay, selectedDayClassificationOptions, currentMinuteOfDay, startOfDayMinutes),
    [currentMinuteOfDay, selectedDayClassificationOptions, segments, selectedDay, startOfDayMinutes],
  );
  const focusDriftLiveStyle = focusDriftChart.currentX !== null
    ? { "--focus-drift-now-x": `${focusDriftChart.currentX}%` } as FocusDriftLiveStyle
    : undefined;
  const focusDriftHoverPoints = focusDriftChart.points.filter((point) => point.totalSeconds > 0 && !point.isFuture);
  function updateFocusDriftLineHover(event: MouseEvent<SVGRectElement>) {
    const svgRect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!svgRect || focusDriftHoverPoints.length === 0) return;

    const chartX = ((event.clientX - svgRect.left) / svgRect.width) * 100;
    const chartY = ((event.clientY - svgRect.top) / svgRect.height) * 100;
    const firstPoint = focusDriftHoverPoints[0];
    const lastPoint = focusDriftHoverPoints[focusDriftHoverPoints.length - 1];
    const hoverX = Math.min(Math.max(chartX, firstPoint.x), lastPoint.x);

    const rightIndex = focusDriftHoverPoints.findIndex((point) => point.x >= hoverX);
    const nextPoint = focusDriftHoverPoints[rightIndex] ?? lastPoint;
    const previousPoint = focusDriftHoverPoints[Math.max(0, rightIndex - 1)] ?? firstPoint;
    const span = Math.max(nextPoint.x - previousPoint.x, 0.0001);
    const ratio = Math.min(Math.max((hoverX - previousPoint.x) / span, 0), 1);
    const focusY = previousPoint.focusY + (nextPoint.focusY - previousPoint.focusY) * ratio;
    const driftY = previousPoint.driftY + (nextPoint.driftY - previousPoint.driftY) * ratio;
    const focusDistance = Math.abs(chartY - focusY);
    const driftDistance = Math.abs(chartY - driftY);
    const kind: FocusDriftHoverKind = focusDistance <= driftDistance ? "focus" : "drift";
    const distance = Math.min(focusDistance, driftDistance);
    const nearestPoint = Math.abs(previousPoint.x - hoverX) <= Math.abs(nextPoint.x - hoverX) ? previousPoint : nextPoint;

    if (distance > 24) {
      setFocusDriftHover(null);
      return;
    }

    setFocusDriftHover({ point: nearestPoint, kind, x: event.clientX, y: event.clientY });
  }
  const leaderboardWindowEndDay = logicalTodayIsoDate(startOfDayMinutes);
  const leaderboardWindowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, activeLeaderboardPeriod);
  const localRollingFocusSeconds = useMemo(
    () => buildRollingFocusSeconds(leaderboardSegments, leaderboardWindowStartDay, leaderboardWindowEndDay, leaderboardClassificationOptions, startOfDayMinutes),
    [leaderboardClassificationOptions, leaderboardSegments, leaderboardWindowEndDay, leaderboardWindowStartDay, startOfDayMinutes],
  );
  const leaderboardProfileDisplayName = useMemo(() => profile?.display_name || fallbackDisplayName(user?.email), [profile?.display_name, user?.email]);
  const leaderboardUsesPreviewProfile = shouldUsePreviewData();
  const leaderboardProfileBio = profile?.bio || profileDraft.bio || (leaderboardUsesPreviewProfile ? "Building quiet tools for deeper work." : "");
  const leaderboardProfileWebsiteUrl = profile?.website_url || profileDraft.websiteUrl || (leaderboardUsesPreviewProfile ? "drifty.so/drifty" : "");
  const leaderboardProfileGithubUrl = profile?.github_url || profileDraft.githubUrl || (leaderboardUsesPreviewProfile ? "github.com/edgethink00" : "");
  const leaderboardProfileLinkedinUrl = profile?.linkedin_url || profileDraft.linkedinUrl || (leaderboardUsesPreviewProfile ? "linkedin.com/in/drifty" : "");
  const leaderboardTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const isLeaderboardOptedIn = ownLeaderboardEntry?.opted_in === true;

  const refreshLeaderboardData = useCallback(async () => {
    const requestId = ++leaderboardRefreshRequestRef.current;

    if (!isSupabaseConfigured && !shouldUsePreviewData()) {
      setLeaderboardRows([]);
      setOwnLeaderboardEntry(null);
      setLeaderboardSegments([]);
      setLeaderboardLoading(false);
      setLeaderboardError(null);
      return;
    }

    setLeaderboardLoading(true);
    setLeaderboardError(null);

    try {
      const [globalResult, ownResult, leaderboardTimeline] = await Promise.all([
        fetchGlobalLeaderboard(activeLeaderboardPeriod, 100),
        user ? fetchOwnLeaderboardEntry(activeLeaderboardPeriod) : Promise.resolve({ success: true, error: null, data: null }),
        trackerClient.getTimeline(getLogicalDayRange(leaderboardWindowStartDay, leaderboardWindowEndDay, startOfDayMinutes)),
      ]);

      if (leaderboardRefreshRequestRef.current !== requestId) return;

      if (!globalResult.success) {
        setLeaderboardRows([]);
        setOwnLeaderboardEntry(null);
        setLeaderboardSegments([]);
        setLeaderboardError(globalResult.error ?? "Unable to load leaderboard");
        return;
      }

      if (!ownResult.success) {
        setLeaderboardRows(globalResult.data ?? []);
        setOwnLeaderboardEntry(null);
        setLeaderboardSegments(leaderboardTimeline);
        setLeaderboardError(ownResult.error ?? "Unable to load your leaderboard status");
        return;
      }

      setLeaderboardRows(globalResult.data ?? []);
      setOwnLeaderboardEntry(ownResult.data ?? null);
      setLeaderboardSegments(leaderboardTimeline);
    } catch (nextError) {
      if (leaderboardRefreshRequestRef.current !== requestId) return;
      setLeaderboardRows([]);
      setOwnLeaderboardEntry(null);
      setLeaderboardSegments([]);
      setLeaderboardError(toErrorMessage(nextError));
    } finally {
      if (leaderboardRefreshRequestRef.current === requestId) setLeaderboardLoading(false);
    }
  }, [activeLeaderboardPeriod, isSupabaseConfigured, leaderboardWindowEndDay, leaderboardWindowStartDay, user]);

  useEffect(() => {
    if (!isSupabaseConfigured && !shouldUsePreviewData()) {
      setLeaderboardRows([]);
      setOwnLeaderboardEntry(null);
      setLeaderboardSegments([]);
      setLeaderboardLoading(false);
      setLeaderboardError(null);
      return;
    }

    if (activeTab !== "leaderboard") return;

    void refreshLeaderboardData();
  }, [activeTab, isSupabaseConfigured, refreshLeaderboardData]);

  const handleDeleteHistorySegments = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0 || historyDeleting) return;

    setHistoryDeleting(true);
    try {
      await trackerClient.deleteActivitySegments(ids);
      await refresh(selectedDayRef.current);
    } finally {
      setHistoryDeleting(false);
    }
  }, [historyDeleting, refresh]);

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
    if (aiClassificationInFlightRef.current) return;

    const today = todayIsoDate();
    const isFocused = rendererFocusedRef.current;
    const threshold = isFocused ? AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD : AI_CLASSIFICATION_BACKGROUND_THRESHOLD;
    if (isFocused && Date.now() - lastRendererInteractionAtRef.current < AI_CLASSIFICATION_FOCUSED_IDLE_MS) return;

    aiClassificationInFlightRef.current = true;
    try {
      const query = toClassificationQueryForDay(today, threshold);
      const summary = localAiClassificationOptions
        ? await runAiClassificationForUnknownThreshold(query, threshold, localAiClassificationOptions)
        : await runAiClassificationForUnknownThreshold(query, threshold);
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
      if (summary.savedRecords > 0) await refreshLeaderboardData();
    } catch (nextError) {
      if (selectedDayRef.current === today) {
        setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message: toErrorMessage(nextError) });
        setObservedAiClassificationFailure(true);
      }
    } finally {
      aiClassificationInFlightRef.current = false;
    }
  }, [canUseCloudAiClassification, classificationActionLoading, hasLoadedOnce, localAiClassificationOptions, refreshLeaderboardData, rendererFocused, selectedDay, shouldBlockLocalTrackerAccess]);

  useEffect(() => {
    void runAutoAiClassificationBatch();
    const intervalId = setInterval(() => {
      void runAutoAiClassificationBatch();
    }, 30000);
    return () => clearInterval(intervalId);
  }, [runAutoAiClassificationBatch]);

  useEffect(() => {
    if (authStatus === "authenticated" && (!isEffectiveAuthRequired || hasRequiredAccountAuth)) {
      setAuthModalOpen(false);
    }
  }, [authStatus, hasRequiredAccountAuth, isEffectiveAuthRequired]);

  const refreshBillingEntitlement = useCallback(async (): Promise<BillingEntitlement | null> => {
    if (!shouldCheckBillingEntitlement) {
      setBillingEntitlement(null);
      setBillingEntitlementLoading(false);
      setBillingEntitlementError(null);
      return null;
    }

    const requestId = ++billingEntitlementRequestRef.current;
    setBillingEntitlementLoading(true);
    setBillingEntitlementError(null);
    const result = await fetchBillingEntitlement();
    if (requestId !== billingEntitlementRequestRef.current) return null;
    if (result.success) {
      setBillingEntitlement(result.data);
      setBillingEntitlementLoading(false);
      return result.data;
    } else {
      setBillingEntitlementError(result.error);
    }
    setBillingEntitlementLoading(false);
    return null;
  }, [shouldCheckBillingEntitlement]);

  const handleStartDriftyCloudSetup = useCallback(async (billingInterval: BillingInterval = "monthly") => {
    if (!isSupabaseConfigured) {
      setAuthModalOpen(true);
      return;
    }

    if (!user || !hasRequiredAccountAuth) {
      await signInWithWebsite();
      return;
    }

    if (billingEntitlement?.status === "locked") {
      setBillingEntitlementError(null);
      setBillingCheckoutLoadingInterval(billingInterval);
      try {
        const checkoutResult = await createIndividualCheckout(billingInterval);
        if (!checkoutResult.success) {
          setBillingEntitlementError(checkoutResult.error);
          return;
        }

        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(checkoutResult.data.url);
      } catch (error) {
        setBillingEntitlementError(toErrorMessage(error));
      } finally {
        setBillingCheckoutLoadingInterval(null);
      }
      return;
    }

    void refreshBillingEntitlement();
  }, [billingEntitlement?.status, hasRequiredAccountAuth, isSupabaseConfigured, refreshBillingEntitlement, signInWithWebsite, user]);

  const handleDashboardAiUnavailableAction = useCallback((variant: DashboardAiUnavailableVariant) => {
    void variant;
    setSettingsSection("aiSetup");
    navigateToTab("settings");
  }, [navigateToTab]);

  const handleDismissDashboardAiRecovery = useCallback(() => {
    if (dashboardAiRecoveryKey === null) return;
    setDismissedDashboardAiRecoveryKey(dashboardAiRecoveryKey);
  }, [dashboardAiRecoveryKey]);

  useEffect(() => {
    let cancelled = false;

    if (!shouldCheckBillingEntitlement) {
      billingEntitlementRequestRef.current += 1;
      setBillingEntitlement(null);
      setBillingEntitlementLoading(false);
      setBillingEntitlementError(null);
      return undefined;
    }

    const requestId = ++billingEntitlementRequestRef.current;
    setBillingEntitlementLoading(true);
    setBillingEntitlementError(null);
    void fetchBillingEntitlement().then((result) => {
      if (cancelled) return;
      if (requestId !== billingEntitlementRequestRef.current) return;
      if (result.success) {
        setBillingEntitlement(result.data);
      } else {
        setBillingEntitlement(null);
        setBillingEntitlementError(result.error);
      }
    }).finally(() => {
      if (!cancelled && requestId === billingEntitlementRequestRef.current) setBillingEntitlementLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [shouldCheckBillingEntitlement, user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || (isEffectiveAuthRequired && !hasRequiredAccountAuth)) {
      const displayName = fallbackDisplayName(user?.email);
      setProfile(null);
      setProfileDraft({ displayName, bio: "", avatarUrl: authMetadataAvatarUrl, websiteUrl: "", githubUrl: "", linkedinUrl: "", isPublic: true });
      setProfileLoading(false);
      setProfileReadyUserId(user?.id ?? null);
      setProfileError(null);
      setProfileMessage(null);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);
    setProfileReadyUserId(null);
    setProfileError(null);
    void fetchOwnProfile().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        const displayName = fallbackDisplayName(user.email);
        setProfile(null);
        setProfileDraft({ displayName, bio: "", avatarUrl: authMetadataAvatarUrl, websiteUrl: "", githubUrl: "", linkedinUrl: "", isPublic: true });
        setProfileError(result.error ?? "Unable to load profile");
      } else {
        const nextProfile = result.data ?? null;
        setProfile(nextProfile);
        setProfileDraft({
          displayName: nextProfile?.display_name ?? fallbackDisplayName(user.email),
          bio: nextProfile?.bio ?? "",
          avatarUrl: nextProfile?.avatar_url || authMetadataAvatarUrl,
          websiteUrl: nextProfile?.website_url ?? "",
          githubUrl: nextProfile?.github_url ?? "",
          linkedinUrl: nextProfile?.linkedin_url ?? "",
          isPublic: true,
        });
      }
    }).finally(() => {
      if (!cancelled) {
        setProfileLoading(false);
        setProfileReadyUserId(user.id);
      }
    });

    return () => { cancelled = true; };
  }, [authMetadataAvatarUrl, hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, user?.email, user?.id]);

  useEffect(() => {
    if (isDevOnboardingBypassEnabled()) {
      setOnboardingOpen(false);
      return;
    }

    if (authStatus === "loading") {
      setOnboardingOpen(false);
      return;
    }

    if (developerAuthRequiredPreview && !hasRequiredAccountAuth) {
      setOnboardingOpen(false);
      return;
    }

    if (authStatus === "authenticated") {
      if (!user?.id) {
        setOnboardingOpen(false);
        return;
      }

      if (profileReadyUserId !== user.id) {
        setOnboardingOpen(false);
        return;
      }

      setOnboardingOpen(!hasCompletedUserOnboarding(user.id));
      return;
    }

    setOnboardingOpen(!hasCompletedUserOnboarding("local"));
  }, [authStatus, developerAuthRequiredPreview, hasRequiredAccountAuth, profileReadyUserId, user?.id]);

  function handleOnboardingComplete(state: UserOnboardingState) {
    const displayName = state.displayName.trim();
    if (displayName) {
      setProfileDraft((draft) => ({ ...draft, displayName }));
    }
    setDriftAlertsEnabled(state.driftAlarmEnabled);
    setExtremeNudgeEnabled(state.extremeNudgeEnabled);
    setOnboardingOpen(false);
  }

  async function handleOpenDeveloperOnboarding() {
    await refresh();
    setOnboardingOpen(true);
  }

  function handleDeveloperAuthRequiredPreview() {
    setDeveloperAuthRequiredPreview(true);
    setAuthModalOpen(true);
    if (user) {
      void signOut();
    }
  }

  async function handleStartTracking() {
    setError(null);
    try {
      await trackerClient.start();
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }

  async function handleStartTrackingFromOnboarding() {
    setError(null);
    try {
      await trackerClient.start();
      await refresh();
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      throw new Error(message);
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
      await trackerClient.stop();
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e));
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
      setClassificationSummary({ status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Sign in or configure local AI to run AI classification." });
      return;
    }

    if (aiClassificationInFlightRef.current) return;

    const executionUsageDay = todayIsoDate();
    aiClassificationInFlightRef.current = true;
    setClassificationActionLoading(true);
    setClassificationSummary({ status: "running", selectedSegments: 0, savedRecords: 0, message: "Running AI classification..." });
    try {
      const usageBefore = await loadAiClassificationUsage(executionUsageDay);
      const summary = localAiClassificationOptions
        ? await runAiClassification(toClassificationQueryForDay(selectedDay), undefined, localAiClassificationOptions)
        : await runAiClassification(toClassificationQueryForDay(selectedDay));
      setClassificationSummary(summary);
      setObservedAiClassificationFailure(summary.status === "error");
      if (summary.metrics) setClassificationMetrics(summary.metrics);
      const nextUsage = await resolveAiClassificationUsageFromExecutionDelta(executionUsageDay, usageBefore);
      if (summary.savedRecords > 0) {
        await refresh(selectedDay);
        await refreshLeaderboardData();
      }
      setAiClassificationUsageMeasurement(executionUsageDay, nextUsage);
    } catch (nextError) {
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message: toErrorMessage(nextError) });
      setObservedAiClassificationFailure(true);
    } finally {
      aiClassificationInFlightRef.current = false;
      setClassificationActionLoading(false);
    }
  }

  async function handleRunSelectedDayAiClassification() {
    if (!canUseCloudAiClassification && !localAiClassificationOptions) {
      setClassificationSummary({ status: "disabled", selectedSegments: 0, savedRecords: 0, message: "Sign in or configure local AI to run AI classification." });
      return;
    }

    const targetDay = selectedDay;
    if (aiClassificationInFlightRef.current) return;

    const executionUsageDay = todayIsoDate();
    aiClassificationInFlightRef.current = true;
    setClassificationActionLoading(true);
    setClassificationSummary({ status: "running", selectedSegments: 0, savedRecords: 0, message: `Classifying all unclassified activity for ${formatDayLabel(targetDay)}...` });
    try {
      const usageBefore = await loadAiClassificationUsage(executionUsageDay);
      const summary = localAiClassificationOptions
        ? await runAiClassificationUntilEmpty(toClassificationQueryForDay(targetDay), undefined, localAiClassificationOptions)
        : await runAiClassificationUntilEmpty(toClassificationQueryForDay(targetDay));
      setClassificationSummary({
        ...summary,
        message: `${summary.message} Target: ${formatDayLabel(targetDay)}.`,
      });
      setObservedAiClassificationFailure(summary.status === "error");
      if (summary.metrics) setClassificationMetrics(summary.metrics);
      const nextUsage = await resolveAiClassificationUsageFromExecutionDelta(executionUsageDay, usageBefore);
      if (summary.savedRecords > 0) {
        await refresh(targetDay);
        await refreshLeaderboardData();
      }
      setAiClassificationUsageMeasurement(executionUsageDay, nextUsage);
    } catch (nextError) {
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message: toErrorMessage(nextError) });
      setObservedAiClassificationFailure(true);
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
      await refreshLeaderboardData();
    } catch (nextError) {
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message: toErrorMessage(nextError) });
    } finally {
      setClassificationActionLoading(false);
    }
  }

  async function handleLeaderboardOptIn() {
    setLeaderboardActionLoading(true);
    setLeaderboardActionError(null);
    setProfileError(null);

    try {
      if (isEffectiveAuthRequired && !hasRequiredAccountAuth) {
        setAuthModalOpen(true);
        setLeaderboardActionError("Sign in with a drifty.so account before joining the beta leaderboard.");
        return;
      }

      if (!user) {
        if (!allowsEffectiveAnonymousAuth) {
          setAuthModalOpen(true);
          setLeaderboardActionError("Sign in before joining the beta leaderboard.");
          return;
        }

        const anonymousResult = await signInAnonymously();
        if (anonymousResult.error || !anonymousResult.user) {
          setLeaderboardActionError(anonymousResult.error?.message ?? "Unable to join leaderboard without a beta session.");
          return;
        }
      }

      const profileResult = await saveOwnProfile({
        display_name: profileDraft.displayName,
        bio: profileDraft.bio,
        avatar_url: profileDraft.avatarUrl,
        website_url: profileDraft.websiteUrl,
        github_url: profileDraft.githubUrl,
        linkedin_url: profileDraft.linkedinUrl,
        timezone: leaderboardTimezone,
        is_public: true,
      });

      if (!profileResult.success || !profileResult.data) {
        setLeaderboardActionError(profileResult.error ?? "Unable to prepare public profile");
        if (profileResult.error === "Not authenticated") setAuthModalOpen(true);
        return;
      }

      const nextProfile = profileResult.data;
      setProfile(nextProfile);
      setProfileDraft({
        displayName: nextProfile.display_name,
        bio: nextProfile.bio,
        avatarUrl: nextProfile.avatar_url,
        websiteUrl: nextProfile.website_url,
        githubUrl: nextProfile.github_url,
        linkedinUrl: nextProfile.linkedin_url,
        isPublic: true,
      });

      const allPeriodWindowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, "monthly");
      const allPeriodSegments = await trackerClient.getTimeline(getLogicalDayRange(allPeriodWindowStartDay, leaderboardWindowEndDay, startOfDayMinutes));
      const publishResults = await Promise.all(LEADERBOARD_PERIODS.map((period) => {
        const windowStartDay = getLeaderboardWindowStartDay(leaderboardWindowEndDay, period);
        const focusSeconds = buildRollingFocusSeconds(allPeriodSegments, windowStartDay, leaderboardWindowEndDay, {
          fallbackCandidates: allPeriodSegments,
          includeAiClassifications: showAiClassificationImpact,
        }, startOfDayMinutes);
        return publishOwnFocusTotal({
          profileDisplayName: nextProfile.display_name,
          period,
          focus_seconds: focusSeconds,
          focus_seconds_7d: focusSeconds,
          window_start_date: windowStartDay,
          window_end_date: leaderboardWindowEndDay,
          timezone: leaderboardTimezone,
        });
      }));
      const result = publishResults.find((nextResult) => !nextResult.success) ?? publishResults[0];

      if (!result.success) {
        setLeaderboardActionError(result.error ?? "Unable to join leaderboard");
        if (result.error === "Not authenticated") setAuthModalOpen(true);
        return;
      }

      await refreshLeaderboardData();
    } catch (nextError) {
      setLeaderboardActionError(toErrorMessage(nextError));
    } finally {
      setLeaderboardActionLoading(false);
    }
  }

  async function handleLeaderboardOptOut() {
    setLeaderboardActionLoading(true);
    setLeaderboardActionError(null);

    try {
      const optOutResults = await Promise.all(LEADERBOARD_PERIODS.map((period) => optOutLeaderboard(period)));
      const result = optOutResults.find((nextResult) => !nextResult.success) ?? optOutResults[0];
      if (!result.success) {
        setLeaderboardActionError(result.error ?? "Unable to leave leaderboard");
        return;
      }

      await refreshLeaderboardData();
    } catch (nextError) {
      setLeaderboardActionError(toErrorMessage(nextError));
    } finally {
      setLeaderboardActionLoading(false);
    }
  }

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileMessage(null);
    setProfileError(null);

    try {
      const result = await saveOwnProfile({
        display_name: profileDraft.displayName,
        bio: profileDraft.bio,
        avatar_url: profileDraft.avatarUrl,
        website_url: profileDraft.websiteUrl,
        github_url: profileDraft.githubUrl,
        linkedin_url: profileDraft.linkedinUrl,
        timezone: leaderboardTimezone,
        is_public: true,
      });

      if (!result.success || !result.data) {
        setProfileError(result.error ?? "Unable to save profile");
        return false;
      }

      setProfile(result.data);
      setProfileDraft({
        displayName: result.data.display_name,
        bio: result.data.bio,
        avatarUrl: result.data.avatar_url,
        websiteUrl: result.data.website_url,
        githubUrl: result.data.github_url,
        linkedinUrl: result.data.linkedin_url,
        isPublic: true,
      });
      setProfileMessage("Profile saved.");
      if (activeTab === "leaderboard") await refreshLeaderboardData();
      return true;
    } catch (nextError) {
      setProfileError(toErrorMessage(nextError));
      return false;
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleSaveProfileFromModal() {
    const saved = await handleSaveProfile();
    if (saved) setIsProfileEditorOpen(false);
  }

  async function handleProfilePhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setProfileError("Choose an image file for your profile photo.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setProfileError("Profile photo must be under 2 MB.");
      return;
    }

    try {
      const avatarUrl = await readImageFileAsDataUrl(file);
      setProfileError(null);
      setProfileMessage(null);
      setProfileDraft((draft) => ({ ...draft, avatarUrl, isPublic: true }));
    } catch (nextError) {
      setProfileError(toErrorMessage(nextError));
    }
  }

  async function handleShareLeaderboardProfile() {
    const publicId = profile?.public_id?.trim();
    if (!publicId) {
      setProfileShareMessage("Save or join first to create your public profile link.");
      return;
    }

    try {
      await copyTextToClipboard(buildPublicProfileUrl(publicId));
      setProfileShareMessage("Copied to clipboard.");
      window.setTimeout(() => setProfileShareMessage(null), 2200);
    } catch (nextError) {
      setProfileShareMessage(toErrorMessage(nextError));
    }
  }

  const totalLeaderboardFocusSeconds = useMemo(
    () => leaderboardRows.reduce((sum, row) => sum + Math.max(0, row.focus_seconds_7d), 0),
    [leaderboardRows],
  );

  async function handleSelectLeaderboardProfile(row: LeaderboardRow) {
    setSelectedLeaderboardRow(row);
    setSelectedPublicProfile(null);
    setSelectedProfileError(null);

    if (!row.public_id) {
      setSelectedProfileLoading(false);
      return;
    }

    setSelectedProfileLoading(true);
    try {
      const result = await fetchPublicProfile(row.public_id, row.period);
      if (!result.success) {
        setSelectedProfileError(result.error ?? "Unable to load profile");
        return;
      }
      setSelectedPublicProfile(result.data ?? null);
    } catch (nextError) {
      setSelectedProfileError(toErrorMessage(nextError));
    } finally {
      setSelectedProfileLoading(false);
    }
  }

  async function handleViewOwnLeaderboardProfile() {
    if (!ownLeaderboardEntry) return;
    await handleSelectLeaderboardProfile({
      rank: ownLeaderboardEntry.rank ?? 0,
      public_id: profile?.public_id ?? null,
      display_name: leaderboardProfileDisplayName,
      avatar_url: profile?.avatar_url ?? "",
      period: ownLeaderboardEntry.period,
      focus_seconds: ownLeaderboardEntry.focus_seconds,
      focus_seconds_7d: ownLeaderboardEntry.focus_seconds_7d,
      window_start_date: ownLeaderboardEntry.window_start_date,
      window_end_date: ownLeaderboardEntry.window_end_date,
      updated_at: ownLeaderboardEntry.updated_at,
    });
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
    const snapshotForDebug = await trackerClient.getCurrentSnapshot().catch((snapshotError: unknown) => {
      if (snapshotError instanceof Error) return null;
      throw snapshotError;
    });
    const payload = buildDebugLogPayload({
      selectedDay,
      startOfDayMinutes,
      startOfWeek,
      theme,
      categoryColorOverrides,
      appThemeColorOverrides,
      status,
      accessibilityGranted,
      currentSnapshot: snapshotForDebug,
      driftAlarm: driftAlarmTrayStatus,
      segments,
      historySegments,
      leaderboardSegments,
      error,
    });
    setDebugLogPreview({ text: JSON.stringify(payload, null, 2), exportedAt: payload.exportedAt });
  }, [accessibilityGranted, appThemeColorOverrides, categoryColorOverrides, driftAlarmTrayStatus, error, historySegments, leaderboardSegments, segments, selectedDay, startOfDayMinutes, startOfWeek, status, theme]);
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

  if (authStatus === "loading") {
    return <AuthLoadingGate />;
  }

  if (developerAuthRequiredPreview && hasEffectiveBlockingAuthConfigurationError) {
    return <AuthConfigurationGate />;
  }

  if (developerAuthRequiredPreview && !hasRequiredAccountAuth) {
    return <AuthRequiredGate onSignIn={signInWithWebsite} />;
  }

  const dashboardDateNavigator = (
    <DateNavigator
      ariaLabel={`${dashPeriod} date selector`}
      context={dashboardDateContext}
      label={dashboardDateLabel}
      todayLabel={getDashboardCurrentPeriodLabel(dashPeriod)}
      isTodayDisabled={isCurrentDashboardPeriod}
      isNextDisabled={!canShiftDashboardForward}
      onPrevious={() => shiftDashboardPeriod(-1)}
      onNext={() => shiftDashboardPeriod(1)}
      onToday={() => selectDay(todayIsoDate())}
      previousLabel={`Show previous ${dashPeriod.toLowerCase()}`}
      nextLabel={`Show next ${dashPeriod.toLowerCase()}`}
    />
  );

  const focusDriftSection = (
    <>
      <section className="editorial-panel editorial-panel--soft insight-chart-panel">
        <div className="insight-panel-head">
          <span className="label-mono">Focus vs drift &middot; 30m windows</span>
          <div className="insight-panel-head__legend">
            <span className="chip green"><span className="sw" style={{ background: "var(--productivity-focus)" }} />Focus</span>
            <span className="chip warn"><span className="sw" style={{ background: "var(--productivity-drift)" }} />Drift</span>
          </div>
        </div>
        {focusDriftChart.hasData ? (
          <div
            className={`focus-drift${focusDriftChart.isLive ? " focus-drift--live" : ""}`}
            aria-label={focusDriftChart.isLive && focusDriftChart.currentTimeLabel ? `Focus versus drift by 30-minute windows, in progress through ${focusDriftChart.currentTimeLabel}. Future windows are pending.` : "Focus versus drift by 30-minute windows"}
          >
            <div className="focus-drift__plot" style={focusDriftLiveStyle}>
              <svg
                className="focus-drift__svg"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="group"
                aria-label={focusDriftChart.isLive && focusDriftChart.currentTimeLabel ? `Focus and drift curves in progress through ${focusDriftChart.currentTimeLabel}` : "Focus and drift curves"}
              >
                <defs>
                  <clipPath id="focus-drift-chart-bounds" clipPathUnits="userSpaceOnUse">
                    <rect x={FOCUS_DRIFT_CLIP_BOUNDS.left} y={FOCUS_DRIFT_CLIP_BOUNDS.top} width={FOCUS_DRIFT_CLIP_BOUNDS.right - FOCUS_DRIFT_CLIP_BOUNDS.left} height={FOCUS_DRIFT_CLIP_BOUNDS.bottom - FOCUS_DRIFT_CLIP_BOUNDS.top} />
                  </clipPath>
                </defs>
                <path className="focus-drift__grid" d={FOCUS_DRIFT_GRID_PATH} />
                {focusDriftChart.currentX !== null ? (
                  <rect
                    className="focus-drift__future-region"
                    x={focusDriftChart.currentX}
                    y={FOCUS_DRIFT_CHART_BOUNDS.top}
                    width={FOCUS_DRIFT_CHART_BOUNDS.right - focusDriftChart.currentX}
                    height={FOCUS_DRIFT_CHART_BOUNDS.bottom - FOCUS_DRIFT_CHART_BOUNDS.top}
                    aria-hidden="true"
                  />
                ) : null}
                <g clipPath="url(#focus-drift-chart-bounds)">
                  <path className="focus-drift__area" d={focusDriftChart.focusAreaPath} />
                  <path className="focus-drift__line focus-drift__line--focus" d={focusDriftChart.focusPath} />
                  <path className="focus-drift__line focus-drift__line--drift" d={focusDriftChart.driftPath} />
                </g>
                <rect
                  className="focus-drift__line-target"
                  x={FOCUS_DRIFT_CHART_BOUNDS.left}
                  y={FOCUS_DRIFT_CHART_BOUNDS.top}
                  width={FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left}
                  height={100 - FOCUS_DRIFT_CHART_BOUNDS.top}
                  aria-label="Focus and drift curve hover target"
                  onMouseEnter={updateFocusDriftLineHover}
                  onMouseMove={updateFocusDriftLineHover}
                  onMouseLeave={() => setFocusDriftHover(null)}
                />
                {focusDriftChart.points.filter((point) => point.totalSeconds > 0 && !point.isFuture).map((point) => (
                  <g key={point.id}>
                    <circle
                      className="focus-drift__target focus-drift__target--focus"
                      cx={point.x}
                      cy={point.focusY}
                      r="3"
                      role="button"
                      tabIndex={0}
                      aria-label={formatFocusDriftHoverLabel(point, "focus")}
                      onMouseEnter={(event: MouseEvent<SVGCircleElement>) => setFocusDriftHover({ point, kind: "focus", x: event.clientX, y: event.clientY })}
                      onMouseMove={(event: MouseEvent<SVGCircleElement>) => setFocusDriftHover({ point, kind: "focus", x: event.clientX, y: event.clientY })}
                      onMouseLeave={() => setFocusDriftHover(null)}
                      onFocus={(event: FocusEvent<SVGCircleElement>) => updateFocusDriftKeyboardHover("focus", point, event)}
                      onBlur={() => setFocusDriftHover(null)}
                    />
                    <circle
                      className="focus-drift__target focus-drift__target--drift"
                      cx={point.x}
                      cy={point.driftY}
                      r="3"
                      role="button"
                      tabIndex={0}
                      aria-label={formatFocusDriftHoverLabel(point, "drift")}
                      onMouseEnter={(event: MouseEvent<SVGCircleElement>) => setFocusDriftHover({ point, kind: "drift", x: event.clientX, y: event.clientY })}
                      onMouseMove={(event: MouseEvent<SVGCircleElement>) => setFocusDriftHover({ point, kind: "drift", x: event.clientX, y: event.clientY })}
                      onMouseLeave={() => setFocusDriftHover(null)}
                      onFocus={(event: FocusEvent<SVGCircleElement>) => updateFocusDriftKeyboardHover("drift", point, event)}
                      onBlur={() => setFocusDriftHover(null)}
                    />
                  </g>
                ))}
              </svg>
              {focusDriftChart.currentX !== null ? <div className="focus-drift__now-marker" aria-hidden="true" /> : null}
              <div className="focus-drift__scale" aria-hidden="true">
                {FOCUS_DRIFT_Y_AXIS_TICKS.map((tick) => (
                  <span key={tick.label} style={{ "--focus-drift-scale-y": `${tick.y}%` } as CSSProperties}>{tick.label}</span>
                ))}
              </div>
            </div>
            {focusDriftHover ? <FocusDriftHoverCard appIcons={appIcons} hover={focusDriftHover} /> : null}
            <div className="focus-drift__axis" aria-hidden="true">
              {FOCUS_DRIFT_AXIS_TICKS.map((tick) => (
                <span key={tick.id} style={{ "--focus-drift-axis-x": `${tick.x}%` } as FocusDriftAxisTickStyle}>{tick.label}</span>
              ))}
            </div>
          </div>
        ) : <EmptyState title="No focus pattern yet" detail="Focus and drift curves appear after tracked category data is available." />}
      </section>

      <div className="kpi-row kpi-row--insights insight-summary" aria-label="Insight summary">
        <MetricTile className="insight-summary__tile insight-summary__tile--tracked" label="Tracked" value={formatDuration(totalSeconds)} detail={`${activeHourCount}h active`} />
        <MetricTile className="insight-summary__tile insight-summary__tile--sessions" label="Sessions" value={String(dashboardSegments.length)} detail={averageSessionMinutes > 0 ? `${averageSessionMinutes}m avg` : "No sessions"} />
        <MetricTile className="insight-summary__tile insight-summary__tile--peak" label="Peak" value={peakWindowLabel} detail={peakTrackedSeconds > 0 ? formatCompactDurationFromSeconds(peakTrackedSeconds) : "No peak"} />
        <MetricTile className="insight-summary__tile insight-summary__tile--apps" label="Apps" value={String(uniqueAppsCount)} detail={topAppLabel} />
        <MetricTile className="insight-summary__tile insight-summary__tile--focus" label="Focus" value={`${focusDriftChart.focusConsistency}%`} detail="share" />
        {focusDriftChart.peakDriftPoint ? <MetricTile className="insight-summary__tile insight-summary__tile--drift" label="Drift" value={focusDriftChart.peakDriftPoint.label} detail="peak" /> : null}
      </div>
    </>
  );

  const effectiveBillingEntitlement = activeDashboardAiUnavailablePreviewInput?.billingEntitlement ?? billingEntitlement;
  const effectiveBillingEntitlementError = activeDashboardAiUnavailablePreviewInput?.billingEntitlementError ?? billingEntitlementError;
  const effectiveBillingEntitlementLoading = activeDashboardAiUnavailablePreviewInput?.billingEntitlementLoading ?? billingEntitlementLoading;
  const effectiveIsSupabaseConfigured = activeDashboardAiUnavailablePreviewInput?.isSupabaseConfigured ?? isSupabaseConfigured;
  const effectiveHasRequiredAccountAuth = activeDashboardAiUnavailablePreviewInput?.hasRequiredAccountAuth ?? hasRequiredAccountAuth;
  const cloudStatusLabel = driftyCloudStatusLabel(effectiveBillingEntitlement, effectiveBillingEntitlementLoading, effectiveIsSupabaseConfigured, effectiveHasRequiredAccountAuth);
  const aiServerStatusLabel = aiServerStatusLabelForCloud(effectiveBillingEntitlement, effectiveBillingEntitlementLoading, effectiveIsSupabaseConfigured, effectiveHasRequiredAccountAuth);
  const shouldShowCloudCheckoutPlans = effectiveBillingEntitlement?.status === "locked";
  const currentBillingPlan =
    effectiveBillingEntitlement?.status === "active" || effectiveBillingEntitlement?.status === "trialing"
      ? "individual"
      : !effectiveHasRequiredAccountAuth || !effectiveIsSupabaseConfigured
        ? "free"
        : null;
  const isDashboardAiUnavailablePreviewActive = activeDashboardAiUnavailablePreviewInput !== null;
  const localAiConnectionProviderLabel = localAiSetup.provider === "openrouter_byok" ? "BYOK AI" : "Local AI";
  const aiConnectionStatus = resolveAiConnectionStatus({
    canUseCloudAi: canUseCloudAiClassification,
    hasLocalAiProvider: Boolean(localAiClassificationOptions),
    localProviderLabel: localAiClassificationOptions ? localAiConnectionProviderLabel : null,
    classificationRunning: classificationActionLoading || classificationSummary?.status === "running",
    classificationError: classificationSummary?.status === "error" ? classificationSummary.message : null,
    cloudError: billingEntitlementError,
  });

  return (
    <div className={isSidebarVisuallyCollapsed ? "app-shell app-shell--sidebar-collapsed" : "app-shell"}>
      <div className="window-chrome">
        <div className="window-nav-controls" aria-label="Window navigation">
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
          <AiConnectionStatusBar status={aiConnectionStatus} />
        </div>
      </div>
      {/* ── Sidebar ── */}
      {activeTab === "settings" ? (
        <SettingsSidebar
          activeSection={settingsSection}
          isCollapsed={isSidebarVisuallyCollapsed}
          showDevSection={DEV_SETTINGS_ENABLED}
          onBack={handleSettingsBack}
          onSectionChange={setSettingsSection}
        />
      ) : (
        <aside className={isSidebarVisuallyCollapsed ? "sidebar sidebar--collapsed" : "sidebar"}>
        <div className="brand" aria-label="Drifty status">
          <img className="brand__logo" src={logoUrl} alt="" aria-hidden="true" />
          <div className="dot" aria-hidden="true" />
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
              <span>{item.label}<small>{item.detail}</small></span>
            </button>
          ))}
        </nav>

        <div className="nav-label">Activity</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {activityNav.map((item) => (
            <button key={item.id} type="button" className={activeTab === item.id ? "nav-item active" : "nav-item"} onClick={() => navigateToTab(item.id)}>
              <NavIcon type={item.icon} /><span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="live-pill">
            <div className={`k ${status?.running ? (isTrackerIdle ? "idle" : "tracking") : isTrackerUnavailable ? "unavailable" : "idle"}`}>
              {status?.running ? (isTrackerIdle ? "Idle now" : "Now tracking") : isTrackerUnavailable ? "Tracker unavailable" : "Tracker paused"}
            </div>
            <div className="app-name">
              <span>{liveAppLabel}</span>
              {liveSiteLabel ? <span className="app-name__site">{liveSiteLabel}</span> : null}
            </div>
            <div className="app-class">{trackerStateLabel} &middot; {formatDuration(dayTotalSeconds)}</div>
            <div className="app-class">Last capture: {lastCaptureDistanceLabel}</div>
            <button
              type="button"
              className="sidebar-tracker-toggle"
              data-state={isTrackerUnavailable ? "unavailable" : status?.running ? "pause" : "resume"}
              onClick={() => void (status?.running ? handleStopTracking() : handleStartTracking())}
              disabled={isTrackerUnavailable}
              aria-label={trackerActionLabel}
              title={trackerActionLabel}
            >
              {trackerActionLabel}
            </button>
          </div>
          <AccountMenu
            billingEntitlement={billingEntitlement}
            billingEntitlementLoading={billingEntitlementLoading}
            isOpen={accountMenuOpen}
            isSidebarCollapsed={isSidebarVisuallyCollapsed}
            localAiSetup={localAiSetup}
            userAvatarUrl={profile?.avatar_url || profileDraft.avatarUrl || authMetadataAvatarUrl}
            userEmail={user?.email ?? null}
            onToggle={() => setAccountMenuOpen((open) => !open)}
            onUpgrade={() => {
              setSettingsSection("aiSetup");
              navigateToTab("settings");
              setAccountMenuOpen(false);
            }}
            onSettings={() => {
              openSettingsTab();
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
          <div className={`page${dashPeriod === "Week" ? " page--week-dashboard" : ""}`}>
            {dashboardAiUnavailableState ? (
              <DashboardAiUnavailableNotice
                state={dashboardAiUnavailableState}
                onAction={handleDashboardAiUnavailableAction}
              />
            ) : null}
            {dashboardAiRecoveryState ? (
              <DashboardAiRecoveryOverlay
                billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
                billingPlansDisabled={isDashboardAiUnavailablePreviewActive}
                retrying={classificationActionLoading}
                state={dashboardAiRecoveryState}
                onClose={handleDismissDashboardAiRecovery}
                onOpenAiSetup={() => handleDashboardAiUnavailableAction(dashboardAiRecoveryState.variant)}
                onRetryAi={() => void handleRunSelectedDayAiClassification()}
                onSelectBillingPlan={(billingInterval) => void handleStartDriftyCloudSetup(billingInterval)}
              />
            ) : null}

            {dashPeriod === "Week" ? null : (
              <div className={`pg-head dashboard-page-head${dashPeriod === "Today" ? " dashboard-page-head--today" : ""}`}>
                <div className="dashboard-page-head__row">
                  <div>
                    {dashPeriod === "Today" ? null : <div className="eyebrow">{dashboardPeriodLabel}</div>}
                    <h1>{dashboardTitle}</h1>
                  </div>
                  {dashboardDateNavigator}
                </div>
              </div>
            )}

            {dashPeriod === "Week" ? (
              <WeekDashboard
                rows={weekRows}
                segments={dashboardSegments}
                appIcons={appIcons}
                startDay={dashboardRange.startDay}
                endDay={dashboardRange.endDay}
                categoryEntries={dashboardCategoryTotals}
                productivityEntries={dashboardProductivityTotals}
                totalSeconds={totalSeconds}
                classificationOptions={dashboardClassificationOptions}
                focusDeltaPercent={shouldUsePreviewData() ? 21 : weekFocusDeltaPercent}
                isPreviewSurface={shouldUsePreviewData()}
                startOfDayMinutes={startOfDayMinutes}
                dateNavigator={dashboardDateNavigator}
              />
            ) : dashPeriod === "Month" ? (
              <HistoryCalendarPanel
                segments={historySegments}
                selectedDay={selectedDay}
                classificationOptions={historyClassificationOptions}
                startOfDayMinutes={startOfDayMinutes}
                onSelectDay={selectDay}
              />
            ) : (
              <>
                {/* Flow chart + breakdown */}
                {hasTimelineData ? (
                  <div className="flow-breakdown-layout">
                    <div className="flow-breakdown-layout__chart">
                      <FlowChartView
                        blocks={flowBlocks}
                        appIcons={appIcons}
                        currentMinuteOfDay={currentMinuteOfDay}
                        intervalMinutes={flowIntervalMinutes}
                        startOfDayMinutes={startOfDayMinutes}
                        onIntervalChange={setFlowIntervalMinutes}
                      />
                    </div>
                    <FlowCompactSplitChart
                      categoryEntries={dashboardCategoryTotals}
                      productivityEntries={dashboardProductivityTotals}
                      totalSeconds={totalSeconds}
                      flowBlocks={flowBlocks}
                      appIcons={appIcons}
                    />
                  </div>
                ) : (
                  <EmptyState title="No timeline yet" detail={status?.running ? `Tracker is live for ${selectedDayLabel}.` : "Tracking is paused. Use the sidebar control or move to a day with recorded activity."} />
                )}
              </>
            )}

            {dashPeriod === "Today" ? (
              <>
                <div className="dashboard-insight-stack">
                  {focusDriftSection}
                </div>

                <AppUsagePanel
                  items={dashboardAppUsage}
                  periodLabel={dashPeriod.toLowerCase()}
                  totalSeconds={totalSeconds}
                  appIcons={appIcons}
                />

              </>
            ) : null}
          </div>
        ) : null}

        {/* Classification */}
        {activeTab === "classification" ? (
          <div className="page">
            <div className="pg-head">
              <div>
                <div className="eyebrow">Classification</div>
                <h1>Activity breakdown</h1>
              </div>
              <div className="classification-range-controls">
                <div className="settings-mode-switch" role="radiogroup" aria-label="Classification range">
                  {(["Day", "Week"] as const).map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={`settings-mode-option${classificationRange === range ? " is-active" : ""}`}
                      role="radio"
                      aria-checked={classificationRange === range}
                      onClick={() => setClassificationRange(range)}
                    >
                      <span>{range}</span>
                    </button>
                  ))}
                </div>
                <DateNavigator
                  ariaLabel={`Classification ${classificationRange.toLowerCase()} selector`}
                  context={classificationDateContext}
                  label={classificationDateLabel}
                  todayLabel="Today"
                  isTodayDisabled={isCurrentClassificationRange}
                  isNextDisabled={!canShiftClassificationForward}
                  onPrevious={() => selectDay((p) => getSafeClassificationNavigationDay(p, classificationRange, -1, todayDay, startOfDayMinutes, startOfWeek))}
                  onNext={() => { if (canShiftClassificationForward) selectDay((p) => getSafeClassificationNavigationDay(p, classificationRange, 1, todayDay, startOfDayMinutes, startOfWeek)); }}
                  onToday={() => selectDay(getSafeClassificationNavigationDay(selectedDay, classificationRange, 0, todayDay, startOfDayMinutes, startOfWeek))}
                  previousLabel={classificationRange === "Week" ? "Show previous classification week" : "Show previous day"}
                  nextLabel={classificationRange === "Week" ? "Show next classification week" : "Show next day"}
                />
              </div>
            </div>

            <div className="clf-summary">
              <div className="clf-stat"><span className="eyebrow">Total</span><strong>{formatDuration(classificationTotalSeconds)}</strong></div>
              <div className="clf-stat"><span className="eyebrow">Sessions</span><strong>{classificationSegments.length}</strong></div>
              <div className="clf-stat clf-stat--with-icon"><span className="eyebrow">Top app</span><div className="clf-stat__row"><AppGlyph appName={classificationTopApp?.appName ?? classificationTopAppLabel} iconSrc={classificationTopApp ? appIcons[classificationTopApp.bundleId ?? classificationTopApp.appName] ?? null : null} size="sm" /><strong>{classificationTopAppLabel}</strong></div></div>
              <div className="clf-stat"><span className="eyebrow">Quality</span><strong>{classificationQualityPercent}%</strong></div>
            </div>

            {classificationCategoryBreakdowns.length > 0 ? (
              <section className="classification-panel-view" aria-label="Classification panel view" style={classificationPanelStyle}>
                <div className="classification-panel-view__grid">
                  <section className="classification-panel-view__panel" aria-label="Categories">
                    <header className="classification-panel-view__panel-header panel-header">
                      <div className="panel-header__left">
                        <span className="label-mono">Categories</span>
                        <strong className="panel-header__title">{classificationCategoryBreakdowns.length} tracked</strong>
                      </div>
                      <div className="panel-header__right">
                        <span className="panel-header__meta">Total</span>
                        <strong className="panel-header__value">{formatDuration(classificationTotalSeconds)}</strong>
                      </div>
                    </header>
                    <div className="classification-panel-view__panel-body">
                      <div className="classification-panel-view__list" role="list">
                        {classificationCategoryBreakdowns.map((breakdown) => {
                          const isSelected = breakdown.category === effectiveClassifyCategoryId;
                          const peakSeconds = classificationCategoryBreakdowns[0]?.totalSeconds ?? 0;
                          const barWidth = Math.max((breakdown.totalSeconds / Math.max(peakSeconds, 1)) * 100, 4);
                          return (
                            <button
                              key={breakdown.category}
                              type="button"
                              className="classification-panel-view__category-row"
                              data-selected={String(isSelected)}
                              aria-pressed={isSelected}
                              onClick={() => {
                                setClassifySelectedCategoryId(breakdown.category);
                                setClassifySelectedSourceId(null);
                              }}
                            >
                              <div className="classification-panel-view__row-top">
                                <div className="classification-panel-view__row-title">
                                  <span className={`category-dot category-dot--${breakdown.category}`} aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
                                  <strong>{categoryLabel(breakdown.category)}</strong>
                                </div>
                                <span>{formatCompactDurationFromSeconds(breakdown.totalSeconds)}</span>
                              </div>
                              <div className="classification-panel-view__bar" aria-hidden="true">
                                <span style={{ width: `${barWidth}%`, background: CATEGORY_COLORS[breakdown.category] }} />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  <section className="classification-panel-view__panel" aria-label="Apps and sites">
                    <header className="classification-panel-view__panel-header panel-header">
                      <div className="panel-header__left">
                        <span className="label-mono">Apps &amp; Sites</span>
                        <strong className="panel-header__title">
                          {selectedClassificationBreakdown ? categoryLabel(selectedClassificationBreakdown.category) : "No category"}
                        </strong>
                      </div>
                      <div className="panel-header__right">
                        <span className="panel-header__meta">{classificationSourceSummaries.length === 1 ? "source" : "sources"}</span>
                        <strong className="panel-header__value">{classificationSourceSummaries.length}</strong>
                      </div>
                    </header>
                    <div className="classification-panel-view__panel-body">
                      {classificationSourceSummaries.length > 0 ? (
                        <div className="classification-panel-view__list" role="list">
                          {classificationSourceSummaries.map((item) => {
                            const sourceKey = classifySourceKey(item);
                            const isSelected = sourceKey === effectiveClassifySourceId;
                            return (
                              <button
                                key={sourceKey}
                                type="button"
                                className="classification-panel-view__source-row"
                                data-selected={String(isSelected)}
                                aria-pressed={isSelected}
                                onClick={() => setClassifySelectedSourceId(sourceKey)}
                              >
                                <div className="classification-panel-view__source-icon">
                                  {item.usageKind === "site" && item.siteDomain
                                    ? <SiteFavicon domain={item.siteDomain} size={24} fallbackIconSrc={appIcons[item.appName] ?? null} />
                                    : <AppGlyph appName={item.usageKind === "site" ? item.label : item.appName} iconSrc={appIcons[item.appName] ?? null} size="sm" />}
                                </div>
                                <div className="classification-panel-view__source-copy">
                                  <strong>{item.label}</strong>
                                  <div className="classification-panel-view__source-meta">
                                    <span>{item.sessionCount} {item.sessionCount === 1 ? "session" : "sessions"} · {formatCompactDurationFromSeconds(item.averageSessionSeconds)} avg</span>
                                    <span className="classification-panel-view__source-productivity" aria-label={formatClassificationSourceProductivityMix(item.productivityMix)} title={formatClassificationSourceProductivityMix(item.productivityMix)}>
                                      {item.productivityMix.map((entry) => (
                                        <span
                                          key={entry.productivity}
                                          className={`classification-panel-view__source-productivity-dot classification-panel-view__source-productivity-dot--${entry.productivity}`}
                                          style={{ width: `${Math.max(7, Math.round(entry.ratio * 18))}px` }}
                                          aria-hidden="true"
                                        />
                                      ))}
                                    </span>
                                  </div>
                                </div>
                                <div className="classification-panel-view__source-measure">
                                  <strong>{formatCompactDurationFromSeconds(item.totalSeconds)}</strong>
                                  <span>{item.shareOfTotal * 100 >= 10 ? `${Math.round(item.shareOfTotal * 100)}%` : `${(item.shareOfTotal * 100).toFixed(1)}%`}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="classification-panel-view__empty">
                          <span className="label-mono">Apps &amp; Sites</span>
                          <strong>No sources in this category yet</strong>
                          <p>Tracked apps and browser surfaces will appear here once this category has activity.</p>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="classification-panel-view__panel classification-panel-view__panel--detail" aria-label="Activity details">
                    {selectedClassificationSourceSummary ? (
                      <>
                        <header className="classification-panel-view__panel-header panel-header">
                          <div className="panel-header__left">
                            <span className="label-mono">Activity details</span>
                            <strong className="panel-header__title">
                              {selectedClassificationSourceSummary.label}
                            </strong>
                          </div>
                          <div className="panel-header__right classification-panel-view__detail-meta">
                            <span className="panel-header__meta">
                              {selectedClassificationSourceSummary.sessionCount} {selectedClassificationSourceSummary.sessionCount === 1 ? "session" : "sessions"}
                            </span>
                            <strong className="panel-header__value">{formatCompactDurationFromSeconds(selectedClassificationSourceSummary.totalSeconds)}</strong>
                          </div>
                        </header>
                        <div className="classification-panel-view__panel-body">
                          <div className="classification-panel-view__list" role="list">
                            {classificationActivityRows.map((row) => {
                              const rowMeta = `${row.count} ${row.count === 1 ? "activity" : "activities"} · ${row.startedLabel} - ${row.endedLabel}`;
                              const isExpanded = row.hasDetails && expandedClassificationActivityRows.has(row.id);
                              const detailsId = classificationActivityDetailsId(row.id);
                              const rowSummary = (
                                <>
                                  <div className="classification-panel-view__activity-copy">
                                    <strong title={row.label}>{row.label}</strong>
                                    <span title={rowMeta}>{rowMeta}</span>
                                  </div>
                                  <div className="classification-panel-view__activity-measure">
                                    <div className="classification-panel-view__bar" aria-hidden="true">
                                      <span style={{ width: `${Math.max((row.totalSeconds / Math.max(classificationActivityPeakSeconds, 1)) * 100, 4)}%`, background: selectedClassificationTone }} />
                                    </div>
                                    <strong>{formatCompactDurationFromSeconds(row.totalSeconds)}</strong>
                                  </div>
                                </>
                              );
                              return (
                                <div key={row.id} className="classification-panel-view__activity-row" role="listitem" data-expandable={String(row.hasDetails)} data-expanded={String(isExpanded)}>
                                  {row.hasDetails ? (
                                    <button
                                      type="button"
                                      className="classification-panel-view__activity-toggle"
                                      aria-expanded={isExpanded}
                                      aria-controls={detailsId}
                                      onClick={() => {
                                        setExpandedClassificationActivityRows((current) => {
                                          const next = new Set(current);
                                          if (next.has(row.id)) next.delete(row.id);
                                          else next.add(row.id);
                                          return next;
                                        });
                                      }}
                                    >
                                      {rowSummary}
                                      <span className="sr-only">Capture details {isExpanded ? "expanded" : "collapsed"}</span>
                                      <span className="classification-panel-view__activity-chevron" aria-hidden="true">{isExpanded ? "⌄" : ">"}</span>
                                    </button>
                                  ) : (
                                    <div className="classification-panel-view__activity-summary">
                                      {rowSummary}
                                    </div>
                                  )}
                                  {isExpanded ? (() => {
                                    const surfaceDetails = captureRowSurfaceDetails(row.segments);
                                    const summary = classificationRowSummary(row.segments, classificationOptions);
                                    return (
                                      <div id={detailsId} className="classification-panel-view__activity-details" role="region" aria-label={`Capture details for ${row.label}`}>
                                        <div className="classification-panel-view__activity-overview">
                                          {surfaceDetails.length > 0 ? (
                                            <div className="classification-panel-view__activity-surface" aria-label="Capture surface">
                                              <span className="label-mono">Surface</span>
                                              <div className="classification-panel-view__activity-surface-list">
                                                {surfaceDetails.map((detail) => <span key={detail}>{detail}</span>)}
                                              </div>
                                            </div>
                                          ) : null}
                                          {summary ? (
                                            <dl className="classification-panel-view__activity-classification" aria-label="Classification summary">
                                              <div><dt>Category</dt><dd>{summary.categoryLabel}</dd></div>
                                              <div><dt>Productivity</dt><dd>{summary.productivityLabel}</dd></div>
                                              <div><dt>Source</dt><dd>{summary.sourceLabel}</dd></div>
                                              <div><dt>Confidence</dt><dd>{summary.confidenceLabel}</dd></div>
                                            </dl>
                                          ) : null}
                                        </div>
                                        <div className="classification-panel-view__capture-timeline">
                                          <span className="label-mono">Capture slices</span>
                                          <div className="classification-panel-view__capture-slice-list" role="list" aria-label={`Capture slices for ${row.label}`}>
                                            {row.segments.map((segment, index) => {
                                              const segmentRange = `${formatTimeLabel(segment.startedAt)} - ${formatTimeLabel(segment.endedAt)}`;
                                              const segmentDuration = formatCompactDurationFromSeconds(segment.durationSeconds);
                                              const segmentTitle = classificationActivityLabel(segment);
                                              return (
                                                <div key={segment.id} className="classification-panel-view__capture-slice" role="listitem" aria-label={`Capture slice ${index + 1}: ${segmentTitle}, ${segmentRange}, ${segmentDuration}`}>
                                                  <div className="classification-panel-view__capture-slice-copy">
                                                    <strong className="classification-panel-view__capture-slice-title" title={segmentTitle}>{segmentTitle}</strong>
                                                    <span className="classification-panel-view__capture-slice-time">{segmentRange}</span>
                                                  </div>
                                                  <strong className="classification-panel-view__capture-slice-duration">{segmentDuration}</strong>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })() : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="classification-panel-view__empty">
                        <span className="label-mono">Activity details</span>
                        <strong>Select an app or site to see activity details.</strong>
                        <p>Choose a source from the middle panel to inspect its titles, pages, and time distribution.</p>
                      </div>
                    )}
                  </section>
                </div>
              </section>
            ) : (
              <section className="classification-panel-view" aria-label="Classification panel view">
                <div className="classification-panel-view__empty classification-panel-view__empty--full">
                  <span className="label-mono">Classification</span>
                  <strong>No category data yet</strong>
                  <p>Category, source, and activity details will appear here once tracking captures activity for the selected range.</p>
                </div>
              </section>
            )}
          </div>
        ) : null}

        {activeTab === "history" ? (
          <div className="page page--history">
            <HistoryView
              appIcons={appIcons}
              deleting={historyDeleting}
              segments={historySegments}
              onDeleteSelected={handleDeleteHistorySegments}
            />
          </div>
        ) : null}

        {/* Insights */}
        {activeTab === "trends" ? (
          <div className="page insights-page">
            <div className="pg-head insights-page__head">
              <div>
                <div className="eyebrow">Trends</div>
                <h1>Patterns and trends</h1>
              </div>
              <DateNavigator
                ariaLabel="Insight window selector"
                context="90-day window"
                label={insightDateLabel}
                todayLabel="Latest"
                isTodayDisabled={isTodaySelected}
                isNextDisabled={!canShiftInsightForward}
                onPrevious={() => selectDay((p) => shiftDashboardPeriodDay(p, "Week", -1))}
                onNext={() => { if (canShiftInsightForward) selectDay((p) => shiftDashboardPeriodDay(p, "Week", 1)); }}
                onToday={() => selectDay(todayIsoDate())}
                previousLabel="Show previous insight window"
                nextLabel="Show next insight window"
              />
            </div>

            <WeeklyCategoryRow
              weekly={weeklyBreakdown}
              categoryTotals={activeInsightCategoryTotals}
              segments={insightSegments}
              classificationOptions={insightClassificationOptions}
              appIcons={appIcons}
              productivityTotals={{
                focus: activeInsightProductivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0,
                neutral: activeInsightProductivityTotals.find((entry) => entry.productivity === "neutral")?.totalSeconds ?? 0,
                drift: activeInsightProductivityTotals.find((entry) => entry.productivity === "drift")?.totalSeconds ?? 0,
              }}
            />

            <div className="insight-grid attention-rhythm-radar-row productivity-focus-radar-row" aria-label="Weekly attention and persona analysis">
              <ProductivityPersonaCard
                classificationOptions={insightClassificationOptions}
                hasData={insightSegments.length > 0}
                report={productivityPersonaReport}
                segments={insightSegments}
                variant="radar"
              />
              <AttentionRhythmCard
                appIcons={appIcons}
                cells={attentionRhythm}
                classificationOptions={insightClassificationOptions}
                segments={insightSegments}
              />
            </div>

            <div className="insight-grid productivity-insight-groups" aria-label="Productivity trend charts">
              <InsightSourceGroup variant="drift" lists={driftSourceLists} appIcons={appIcons} />
              <InsightSourceGroup variant="focus" lists={focusSourceLists} appIcons={appIcons} />
            </div>

            <BreakRecoveryCard summary={breakRecoveryInsight} />
          </div>
        ) : null}

        {/* Leaderboard */}
        {activeTab === "leaderboard" ? (
          <div className="page">
            <div className="pg-head">
              <div>
                <div className="eyebrow">Leaderboard</div>
                <h1>Global focus ranking</h1>
              </div>
            </div>

            <div className="leaderboard-page-layout">
              <LeaderboardView
                isSupabaseEnabled={isSupabaseConfigured || leaderboardUsesPreviewProfile}
                isSignedIn={isPolicySignedIn}
                isLoading={leaderboardLoading}
                error={leaderboardError}
                isOptedIn={isLeaderboardOptedIn}
                ownRank={leaderboardUsesPreviewProfile ? 6 : ownLeaderboardEntry?.rank ?? null}
                activePeriod={activeLeaderboardPeriod}
                leaderboard={leaderboardRows}
                focusSeconds7d={localRollingFocusSeconds}
                totalFocusSeconds7d={totalLeaderboardFocusSeconds}
                windowStartDay={leaderboardWindowStartDay}
                windowEndDay={leaderboardWindowEndDay}
                profileDisplayName={leaderboardProfileDisplayName}
                profileAvatarUrl={profile?.avatar_url ?? profileDraft.avatarUrl}
                profileBio={leaderboardProfileBio}
                profileWebsiteUrl={leaderboardProfileWebsiteUrl}
                profileGithubUrl={leaderboardProfileGithubUrl}
                profileLinkedinUrl={leaderboardProfileLinkedinUrl}
                email={user?.email ?? null}
                isActionLoading={leaderboardActionLoading}
                actionError={leaderboardActionError}
                onOptIn={() => void handleLeaderboardOptIn()}
                onSignIn={() => void handleLeaderboardOptIn()}
                onEditProfile={() => setIsProfileEditorOpen(true)}
                onViewOwnProfile={() => void handleViewOwnLeaderboardProfile()}
                onShareProfile={() => void handleShareLeaderboardProfile()}
                onOptOut={() => void handleLeaderboardOptOut()}
                onPeriodChange={setActiveLeaderboardPeriod}
                onSelectProfile={(row) => void handleSelectLeaderboardProfile(row)}
              />
            </div>
            {profileError ? <p className="capture-recency capture-recency--error">{profileError}</p> : null}
            {profileMessage ? <p className="capture-recency">{profileMessage}</p> : null}
            {profileShareMessage ? <div className="leaderboard-share-toast" role="status">{profileShareMessage}</div> : null}
          </div>
        ) : null}

        {/* Settings */}
        {activeTab === "settings" ? (
          <div className="page">
            <div className="pg-head"><div><div className="eyebrow">Account</div><h1>Settings</h1></div></div>
            <div className="settings-panel-stack">
                {settingsSection === "general" && (
                  <div className="settings-section settings-section--general">
                    <div className="settings-block"><h3>General</h3>
                      <div className="settings-row"><label><div className="lbl">Start of day</div><div className="desc">Treat days as starting on this hour. Default is 4:00 AM.</div></label><div className="ctrl"><SettingsSelect ariaLabel="Start of day" value={startOfDayValue} options={START_OF_DAY_OPTIONS} onChange={handleStartOfDayChange} /></div></div>
                      <div className="settings-row"><label><div className="lbl">Start of week</div><div className="desc">Choose the first day shown for weekly views.</div></label><div className="ctrl"><SettingsSelect ariaLabel="Start of week" value={startOfWeek} options={START_OF_WEEK_OPTIONS} onChange={handleStartOfWeekChange} /></div></div>
                      <div className="settings-row"><div><div className="lbl">Theme</div><div className="desc">Matches the titlebar theme switch.</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label="Theme"><button type="button" className={`settings-mode-option${theme === "light" ? " is-active" : ""}`} role="radio" aria-checked={theme === "light"} onClick={() => setTheme("light")}><span>Light</span></button><button type="button" className={`settings-mode-option${theme === "dark" ? " is-active" : ""}`} role="radio" aria-checked={theme === "dark"} onClick={() => setTheme("dark")}><span>Dark</span></button></div></div></div>
                    </div>
                    <div className="settings-block"><h3>Updates</h3>
                      <div className="settings-row"><label htmlFor="automatic-update-checks"><div className="lbl">Automatic update checks</div><div className="desc">Check for signed updates shortly after Drifty opens.</div></label><div className="ctrl"><input id="automatic-update-checks" className="drifty-checkbox" type="checkbox" aria-label="Automatically check for updates on launch" checked={autoUpdateChecksEnabled} onChange={(event) => setAutoUpdateChecksEnabled(event.target.checked)} /></div></div>
                      <div className="settings-row"><div><div className="lbl">Manual update check</div><div className="desc">Drifty checks GitHub Releases for signed update metadata before showing an available download.</div>{updaterMessage ? <p className="capture-recency" role="status">{updaterMessage}</p> : null}{updaterError ? <p className="capture-recency capture-recency--error" role="status">{updaterError}</p> : null}</div><div className="ctrl"><button type="button" className="settings-btn" onClick={() => void handleCheckForUpdates()} disabled={updaterChecking || updaterInstalling}>{updaterChecking ? "Checking..." : "Check for Updates"}</button></div></div>
                    </div>
                    <div className="settings-block"><h3>Permissions</h3>
                      <div className="settings-row"><div><div className="lbl">Accessibility</div><div className="desc">Grant Accessibility permission so Drifty can read window titles for better activity context.</div></div><div className="ctrl"><button type="button" className="settings-btn" onClick={() => void handleRequestAccessibility()}>Grant Accessibility access</button></div></div>
                    </div>
                    <div className="settings-block"><h3>Colors</h3>
                      <CategoryColorControls
                        options={CATEGORY_COLOR_OPTIONS}
                        overrides={categoryColorOverrides}
                        onColorChange={handleCategoryColorChange}
                        onColorReset={handleCategoryColorReset}
                      />
                      <ThemeColorControls
                        accentOptions={APP_THEME_ACCENT_COLOR_OPTIONS}
                        productivityOptions={APP_THEME_PRODUCTIVITY_COLOR_OPTIONS}
                        overrides={appThemeColorOverrides}
                        onColorChange={handleAppThemeColorChange}
                        onColorReset={handleAppThemeColorReset}
                      />
                    </div>
                    <div className="settings-block"><h3>Debugging</h3>
                      <div className="settings-row"><div><div className="lbl">Debug logs</div><div className="desc">Preview a local JSON bundle with safe app status and setting values.</div></div><div className="ctrl"><button type="button" className="settings-btn" onClick={() => void handleOpenDebugLogs()}>View debug logs</button></div></div>
                      <SettingsBuildInfoRow />
                    </div>
                  </div>
                )}
                {settingsSection === "classification" && (
                  <div className="settings-section settings-section--classification">
                    <div className="settings-block cloud-overview">
                      <div className="cloud-overview__header">
                        <div>
                          <h3>Classification rules</h3>
                          <p>Create local rules for domains and recorded apps. Rules stay on this Mac and are never synced to Drifty Cloud.</p>
                        </div>
                        <span className="chip green">Local only</span>
                      </div>
                      <div className="settings-row settings-row--fallback classification-rule-form">
                        <div>
                          <div className="lbl">Add Domain rule</div>
                          <div className="desc">Type a domain or paste a URL. Drifty stores the normalized domain locally.</div>
                        </div>
                        <div className="ctrl classification-rule-form__grid">
                          <label className="classification-rule-field">
                            <span>Domain or URL</span>
                            <input className="settings-input" type="text" value={domainRuleInput} onChange={(event) => setDomainRuleInput(event.target.value)} placeholder="example.com" aria-label="Domain rule domain or URL" />
                          </label>
                          <ClassificationPicker label="Category" ariaLabel="Domain rule category" value={domainRuleCategory} options={CATEGORY_ORDER} getLabel={categoryLabel} getColor={(category) => categoryControlColor(category, categoryColorOverrides)} onChange={setDomainRuleCategory} />
                          <ClassificationPicker label="Productivity" ariaLabel="Domain rule productivity" value={domainRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={productivityLabel} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={setDomainRuleProductivity} />
                          <button type="button" className="settings-btn settings-btn--primary" onClick={() => void handleSaveDomainRule()} disabled={classificationRuleSavingKind !== null}>{classificationRuleSavingKind === "site" ? "Saving..." : "Save Domain rule"}</button>
                        </div>
                      </div>
                      <div className="settings-row settings-row--fallback classification-rule-form">
                        <div>
                          <div className="lbl">Add App rule</div>
                          <div className="desc">Search app names Drifty has recorded locally, then choose category and productivity.</div>
                        </div>
                        <div className="ctrl classification-rule-form__grid classification-rule-form__grid--app">
                          <label className="classification-rule-field classification-rule-field--wide">
                            <span>Recorded app</span>
                            <input className="settings-input" type="search" value={appRuleSearch} onChange={(event) => { setAppRuleSearch(event.target.value); setAppRuleTargetValue(""); setAppRuleDisplayName(""); }} placeholder="Search apps..." aria-label="Search recorded apps for App rule" />
                          </label>
                          <ClassificationPicker label="Category" ariaLabel="App rule category" value={appRuleCategory} options={CATEGORY_ORDER} getLabel={categoryLabel} getColor={(category) => categoryControlColor(category, categoryColorOverrides)} onChange={setAppRuleCategory} />
                          <ClassificationPicker label="Productivity" ariaLabel="App rule productivity" value={appRuleProductivity} options={PRODUCTIVITY_ORDER} getLabel={productivityLabel} getColor={(productivity) => productivityControlColor(productivity, appThemeColorOverrides)} onChange={setAppRuleProductivity} />
                          <button type="button" className="settings-btn settings-btn--primary" onClick={() => void handleSaveAppRule()} disabled={classificationRuleSavingKind !== null || !appRuleTargetValue.trim()}>{classificationRuleSavingKind === "app" ? "Saving..." : "Save App rule"}</button>
                        </div>
                        {appRuleDisplayName ? <p className="classification-rule-selected" role="status">Selected app: {appRuleDisplayName}</p> : null}
                        <div className="classification-rule-candidates" aria-label="Recorded app search results">
                          {classificationRuleCandidatesLoading ? <span className="classification-rule-hint">Searching local app history...</span> : null}
                          {!classificationRuleCandidatesLoading && appRuleSearch.trim().length < 2 ? <span className="classification-rule-hint">Type at least 2 characters to list most-used recorded apps from this Mac.</span> : null}
                          {!classificationRuleCandidatesLoading && appRuleSearch.trim().length >= 2 && classificationRuleCandidates.length === 0 ? <span className="classification-rule-hint">No recorded apps match this search.</span> : null}
                          {classificationRuleCandidates.length > 0 ? <div className="classification-rule-candidates__heading">Most used matching apps</div> : null}
                          {classificationRuleCandidates.map((candidate) => {
                            const candidateUsageLabel = formatClassificationCandidateUsageLabel(candidate);
                            return (
                              <button key={candidate.id} type="button" className={`classification-rule-candidate${appRuleTargetValue === candidate.targetValue ? " is-selected" : ""}`} onClick={() => handleSelectClassificationCandidate(candidate)} aria-label={`Choose ${candidate.displayName}, ${candidateUsageLabel}`}>
                                <span className="classification-rule-candidate__identity">
                                  <AppGlyph appName={candidate.appName ?? candidate.displayName} iconSrc={classificationRuleCandidateAppIconSrc(candidate, appIcons)} size="sm" />
                                  <span className="classification-rule-candidate__text"><strong>{candidate.displayName}</strong>{candidate.bundleId ? <small>{candidate.bundleId}</small> : null}</span>
                                </span>
                                <span className="classification-rule-candidate__usage"><strong>{secondsToLabel(candidate.totalSeconds)}</strong><em>{candidate.segmentCount} {candidate.segmentCount === 1 ? "segment" : "segments"}</em></span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {classificationRulesError ? <p className="classification-summary classification-summary--error" role="alert">{classificationRulesError}</p> : null}
                      {classificationRuleMessage ? <p className="classification-summary" role="status">{classificationRuleMessage}</p> : null}
                      {classificationRuleApplyResult ? <p className="classification-summary" role="status">{formatClassificationRuleApplyResult(classificationRuleApplyResult)}</p> : null}
                    </div>
                    <div className="settings-block">
                      <div className="classification-rule-list-head">
                        <div>
                          <h3>Saved local rules</h3>
                          <p className="classification-rule-copy">Use the switch to save a rule as off, delete it, or reapply enabled rules to existing activity.</p>
                        </div>
                        <div className="settings-row__actions">
                          <button type="button" className="settings-btn" onClick={() => void loadClassificationRules()} disabled={classificationRulesLoading}>Refresh</button>
                          <button type="button" className="settings-btn settings-btn--primary" onClick={() => void handleApplyClassificationRules()} disabled={classificationRuleApplying || classificationRules.length === 0}>{classificationRuleApplying ? "Applying..." : "Apply rules"}</button>
                        </div>
                      </div>
                      {classificationRulesLoading ? <p className="classification-rule-hint">Loading local rules...</p> : null}
                      {!classificationRulesLoading && classificationRules.length === 0 ? (
                        <div className="empty-state classification-rule-empty">
                          <span className="eyebrow">No local rules</span>
                          <strong>No custom rules yet</strong>
                          <p>Add a Domain or App rule to override local classification for matching activity.</p>
                        </div>
                      ) : null}
                      {classificationRules.length > 0 ? (
                        <div className="classification-rule-list" aria-label="Saved local classification rules">
                          {classificationRules.map((rule) => (
                            <article className="classification-rule-card" key={rule.id} aria-label={`${classificationRuleTargetLabel(rule.targetKind)} rule ${rule.targetValue}`}>
                              <div className="classification-rule-card__main">
                                <span className="classification-rule-card__icon">
                                  {rule.targetKind === "site" ? <SiteFavicon domain={rule.targetValue} size={24} /> : <AppGlyph appName={rule.targetValue} iconSrc={classificationRuleAppIconSrc(rule, appIcons)} size="sm" />}
                                </span>
                                <span className="chip gray">{classificationRuleTargetLabel(rule.targetKind)}</span>
                                <div>
                                  <strong>{rule.targetValue}</strong>
                                  <p>{categoryLabel(rule.category)} · {productivityLabel(rule.productivity)} · {rule.enabled ? "Enabled" : "Disabled"}</p>
                                </div>
                              </div>
                              <div className="classification-rule-card__actions">
                                <Toggle checked={rule.enabled} onChange={(enabled) => void handleToggleClassificationRule(rule, enabled)} ariaLabel={`${rule.enabled ? "Disable" : "Enable"} ${rule.targetValue} rule`} />
                                <button type="button" className="settings-btn danger" onClick={() => void handleDeleteClassificationRule(rule)} disabled={classificationRuleDeletingId === rule.id}>{classificationRuleDeletingId === rule.id ? "Deleting..." : "Delete"}</button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
                {settingsSection === "aiSetup" && (
                  <div className="settings-section settings-section--ai-setup">
                    <AiSetupPanel
                      aiServerStatusLabel={aiServerStatusLabel}
                      billingCheckoutLoadingInterval={billingCheckoutLoadingInterval}
                      billingEntitlementError={effectiveBillingEntitlementError}
                      billingPlansDisabled={isDashboardAiUnavailablePreviewActive}
                      cloudStatusLabel={cloudStatusLabel}
                      currentBillingPlan={currentBillingPlan}
                      localAiSetup={localAiSetup}
                      shouldShowCloudCheckoutPlans={shouldShowCloudCheckoutPlans}
                      onDialogOpenChange={setAiSetupDialogOpen}
                      onLocalAiSetupChange={setLocalAiSetup}
                      onStartCloudSetup={handleStartDriftyCloudSetup}
                    />
                  </div>
                )}
                {settingsSection === "notifications" && (
                  <div className="settings-section"><div className="settings-block"><h3>Alerts</h3>
                    <div className="settings-row"><div><div className="lbl">Drift alerts</div><div className="desc">Show a drift alarm when current activity is classified as drift.</div></div><div className="ctrl"><Toggle checked={driftAlertsEnabled} onChange={setDriftAlertsEnabled} ariaLabel="Toggle drift alerts" /></div></div>
                    <div className="settings-row"><div><div className="lbl">Drift alert timing</div></div><div className="ctrl"><div className="settings-mode-switch settings-mode-switch--triple settings-mode-switch--compact" role="radiogroup" aria-label="Drift alert timing">{DRIFT_ALERT_DELAY_OPTIONS.map((option) => (<button key={option.value} type="button" className={`settings-mode-option${driftAlertDelaySeconds === option.value ? " is-active" : ""}`} role="radio" aria-checked={driftAlertDelaySeconds === option.value} onClick={() => setDriftAlertDelaySeconds(option.value)}><span>{option.label}</span></button>))}</div></div></div>
                    <div className="settings-row"><div><div className="lbl settings-label-with-badge">Extreme nudge <span className="settings-beta-badge">Beta</span></div><div className="desc">Beta feature: close the drift browser tab or quit the drift app instead of showing the alarm.</div></div><div className="ctrl"><Toggle checked={extremeNudgeEnabled} onChange={setExtremeNudgeEnabled} ariaLabel="Toggle extreme nudge" /></div></div>
                    <DriftAlarmCopySettings value={driftAlarmCopy} onChange={setDriftAlarmCopy} />
                  </div></div>
                )}
                {settingsSection === "privacy" && (
                  <div className="settings-section">
                    <div className="settings-block"><h3>Data</h3>
                      <div className="settings-row"><div><div className="lbl">Raw tracking history is not published</div><div className="desc">Leaderboard and profile features publish aggregates only. AI classification may send minimized activity fields to configured providers for the request, but Drifty does not store raw tracking history for leaderboard or profile publishing.</div></div><div className="ctrl"><span className="chip green">Privacy first</span></div></div>
                      <div className="settings-row"><div><div className="lbl">Optional cloud features are explicit</div><div className="desc">If you configure Supabase and join the leaderboard, Drifty publishes your public profile card plus a rolling 7 day focus total. Raw tracking history is not published there.</div></div><div className="ctrl"><span className="chip">Opt-in only</span></div></div>
                    </div>
                  </div>
                )}
                {settingsSection === "data" && (
                  <div className="settings-section">
                    <div className="settings-block"><h3>Storage</h3>
                      <div className="settings-row"><div><div className="lbl">Database</div></div><div className="ctrl ctrl--value">{status?.databasePath ?? "Unknown"}</div></div>
                      <div className="settings-row"><div><div className="lbl">Sessions logged</div></div><div className="ctrl ctrl--value">{segments.length} today</div></div>
                    </div>
                    <div className="settings-block"><h3>Export</h3>
                      <div className="settings-row"><div><div className="lbl">Export session data</div><div className="desc">All sessions as CSV</div></div><div className="ctrl"><button className="settings-btn">Download CSV</button></div></div>
                    </div>
                  </div>
                )}
                {settingsSection === "dev" && DEV_SETTINGS_ENABLED && (
                  <div className="settings-section">
                    <div className="settings-block settings-block--dev-preview">
                      <h3>Dev notifications</h3>
                      {END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED ? (
                        <div className="settings-row" role="group" aria-label="End-of-day review" ref={endOfDayReviewSettingsRowRef} tabIndex={-1}><div><div className="lbl">End-of-day review</div><div className="desc">Dev-only local summary after 6:00 PM, or preview it now.</div></div><div className="ctrl"><button type="button" className="settings-btn" onClick={handleEndOfDayReviewPreview}>Preview</button></div></div>
                      ) : null}
                      {DRIFT_ALARM_PANEL_PREVIEWS_ENABLED ? (
                        <div className="settings-row"><div><div className="lbl">Drift alarm previews</div><div className="desc">Open sample alarm panels without waiting for tracker drift. Dev builds only.</div></div><div className="ctrl settings-row__actions">{DRIFT_ALARM_PREVIEW_OPTIONS.map((option) => (<button key={option.id} type="button" className="settings-btn" onClick={() => previewDriftAlarm(option)}>{option.label}</button>))}</div></div>
                      ) : null}
                      {WATCHER_PEEK_SETTINGS_VISIBLE && WATCHER_PEEK_PROTOTYPE_ENABLED && (
                      <>
                      <div className="settings-row" role="group" aria-label="Peek watcher prototype"><div><div className="lbl">Peek watcher prototype</div><div className="desc">Opt-in experiment for a quiet watcher overlay. Choose a regular cadence or drift-only nudges.</div></div><div className="ctrl settings-row__actions"><button type="button" className="settings-btn" onClick={() => showWatcherPeek(true)}>Preview</button><Toggle checked={watcherPeekEnabled} onChange={setWatcherPeekEnabled} ariaLabel="Toggle peek watcher prototype" /></div></div>
                      <div className="settings-row"><div><div className="lbl">Watcher mode</div><div className="desc">Choose regular check-ins or a quieter mode that only speaks when drift continues.</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label="Watcher mode"><button type="button" className={`settings-mode-option${watcherMode === "periodic" ? " is-active" : ""}`} role="radio" aria-checked={watcherMode === "periodic"} onClick={() => setWatcherMode("periodic")}><span>Periodic</span><small>Every few minutes</small></button><button type="button" className={`settings-mode-option${watcherMode === "drift_only" ? " is-active" : ""}`} role="radio" aria-checked={watcherMode === "drift_only"} onClick={() => setWatcherMode("drift_only")}><span>Drift only</span><small>Quiet during focus</small></button></div></div></div>
                      {watcherMode === "periodic" ? (
                        <div className="settings-row"><div><div className="lbl">Periodic cadence</div><div className="desc">Show the watcher at a random interval inside this range. Default is 10-30 minutes.</div></div><div className="ctrl settings-row__actions"><input className="settings-input settings-input--compact" type="number" min={WATCHER_PERIODIC_MIN_LIMIT_MINUTES} max={WATCHER_PERIODIC_MAX_LIMIT_MINUTES} value={watcherPeriodicMinMinutes} onChange={handleWatcherPeriodicMinChange} aria-label="Minimum watcher interval minutes" /><span className="settings-inline-unit">to</span><input className="settings-input settings-input--compact" type="number" min={watcherPeriodicMinMinutes} max={WATCHER_PERIODIC_MAX_LIMIT_MINUTES} value={watcherPeriodicMaxMinutes} onChange={handleWatcherPeriodicMaxChange} aria-label="Maximum watcher interval minutes" /><span className="settings-inline-unit">min</span></div></div>
                      ) : (
                        <div className="settings-row"><div><div className="lbl">Drift-only cadence</div><div className="desc">No focus messages. First nudge appears 10 seconds after drift is detected, then 5 minutes, 30 minutes, 1 hour, and 2 hours if it continues.</div></div><div className="ctrl"><span className="chip">10s · 5m · 30m · 1h · 2h</span></div></div>
                      )}
                      </>
                      )}
                    </div>
                    {AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED ? (
                      <div className="settings-block settings-block--dev-preview">
                        <h3>AI unavailable preview</h3>
                        <div className="settings-row settings-row--fallback settings-row--ai-preview" role="group" aria-label="AI unavailable preview case">
                          <div>
                            <div className="lbl">AI unavailable preview</div>
                            <div className="desc">
                              Apply a selected AI unavailable case to the dashboard three days ago. {dashboardAiUnavailablePreview ? `Active on ${formatDayLabel(dashboardAiUnavailablePreview.appliedDay)}.` : "Dev builds only."}
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
                                  onClick={() => setDashboardAiUnavailablePreviewCase(option.id)}
                                >
                                  <span>{option.label}</span>
                                  <small>{option.detail}</small>
                                </button>
                              ))}
                            </div>
                            <button type="button" className="settings-btn settings-btn--primary" onClick={previewDashboardAiUnavailableCase}>Preview 3 days ago</button>
                            {dashboardAiUnavailablePreview ? <button type="button" className="settings-btn" onClick={clearDashboardAiUnavailablePreview}>Clear preview</button> : null}
                          </div>
                        </div>
                      </div>
                      ) : null}
                  </div>
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
            {commandBarTabs.map((item) => (
              <button key={item.id} className="cmd-item" onClick={() => handleCmdNav(item.id)}>
                <span className="cmd-label">{item.label}</span>
                <span className="cmd-sub">{item.sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {authModalOpen ? <AuthModal onClose={() => setAuthModalOpen(false)} /> : null}

      {feedbackModalOpen ? <FeedbackModal initialEmail={user?.email ?? ""} onClose={() => setFeedbackModalOpen(false)} /> : null}

      {debugLogPreview ? (
        <DebugLogModal
          text={debugLogPreview.text}
          onClose={() => setDebugLogPreview(null)}
          onCopy={() => void handleCopyDebugLogs()}
          onDownload={handleDownloadDebugLogs}
        />
      ) : null}

      {onboardingOpen ? (
        <OnboardingModal
          userId={user?.id ?? "local"}
          userEmail={user?.email ?? null}
          initialDisplayName={profileDraft.displayName}
          trackerStatus={status}
          accessibilityGranted={accessibilityGranted}
          onRefreshTracker={() => refresh().then(() => undefined)}
          onStartTracking={handleStartTrackingFromOnboarding}
          onCheckAccessibility={handleCheckAccessibility}
          onRequestAccessibility={handleRequestAccessibility}
          onEnableDriftAlerts={() => setDriftAlertsEnabled(true)}
          onStartCloudTrialWithGoogle={() => void signInWithGoogle()}
          onStartCloudTrialWithEmail={() => void signInWithWebsite()}
          onComplete={handleOnboardingComplete}
        />
      ) : null}

      {selectedLeaderboardRow ? (
        <ProfileModal
          row={selectedLeaderboardRow}
          profile={selectedPublicProfile}
          isLoading={selectedProfileLoading}
          error={selectedProfileError}
          onClose={() => {
            setSelectedLeaderboardRow(null);
            setSelectedPublicProfile(null);
            setSelectedProfileError(null);
          }}
        />
      ) : null}

      {isProfileEditorOpen ? (
        <EditProfileModal
          displayName={leaderboardProfileDisplayName}
          avatarUrl={profileDraft.avatarUrl}
          profileDraft={profileDraft}
          profileLoading={profileLoading}
          profileSaving={profileSaving}
          profileMessage={profileMessage}
          profileError={profileError}
          onClose={() => setIsProfileEditorOpen(false)}
          onPhotoSelected={(event) => void handleProfilePhotoSelected(event)}
          onRemovePhoto={() => setProfileDraft((draft) => ({ ...draft, avatarUrl: "", isPublic: true }))}
          onChange={(updater) => setProfileDraft((draft) => ({ ...draft, ...updater, isPublic: true }))}
          onSave={() => void handleSaveProfileFromModal()}
        />
      ) : null}

      {visibleUpdate ? (
        <div className="auth-modal__overlay" onClick={dismissAvailableUpdate}>
          <section className="auth-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="available-update-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="available-update-title" className="update-dialog-title">Drifty {visibleUpdate.version} is available</h2>
            {visibleUpdate.date ? <p className="capture-recency">Published {new Date(visibleUpdate.date).toLocaleString()}</p> : null}
            <p className="profile-modal__bio">{visibleUpdate.body?.trim() || "No release notes were provided."}</p>
            {updaterError ? <p className="capture-recency capture-recency--error" role="status">{updaterError}</p> : null}
            {availableUpdateSource === "automatic" ? (
              <label className="update-dialog-checkbox">
                <input className="drifty-checkbox" type="checkbox" aria-label="Auto-check updates on launch" checked={autoUpdateChecksEnabled} onChange={(event) => setAutoUpdateChecksEnabled(event.target.checked)} />
                <span className="update-dialog-checkbox__label">Auto-check updates on launch</span>
              </label>
            ) : null}
            <div className="profile-editor-modal__actions">
              <button type="button" className="ghost-button" onClick={dismissAvailableUpdate} disabled={updaterInstalling}>Not now</button>
              <button type="button" className="settings-btn" onClick={() => void handleInstallUpdate()} disabled={updaterChecking || updaterInstalling}>{updaterInstalling ? "Installing..." : "Install and restart"}</button>
            </div>
          </section>
        </div>
      ) : null}

    </div>
  );
}
