import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, FocusEvent, FormEvent, MouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { ActivityCategory, ActivitySegment, AppIconMap, AppIdentity, ClassificationMetrics, ClassificationOptions, ClassificationRule, ClassificationRuleApplyResult, ClassificationRuleCandidate, ClassificationRuleInput, ClassificationRuleTargetKind, ClassificationSource, CurrentActivitySnapshot, DayRibbonSegment, FlowBlock, FlowIntervalMinutes, HourBucket, ProductivityLabel, ProductivityShareMix, SiteDuration, TrackerStatus } from "@drifty/domain";
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
  isCloudBillingVariant,
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
import { AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED, DRIFT_ALARM_PANEL_PREVIEWS_ENABLED, isDevOnboardingBypassEnabled, WATCHER_PEEK_PROTOTYPE_ENABLED } from "./appFeatureSwitches";
import { useAuth } from "./features/auth/AuthContext";
import { AuthModal } from "./features/auth/AuthModal";
import { FeedbackModal } from "./features/feedback/FeedbackModal";
import { CategoryColorControls, ClassificationPicker, ThemeColorControls, type AppThemeColorKey, type ColorOption } from "./features/settings/SettingsColorControls";
import { SettingsSidebar, type SettingsSection } from "./features/settings/SettingsSidebar";
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
import { IndividualPlanCards } from "./features/billing/IndividualPlanCards";
import { getAccountDisplayName, getAuthMetadataAvatarUrl } from "./features/auth/accountDisplay";
import { buildClassificationActivityRows, buildClassificationCategoryBreakdowns, buildClassificationSourceSummaries, captureRowSurfaceDetails, classificationActivityDetailsId, classificationActivityLabel, classificationRowSummary, classificationRuleAppIconSrc, classificationRuleCandidateAppIconSrc, classificationRuleTargetLabel, classificationSourceLabel, classifySegmentSourceKey, classifySourceKey, formatCategoryPercentage, formatClassificationCandidateUsageLabel, formatClassificationRuleApplyResult, hasDuplicateClassificationRule, normalizeDomainRuleInput, productivityMixAriaLabel, usageItemLabel } from "./features/classification/classificationViewData";
import type { CategoryBreakdownUsageItem, ClassificationCategoryBreakdown, TimelineItem } from "./features/classification/classificationViewData";
import { DRIFT_ALARM_PREVIEW_OPTIONS, DRIFT_ALERTS_STORAGE_KEY, DRIFT_ALERT_DELAY_OPTIONS, DRIFT_ALERT_DELAY_STORAGE_KEY, EXTREME_NUDGE_STORAGE_KEY, buildDriftAlarmCandidates, buildExtremeNudgeTarget, buildExtremeNudgeToastEvent, activateFocusTargetSite, buildRecentFocusTargets, hasDriftAlarmFocusTargetIconUpgrade, resolveInitialDriftAlertDelaySeconds, resolveInitialDriftAlertsEnabled, resolveInitialExtremeNudgeEnabled } from "./features/companion/driftAlarmData";
import type { DriftAlarmBreakSnooze, DriftAlertDelaySeconds } from "./features/companion/driftAlarmData";
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
import { LOCAL_AI_SETUP_STORAGE_KEY, OPENROUTER_RECOMMENDED_MODELS, SELF_HOSTED_RECOMMENDED_MODELS, isForbiddenOpenRouterModel, isRecommendedOpenRouterModel, isRecommendedSelfHostedModel, normalizeOpenRouterFallbackModels, normalizeOpenRouterPrimaryModel, resolveInitialLocalAiSetup, toPersistedLocalAiSetup, uniqueOpenRouterModels } from "./features/settings/localAiSetup";
import type { LocalAiSetupState } from "./features/settings/localAiSetup";
import { AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY, APP_THEME_ACCENT_COLOR_OPTIONS, APP_THEME_COLOR_OPTIONS, APP_THEME_COLOR_STORAGE_KEY, APP_THEME_PRODUCTIVITY_COLOR_OPTIONS, CATEGORY_COLOR_OPTIONS, CATEGORY_COLOR_STORAGE_KEY, DEFAULT_START_OF_WEEK, SIDEBAR_COLLAPSED_STORAGE_KEY, START_OF_DAY_OPTIONS, START_OF_DAY_STORAGE_KEY, START_OF_WEEK_OPTIONS, START_OF_WEEK_STORAGE_KEY, THEME_STORAGE_KEY, categoryControlColor, hourlyStartOfDayValueToMinutes, isHexColor, isStartOfWeek, minutesToHourlyStartOfDayValue, productivityControlColor, resolveInitialAiClassificationVisibility, resolveInitialAppThemeColorOverrides, resolveInitialCategoryColorOverrides, resolveInitialSidebarCollapsed, resolveInitialStartOfDayMinutes, resolveInitialStartOfWeek, resolveInitialTheme } from "./features/settings/settingsStorage";
import type { AppThemeColorOverrides, CategoryColorOverrides, StartOfWeek, ThemeMode } from "./features/settings/settingsStorage";
import { CATEGORY_COLORS, FLOW_BREAKDOWN_PRODUCTIVITY_ORDER, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "./lib/activityLabels";
import { WEEKDAY_LABELS, clockHourForLogicalHour, describeRelativeDay, filterSegmentsForRange, formatCalendarMinuteLabel, formatCompactDurationFromSeconds, formatDateRangeLabel, formatDayLabel, formatDuration, formatHourLabel, formatQuarterHourLabel, formatRelativeTime, formatTimeLabel, getDayPart, getLogicalDayRange, isoDateFromTimestamp, localDateKey, logicalTodayIsoDate, toErrorMessage, weekdayOrderIndex } from "./lib/formatting";

type TabId = "dashboard" | "classify" | "drift" | "leaderboard" | "settings";

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
  { id: "classify", label: "Classification", sub: "Activity breakdown" },
  { id: "drift", label: "Insights", sub: "Patterns and trends" },
  { id: "leaderboard", label: "Leaderboard", sub: "Global focus ranking" },
] satisfies ReadonlyArray<{ id: TabId; label: string; sub: string }>;

type NavItem = {
  id: TabId;
  label: string;
  icon: NavIconType;
};

type NavIconType = "home" | "calendar" | "classify" | "insights" | "leaderboard" | "settings";

type PlanItem = {
  id: string;
  title: string;
  estimate: string;
  completed: boolean;
  source: "Quick add" | "Pinned";
};

type TimelineHoverState = {
  segment: DayRibbonSegment;
  x: number;
  y: number;
};

type FocusDriftHoverKind = "focus" | "drift";

type FocusDriftHoverState = {
  point: FocusDriftPoint;
  kind: FocusDriftHoverKind;
  x: number;
  y: number;
};

type CompactClassificationHoverState = {
  label: string;
  durationLabel: string;
  shareLabel: string;
  dotClassName: string;
  color: string;
  appBreakdown: CompactClassificationBreakdownRow[];
  disableRemoteFavicons?: boolean;
  x: number;
  y: number;
};

type CompactClassificationHoverPayload = Omit<CompactClassificationHoverState, "x" | "y">;

type CompactClassificationBreakdownRow = {
  appName: string;
  bundleId?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  totalSeconds: number;
};

type WeekCalendarHoverState = {
  event: WeekCalendarEvent;
  x: number;
  y: number;
};

type FixedHoverPosition = {
  left: number;
  top: number;
};

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

const HOVER_CARD_OFFSET = 16;
const HOVER_CARD_VIEWPORT_PADDING = 16;

type CategoryBreakdownCardStyle = CSSProperties & {
  "--category-breakdown-tone": string;
};

type ClassificationPanelStyle = CSSProperties & {
  "--classification-selected-tone": string;
};

const dashboardPeriodOptions: DashboardPeriodOption[] = [
  { period: "Today", label: "Your Day", detail: "Live timeline" },
  { period: "Week", label: "Your Week", detail: "Calendar week" },
];

const workspaceNav: NavItem[] = [
  { id: "classify", label: "Classification", icon: "classify" },
  { id: "drift", label: "Insights", icon: "insights" },
  { id: "leaderboard", label: "Leaderboard", icon: "leaderboard" },
];

function recentSessionDisplayName(item: Pick<TimelineItem, "appName" | "siteDomain" | "siteTitle">) {
  return item.siteDomain ?? item.siteTitle ?? item.appName;
}

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
    case "classify":
      return (<svg {...props}><path d="M4 5h16M4 12h10M4 19h14" /><circle cx="18" cy="12" r="2" /><circle cx="20" cy="19" r="2" /></svg>);
    case "insights":
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
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(resolveInitialExtremeNudgeEnabled);
  const [driftAlarmSnooze, setDriftAlarmSnooze] = useState<DriftAlarmBreakSnooze | null>(null);
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
  const [openRouterModelPickerOpen, setOpenRouterModelPickerOpen] = useState(false);
  const [openRouterCustomModel, setOpenRouterCustomModel] = useState("");
  const [selfHostedModelPickerOpen, setSelfHostedModelPickerOpen] = useState(false);
  const [selfHostedCustomModel, setSelfHostedCustomModel] = useState("");
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

  const handleCheckForUpdates = useCallback(async () => {
    if (updaterCheckingRef.current || updaterInstallingRef.current) return;

    updaterCheckingRef.current = true;
    setUpdaterChecking(true);
    setUpdaterMessage(null);
    setUpdaterError(null);

    try {
      const nextUpdate = await check();
      setAvailableUpdate(nextUpdate);
      if (!nextUpdate) setUpdaterMessage("Drifty is up to date.");
    } catch (nextError) {
      setAvailableUpdate(null);
      setUpdaterError(`Update check failed: ${toErrorMessage(nextError)}`);
    } finally {
      updaterCheckingRef.current = false;
      setUpdaterChecking(false);
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

  const openEndOfDayReviewSettings = useCallback(() => {
    shouldFocusEndOfDayReviewSettingsRef.current = true;
    setSettingsSection("notifications");
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
  const [developerAuthRequiredPreview, setDeveloperAuthRequiredPreview] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [ownLeaderboardEntry, setOwnLeaderboardEntry] = useState<OwnLeaderboardEntry | null>(null);
  const [activeLeaderboardPeriod, setActiveLeaderboardPeriod] = useState<LeaderboardPeriod>(DEFAULT_LEADERBOARD_PERIOD);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardActionLoading, setLeaderboardActionLoading] = useState(false);
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
  const [driftyCloudSetupOpen, setDriftyCloudSetupOpen] = useState(false);
  const selectedDayClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      fallbackCandidates: segments,
      includeAiClassifications: showAiClassificationImpact,
    }),
    [segments, showAiClassificationImpact],
  );
  const recentDriftAlarmFocusTargets = useMemo(
    () => buildRecentFocusTargets(segments, historySegments, selectedDayClassificationOptions, appIcons),
    [appIcons, historySegments, segments, selectedDayClassificationOptions],
  );
  const openRouterPrimaryModel = normalizeOpenRouterPrimaryModel(localAiSetup.openRouterModel);
  const openRouterFallbackModels = useMemo(
    () => normalizeOpenRouterFallbackModels(openRouterPrimaryModel, localAiSetup.openRouterFallbackModels),
    [localAiSetup.openRouterFallbackModels, openRouterPrimaryModel],
  );
  const openRouterSelectedModels = useMemo(
    () => uniqueOpenRouterModels([openRouterPrimaryModel, ...openRouterFallbackModels]),
    [openRouterFallbackModels, openRouterPrimaryModel],
  );
  const openRouterCustomSelectedModels = openRouterSelectedModels.filter((model) => !isRecommendedOpenRouterModel(model));
  const openRouterModelOptions = [
    ...OPENROUTER_RECOMMENDED_MODELS,
    ...openRouterCustomSelectedModels.map((model) => ({ id: model, label: model, detail: "Other model" })),
  ];
  const openRouterSelectionSummary = openRouterFallbackModels.length > 0
    ? `${openRouterPrimaryModel} + ${openRouterFallbackModels.length} fallback${openRouterFallbackModels.length === 1 ? "" : "s"}`
    : openRouterPrimaryModel;
  const selfHostedSelectedModel = localAiSetup.selfHostedModel.trim();
  const selfHostedCustomSelectedModels = selfHostedSelectedModel && !isRecommendedSelfHostedModel(selfHostedSelectedModel) ? [selfHostedSelectedModel] : [];
  const selfHostedModelOptions = [
    ...SELF_HOSTED_RECOMMENDED_MODELS,
    ...selfHostedCustomSelectedModels.map((model) => ({ id: model, label: model, detail: "Other model" })),
  ];
  const selfHostedModelSummary = selfHostedSelectedModel || "No model selected";
  const handleOpenRouterModelToggle = useCallback((model: string, selected: boolean) => {
    const modelId = model.trim();
    if (!modelId) return;

    setLocalAiSetup((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      if (selected) {
        if (modelId === primaryModel || fallbackModels.includes(modelId)) return current;
        return { ...current, openRouterFallbackModels: [...fallbackModels, modelId] };
      }

      if (modelId === primaryModel) {
        const [nextPrimaryModel, ...nextFallbackModels] = fallbackModels;
        if (!nextPrimaryModel) return current;
        return { ...current, openRouterModel: nextPrimaryModel, openRouterFallbackModels: nextFallbackModels };
      }

      return { ...current, openRouterFallbackModels: fallbackModels.filter((fallbackModel) => fallbackModel !== modelId) };
    });
  }, []);
  const handleOpenRouterPrimaryModelChange = useCallback((model: string) => {
    const modelId = model.trim();
    if (!modelId) return;

    setLocalAiSetup((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      const selectedModels = uniqueOpenRouterModels([primaryModel, ...fallbackModels, modelId]);
      return { ...current, openRouterModel: modelId, openRouterFallbackModels: selectedModels.filter((selectedModel) => selectedModel !== modelId) };
    });
  }, []);
  const handleAddOpenRouterCustomModel = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const modelId = openRouterCustomModel.trim();
    if (!modelId || isForbiddenOpenRouterModel(modelId)) return;

    setLocalAiSetup((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      if (modelId === primaryModel || fallbackModels.includes(modelId)) return current;
      return { ...current, openRouterFallbackModels: [...fallbackModels, modelId] };
    });
    setOpenRouterCustomModel("");
  }, [openRouterCustomModel]);
  const handleSelfHostedModelChange = useCallback((model: string) => {
    const modelId = model.trim();
    if (!modelId) return;
    setLocalAiSetup((current) => ({ ...current, selfHostedModel: modelId }));
  }, []);
  const handleAddSelfHostedCustomModel = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const modelId = selfHostedCustomModel.trim();
    if (!modelId) return;
    setLocalAiSetup((current) => ({ ...current, selfHostedModel: modelId }));
    setSelfHostedCustomModel("");
  }, [selfHostedCustomModel]);
  const handleSelectLocalAiProvider = useCallback((provider: LocalAiSetupState["provider"]) => {
    setDriftyCloudSetupOpen(false);
    setLocalAiSetup((current) => ({ ...current, provider }));
  }, []);
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
    signInWithEmail,
    signUpWithEmail,
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
  const driftAlarmSnoozeRef = useRef<DriftAlarmBreakSnooze | null>(null);
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
  const driftAlarmPreviewCounterRef = useRef(0);
  const billingEntitlementRequestRef = useRef(0);
  const driftReminderStateRef = useRef<DriftReminderState | null>(null);
  const segmentsRef = useRef<ActivitySegment[]>([]);
  const rendererFocusedRef = useRef(rendererFocused);
  const selectedDayRef = useRef(selectedDay);
  const lastRendererInteractionAtRef = useRef(Date.now());
  const aiClassificationInFlightRef = useRef(false);

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
    const previewSegments = segments.length > 0 ? segments : buildMockEndOfDayReviewSegments(selectedDay);
    void buildEndOfDayReviewEvent({
      day: selectedDay,
      generatedAt: new Date().toISOString(),
      segments: previewSegments,
      isMock: true,
    }).then(showEndOfDayReview);
  }, [buildEndOfDayReviewEvent, segments, selectedDay, showEndOfDayReview]);

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
    }));
  }, [recentDriftAlarmFocusTargets, showDriftAlarm]);

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
    dismissDriftAlarm();

    switch (action.type) {
      case "settings":
        setSettingsSection("notifications");
        navigateToTab("settings");
        return;
      case "manual_correction":
        navigateToTab("classify");
        return;
      case "return_to_focus": {
        const target = currentAlarmEvent?.focusTargets.find((focusTarget) => focusTarget.targetId === action.targetId) ?? null;
        returnToFocusTarget(target);
        return;
      }
      case "start_break": {
        const snoozeUntilMs = Date.now() + action.minutes * 60_000;
        const pausedFromLabel = currentAlarmEvent?.mode === "break_return"
          ? currentAlarmEvent.breakReturn.pausedFromLabel
          : currentAlarmEvent?.contextLabel || "This drift";
        const nextSnooze = {
          untilMs: snoozeUntilMs,
          minutes: action.minutes,
          pausedFromLabel,
          focusTargets: currentAlarmEvent?.focusTargets ?? [],
        } satisfies DriftAlarmBreakSnooze;
        pendingBreakReturnAlarmRef.current = null;
        driftAlarmSnoozeRef.current = nextSnooze;
        setDriftAlarmSnooze(nextSnooze);
        return;
      }
    }
  }, [dismissDriftAlarm, navigateToTab, returnToFocusTarget]);

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
    window.localStorage.setItem(DRIFT_ALERTS_STORAGE_KEY, driftAlertsEnabled ? "1" : "0");
  }, [driftAlertsEnabled]);

  useEffect(() => {
    window.localStorage.setItem(DRIFT_ALERT_DELAY_STORAGE_KEY, String(driftAlertDelaySeconds));
  }, [driftAlertDelaySeconds]);

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
        driftAlarmSnoozeRef.current = null;
        setDriftAlarmSnooze(null);
        lastDriftAlertSegmentRef.current = null;
      });
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [driftAlarmSnooze, selectedDay]);

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
    if (activeTab !== "settings" || settingsSection !== "notifications") return;
    if (!shouldFocusEndOfDayReviewSettingsRef.current) return;

    shouldFocusEndOfDayReviewSettingsRef.current = false;
    const row = endOfDayReviewSettingsRowRef.current;
    if (typeof row?.scrollIntoView === "function") row.scrollIntoView({ block: "center" });
    row?.focus();
  }, [activeTab, settingsSection]);

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

    void listenToNativeDriftAlarmDismissed(clearDriftAlarmEvent).then((unlisten) => {
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
  }, [clearDriftAlarmEvent, dismissWatcherPeek, handleDriftAlarmAction, handleEndOfDayReviewAction, handleWatcherResponse]);

  useEffect(() => {
    if (!driftAlertsEnabled) return;
    if (selectedDay !== logicalTodayIsoDate(startOfDayMinutes)) return;
    if (!status?.running) return;

    const driftCandidates = buildDriftAlarmCandidates({
      segments,
      currentSnapshot,
      classificationOptions: selectedDayClassificationOptions,
      minimumDurationSeconds: driftAlertDelaySeconds,
    });
    const latestDrift = driftCandidates[0] ?? null;
    const activeSnooze = driftAlarmSnoozeRef.current;
    if (activeSnooze !== null) {
      if (Date.now() < activeSnooze.untilMs) return;
      return;
    }

    const pendingBreakReturnAlarm = pendingBreakReturnAlarmRef.current;
    if (pendingBreakReturnAlarm) {
      if (!latestDrift) {
        pendingBreakReturnAlarmRef.current = null;
        lastDriftAlertSegmentRef.current = null;
        return;
      }

      const focusTargets = pendingBreakReturnAlarm.focusTargets.length
        ? pendingBreakReturnAlarm.focusTargets
        : recentDriftAlarmFocusTargets;
      const breakReturnContextLabel = getWatcherContextLabel(latestDrift.segment, latestDrift.category);
      const breakReturnIdContext = latestDrift.alertKey;

      showDriftAlarm(buildBreakReturnAlarmEvent({
        id: `break-return:${breakReturnIdContext}:${pendingBreakReturnAlarm.untilMs}`,
        contextLabel: breakReturnContextLabel,
        driftDurationSeconds: latestDrift.segment.durationSeconds,
        preservedFocusStrikeSeconds: 0,
        generatedAt: new Date().toISOString(),
        focusTargets,
        breakDurationMinutes: pendingBreakReturnAlarm.minutes,
        pausedFromLabel: pendingBreakReturnAlarm.pausedFromLabel,
        nextFocusLabel: focusTargets[0]?.label ?? "your focus",
      }));
      pendingBreakReturnAlarmRef.current = null;
      lastDriftAlertSegmentRef.current = latestDrift?.alertKey ?? null;
      return;
    }

    if (!latestDrift) {
      lastDriftAlertSegmentRef.current = null;
      if (driftAlarmSnoozeRef.current !== null) {
        driftAlarmSnoozeRef.current = null;
        setDriftAlarmSnooze(null);
      }
      return;
    }

    const { alertKey, category, segment } = latestDrift;
    const buildCurrentDriftAlarmEvent = () => {
      const contextLabel = getWatcherContextLabel(segment, category);

      return buildDriftAlarmEvent({
        id: alertKey,
        contextLabel,
        driftDurationSeconds: segment.durationSeconds,
        preservedFocusStrikeSeconds: 0,
        generatedAt: new Date().toISOString(),
        focusTargets: recentDriftAlarmFocusTargets,
      });
    };
    const showCurrentDriftAlarm = () => {
      showDriftAlarm(buildCurrentDriftAlarmEvent());
    };
    const showFallbackDriftAlarm = (notify: boolean) => {
      showCurrentDriftAlarm();
      if (notify) void sendDriftNotification(segment);
    };
    const applyCurrentExtremeNudge = (notifyOnFallback: boolean) => {
      lastDriftAlertSegmentRef.current = alertKey;
      void applyNativeExtremeNudge(buildExtremeNudgeTarget(segment)).then((applied) => {
        if (!applied) {
          if (lastDriftAlertSegmentRef.current === alertKey) showFallbackDriftAlarm(notifyOnFallback);
          return;
        }
        const latestFocusTarget = recentDriftAlarmFocusTargets[0] ?? null;
        void showNativeExtremeNudgeToast(buildExtremeNudgeToastEvent(segment, latestFocusTarget)).catch((error) => console.warn("Failed to show extreme nudge toast", error));
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

    if (lastDriftAlertSegmentRef.current === null) {
      if (extremeNudgeEnabled) {
        applyCurrentExtremeNudge(false);
        return;
      }
      lastDriftAlertSegmentRef.current = alertKey;
      showCurrentDriftAlarm();
      return;
    }
    if (lastDriftAlertSegmentRef.current === alertKey) {
      if (driftAlarmEventRef.current?.id === alertKey) {
        showCurrentDriftAlarm();
      }
      return;
    }

    lastDriftAlertSegmentRef.current = alertKey;
    if (extremeNudgeEnabled) {
      applyCurrentExtremeNudge(true);
      return;
    }
    showCurrentDriftAlarm();
    void sendDriftNotification(segment);
  }, [currentSnapshot, driftAlertDelaySeconds, driftAlertsEnabled, driftAlarmSnooze, extremeNudgeEnabled, recentDriftAlarmFocusTargets, returnToFocusTarget, selectedDay, selectedDayClassificationOptions, segments, showDriftAlarm, startOfDayMinutes, status?.running]);

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
  const shouldShowEndOfDayReviewPreview = import.meta.env.VITE_DRIFTY_END_OF_DAY_REVIEW_PREVIEW === "1";

  useEffect(() => {
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
    () => buildWeeklyBreakdown(insightSegments, insightClassificationOptions),
    [insightClassificationOptions, insightSegments],
  );
  const attentionRhythm = useMemo(
    () => buildAttentionRhythm(insightSegments, insightClassificationOptions),
    [insightClassificationOptions, insightSegments],
  );
  const driftSourceLists = useMemo(
    () => buildInsightSourceLists(insightSegments, "drift", insightClassificationOptions),
    [insightClassificationOptions, insightSegments],
  );
  const focusSourceLists = useMemo(
    () => buildInsightSourceLists(insightSegments, "focus", insightClassificationOptions),
    [insightClassificationOptions, insightSegments],
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
    () => buildClassificationSourceSummaries(classificationSourceSegments),
    [classificationSourceSegments],
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

  const handleShowDriftyCloudSetup = useCallback(() => {
    setDriftyCloudSetupOpen(true);
    if (isSupabaseConfigured && user && hasRequiredAccountAuth && billingEntitlement?.status !== "locked") {
      void refreshBillingEntitlement();
    }
  }, [billingEntitlement?.status, hasRequiredAccountAuth, isSupabaseConfigured, refreshBillingEntitlement, user]);

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
    setSettingsSection("aiSetup");
    setDriftyCloudSetupOpen(isCloudBillingVariant(variant));
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

  function handleCmdNav(tabId: TabId) { navigateToTab(tabId); setCmdOpen(false); }

  const startOfDayValue = minutesToHourlyStartOfDayValue(startOfDayMinutes);
  const handleStartOfDayChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setStartOfDayMinutes(hourlyStartOfDayValueToMinutes(event.target.value));
  }, []);
  const handleStartOfWeekChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setStartOfWeek(isStartOfWeek(event.target.value) ? event.target.value : DEFAULT_START_OF_WEEK);
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
  const handleDownloadDebugLogs = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      selectedDay,
      settings: {
        startOfDayMinutes,
        startOfWeek,
        theme,
        categoryColorOverrides,
        appThemeColorOverrides,
      },
      tracker: {
        running: status?.running ?? null,
        lastEventAt: status?.lastEventAt ?? null,
        databasePath: status?.databasePath ?? null,
        accessibilityGranted,
      },
      counts: {
        todaySegments: segments.length,
        historySegments: historySegments.length,
        leaderboardSegments: leaderboardSegments.length,
      },
      error,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `drifty-debug-log-${payload.exportedAt.replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [accessibilityGranted, appThemeColorOverrides, categoryColorOverrides, error, historySegments.length, leaderboardSegments.length, segments.length, selectedDay, startOfDayMinutes, startOfWeek, status?.databasePath, status?.lastEventAt, status?.running, theme]);

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
            {focusDriftHover ? <FocusDriftHoverCard hover={focusDriftHover} /> : null}
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
  const cloudSetupActionLabel = driftyCloudSetupActionLabel(effectiveBillingEntitlement, effectiveIsSupabaseConfigured, effectiveHasRequiredAccountAuth);
  const shouldShowCloudCheckoutPlans = effectiveBillingEntitlement?.status === "locked";
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
          <AiConnectionStatusBar status={aiConnectionStatus} />
          <WindowThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>
      {/* ── Sidebar ── */}
      {activeTab === "settings" ? (
        <SettingsSidebar
          activeSection={settingsSection}
          isCollapsed={isSidebarVisuallyCollapsed}
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

        <div className="nav-label">Workspace</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {workspaceNav.map((item) => (
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
        {activeTab === "classify" ? (
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
                                  <span>{item.sessionCount} {item.sessionCount === 1 ? "session" : "sessions"} · {formatCompactDurationFromSeconds(item.averageSessionSeconds)} avg</span>
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

        {/* Insights */}
        {activeTab === "drift" ? (
          <div className="page insights-page">
            <div className="pg-head insights-page__head">
              <div>
                <div className="eyebrow">Insights</div>
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
          </div>
        ) : null}

        {/* Leaderboard */}
        {activeTab === "leaderboard" ? (
          <div className="page">
            <div className="pg-head">
              <div>
                <div className="eyebrow">Leaderboard</div>
                <h1>Leaderboard</h1>
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
                      <div className="settings-row"><label><div className="lbl">Start of day</div><div className="desc">Treat days as starting on this hour. Default is 4:00 AM.</div></label><div className="ctrl"><select className="settings-input settings-select" aria-label="Start of day" value={startOfDayValue} onChange={handleStartOfDayChange}>{START_OF_DAY_OPTIONS.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}</select></div></div>
                      <div className="settings-row"><label><div className="lbl">Start of week</div><div className="desc">Choose the first day shown for weekly views.</div></label><div className="ctrl"><select className="settings-input settings-select" aria-label="Start of week" value={startOfWeek} onChange={handleStartOfWeekChange}>{START_OF_WEEK_OPTIONS.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}</select></div></div>
                      <div className="settings-row"><div><div className="lbl">Theme</div><div className="desc">Matches the titlebar theme switch.</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label="Theme"><button type="button" className={`settings-mode-option${theme === "light" ? " is-active" : ""}`} role="radio" aria-checked={theme === "light"} onClick={() => setTheme("light")}><span>Light</span></button><button type="button" className={`settings-mode-option${theme === "dark" ? " is-active" : ""}`} role="radio" aria-checked={theme === "dark"} onClick={() => setTheme("dark")}><span>Dark</span></button></div></div></div>
                    </div>
                    <div className="settings-block"><h3>Updates</h3>
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
                      <div className="settings-row"><div><div className="lbl">Debug logs</div><div className="desc">Download a local JSON bundle with safe app status and setting values.</div></div><div className="ctrl"><button type="button" className="settings-btn" onClick={handleDownloadDebugLogs}>Download debug logs</button></div></div>
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
                    <div className="settings-block cloud-overview">
                      <div className="cloud-overview__header">
                        <div>
                          <h3>AI setup</h3>
                        </div>
                        <span className="chip green">Local-first</span>
                      </div>
                      <div className="settings-row settings-row--fallback settings-row--cloud-pricing" role="group" aria-label="Drifty Cloud pricing">
                        <div className="settings-row__summary">
                          <div className="lbl">Drifty Cloud</div>
                          <span className="chip" aria-label={`Drifty Cloud status: ${cloudStatusLabel}`}>{aiServerStatusLabel}</span>
                          {effectiveBillingEntitlementError ? <span className="settings-row__message">{effectiveBillingEntitlementError}</span> : null}
                        </div>
                        <div className="ctrl settings-row__actions">
                          <IndividualPlanCards
                            disabled={isDashboardAiUnavailablePreviewActive}
                            loadingInterval={billingCheckoutLoadingInterval}
                            mode={shouldShowCloudCheckoutPlans ? "checkout" : "display"}
                            onSelectPlan={(billingInterval) => void handleStartDriftyCloudSetup(billingInterval)}
                          />
                          {shouldShowCloudCheckoutPlans ? null : <button type="button" className="settings-btn settings-btn--primary settings-btn--compact" onClick={() => void handleStartDriftyCloudSetup()}>{cloudSetupActionLabel}</button>}
                        </div>
                      </div>
                    </div>
                    <div className="settings-block ai-provider-settings">
                      <div className="cloud-overview__header">
                        <div>
                          <h3>Provider settings</h3>
                        </div>
                        <span className="chip">Saved on this Mac</span>
                      </div>
                      <div className="settings-row settings-row--fallback settings-row--provider-card" role="group" aria-label="OpenRouter BYOK settings">
                        <div>
                          <div className="lbl">OpenRouter BYOK</div>
                        </div>
                        <div className="ctrl settings-row__actions">
                          <button type="button" className={`settings-btn settings-btn--compact${localAiSetup.provider === "openrouter_byok" ? " settings-btn--primary" : ""}`} onClick={() => handleSelectLocalAiProvider("openrouter_byok")}>{localAiSetup.provider === "openrouter_byok" ? "Selected" : "Use OpenRouter"}</button>
                          <input className="settings-input" type="password" autoComplete="off" aria-label="OpenRouter API key" value={localAiSetup.openRouterApiKey} onChange={(event) => setLocalAiSetup((current) => ({ ...current, openRouterApiKey: event.target.value }))} placeholder="sk-or-v1-..." />
                          <div className="model-picker-summary">
                            <div className="model-picker-summary__chips"><span className="chip green">Primary: {openRouterPrimaryModel}</span>{openRouterFallbackModels.length > 0 ? <span className="chip gray">{openRouterFallbackModels.length} fallback{openRouterFallbackModels.length === 1 ? "" : "s"}</span> : null}</div>
                            <button type="button" className="settings-btn" aria-label="Choose OpenRouter models" onClick={() => setOpenRouterModelPickerOpen(true)}>Choose models</button>
                          </div>
                        </div>
                      </div>
                      <div className="settings-row settings-row--fallback settings-row--provider-card" role="group" aria-label="Self-hosted AI settings">
                        <div>
                          <div className="lbl">Self-hosted local AI</div>
                        </div>
                        <div className="ctrl settings-row__actions">
                          <button type="button" className={`settings-btn settings-btn--compact${localAiSetup.provider === "self_hosted" ? " settings-btn--primary" : ""}`} onClick={() => handleSelectLocalAiProvider("self_hosted")}>{localAiSetup.provider === "self_hosted" ? "Selected" : "Use self-hosted"}</button>
                          <input className="settings-input" aria-label="Self-hosted base URL" value={localAiSetup.selfHostedBaseUrl} onChange={(event) => setLocalAiSetup((current) => ({ ...current, selfHostedBaseUrl: event.target.value }))} placeholder="http://localhost:11434/v1" />
                          <div className="model-picker-summary">
                            <div className="model-picker-summary__chips"><span className={selfHostedSelectedModel ? "chip green" : "chip gray"}>{selfHostedModelSummary}</span></div>
                            <button type="button" className="settings-btn" aria-label="Choose self-hosted model" onClick={() => setSelfHostedModelPickerOpen(true)}>Choose model</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {settingsSection === "notifications" && (
                  <div className="settings-section"><div className="settings-block"><h3>Alerts</h3>
                    <div className="settings-row"><div><div className="lbl">Drift alerts</div><div className="desc">Show a drift alarm when current activity is classified as drift.</div></div><div className="ctrl"><Toggle checked={driftAlertsEnabled} onChange={setDriftAlertsEnabled} ariaLabel="Toggle drift alerts" /></div></div>
                    <div className="settings-row"><div><div className="lbl">Drift alert timing</div><div className="desc">Choose how long drift must continue before the alarm appears.</div></div><div className="ctrl"><div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label="Drift alert timing">{DRIFT_ALERT_DELAY_OPTIONS.map((option) => (<button key={option.value} type="button" className={`settings-mode-option${driftAlertDelaySeconds === option.value ? " is-active" : ""}`} role="radio" aria-checked={driftAlertDelaySeconds === option.value} onClick={() => setDriftAlertDelaySeconds(option.value)}><span>{option.label}</span><small>{option.detail}</small></button>))}</div></div></div>
                    <div className="settings-row"><div><div className="lbl settings-label-with-badge">Extreme nudge <span className="settings-beta-badge">Beta</span></div><div className="desc">Beta feature: close the drift browser tab or quit the drift app instead of showing the alarm.</div></div><div className="ctrl"><Toggle checked={extremeNudgeEnabled} onChange={setExtremeNudgeEnabled} ariaLabel="Toggle extreme nudge" /></div></div>
                    <div className="settings-row" role="group" aria-label="End-of-day review" ref={endOfDayReviewSettingsRowRef} tabIndex={-1}><div><div className="lbl">End-of-day review</div><div className="desc">Show a local summary after 6:00 PM when the tracker is running, or preview it now.</div></div><div className="ctrl"><button type="button" className="settings-btn" onClick={handleEndOfDayReviewPreview}>Preview</button></div></div>
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
                    <div className="settings-row"><div><div className="lbl">Peak reminders</div><div className="desc">Remind when peak window starts</div></div><div className="ctrl"><Toggle ariaLabel="Toggle peak reminders" /></div></div>
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
                    <div className="settings-block"><h3>Export</h3>
                      <div className="settings-row"><div><div className="lbl">Export session data</div><div className="desc">All sessions as CSV</div></div><div className="ctrl"><button className="settings-btn">Download CSV</button></div></div>
                    </div>
                  </div>
                )}
            </div>
          </div>
        ) : null}
      </MainContentShell>

      {!isTauriRuntime() ? (
        <>
          <WatcherPeek event={watcherEvent} onDismiss={dismissWatcherPeek} onRespond={handleWatcherResponse} />
          {endOfDayReviewEvent ? (
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
                <DriftAlarm event={driftAlarmEvent} onAction={handleDriftAlarmAction} onCancel={dismissDriftAlarm} />
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

      {openRouterModelPickerOpen ? (
        <div className="auth-modal__overlay" onClick={() => setOpenRouterModelPickerOpen(false)}>
          <section className="auth-modal model-picker-modal" role="dialog" aria-modal="true" aria-labelledby="openrouter-model-picker-title" onClick={(event) => event.stopPropagation()}>
            <div className="auth-modal__header">
              <h2 id="openrouter-model-picker-title">OpenRouter models</h2>
              <p>Drifty sends models in priority order. Your API key stays session-only.</p>
            </div>
            <div className="model-picker-modal__summary" aria-label="Selected OpenRouter model summary">
              <span className="chip green">Primary: {openRouterPrimaryModel}</span>
              <span className="chip gray">{openRouterSelectionSummary}</span>
            </div>
            <div className="model-picker-list" role="group" aria-label="OpenRouter model choices">
              {openRouterModelOptions.map((option) => {
                const isSelected = openRouterSelectedModels.includes(option.id);
                const isPrimary = option.id === openRouterPrimaryModel;
                return (
                  <div key={option.id} className="model-picker-choice" data-selected={isSelected ? "true" : "false"}>
                    <label className="model-picker-choice__select">
                      <input type="checkbox" aria-label={`Select ${option.id}`} checked={isSelected} onChange={(event) => handleOpenRouterModelToggle(option.id, event.target.checked)} />
                      <span><strong>{option.label}</strong><small>{option.id}</small><small>{option.detail}</small></span>
                    </label>
                    {"badge" in option && option.badge ? <span className="chip green">{option.badge}</span> : null}
                    <label className="model-picker-choice__primary">
                      <input type="radio" name="openrouter-primary-model" aria-label={`Use ${option.id} as primary`} checked={isPrimary} disabled={!isSelected} onChange={() => handleOpenRouterPrimaryModelChange(option.id)} />
                      <span>Primary</span>
                    </label>
                  </div>
                );
              })}
            </div>
            <form className="model-picker-custom" onSubmit={handleAddOpenRouterCustomModel}>
              <label htmlFor="openrouter-custom-model">Other model</label>
              <div>
                <input id="openrouter-custom-model" className="settings-input" aria-label="Other OpenRouter model" value={openRouterCustomModel} onChange={(event) => setOpenRouterCustomModel(event.target.value)} placeholder="provider/model-name" />
                <button type="submit" className="settings-btn">Add model</button>
              </div>
            </form>
            <button type="button" className="settings-btn auth-modal__close" onClick={() => setOpenRouterModelPickerOpen(false)}>Close</button>
          </section>
        </div>
      ) : null}

      {selfHostedModelPickerOpen ? (
        <div className="auth-modal__overlay" onClick={() => setSelfHostedModelPickerOpen(false)}>
          <section className="auth-modal model-picker-modal" role="dialog" aria-modal="true" aria-labelledby="self-hosted-model-picker-title" onClick={(event) => event.stopPropagation()}>
            <div className="auth-modal__header">
              <h2 id="self-hosted-model-picker-title">Self-hosted model</h2>
              <p>Pick a common local model or enter the exact model ID returned by your endpoint.</p>
            </div>
            <div className="model-picker-modal__summary" aria-label="Selected self-hosted model summary">
              <span className={selfHostedSelectedModel ? "chip green" : "chip gray"}>{selfHostedModelSummary}</span>
            </div>
            <div className="model-picker-list" role="radiogroup" aria-label="Self-hosted model choices">
              {selfHostedModelOptions.map((option) => {
                const isSelected = option.id === selfHostedSelectedModel;
                return (
                  <div key={option.id} className="model-picker-choice model-picker-choice--single" data-selected={isSelected ? "true" : "false"}>
                    <label className="model-picker-choice__select">
                      <input type="radio" name="self-hosted-model" aria-label={`Use ${option.id}`} checked={isSelected} onChange={() => handleSelfHostedModelChange(option.id)} />
                      <span><strong>{option.label}</strong><small>{option.id}</small><small>{option.detail}</small></span>
                    </label>
                  </div>
                );
              })}
            </div>
            <form className="model-picker-custom" onSubmit={handleAddSelfHostedCustomModel}>
              <label htmlFor="self-hosted-custom-model">Other model</label>
              <div>
                <input id="self-hosted-custom-model" className="settings-input" aria-label="Other self-hosted model" value={selfHostedCustomModel} onChange={(event) => setSelfHostedCustomModel(event.target.value)} placeholder="model-name" />
                <button type="submit" className="settings-btn">Use model</button>
              </div>
            </form>
            <button type="button" className="settings-btn auth-modal__close" onClick={() => setSelfHostedModelPickerOpen(false)}>Close</button>
          </section>
        </div>
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
          onStartCloudTrialWithEmail={(email, password, mode) =>
            mode === "sign-up" ? signUpWithEmail(email, password) : signInWithEmail(email, password)
          }
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

      {availableUpdate ? (
        <div className="auth-modal__overlay" onClick={() => setAvailableUpdate(null)}>
          <section className="auth-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="available-update-title" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal__header">
              <div>
                <span className="label-mono">Signed update</span>
                <h2 id="available-update-title">Drifty {availableUpdate.version} is available</h2>
              </div>
            </div>
            {availableUpdate.date ? <p className="capture-recency">Published {new Date(availableUpdate.date).toLocaleString()}</p> : null}
            <p className="profile-modal__bio">{availableUpdate.body?.trim() || "No release notes were provided."}</p>
            {updaterError ? <p className="capture-recency capture-recency--error" role="status">{updaterError}</p> : null}
            <div className="profile-editor-modal__actions">
              <button type="button" className="ghost-button" onClick={() => setAvailableUpdate(null)} disabled={updaterInstalling}>Not now</button>
              <button type="button" className="settings-btn" onClick={() => void handleInstallUpdate()} disabled={updaterChecking || updaterInstalling}>{updaterInstalling ? "Installing..." : "Install and restart"}</button>
            </div>
          </section>
        </div>
      ) : null}

    </div>
  );
}

function ProfileModal({
  row,
  profile,
  isLoading,
  error,
  onClose,
}: {
  row: LeaderboardRow;
  profile: PublicProfile | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const displayName = profile?.display_name || row.display_name;
  const bio = profile?.bio?.trim();
  const focusSeconds = row.focus_seconds;
  const rank = row.rank;
  const periodFocusLabel = getLeaderboardPeriodFocusLabel(row.period);

  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal profile-modal" aria-labelledby="public-profile-title" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal__header">
          {profile?.avatar_url ? <img className="profile-modal__avatar" src={profile.avatar_url} alt="" aria-hidden="true" /> : <div className="profile-modal__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</div>}
          <div>
            <span className="label-mono">Leaderboard profile</span>
            <h2 id="public-profile-title">{displayName}</h2>
          </div>
        </div>
        {isLoading ? <p className="capture-recency">Loading public profile…</p> : null}
        {error ? <p className="capture-recency capture-recency--error">{error}</p> : null}
        <p className="profile-modal__bio">{bio || "No public bio yet."}</p>
        <ProfileSocialLinks profile={profile ?? { website_url: null, github_url: null, linkedin_url: null }} />
        <div className="profile-modal__stats" aria-label={`${displayName} leaderboard stats`}>
          <MetricTile label="Rank" value={`#${rank}`} detail="Current period board" />
          <MetricTile label="Focus" value={formatCompactDurationFromSeconds(focusSeconds)} detail={periodFocusLabel} />
          <MetricTile label="Updated" value={formatRelativeTime(row.updated_at)} />
        </div>
        <p className="profile-modal__privacy">Only public profile fields and aggregate leaderboard totals are shown. Raw app, site, window, and session history is not shown on your public profile.</p>
        <button type="button" className="settings-btn auth-modal__close" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}

function EditProfileModal({
  displayName,
  avatarUrl,
  profileDraft,
  profileLoading,
  profileSaving,
  profileMessage,
  profileError,
  onClose,
  onPhotoSelected,
  onRemovePhoto,
  onChange,
  onSave,
}: {
  displayName: string;
  avatarUrl: string;
  profileDraft: { displayName: string; bio: string; avatarUrl: string; websiteUrl: string; githubUrl: string; linkedinUrl: string; isPublic: boolean };
  profileLoading: boolean;
  profileSaving: boolean;
  profileMessage: string | null;
  profileError: string | null;
  onClose: () => void;
  onPhotoSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: () => void;
  onChange: (updater: Partial<{ displayName: string; bio: string; avatarUrl: string; websiteUrl: string; githubUrl: string; linkedinUrl: string; isPublic: boolean }>) => void;
  onSave: () => void;
}) {
  return (
    <div className="auth-modal__overlay" onClick={onClose}>
      <section className="auth-modal profile-modal profile-editor-modal" aria-labelledby="edit-profile-title" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal__header">
          {avatarUrl.trim() ? <img className="profile-modal__avatar" src={avatarUrl} alt="" aria-hidden="true" /> : <div className="profile-modal__avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</div>}
          <div>
            <span className="label-mono">Edit profile</span>
            <h2 id="edit-profile-title">{displayName}</h2>
          </div>
        </div>

        <div className="leaderboard-profile-sidebar__form">
          <div className="leaderboard-photo-control">
            <span>Profile photo</span>
            <div className="leaderboard-photo-control__actions">
              <label className="settings-btn leaderboard-photo-control__upload">
                Upload photo
                <input type="file" accept="image/*" onChange={onPhotoSelected} disabled={profileLoading || profileSaving} />
              </label>
              {avatarUrl.trim() ? <button type="button" className="ghost-button" onClick={onRemovePhoto} disabled={profileLoading || profileSaving}>Remove</button> : null}
            </div>
            <p>Shown on your public leaderboard profile.</p>
          </div>
          <label><span>Display name</span><input className="settings-input" value={profileDraft.displayName} onChange={(event) => onChange({ displayName: event.target.value })} disabled={profileLoading || profileSaving} /></label>
          <label><span>Bio</span><textarea className="settings-input settings-textarea" value={profileDraft.bio} onChange={(event) => onChange({ bio: event.target.value })} disabled={profileLoading || profileSaving} maxLength={160} /></label>
          <label><span>Website</span><input className="settings-input" value={profileDraft.websiteUrl} onChange={(event) => onChange({ websiteUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
          <label><span>GitHub</span><input className="settings-input" value={profileDraft.githubUrl} onChange={(event) => onChange({ githubUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
          <label><span>LinkedIn</span><input className="settings-input" value={profileDraft.linkedinUrl} onChange={(event) => onChange({ linkedinUrl: event.target.value })} disabled={profileLoading || profileSaving} /></label>
        </div>

        {profileError ? <p className="capture-recency capture-recency--error">{profileError}</p> : null}
        {profileMessage ? <p className="capture-recency">{profileMessage}</p> : null}

        <div className="profile-editor-modal__actions">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="button" className="settings-btn" onClick={onSave} disabled={profileLoading || profileSaving}>{profileSaving ? "Saving…" : "Save profile"}</button>
        </div>
      </section>
    </div>
  );
}

function ProfileSocialLinks({ profile }: { profile: { website_url?: string | null; github_url?: string | null; linkedin_url?: string | null } }) {
  const socialLinks: Array<{ key: string; value?: string | null }> = [
    { key: "website", value: profile.website_url },
    { key: "github", value: profile.github_url },
    { key: "linkedin", value: profile.linkedin_url },
  ];
  const links: Array<{ key: string; href: string; text: string }> = [];

  for (const link of socialLinks) {
    const href = normalizeExternalUrl(link.value);
    if (href) {
      links.push({ key: link.key, href, text: formatExternalLinkText(link.value) });
    }
  }

  if (links.length === 0) return <p className="profile-socials profile-socials--empty">No public links yet.</p>;

  return (
    <div className="profile-socials" aria-label="Public profile links">
      {links.map((link) => <a key={link.key} href={link.href} target="_blank" rel="noreferrer">{link.text}</a>)}
    </div>
  );
}

function normalizeExternalUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function formatAiErrorDetail(usage: AiClassificationUsageSummary): string {
  const parts = [
    usage.lastErrorType ? `type=${usage.lastErrorType}` : null,
    usage.lastErrorStatus ? `status=${usage.lastErrorStatus}` : null,
    usage.lastErrorAt ? `at=${new Date(usage.lastErrorAt).toLocaleString()}` : null,
    usage.lastErrorMessage ? `message=${usage.lastErrorMessage}` : "message unavailable for older errors",
  ].filter(Boolean);
  return parts.join(" · ");
}

function hasAiClassificationUsageMeasurement(usage: AiClassificationUsageSummary): boolean {
  return usage.itemsRequested > 0 || usage.estimatedCostUsd > 0;
}

function formatTokenCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatUsdCost(value: number): string {
  if (value <= 0) return "$0.0000";
  if (value < 0.0001) return "<$0.0001";
  return `$${value.toFixed(4)}`;
}

function formatProjectionMultiplier(value: number): string {
  if (value <= 0) return "0x";
  if (Number.isInteger(value)) return `${value.toLocaleString("en-US")}x`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}x`;
}

function formatExternalLinkText(value?: string | null): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function buildPublicProfileUrl(publicId: string): string {
  return `https://drifty.so/profile/?id=${encodeURIComponent(publicId)}`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("Unable to copy profile link");
  } finally {
    document.body.removeChild(textarea);
  }
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read profile photo"));
      }
    });
    reader.addEventListener("error", () => reject(new Error("Unable to read profile photo")));
    reader.readAsDataURL(file);
  });
}

const ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX = 6;
const ACCOUNT_POPOVER_EXPANDED_GAP_PX = 8;
const ACCOUNT_POPOVER_COLLAPSED_GAP_PX = 10;
const ACCOUNT_POPOVER_COLLAPSED_WIDTH = "14rem";

function AccountMenu({
  billingEntitlement,
  billingEntitlementLoading,
  isOpen,
  isSidebarCollapsed,
  localAiSetup,
  userAvatarUrl,
  userEmail,
  onToggle,
  onUpgrade,
  onSettings,
  onFeedback,
  onSignIn,
  onSignOut,
}: {
  billingEntitlement: BillingEntitlement | null;
  billingEntitlementLoading: boolean;
  isOpen: boolean;
  isSidebarCollapsed: boolean;
  localAiSetup: LocalAiSetupState;
  userAvatarUrl?: string | null;
  userEmail: string | null;
  onToggle: () => void;
  onUpgrade: () => void;
  onSettings: () => void;
  onFeedback: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const isSignedIn = Boolean(userEmail);
  const displayName = isSignedIn ? getAccountDisplayName(userEmail) : "Account";
  const accountStatusLabel = aiConnectionStatusLabel(localAiSetup, billingEntitlement, billingEntitlementLoading, isSignedIn);
  const trimmedUserAvatarUrl = userAvatarUrl?.trim();

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    if (isSidebarCollapsed) {
      setPopoverStyle({
        position: "fixed",
        left: rect.right + ACCOUNT_POPOVER_COLLAPSED_GAP_PX,
        bottom: window.innerHeight - rect.bottom,
        width: ACCOUNT_POPOVER_COLLAPSED_WIDTH,
      });
      return;
    }

    setPopoverStyle({
      position: "fixed",
      left: rect.left - ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX,
      bottom: window.innerHeight - rect.top + ACCOUNT_POPOVER_EXPANDED_GAP_PX,
      width: rect.width + ACCOUNT_POPOVER_EXPANDED_EDGE_OFFSET_PX * 2,
    });
  }, [isSidebarCollapsed]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverStyle(null);
      return;
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen, updatePopoverPosition]);

  const popover = isOpen && popoverStyle ? createPortal(
    <div
      className={isSidebarCollapsed ? "account-popover account-popover--collapsed" : "account-popover"}
      style={popoverStyle}
      role="menu"
      aria-label="Account menu"
    >
      {userEmail ? <div className="account-popover__email" title={userEmail}>{userEmail}</div> : null}
      <button type="button" className="account-menu-item" onClick={onUpgrade} role="menuitem">
        <span className="account-menu-icon">↑</span>
        <span>Drifty Cloud</span>
      </button>
      <button type="button" className="account-menu-item" onClick={onSettings} role="menuitem">
        <span className="account-menu-icon">⚙</span>
        <span>Settings</span>
      </button>
      <button type="button" className="account-menu-item" onClick={onFeedback} role="menuitem">
        <span className="account-menu-icon">✉</span>
        <span>Send feedback</span>
      </button>
      {isSignedIn ? (
        <>
          <div className="account-menu-separator" />
          <button type="button" className="account-menu-item account-menu-item--danger" onClick={onSignOut} role="menuitem">
            <span className="account-menu-icon">↪</span>
            <span>Log out</span>
          </button>
        </>
      ) : (
        <>
          <div className="account-menu-separator" />
          <button type="button" className="account-menu-item" onClick={onSignIn} role="menuitem">
            <span className="account-menu-icon">↗</span>
            <span>Sign in</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="account-menu-shell">
      {popover}
      <button ref={triggerRef} type="button" className="account-trigger" onClick={onToggle} aria-expanded={isOpen} aria-haspopup="menu">
        <span className="account-avatar">{trimmedUserAvatarUrl ? <img src={trimmedUserAvatarUrl} alt="" aria-hidden="true" /> : displayName.charAt(0).toUpperCase()}</span>
        <span className="account-trigger__copy">
          <strong>{displayName}</strong>
          <span>{accountStatusLabel}</span>
        </span>
        <span className="account-trigger__chevron">⌃</span>
      </button>
    </div>
  );
}

function Toggle({ checked, onChange, ariaLabel }: { checked?: boolean; onChange?: (checked: boolean) => void; ariaLabel?: string }) {
  const [internalChecked, setInternalChecked] = useState(false);
  const isControlled = checked !== undefined;
  const isChecked = isControlled ? checked : internalChecked;

  function handleToggle() {
    const nextChecked = !isChecked;
    if (!isControlled) setInternalChecked(nextChecked);
    onChange?.(nextChecked);
  }

  return <button type="button" className={`toggle${isChecked ? " on" : ""}`} onClick={handleToggle} role="switch" aria-checked={isChecked} aria-label={ariaLabel} />;
}

function MetricTile({ label, value, detail, className }: { label: string; value: string; detail?: string; className?: string }) {
  const tileClassName = ["metric-tile", className].filter(Boolean).join(" ");

  return (<div className={tileClassName}><span className="eyebrow">{label}</span><strong>{value}</strong>{detail ? <p>{detail}</p> : null}</div>);
}

const PERSONA_CONTENT: Record<string, { tags: string; copy: [string, string] }> = {
  deep_diver: {
    tags: "Long focus sessions · Low drift · Stable context",
    copy: [
      "You do your best work in long, focused sessions with low drift and minimal context switching.",
      "Your pattern shows strong depth, making you most effective when you protect uninterrupted work blocks.",
    ],
  },
  deep_focus_deep_drift: {
    tags: "Strong focus · Heavy drift · High contrast",
    copy: [
      "You swing between deep focus and heavy drift, with little time spent in the middle.",
      "Channeling the same intensity that fuels your drift into your focus blocks is where your biggest gains are.",
    ],
  },
  drift_diver: {
    tags: "Long drift runs · Low focus · Sticky surfaces",
    copy: [
      "Your time leans toward long drift sessions that are hard to break out of once they start.",
      "Small guardrails at the start of a drift run would reclaim the largest share of your day.",
    ],
  },
  focus_sprinter: {
    tags: "Short focus bursts · Frequent switching · High energy",
    copy: [
      "You focus in short, energetic bursts rather than long stretches of deep work.",
      "Stacking a few sprints back to back would turn your momentum into sustained progress.",
    ],
  },
  reactive_operator: {
    tags: "Communication-heavy · Frequent switching · Responsive",
    copy: [
      "Much of your time goes to communication and reactive work that pulls your attention around.",
      "Carving out one protected block a day would give your deeper work room to breathe.",
    ],
  },
  night_owl: {
    tags: "Late-night focus · Shifted rhythm · Quiet hours",
    copy: [
      "Your most productive hours land late at night, well after the typical workday.",
      "Leaning into your natural night rhythm — while protecting recovery — keeps this pattern sustainable.",
    ],
  },
  balanced_builder: {
    tags: "Even split · Steady rhythm · Adaptable",
    copy: [
      "Your time is split fairly evenly across focus, neutral, and drift, with a steady daily rhythm.",
      "You adapt well to different kinds of work; nudging a bit more time toward focus compounds quickly.",
    ],
  },
};

type FocusProfileAxisKey = "focus_start" | "focus_endurance" | "short_drifts" | "focus_routine" | "balanced_focus";

type FocusProfileAxis = {
  readonly key: FocusProfileAxisKey;
  readonly label: string;
  readonly value: number;
};

const FOCUS_PROFILE_HELP =
  "Focus profile is calculated from focus starts, focus endurance, short drift recovery, focus routine consistency, and balanced focus ratio.";

const FOCUS_ENDURANCE_TARGET_SECONDS = 45 * 60;
const MEANINGFUL_DAILY_FOCUS_SECONDS = 30 * 60;
const STRONG_DAILY_FOCUS_SECONDS = 3 * 60 * 60;
const SHORT_DRIFT_REFERENCE_SECONDS = 20 * 60;
const BALANCED_FOCUS_TARGET = 0.65;
const BALANCED_FOCUS_LOW_TOLERANCE = 0.55;
const BALANCED_FOCUS_HIGH_TOLERANCE = 0.65;

function buildFocusProfileAxes(
  segments: ActivitySegment[],
  classificationOptions: ClassificationOptions,
  metrics: ReturnType<typeof buildProductivityPersona>["metrics"],
): FocusProfileAxis[] {
  const dayStats = buildFocusProfileDayStats(segments, classificationOptions);
  const activeDayCount = dayStats.length;
  const focusStartScore = activeDayCount > 0
    ? calibrateCoverage(dayStats.filter((day) => day.firstProductivity === "focus").length / activeDayCount)
    : metrics.focusShare;
  const focusDays = dayStats.filter((day) => day.focusSeconds >= MEANINGFUL_DAILY_FOCUS_SECONDS).length;
  const dailyFocusAverage = activeDayCount > 0
    ? dayStats.reduce((total, day) => total + day.focusSeconds, 0) / activeDayCount
    : metrics.focusAverageSegmentSeconds;
  const focusRoutineScore = activeDayCount > 0
    ? (calibrateCoverage(focusDays / activeDayCount) * 0.7) + (calibrateSqrt(dailyFocusAverage, STRONG_DAILY_FOCUS_SECONDS) * 0.3)
    : metrics.focusShare;
  const shortDriftScore = metrics.driftSeconds > 0
    ? SHORT_DRIFT_REFERENCE_SECONDS / (SHORT_DRIFT_REFERENCE_SECONDS + metrics.driftAverageSegmentSeconds)
    : 1;
  const focusBalanceTolerance = metrics.focusShare <= BALANCED_FOCUS_TARGET
    ? BALANCED_FOCUS_LOW_TOLERANCE
    : BALANCED_FOCUS_HIGH_TOLERANCE;
  const balancedFocusScore = 1 - clampFocusProfileValue(Math.abs(metrics.focusShare - BALANCED_FOCUS_TARGET) / focusBalanceTolerance);

  return [
    { key: "focus_start", label: "Focus Start", value: clampFocusProfileValue(focusStartScore) },
    { key: "focus_endurance", label: "Focus Endurance", value: calibrateSqrt(metrics.focusAverageSegmentSeconds, FOCUS_ENDURANCE_TARGET_SECONDS) },
    { key: "short_drifts", label: "Short Drifts", value: clampFocusProfileValue(shortDriftScore) },
    { key: "focus_routine", label: "Focus Routine", value: clampFocusProfileValue(focusRoutineScore) },
    { key: "balanced_focus", label: "Balanced Focus", value: clampFocusProfileValue(balancedFocusScore) },
  ];
}

function buildFocusProfileDayStats(segments: ActivitySegment[], classificationOptions: ClassificationOptions): Array<{
  readonly firstProductivity: ProductivityLabel;
  readonly focusSeconds: number;
}> {
  const byDay = new Map<string, { firstProductivity: ProductivityLabel; focusSeconds: number }>();
  const orderedSegments = segments.slice().sort((left, right) => {
    const startedAtOrder = left.startedAt.localeCompare(right.startedAt);
    if (startedAtOrder !== 0) return startedAtOrder;
    return left.id.localeCompare(right.id);
  });

  for (const segment of orderedSegments) {
    const dayKey = logicalDayIsoDateForDate(new Date(segment.startedAt));
    const classification = classifyActivity(segment, classificationOptions);
    const existing = byDay.get(dayKey);
    const focusSeconds = classification.productivity === "focus" ? segment.durationSeconds : 0;

    byDay.set(dayKey, {
      firstProductivity: existing?.firstProductivity ?? classification.productivity,
      focusSeconds: (existing?.focusSeconds ?? 0) + focusSeconds,
    });
  }

  return Array.from(byDay.values());
}

function clampFocusProfileValue(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function calibrateSqrt(value: number, target: number): number {
  if (value <= 0 || target <= 0) return 0;
  return clampFocusProfileValue(Math.sqrt(value / target));
}

function calibrateCoverage(value: number): number {
  return clampFocusProfileValue(0.15 + (0.85 * clampFocusProfileValue(value)));
}

function formatRhythmHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return String(hour > 12 ? hour - 12 : hour);
}

function WeeklyCategoryRow({
  weekly,
  categoryTotals,
  productivityTotals,
  segments,
  classificationOptions,
  appIcons,
}: {
  weekly: WeeklyBreakdownDay[];
  categoryTotals: Array<{ category: ActivityCategory; totalSeconds: number }>;
  productivityTotals: Record<ProductivityLabel, number>;
  segments: ActivitySegment[];
  classificationOptions: ClassificationOptions;
  appIcons: AppIconMap;
}) {
  const [mode, setMode] = useState<WeeklyChartMode>("category");
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const categorySeries = useMemo<DonutCategorySlice[]>(
    () => categoryTotals.map((entry) => ({ category: entry.category, seconds: entry.totalSeconds })),
    [categoryTotals],
  );
  const hasData = weekly.some((day) => day.isActive);
  const chart = useMemo(() => buildWeeklyChartView(weekly, mode, categorySeries), [categorySeries, mode, weekly]);
  const productivityDonut = useMemo(() => buildDonutView("productivity", categorySeries, productivityTotals), [categorySeries, productivityTotals]);
  const categoryDonut = useMemo(() => buildDonutView("category", categorySeries, productivityTotals), [categorySeries, productivityTotals]);

  const hoverPayloads = useMemo(() => {
    const totalSeconds = mode === "productivity"
      ? FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.reduce((sum, productivity) => sum + productivityTotals[productivity], 0)
      : categoryTotals.reduce((sum, entry) => sum + entry.totalSeconds, 0);
    const entries = new Map<string, CompactClassificationHoverPayload>();

    function buildBreakdown(matchesSegment: (segment: ActivitySegment) => boolean) {
      return buildCompactActivityBreakdown(segments.filter(matchesSegment));
    }

    if (mode === "productivity") {
      const productivityEntries = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.map((productivity) => ({
        key: productivity,
        label: productivityLabel(productivity),
        seconds: productivityTotals[productivity],
        color: PRODUCTIVITY_COLORS[productivity],
        dotClassName: `productivity-dot--${productivity}`,
      }));

      for (const entry of productivityEntries) {
        if (entry.seconds <= 0) continue;
        entries.set(entry.key, {
          label: entry.label,
          durationLabel: formatCompactDurationFromSeconds(entry.seconds),
          shareLabel: `${Math.round((entry.seconds / Math.max(totalSeconds, 1)) * 100)}%`,
          dotClassName: entry.dotClassName,
          color: entry.color,
          disableRemoteFavicons: true,
          appBreakdown: buildBreakdown((segment) => classifyActivity(segment, classificationOptions).productivity === entry.key),
        });
      }
    } else {
      for (const entry of categoryTotals) {
        if (entry.totalSeconds <= 0) continue;
        entries.set(entry.category, {
          label: categoryLabel(entry.category),
          durationLabel: formatCompactDurationFromSeconds(entry.totalSeconds),
          shareLabel: `${Math.round((entry.totalSeconds / Math.max(totalSeconds, 1)) * 100)}%`,
          dotClassName: `category-dot--${entry.category}`,
          color: CATEGORY_COLORS[entry.category],
          disableRemoteFavicons: true,
          appBreakdown: buildBreakdown((segment) => classifyActivity(segment, classificationOptions).category === entry.category),
        });
      }
    }

    return entries;
  }, [categoryTotals, classificationOptions, mode, productivityTotals, segments]);

  function showAggregateHover(key: string, x: number, y: number) {
    const payload = hoverPayloads.get(key);
    if (!payload) return;
    setHoveredSegment({ ...payload, x, y });
  }

  function showWeeklySegmentHover(segment: WeeklyChartColumn["segments"][number], weekdayIndex: number, columnSeconds: number, x: number, y: number) {
    const payload = hoverPayloads.get(segment.key);
    if (!payload) return;
    const weekdayDates = new Set<string>();
    const bucketSegments = segments.filter((activitySegment) => {
      const started = new Date(activitySegment.startedAt);
      if (Number.isNaN(started.getTime()) || weekdayOrderIndex(started) !== weekdayIndex) return false;
      weekdayDates.add(localDateKey(started));
      const classification = classifyActivity(activitySegment, classificationOptions);
      return mode === "productivity"
        ? classification.productivity === segment.key
        : classification.category === segment.key;
    });
    const occurrences = Math.max(weekdayDates.size, 1);
    setHoveredSegment({
      ...payload,
      durationLabel: formatCompactDurationFromSeconds(segment.seconds),
      shareLabel: `${Math.round((segment.seconds / Math.max(columnSeconds, 1)) * 100)}%`,
      appBreakdown: buildCompactActivityBreakdown(bucketSegments, occurrences),
      x,
      y,
    });
  }

  function moveSegmentHover(x: number, y: number) {
    setHoveredSegment((current) => current ? { ...current, x, y } : current);
  }

  return (
    <div className="insights-row--weekly-categories">
      <section className="editorial-panel editorial-panel--soft insight-section productivity-insight-groups__weekly-trend weekly-productivity-trend-card" aria-label="Weekly focus and drift trend">
        <div className="weekly-productivity-trend-card__head">
          <div><span className="label-mono insight-section__label">Weekly Breakdown</span></div>
          <div className="wt-toggle" role="tablist">
            <button type="button" className={`wt-toggle-btn${mode === "productivity" ? " is-active" : ""}`} data-mode="productivity" onClick={() => setMode("productivity")}>Productivity</button>
            <button type="button" className={`wt-toggle-btn${mode === "category" ? " is-active" : ""}`} data-mode="category" onClick={() => setMode("category")}>Category</button>
          </div>
        </div>
        {hasData ? (
          <div className="wt-plot">
            <div className="wt-grid">
              {chart.gridlines.map((line) => (
                <div className="wt-gridline" style={{ top: `${line.topPct}%` }} key={`gl-${line.label}-${line.topPct}`}><span className="wt-gridlabel">{line.label}</span></div>
              ))}
              {[14.2857, 28.5714, 42.8571, 57.1429, 71.4286, 85.7143].map((left) => (
                <div className="wt-vline" style={{ left: `${left}%` }} key={`vl-${left}`} />
              ))}
            </div>
            <div className="wt-cols">
              {chart.columns.map((column, index) => (
                <div className={`wt-col${column.off ? " wt-col--off" : ""}`} key={`${column.weekday}-${index}`}>
                  <div className="wt-bars-zone">
                    {column.off ? null : (
                      <div className="wt-bar" style={{ height: `${column.barHeightPct}%` }}>
                        {column.segments.map((segment) => (
                          <div
                            className="wt-seg"
                            style={{ height: `${segment.heightPct}%`, background: segment.color }}
                            key={segment.key}
                            onMouseEnter={(event: MouseEvent<HTMLDivElement>) => showWeeklySegmentHover(segment, index, column.totalSeconds, event.clientX, event.clientY)}
                            onMouseMove={(event: MouseEvent<HTMLDivElement>) => moveSegmentHover(event.clientX, event.clientY)}
                            onMouseLeave={() => setHoveredSegment(null)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="wt-daylabel">{column.weekday}</div>
                </div>
              ))}
            </div>
          </div>
        ) : <EmptyState title="No weekly trend yet" detail="Weekly focus and drift totals appear after activity is recorded." />}
      </section>
      <section className="editorial-panel editorial-panel--soft insight-section od-cat-rebuilt weekly-summary-rail weekly-breakdown-analytical is-linked" aria-label="Insight weekly summaries">
        {productivityDonut.rows.length > 0 || categoryDonut.rows.length > 0 ? (
          <div className="weekly-summary-rail__stack weekly-breakdown-analytical__stack">
            <WeeklyDonutSummary
              ariaLabel="Insight productivity breakdown"
              className="weekly-summary-rail__summary--productivity weekly-breakdown-analytical__productivity productivity-donut-compact"
              view={productivityDonut}
              onShowHover={showAggregateHover}
              onMoveHover={moveSegmentHover}
              onHideHover={() => setHoveredSegment(null)}
            />
            <WeeklyCategoryBreakdown
              ariaLabel="Insight category breakdown"
              view={categoryDonut}
              onShowHover={showAggregateHover}
              onMoveHover={moveSegmentHover}
              onHideHover={() => setHoveredSegment(null)}
            />
          </div>
        ) : <EmptyState title="No weekly split yet" detail="Weekly focus and category totals appear once activity is recorded." />}
      </section>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}

function WeeklyDonutSummary({
  ariaLabel,
  className,
  view,
  onShowHover,
  onMoveHover,
  onHideHover,
}: {
  ariaLabel: string;
  className: string;
  view: DonutView;
  onShowHover: (key: string, x: number, y: number) => void;
  onMoveHover: (x: number, y: number) => void;
  onHideHover: () => void;
}) {
  return (
    <div className={`weekly-summary-rail__summary ${className}`} role="group" aria-label={ariaLabel}>
      <div className="od-cat-body">
        <div className="od-cat-left">
          <div className="od-cat-donut-wrap">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="40" fill="none" style={{ stroke: "rgba(0,0,0,0.07)" }} strokeWidth="17" />
              {view.slices.map((slice) => (
                <circle
                  key={slice.key}
                  className="od-cat-donut-slice"
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  style={{ stroke: slice.color }}
                  strokeWidth="17"
                  strokeLinecap="butt"
                  strokeDasharray={`${slice.dash.toFixed(2)} ${DONUT_CIRCUMFERENCE.toFixed(2)}`}
                  strokeDashoffset={slice.offset.toFixed(2)}
                  transform="rotate(-90 50 50)"
                  onMouseEnter={(event: MouseEvent<SVGCircleElement>) => onShowHover(slice.key, event.clientX, event.clientY)}
                  onMouseMove={(event: MouseEvent<SVGCircleElement>) => onMoveHover(event.clientX, event.clientY)}
                  onMouseLeave={onHideHover}
                />
              ))}
            </svg>
            <div className="od-cat-center">
              <span className="od-cat-center-pct">{view.centerPct}</span>
              <span className="od-cat-center-label">{view.centerLabel}</span>
            </div>
          </div>
        </div>
        <div className="od-cat-right">
          {view.rows.map((row) => (
            <div
              className="od-cat-row"
              key={row.key}
              onMouseEnter={(event: MouseEvent<HTMLDivElement>) => onShowHover(row.key, event.clientX, event.clientY)}
              onMouseMove={(event: MouseEvent<HTMLDivElement>) => onMoveHover(event.clientX, event.clientY)}
              onMouseLeave={onHideHover}
            >
              <div className="od-cat-row-head">
                <span className="od-cat-row-dot" style={{ background: row.color }} aria-hidden="true" />
                <span className="od-cat-row-name">{row.name}</span>
                <div className="od-cat-row-meta">
                  <span className="od-cat-row-time">{row.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeeklyCategoryBreakdown({
  ariaLabel,
  view,
  onShowHover,
  onMoveHover,
  onHideHover,
}: {
  ariaLabel: string;
  view: DonutView;
  onShowHover: (key: string, x: number, y: number) => void;
  onMoveHover: (x: number, y: number) => void;
  onHideHover: () => void;
}) {
  return (
    <div className="weekly-summary-rail__summary weekly-summary-rail__summary--category top-categories-breakdown" role="group" aria-label={ariaLabel}>
      <span className="weekly-breakdown-analytical__eyebrow">Top categories</span>
      <div className="top-categories-breakdown__list">
        {view.rows.map((row) => (
          <div
            className="top-categories-breakdown__row"
            key={row.key}
            onMouseEnter={(event: MouseEvent<HTMLDivElement>) => onShowHover(row.key, event.clientX, event.clientY)}
            onMouseMove={(event: MouseEvent<HTMLDivElement>) => onMoveHover(event.clientX, event.clientY)}
            onMouseLeave={onHideHover}
          >
            <div className="top-categories-breakdown__meta">
              <span>{row.name}</span>
              <strong>{Math.round(row.pct)}%</strong>
            </div>
            <div className="top-categories-breakdown__bar">
              <span style={{ width: `${Math.max(row.fillPct, 3)}%`, background: row.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttentionRhythmCard({
  appIcons,
  cells,
  classificationOptions,
  segments,
}: {
  appIcons: AppIconMap;
  cells: AttentionRhythmCell[];
  classificationOptions: ClassificationOptions;
  segments: ActivitySegment[];
}) {
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const hasData = cells.some((cell) => cell.intensity > 0);
  const totalSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);

  function showCellHover(cell: AttentionRhythmCell, x: number, y: number) {
    if (cell.intensity <= 0 || cell.state === "neutral") return;
    const matchingSegments = segments.filter((segment) => {
      const started = new Date(segment.startedAt);
      return !Number.isNaN(started.getTime())
        && weekdayOrderIndex(started) === cell.weekdayIndex
        && started.getHours() === cell.hour
        && classifyActivity(segment, classificationOptions).productivity === cell.state;
    });
    const cellSeconds = matchingSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    if (cellSeconds <= 0) return;
    setHoveredSegment({
      label: productivityLabel(cell.state),
      durationLabel: formatCompactDurationFromSeconds(cellSeconds),
      shareLabel: `${Math.round((cellSeconds / Math.max(totalSeconds, 1)) * 100)}%`,
      dotClassName: `productivity-dot--${cell.state}`,
      color: PRODUCTIVITY_COLORS[cell.state],
      disableRemoteFavicons: true,
      appBreakdown: buildCompactActivityBreakdown(matchingSegments),
      x,
      y,
    });
  }

  function moveCellHover(x: number, y: number) {
    setHoveredSegment((current) => current ? { ...current, x, y } : current);
  }

  return (
    <section id="insights-weekly-attention-rhythm" className="editorial-panel editorial-panel--soft insight-section productivity-rhythm-card productivity-rhythm-card--attention" aria-label="Weekly attention rhythm">
      <div className="productivity-rhythm-card__head productivity-rhythm-card__head--attention">
        <div><span className="label-mono insight-section__label">Weekly attention rhythm</span></div>
        <div className="productivity-rhythm-card__legend" aria-hidden="true">
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--focus" /><span>Focus</span></span>
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--drift" /><span>Drift</span></span>
          <span className="productivity-rhythm-card__legend-item"><span className="productivity-rhythm-card__legend-dot productivity-rhythm-card__legend-dot--neutral" /><span>Neutral</span></span>
        </div>
      </div>
      {hasData ? (
        <div className="productivity-rhythm-card__grid" role="img" aria-label="Weekly attention rhythm dominant focus or drift by weekday and time block">
          <div className="productivity-rhythm-card__times">
            <span />
            {Array.from({ length: 24 }, (_, hour) => <span key={hour}>{formatRhythmHourLabel(hour)}</span>)}
          </div>
          <div className="productivity-rhythm-card__body">
            <div className="productivity-rhythm-card__weekdays" aria-hidden="true">
              {WEEKLY_BREAKDOWN_WEEKDAYS.map((weekday) => <span className="productivity-rhythm-card__weekday" key={weekday}>{weekday}</span>)}
            </div>
            <div className="productivity-rhythm-card__board">
              {cells.map((cell) => {
                const variant = cell.state === "neutral" ? "neutral" : `${cell.state}-${cell.intensity}`;
                const parts: string[] = [];
                if (cell.hour !== 23) parts.push("inset -1px 0 0 var(--attention-rhythm-divider)");
                if (cell.weekdayIndex !== 6) parts.push("inset 0 -1px 0 var(--attention-rhythm-divider)");
                return (
                  <span
                    key={`${cell.weekdayIndex}-${cell.hour}`}
                    className={`productivity-rhythm-card__cell productivity-rhythm-card__cell--${variant}`}
                    style={parts.length > 0 ? { boxShadow: parts.join(", ") } : undefined}
                    onMouseEnter={(event: MouseEvent<HTMLSpanElement>) => showCellHover(cell, event.clientX, event.clientY)}
                    onMouseMove={(event: MouseEvent<HTMLSpanElement>) => moveCellHover(event.clientX, event.clientY)}
                    onMouseLeave={() => setHoveredSegment(null)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      ) : <EmptyState title="No rhythm yet" detail="The weekly attention rhythm appears after activity is recorded across the insight window." />}
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </section>
  );
}

function InsightSourceGroup({
  variant,
  lists,
  appIcons,
}: {
  variant: ProductivityAnalysisKind;
  lists: InsightSourceLists;
  appIcons: AppIconMap;
}) {
  const tone = variant === "drift" ? "var(--warn)" : "var(--accent)";
  const label = variant === "drift" ? "Drift patterns" : "Focus patterns";
  const topicsLabel = variant === "drift" ? "Drift after focus" : "Focus before drift";
  const transitionsLabel = variant === "drift" ? "Top drift after focus transitions" : "Top focus before drift transitions";
  const appsLabel = variant === "drift" ? "Drift apps" : "Focus apps";
  const toneStyle = { "--trend-tone": tone } as CSSProperties;

  const renderSourceList = (
    kind: keyof InsightSourceLists,
    sourceLabel: string,
    emptyTitle: string,
    emptyDetail: string,
  ) => {
    const items = lists[kind];
    const maxValue = Math.max(1, ...items.map((item) => insightSourceValue(item)));

    return (
      <div className="drift-time-trend__sources">
        <span className="label-mono drift-time-trend__sources-label">{sourceLabel}</span>
        <div className="drift-time-trend__sources-items" style={toneStyle}>
          {items.map((item, index) => (
            <div className="drift-time-trend__sources-item drift-time-trend__sources-item--app" key={item.id}>
              <span className="drift-time-trend__sources-rank" aria-hidden="true">{index + 1}</span>
              <span className="drift-time-trend__sources-icon" aria-hidden="true">
                {item.isSite && item.siteDomain
                  ? <SiteFavicon domain={item.siteDomain} size={14} fallbackIconSrc={appIcons[item.bundleId ?? item.appName] ?? null} />
                  : <AppGlyph appName={item.appName} iconSrc={appIcons[item.bundleId ?? item.appName] ?? null} size="sm" />}
              </span>
              <span className="drift-time-trend__sources-name">{item.label}</span>
              <strong className="drift-time-trend__sources-value">{formatInsightSourceValue(item)}</strong>
              <div className="drift-source-bar"><div className="drift-source-bar__fill" style={{ width: `${Math.max((insightSourceValue(item) / maxValue) * 100, 3)}%` }} /></div>
            </div>
          ))}
          {items.length === 0 ? <EmptyState title={emptyTitle} detail={emptyDetail} /> : null}
        </div>
      </div>
    );
  };

  return (
    <section className={`editorial-panel editorial-panel--soft insight-section productivity-insight-group productivity-insight-group--${variant}`} aria-label={`${variant === "drift" ? "Drift" : "Focus"} patterns`}>
      <div className="productivity-insight-group__head"><span className="label-mono insight-section__label">{label}</span></div>
      <section className="editorial-panel editorial-panel--soft insight-section trend-topics-card productivity-insight-group__section" aria-label={transitionsLabel} style={toneStyle}>
        <div className="trend-topics-card__columns">
          {renderSourceList("apps", appsLabel, `No ${variant} apps yet`, "Apps appear after classified activity is recorded.")}
          {renderSourceList("topics", topicsLabel, `No ${variant} transitions yet`, "Transitions appear after focus is followed by drift.")}
        </div>
      </section>
    </section>
  );
}

function ProductivityPersonaCard({
  classificationOptions = {},
  report,
  hasData,
  segments = [],
  variant = "profile",
}: {
  classificationOptions?: ClassificationOptions;
  report: ReturnType<typeof buildProductivityPersona>;
  hasData: boolean;
  segments?: ActivitySegment[];
  variant?: "profile" | "radar";
}) {
  const content = PERSONA_CONTENT[report.personaId] ?? PERSONA_CONTENT.balanced_builder;
  const activeDays = report.metrics.activeDays;
  const tagPills = content.tags.split(" · ");
  const radarCenter = { x: 150, y: 116 };
  const radarRadius = 86;
  const radarAxes = buildFocusProfileAxes(segments, classificationOptions, report.metrics);
  const pointFor = (index: number, value: number, radius = radarRadius) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / radarAxes.length;
    return {
      x: radarCenter.x + Math.cos(angle) * radius * value,
      y: radarCenter.y + Math.sin(angle) * radius * value,
    };
  };
  const polygonPoints = (value: number) => radarAxes.map((_, index) => {
    const point = pointFor(index, value);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
  const radarShape = radarAxes.map((axis, index) => {
    const point = pointFor(index, axis.value);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
  const radarLabel = `${report.personaName} persona radar: ${radarAxes.map((axis) => `${axis.label} ${formatSharePercent(axis.value * 100)}`).join(", ")}`;
  const renderRadarLabel = (axis: FocusProfileAxis, index: number) => {
    const point = pointFor(index, 1, radarRadius + 22);
    const x = point.x.toFixed(1);
    const y = point.y.toFixed(1);
    const labelParts = axis.label.split(" ");

    return (
      <text className="persona-radar__label" x={x} y={y} textAnchor="middle" dominantBaseline="middle" key={axis.key}>
        {labelParts.map((part, partIndex) => (
          <tspan x={x} dy={partIndex === 0 ? "0" : "1.12em"} key={`${axis.key}-${part}`}>
            {part}
          </tspan>
        ))}
        <tspan className="persona-radar__label-value" x={x} dy="1.38em">
          {formatSharePercent(axis.value * 100)}
        </tspan>
      </text>
    );
  };
  const cardClassName = [
    "editorial-panel editorial-panel--soft insight-section productivity-persona-card",
    hasData && variant === "profile" ? "persona-profile-card" : null,
    hasData && variant === "radar" ? "productivity-persona-card--radar-only" : null,
  ].filter(Boolean).join(" ");

  return (
    <section className={cardClassName} aria-label="Local productivity persona report">
      {hasData && variant === "radar" ? (
        <div className="persona-radar-card">
          <div className="persona-radar-card__head">
            <span className="label-mono insight-section__label">Focus profile</span>
            <span className="persona-radar-card__help-wrap">
              <button type="button" className="persona-radar-card__help" aria-label="Focus profile help" aria-describedby="focus-profile-help-tooltip">?</button>
              <span className="persona-radar-card__tooltip" id="focus-profile-help-tooltip" role="tooltip">{FOCUS_PROFILE_HELP}</span>
            </span>
          </div>
          <div className="persona-radar-card__chart">
            <svg className="persona-radar" viewBox="0 0 300 232" role="img" aria-label={radarLabel}>
              {[1, 0.8, 0.6, 0.4, 0.2].map((level) => <polygon className="persona-radar__grid" points={polygonPoints(level)} key={level} />)}
              {radarAxes.map((axis, index) => {
                const point = pointFor(index, 1);
                return <line className="persona-radar__axis" x1={radarCenter.x} y1={radarCenter.y} x2={point.x.toFixed(1)} y2={point.y.toFixed(1)} key={axis.key} />;
              })}
              <polygon className="persona-radar__shape" points={radarShape} />
              {radarAxes.map((axis, index) => {
                const point = pointFor(index, axis.value);
                return <circle className="persona-radar__point" cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r="2.35" key={axis.key} />;
              })}
              {radarAxes.map(renderRadarLabel)}
            </svg>
          </div>
        </div>
      ) : hasData ? (
        <>
          <div className="persona-profile-card__identity">
            <div className="persona-profile-card__intro">
              <span className="label-mono insight-section__label">Productivity persona</span>
              <h2 className="persona-profile-card__title">{report.personaName}</h2>
              <p className="persona-profile-card__subtitle productivity-persona-card__copy">{content.copy[0]}</p>
              <p className="productivity-persona-card__copy">{content.copy[1]}</p>
              <div className="persona-profile-card__tags" aria-label="Persona traits">
                {tagPills.map((tag) => <span className="persona-profile-card__tag" key={tag}>{tag}</span>)}
              </div>
              <span className="chip green productivity-persona-card__badge">Based on {activeDays} active {activeDays === 1 ? "day" : "days"}</span>
            </div>
          </div>
          <div className="persona-radar-card">
            <div className="persona-radar-card__chart">
              <svg className="persona-radar" viewBox="0 0 300 232" role="img" aria-label={radarLabel}>
                {[1, 0.8, 0.6, 0.4, 0.2].map((level) => <polygon className="persona-radar__grid" points={polygonPoints(level)} key={level} />)}
                {radarAxes.map((axis, index) => {
                  const point = pointFor(index, 1);
                  return <line className="persona-radar__axis" x1={radarCenter.x} y1={radarCenter.y} x2={point.x.toFixed(1)} y2={point.y.toFixed(1)} key={axis.key} />;
                })}
                <polygon className="persona-radar__shape" points={radarShape} />
                {radarAxes.map((axis, index) => {
                  const point = pointFor(index, axis.value);
                  return <circle className="persona-radar__point" cx={point.x.toFixed(1)} cy={point.y.toFixed(1)} r="2.35" key={axis.key} />;
                })}
                {radarAxes.map(renderRadarLabel)}
              </svg>
            </div>
            <div className="persona-radar-card__axis-list" aria-hidden="true">
              {radarAxes.map((axis) => <span key={axis.key}>{axis.label}<strong>{formatSharePercent(axis.value * 100)}</strong></span>)}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="productivity-persona-card__head">
            <div>
              <span className="label-mono insight-section__label">Productivity persona</span>
              <h2>Waiting for local patterns</h2>
            </div>
          </div>
          <EmptyState title="No persona yet" detail="The local report appears after tracker history exists in this insight window." />
        </>
      )}
    </section>
  );
}

function ProductivityAnalysisSection({
  appIcons,
  ariaLabel,
  emptyDetail,
  emptyTitle,
  heading,
  label,
  metricLabel,
  patternsLabel,
  report,
  sourcesLabel,
  variant,
}: {
  appIcons: AppIconMap;
  ariaLabel: string;
  emptyDetail: string;
  emptyTitle: string;
  heading: string;
  label: string;
  metricLabel: string;
  patternsLabel: string;
  report: ProductivityInsightReport;
  sourcesLabel: string;
  variant: ProductivityAnalysisKind;
}) {
  return (
    <section className={`editorial-panel editorial-panel--soft insight-section insight-section--source-analysis insight-section--${variant}-analysis`} aria-label={ariaLabel}>
      <div className="drift-analysis__head">
        <div>
          <span className="label-mono insight-section__label">{label}</span>
          <h2>{heading}</h2>
        </div>
        <span className="drift-analysis__badge">Local 90d signal</span>
      </div>
      {report.totalSeconds > 0 ? (
        <div className="drift-analysis__layout">
          <div className="drift-analysis__sources" aria-label={sourcesLabel}>
            {report.topSurfaces.map((surface, index) => (
              <div className="drift-source-row" key={surface.id}>
                <div className="drift-source-row__rank">{index + 1}</div>
                <div className="drift-source-row__icon" aria-hidden="true">
                  {surface.siteDomain ? (
                    <SiteFavicon domain={surface.siteDomain} size={20} fallbackIconSrc={appIcons[surface.bundleId ?? surface.appName] ?? null} />
                  ) : (
                    <AppGlyph appName={surface.label} iconSrc={appIcons[surface.bundleId ?? surface.appName] ?? null} size="sm" />
                  )}
                </div>
                <div className="drift-source-row__body">
                  <div className="drift-source-row__title"><strong>{surface.label}</strong><span>{surface.detail}</span></div>
                  <div className="drift-source-row__bar"><span style={{ width: `${Math.max(surface.share * 100, 3)}%` }} /></div>
                  <p>{formatCompactDurationFromSeconds(surface.seconds)} {metricLabel} · {surface.captures} {surface.captures === 1 ? "capture" : "captures"} · {surface.activeDays} active {surface.activeDays === 1 ? "day" : "days"}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="drift-analysis__patterns" aria-label={patternsLabel}>
            {report.patternCards.map((card) => (
              <div className={`drift-pattern-card drift-pattern-card--${card.tone}`} key={card.id}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <p>{card.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : <EmptyState title={emptyTitle} detail={emptyDetail} />}
    </section>
  );
}

function DateNavigator({
  ariaLabel,
  context,
  label,
  todayLabel,
  isTodayDisabled,
  isNextDisabled,
  onPrevious,
  onNext,
  onToday,
  previousLabel,
  nextLabel,
}: {
  ariaLabel: string;
  context: string;
  label: string;
  todayLabel: string;
  isTodayDisabled: boolean;
  isNextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="day-nav" aria-label={ariaLabel}>
      <button className="ghost-button day-nav__step" type="button" onClick={onPrevious} aria-label={previousLabel}>&lsaquo;</button>
      <div className="day-nav__current"><span className="eyebrow">{context}</span><strong>{label}</strong></div>
      <button className="ghost-button day-nav__step" type="button" onClick={onNext} disabled={isNextDisabled} aria-label={nextLabel}>&rsaquo;</button>
      <button className="ghost-button day-nav__today" type="button" onClick={onToday} disabled={isTodayDisabled}>{todayLabel}</button>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span className="eyebrow">{title}</span>
      <strong>Not enough data yet</strong>
      <p>{detail}</p>
    </div>
  );
}

function driftyCloudStatusLabel(
  entitlement: BillingEntitlement | null,
  loading: boolean,
  isConfigured: boolean,
  hasAccount: boolean,
): string {
  if (!isConfigured) return "Cloud off";
  if (!hasAccount) return "Sign-in needed";
  if (loading) return "Checking cloud";
  if (entitlement?.status === "locked") return "Drifty Cloud needs attention";
  return "Drifty Cloud is connected";
}

function aiServerStatusLabelForCloud(
  entitlement: BillingEntitlement | null,
  loading: boolean,
  isConfigured: boolean,
  hasAccount: boolean,
): string {
  if (!isConfigured) return "Not configured";
  if (!hasAccount) return "Sign-in needed";
  if (loading) return "Checking";
  if (entitlement?.status === "locked") return "Needs attention";
  return "Available";
}

function driftyCloudActionLabel(
  entitlement: BillingEntitlement | null,
  isConfigured: boolean,
  hasAccount: boolean,
): string | null {
  if (!isConfigured || !hasAccount || entitlement?.status !== "locked") return null;
  if (entitlement.lockedReason === "payment_required") return "Resolve billing";
  if (entitlement.lockedReason === "billing_missing") return "Set up billing";
  return "Subscribe";
}

function driftyCloudSetupActionLabel(
  entitlement: BillingEntitlement | null,
  isConfigured: boolean,
  hasAccount: boolean,
): string {
  if (!isConfigured) return "Configure Supabase";
  if (!hasAccount) return "Continue on drifty.so";
  if (entitlement?.status === "locked") return driftyCloudActionLabel(entitlement, isConfigured, hasAccount) ?? "Subscribe";
  return "Refresh Drifty Cloud";
}

function aiConnectionStatusLabel(
  localAiSetup: LocalAiSetupState,
  entitlement: BillingEntitlement | null,
  cloudLoading: boolean,
  hasAccount: boolean,
): string {
  if (hasAccount && cloudLoading) return "AI checking";
  if (hasAccount && entitlement?.status !== "locked") return "Drifty Cloud AI";
  if (localAiSetup.provider === "openrouter_byok") return localAiSetup.openRouterApiKey.trim() ? "OpenRouter AI" : "AI not connected";
  const hasSelfHostedConnection = Boolean(localAiSetup.selfHostedBaseUrl.trim() && localAiSetup.selfHostedModel.trim());
  return hasSelfHostedConnection ? "Self-hosted AI" : "AI not connected";
}

function CategoryStat({ entry, showPercentage = false }: { entry: CategoryDuration; showPercentage?: boolean }) {
  const durationLabel = formatCompactDurationFromSeconds(entry.totalSeconds);

  return (
    <div className="category-stat">
      <div className="category-stat__label"><span className={`category-dot category-dot--${entry.category}`} aria-hidden="true" /><span>{categoryLabel(entry.category)}</span></div>
      {showPercentage ? <span className="category-stat__value"><strong>{durationLabel}</strong><small>{formatCategoryPercentage(entry.ratio * 100)}</small></span> : <strong>{durationLabel}</strong>}
    </div>
  );
}

function ClassificationCategoryBreakdownCard({
  appIcons,
  breakdown,
}: {
  appIcons: AppIconMap;
  breakdown: ClassificationCategoryBreakdown;
}) {
  const label = categoryLabel(breakdown.category);
  const shareLabel = formatCategoryPercentage(breakdown.shareOfDay * 100);
  const style: CategoryBreakdownCardStyle = { "--category-breakdown-tone": CATEGORY_COLORS[breakdown.category] };
  const longestLabel = breakdown.longestSession ? recentSessionDisplayName(breakdown.longestSession) : "No session";
  const dominantSurfaceLabel = breakdown.dominantSurface ? usageItemLabel(breakdown.dominantSurface) : "No surface";

  return (
    <article className={`classification-category-card classification-category-card--${breakdown.category}`} style={style} aria-label={`${label} category breakdown`}>
      <div className="classification-category-card__header">
        <div className="classification-category-card__identity">
          <span className={`category-dot category-dot--${breakdown.category}`} aria-hidden="true" />
          <div>
            <span className="label-mono">Category</span>
            <h2>{label}</h2>
          </div>
        </div>
        <div className="classification-category-card__total">
          <strong>{formatDuration(breakdown.totalSeconds)}</strong>
          <span>{shareLabel} of selected day</span>
        </div>
      </div>

      <dl className="classification-category-card__stats">
        <div><dt>Sessions</dt><dd>{breakdown.sessionCount}</dd></div>
        <div><dt>Average</dt><dd>{formatCompactDurationFromSeconds(breakdown.averageSessionSeconds)}</dd></div>
        <div><dt>Longest</dt><dd>{breakdown.longestSession ? formatCompactDurationFromSeconds(breakdown.longestSession.durationSeconds) : "0"}<small>{longestLabel}</small></dd></div>
        <div><dt>Dominant</dt><dd>{breakdown.dominantSurface ? formatCategoryPercentage(breakdown.dominantSurface.shareOfTotal * 100) : "0%"}<small>{dominantSurfaceLabel}</small></dd></div>
      </dl>

      {breakdown.productivityMix.length > 0 ? (
        <div className="classification-category-card__productivity" aria-label={`${label} productivity mix`}>
          <div className="classification-category-card__section-head">
            <span className="label-mono">Productivity mix</span>
            <span>{breakdown.dominantProductivity ? productivityLabel(breakdown.dominantProductivity.productivity) : "No signal"}</span>
          </div>
          <div className="classification-category-card__mixbar" role="img" aria-label={productivityMixAriaLabel(label, breakdown.productivityMix)}>
            {breakdown.productivityMix.map((entry) => (
              <span
                key={entry.productivity}
                style={{ width: `${Math.max(entry.ratio * 100, entry.totalSeconds > 0 ? 3 : 0)}%`, background: PRODUCTIVITY_COLORS[entry.productivity] }}
                title={`${productivityLabel(entry.productivity)} · ${formatCompactDurationFromSeconds(entry.totalSeconds)} · ${formatCategoryPercentage(entry.ratio * 100)}`}
              />
            ))}
          </div>
          <div className="classification-category-card__mixlegend" aria-hidden="true">
            {breakdown.productivityMix.map((entry) => (
              <span key={entry.productivity}>
                <span className={`productivity-dot productivity-dot--${entry.productivity}`} />
                {productivityLabel(entry.productivity)}
                <strong>{formatCategoryPercentage(entry.ratio * 100)}</strong>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="classification-category-card__sources">
        <CategoryUsageList appIcons={appIcons} emptyLabel="No app captures" items={breakdown.topApps} label="Apps" />
        <CategoryUsageList appIcons={appIcons} emptyLabel="No browser context" items={breakdown.topSites} label="Sites" />
      </div>

    </article>
  );
}

function CategoryUsageList({
  appIcons,
  emptyLabel,
  items,
  label,
}: {
  appIcons: AppIconMap;
  emptyLabel: string;
  items: CategoryBreakdownUsageItem[];
  label: string;
}) {
  return (
    <div className="category-usage-list">
      <div className="classification-category-card__section-head">
        <span className="label-mono">{label}</span>
        <span>{items.length > 0 ? `${items.length} tracked` : emptyLabel}</span>
      </div>
      {items.length > 0 ? (
        <ol aria-label={`${label} usage`} role="list">
          {items.map((item) => {
            const displayName = usageItemLabel(item);
            const iconSrc = item.bundleId ? appIcons[item.bundleId] ?? null : appIcons[item.appName] ?? null;
            return (
              <li key={`${item.usageKind}-${item.siteDomain ?? item.bundleId ?? item.appName}`}>
                <div className="category-usage-list__identity">
                  {item.siteDomain ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={displayName} iconSrc={iconSrc} size="sm" />}
                  <div>
                    <strong>{displayName}</strong>
                    <span>{item.sessionCount} {item.sessionCount === 1 ? "session" : "sessions"} · {formatCompactDurationFromSeconds(item.averageSessionSeconds)} avg</span>
                  </div>
                </div>
                <div className="category-usage-list__measure">
                  <strong>{formatCompactDurationFromSeconds(item.totalSeconds)}</strong>
                  <span>{formatCategoryPercentage(item.shareOfTotal * 100)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="category-usage-list__empty">{emptyLabel}</p>
      )}
    </div>
  );
}

function AuthConfigurationGate() {
  return (
    <main className="auth-gate" aria-label="Authentication configuration required">
      <div className="auth-card auth-card--blocking">
        <div className="auth-card__brand">Drifty</div>
        <h2>Authentication setup required</h2>
        <p>Required auth mode needs Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before beta deploys.</p>
      </div>
    </main>
  );
}

function AuthRequiredGate({ onSignIn }: { onSignIn: () => void }) {
  return (
    <main className="auth-gate" aria-label="Sign in required">
      <div className="auth-card auth-card--blocking auth-card--required">
        <div className="auth-card__brand auth-card__brand--symbol">
          <img className="auth-card__brand-logo" src={logoUrl} alt="Drifty" />
        </div>
        <h2>Sign in to use Drifty</h2>
        <div className="auth-card__actions auth-card__actions--required">
          <button type="button" className="secondary-button auth-card__action" onClick={onSignIn}>Continue on drifty.so</button>
        </div>
      </div>
    </main>
  );
}

function AuthLoadingGate() {
  return (
    <main className="auth-gate auth-gate--loading" aria-busy="true" aria-label="Loading saved Drifty session">
      <span className="auth-gate__pulse">drifty loading…</span>
    </main>
  );
}

function WeekCalendarIdentityIcon({ identity, appIcons }: { identity: WeekCalendarEventIdentity; appIcons: AppIconMap }) {
  const iconSrc = appIcons[identity.bundleId ?? identity.appName] ?? appIcons[identity.appName] ?? null;
  if (identity.siteDomain) {
    return <SiteFavicon domain={identity.siteDomain} size={16} fallbackIconSrc={iconSrc} />;
  }

  return <AppGlyph appName={identity.label} iconSrc={identity.siteTitle ? null : iconSrc} size="sm" />;
}

function WeekDashboard({
  rows,
  segments,
  appIcons,
  startDay,
  endDay,
  categoryEntries,
  productivityEntries,
  totalSeconds,
  classificationOptions,
  focusDeltaPercent,
  isPreviewSurface = false,
  startOfDayMinutes,
  dateNavigator,
}: {
  rows: WeekDayRow[];
  segments: ActivitySegment[];
  appIcons: AppIconMap;
  startDay: string;
  endDay: string;
  categoryEntries: CategoryDuration[];
  productivityEntries: ProductivityDuration[];
  totalSeconds: number;
  classificationOptions: ClassificationOptions;
  focusDeltaPercent: number | null;
  isPreviewSurface?: boolean;
  startOfDayMinutes: number;
  dateNavigator: ReactNode;
}) {
  const [weekHover, setWeekHover] = useState<WeekCalendarHoverState | null>(null);
  const calendarScrollerRef = useRef<HTMLDivElement>(null);
  const calendarBodyRef = useRef<HTMLDivElement>(null);
  const autoScrollKeyRef = useRef<string | null>(null);
  const focusSeconds = productivityEntries.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  const driftSeconds = productivityEntries.find((entry) => entry.productivity === "drift")?.totalSeconds ?? 0;
  const productivePercent = totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
  const activeCategories = categoryEntries
    .filter((entry) => entry.totalSeconds > 0)
    .slice()
    .sort((left, right) => right.totalSeconds - left.totalSeconds);
  const visibleCategories = activeCategories.slice(0, 5);
  const rankedRows = rows.slice().sort((left, right) => right.totalSeconds - left.totalSeconds || left.day.localeCompare(right.day));
  const activeDayCount = rows.filter((row) => row.totalSeconds > 0).length;
  const bestDay = rankedRows.find((row) => row.totalSeconds > 0) ?? null;
  const topCategory = activeCategories[0] ?? null;
  const peakSeconds = Math.max(rankedRows[0]?.totalSeconds ?? 0, 1);
  const summaryPeakSeconds = Math.max(...rows.map((row) => row.focusSeconds), 1);
  const todayDay = logicalTodayIsoDate(startOfDayMinutes);
  const calendarStartHour = 0;
  const calendarEndHour = 24;
  const calendarHourHeight = 56;
  const calendarHours = Array.from({ length: calendarEndHour - calendarStartHour }, (_, index) => calendarStartHour + index);
  const calendarRows = rows;
  const calendarEvents = useMemo(
    () => buildWeekCalendarEvents(segments, startDay, endDay, calendarStartHour, calendarEndHour, classificationOptions, startOfDayMinutes),
    [calendarEndHour, calendarStartHour, classificationOptions, endDay, segments, startDay, startOfDayMinutes],
  );
  const minCalendarMinute = calendarStartHour * 60;
  const maxCalendarMinute = calendarEndHour * 60;
  const isCurrentCalendarWeek = startDay <= todayDay && todayDay <= endDay;
  const currentCalendarMinute = isCurrentCalendarWeek
    ? Math.min(maxCalendarMinute, Math.max(minCalendarMinute, logicalMinuteOfDay(new Date().getHours() * 60 + new Date().getMinutes(), startOfDayMinutes)))
    : null;
  const currentCalendarOffset = currentCalendarMinute === null
    ? null
    : ((currentCalendarMinute - minCalendarMinute) / 60) * calendarHourHeight;
  const currentCalendarLabel = currentCalendarMinute === null ? null : formatCalendarMinuteLabel(todayDay, currentCalendarMinute, startOfDayMinutes);
  const currentCalendarLineEnd = String(calendarRows.findIndex((row) => row.day === todayDay) + 3);
  const currentCalendarMarkerStyle = currentCalendarOffset === null
    ? null
    : {
        "--week-calendar-now-offset": `${currentCalendarOffset}px`,
        "--week-calendar-now-line-end": currentCalendarLineEnd,
      } as WeekCalendarNowMarkerStyle;
  const autoScrollTargetMinute = useMemo(() => {
    if (currentCalendarMinute !== null) return currentCalendarMinute;

    const earliestEventOffset = calendarRows.reduce<number | null>((earliest, row) => {
      const firstEvent = calendarEvents.get(row.day)?.[0];
      if (!firstEvent) return earliest;
      return earliest === null ? firstEvent.topMinutes : Math.min(earliest, firstEvent.topMinutes);
    }, null);

    return earliestEventOffset === null
      ? minCalendarMinute
      : Math.min(maxCalendarMinute, Math.max(minCalendarMinute, minCalendarMinute + earliestEventOffset));
  }, [calendarEvents, calendarRows, currentCalendarMinute, maxCalendarMinute, minCalendarMinute]);

  useLayoutEffect(() => {
    const scroller = calendarScrollerRef.current;
    const body = calendarBodyRef.current;
    if (!scroller || !body) return;

    const scrollKey = `${startDay}:${endDay}:${autoScrollTargetMinute}`;
    if (autoScrollKeyRef.current === scrollKey) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const timelineOffset = ((autoScrollTargetMinute - minCalendarMinute) / 60) * calendarHourHeight;
    const bodyTop = bodyRect.top - scrollerRect.top + scroller.scrollTop;
    const weekTimelineViewportAnchorRatio = 0.58;
    const viewportAnchor = Math.max(96, scroller.clientHeight * weekTimelineViewportAnchorRatio);
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, bodyTop + timelineOffset - viewportAnchor));

    scroller.scrollTop = nextScrollTop;
    autoScrollKeyRef.current = scrollKey;
  }, [autoScrollTargetMinute, calendarHourHeight, endDay, minCalendarMinute, startDay]);

  return (
    <section className="week-v2" aria-label="Your week overview">
      <div className="week-v2-grid week-v2-grid--calendar">
        <section className="week-v2-calendar editorial-panel editorial-panel--soft" aria-label="Week calendar schedule">
          <div className="week-v2-summary week-v2-summary--compact week-v2-summary--integrated" aria-label="Week summary">
            <div className="week-v2-summary__main">
              <span className="label-mono">Week focus</span>
              <strong>{isPreviewSurface ? "40h 40m" : focusSeconds > 0 ? formatCompactDurationFromSeconds(focusSeconds) : "0m"}</strong>
            </div>
            <div className="week-v2-summary__bars" aria-hidden="true">
              {calendarRows.map((row) => {
                const ratio = row.focusSeconds > 0 ? row.focusSeconds / summaryPeakSeconds : 0;
                const barHeight = row.focusSeconds > 0 ? Math.max(4, Math.round(ratio * 30)) : 2;
                const isPeak = bestDay?.day === row.day && row.focusSeconds > 0;
                const isToday = todayDay === row.day;
                const dayLetter = row.dayName.charAt(0);
                return (
                  <span
                    className={`week-v2-summary__bar${isPeak ? " is-peak" : ""}${isToday ? " is-today" : ""}${row.focusSeconds === 0 ? " is-empty" : ""}`}
                    key={row.day}
                    title={`${row.dayName} ${row.dayNumber} · ${row.focusSeconds > 0 ? formatCompactDurationFromSeconds(row.focusSeconds) : "No focus"}`}
                  >
                    <span className="week-v2-summary__bar-fill" style={{ height: `${barHeight}px` }} />
                    <small>{dayLetter}</small>
                  </span>
                );
              })}
            </div>
            <div className="week-v2-summary__meta">
              <span>{focusDeltaPercent !== null ? `${focusDeltaPercent >= 0 ? "▲" : "▼"} ${Math.abs(focusDeltaPercent)}% vs last week` : "No prior week"}</span>
              <span>Best {isPreviewSurface ? "Wed 13" : bestDay ? `${bestDay.dayName} ${bestDay.dayNumber}` : "—"}</span>
              <span>Focus share {isPreviewSurface ? 77 : productivePercent}%</span>
              <span>Drift {isPreviewSurface ? "6h 25m" : driftSeconds > 0 ? formatCompactDurationFromSeconds(driftSeconds) : "0m"}</span>
            </div>
            <div className="week-v2-summary__actions">
              {dateNavigator}
            </div>
          </div>
          {activeCategories.length > 0 ? (
            <div className="week-v2-calendar__legend" aria-label="Week category legend">
              {activeCategories.map((entry) => (
                <span className="week-v2-calendar__legend-item" key={entry.category}>
                  <span className={`category-dot category-dot--${entry.category}`} aria-hidden="true" />
                  <span>{categoryLabel(entry.category)}</span>
                </span>
              ))}
            </div>
          ) : null}
          <div ref={calendarScrollerRef} className="week-v2-calendar__scroller">
            <div className="week-v2-calendar__day-head" aria-hidden="true">
              <span />
              {calendarRows.map((row) => {
                const weekday = new Date(`${row.day}T12:00:00`).getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                return (
                  <span className={`${isWeekend ? "is-weekend" : ""}${row.day === todayDay ? " is-today" : ""}`.trim()} key={row.day}>
                    <strong>{row.dayName}</strong>
                    <small>{row.dayNumber}</small>
                  </span>
                );
              })}
            </div>
            <div ref={calendarBodyRef} className="week-v2-calendar__body" style={{ height: `${(calendarEndHour - calendarStartHour) * calendarHourHeight}px` }}>
              <div className="week-v2-calendar__time-rail">
                {calendarHours.map((hour) => (
                  <span key={hour} style={{ top: `${(hour - calendarStartHour) * calendarHourHeight}px` }}>{formatHourLabel(clockHourForLogicalHour(hour, startOfDayMinutes))}</span>
                ))}
                <span
                  className="week-v2-calendar__time-rail-endpoint"
                  style={{ top: `${(calendarEndHour - calendarStartHour) * calendarHourHeight}px` }}
                >
                  {formatHourLabel(clockHourForLogicalHour(calendarEndHour, startOfDayMinutes))}
                </span>
              </div>
              {currentCalendarMarkerStyle && currentCalendarLabel ? (
                <div
                  className="week-v2-calendar__now-marker week-v2-calendar__now-marker--line"
                  style={currentCalendarMarkerStyle}
                  aria-hidden="true"
                >
                  <span className="week-v2-calendar__now-line" />
                  <span className="week-v2-calendar__now-cap" aria-hidden="true" />
                </div>
              ) : null}
              {calendarRows.map((row) => {
                const events = calendarEvents.get(row.day) ?? [];
                return (
                  <div className={`week-v2-calendar__day-column${row.day === todayDay ? " is-today" : ""}`} key={row.day}>
                    {calendarHours.map((hour) => (
                      <span className="week-v2-calendar__line" key={`${row.day}-${hour}`} style={{ top: `${(hour - calendarStartHour) * calendarHourHeight}px` }} />
                    ))}
                    {events.map((event) => {
                      const rawEventHeight = (event.durationMinutes / 60) * calendarHourHeight;
                      const shortEventMinHeight = event.isGroupedCluster ? 22 : 10;
                      const shortEventMaxHeight = event.isGroupedCluster ? 30 : 26;
                      const eventHeight = event.isShort
                        ? Math.max(shortEventMinHeight, Math.min(shortEventMaxHeight, Math.round(8 + Math.sqrt(event.durationMinutes) * 4)))
                        : Math.max(28, rawEventHeight - 4);
                      const isCompactEvent = event.isShort || eventHeight < 36 || event.laneCount > 2;
                      const eventStyle: WeekCalendarEventStyle = {
                        top: `${(event.topMinutes / 60) * calendarHourHeight}px`,
                        height: `${eventHeight}px`,
                        left: event.laneCount > 1 ? `calc(${event.lane * 12}px + 4px)` : "4px",
                        width: event.laneCount > 1 ? "calc(100% - 32px)" : "calc(100% - 8px)",
                        zIndex: event.laneCount > 1 ? 10 + event.lane : 3,
                        "--event-tone": CATEGORY_COLORS[event.category],
                      };
                      return (
                        <article
                          aria-label={event.detailTitle.replace(/\n/g, ", ")}
                          className={`week-v2-calendar__event week-v2-calendar__event--${event.productivity}${event.isShort ? " week-v2-calendar__event--short" : ""}${event.isGroupedCluster ? " week-v2-calendar__event--grouped" : ""}${event.durationMinutes < 10 ? " week-v2-calendar__event--micro" : ""}${event.laneCount > 2 ? " week-v2-calendar__event--dense" : ""}${isCompactEvent ? " week-v2-calendar__event--compact" : ""}`}
                          key={event.id}
                          style={eventStyle}
                          title={event.detailTitle}
                          onMouseEnter={(pointerEvent: MouseEvent<HTMLElement>) => setWeekHover({ event, x: pointerEvent.clientX, y: pointerEvent.clientY })}
                          onMouseMove={(pointerEvent: MouseEvent<HTMLElement>) => setWeekHover({ event, x: pointerEvent.clientX, y: pointerEvent.clientY })}
                          onMouseLeave={() => setWeekHover(null)}
                        >
                          <span className={`category-dot category-dot--${event.category}`} aria-hidden="true" />
                          {event.isGroupedCluster ? (
                            <span className="week-v2-calendar__identity-strip" aria-hidden="true">
                              {event.identities.map((identity) => (
                                <span className="week-v2-calendar__identity" key={identity.id} title={identity.label}>
                                  <WeekCalendarIdentityIcon appIcons={appIcons} identity={identity} />
                                </span>
                              ))}
                              {event.hiddenIdentityCount > 0 ? (
                                <span className="week-v2-calendar__identity-more">+{event.hiddenIdentityCount}</span>
                              ) : null}
                            </span>
                          ) : null}
                          <strong className={event.isGroupedCluster ? "week-v2-calendar__event-label" : undefined}>{event.appName}</strong>
                          {!isCompactEvent ? <small>{event.startLabel}–{event.endLabel}</small> : null}
                          {!isCompactEvent ? <em>{event.detailSummary}</em> : null}
                        </article>
                      );
                    })}
                  </div>
                );
              })}
              {currentCalendarMarkerStyle && currentCalendarLabel ? (
                <div
                  className="week-v2-calendar__now-marker week-v2-calendar__now-marker--overlay"
                  style={currentCalendarMarkerStyle}
                  aria-label={`Current time ${currentCalendarLabel}`}
                >
                  <span className="week-v2-calendar__now-label">{currentCalendarLabel}</span>
                </div>
              ) : null}
            </div>
          </div>
        </section>
        {weekHover ? <WeekCalendarHoverCard appIcons={appIcons} hover={weekHover} /> : null}

        <aside className="week-v2-side" aria-label="Week time breakdown">
          <section className="week-v2-side-card" aria-label="Week totals by category">
            <span className="label-mono">Category mix</span>
            {visibleCategories.length > 0 ? (
              <div className="week-v2-cat-list">
                {visibleCategories.map((entry) => (
                  <div className="week-v2-cat-row" key={entry.category}>
                    <div className="week-v2-cat-row__head">
                      <span className={`category-dot category-dot--${entry.category}`} aria-hidden="true" />
                      <strong>{categoryLabel(entry.category)}</strong>
                      <span>{Math.round(entry.ratio * 100)}%</span>
                    </div>
                    <div className="week-v2-cat-row__bar" aria-hidden="true">
                      <span style={{ width: `${Math.max(entry.ratio * 100, 2)}%`, background: CATEGORY_COLORS[entry.category] }} />
                    </div>
                    <div className="week-v2-cat-row__delta">
                      <span>{formatCompactDurationFromSeconds(entry.totalSeconds)}</span>
                      <span>of tracked week</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="week-v2-empty">No tracked categories yet.</p>
            )}
          </section>

          <section className="week-v2-side-card" aria-label="Ranked days">
            <span className="label-mono">Ranked days</span>
            <ol className="week-v2-rank">
              {rankedRows.map((row, index) => {
                const hasActivity = row.totalSeconds > 0;
                const widthPercent = hasActivity ? Math.max((row.totalSeconds / peakSeconds) * 100, 2) : 0;
                return (
                  <li className={hasActivity ? undefined : "is-empty"} key={row.day}>
                    <span className="week-v2-rank__pos">{String(index + 1).padStart(2, "0")}</span>
                    <span className="week-v2-rank__day">
                      <strong>{row.dayName} {row.dayNumber}</strong>
                      <small>{hasActivity ? `FS ${row.focusScore}` : "No activity"}</small>
                    </span>
                    <span className="week-v2-rank__bar" aria-hidden="true"><span style={{ width: `${widthPercent}%` }} /></span>
                    <span className="week-v2-rank__val">{hasActivity ? formatCompactDurationFromSeconds(row.totalSeconds) : "—"}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>
    </section>
  );
}

function HistoryCalendarPanel({
  segments,
  selectedDay,
  classificationOptions,
  startOfDayMinutes,
  onSelectDay,
}: {
  segments: ActivitySegment[];
  selectedDay: string;
  classificationOptions: ClassificationOptions;
  startOfDayMinutes: number;
  onSelectDay: (day: string) => void;
}) {
  const overview = buildMonthV2Overview(segments, selectedDay, classificationOptions, startOfDayMinutes);

  return (
    <section className="month-v2" aria-label="Month focus overview">
      <div className="month-v2-story" aria-label="Month focus summary">
        <div>
          <span className="label-mono">{overview.monthLabel} · focus</span>
          <strong>{overview.totalFocusSeconds > 0 ? formatDuration(overview.totalFocusSeconds) : "0m"}</strong>
        </div>
        <div className="month-v2-story__notes">
          <span><strong>{overview.activeDays}</strong> active days</span>
          <span><strong>{overview.focusDays}</strong> focus days</span>
          <span>Longest streak: <strong>{overview.streakDays}d</strong></span>
          {overview.bestDay ? <span>Best day: <strong>{formatDayLabel(overview.bestDay.isoDay)}</strong> · {formatCompactDurationFromSeconds(overview.bestDay.focusSeconds)}</span> : null}
        </div>
      </div>

      <div className="month-v2-grid">
        <div className="month-v2-top-row">
          <section className="month-v2-calendar editorial-panel editorial-panel--soft" aria-label={`${overview.monthLabel} calendar-first focus pattern`}>
            <div className="month-v2-calendar__head">
              <span className="label-mono">Month pattern</span>
              <strong>{overview.monthLabel}</strong>
              <span className="month-v2-calendar__legend" aria-label="Less to more focus">
                <span className="month-v2-legend-ramp" aria-hidden="true">
                  {[15, 40, 70, 100].map((amount) => <span className="month-v2-legend-dot" key={amount} style={{ background: `color-mix(in srgb, var(--accent) ${amount}%, var(--bg-2))` }} />)}
                </span>
              </span>
            </div>
            <div className="month-v2-calendar__weekdays" aria-hidden="true">
              {WEEKDAY_LABELS.map((label, index) => <span className={index === 0 || index === 6 ? "is-weekend" : undefined} key={label}>{label}</span>)}
            </div>
            <div className="month-v2-calendar__grid">
              {overview.weeks.map((week) => week.map((cell) => {
                if (cell.isBlank) return <span className="month-v2-cell month-v2-cell--blank" key={cell.id} />;
                if (cell.isFuture) {
                  return (
                    <span className="month-v2-cell month-v2-cell--future" key={cell.id}>
                      <span className="month-v2-cell__num">{cell.dayNumber}</span>
                    </span>
                  );
                }

                const hasActivity = cell.totalSeconds > 0;
                const intensity = overview.peakActivitySeconds > 0 ? cell.totalSeconds / overview.peakActivitySeconds : 0;
                const heatPercent = Math.round(12 + Math.pow(intensity, 0.68) * 80);
                const weekday = new Date(`${cell.isoDay}T12:00:00`).getDay();
                const isWeekend = weekday === 0 || weekday === 6;
                const cellStyle: MonthCellStyle | undefined = hasActivity ? {
                  "--activity-tone": `color-mix(in srgb, var(--accent) ${heatPercent}%, var(--bg-2))`,
                  "--activity-border": `color-mix(in srgb, var(--accent) ${Math.min(heatPercent + 8, 96)}%, var(--line))`,
                  "--activity-ink": intensity > 0.54 ? "var(--canvas)" : "var(--text)",
                } : undefined;

                return (
                  <button
                    className={`month-v2-cell${hasActivity ? "" : " month-v2-cell--idle"}${cell.isToday ? " month-v2-cell--today" : ""}${cell.isSelected ? " month-v2-cell--selected" : ""}${isWeekend ? " month-v2-cell--weekend" : ""}`}
                    key={cell.id}
                    onClick={() => onSelectDay(cell.isoDay)}
                    style={cellStyle}
                    title={hasActivity ? `${formatDayLabel(cell.isoDay)} · ${formatCompactDurationFromSeconds(cell.totalSeconds)} tracked${cell.focusSeconds > 0 ? ` · ${formatCompactDurationFromSeconds(cell.focusSeconds)} focus` : ""}${cell.driftSeconds > 0 ? ` · ${formatCompactDurationFromSeconds(cell.driftSeconds)} drift` : ""}` : `${formatDayLabel(cell.isoDay)} · no activity`}
                    type="button"
                  >
                    {cell.isToday ? <span className="month-v2-cell__today-badge">NOW</span> : null}
                    <span className="month-v2-cell__num">{cell.dayNumber}</span>
                    {hasActivity ? <span className="month-v2-cell__val">{formatCompactDurationFromSeconds(cell.totalSeconds)}</span> : <span className="month-v2-cell__dash">—</span>}
                    {cell.driftSeconds > 0 && cell.focusSeconds === 0 ? <span className="month-v2-cell__drift-dot" aria-label="drift only" /> : null}
                  </button>
                );
              }))}
            </div>
          </section>

          <aside className="month-v2-side month-v2-side--top" aria-label="Month primary context">
            <section className="editorial-panel editorial-panel--soft month-v2-side-card month-v2-side-card--category">
              <div className="month-v2-card-head">
                <span className="label-mono">Category mix</span>
                <strong>{overview.categoryEntries[0] ? categoryLabel(overview.categoryEntries[0].category) : "No activity"}</strong>
              </div>
              <div className="month-v2-metric-list">
                {overview.categoryEntries.length > 0 ? overview.categoryEntries.map((entry) => (
                  <div className="month-v2-metric-row" key={entry.category}>
                    <div className="month-v2-metric-row__head">
                      <span className={`category-dot category-dot--${entry.category}`} aria-hidden="true" />
                      <span>{categoryLabel(entry.category)}</span>
                      <strong>{formatCompactDurationFromSeconds(entry.totalSeconds)}</strong>
                    </div>
                    <div className="month-v2-metric-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(entry.ratio * 100, 2)}%`, background: CATEGORY_COLORS[entry.category] }} />
                    </div>
                    <small>{Math.round(entry.ratio * 100)}% of tracked month</small>
                  </div>
                )) : <p className="month-v2-empty-note">No tracked category time yet.</p>}
              </div>
            </section>
          </aside>
        </div>

        <div className="month-v2-bottom" aria-label="Month supporting metrics">
          <section className="editorial-panel editorial-panel--soft month-v2-side-card">
            <div className="month-v2-card-head">
              <span className="label-mono">Productivity split</span>
              <strong>{overview.primaryProductivity ? productivityLabel(overview.primaryProductivity.productivity) : "No data"}</strong>
            </div>
            <div className="month-v2-split-bar" aria-label="Productivity split">
              {overview.productivityEntries.map((entry) => (
                <span key={entry.productivity} style={{ width: `${Math.max(entry.ratio * 100, entry.totalSeconds > 0 ? 2 : 0)}%`, background: PRODUCTIVITY_COLORS[entry.productivity] }} title={`${productivityLabel(entry.productivity)} · ${formatCompactDurationFromSeconds(entry.totalSeconds)}`} />
              ))}
            </div>
            <div className="month-v2-productivity-list">
              {overview.productivityEntries.map((entry) => (
                <div className="month-v2-productivity-item" key={entry.productivity}>
                  <span style={{ background: PRODUCTIVITY_COLORS[entry.productivity] }} aria-hidden="true" />
                  <strong>{productivityLabel(entry.productivity)}</strong>
                  <small>{formatCompactDurationFromSeconds(entry.totalSeconds)} · {Math.round(entry.ratio * 100)}%</small>
                </div>
              ))}
            </div>
          </section>

          <section className="editorial-panel editorial-panel--soft month-v2-side-card month-v2-side-card--rhythm">
            <div className="month-v2-card-head">
              <span className="label-mono">Rhythm</span>
              <strong>{overview.activeDays} active days</strong>
            </div>
            <div className="month-v2-stat">
              <div><span className="label-mono">Avg focus</span><strong>{formatCompactDurationFromSeconds(overview.averageFocusPerActiveDay)}</strong><small>per active day</small></div>
              <div><span className="label-mono">Longest streak</span><strong>{overview.streakDays}d</strong><small>consecutive focus</small></div>
              <div><span className="label-mono">Drift total</span><strong>{formatCompactDurationFromSeconds(overview.totalDriftSeconds)}</strong><small>across month</small></div>
            </div>
            <div className="month-v2-weekday-chart" aria-label="Average focus by weekday">
              {WEEKDAY_LABELS.map((label, index) => {
                const average = overview.weekdayFocusAverages[index] ?? 0;
                const height = overview.maxWeekdayFocusAverage > 0 ? (average / overview.maxWeekdayFocusAverage) * 100 : 0;
                return (
                  <div className={`month-v2-weekday-bar${index === 0 || index === 6 ? " is-weekend" : ""}`} key={label}>
                    <div className="month-v2-weekday-bar__fill" style={{ height: `${height}%` }} />
                    <span className="month-v2-weekday-bar__label">{label}</span>
                    <span className="month-v2-weekday-bar__val">{average > 0 ? formatCompactDurationFromSeconds(average) : "—"}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function FlowCompactSplitChart({
  categoryEntries,
  productivityEntries,
  totalSeconds,
  flowBlocks,
  appIcons,
}: {
  categoryEntries: CategoryDuration[];
  productivityEntries: ProductivityDuration[];
  totalSeconds: number;
  flowBlocks: FlowBlock[];
  appIcons: AppIconMap;
}) {
  const orderedProductivityEntries = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER
    .map((productivity) => productivityEntries.find((entry) => entry.productivity === productivity))
    .filter((entry): entry is ProductivityDuration => Boolean(entry));
  const activeCategoryEntries = categoryEntries
    .filter((entry) => entry.totalSeconds > 0)
    .slice()
    .sort((left, right) => right.totalSeconds - left.totalSeconds);

  return (
    <section className="flow-compact-split-chart" aria-label="Compact flow classification chart">
      <CompactProductivityCircleChart
        entries={orderedProductivityEntries}
        totalSeconds={totalSeconds}
        flowBlocks={flowBlocks}
        appIcons={appIcons}
      />
      <CompactClassificationBar<CategoryDuration>
        title="Categories"
        ariaLabel="Category compact classification"
        entries={activeCategoryEntries}
        totalSeconds={totalSeconds}
        getKey={(entry) => entry.category}
        getLabel={(entry) => categoryLabel(entry.category)}
        getColor={(entry) => CATEGORY_COLORS[entry.category]}
        getDotClassName={(entry) => `category-dot--${entry.category}`}
        getAppBreakdown={(entry) => buildCompactClassificationBreakdown(flowBlocks, (block) => block.category === entry.category)}
        appIcons={appIcons}
        visibleLimit={5}
      />
    </section>
  );
}

function CompactProductivityCircleChart({
  entries,
  totalSeconds,
  flowBlocks,
  appIcons,
}: {
  entries: ProductivityDuration[];
  totalSeconds: number;
  flowBlocks: FlowBlock[];
  appIcons: AppIconMap;
}) {
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const activeEntries = entries.filter((entry) => entry.totalSeconds > 0 && entry.ratio > 0);
  const summaryEntries = activeEntries.length > 0 ? activeEntries : entries;
  const focusEntry = entries.find((entry) => entry.productivity === "focus");
  const focusSeconds = focusEntry?.totalSeconds ?? 0;
  const focusPercent = totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
  const circleLabel = formatCompactBarLabel("Productivity", entries, (entry) => productivityLabel(entry.productivity));
  let cursor = 0;
  const gap = activeEntries.length > 1 ? 1.6 : 0;
  const circleSegments = activeEntries.map((entry) => {
    const dash = Math.max(0, entry.ratio * DONUT_CIRCUMFERENCE - gap);
    const offset = -(cursor * DONUT_CIRCUMFERENCE);
    cursor += entry.ratio;
    return { entry, dash, offset };
  });

  function showSegmentHover(entry: ProductivityDuration, x: number, y: number) {
    setHoveredSegment({
      label: productivityLabel(entry.productivity),
      durationLabel: formatCompactDurationFromSeconds(entry.totalSeconds),
      shareLabel: `${Math.round(entry.ratio * 100)}%`,
      dotClassName: `productivity-dot--${entry.productivity}`,
      color: PRODUCTIVITY_COLORS[entry.productivity],
      appBreakdown: buildCompactClassificationBreakdown(flowBlocks, (block) => block.productivity === entry.productivity),
      x,
      y,
    });
  }

  return (
    <div className="flow-compact-split-chart__panel flow-compact-split-chart__panel--circle" aria-label="Productivity compact classification">
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">Productivity</span>
        <strong>{formatCompactDurationFromSeconds(totalSeconds)}</strong>
      </div>
      <div className="flow-compact-productivity-circle">
        <div className="flow-compact-productivity-circle__dial-shell">
          <svg className="flow-compact-productivity-circle__dial" role="img" aria-label={circleLabel} viewBox="0 0 100 100">
            <circle className="flow-compact-productivity-circle__track" cx="50" cy="50" r="40" />
            {circleSegments.map(({ entry, dash, offset }) => (
              <circle
                className="flow-compact-productivity-circle__segment"
                cx="50"
                cy="50"
                key={entry.productivity}
                r="40"
                stroke={PRODUCTIVITY_COLORS[entry.productivity]}
                strokeDasharray={`${dash} ${DONUT_CIRCUMFERENCE}`}
                strokeDashoffset={offset}
                onMouseEnter={(event: MouseEvent<SVGCircleElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
                onMouseMove={(event: MouseEvent<SVGCircleElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
                onMouseLeave={() => setHoveredSegment(null)}
              />
            ))}
          </svg>
          <div className="flow-compact-productivity-circle__center" aria-hidden="true">
            <strong>{focusPercent}%</strong>
          </div>
        </div>
        <div className="flow-compact-split-chart__legend" aria-hidden="true">
          {summaryEntries.map((entry) => (
            <span className="flow-compact-split-chart__legend-item" key={entry.productivity}>
              <span className="flow-compact-split-chart__swatch" style={{ background: PRODUCTIVITY_COLORS[entry.productivity] }} />
              <span className="flow-compact-split-chart__legend-label">{productivityLabel(entry.productivity)}</span>
              <span className="flow-compact-split-chart__legend-value">{formatCompactDurationFromSeconds(entry.totalSeconds)}</span>
            </span>
          ))}
        </div>
      </div>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}

function CompactClassificationBar<TEntry extends { totalSeconds: number; ratio: number }>({
  title,
  ariaLabel,
  entries,
  totalSeconds,
  getKey,
  getLabel,
  getColor,
  getDotClassName,
  getAppBreakdown,
  appIcons,
  visibleLimit = 3,
}: {
  title: string;
  ariaLabel: string;
  entries: TEntry[];
  totalSeconds: number;
  getKey: (entry: TEntry) => string;
  getLabel: (entry: TEntry) => string;
  getColor: (entry: TEntry) => string;
  getDotClassName: (entry: TEntry) => string;
  getAppBreakdown: (entry: TEntry) => CompactClassificationBreakdownRow[];
  appIcons: AppIconMap;
  visibleLimit?: number;
}) {
  const [hoveredSegment, setHoveredSegment] = useState<CompactClassificationHoverState | null>(null);
  const activeEntries = entries.filter((entry) => entry.totalSeconds > 0);
  const summaryEntries = activeEntries.length > 0 ? activeEntries : entries;
  const barLabel = formatCompactBarLabel(title, entries, getLabel);

  function showSegmentHover(entry: TEntry, x: number, y: number) {
    setHoveredSegment({
      label: getLabel(entry),
      durationLabel: formatCompactDurationFromSeconds(entry.totalSeconds),
      shareLabel: `${Math.round(entry.ratio * 100)}%`,
      dotClassName: getDotClassName(entry),
      color: getColor(entry),
      appBreakdown: getAppBreakdown(entry),
      x,
      y,
    });
  }

  return (
    <div className="flow-compact-split-chart__panel" aria-label={ariaLabel}>
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{title}</span>
        <strong>{formatCompactDurationFromSeconds(totalSeconds)}</strong>
      </div>
      <div className="flow-compact-split-chart__bar" role="img" aria-label={barLabel}>
        {entries.map((entry) => (
          <span
            key={getKey(entry)}
            className="flow-compact-split-chart__segment"
            style={{ width: `${entry.ratio * 100}%`, background: getColor(entry) }}
            title={`${getLabel(entry)} · ${formatCompactDurationFromSeconds(entry.totalSeconds)} · ${Math.round(entry.ratio * 100)}%`}
            onMouseEnter={(event: MouseEvent<HTMLSpanElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
            onMouseMove={(event: MouseEvent<HTMLSpanElement>) => showSegmentHover(entry, event.clientX, event.clientY)}
            onMouseLeave={() => setHoveredSegment(null)}
          />
        ))}
      </div>
      <div className="flow-compact-split-chart__legend" aria-hidden="true">
        {summaryEntries.slice(0, visibleLimit).map((entry) => (
          <span className="flow-compact-split-chart__legend-item" key={getKey(entry)}>
            <span className="flow-compact-split-chart__swatch" style={{ background: getColor(entry) }} />
            <span className="flow-compact-split-chart__legend-label">{getLabel(entry)}</span>
            <span className="flow-compact-split-chart__legend-value">{formatCompactDurationFromSeconds(entry.totalSeconds)}</span>
          </span>
        ))}
      </div>
      {hoveredSegment ? <CompactClassificationHoverCard hover={hoveredSegment} appIcons={appIcons} /> : null}
    </div>
  );
}

function CompactClassificationHoverCard({ hover, appIcons }: { hover: CompactClassificationHoverState; appIcons: AppIconMap }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FixedHoverPosition>(() => getViewportSafeHoverPosition(hover.x, hover.y, 0, 0));

  useLayoutEffect(() => {
    function updatePosition() {
      const bounds = cardRef.current?.getBoundingClientRect();
      const nextPosition = getViewportSafeHoverPosition(hover.x, hover.y, bounds?.width ?? 0, bounds?.height ?? 0);
      setPosition((currentPosition) => (
        currentPosition.left === nextPosition.left && currentPosition.top === nextPosition.top ? currentPosition : nextPosition
      ));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [hover.appBreakdown, hover.durationLabel, hover.label, hover.shareLabel, hover.x, hover.y]);

  return (
    <div ref={cardRef} className="flow-hover-card category-hover-card compact-classification-hover-card" style={position}>
      <div className="category-hover-card__head">
        <span className={`category-dot ${hover.dotClassName}`} style={{ background: hover.color }} aria-hidden="true" />
        <strong>{hover.label}</strong>
      </div>
      <div className="category-treemap-hover-card__metric">
        <strong>{hover.durationLabel}</strong>
        <span>{hover.shareLabel} of tracked time</span>
      </div>
      <div className="category-treemap-hover-card__accent" aria-hidden="true">
        <span style={{ width: hover.shareLabel, background: hover.color }} />
      </div>
      <div className="category-hover-card__apps">
        {hover.appBreakdown.length > 0 ? hover.appBreakdown.map((item) => {
          const iconSrc = appIcons[item.bundleId ?? item.appName] ?? null;
          const label = item.siteDomain ?? item.siteTitle ?? item.appName;
          return (
            <div className="category-hover-card__app" key={`${item.siteDomain ?? item.siteTitle ?? item.bundleId ?? item.appName}`}>
              <span className="usage-identity-icon usage-identity-icon--sm">
                {item.siteDomain && !hover.disableRemoteFavicons ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={label} iconSrc={item.siteTitle ? null : iconSrc} size="sm" />}
              </span>
              <span>{label}</span>
              <strong>{secondsToLabel(item.totalSeconds)}</strong>
            </div>
          );
        }) : <span className="category-hover-card__empty">No app breakdown yet.</span>}
      </div>
    </div>
  );
}

function buildCompactActivityBreakdown(segments: ActivitySegment[], divisor = 1): CompactClassificationBreakdownRow[] {
  const safeDivisor = Math.max(divisor, 1);
  return buildAppUsageSummaries(segments, { limit: 4 }).map((item) => ({
    appName: item.appName,
    bundleId: item.bundleId,
    browserName: item.browserName,
    siteDomain: item.siteDomain,
    siteTitle: item.siteTitle,
    totalSeconds: item.totalSeconds / safeDivisor,
  }));
}

function buildCompactClassificationBreakdown(blocks: FlowBlock[], matchesSegment: (block: FlowBlock) => boolean): CompactClassificationBreakdownRow[] {
  const totals = new Map<string, CompactClassificationBreakdownRow>();

  for (const block of blocks) {
    if (!matchesSegment(block)) continue;
    const label = block.siteDomain ?? block.siteTitle ?? block.appName;
    const key = block.siteDomain ? `site:${block.siteDomain}` : block.siteTitle ? `title:${block.siteTitle}` : `app:${block.bundleId ?? block.appName}`;
    const existing = totals.get(key) ?? {
      appName: label,
      bundleId: block.siteDomain || block.siteTitle ? null : block.bundleId ?? null,
      browserName: block.browserName ?? null,
      siteDomain: block.siteDomain ?? null,
      siteTitle: block.siteTitle ?? null,
      totalSeconds: 0,
    };
    existing.totalSeconds += block.durationSeconds;
    totals.set(key, existing);
  }

  return Array.from(totals.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds || left.appName.localeCompare(right.appName))
    .slice(0, 4);
}

function formatCompactBarLabel<TEntry extends { totalSeconds: number; ratio: number }>(
  title: string,
  entries: TEntry[],
  getLabel: (entry: TEntry) => string,
) {
  const parts = entries.map((entry) => `${getLabel(entry)} ${formatCompactDurationFromSeconds(entry.totalSeconds)} ${Math.round(entry.ratio * 100)}%`);
  return `${title} classification: ${parts.join(", ")}`;
}

function WeekCalendarHoverCard({ hover, appIcons }: { hover: WeekCalendarHoverState; appIcons: AppIconMap }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FixedHoverPosition>(() => getViewportSafeHoverPosition(hover.x, hover.y, 0, 0));

  useLayoutEffect(() => {
    function updatePosition() {
      const bounds = cardRef.current?.getBoundingClientRect();
      const nextPosition = getViewportSafeHoverPosition(hover.x, hover.y, bounds?.width ?? 0, bounds?.height ?? 0);
      setPosition((currentPosition) => (
        currentPosition.left === nextPosition.left && currentPosition.top === nextPosition.top ? currentPosition : nextPosition
      ));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [hover.event.id, hover.x, hover.y]);

  return (
    <div ref={cardRef} className="flow-hover-card week-calendar-hover-card" style={position}>
      <div className="category-hover-card__head">
        <span className={`category-dot category-dot--${hover.event.category}`} aria-hidden="true" />
        <strong>{categoryLabel(hover.event.category)}</strong>
      </div>
      <div className="timeline-hover-card__duration">{hover.event.startLabel}–{hover.event.endLabel}</div>
      <ClassificationSourcePill source={hover.event.classificationSource} ai={hover.event.aiClassification} />
      <div className="category-hover-card__apps">
        {hover.event.identities.map((identity) => (
          <div className="category-hover-card__app" key={identity.id}>
            <span className="usage-identity-icon usage-identity-icon--sm">
              <WeekCalendarIdentityIcon appIcons={appIcons} identity={identity} />
            </span>
            <span>{identity.label}</span>
            <strong>{formatCompactDurationFromSeconds(identity.seconds)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function FocusDriftHoverCard({ hover }: { hover: FocusDriftHoverState }) {
  const { point } = hover;
  const cardRef = useRef<HTMLDivElement>(null);
  const focusPercent = formatSharePercent(point.focusScore);
  const driftPercent = formatSharePercent(point.driftScore);
  const focusDuration = formatDuration(point.focusSeconds);
  const driftDuration = formatDuration(point.driftSeconds);
  const isFocusHeavy = point.focusScore >= point.driftScore;
  const verdict = isFocusHeavy ? "Focus-heavy" : "Drift-heavy";
  const reason = isFocusHeavy
    ? `Focus-labeled activity makes up ${focusPercent} (${focusDuration}), ahead of drift at ${driftPercent} (${driftDuration}).`
    : `Drift-labeled activity makes up ${driftPercent} (${driftDuration}), ahead of focus at ${focusPercent} (${focusDuration}).`;
  const [position, setPosition] = useState<FixedHoverPosition>(() => getViewportSafeHoverPosition(hover.x, hover.y, 0, 0));

  useLayoutEffect(() => {
    function updatePosition() {
      const bounds = cardRef.current?.getBoundingClientRect();
      const nextPosition = getViewportSafeHoverPosition(hover.x, hover.y, bounds?.width ?? 0, bounds?.height ?? 0);
      setPosition((currentPosition) => (
        currentPosition.left === nextPosition.left && currentPosition.top === nextPosition.top ? currentPosition : nextPosition
      ));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [
    driftDuration,
    driftPercent,
    focusDuration,
    focusPercent,
    hover.kind,
    hover.x,
    hover.y,
    point.id,
    point.label,
    point.topDriftSource?.captures,
    point.topDriftSource?.id,
    point.topDriftSource?.seconds,
    point.topFocusSource?.captures,
    point.topFocusSource?.id,
    point.topFocusSource?.seconds,
    reason,
  ]);

  return (
    <div ref={cardRef} className={`focus-drift-hover-card focus-drift-hover-card--${hover.kind}`} style={position}>
      <div className="focus-drift-hover-card__head">
        <span className={`productivity-dot productivity-dot--${hover.kind === "focus" ? "focus" : "drift"}`} aria-hidden="true" />
        <strong>{point.label} · {verdict}</strong>
      </div>
      <div className="focus-drift-hover-card__duration">
        {focusDuration} focus · {driftDuration} drift
      </div>
      <div className="focus-drift-hover-card__split" aria-hidden="true">
        <span><strong>{focusPercent}</strong> focus</span>
        <span><strong>{driftPercent}</strong> drift</span>
      </div>
      {point.topFocusSource || point.topDriftSource ? (
        <div className="focus-drift-hover-card__sources" aria-label="Top sources for this window">
          {point.topFocusSource ? <FocusDriftSourceRow source={point.topFocusSource} kind="focus" /> : null}
          {point.topDriftSource ? <FocusDriftSourceRow source={point.topDriftSource} kind="drift" /> : null}
        </div>
      ) : null}
      <p>{reason}</p>
    </div>
  );
}

function FocusDriftSourceRow({ source, kind }: { source: FocusDriftSourceSummary; kind: FocusDriftHoverKind }) {
  const kindLabel = kind === "focus" ? "Top focus source" : "Top drift source";
  const sourceDetail = source.siteDomain ? `${source.detail} via ${source.appName}` : source.detail;
  const captureLabel = source.captures === 1 ? "capture" : "captures";

  return (
    <div className={`focus-drift-hover-card__source-row focus-drift-hover-card__source-row--${kind}`}>
      <span>{kindLabel}</span>
      <div>
        <strong>{source.label}</strong>
        <em>{sourceDetail} · {formatCompactDurationFromSeconds(source.seconds)} · {source.captures} {captureLabel}</em>
      </div>
    </div>
  );
}

function formatFocusDriftHoverLabel(point: FocusDriftPoint, kind: FocusDriftHoverKind): string {
  const kindLabel = kind === "focus" ? "Focus" : "Drift";
  const focusPercent = formatSharePercent(point.focusScore);
  const driftPercent = formatSharePercent(point.driftScore);
  const focusDuration = formatDuration(point.focusSeconds);
  const driftDuration = formatDuration(point.driftSeconds);
  const verdict = point.focusScore >= point.driftScore ? "focus-heavy" : "drift-heavy";
  const topFocusSource = point.topFocusSource ? ` Top focus source: ${point.topFocusSource.label}, ${formatCompactDurationFromSeconds(point.topFocusSource.seconds)} across ${point.topFocusSource.captures} ${point.topFocusSource.captures === 1 ? "capture" : "captures"}.` : "";
  const topDriftSource = point.topDriftSource ? ` Top drift source: ${point.topDriftSource.label}, ${formatCompactDurationFromSeconds(point.topDriftSource.seconds)} across ${point.topDriftSource.captures} ${point.topDriftSource.captures === 1 ? "capture" : "captures"}.` : "";

  return `${kindLabel} point for ${point.label}. Focus is ${focusPercent}, ${focusDuration}; drift is ${driftPercent}, ${driftDuration}. This ${point.unit} is ${verdict}.${topFocusSource}${topDriftSource}`;
}

function formatSharePercent(value: number): string {
  return `${Math.round(value)}%`;
}

function clampHoverCoordinate(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function getViewportSafeHoverPosition(anchorX: number, anchorY: number, width: number, height: number): FixedHoverPosition {
  if (typeof window === "undefined") {
    return { left: anchorX + HOVER_CARD_OFFSET, top: anchorY + HOVER_CARD_OFFSET };
  }

  const { innerWidth, innerHeight } = window;
  const maxLeft = innerWidth - width - HOVER_CARD_VIEWPORT_PADDING;
  const maxTop = innerHeight - height - HOVER_CARD_VIEWPORT_PADDING;
  const preferredLeft = anchorX + HOVER_CARD_OFFSET;
  const preferredTop = anchorY + HOVER_CARD_OFFSET;
  const flippedLeft = anchorX - width - HOVER_CARD_OFFSET;
  const flippedTop = anchorY - height - HOVER_CARD_OFFSET;
  const left = preferredLeft > maxLeft && flippedLeft >= HOVER_CARD_VIEWPORT_PADDING ? flippedLeft : preferredLeft;
  const top = preferredTop > maxTop && flippedTop >= HOVER_CARD_VIEWPORT_PADDING ? flippedTop : preferredTop;

  return {
    left: clampHoverCoordinate(left, HOVER_CARD_VIEWPORT_PADDING, maxLeft),
    top: clampHoverCoordinate(top, HOVER_CARD_VIEWPORT_PADDING, maxTop),
  };
}

function TimelineHoverCard({ hover }: { hover: TimelineHoverState }) {
  const lines = formatDayRibbonHoverTitle(hover.segment).split("\n");
  const [heading, duration, _activityLabel, ...activityLines] = lines;

  return (
    <div className="timeline-hover-card" style={{ left: hover.x + 16, top: hover.y + 16 }}>
      <div className="timeline-hover-card__head">
        <span className={`category-dot category-dot--${hover.segment.category}`} aria-hidden="true" />
        <strong>{heading}</strong>
      </div>
      <div className="timeline-hover-card__duration">{duration}</div>
      <ClassificationSourcePill source={hover.segment.classificationSource} ai={hover.segment.aiClassification} />
      {activityLines.length > 0 ? (
        <div className="timeline-hover-card__activities">
          {activityLines.map((line) => <span key={line}>{line.replace(/^-\s*/, "")}</span>)}
        </div>
      ) : null}
    </div>
  );
}

function ClassificationSourcePill({ source, ai }: { source?: ClassificationSource | null; ai?: boolean | null }) {
  const label = classificationSourceLabel(source, ai);
  return <span className={`classification-source-pill${ai ? " classification-source-pill--ai" : ""}`}>{label}</span>;
}

function formatDayRibbonHoverTitle(segment: DayRibbonSegment): string {
  const activityLines = segment.activities
    .slice()
    .sort((left, right) => right.durationSeconds - left.durationSeconds)
    .slice(0, 5)
    .map((activity) => `- ${formatActivityHoverLine(activity)}`);
  const remaining = segment.activities.length - activityLines.length;

  return [
    `${categoryLabel(segment.category)} · ${productivityLabel(segment.productivity)} · ${formatQuarterHourLabel(segment.startMinute)}–${formatQuarterHourLabel(segment.endMinute)}`,
    `Duration: ${secondsToLabel(segment.totalSeconds)}`,
    activityLines.length > 0 ? "Activities:" : "Activities: none captured",
    ...activityLines,
    remaining > 0 ? `- ${remaining} more ${remaining === 1 ? "activity" : "activities"}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatActivityHoverLine(activity: DayRibbonSegment["activities"][number]): string {
  const displayName = activity.siteDomain ?? activity.siteTitle ?? activity.appName;
  const detail = activity.windowTitle;
  return `${displayName}${detail && detail !== displayName ? ` · ${detail}` : ""} · ${secondsToLabel(activity.durationSeconds)}`;
}

