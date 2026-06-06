import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, FocusEvent, MouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { ActivityCategory, ActivitySegment, AppIconMap, ClassificationMetrics, ClassificationOptions, ClassificationRule, ClassificationRuleApplyResult, ClassificationRuleCandidate, ClassificationRuleInput, ClassificationRuleTargetKind, ClassificationSource, CurrentActivitySnapshot, DayRibbonSegment, FlowBlock, FlowIntervalMinutes, HourBucket, ProductivityLabel, ProductivityShareMix, SiteDuration, TrackerStatus } from "@dtime/domain";
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
} from "@dtime/domain";
import logoUrl from "./assets/drifty-icon.png";
import { AppGlyph } from "./components/AppGlyph";
import { SiteFavicon } from "./components/SiteFavicon";
import { AppUsagePanel } from "./features/dashboard/AppUsagePanel";
import { FlowChartView } from "./features/flow-chart/FlowChartView";
import { LeaderboardView } from "./features/leaderboard/LeaderboardView";
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
import { DRIFT_ALARM_PANEL_PREVIEWS_ENABLED, isDevOnboardingBypassEnabled, WATCHER_PEEK_PROTOTYPE_ENABLED } from "./appFeatureSwitches";
import { useAuth } from "./features/auth/AuthContext";
import { AuthModal } from "./features/auth/AuthModal";
import { FeedbackModal } from "./features/feedback/FeedbackModal";
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
  showNativeWatcherPeek,
  type EndOfDayReviewAction,
} from "./features/companion/watcherBridge";
import {
  hideNativeDriftAlarm,
  listenToNativeDriftAlarmAction,
  listenToNativeDriftAlarmDismissed,
  showNativeDriftAlarm,
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
  fetchBillingEntitlement,
  type BillingEntitlement,
} from "./features/billing/billingService";

type ThemeMode = "light" | "dark";
type StartOfWeek = "sunday" | "monday" | "saturday";
type CategoryColorOverrides = Partial<Record<ActivityCategory, string>>;
type AppThemeColorKey = "accent" | "productivityFocus" | "productivityDrift" | "productivityNeutral";
type AppThemeColorOverrides = Partial<Record<AppThemeColorKey, string>>;
type TabId = "dashboard" | "classify" | "drift" | "leaderboard" | "settings";
type DashboardPeriod = "Today" | "Week" | "Month";
type ClassificationRange = "Day" | "Week";
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

type DayFieldSlot = {
  index: number;
  minuteOfDay: number;
  hour: number;
  quarter: number;
  totalSeconds: number;
  ratio: number;
};

type HistoryCell = {
  id: string;
  isoDay: string;
  label: string;
  minutes: number;
  focusScore: number;
  level: 0 | 1 | 2 | 3;
  isSelected: boolean;
  isEmpty?: boolean;
};

type HistoryMonth = {
  id: string;
  label: string;
  weeks: HistoryCell[][];
};

type HistoryOverview = {
  months: HistoryMonth[];
  activeDays: number;
  streakDays: number;
  bestDayLabel: string;
  bestDayMinutes: number;
  totalTrackedSeconds: number;
  averageTrackedSeconds: number;
};

type FocusDriftPoint = {
  id: string;
  day: string;
  label: string;
  unit: "window";
  bucketStartMinute: number;
  isFuture: boolean;
  focusSeconds: number;
  driftSeconds: number;
  focusCaptures: number;
  driftCaptures: number;
  totalSeconds: number;
  focusScore: number;
  driftScore: number;
  topFocusSource: FocusDriftSourceSummary | null;
  topDriftSource: FocusDriftSourceSummary | null;
  x: number;
  focusY: number;
  driftY: number;
};

type FocusDriftSourceSummary = {
  id: string;
  label: string;
  detail: string;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  seconds: number;
  captures: number;
};

type FocusDriftSourceAccumulator = FocusDriftSourceSummary;

type FocusDriftAxisTick = {
  id: string;
  label: string;
  x: number;
};

type FocusDriftAxisTickStyle = CSSProperties & {
  "--focus-drift-axis-x": string;
};

type FocusDriftLiveStyle = CSSProperties & {
  "--focus-drift-now-x": string;
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

type FocusDriftChart = {
  points: FocusDriftPoint[];
  focusPath: string;
  driftPath: string;
  focusAreaPath: string;
  peakFocusPoint: FocusDriftPoint | null;
  peakDriftPoint: FocusDriftPoint | null;
  focusConsistency: number;
  hasData: boolean;
  isLive: boolean;
  currentX: number | null;
  currentTimeLabel: string | null;
};

type ProductivityAnalysisKind = Extract<ProductivityLabel, "focus" | "drift">;

type ProductivitySurfaceInsight = {
  id: string;
  label: string;
  detail: string;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  seconds: number;
  captures: number;
  activeDays: number;
  share: number;
};

type DriftPatternTone = "warn" | "focus" | "neutral";

type DriftPatternCard = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: DriftPatternTone;
};

type ProductivityInsightReport = {
  totalSeconds: number;
  trackedDays: number;
  startedWithProductivityDays: number;
  topSurfaces: ProductivitySurfaceInsight[];
  patternCards: DriftPatternCard[];
};

type DashboardPeriodOption = {
  period: DashboardPeriod;
  label: string;
  detail: string;
};

type WeekCategorySlice = {
  category: ActivityCategory;
  totalSeconds: number;
  ratio: number;
};

type WeekDayRow = {
  day: string;
  dayName: string;
  dayNumber: string;
  totalSeconds: number;
  focusSeconds: number;
  focusScore: number;
  slices: WeekCategorySlice[];
};
type WeekCalendarIdentity = {
  id: string;
  label: string;
  appName: string;
  bundleId: string | null;
  browserName: string | null;
  siteDomain: string | null;
  siteTitle: string | null;
};
type WeekCalendarEventIdentity = WeekCalendarIdentity & {
  seconds: number;
  firstStartMinute: number;
};
type WeekCalendarEvent = {
  id: string;
  appName: string;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  startLabel: string;
  endLabel: string;
  detailSummary: string;
  detailTitle: string;
  sessionCount: number;
  identities: WeekCalendarEventIdentity[];
  hiddenIdentityCount: number;
  isGroupedCluster: boolean;
  classificationSource: ClassificationSource;
  aiClassification: boolean;
  topMinutes: number;
  durationMinutes: number;
  isShort: boolean;
  lane: number;
  laneCount: number;
};

type WeekCalendarEventStyle = CSSProperties & {
  "--event-tone"?: string;
};

type WeekCalendarNowMarkerStyle = CSSProperties & {
  "--week-calendar-now-offset": string;
  "--week-calendar-now-line-end": string;
};

type MonthOverviewCell = {
  id: string;
  isoDay: string;
  dayNumber?: number;
  totalSeconds: number;
  focusSeconds: number;
  driftSeconds: number;
  isBlank: boolean;
  isFuture: boolean;
  isToday: boolean;
  isSelected: boolean;
};

type MonthOverview = {
  monthLabel: string;
  weeks: MonthOverviewCell[][];
  activeDays: number;
  focusDays: number;
  streakDays: number;
  bestDay: MonthOverviewCell | null;
  totalFocusSeconds: number;
  totalDriftSeconds: number;
  totalTrackedSeconds: number;
  averageFocusPerActiveDay: number;
  peakActivitySeconds: number;
  weekdayFocusAverages: number[];
  maxWeekdayFocusAverage: number;
  categoryEntries: CategoryDuration[];
  productivityEntries: ProductivityDuration[];
  primaryProductivity: ProductivityDuration | null;
};

type MonthCellStyle = CSSProperties & {
  "--activity-tone"?: string;
  "--activity-border"?: string;
  "--activity-ink"?: string;
};

type SettingsSection = "general" | "classification" | "aiSetup" | "notifications" | "privacy" | "data" | "dev";
type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
type LocalAiProvider = "openrouter_byok" | "self_hosted";
type LocalAiSetupState = {
  provider: LocalAiProvider;
  openRouterApiKey: string;
  openRouterModel: string;
  selfHostedBaseUrl: string;
  selfHostedModel: string;
};
type PersistedLocalAiSetupState = Omit<LocalAiSetupState, "openRouterApiKey">;
type WatcherSnapshot = Omit<WatcherPeekEvent, "id" | "slotIndex">;
type WatcherDelayRange = {
  minMs: number;
  maxMs: number;
};
type WatcherMode = "periodic" | "drift_only";
type DriftReminderState = {
  identity: string;
  thresholdSeconds: number;
};

type ClassificationSourceSummary = {
  usageKind: "app" | "site";
  appName: string;
  siteDomain: string | null;
  siteTitle: string | null;
  totalSeconds: number;
  sessionCount: number;
  averageSessionSeconds: number;
  shareOfTotal: number;
};

type ClassificationActivityRow = {
  id: string;
  label: string;
  totalSeconds: number;
  count: number;
  startedLabel: string;
  endedLabel: string;
  segments: ActivitySegment[];
  hasDetails: boolean;
};

const THEME_STORAGE_KEY = "drifty.theme";
const LEGACY_THEME_STORAGE_KEY = "dtime.theme";
const DRIFT_ALERTS_STORAGE_KEY = "drifty.notifications.driftAlerts";
const LEGACY_DRIFT_ALERTS_STORAGE_KEY = "dtime.notifications.driftAlerts";
const WATCHER_PEEK_STORAGE_KEY = "drifty.companion.watcherPeek";
const WATCHER_MODE_STORAGE_KEY = "drifty.companion.watcherMode";
const WATCHER_PERIODIC_MIN_STORAGE_KEY = "drifty.companion.periodicMinMinutes";
const WATCHER_PERIODIC_MAX_STORAGE_KEY = "drifty.companion.periodicMaxMinutes";
const WATCHER_RESPONSE_STORAGE_KEY = "drifty.companion.watcherResponses";
const END_OF_DAY_REVIEW_STORAGE_KEY = "drifty.endOfDayReview.lastShownDate";
const LEGACY_WATCHER_PEEK_STORAGE_KEY = "dtime.companion.watcherPeek";
const LEGACY_WATCHER_MODE_STORAGE_KEY = "dtime.companion.watcherMode";
const LEGACY_WATCHER_PERIODIC_MIN_STORAGE_KEY = "dtime.companion.periodicMinMinutes";
const LEGACY_WATCHER_PERIODIC_MAX_STORAGE_KEY = "dtime.companion.periodicMaxMinutes";
const LEGACY_WATCHER_RESPONSE_STORAGE_KEY = "dtime.companion.watcherResponses";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "drifty.sidebar.collapsed";
const LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY = "dtime.sidebar.collapsed";
const AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY = "drifty.dev.showAiClassificationImpact";
const LEGACY_AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY = "dtime.dev.showAiClassificationImpact";
const LOCAL_AI_SETUP_STORAGE_KEY = "drifty.aiSetup.v1";
const START_OF_DAY_STORAGE_KEY = "drifty.general.startOfDayMinutes";
const START_OF_WEEK_STORAGE_KEY = "drifty.general.startOfWeek";
const CATEGORY_COLOR_STORAGE_KEY = "drifty.theme.categoryColors.v1";
const APP_THEME_COLOR_STORAGE_KEY = "drifty.theme.appColors.v1";
const DEFAULT_START_OF_DAY_MINUTES = 4 * 60;
const DEFAULT_START_OF_WEEK: StartOfWeek = "monday";
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const START_OF_DAY_OPTIONS: Array<{ value: string; label: string; minutes: number }> = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  return { value, label: formatStartOfDayOptionLabel(hour * 60), minutes: hour * 60 };
});
const START_OF_WEEK_OPTIONS = [
  { value: "monday", label: "Monday" },
  { value: "sunday", label: "Sunday" },
  { value: "saturday", label: "Saturday" },
] satisfies ReadonlyArray<{ value: StartOfWeek; label: string }>;
const APP_THEME_COLOR_OPTIONS: Array<{ key: AppThemeColorKey; label: string; cssVariable: string; defaultColor: string }> = [
  { key: "accent", label: "Accent", cssVariable: "--accent", defaultColor: "#6b7a22" },
  { key: "productivityFocus", label: "Focus", cssVariable: "--productivity-focus", defaultColor: "#536414" },
  { key: "productivityDrift", label: "Drift", cssVariable: "--productivity-drift", defaultColor: "#8f352d" },
  { key: "productivityNeutral", label: "Neutral", cssVariable: "--productivity-neutral", defaultColor: "#b8b3a7" },
];
const APP_THEME_ACCENT_COLOR_OPTIONS = APP_THEME_COLOR_OPTIONS.filter((option) => option.key === "accent");
const APP_THEME_PRODUCTIVITY_COLOR_OPTIONS = APP_THEME_COLOR_OPTIONS.filter((option) => option.key !== "accent");
const CATEGORY_COLOR_OPTIONS: Array<{ key: ActivityCategory; label: string; cssVariable: string; defaultColor: string }> = [
  { key: "workspace", label: "Workspace", cssVariable: "--category-workspace", defaultColor: "#7f912b" },
  { key: "learning", label: "Learning", cssVariable: "--category-learning", defaultColor: "#577b72" },
  { key: "communication", label: "Communication", cssVariable: "--category-communication", defaultColor: "#9b978b" },
  { key: "music", label: "Music", cssVariable: "--category-music", defaultColor: "#7c6d95" },
  { key: "game", label: "Game", cssVariable: "--category-game", defaultColor: "#9a633d" },
  { key: "social_media", label: "Social media", cssVariable: "--category-social-media", defaultColor: "#a8564f" },
  { key: "entertainment", label: "Entertainment", cssVariable: "--category-entertainment", defaultColor: "#b76055" },
  { key: "shopping", label: "Shopping", cssVariable: "--category-shopping", defaultColor: "#a9783f" },
  { key: "utility", label: "Utility", cssVariable: "--category-utility", defaultColor: "#817e75" },
  { key: "unknown", label: "Unknown", cssVariable: "--category-unknown", defaultColor: "#5f5d56" },
];
const DEFAULT_THEME: ThemeMode = "light";
const DEFAULT_LOCAL_AI_SETUP: LocalAiSetupState = {
  provider: "openrouter_byok",
  openRouterApiKey: "",
  openRouterModel: "openrouter/auto",
  selfHostedBaseUrl: "http://localhost:11434/v1",
  selfHostedModel: "",
};
const DRIFT_ALERT_MIN_SECONDS = 5 * 60;
const DRIFT_ALARM_PREVIEW_OPTIONS = [
  { id: "youtube-5m", label: "YouTube 5m", contextLabel: "youtube.com", driftDurationSeconds: 5 * 60, preservedFocusStrikeSeconds: 30 * 60 },
  { id: "x-12m", label: "X 12m", contextLabel: "x.com", driftDurationSeconds: 12 * 60, preservedFocusStrikeSeconds: 60 * 60 },
  { id: "no-context-1h", label: "No context 1h", contextLabel: "", driftDurationSeconds: 60 * 60, preservedFocusStrikeSeconds: 2 * 60 * 60 },
] as const;
const DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES = { min: 10, max: 30 };
const WATCHER_PERIODIC_MIN_LIMIT_MINUTES = 10;
const WATCHER_PERIODIC_MAX_LIMIT_MINUTES = 240;
const WATCHER_INITIAL_PEEK_DELAY_MS = 5_000;
const END_OF_DAY_REVIEW_TRIGGER_MINUTE = 18 * 60;
const WATCHER_DRIFT_ONLY_CHECK_DELAY_MS = 10_000;
const WATCHER_DRIFT_REMINDER_THRESHOLDS_SECONDS = [10, 5 * 60, 30 * 60, 60 * 60, 2 * 60 * 60] as const;
const WATCHER_STALE_EVENT_RECOVERY_MS = 30_000;
const HOVER_CARD_OFFSET = 16;
const HOVER_CARD_VIEWPORT_PADDING = 16;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type TimelineItem = ReturnType<typeof formatTimelineItems>[number];
type CategoryBreakdownUsageItem = ReturnType<typeof buildAppUsageSummaries>[number];

type CategoryProductivityMixItem = {
  productivity: ProductivityLabel;
  totalSeconds: number;
  ratio: number;
};

type ClassificationCategoryBreakdown = {
  category: ActivityCategory;
  totalSeconds: number;
  shareOfDay: number;
  sessionCount: number;
  averageSessionSeconds: number;
  longestSession: TimelineItem | null;
  dominantSurface: CategoryBreakdownUsageItem | null;
  productivityMix: CategoryProductivityMixItem[];
  dominantProductivity: CategoryProductivityMixItem | null;
  topApps: CategoryBreakdownUsageItem[];
  topSites: CategoryBreakdownUsageItem[];
};

type CategoryBreakdownCardStyle = CSSProperties & {
  "--category-breakdown-tone": string;
};

type ClassificationPanelStyle = CSSProperties & {
  "--classification-selected-tone": string;
};

const CATEGORY_BREAKDOWN_USAGE_LIMIT = 4;

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

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  workspace: "var(--category-workspace)",
  learning: "var(--category-learning)",
  communication: "var(--category-communication)",
  music: "var(--category-music)",
  game: "var(--category-game)",
  social_media: "var(--category-social-media)",
  entertainment: "var(--category-entertainment)",
  shopping: "var(--category-shopping)",
  utility: "var(--category-utility)",
  unknown: "var(--category-unknown)",
};

const PRODUCTIVITY_COLORS: Record<ProductivityLabel, string> = {
  focus: "var(--flow-tone-focus)",
  neutral: "var(--flow-tone-neutral)",
  drift: "var(--flow-tone-drift)",
};

const FLOW_BREAKDOWN_PRODUCTIVITY_ORDER: ProductivityLabel[] = ["focus", "drift", "neutral"];

const FOCUS_DRIFT_CHART_BOUNDS = { left: 5, right: 95, top: 8, bottom: 92 } as const;
const FOCUS_DRIFT_MINUTES_PER_DAY = 24 * 60;
const FOCUS_DRIFT_BUCKET_MINUTES = 30;
const FOCUS_DRIFT_BUCKET_COUNT = FOCUS_DRIFT_MINUTES_PER_DAY / FOCUS_DRIFT_BUCKET_MINUTES;
const FOCUS_DRIFT_AXIS_TICKS: FocusDriftAxisTick[] = Array.from({ length: 9 }, (_, index) => {
  const hour = index * 3;
  const chartWidth = FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left;
  return {
    id: `focus-drift-axis-${hour}`,
    label: `${hour.toString().padStart(2, "0")}:00`,
    x: FOCUS_DRIFT_CHART_BOUNDS.left + (hour / 24) * chartWidth,
  };
});
const FOCUS_DRIFT_CLIP_PADDING = { x: 2.5, y: 2.5 } as const;
const FOCUS_DRIFT_CLIP_BOUNDS = {
  left: FOCUS_DRIFT_CHART_BOUNDS.left - FOCUS_DRIFT_CLIP_PADDING.x,
  right: FOCUS_DRIFT_CHART_BOUNDS.right + FOCUS_DRIFT_CLIP_PADDING.x,
  top: FOCUS_DRIFT_CHART_BOUNDS.top - FOCUS_DRIFT_CLIP_PADDING.y,
  bottom: FOCUS_DRIFT_CHART_BOUNDS.bottom + FOCUS_DRIFT_CLIP_PADDING.y,
} as const;
const FOCUS_DRIFT_Y_AXIS_TICKS = [
  { label: "100%", y: scaleFocusDriftY(100) },
  { label: "50%", y: scaleFocusDriftY(50) },
  { label: "0%", y: scaleFocusDriftY(0) },
] as const;
const FOCUS_DRIFT_GRID_PATH = FOCUS_DRIFT_Y_AXIS_TICKS.map((tick) => `M${FOCUS_DRIFT_CHART_BOUNDS.left} ${tick.y}H${FOCUS_DRIFT_CHART_BOUNDS.right}`).join(" ");
const DRIFT_RUN_MAX_GAP_SECONDS = 5 * 60;

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

function classifySourceKey(item: ClassificationSourceSummary): string {
  if (item.usageKind === "site" && item.siteDomain) return `site:${item.siteDomain}`;
  return `app:${item.appName}`;
}

function classifySegmentSourceKey(segment: ActivitySegment): string {
  if (segment.siteDomain) return `site:${segment.siteDomain}`;
  return `app:${segment.appName}`;
}

function classificationActivityLabel(segment: ActivitySegment): string {
  return (segment.windowTitle || "").trim()
    || (segment.siteTitle || "").trim()
    || (segment.siteDomain || "").trim()
    || segment.appName;
}

function segmentHasUsefulCaptureDetails(segment: ActivitySegment, rowLabel: string): boolean {
  const title = (segment.youtubeTitle || segment.siteTitle || segment.windowTitle || "").trim();
  return Boolean(
    segment.browserName
    || segment.siteDomain
    || segment.youtubeChannelName
    || (title && title !== rowLabel)
    || segment.classification?.source
    || segment.classification?.reason
    || segment.classification?.confidence != null,
  );
}

function hashStringForDomId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function classificationActivityDetailsId(rowId: string): string {
  const readableId = rowId
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "activity";
  return `classification-activity-details-${readableId}-${hashStringForDomId(rowId)}`;
}

function formatClassificationConfidence(confidence: number): string {
  return `${Math.round(Math.min(Math.max(confidence, 0), 1) * 100)}%`;
}

function truncateCaptureSummary(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function safeCaptureSummary(value: string): string {
  return truncateCaptureSummary(value.replace(/https?:\/\/\S+/gi, "[link]").replace(/\bwww\.\S+/gi, "[link]"));
}

function captureSurfaceDetails(segment: ActivitySegment): string[] {
  return [
    segment.appName ? `App: ${segment.appName}` : null,
    segment.browserName ? `Browser: ${segment.browserName}` : null,
    segment.siteDomain ? `Domain: ${segment.siteDomain}` : null,
    segment.youtubeChannelName ? `Channel: ${safeCaptureSummary(segment.youtubeChannelName)}` : null,
  ].filter((item): item is string => Boolean(item));
}

function captureRowSurfaceDetails(segments: ActivitySegment[]): string[] {
  const details = new Set<string>();
  for (const segment of segments) {
    for (const detail of captureSurfaceDetails(segment)) details.add(detail);
  }
  return Array.from(details);
}

type ClassificationRowSummary = {
  categoryLabel: string;
  productivityLabel: string;
  sourceLabel: string;
  confidenceLabel: string;
};

export function classificationRowSummary(segments: ActivitySegment[], options?: ClassificationOptions): ClassificationRowSummary | null {
  const classifications = segments.map((segment) => classifyActivityDetailed(segment, options));
  const firstClassification = classifications[0];
  if (!firstClassification) return null;

  const categoryValues = new Set(classifications.map((classification) => classification.category));
  const productivityValues = new Set(classifications.map((classification) => classification.productivity));
  const sourceValues = new Set(classifications.map((classification) => classification.source));
  let confidenceTotal = 0;
  let positiveConfidenceCount = 0;

  for (const classification of classifications) {
    if (Number.isFinite(classification.confidence) && classification.confidence > 0) {
      confidenceTotal += classification.confidence;
      positiveConfidenceCount += 1;
    }
  }

  let confidenceLabel = "Confidence unavailable";
  if (positiveConfidenceCount === classifications.length) {
    confidenceLabel = formatClassificationConfidence(confidenceTotal / positiveConfidenceCount);
  } else if (positiveConfidenceCount > 0) {
    confidenceLabel = "Mixed confidence";
  }

  return {
    categoryLabel: categoryValues.size > 1 ? "Mixed" : categoryLabel(firstClassification.category),
    productivityLabel: productivityValues.size > 1 ? "Mixed" : productivityLabel(firstClassification.productivity),
    sourceLabel: sourceValues.size > 1 ? "Mixed" : classificationSourceLabel(firstClassification.source, firstClassification.source === "llm"),
    confidenceLabel,
  };
}

function buildClassificationSourceSummaries(segments: ActivitySegment[]): ClassificationSourceSummary[] {
  const sourceMap = new Map<string, ClassificationSourceSummary>();
  for (const segment of segments) {
    const usageKind: "app" | "site" = segment.siteDomain ? "site" : "app";
    const key = usageKind === "site" ? `site:${segment.siteDomain}` : `app:${segment.appName}`;
    const existing = sourceMap.get(key) ?? {
      usageKind,
      appName: segment.appName,
      siteDomain: segment.siteDomain ?? null,
      siteTitle: segment.siteTitle ?? null,
      totalSeconds: 0,
      sessionCount: 0,
      averageSessionSeconds: 0,
      shareOfTotal: 0,
    };
    existing.totalSeconds += segment.durationSeconds;
    existing.sessionCount += 1;
    sourceMap.set(key, existing);
  }
  const total = segments.reduce((sum, s) => sum + s.durationSeconds, 0);
  return Array.from(sourceMap.values())
    .map((item) => ({
      ...item,
      averageSessionSeconds: item.sessionCount > 0 ? Math.round(item.totalSeconds / item.sessionCount) : 0,
      shareOfTotal: total > 0 ? item.totalSeconds / total : 0,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

function buildClassificationActivityRows(segs: ActivitySegment[]): ClassificationActivityRow[] {
  const rows = new Map<string, ClassificationActivityRow>();
  const ordered = segs.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const item of ordered) {
    const label = classificationActivityLabel(item);
    const key = `${classifySegmentSourceKey(item)}:${label}`;
    const current = rows.get(key) ?? {
      id: key,
      label,
      totalSeconds: 0,
      count: 0,
      startedLabel: formatTimeLabel(item.startedAt),
      endedLabel: formatTimeLabel(item.endedAt),
      segments: [],
      hasDetails: false,
    };
    current.totalSeconds += item.durationSeconds;
    current.count += 1;
    current.endedLabel = formatTimeLabel(item.endedAt);
    current.segments.push(item);
    rows.set(key, current);
  }
  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      hasDetails: row.count > 1 || row.segments.some((segment) => segmentHasUsefulCaptureDetails(segment, row.label)),
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
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
  const [watcherPeriodicMinMinutes, setWatcherPeriodicMinMinutes] = useState(() => resolveInitialWatcherPeriodicMinutes("min"));
  const [watcherPeriodicMaxMinutes, setWatcherPeriodicMaxMinutes] = useState(() => resolveInitialWatcherPeriodicMinutes("max"));
  const [watcherEvent, setWatcherEvent] = useState<WatcherPeekEvent | null>(null);
  const [endOfDayReviewEvent, setEndOfDayReviewEvent] = useState<EndOfDayReviewEvent | null>(null);
  const [driftAlarmEvent, setDriftAlarmEvent] = useState<DriftAlarmEvent | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);

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
  const selectedDayClassificationOptions = useMemo<ClassificationOptions>(
    () => ({
      fallbackCandidates: segments,
      includeAiClassifications: showAiClassificationImpact,
    }),
    [segments, showAiClassificationImpact],
  );
  const recentDriftAlarmFocusTargets = useMemo(
    () => buildRecentFocusTargets(segments, selectedDayClassificationOptions, appIcons),
    [appIcons, segments, selectedDayClassificationOptions],
  );
  const localAiClassificationOptions = useMemo(() => {
    if (localAiSetup.provider === "openrouter_byok") {
      const apiKey = localAiSetup.openRouterApiKey.trim();
      if (!apiKey) return null;
      return { localProvider: { provider: "openrouter_byok" as const, apiKey, model: localAiSetup.openRouterModel.trim() || DEFAULT_LOCAL_AI_SETUP.openRouterModel } };
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
    signInAnonymously,
    signOut,
    isEnabled: isSupabaseConfigured,
    isAuthRequired,
    allowsAnonymousAuth,
    hasRequiredAccountAuth,
    hasBlockingAuthConfigurationError,
  } = useAuth();
  const isEffectiveAuthRequired = isAuthRequired || developerAuthRequiredPreview;
  const allowsEffectiveAnonymousAuth = allowsAnonymousAuth && !developerAuthRequiredPreview;
  const hasEffectiveBlockingAuthConfigurationError = hasBlockingAuthConfigurationError || (developerAuthRequiredPreview && !isSupabaseConfigured);
  const shouldCheckBillingEntitlement = isSupabaseConfigured && authStatus === "authenticated" && hasRequiredAccountAuth;
  const shouldBlockLocalTrackerAccess = developerAuthRequiredPreview && (hasEffectiveBlockingAuthConfigurationError || !hasRequiredAccountAuth);
  const isPolicySignedIn = Boolean(user) && (!isEffectiveAuthRequired || hasRequiredAccountAuth);
  const isSidebarVisuallyCollapsed = sidebarCollapsed;
  const refreshRequestRef = useRef(0);
  const leaderboardRefreshRequestRef = useRef(0);
  const autoSelectedLatestDayRef = useRef(false);
  const userSelectedDayRef = useRef(false);
  const lastDriftAlertSegmentRef = useRef<string | null>(null);
  const autoStartAttemptedRef = useRef(false);
  const watcherSnapshotRef = useRef<WatcherSnapshot>(getDefaultWatcherSnapshot());
  const watcherEventRef = useRef<WatcherPeekEvent | null>(null);
  const watcherRequestInFlightRef = useRef(false);
  const watcherRecoveryTimeoutRef = useRef(0);
  const endOfDayReviewQueryPreviewShownRef = useRef(false);
  const shouldFocusEndOfDayReviewSettingsRef = useRef(false);
  const driftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
  const driftAlarmRequestInFlightRef = useRef(false);
  const pendingDriftAlarmEventRef = useRef<DriftAlarmEvent | null>(null);
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

  const handleEndOfDayReviewPreview = useCallback(() => {
    const previewSegments = segments.length > 0 ? segments : buildMockEndOfDayReviewSegments(selectedDay);
    showEndOfDayReview(buildEndOfDayReviewSummary({
      day: selectedDay,
      generatedAt: new Date().toISOString(),
      segments: previewSegments,
      isMock: true,
    }));
  }, [segments, selectedDay, showEndOfDayReview]);

  const clearDriftAlarmEvent = useCallback(() => {
    driftAlarmEventRef.current = null;
    pendingDriftAlarmEventRef.current = null;
    setDriftAlarmEvent(null);
  }, []);

  const showDriftAlarm = useCallback((event: DriftAlarmEvent) => {
    if (driftAlarmEventRef.current?.id === event.id) return;
    if (driftAlarmRequestInFlightRef.current) {
      pendingDriftAlarmEventRef.current = event;
      return;
    }

    driftAlarmEventRef.current = event;

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

  const handleDriftAlarmAction = useCallback((action: DriftAlarmAction) => {
    dismissDriftAlarm();

    switch (action.type) {
      case "settings":
        setSettingsSection("notifications");
        navigateToTab("settings");
        return;
      case "manual_correction":
        navigateToTab("classify");
        return;
      case "return_to_focus":
        navigateToTab("dashboard");
        return;
      case "start_break":
        return;
    }
  }, [dismissDriftAlarm, navigateToTab]);

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

  async function refresh(day = selectedDay) {
    if (shouldBlockLocalTrackerAccess) {
      refreshRequestRef.current += 1;
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = refreshRequestRef.current + 1;
    refreshRequestRef.current = requestId;
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

      const [timeline, archiveTimelines, historyHourlySummary, historySiteSummary, nextCurrentSnapshot, nextClassificationMetrics, nextAiClassificationUsage] = await Promise.all([
        trackerClient.getTimeline(selectedDayRange),
        archiveTimelineRequest,
        trackerClient.getHourlySummary(historySummaryRange),
        trackerClient.getTopSites({ ...historySummaryRange, limit: 8 }),
        trackerClient.getCurrentSnapshot().catch(() => null),
        loadClassificationMetrics(day),
        loadAiClassificationUsage(day),
        statusRequest,
      ]);

      if (refreshRequestRef.current !== requestId) return;
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
    } catch (nextError) {
      if (refreshRequestRef.current !== requestId) return;
      setError(toErrorMessage(nextError));
    } finally {
      if (refreshRequestRef.current === requestId) {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    }
  }

  useEffect(() => {
    window.__DTIME_SET_BOOT_STATUS__?.("Renderer mounted. Showing minimal shell\u2026");
    window.__DTIME_BOOTSTRAPPED__ = true;
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

    const driftSegments = segments
      .filter((segment) => categorizeActivity(segment, selectedDayClassificationOptions) === "drift" && segment.durationSeconds >= DRIFT_ALERT_MIN_SECONDS)
      .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime());
    const latestDrift = driftSegments[0];
    if (!latestDrift) return;

    const alertKey = `${latestDrift.id}:${latestDrift.endedAt}`;
    const preservedFocusStrikeSeconds = computePreservedFocusStrikeSeconds(segments, latestDrift, selectedDayClassificationOptions);
    const showPreservedFocusDriftAlarm = () => {
      if (preservedFocusStrikeSeconds === null || preservedFocusStrikeSeconds <= 0) return;

      const { category } = classifyActivity(latestDrift, selectedDayClassificationOptions);
      showDriftAlarm(buildDriftAlarmEvent({
        id: alertKey,
        contextLabel: getWatcherContextLabel(latestDrift, category),
        driftDurationSeconds: latestDrift.durationSeconds,
        preservedFocusStrikeSeconds,
        generatedAt: new Date().toISOString(),
        focusTargets: recentDriftAlarmFocusTargets,
      }));
    };

    if (lastDriftAlertSegmentRef.current === null) {
      lastDriftAlertSegmentRef.current = alertKey;
      showPreservedFocusDriftAlarm();
      return;
    }
    if (lastDriftAlertSegmentRef.current === alertKey) return;

    lastDriftAlertSegmentRef.current = alertKey;
    showPreservedFocusDriftAlarm();
    void sendDriftNotification(latestDrift);
  }, [driftAlertsEnabled, recentDriftAlarmFocusTargets, selectedDay, selectedDayClassificationOptions, segments, showDriftAlarm, status?.running]);

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
  const isDemoMode = trackerModeLabel === "demo" || status?.databasePath === "/tmp/dtime-demo.sqlite3";
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
    showEndOfDayReview(buildEndOfDayReviewSummary({
      day: todayDay,
      generatedAt: new Date().toISOString(),
      segments: buildMockEndOfDayReviewSegments(todayDay),
      isMock: true,
    }));
  }, [hasLoadedOnce, showEndOfDayReview, shouldShowEndOfDayReviewPreview, todayDay]);

  useEffect(() => {
    if (!hasLoadedOnce) return;
    if (selectedDay !== todayDay) return;
    if (segmentsLoadedDay !== todayDay) return;
    if (!status?.running) return;
    if (currentMinuteOfDay === null || currentMinuteOfDay < END_OF_DAY_REVIEW_TRIGGER_MINUTE) return;
    if (window.localStorage.getItem(END_OF_DAY_REVIEW_STORAGE_KEY) === todayDay) return;

    void showEndOfDayReview(buildEndOfDayReviewSummary({
      day: todayDay,
      generatedAt: new Date().toISOString(),
      segments,
    })).then((shown) => {
      if (shown) window.localStorage.setItem(END_OF_DAY_REVIEW_STORAGE_KEY, todayDay);
    });
  }, [currentMinuteOfDay, hasLoadedOnce, segments, segmentsLoadedDay, selectedDay, showEndOfDayReview, status?.running, todayDay]);

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
    if (!localAiClassificationOptions && (!isSupabaseConfigured || !isPolicySignedIn)) return;
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
      }
    } finally {
      aiClassificationInFlightRef.current = false;
    }
  }, [classificationActionLoading, hasLoadedOnce, isPolicySignedIn, isSupabaseConfigured, localAiClassificationOptions, refreshLeaderboardData, rendererFocused, selectedDay, shouldBlockLocalTrackerAccess]);

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

  const handleConfigureDriftyCloud = useCallback(() => {
    if (!isSupabaseConfigured || !user || (isEffectiveAuthRequired && !hasRequiredAccountAuth)) {
      setAuthModalOpen(true);
      return;
    }

    void refreshBillingEntitlement();
  }, [hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, refreshBillingEntitlement, user]);

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
      setProfileDraft({ displayName, bio: "", avatarUrl: "", websiteUrl: "", githubUrl: "", linkedinUrl: "", isPublic: true });
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
        setProfileDraft({ displayName, bio: "", avatarUrl: "", websiteUrl: "", githubUrl: "", linkedinUrl: "", isPublic: true });
        setProfileError(result.error ?? "Unable to load profile");
      } else {
        const nextProfile = result.data ?? null;
        setProfile(nextProfile);
        setProfileDraft({
          displayName: nextProfile?.display_name ?? fallbackDisplayName(user.email),
          bio: nextProfile?.bio ?? "",
          avatarUrl: nextProfile?.avatar_url ?? "",
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
  }, [hasRequiredAccountAuth, isEffectiveAuthRequired, isSupabaseConfigured, user?.email, user?.id]);

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
    if (!user && !localAiClassificationOptions) {
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
      if (summary.metrics) setClassificationMetrics(summary.metrics);
      const nextUsage = await resolveAiClassificationUsageFromExecutionDelta(executionUsageDay, usageBefore);
      if (summary.savedRecords > 0) {
        await refresh(selectedDay);
        await refreshLeaderboardData();
      }
      setAiClassificationUsageMeasurement(executionUsageDay, nextUsage);
    } catch (nextError) {
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message: toErrorMessage(nextError) });
    } finally {
      aiClassificationInFlightRef.current = false;
      setClassificationActionLoading(false);
    }
  }

  async function handleRunSelectedDayAiClassification() {
    if (!user && !localAiClassificationOptions) {
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
      if (summary.metrics) setClassificationMetrics(summary.metrics);
      const nextUsage = await resolveAiClassificationUsageFromExecutionDelta(executionUsageDay, usageBefore);
      if (summary.savedRecords > 0) {
        await refresh(targetDay);
        await refreshLeaderboardData();
      }
      setAiClassificationUsageMeasurement(executionUsageDay, nextUsage);
    } catch (nextError) {
      setClassificationSummary({ status: "error", selectedSegments: 0, savedRecords: 0, message: toErrorMessage(nextError) });
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
  const hasCategoryColorOverrides = CATEGORY_COLOR_OPTIONS.some((option) => Boolean(categoryColorOverrides[option.key]));
  const hasAccentColorOverride = APP_THEME_ACCENT_COLOR_OPTIONS.some((option) => Boolean(appThemeColorOverrides[option.key]));
  const hasProductivityColorOverrides = APP_THEME_PRODUCTIVITY_COLOR_OPTIONS.some((option) => Boolean(appThemeColorOverrides[option.key]));
  const handleResetCategoryColors = useCallback(() => {
    setCategoryColorOverrides({});
  }, []);
  const handleResetAccentColor = useCallback(() => {
    setAppThemeColorOverrides((current) => {
      const next = { ...current };
      delete next.accent;
      return next;
    });
  }, []);
  const handleResetProductivityColors = useCallback(() => {
    setAppThemeColorOverrides((current) => {
      const next = { ...current };
      for (const option of APP_THEME_PRODUCTIVITY_COLOR_OPTIONS) delete next[option.key];
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

  const cloudStatusLabel = driftyCloudStatusLabel(billingEntitlement, billingEntitlementLoading, isSupabaseConfigured, hasRequiredAccountAuth);
  const cloudDetailLabel = driftyCloudDetailLabel(billingEntitlement, billingEntitlementError, isSupabaseConfigured, hasRequiredAccountAuth);
  const aiServerStatusLabel = aiServerStatusLabelForCloud(billingEntitlement, billingEntitlementLoading, isSupabaseConfigured, hasRequiredAccountAuth);

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
        </div>
      </div>
      {/* ── Sidebar ── */}
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

      {/* ── Main content ── */}
      <MainContentShell activeTab={activeTab} loading={loading} hasLoadedOnce={hasLoadedOnce} error={error} contentRef={contentRef}>

        {/* Dashboard */}
        {activeTab === "dashboard" ? (
          <div className={`page${dashPeriod === "Week" ? " page--week-dashboard" : ""}`}>
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
                                    : <AppGlyph appName={item.appName} iconSrc={appIcons[item.appName] ?? null} size="sm" />}
                                </div>
                                <div className="classification-panel-view__source-copy">
                                  <strong>{item.usageKind === "site" ? (item.siteDomain ?? item.siteTitle ?? "Unknown site") : item.appName}</strong>
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
                              {selectedClassificationSourceSummary.usageKind === "site"
                                ? (selectedClassificationSourceSummary.siteDomain ?? selectedClassificationSourceSummary.siteTitle ?? "Unknown site")
                                : selectedClassificationSourceSummary.appName}
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
                                              return (
                                                <div key={segment.id} className="classification-panel-view__capture-slice" role="listitem" aria-label={`Capture slice ${index + 1}: ${segmentRange}, ${segmentDuration}`}>
                                                  <span className="classification-panel-view__capture-slice-time">{segmentRange}</span>
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

            <ProductivityPersonaCard report={productivityPersonaReport} hasData={insightSegments.length > 0} />

            <AttentionRhythmCard
              appIcons={appIcons}
              cells={attentionRhythm}
              classificationOptions={insightClassificationOptions}
              segments={insightSegments}
            />

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
            <div className="settings-layout">
              <nav className="settings-nav" aria-label="Settings sections">
                  {([
                    { id: "general" as const, label: "General" },
                    { id: "classification" as const, label: "Classification" },
                    { id: "aiSetup" as const, label: "AI setup" },
                    { id: "notifications" as const, label: "Notifications" },
                    { id: "privacy" as const, label: "Privacy" },
                  { id: "data" as const, label: "Data & Export" },
                ]).map((n) => (
                  <button key={n.id} className={`settings-nav-item${settingsSection === n.id ? " on" : ""}`} onClick={() => setSettingsSection(n.id)}>{n.label}</button>
                ))}
              </nav>
              <div>
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
                      <div className="settings-row settings-row--fallback" role="group" aria-label="Category colors"><div><div className="lbl">Category colors</div><div className="desc">Customize the colors used for classification categories.</div></div><div className="ctrl settings-row__actions"><div className="settings-color-grid">{CATEGORY_COLOR_OPTIONS.map((option) => (<label key={option.key} className="settings-color-field"><span>{option.label}</span><input type="color" aria-label={`${option.label} category color`} value={categoryColorOverrides[option.key] ?? option.defaultColor} onChange={(event) => handleCategoryColorChange(option.key, event.target.value)} /></label>))}</div><button type="button" className="settings-btn" onClick={handleResetCategoryColors} disabled={!hasCategoryColorOverrides}>Set default</button></div></div>
                      <div className="settings-row settings-row--fallback" role="group" aria-label="Accent color"><div><div className="lbl">Accent</div><div className="desc">Adjust the primary app accent used for emphasis and selected states.</div></div><div className="ctrl settings-row__actions"><div className="settings-color-grid">{APP_THEME_ACCENT_COLOR_OPTIONS.map((option) => (<label key={option.key} className="settings-color-field"><span>{option.label}</span><input type="color" aria-label={`${option.label} theme color`} value={appThemeColorOverrides[option.key] ?? option.defaultColor} onChange={(event) => handleAppThemeColorChange(option.key, event.target.value)} /></label>))}</div><button type="button" className="settings-btn" onClick={handleResetAccentColor} disabled={!hasAccentColorOverride}>Set default</button></div></div>
                      <div className="settings-row settings-row--fallback" role="group" aria-label="Productivity colors"><div><div className="lbl">Productivity colors</div><div className="desc">Tune the Focus, Drift, and Neutral tones used in productivity views.</div></div><div className="ctrl settings-row__actions"><div className="settings-color-grid">{APP_THEME_PRODUCTIVITY_COLOR_OPTIONS.map((option) => (<label key={option.key} className="settings-color-field"><span>{option.label}</span><input type="color" aria-label={`${option.label} theme color`} value={appThemeColorOverrides[option.key] ?? option.defaultColor} onChange={(event) => handleAppThemeColorChange(option.key, event.target.value)} /></label>))}</div><button type="button" className="settings-btn" onClick={handleResetProductivityColors} disabled={!hasProductivityColorOverrides}>Set default</button></div></div>
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
                          <label className="classification-rule-field">
                            <span>Category</span>
                            <select className="settings-input settings-select" value={domainRuleCategory} onChange={(event) => setDomainRuleCategory(event.target.value as ActivityCategory)} aria-label="Domain rule category">
                              {CATEGORY_ORDER.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
                            </select>
                          </label>
                          <label className="classification-rule-field">
                            <span>Productivity</span>
                            <select className="settings-input settings-select" value={domainRuleProductivity} onChange={(event) => setDomainRuleProductivity(event.target.value as ProductivityLabel)} aria-label="Domain rule productivity">
                              {PRODUCTIVITY_ORDER.map((productivity) => <option key={productivity} value={productivity}>{productivityLabel(productivity)}</option>)}
                            </select>
                          </label>
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
                          <label className="classification-rule-field">
                            <span>Category</span>
                            <select className="settings-input settings-select" value={appRuleCategory} onChange={(event) => setAppRuleCategory(event.target.value as ActivityCategory)} aria-label="App rule category">
                              {CATEGORY_ORDER.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
                            </select>
                          </label>
                          <label className="classification-rule-field">
                            <span>Productivity</span>
                            <select className="settings-input settings-select" value={appRuleProductivity} onChange={(event) => setAppRuleProductivity(event.target.value as ProductivityLabel)} aria-label="App rule productivity">
                              {PRODUCTIVITY_ORDER.map((productivity) => <option key={productivity} value={productivity}>{productivityLabel(productivity)}</option>)}
                            </select>
                          </label>
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
                  <div className="settings-section">
                    <div className="settings-block cloud-overview">
                      <div className="cloud-overview__header">
                        <div>
                          <h3>AI setup</h3>
                          <p>Choose how Drifty should reach AI later. Local tracking stays on this Mac; AI setup only controls optional classification providers.</p>
                        </div>
                        <span className="chip green">Local-first</span>
                      </div>
                      <div className="settings-row settings-row--fallback"><div><div className="lbl">Local AI provider</div><div className="desc">Configure one local-first route. Drifty currently supports OpenRouter BYOK and self-hosted endpoints only.</div></div><div className="ctrl"><div className="settings-mode-switch" role="radiogroup" aria-label="Local AI provider"><button type="button" className={`settings-mode-option${localAiSetup.provider === "openrouter_byok" ? " is-active" : ""}`} role="radio" aria-checked={localAiSetup.provider === "openrouter_byok"} onClick={() => setLocalAiSetup((current) => ({ ...current, provider: "openrouter_byok" }))}><span>OpenRouter BYOK</span><small>Use your own key</small></button><button type="button" className={`settings-mode-option${localAiSetup.provider === "self_hosted" ? " is-active" : ""}`} role="radio" aria-checked={localAiSetup.provider === "self_hosted"} onClick={() => setLocalAiSetup((current) => ({ ...current, provider: "self_hosted" }))}><span>Self-hosted</span><small>OpenAI-compatible endpoint</small></button></div></div></div>
                      {localAiSetup.provider === "openrouter_byok" ? (
                        <>
                          <div className="settings-row"><label><div className="lbl">OpenRouter API key</div><div className="desc">Kept only for this app session; paste it again after restart.</div></label><div className="ctrl"><input className="settings-input" type="password" autoComplete="off" aria-label="OpenRouter API key" value={localAiSetup.openRouterApiKey} onChange={(event) => setLocalAiSetup((current) => ({ ...current, openRouterApiKey: event.target.value }))} placeholder="sk-or-v1-..." /></div></div>
                          <div className="settings-row"><label><div className="lbl">OpenRouter model</div><div className="desc">Leave the default to let OpenRouter route automatically.</div></label><div className="ctrl"><input className="settings-input" aria-label="OpenRouter model" value={localAiSetup.openRouterModel} onChange={(event) => setLocalAiSetup((current) => ({ ...current, openRouterModel: event.target.value }))} placeholder="openrouter/auto" /></div></div>
                        </>
                      ) : (
                        <>
                          <div className="settings-row"><label><div className="lbl">Self-hosted base URL</div><div className="desc">Use an OpenAI-compatible local or private endpoint.</div></label><div className="ctrl"><input className="settings-input" aria-label="Self-hosted base URL" value={localAiSetup.selfHostedBaseUrl} onChange={(event) => setLocalAiSetup((current) => ({ ...current, selfHostedBaseUrl: event.target.value }))} placeholder="http://localhost:11434/v1" /></div></div>
                          <div className="settings-row"><label><div className="lbl">Self-hosted model</div><div className="desc">Model name exposed by your endpoint.</div></label><div className="ctrl"><input className="settings-input" aria-label="Self-hosted model" value={localAiSetup.selfHostedModel} onChange={(event) => setLocalAiSetup((current) => ({ ...current, selfHostedModel: event.target.value }))} placeholder="llama3.1:8b" /></div></div>
                        </>
                      )}
                      <div className="settings-row"><div><div className="lbl">Local AI setup status</div><div className="desc">Saved locally. Classification execution still uses existing rule-based local classification until provider routing is wired.</div></div><div className="ctrl"><span className="chip">Saved locally</span></div></div>
                    </div>
                    <div className="settings-block cloud-overview">
                      <div className="cloud-overview__header">
                        <div>
                          <h3>Drifty Cloud</h3>
                          <p>Cloud is optional and sits under AI setup for account-backed classification, sync, profile, and leaderboard features.</p>
                        </div>
                        <span className="chip gray">{cloudStatusLabel}</span>
                      </div>
                      <div className="settings-row"><div><div className="lbl">Drifty Cloud</div><div className="desc">{cloudDetailLabel}</div></div><div className="ctrl ctrl--value">{cloudStatusLabel}</div></div>
                      <div className="settings-row"><div><div className="lbl">AI classification server</div><div className="desc">Cloud AI is optional. Rule-based local classification remains available without signing in.</div></div><div className="ctrl ctrl--value">{aiServerStatusLabel}</div></div>
                      <div className="settings-row"><div><div className="lbl">Local tracking</div><div className="desc">Timeline, tracker health, and rule-based classification stay local-first.</div></div><div className="ctrl"><span className="chip green">Local-first</span></div></div>
                      <button type="button" className="settings-btn settings-btn--primary" onClick={handleConfigureDriftyCloud}>{hasRequiredAccountAuth ? "Configure Drifty Cloud" : "Connect Drifty Cloud"}</button>
                    </div>
                  </div>
                )}
                {settingsSection === "notifications" && (
                  <div className="settings-section"><div className="settings-block"><h3>Alerts</h3>
                    <div className="settings-row"><div><div className="lbl">Drift alerts</div><div className="desc">Send a macOS notification when a newly captured drift block runs for 5 minutes or longer.</div></div><div className="ctrl"><Toggle checked={driftAlertsEnabled} onChange={setDriftAlertsEnabled} ariaLabel="Toggle drift alerts" /></div></div>
                    <div className="settings-row" role="group" aria-label="End-of-day review" ref={endOfDayReviewSettingsRowRef} tabIndex={-1}><div><div className="lbl">End-of-day review</div><div className="desc">Show a local summary after 6:00 PM when the tracker is running, or preview it now.</div></div><div className="ctrl"><button type="button" className="settings-btn" onClick={handleEndOfDayReviewPreview}>Preview</button></div></div>
                    {DRIFT_ALARM_PANEL_PREVIEWS_ENABLED ? (
                      <div className="settings-row"><div><div className="lbl">Drift alarm previews</div><div className="desc">Open sample alarm panels without waiting for tracker drift. Dev builds only.</div></div><div className="ctrl settings-row__actions">{DRIFT_ALARM_PREVIEW_OPTIONS.map((option) => (<button key={option.id} type="button" className="settings-btn" onClick={() => previewDriftAlarm(option)}>{option.label}</button>))}</div></div>
                    ) : null}
                    {WATCHER_PEEK_PROTOTYPE_ENABLED && (
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
                    <div className="settings-block"><h3>Export</h3>
                      <div className="settings-row"><div><div className="lbl">Export session data</div><div className="desc">All sessions as CSV</div></div><div className="ctrl"><button className="settings-btn">Download CSV</button></div></div>
                    </div>
                  </div>
                )}
              </div>
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
          <DriftAlarm event={driftAlarmEvent} onAction={handleDriftAlarmAction} />
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

      {onboardingOpen ? (
        <OnboardingModal
          userId={user?.id ?? "local"}
          userEmail={user?.email ?? null}
          initialDisplayName={profileDraft.displayName}
          trackerStatus={status}
          accessibilityGranted={accessibilityGranted}
          onRefreshTracker={refresh}
          onStartTracking={handleStartTrackingFromOnboarding}
          onCheckAccessibility={handleCheckAccessibility}
          onRequestAccessibility={handleRequestAccessibility}
          onEnableDriftAlerts={() => setDriftAlertsEnabled(true)}
          onStartCloudTrial={() => void signInWithWebsite()}
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
        <span className="account-avatar">{displayName.charAt(0).toUpperCase()}</span>
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

const PERSONA_AXIS_LABELS: Record<string, string> = {
  focus: "Focus depth",
  drift: "Drift tendency",
  switching: "Context switching",
  surfaces: "Surface variety",
  reactive: "Reactive work",
  night: "Night work",
};

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
      <section className="editorial-panel editorial-panel--soft insight-section od-cat-rebuilt weekly-summary-rail is-linked" aria-label="Insight weekly summaries">
        {productivityDonut.rows.length > 0 || categoryDonut.rows.length > 0 ? (
          <div className="weekly-summary-rail__stack">
            <WeeklyDonutSummary
              ariaLabel="Insight productivity breakdown"
              className="weekly-summary-rail__summary--productivity"
              view={productivityDonut}
              onShowHover={showAggregateHover}
              onMoveHover={moveSegmentHover}
              onHideHover={() => setHoveredSegment(null)}
            />
            <WeeklyDonutSummary
              ariaLabel="Insight category breakdown"
              className="weekly-summary-rail__summary--category"
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

const INSIGHT_SOURCE_VISIBLE_COUNT = 3;

function InsightSourceGroup({
  variant,
  lists,
  appIcons,
}: {
  variant: ProductivityAnalysisKind;
  lists: InsightSourceLists;
  appIcons: AppIconMap;
}) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const tone = variant === "drift" ? "var(--warn)" : "var(--accent)";
  const label = variant === "drift" ? "Drift patterns" : "Focus patterns";
  const topicsLabel = variant === "drift" ? "Drift after focus" : "Focus before drift";
  const transitionsLabel = variant === "drift" ? "Top drift after focus transitions" : "Top focus before drift transitions";
  const appsLabel = variant === "drift" ? "Drift apps" : "Focus apps";
  const toneStyle = { "--trend-tone": tone } as CSSProperties;
  const hasHiddenSources = lists.apps.length > INSIGHT_SOURCE_VISIBLE_COUNT || lists.topics.length > INSIGHT_SOURCE_VISIBLE_COUNT;

  const renderSourceList = (
    kind: keyof InsightSourceLists,
    sourceLabel: string,
    emptyTitle: string,
    emptyDetail: string,
    includeRank: boolean,
  ) => {
    const items = lists[kind];
    const visibleItems = sourcesExpanded ? items : items.slice(0, INSIGHT_SOURCE_VISIBLE_COUNT);
    const maxValue = Math.max(1, ...items.map((item) => insightSourceValue(item)));

    return (
      <div className="drift-time-trend__sources">
        <span className="label-mono drift-time-trend__sources-label">{sourceLabel}</span>
        <div className="drift-time-trend__sources-items" style={toneStyle}>
          {visibleItems.map((item, index) => (
            <div className="drift-time-trend__sources-item drift-time-trend__sources-item--app" key={item.id}>
              <span className={`drift-time-trend__sources-rank${includeRank ? "" : " drift-time-trend__sources-rank--empty"}`} aria-hidden={!includeRank}>{includeRank ? index + 1 : null}</span>
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
          {renderSourceList("apps", appsLabel, `No ${variant} apps yet`, "Apps appear after classified activity is recorded.", false)}
          {renderSourceList("topics", topicsLabel, `No ${variant} transitions yet`, "Transitions appear after focus is followed by drift.", true)}
        </div>
        {hasHiddenSources && !sourcesExpanded ? (
          <div className="drift-time-trend__sources-more-row">
            <button
              type="button"
              className="drift-time-trend__sources-more"
              aria-expanded="false"
              onClick={() => setSourcesExpanded(true)}
            >
              Show more
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function ProductivityPersonaCard({ report, hasData }: { report: ReturnType<typeof buildProductivityPersona>; hasData: boolean }) {
  const content = PERSONA_CONTENT[report.personaId] ?? PERSONA_CONTENT.balanced_builder;
  const activeDays = report.metrics.activeDays;
  const tagPills = content.tags.split(" · ");
  const radarCenter = { x: 150, y: 116 };
  const radarRadius = 86;
  const radarAxes = report.axes.map((axis) => ({
    ...axis,
    displayLabel: PERSONA_AXIS_LABELS[axis.key] ?? axis.label,
    value: Math.min(1, Math.max(0, axis.value)),
  }));
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
  const radarLabel = `${report.personaName} persona radar: ${radarAxes.map((axis) => `${axis.displayLabel} ${formatSharePercent(axis.value * 100)}`).join(", ")}`;
  const cardClassName = [
    "editorial-panel editorial-panel--soft insight-section productivity-persona-card",
    hasData ? "persona-profile-card" : null,
  ].filter(Boolean).join(" ");

  return (
    <section className={cardClassName} aria-label="Local productivity persona report">
      {hasData ? (
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
                {radarAxes.map((axis, index) => {
                  const point = pointFor(index, 1, radarRadius + 22);
                  return <text className="persona-radar__label" x={point.x.toFixed(1)} y={point.y.toFixed(1)} textAnchor="middle" dominantBaseline="middle" key={axis.key}>{axis.displayLabel}</text>;
                })}
              </svg>
            </div>
            <div className="persona-radar-card__axis-list" aria-hidden="true">
              {radarAxes.map((axis) => <span key={axis.key}>{axis.displayLabel}<strong>{formatSharePercent(axis.value * 100)}</strong></span>)}
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

function driftyCloudDetailLabel(
  entitlement: BillingEntitlement | null,
  error: string | null,
  isConfigured: boolean,
  hasAccount: boolean,
): string {
  if (!isConfigured) return "Supabase is not configured. Local tracking and local rules still work.";
  if (!hasAccount) return "Sign in only when you want Drifty Cloud, sync, profile, leaderboard, or AI classification.";
  if (error) return error;
  if (entitlement?.status === "locked") return "Cloud account access needs attention, but the local app remains available.";
  return "Account-backed cloud features are available. Local tracking remains stored on this Mac.";
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

function formatCategoryPercentage(percentage: number) {
  if (percentage > 0 && percentage < 1) return "<1%";
  return `${Math.round(percentage)}%`;
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

function buildClassificationCategoryBreakdowns(
  segments: ActivitySegment[],
  classificationOptions: ClassificationOptions,
  dayTotalSeconds: number,
): ClassificationCategoryBreakdown[] {
  type CategoryAccumulator = {
    category: ActivityCategory;
    totalSeconds: number;
    segments: ActivitySegment[];
    productivityTotals: Map<ProductivityLabel, number>;
  };
  const categories = new Map<ActivityCategory, CategoryAccumulator>();

  for (const segment of segments) {
    const classification = classifyActivityDetailed(segment, classificationOptions);
    const current = categories.get(classification.category) ?? {
      category: classification.category,
      totalSeconds: 0,
      segments: [],
      productivityTotals: new Map<ProductivityLabel, number>(),
    };

    current.totalSeconds += segment.durationSeconds;
    current.segments.push(segment);
    current.productivityTotals.set(classification.productivity, (current.productivityTotals.get(classification.productivity) ?? 0) + segment.durationSeconds);
    categories.set(classification.category, current);
  }

  return Array.from(categories.values())
    .filter((entry) => entry.totalSeconds > 0)
    .sort((left, right) => right.totalSeconds - left.totalSeconds)
    .map((entry) => {
      const appSegments = entry.segments.filter((segment) => !hasBrowserSiteContext(segment));
      const topApps = buildAppUsageSummaries(appSegments, { limit: CATEGORY_BREAKDOWN_USAGE_LIMIT, groupBy: "app" });
      const topSites = buildAppUsageSummaries(entry.segments)
        .filter((item) => item.usageKind === "site")
        .slice(0, CATEGORY_BREAKDOWN_USAGE_LIMIT);
      const longestSession = formatTimelineItems(entry.segments).sort((left, right) => right.durationSeconds - left.durationSeconds)[0] ?? null;
      const productivityMix = FLOW_BREAKDOWN_PRODUCTIVITY_ORDER
        .map((productivity) => {
          const totalSeconds = entry.productivityTotals.get(productivity) ?? 0;
          return { productivity, totalSeconds, ratio: entry.totalSeconds > 0 ? totalSeconds / entry.totalSeconds : 0 };
        })
        .filter((item) => item.totalSeconds > 0);
      const dominantProductivity = productivityMix.slice().sort((left, right) => right.totalSeconds - left.totalSeconds)[0] ?? null;
      const dominantSurface = [...topApps, ...topSites].sort((left, right) => right.totalSeconds - left.totalSeconds)[0] ?? null;

      return {
        category: entry.category,
        totalSeconds: entry.totalSeconds,
        shareOfDay: dayTotalSeconds > 0 ? entry.totalSeconds / dayTotalSeconds : 0,
        sessionCount: entry.segments.length,
        averageSessionSeconds: entry.segments.length > 0 ? entry.totalSeconds / entry.segments.length : 0,
        longestSession,
        dominantSurface,
        productivityMix,
        dominantProductivity,
        topApps,
        topSites,
      };
    });
}

function usageItemLabel(item: CategoryBreakdownUsageItem): string {
  return item.siteDomain ?? item.siteTitle ?? item.appName;
}

function hasBrowserSiteContext(segment: ActivitySegment): boolean {
  return Boolean(segment.siteDomain?.trim() || segment.siteTitle?.trim());
}

function productivityMixAriaLabel(label: string, entries: CategoryProductivityMixItem[]): string {
  const parts = entries.map((entry) => `${productivityLabel(entry.productivity)} ${formatCompactDurationFromSeconds(entry.totalSeconds)} ${formatCategoryPercentage(entry.ratio * 100)}`);
  return `${label} productivity mix: ${parts.join(", ")}`;
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
    const viewportAnchor = Math.max(96, scroller.clientHeight * 0.35);
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

function classificationSourceLabel(source?: ClassificationSource | null, ai?: boolean | null): string {
  if (ai || source === "llm") return "AI classified";
  if (source === "domain-db" || source === "app-db" || source === "youtube") return "Predefined rule";
  if (source === "context") return "Context rule";
  if (source === "fallback") return "Fallback";
  if (source === "manual") return "Manual";
  if (source === "rule") return "Custom rule";
  if (source === "stored") return "Stored";
  return "Unclassified rule";
}

function categoryLabel(category: CategoryDuration["category"]) {
  switch (category) {
    case "workspace": return "Workspace";
    case "learning": return "Learning";
    case "communication": return "Communication";
    case "music": return "Music";
    case "game": return "Game";
    case "social_media": return "Social media";
    case "entertainment": return "Entertainment";
    case "shopping": return "Shopping";
    case "utility": return "Utility";
    case "unknown": return "Unknown";
  }
}

function productivityLabel(productivity: ProductivityLabel) {
  switch (productivity) { case "focus": return "Focus"; case "neutral": return "Neutral"; case "drift": return "Drift"; }
}

function classificationRuleTargetLabel(targetKind: ClassificationRuleTargetKind): string {
  return targetKind === "site" ? "Domain" : "App";
}

function classificationRuleCandidateAppIconSrc(candidate: ClassificationRuleCandidate, appIcons: AppIconMap): string | null {
  return appIcons[candidate.bundleId ?? candidate.appName ?? candidate.displayName] ?? null;
}

function classificationRuleAppIconSrc(rule: ClassificationRule, appIcons: AppIconMap): string | null {
  return appIcons[rule.targetValue] ?? null;
}

function formatClassificationCandidateUsageLabel(candidate: ClassificationRuleCandidate): string {
  return `${secondsToLabel(candidate.totalSeconds)} across ${candidate.segmentCount} ${candidate.segmentCount === 1 ? "segment" : "segments"}`;
}

function normalizeDomainRuleInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const hostname = new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
    return hostname.replace(/\.$/, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0]
      .replace(/\.$/, "");
  }
}

function normalizeClassificationRuleTarget(targetKind: ClassificationRuleTargetKind, targetValue: string): string {
  return targetKind === "site" ? normalizeDomainRuleInput(targetValue) : targetValue.trim().toLowerCase();
}

function hasDuplicateClassificationRule(rules: ClassificationRule[], targetKind: ClassificationRuleTargetKind, targetValue: string): boolean {
  const normalizedTargetValue = normalizeClassificationRuleTarget(targetKind, targetValue);
  return rules.some((rule) => rule.targetKind === targetKind && normalizeClassificationRuleTarget(rule.targetKind, rule.targetValue) === normalizedTargetValue);
}

function formatClassificationRuleApplyResult(result: ClassificationRuleApplyResult): string {
  return `Matched ${result.matchedCount} local-rule ${result.matchedCount === 1 ? "segment" : "segments"}; applied ${result.appliedCount}, skipped ${result.skippedCount}.`;
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

function getDayPart(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

function buildHistoryOverview(selectedDay: string, dailyTotals: Array<{ day: string; totalSeconds: number }>, segments: ActivitySegment[], classificationOptions?: ClassificationOptions): HistoryOverview {
  const days = dailyTotals.map((entry) => {
    const daySegments = segments.filter((segment) => segment.startedAt.slice(0, 10) === entry.day);
    const productivities = buildProductivityDurations(daySegments, classificationOptions);
    const focusSeconds = productivities.find((item) => item.productivity === "focus")?.totalSeconds ?? 0;
    const driftSeconds = productivities.find((item) => item.productivity === "drift")?.totalSeconds ?? 0;
    const scoredSeconds = focusSeconds + driftSeconds;
    const focusScore = scoredSeconds > 0 ? Math.round((focusSeconds / scoredSeconds) * 100) : 0;
    const minutes = Math.round(entry.totalSeconds / 60);
    const level: 0 | 1 | 2 | 3 = scoredSeconds <= 0 ? 0 : focusScore < 34 ? 1 : focusScore < 68 ? 2 : 3;
    return { id: `history-${entry.day}`, isoDay: entry.day, label: formatDayLabel(entry.day), minutes, focusScore, level, isSelected: entry.day === selectedDay };
  });
  const monthGroups = new Map<string, HistoryCell[]>();
  for (const day of days) {
    const monthKey = day.isoDay.slice(0, 7);
    monthGroups.set(monthKey, [...(monthGroups.get(monthKey) ?? []), day]);
  }
  const dayByIso = new Map(days.map((day) => [day.isoDay, day]));
  const months: HistoryMonth[] = Array.from(monthGroups.keys()).map((monthKey) => {
    const monthDays = getHistoryMonthDays(monthKey).map((day) => dayByIso.get(day) ?? buildEmptyHistoryDay(day, selectedDay));
    const firstDayOffset = monthDays[0] ? new Date(`${monthDays[0].isoDay}T00:00:00`).getDay() : 0;
    const calendarDays: HistoryCell[] = [
      ...Array.from({ length: firstDayOffset }, (_, index) => ({ id: `history-empty-${monthKey}-${index}`, isoDay: "", label: "", minutes: 0, focusScore: 0, level: 0 as const, isSelected: false, isEmpty: true })),
      ...monthDays,
    ];

    return { id: monthKey, label: formatHistoryMonthLabel(monthKey), weeks: chunk(calendarDays, 7) };
  });
  const activeDays = days.filter((d) => d.focusScore > 0);
  const bestDay = activeDays.reduce<HistoryCell | null>((cur, d) => (!cur || d.focusScore > cur.focusScore ? d : cur), null);
  let streakDays = 0;
  for (let i = days.length - 1; i >= 0; i--) { if (days[i].focusScore <= 0) break; streakDays++; }
  const totalTrackedSeconds = days.reduce((sum, d) => sum + d.minutes * 60, 0);
  const averageTrackedSeconds = activeDays.length > 0 ? Math.round(activeDays.reduce((sum, d) => sum + d.focusScore, 0) / activeDays.length) : 0;
  return { months, activeDays: activeDays.length, streakDays, bestDayLabel: bestDay ? bestDay.label : "No focus day", bestDayMinutes: bestDay?.focusScore ?? 0, totalTrackedSeconds, averageTrackedSeconds };
}

function getHistoryMonthDays(month: string): string[] {
  const [yearValue, monthValue] = month.split("-").map(Number);
  const daysInMonth = new Date(yearValue, monthValue, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

const WEEKLY_BREAKDOWN_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

interface WeeklyBreakdownDay {
  weekday: string;
  isActive: boolean;
  focusSeconds: number;
  neutralSeconds: number;
  driftSeconds: number;
  categorySeconds: Partial<Record<ActivityCategory, number>>;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weekdayOrderIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

// Average focus/drift/neutral and per-category seconds for a typical occurrence
// of each weekday across the insight window. Segments are attributed by their
// local start time; captures are short, so midnight spanning is negligible.
function buildWeeklyBreakdown(segments: ActivitySegment[], options?: ClassificationOptions): WeeklyBreakdownDay[] {
  const focus = Array.from({ length: 7 }, () => 0);
  const neutral = Array.from({ length: 7 }, () => 0);
  const drift = Array.from({ length: 7 }, () => 0);
  const categories = Array.from({ length: 7 }, () => new Map<ActivityCategory, number>());
  const dates = Array.from({ length: 7 }, () => new Set<string>());

  for (const segment of segments) {
    const started = new Date(segment.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    const index = weekdayOrderIndex(started);
    const seconds = segment.durationSeconds;
    const { category, productivity } = classifyActivity(segment, options);
    if (productivity === "focus") focus[index] += seconds;
    else if (productivity === "drift") drift[index] += seconds;
    else neutral[index] += seconds;
    categories[index].set(category, (categories[index].get(category) ?? 0) + seconds);
    dates[index].add(localDateKey(started));
  }

  return WEEKLY_BREAKDOWN_WEEKDAYS.map((weekday, index) => {
    const occurrences = Math.max(dates[index].size, 1);
    const categorySeconds: Partial<Record<ActivityCategory, number>> = {};
    for (const [category, seconds] of categories[index]) categorySeconds[category] = seconds / occurrences;
    return {
      weekday,
      isActive: dates[index].size > 0,
      focusSeconds: focus[index] / occurrences,
      neutralSeconds: neutral[index] / occurrences,
      driftSeconds: drift[index] / occurrences,
      categorySeconds,
    };
  });
}

type AttentionRhythmState = "focus" | "drift" | "neutral";

interface AttentionRhythmCell {
  weekdayIndex: number;
  hour: number;
  state: AttentionRhythmState;
  intensity: 0 | 1 | 2 | 3;
}

// 7 weekdays x 24 hours grid. Each cell takes the dominant productivity in that
// weekday/hour bucket; focus/drift cells get an intensity tier relative to the
// busiest bucket of the same kind.
function buildAttentionRhythm(segments: ActivitySegment[], options?: ClassificationOptions): AttentionRhythmCell[] {
  const focus = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const drift = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const neutral = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

  for (const segment of segments) {
    const started = new Date(segment.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    const weekday = weekdayOrderIndex(started);
    const hour = started.getHours();
    const seconds = segment.durationSeconds;
    const { productivity } = classifyActivity(segment, options);
    if (productivity === "focus") focus[weekday][hour] += seconds;
    else if (productivity === "drift") drift[weekday][hour] += seconds;
    else neutral[weekday][hour] += seconds;
  }

  let maxFocus = 0;
  let maxDrift = 0;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      if (focus[weekday][hour] > maxFocus) maxFocus = focus[weekday][hour];
      if (drift[weekday][hour] > maxDrift) maxDrift = drift[weekday][hour];
    }
  }

  const tier = (value: number, max: number): 1 | 2 | 3 => {
    if (max <= 0) return 1;
    const ratio = value / max;
    if (ratio >= 0.66) return 3;
    if (ratio >= 0.33) return 2;
    return 1;
  };

  const cells: AttentionRhythmCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const focusSeconds = focus[weekday][hour];
      const driftSeconds = drift[weekday][hour];
      const neutralSeconds = neutral[weekday][hour];
      const total = focusSeconds + driftSeconds + neutralSeconds;
      if (total <= 0) {
        cells.push({ weekdayIndex: weekday, hour, state: "neutral", intensity: 0 });
        continue;
      }
      if (focusSeconds >= driftSeconds && focusSeconds >= neutralSeconds && focusSeconds > 0) {
        cells.push({ weekdayIndex: weekday, hour, state: "focus", intensity: tier(focusSeconds, maxFocus) });
      } else if (driftSeconds >= focusSeconds && driftSeconds >= neutralSeconds && driftSeconds > 0) {
        cells.push({ weekdayIndex: weekday, hour, state: "drift", intensity: tier(driftSeconds, maxDrift) });
      } else {
        cells.push({ weekdayIndex: weekday, hour, state: "neutral", intensity: 0 });
      }
    }
  }
  return cells;
}

type InsightSourceValueKind = "duration" | "count";

interface InsightSourceItem {
  id: string;
  label: string;
  seconds: number;
  count: number;
  valueKind: InsightSourceValueKind;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  isSite: boolean;
}

interface InsightSourceLists {
  topics: InsightSourceItem[];
  apps: InsightSourceItem[];
}

function buildInsightSourceLists(
  segments: ActivitySegment[],
  productivity: ProductivityLabel,
  options?: ClassificationOptions,
): InsightSourceLists {
  const filtered = segments.filter((segment) => classifyActivity(segment, options).productivity === productivity);
  const toItem = (summary: ReturnType<typeof buildAppUsageSummaries>[number]): InsightSourceItem => ({
    id: `${summary.usageKind}:${summary.siteDomain ?? summary.appName}`,
    label: summary.usageKind === "site" ? (summary.siteDomain ?? summary.appName) : summary.appName,
    seconds: summary.totalSeconds,
    count: summary.sessionCount,
    valueKind: "duration",
    appName: summary.usageKind === "site" ? (summary.siteDomain ?? summary.appName) : summary.appName,
    bundleId: summary.bundleId,
    siteDomain: summary.siteDomain,
    isSite: summary.usageKind === "site",
  });
  return {
    topics: buildFocusDriftTransitionItems(segments, productivity, options),
    apps: buildAppUsageSummaries(filtered, { groupBy: "activity" }).map(toItem),
  };
}

function buildFocusDriftTransitionItems(
  segments: ActivitySegment[],
  productivity: ProductivityLabel,
  options?: ClassificationOptions,
): InsightSourceItem[] {
  const accumulator = new Map<string, InsightSourceItem>();
  const sortedSegments = segments.slice().sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());

  for (let index = 0; index < sortedSegments.length - 1; index += 1) {
    const focusSegment = sortedSegments[index];
    const driftSegment = sortedSegments[index + 1];
    if (classifyActivity(focusSegment, options).productivity !== "focus") continue;
    if (classifyActivity(driftSegment, options).productivity !== "drift") continue;

    const segment = productivity === "drift" ? driftSegment : focusSegment;
    const identity = getInsightSurfaceIdentity(segment);
    const current = accumulator.get(identity.id) ?? {
      id: identity.id,
      label: identity.label,
      seconds: 0,
      count: 0,
      valueKind: "count",
      appName: identity.label,
      bundleId: identity.bundleId,
      siteDomain: identity.siteDomain,
      isSite: identity.siteDomain !== null,
    };
    current.seconds += segment.durationSeconds;
    current.count += 1;
    accumulator.set(identity.id, current);
  }

  return Array.from(accumulator.values())
    .sort((left, right) => {
      const countDelta = right.count - left.count;
      if (countDelta !== 0) return countDelta;
      return right.seconds - left.seconds;
    });
}

function insightSourceValue(item: InsightSourceItem): number {
  return item.valueKind === "count" ? item.count : item.seconds;
}

function formatInsightSourceValue(item: InsightSourceItem): string {
  return item.valueKind === "count" ? `${item.count}x` : formatDuration(item.seconds);
}

type WeeklyChartMode = "productivity" | "category";

interface WeeklyChartColumn {
  weekday: string;
  off: boolean;
  totalSeconds: number;
  barHeightPct: number;
  segments: Array<{ key: string; heightPct: number; color: string; seconds: number }>;
}

interface WeeklyChartView {
  gridlines: Array<{ topPct: number; label: string }>;
  columns: WeeklyChartColumn[];
}

interface DonutCategorySlice {
  category: ActivityCategory;
  seconds: number;
}

function chooseChartStepHours(maxHours: number): number {
  const candidates = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];
  for (const candidate of candidates) {
    if (maxHours / candidate <= 4) return candidate;
  }
  return candidates[candidates.length - 1];
}

function formatChartHourLabel(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${value.toFixed(1).replace(/\.0$/, "")}`;
}

function buildWeeklyChartView(
  weekly: WeeklyBreakdownDay[],
  mode: WeeklyChartMode,
  categorySeries: DonutCategorySlice[],
): WeeklyChartView {
  const series = mode === "productivity"
    ? FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.map((productivity) => ({ key: productivity, color: PRODUCTIVITY_COLORS[productivity] }))
    : categorySeries.map((slice) => ({ key: slice.category, color: CATEGORY_COLORS[slice.category] }));

  const valueFor = (day: WeeklyBreakdownDay, key: string): number => {
    if (mode === "productivity") {
      if (key === "focus") return day.focusSeconds;
      if (key === "neutral") return day.neutralSeconds;
      if (key === "drift") return day.driftSeconds;
      return 0;
    }
    return day.categorySeconds[key as ActivityCategory] ?? 0;
  };

  const dayTotals = weekly.map((day) => series.reduce((sum, ser) => sum + valueFor(day, ser.key), 0));

  // Shared y-axis across both modes so toggling keeps a consistent scale.
  const categoryKeys = categorySeries.map((slice) => slice.category);
  const productivityHours = weekly.map((day) => (day.focusSeconds + day.neutralSeconds + day.driftSeconds) / 3600);
  const categoryHours = weekly.map((day) => categoryKeys.reduce((sum, key) => sum + (day.categorySeconds[key] ?? 0), 0) / 3600);
  const maxHours = Math.max(0, ...productivityHours, ...categoryHours);
  const axisMax = maxHours > 0 ? maxHours / 0.93 : 1;
  const step = chooseChartStepHours(maxHours);

  const gridlines: Array<{ topPct: number; label: string }> = [];
  if (maxHours > 0) {
    for (let value = step; value <= maxHours + 1e-9; value += step) {
      gridlines.push({ topPct: (1 - value / axisMax) * 100, label: `${formatChartHourLabel(value)}h` });
    }
    gridlines.reverse();
  }

  const columns = weekly.map((day, index) => {
    const total = dayTotals[index];
    const off = total <= 0;
    return {
      weekday: day.weekday,
      off,
      totalSeconds: total,
      barHeightPct: Math.min((total / (axisMax * 3600)) * 100, 100),
      segments: off
        ? []
        : series
            .map((ser) => {
              const value = valueFor(day, ser.key);
              return value > 0 ? { key: ser.key, heightPct: (value / total) * 100, color: ser.color, seconds: value } : null;
            })
            .filter((segment): segment is { key: ProductivityLabel | ActivityCategory; heightPct: number; color: string; seconds: number } => segment !== null),
    };
  });

  return { gridlines, columns };
}

interface DonutView {
  slices: Array<{ key: string; color: string; dash: number; offset: number }>;
  centerPct: string;
  centerLabel: string;
  rows: Array<{ key: string; name: string; pct: number; time: string; color: string; fillPct: number }>;
}

const DONUT_CIRCUMFERENCE = 2 * Math.PI * 40;

function buildDonutView(
  mode: WeeklyChartMode,
  categorySeries: DonutCategorySlice[],
  productivityTotals: Record<ProductivityLabel, number>,
): DonutView {
  const items = mode === "productivity"
    ? FLOW_BREAKDOWN_PRODUCTIVITY_ORDER.map((productivity) => ({
        key: productivity,
        name: productivityLabel(productivity),
        color: PRODUCTIVITY_COLORS[productivity],
        seconds: productivityTotals[productivity],
      })).filter((item) => item.seconds > 0)
    : categorySeries.map((slice) => ({
        key: slice.category,
        name: categoryLabel(slice.category),
        color: CATEGORY_COLORS[slice.category],
        seconds: slice.seconds,
      }));

  const ordered = items.slice().sort((left, right) => right.seconds - left.seconds);
  const total = ordered.reduce((sum, item) => sum + item.seconds, 0);

  let cumulativeFraction = 0;
  const slices = ordered.map((item) => {
    const fraction = total > 0 ? item.seconds / total : 0;
    const dash = Math.max(0, fraction * DONUT_CIRCUMFERENCE - 1.5);
    const offset = -(cumulativeFraction * DONUT_CIRCUMFERENCE);
    cumulativeFraction += fraction;
    return { key: item.key, color: item.color, dash, offset };
  });

  const withPct = ordered.map((item) => ({ ...item, pct: total > 0 ? (item.seconds / total) * 100 : 0 }));
  const maxPct = Math.max(1, ...withPct.map((item) => item.pct));
  const top = withPct[0] ?? null;

  return {
    slices,
    centerPct: top ? `${Math.round(top.pct)}%` : "0%",
    centerLabel: top ? top.name : "—",
    rows: withPct.slice(0, mode === "category" ? 5 : 6).map((item) => ({
      key: item.key,
      name: item.name,
      pct: item.pct,
      time: formatDuration(item.seconds),
      color: item.color,
      fillPct: (item.pct / maxPct) * 88,
    })),
  };
}

type DriftSurfaceAccumulator = {
  id: string;
  label: string;
  detail: string;
  appName: string;
  bundleId: string | null;
  siteDomain: string | null;
  seconds: number;
  captures: number;
  activeDays: Set<string>;
};

function buildDriftInsightReport(segments: ActivitySegment[], rangeStart: string, rangeEnd: string, classificationOptions?: ClassificationOptions): ProductivityInsightReport {
  return buildProductivityInsightReport(segments, rangeStart, rangeEnd, "drift", classificationOptions);
}

function buildFocusInsightReport(segments: ActivitySegment[], rangeStart: string, rangeEnd: string, classificationOptions?: ClassificationOptions): ProductivityInsightReport {
  return buildProductivityInsightReport(segments, rangeStart, rangeEnd, "focus", classificationOptions);
}

function buildProductivityInsightReport(
  segments: ActivitySegment[],
  rangeStart: string,
  rangeEnd: string,
  productivity: ProductivityAnalysisKind,
  classificationOptions?: ClassificationOptions,
): ProductivityInsightReport {
  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs = new Date(rangeEnd).getTime();
  const sortedSegments = segments.slice().sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
  const trackedDays = new Set<string>();
  const firstSegmentByDay = new Map<string, ActivitySegment>();
  const surfaceMap = new Map<string, DriftSurfaceAccumulator>();
  const hourSeconds = Array.from({ length: 24 }, () => 0);
  let totalSeconds = 0;
  let longestRunSeconds = 0;
  let currentRunSeconds = 0;
  let currentRunEndMs = 0;

  for (const segment of sortedSegments) {
    const segmentStartMs = new Date(segment.startedAt).getTime();
    const segmentEndMs = new Date(segment.endedAt).getTime();
    const clippedStartMs = Math.max(segmentStartMs, rangeStartMs);
    const clippedEndMs = Math.min(segmentEndMs, rangeEndMs);
    if (!Number.isFinite(clippedStartMs) || !Number.isFinite(clippedEndMs) || clippedEndMs <= clippedStartMs) continue;

    const segmentDays = getLocalDaysBetween(clippedStartMs, clippedEndMs);
    for (const day of segmentDays) {
      trackedDays.add(day);
      if (!firstSegmentByDay.has(day)) firstSegmentByDay.set(day, segment);
    }

    if (categorizeActivity(segment, classificationOptions) !== productivity) continue;

    const clippedDurationSeconds = Math.round((clippedEndMs - clippedStartMs) / 1000);

    totalSeconds += clippedDurationSeconds;
    addSegmentHours(clippedStartMs, clippedEndMs, hourSeconds);

    if (currentRunSeconds > 0 && clippedStartMs - currentRunEndMs <= DRIFT_RUN_MAX_GAP_SECONDS * 1000) {
      currentRunSeconds += clippedDurationSeconds;
      currentRunEndMs = Math.max(currentRunEndMs, clippedEndMs);
    } else {
      currentRunSeconds = clippedDurationSeconds;
      currentRunEndMs = clippedEndMs;
    }
    longestRunSeconds = Math.max(longestRunSeconds, currentRunSeconds);

    const surface = getInsightSurfaceIdentity(segment);
    const current = surfaceMap.get(surface.id) ?? { ...surface, seconds: 0, captures: 0, activeDays: new Set<string>() };
    current.seconds += clippedDurationSeconds;
    current.captures += 1;
    for (const day of segmentDays) current.activeDays.add(day);
    surfaceMap.set(surface.id, current);
  }

  const startedWithProductivityDays = Array.from(firstSegmentByDay.values()).filter((segment) => categorizeActivity(segment, classificationOptions) === productivity).length;
  const topSurfaces = Array.from(surfaceMap.values())
    .sort((left, right) => right.seconds - left.seconds)
    .slice(0, 4)
    .map((surface) => ({
      id: surface.id,
      label: surface.label,
      detail: surface.detail,
      appName: surface.appName,
      bundleId: surface.bundleId,
      siteDomain: surface.siteDomain,
      seconds: surface.seconds,
      captures: surface.captures,
      activeDays: surface.activeDays.size,
      share: totalSeconds > 0 ? surface.seconds / totalSeconds : 0,
    }));
  const topSurface = topSurfaces[0] ?? null;
  const peakHourIndex = hourSeconds.reduce((bestIndex, seconds, index) => (seconds > hourSeconds[bestIndex] ? index : bestIndex), 0);
  const peakHourSeconds = hourSeconds[peakHourIndex] ?? 0;
  const initialProductivityRate = trackedDays.size > 0 ? Math.round((startedWithProductivityDays / trackedDays.size) * 100) : 0;
  const isFocusReport = productivity === "focus";
  const positiveTone: DriftPatternTone = isFocusReport ? "focus" : "warn";
  const firstActivityDetail = isFocusReport
    ? `${startedWithProductivityDays} of ${trackedDays.size} tracked days began with focus.`
    : `${startedWithProductivityDays} of ${trackedDays.size} tracked days had drift first.`;
  const longestRunDetail = isFocusReport
    ? "Longest focus stretch with gaps under five minutes."
    : "Longest drift stretch with gaps under five minutes.";
  const mainSourceDetail = topSurface
    ? `${topSurface.label} accounts for the largest share.`
    : "No recurring source yet.";
  const windowLabel = isFocusReport ? "Focus window" : "Drift window";
  const firstActivityTone = isFocusReport
    ? initialProductivityRate >= 45 ? "focus" : "neutral"
    : initialProductivityRate >= 30 ? "warn" : "neutral";
  const longestRunTone = isFocusReport
    ? longestRunSeconds >= 45 * 60 ? "focus" : "neutral"
    : longestRunSeconds >= 45 * 60 ? "warn" : "neutral";
  const mainSourceTone = topSurface && topSurface.share >= 0.4 ? positiveTone : "neutral";

  return {
    totalSeconds,
    trackedDays: trackedDays.size,
    startedWithProductivityDays,
    topSurfaces,
    patternCards: [
      { id: `${productivity}-first-activity`, label: "First activity", value: `${initialProductivityRate}%`, detail: firstActivityDetail, tone: firstActivityTone },
      { id: `${productivity}-longest-run`, label: "Longest run", value: formatCompactDurationFromSeconds(longestRunSeconds), detail: longestRunDetail, tone: longestRunTone },
      { id: `${productivity}-main-source`, label: "Main source", value: topSurface ? `${Math.round(topSurface.share * 100)}%` : "0%", detail: mainSourceDetail, tone: mainSourceTone },
      { id: `${productivity}-window`, label: windowLabel, value: peakHourSeconds > 0 ? `${String(peakHourIndex).padStart(2, "0")}:00` : "—", detail: peakHourSeconds > 0 ? `${formatCompactDurationFromSeconds(peakHourSeconds)} accumulated in that hour.` : "No hour stands out yet.", tone: isFocusReport ? "focus" : "neutral" },
    ],
  };
}

function getInsightSurfaceIdentity(segment: ActivitySegment): Omit<DriftSurfaceAccumulator, "seconds" | "captures" | "activeDays"> {
  const siteDomain = segment.siteDomain?.trim() || null;
  const siteTitle = segment.siteTitle?.trim() || null;
  const appName = segment.appName.trim() || "Unknown app";
  const bundleId = segment.bundleId?.trim() || null;

  if (siteDomain || siteTitle) {
    const label = siteDomain ?? siteTitle ?? appName;
    return { id: `site:${siteDomain ?? siteTitle}`, label, detail: "Website", appName, bundleId, siteDomain };
  }

  return { id: `app:${bundleId ?? appName}`, label: appName, detail: "Mac app", appName, bundleId, siteDomain: null };
}

function addSegmentHours(segmentStartMs: number, segmentEndMs: number, hourSeconds: number[]) {
  if (!Number.isFinite(segmentStartMs) || !Number.isFinite(segmentEndMs) || segmentEndMs <= segmentStartMs) return;

  const cursor = new Date(segmentStartMs);
  cursor.setMinutes(0, 0, 0);

  while (cursor.getTime() < segmentEndMs) {
    const hourStartMs = cursor.getTime();
    const hourEndMs = hourStartMs + 60 * 60 * 1000;
    const overlapSeconds = Math.max(0, Math.round((Math.min(segmentEndMs, hourEndMs) - Math.max(segmentStartMs, hourStartMs)) / 1000));
    hourSeconds[cursor.getHours()] += overlapSeconds;
    cursor.setHours(cursor.getHours() + 1);
  }
}

function getLocalDaysBetween(startMs: number, endMs: number): string[] {
  const days: string[] = [];
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);

  while (cursor.getTime() < endMs) {
    const day = isoDateFromTimestamp(cursor.toISOString());
    if (day) days.push(day);
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function buildEmptyHistoryDay(day: string, selectedDay: string): HistoryCell {
  return { id: `history-${day}`, isoDay: day, label: formatDayLabel(day), minutes: 0, focusScore: 0, level: 0, isSelected: day === selectedDay };
}

function buildFocusDriftChart(segments: ActivitySegment[], day: string, classificationOptions?: ClassificationOptions, currentMinuteOfDay?: number | null, startOfDayMinutes = 0): FocusDriftChart {
  return buildWindowedFocusDriftChart(segments, day, classificationOptions, currentMinuteOfDay, startOfDayMinutes);
}

function buildProductivityQualityPercent(productivityTotals: ProductivityDuration[]): number {
  const totalSeconds = productivityTotals.reduce((total, entry) => total + entry.totalSeconds, 0);
  const focusSeconds = productivityTotals.find((entry) => entry.productivity === "focus")?.totalSeconds ?? 0;
  return totalSeconds > 0 ? Math.round((focusSeconds / totalSeconds) * 100) : 0;
}

function buildWindowedFocusDriftChart(segments: ActivitySegment[], day: string, classificationOptions?: ClassificationOptions, currentMinuteOfDay?: number | null, startOfDayMinutes = 0): FocusDriftChart {
  const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
  const buckets = Array.from({ length: FOCUS_DRIFT_BUCKET_COUNT }, (_, index) => ({
    focusSeconds: 0,
    driftSeconds: 0,
    focusCaptures: 0,
    driftCaptures: 0,
    focusSources: new Map<string, FocusDriftSourceAccumulator>(),
    driftSources: new Map<string, FocusDriftSourceAccumulator>(),
    bucketStartMinute: index * FOCUS_DRIFT_BUCKET_MINUTES,
  }));
  const boundedCurrentMinute = currentMinuteOfDay === null || currentMinuteOfDay === undefined
    ? null
    : Math.min(Math.max(Math.floor(logicalMinuteOfDay(currentMinuteOfDay, startOfDayMinutes)), 0), FOCUS_DRIFT_MINUTES_PER_DAY - 1);
  const currentBucketStartMinute = boundedCurrentMinute === null
    ? null
    : Math.floor(boundedCurrentMinute / FOCUS_DRIFT_BUCKET_MINUTES) * FOCUS_DRIFT_BUCKET_MINUTES;
  const chartWidth = FOCUS_DRIFT_CHART_BOUNDS.right - FOCUS_DRIFT_CHART_BOUNDS.left;
  const currentX = boundedCurrentMinute === null ? null : FOCUS_DRIFT_CHART_BOUNDS.left + (boundedCurrentMinute / FOCUS_DRIFT_MINUTES_PER_DAY) * chartWidth;
  const currentTimeLabel = boundedCurrentMinute === null ? null : formatQuarterHourLabel(boundedCurrentMinute);
  const isLive = currentX !== null && currentBucketStartMinute !== null;

  for (const segment of segments) {
    const productivity = categorizeActivity(segment, classificationOptions);
    if (productivity !== "focus" && productivity !== "drift") continue;

    const sourceIdentity = getInsightSurfaceIdentity(segment);
    const segmentStartMs = new Date(segment.startedAt).getTime();
    const segmentEndMs = new Date(segment.endedAt).getTime();

    for (const bucket of buckets) {
      const bucketStartMs = dayStartMs + bucket.bucketStartMinute * 60 * 1000;
      const bucketEndMs = bucketStartMs + FOCUS_DRIFT_BUCKET_MINUTES * 60 * 1000;
      const overlapSeconds = Math.max(0, Math.round((Math.min(segmentEndMs, bucketEndMs) - Math.max(segmentStartMs, bucketStartMs)) / 1000));
      if (overlapSeconds <= 0) continue;

      if (productivity === "focus") {
        bucket.focusSeconds += overlapSeconds;
        bucket.focusCaptures += 1;
        addFocusDriftSourceOverlap(bucket.focusSources, sourceIdentity, overlapSeconds);
      } else {
        bucket.driftSeconds += overlapSeconds;
        bucket.driftCaptures += 1;
        addFocusDriftSourceOverlap(bucket.driftSources, sourceIdentity, overlapSeconds);
      }
    }
  }

  const points = buckets.map((entry) => {
    const totalSeconds = entry.focusSeconds + entry.driftSeconds;
    const focusScore = totalSeconds > 0 ? (entry.focusSeconds / totalSeconds) * 100 : 0;
    const driftScore = totalSeconds > 0 ? (entry.driftSeconds / totalSeconds) * 100 : 0;
    const isFuture = currentBucketStartMinute !== null ? entry.bucketStartMinute > currentBucketStartMinute : false;
    const x = currentBucketStartMinute !== null && currentX !== null && entry.bucketStartMinute === currentBucketStartMinute
      ? currentX
      : FOCUS_DRIFT_CHART_BOUNDS.left + ((entry.bucketStartMinute + FOCUS_DRIFT_BUCKET_MINUTES / 2) / FOCUS_DRIFT_MINUTES_PER_DAY) * chartWidth;

    return {
      id: `${day}-${entry.bucketStartMinute}`,
      day,
      label: formatFocusDriftBucketLabel(entry.bucketStartMinute),
      unit: "window" as const,
      bucketStartMinute: entry.bucketStartMinute,
      isFuture,
      focusSeconds: entry.focusSeconds,
      driftSeconds: entry.driftSeconds,
      focusCaptures: entry.focusCaptures,
      driftCaptures: entry.driftCaptures,
      totalSeconds,
      focusScore,
      driftScore,
      topFocusSource: getTopFocusDriftSource(entry.focusSources),
      topDriftSource: getTopFocusDriftSource(entry.driftSources),
      x,
      focusY: scaleFocusDriftY(focusScore),
      driftY: scaleFocusDriftY(driftScore),
    };
  });

  const measuredPoints = isLive ? points.filter((point) => !point.isFuture) : points;
  const activePoints = measuredPoints.filter((point) => point.totalSeconds > 0);
  const focusPath = buildSmoothPath(measuredPoints, "focusY");
  const driftPath = buildSmoothPath(measuredPoints, "driftY");
  const first = measuredPoints[0], last = measuredPoints[measuredPoints.length - 1];
  const focusAreaPath = first && last && focusPath ? `M ${first.x} ${FOCUS_DRIFT_CHART_BOUNDS.bottom} L ${focusPath.slice(2)} L ${last.x} ${FOCUS_DRIFT_CHART_BOUNDS.bottom} Z` : "";
  const peakFocusPoint = activePoints.reduce<FocusDriftPoint | null>((current, point) => (!current || point.focusScore > current.focusScore ? point : current), null);
  const peakDriftPoint = activePoints.reduce<FocusDriftPoint | null>((current, point) => (!current || point.driftScore > current.driftScore ? point : current), null);
  const totalFocus = points.reduce((sum, point) => sum + point.focusSeconds, 0);
  const totalAll = points.reduce((sum, point) => sum + point.totalSeconds, 0);

  return {
    points,
    focusPath,
    driftPath,
    focusAreaPath,
    peakFocusPoint,
    peakDriftPoint,
    focusConsistency: totalAll > 0 ? Math.round((totalFocus / totalAll) * 100) : 0,
    hasData: activePoints.length > 0,
    isLive,
    currentX,
    currentTimeLabel,
  };
}


function formatFocusDriftBucketLabel(bucketStartMinute: number): string {
  const hour = Math.floor(bucketStartMinute / 60);
  const minute = bucketStartMinute % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function addFocusDriftSourceOverlap(
  sources: Map<string, FocusDriftSourceAccumulator>,
  identity: Omit<DriftSurfaceAccumulator, "seconds" | "captures" | "activeDays">,
  overlapSeconds: number,
) {
  const current = sources.get(identity.id) ?? { ...identity, seconds: 0, captures: 0 };
  current.seconds += overlapSeconds;
  current.captures += 1;
  sources.set(identity.id, current);
}

function getTopFocusDriftSource(sources: Map<string, FocusDriftSourceAccumulator>): FocusDriftSourceSummary | null {
  return Array.from(sources.values()).sort((left, right) => {
    if (right.seconds !== left.seconds) return right.seconds - left.seconds;
    if (right.captures !== left.captures) return right.captures - left.captures;
    return left.label.localeCompare(right.label);
  })[0] ?? null;
}

function scaleFocusDriftY(score: number): number {
  const boundedScore = Math.min(Math.max(score, 0), 100);
  const chartHeight = FOCUS_DRIFT_CHART_BOUNDS.bottom - FOCUS_DRIFT_CHART_BOUNDS.top;
  return FOCUS_DRIFT_CHART_BOUNDS.top + ((100 - boundedScore) / 100) * chartHeight;
}

function clampFocusDriftChartX(value: number): number {
  return Math.min(Math.max(value, FOCUS_DRIFT_CLIP_BOUNDS.left), FOCUS_DRIFT_CLIP_BOUNDS.right);
}

function clampFocusDriftChartY(value: number): number {
  return Math.min(Math.max(value, FOCUS_DRIFT_CHART_BOUNDS.top), FOCUS_DRIFT_CHART_BOUNDS.bottom);
}

function buildSmoothPath(points: FocusDriftPoint[], yKey: "focusY" | "driftY"): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${clampFocusDriftChartX(points[0].x)} ${clampFocusDriftChartY(points[0][yKey])}`;
  const getPoint = (i: number) => { if (i < 0) return points[0]; if (i >= points.length) return points[points.length - 1]; return points[i]; };
  return points.reduce((path, pt, i) => {
    if (i === 0) return `M ${clampFocusDriftChartX(pt.x)} ${clampFocusDriftChartY(pt[yKey])}`;
    const p0 = getPoint(i - 2), p1 = getPoint(i - 1), p2 = getPoint(i), p3 = getPoint(i + 1);
    const t = 0.35;
    const controlStartX = clampFocusDriftChartX(p1.x + (p2.x - p0.x) * t);
    const controlStartY = clampFocusDriftChartY(p1[yKey] + (p2[yKey] - p0[yKey]) * t);
    const controlEndX = clampFocusDriftChartX(p2.x - (p3.x - p1.x) * t);
    const controlEndY = clampFocusDriftChartY(p2[yKey] - (p3[yKey] - p1[yKey]) * t);
    return `${path} C ${controlStartX} ${controlStartY}, ${controlEndX} ${controlEndY}, ${clampFocusDriftChartX(p2.x)} ${clampFocusDriftChartY(p2[yKey])}`;
  }, "");
}

function chunk<T>(items: T[], size: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < items.length; i += size) r.push(items.slice(i, i + size));
  return r;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatCompactDurationFromSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0";
  const h = Math.floor(totalSeconds / 3600), m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function getDefaultWatcherSnapshot(): WatcherSnapshot {
  return {
    productivity: "neutral",
    category: "unknown",
    contextLabel: "the current session",
    durationLabel: "a moment",
    durationSeconds: 0,
    focusSessionKind: "settled",
    driftPattern: "first",
    driftReminderElapsedSeconds: null,
    recentWatcherResponse: getRecentWatcherResponse()?.response ?? null,
    minutesSinceLastWatcher: getMinutesSinceLastWatcher(),
    focusSecondsToday: 0,
    currentHourFocusSeconds: 0,
    preservedFocusStrikeSeconds: null,
  };
}

function getLatestWatcherSegment(segments: ActivitySegment[]): ActivitySegment | null {
  if (segments.length === 0) return null;
  let latestSegment = segments[0];
  let latestEndedAt = new Date(latestSegment.endedAt).getTime();

  for (const segment of segments.slice(1)) {
    const endedAt = new Date(segment.endedAt).getTime();
    if (endedAt > latestEndedAt) {
      latestSegment = segment;
      latestEndedAt = endedAt;
    }
  }

  return latestSegment;
}

function buildWatcherSnapshot(segments: ActivitySegment[], classificationOptions?: ClassificationOptions): WatcherSnapshot {
  const segment = getLatestWatcherSegment(segments);
  if (!segment) return getDefaultWatcherSnapshot();
  const { category, productivity } = classifyActivity(segment, classificationOptions);
  const recentWatcherResponse = getRecentWatcherResponse();
  const focusSecondsToday = sumProductivitySeconds(segments, "focus", classificationOptions);
  const currentHourFocusSeconds = sumCurrentHourFocusSeconds(segments, classificationOptions);

  return {
    productivity,
    category,
    contextLabel: getWatcherContextLabel(segment, category),
    durationLabel: formatCompactDurationFromSeconds(segment.durationSeconds),
    durationSeconds: segment.durationSeconds,
    focusSessionKind: getWatcherFocusSessionKind(segment, recentWatcherResponse?.productivity ?? null),
    driftPattern: getWatcherDriftPattern(segment, recentWatcherResponse),
    driftReminderElapsedSeconds: null,
    recentWatcherResponse: recentWatcherResponse?.response ?? null,
    minutesSinceLastWatcher: recentWatcherResponse ? Math.max(0, Math.round((Date.now() - new Date(recentWatcherResponse.respondedAt).getTime()) / 60000)) : null,
    focusSecondsToday,
    currentHourFocusSeconds,
    preservedFocusStrikeSeconds: computePreservedFocusStrikeSeconds(segments, segment, classificationOptions),
  };
}

async function resolveWatcherSnapshot(segments: ActivitySegment[], driftReminderElapsedSeconds: number | null = null, classificationOptions?: ClassificationOptions): Promise<WatcherSnapshot> {
  try {
    const current = await trackerClient.getCurrentSnapshot();
    if (!current) return getDefaultWatcherSnapshot();
    return buildWatcherSnapshotFromCurrent(current, segments, driftReminderElapsedSeconds, classificationOptions);
  } catch {
    return getDefaultWatcherSnapshot();
  }
}

function buildWatcherSnapshotFromCurrent(current: CurrentActivitySnapshot, segments: ActivitySegment[], driftReminderElapsedSeconds: number | null = null, classificationOptions?: ClassificationOptions): WatcherSnapshot {
  const timing = getCurrentSnapshotTiming(current, segments);
  const segment = currentSnapshotToSegment(current, timing.durationSeconds);
  const { category, productivity } = classifyActivity(segment, {
    ...classificationOptions,
    fallbackCandidates: [segment, ...(classificationOptions?.fallbackCandidates ?? segments)],
  });
  const recentWatcherResponse = getRecentWatcherResponse();
  const uncapturedFocusSeconds = productivity === "focus" ? timing.uncapturedSeconds : 0;
  const focusSecondsToday = sumProductivitySeconds(segments, "focus", classificationOptions) + uncapturedFocusSeconds;
  const currentHourFocusSeconds = sumCurrentHourFocusSeconds(segments, classificationOptions) + uncapturedFocusSeconds;
  const preservedFocusStrikeSeconds = computePreservedFocusStrikeSeconds([...segments, segment], segment, classificationOptions);

  return {
    productivity,
    category,
    contextLabel: getWatcherContextLabel(segment, category),
    durationLabel: segment.durationSeconds > 0 ? formatCompactDurationFromSeconds(segment.durationSeconds) : "just now",
    durationSeconds: segment.durationSeconds,
    focusSessionKind: getWatcherFocusSessionKind(segment, recentWatcherResponse?.productivity ?? null),
    driftPattern: getWatcherDriftPattern(segment, recentWatcherResponse),
    driftReminderElapsedSeconds,
    recentWatcherResponse: recentWatcherResponse?.response ?? null,
    minutesSinceLastWatcher: recentWatcherResponse ? Math.max(0, Math.round((Date.now() - new Date(recentWatcherResponse.respondedAt).getTime()) / 60000)) : null,
    focusSecondsToday,
    currentHourFocusSeconds,
    preservedFocusStrikeSeconds,
  };
}

function currentSnapshotToSegment(current: CurrentActivitySnapshot, durationSeconds: number): ActivitySegment {
  const endedAt = new Date(current.observedAt).getTime();
  const startedAt = Number.isFinite(endedAt) ? new Date(endedAt - durationSeconds * 1000).toISOString() : current.observedAt;

  return {
    id: `current:${current.observedAt}`,
    startedAt,
    endedAt: current.observedAt,
    durationSeconds,
    appName: current.appName,
    bundleId: current.bundleId,
    windowTitle: current.windowTitle,
    browserName: current.browserName,
    siteDomain: current.siteDomain,
    siteTitle: current.siteTitle,
    siteUrl: current.siteUrl,
    youtubeVideoId: current.youtubeVideoId,
    youtubePlaylistId: current.youtubePlaylistId,
    youtubeIsShorts: current.youtubeIsShorts,
    platform: "macos",
    source: current.source,
  };
}

type CurrentSnapshotTiming = {
  durationSeconds: number;
  uncapturedSeconds: number;
};

const CURRENT_SNAPSHOT_FRESHNESS_SECONDS = 90;

function getCurrentSnapshotTiming(current: CurrentActivitySnapshot, segments: ActivitySegment[]): CurrentSnapshotTiming {
  const latestSegment = getLatestWatcherSegment(segments);
  if (!latestSegment) return { durationSeconds: 0, uncapturedSeconds: 0 };
  if (activitySegmentIdentity(latestSegment) !== currentSnapshotIdentity(current)) return { durationSeconds: 0, uncapturedSeconds: 0 };

  const observedAt = new Date(current.observedAt).getTime();
  const endedAt = new Date(latestSegment.endedAt).getTime();
  const elapsedSeconds = Number.isFinite(observedAt) && Number.isFinite(endedAt) ? Math.max(0, Math.round((observedAt - endedAt) / 1000)) : 0;
  if (elapsedSeconds > CURRENT_SNAPSHOT_FRESHNESS_SECONDS) return { durationSeconds: 0, uncapturedSeconds: 0 };

  return {
    durationSeconds: latestSegment.durationSeconds + elapsedSeconds,
    uncapturedSeconds: elapsedSeconds,
  };
}

function currentSnapshotIdentity(current: CurrentActivitySnapshot): string {
  return [
    current.bundleId ?? current.appName,
    current.appName,
    current.siteDomain ?? current.siteTitle ?? current.windowTitle ?? "",
  ].join("\u001f");
}

function activitySegmentIdentity(segment: ActivitySegment): string {
  return [
    segment.bundleId ?? segment.appName,
    segment.appName,
    segment.siteDomain ?? segment.siteTitle ?? segment.windowTitle ?? "",
  ].join("\u001f");
}

type StoredWatcherResponse = {
  respondedAt: string;
  response: WatcherPeekResponse;
  productivity: ProductivityLabel;
  durationLabel: string;
};

function getRecentWatcherResponse(): StoredWatcherResponse | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = readMigratedLocalStorageValue(WATCHER_RESPONSE_STORAGE_KEY, LEGACY_WATCHER_RESPONSE_STORAGE_KEY);
    const responses: unknown = rawValue ? JSON.parse(rawValue) : [];
    if (!Array.isArray(responses)) return null;
    const latest = responses[responses.length - 1] as Partial<StoredWatcherResponse> | undefined;
    if (!latest?.respondedAt || !isWatcherPeekResponse(latest.response) || !isProductivityLabel(latest.productivity)) return null;
    return {
      respondedAt: latest.respondedAt,
      response: latest.response,
      productivity: latest.productivity,
      durationLabel: typeof latest.durationLabel === "string" ? latest.durationLabel : "",
    };
  } catch {
    return null;
  }
}

function getMinutesSinceLastWatcher(): number | null {
  const recent = getRecentWatcherResponse();
  if (!recent) return null;
  const respondedAt = new Date(recent.respondedAt).getTime();
  if (Number.isNaN(respondedAt)) return null;
  return Math.max(0, Math.round((Date.now() - respondedAt) / 60000));
}

function getWatcherFocusSessionKind(segment: ActivitySegment, recentProductivity: ProductivityLabel | null): WatcherSnapshot["focusSessionKind"] {
  if (recentProductivity === "drift") return "recovered";
  if (segment.durationSeconds < 5 * 60) return "just_started";
  if (segment.durationSeconds >= 45 * 60) return "deep";
  return "settled";
}

function getWatcherDriftPattern(segment: ActivitySegment, recent: StoredWatcherResponse | null): WatcherSnapshot["driftPattern"] {
  if (recent?.response === "snooze") return "after_snooze";
  if (recent?.productivity === "drift") return "repeated";
  if (segment.durationSeconds >= 15 * 60) return "long";
  return "first";
}

function sumProductivitySeconds(segments: ActivitySegment[], productivity: ProductivityLabel, classificationOptions?: ClassificationOptions): number {
  return segments.reduce((total, segment) => total + (categorizeActivity(segment, classificationOptions) === productivity ? segment.durationSeconds : 0), 0);
}

function sumCurrentHourFocusSeconds(segments: ActivitySegment[], classificationOptions?: ClassificationOptions): number {
  const now = new Date();
  const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0).getTime();
  const hourEnd = hourStart + 60 * 60 * 1000;

  return segments.reduce((total, segment) => {
    if (categorizeActivity(segment, classificationOptions) !== "focus") return total;
    const start = new Date(segment.startedAt).getTime();
    const end = new Date(segment.endedAt).getTime();
    const overlap = Math.max(0, Math.min(end, hourEnd) - Math.max(start, hourStart));
    return total + Math.round(overlap / 1000);
  }, 0);
}

function isWatcherPeekResponse(value: unknown): value is WatcherPeekResponse {
  return (
    value === "return"
    || value === "snooze"
    || value === "dismiss"
  );
}

function isProductivityLabel(value: unknown): value is ProductivityLabel {
  return value === "focus" || value === "neutral" || value === "drift";
}

function getWatcherContextLabel(segment: ActivitySegment, category: ActivityCategory): string {
  const appName = segment.appName.trim();
  if (segment.siteDomain?.trim()) return segment.siteDomain.trim();
  if (segment.siteTitle?.trim()) return segment.siteTitle.trim();
  if (appName && appName.toLowerCase() !== "unknown" && appName.toLowerCase() !== "unavailable") return appName;
  if (segment.windowTitle?.trim()) return segment.windowTitle.trim();
  if (category === "workspace") return "your work app";
  if (category === "communication") return "your messages";
  if (category === "utility") return "a utility app";
  return "this session";
}

function buildRecentFocusTargets(segments: ActivitySegment[], classificationOptions: ClassificationOptions, appIcons: AppIconMap): DriftAlarmFocusTarget[] {
  const targets: DriftAlarmFocusTarget[] = [];
  const seen = new Set<string>();
  const sortedFocusSegments = segments
    .filter((segment) => classifyActivity(segment, classificationOptions).productivity === "focus")
    .sort((left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime());

  for (const segment of sortedFocusSegments) {
    const appName = segment.appName.trim() || "Unknown app";
    const bundleId = segment.bundleId?.trim() || null;
    const siteDomain = segment.siteDomain?.trim() || null;
    const siteTitle = segment.siteTitle?.trim() || null;
    const identityKey = siteDomain || bundleId || appName;
    const dedupeKey = identityKey.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    const iconKey = bundleId ?? appName;
    const iconSrc = appIcons[iconKey] ?? appIcons[appName] ?? null;
    const label = siteDomain ?? siteTitle ?? appName;
    const detail = formatFocusTargetDetail({ appName, siteDomain, siteTitle });
    targets.push({
      targetId: siteDomain ? `site:${siteDomain}` : `app:${bundleId ?? appName}`,
      label,
      detail,
      appName,
      bundleId,
      siteDomain,
      siteTitle,
      iconSrc,
    });

    if (targets.length === 3) break;
  }

  return targets;
}

function formatFocusTargetDetail({
  appName,
  siteDomain,
  siteTitle,
}: {
  appName: string;
  siteDomain: string | null;
  siteTitle: string | null;
}): string {
  if (siteDomain && siteTitle && siteTitle !== siteDomain) return `${siteTitle} · ${appName}`;
  if (siteDomain) return `Focus tab · ${appName}`;
  return "Recent focus app";
}

function getWatcherScheduleDelayMs(mode: WatcherMode, minMinutes: number, maxMinutes: number): number {
  if (mode === "drift_only") return WATCHER_DRIFT_ONLY_CHECK_DELAY_MS;
  const minMs = minMinutes * 60_000;
  const maxMs = Math.max(minMs, maxMinutes * 60_000);
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

async function showDueDriftWatcherPeek(
  segments: ActivitySegment[],
  showWatcherPeek: (force?: boolean, reminderThresholdSeconds?: number | null) => void,
  driftReminderStateRef: { current: DriftReminderState | null },
  classificationOptions?: ClassificationOptions,
): Promise<void> {
  const snapshot = await resolveWatcherSnapshot(segments, null, classificationOptions);
  if (snapshot.productivity !== "drift") {
    driftReminderStateRef.current = null;
    return;
  }

  const thresholdSeconds = getDueDriftReminderThreshold(snapshot.durationSeconds);
  if (thresholdSeconds === null) return;

  const identity = `${snapshot.category}\u001f${snapshot.contextLabel}`;
  const previous = driftReminderStateRef.current;
  if (previous?.identity === identity && previous.thresholdSeconds >= thresholdSeconds) return;

  driftReminderStateRef.current = { identity, thresholdSeconds };
  showWatcherPeek(false, thresholdSeconds);
}

function getDueDriftReminderThreshold(durationSeconds: number): number | null {
  let dueThreshold: number | null = null;
  for (const threshold of WATCHER_DRIFT_REMINDER_THRESHOLDS_SECONDS) {
    if (durationSeconds >= threshold) dueThreshold = threshold;
  }
  return dueThreshold;
}

function persistWatcherResponse(event: WatcherPeekEvent, response: WatcherPeekResponse): void {
  if (typeof window === "undefined") return;

  try {
    const rawValue = readMigratedLocalStorageValue(WATCHER_RESPONSE_STORAGE_KEY, LEGACY_WATCHER_RESPONSE_STORAGE_KEY);
    const existingResponses: unknown = rawValue ? JSON.parse(rawValue) : [];
    const responses = Array.isArray(existingResponses) ? existingResponses.slice(-19) : [];
    responses.push({
      respondedAt: new Date().toISOString(),
      response,
      productivity: event.productivity,
      durationLabel: event.durationLabel,
    });
    window.localStorage.setItem(WATCHER_RESPONSE_STORAGE_KEY, JSON.stringify(responses));
  } catch {
    // The watcher is a prototype surface; storage failures should not affect tracking.
  }
}

function formatTimeLabel(value: string | Date): string {
  return uiTimeFormatter.format(typeof value === "string" ? new Date(value) : value);
}

function formatRelativeTime(value: string): string {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return "unknown";

  const diffSeconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  if (diffSeconds < 10) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatQuarterHourLabel(minuteOfDay: number): string {
  const normalized = ((minuteOfDay % (24 * 60)) + (24 * 60)) % (24 * 60);
  const date = new Date(2026, 0, 1, Math.floor(normalized / 60), normalized % 60, 0, 0);
  return uiTimeFormatter.format(date);
}

function describeRelativeDay(day: string, startOfDayMinutes = 0): string {
  const today = logicalTodayIsoDate(startOfDayMinutes);
  if (day === today) return "Today";
  if (day === shiftIsoDate(today, -1)) return "Yesterday";
  if (day === shiftIsoDate(today, 1)) return "Tomorrow";
  return "Selected day";
}


function buildWeekDayRows(segments: ActivitySegment[], startDay: string, endDay: string, classificationOptions?: ClassificationOptions, startOfDayMinutes = 0): WeekDayRow[] {
  const days = buildIsoDayList(startDay, endDay);

  const rows = new Map<string, { totalSeconds: number; focusSeconds: number; categories: Map<ActivityCategory, number> }>();
  for (const day of days) {
    rows.set(day, { totalSeconds: 0, focusSeconds: 0, categories: new Map() });
  }

  for (const segment of segments) {
    const classification = classifyActivityDetailed(segment, classificationOptions);
    for (const overlap of splitSegmentIntoDayOverlaps(segment, startDay, endDay, startOfDayMinutes)) {
      const row = rows.get(overlap.day);
      if (!row) continue;
      row.totalSeconds += overlap.durationSeconds;
      if (classification.productivity === "focus") row.focusSeconds += overlap.durationSeconds;
      row.categories.set(classification.category, (row.categories.get(classification.category) ?? 0) + overlap.durationSeconds);
    }
  }

  return days.map((day) => {
    const row = rows.get(day)!;
    const date = new Date(`${day}T12:00:00`);
    const slices = Array.from(row.categories.entries())
      .map(([category, total]) => ({ category, totalSeconds: total, ratio: row.totalSeconds > 0 ? total / row.totalSeconds : 0 }))
      .filter((slice) => slice.totalSeconds > 0)
      .sort((left, right) => right.totalSeconds - left.totalSeconds);

    return {
      day,
      dayName: new Intl.DateTimeFormat(UI_LOCALE, { weekday: "short" }).format(date),
      dayNumber: new Intl.DateTimeFormat(UI_LOCALE, { day: "numeric" }).format(date),
      totalSeconds: row.totalSeconds,
      focusSeconds: row.focusSeconds,
      focusScore: row.totalSeconds > 0 ? Math.round((row.focusSeconds / row.totalSeconds) * 100) : 0,
      slices,
    };
  });
}

type SegmentDayOverlap = {
  day: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
};

function buildIsoDayList(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  let cursor = startDay;
  while (cursor <= endDay) {
    days.push(cursor);
    cursor = shiftIsoDate(cursor, 1);
  }
  return days;
}

function splitSegmentIntoDayOverlaps(segment: ActivitySegment, startDay: string, endDay: string, startOfDayMinutes = 0): SegmentDayOverlap[] {
  const segmentStartMs = new Date(segment.startedAt).getTime();
  const segmentEndMs = new Date(segment.endedAt).getTime();
  if (!Number.isFinite(segmentStartMs) || !Number.isFinite(segmentEndMs) || segmentEndMs <= segmentStartMs) return [];

  return buildIsoDayList(startDay, endDay).flatMap((day) => {
    const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
    const dayEndMs = logicalDayEndExclusiveMs(day, startOfDayMinutes);
    const overlapStartMs = Math.max(segmentStartMs, dayStartMs);
    const overlapEndMs = Math.min(segmentEndMs, dayEndMs);
    if (overlapEndMs <= overlapStartMs) return [];
    return [{
      day,
      startedAt: new Date(overlapStartMs),
      endedAt: new Date(overlapEndMs),
      durationSeconds: Math.round((overlapEndMs - overlapStartMs) / 1000),
    }];
  });
}


function buildWeekCalendarEvents(segments: ActivitySegment[], startDay: string, endDay: string, startHour: number, endHour: number, classificationOptions?: ClassificationOptions, startOfDayMinutes = 0): Map<string, WeekCalendarEvent[]> {
  const days = buildIsoDayList(startDay, endDay);

  const eventsByDay = new Map<string, WeekCalendarEvent[]>(days.map((day) => [day, []]));
  const minMinute = startHour * 60;
  const maxMinute = endHour * 60;
  const bucketMinutes = 30;
  const meaningfulGapMinutes = 10;
  const visualMergeWindowMinutes = 24;
  const maxVisibleIdentities = 4;
  const meaningfulInterruptionSeconds = 10 * 60;
  const mixedShareThreshold = 0.25;
  const mixedMinimumSeconds = 8 * 60;
  type WeekCalendarSourceInterval = {
    startMinute: number;
    endMinute: number;
    category: ActivityCategory;
    productivity: ProductivityLabel;
    appName: string;
    identity: WeekCalendarIdentity;
    classificationSource: ClassificationSource;
    aiClassification: boolean;
    seconds: number;
    segmentId: string;
  };
  type WeekCalendarBucket = {
    startMinute: number;
    endMinute: number;
    sourceIntervals: WeekCalendarSourceInterval[];
  };
  type WeekCalendarBucketComponent = {
    coveredStartMinute: number;
    coveredEndMinute: number;
    categoryTotals: Map<ActivityCategory, number>;
    productivityTotals: Map<ProductivityLabel, number>;
    appTotals: Map<string, number>;
    identityTotals: Map<string, WeekCalendarEventIdentity>;
    sourceTotals: Map<ClassificationSource, number>;
    aiSeconds: number;
    segmentIds: Set<string>;
    totalSeconds: number;
    category: ActivityCategory;
    productivity: ProductivityLabel;
    classificationSource: ClassificationSource;
  };
  const bucketsByDay = new Map<string, WeekCalendarBucket[]>(days.map((day) => [day, Array.from({ length: Math.ceil((maxMinute - minMinute) / bucketMinutes) }, (_, index) => {
    const startMinute = minMinute + index * bucketMinutes;
    return { startMinute, endMinute: Math.min(maxMinute, startMinute + bucketMinutes), sourceIntervals: [] };
  })]));

  function topEntry<K>(totals: Map<K, number>): [K, number] | null {
    return Array.from(totals.entries()).sort((left, right) => right[1] - left[1])[0] ?? null;
  }

  function isMeaningfulRemainder(totalSeconds: number, topSeconds: number): boolean {
    const remainderSeconds = totalSeconds - topSeconds;
    if (remainderSeconds >= meaningfulInterruptionSeconds) return true;
    return remainderSeconds >= mixedMinimumSeconds && totalSeconds > 0 && remainderSeconds / totalSeconds >= mixedShareThreshold;
  }

  function capturedSegmentLabel(count: number): string {
    return `${count} captured segment${count === 1 ? "" : "s"}`;
  }

  function topAppNamesLabel(topApps: Array<[string, number]>, fallbackLabel: string): string {
    const appNames = topApps.slice(0, 3).map(([appName]) => appName.trim()).filter(Boolean);
    return appNames.length > 0 ? appNames.join(", ") : fallbackLabel;
  }

  function weekCalendarSegmentLabel(segment: ActivitySegment): string {
    return segment.siteDomain?.trim() || segment.siteTitle?.trim() || segment.appName;
  }

  function weekCalendarSegmentIdentity(segment: ActivitySegment): WeekCalendarIdentity {
    const appName = segment.appName.trim() || "Unknown app";
    const bundleId = segment.bundleId?.trim() || null;
    const browserName = segment.browserName?.trim() || null;
    const siteDomain = segment.siteDomain?.trim() || null;
    const siteTitle = segment.siteTitle?.trim() || null;
    const label = siteDomain ?? siteTitle ?? appName;
    const id = siteDomain
      ? `site:${siteDomain.toLowerCase()}`
      : siteTitle
        ? `site-title:${siteTitle.toLowerCase()}:${bundleId ?? appName}`
        : `app:${bundleId ?? appName}`;
    return { id, label, appName, bundleId, browserName, siteDomain, siteTitle };
  }

  function addIntervalToTotals(
    interval: WeekCalendarSourceInterval,
    categoryTotals: Map<ActivityCategory, number>,
    productivityTotals: Map<ProductivityLabel, number>,
    appTotals: Map<string, number>,
    identityTotals: Map<string, WeekCalendarEventIdentity>,
    sourceTotals: Map<ClassificationSource, number>,
    segmentIds: Set<string>,
  ): void {
    categoryTotals.set(interval.category, (categoryTotals.get(interval.category) ?? 0) + interval.seconds);
    productivityTotals.set(interval.productivity, (productivityTotals.get(interval.productivity) ?? 0) + interval.seconds);
    appTotals.set(interval.appName, (appTotals.get(interval.appName) ?? 0) + interval.seconds);
    const currentIdentity = identityTotals.get(interval.identity.id);
    if (currentIdentity) {
      currentIdentity.seconds += interval.seconds;
      currentIdentity.firstStartMinute = Math.min(currentIdentity.firstStartMinute, interval.startMinute);
    } else {
      identityTotals.set(interval.identity.id, {
        ...interval.identity,
        seconds: interval.seconds,
        firstStartMinute: interval.startMinute,
      });
    }
    sourceTotals.set(interval.classificationSource, (sourceTotals.get(interval.classificationSource) ?? 0) + interval.seconds);
    segmentIds.add(interval.segmentId);
  }

  function buildComponentFromIntervals(intervals: WeekCalendarSourceInterval[]): WeekCalendarBucketComponent | null {
    if (intervals.length === 0) return null;
    const categoryTotals = new Map<ActivityCategory, number>();
    const productivityTotals = new Map<ProductivityLabel, number>();
    const appTotals = new Map<string, number>();
    const identityTotals = new Map<string, WeekCalendarEventIdentity>();
    const sourceTotals = new Map<ClassificationSource, number>();
    const segmentIds = new Set<string>();
    let aiSeconds = 0;
    let totalSeconds = 0;
    let coveredStartMinute = intervals[0].startMinute;
    let coveredEndMinute = intervals[0].endMinute;

    for (const interval of intervals) {
      addIntervalToTotals(interval, categoryTotals, productivityTotals, appTotals, identityTotals, sourceTotals, segmentIds);
      totalSeconds += interval.seconds;
      if (interval.aiClassification) aiSeconds += interval.seconds;
      coveredStartMinute = Math.min(coveredStartMinute, interval.startMinute);
      coveredEndMinute = Math.max(coveredEndMinute, interval.endMinute);
    }

    const topCategory = topEntry(categoryTotals);
    if (!topCategory) return null;
    const topProductivity = topEntry(productivityTotals);
    const topSource = topEntry(sourceTotals);
    return {
      coveredStartMinute,
      coveredEndMinute,
      categoryTotals,
      productivityTotals,
      appTotals,
      identityTotals,
      sourceTotals,
      aiSeconds,
      segmentIds,
      totalSeconds,
      category: topCategory[0],
      productivity: topProductivity?.[0] ?? "neutral",
      classificationSource: topSource?.[0] ?? "unknown",
    };
  }

  function bucketComponents(bucket: WeekCalendarBucket): WeekCalendarBucketComponent[] {
    const sortedIntervals = bucket.sourceIntervals.slice().sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
    const components: WeekCalendarBucketComponent[] = [];
    let currentIntervals: WeekCalendarSourceInterval[] = [];
    let currentCoveredEndMinute = 0;

    const flushComponent = () => {
      const component = buildComponentFromIntervals(currentIntervals);
      if (component) components.push(component);
      currentIntervals = [];
      currentCoveredEndMinute = 0;
    };

    for (const interval of sortedIntervals) {
      if (currentIntervals.length > 0 && interval.startMinute - currentCoveredEndMinute >= meaningfulGapMinutes) {
        flushComponent();
      }
      currentIntervals.push(interval);
      currentCoveredEndMinute = Math.max(currentCoveredEndMinute, interval.endMinute);
    }
    flushComponent();

    return components;
  }

  for (const segment of segments) {
    const classification = classifyActivityDetailed(segment, classificationOptions);
    const identity = weekCalendarSegmentIdentity(segment);
    for (const overlap of splitSegmentIntoDayOverlaps(segment, startDay, endDay, startOfDayMinutes)) {
      const buckets = bucketsByDay.get(overlap.day);
      if (!buckets) continue;

      const dayStartMs = logicalDayStartMs(overlap.day, startOfDayMinutes);
      const startMinute = Math.max(minMinute, Math.floor((overlap.startedAt.getTime() - dayStartMs) / 60000));
      const endMinute = Math.min(maxMinute, Math.ceil((overlap.endedAt.getTime() - dayStartMs) / 60000));
      if (endMinute <= minMinute || startMinute >= maxMinute) continue;

      for (const bucket of buckets) {
        const bucketStartMs = dayStartMs + bucket.startMinute * 60 * 1000;
        const bucketEndMs = dayStartMs + bucket.endMinute * 60 * 1000;
        const overlapMs = Math.max(0, Math.min(overlap.endedAt.getTime(), bucketEndMs) - Math.max(overlap.startedAt.getTime(), bucketStartMs));
        if (overlapMs <= 0) continue;
        const overlapSeconds = Math.round(overlapMs / 1000);
        const intervalStartMinute = Math.max(bucket.startMinute, Math.floor((Math.max(overlap.startedAt.getTime(), bucketStartMs) - dayStartMs) / 60000));
        const intervalEndMinute = Math.min(bucket.endMinute, Math.ceil((Math.min(overlap.endedAt.getTime(), bucketEndMs) - dayStartMs) / 60000));
        if (intervalEndMinute <= intervalStartMinute) continue;
        bucket.sourceIntervals.push({
          startMinute: intervalStartMinute,
          endMinute: intervalEndMinute,
          category: classification.category,
          productivity: classification.productivity,
          appName: weekCalendarSegmentLabel(segment),
          identity,
          classificationSource: classification.source,
          aiClassification: classification.source === "llm",
          seconds: overlapSeconds,
          segmentId: segment.id,
        });
      }
    }
  }

  for (const [day, buckets] of bucketsByDay.entries()) {
    const dominantBuckets = buckets.flatMap(bucketComponents);
    let group: WeekCalendarBucketComponent[] = [];

    const flushGroup = () => {
      if (group.length === 0) return;
      const first = group[0];
      const startMinute = Math.min(...group.map((entry) => entry.coveredStartMinute));
      const endMinute = Math.max(...group.map((entry) => entry.coveredEndMinute));
      const totalSeconds = group.reduce((sum, entry) => sum + entry.totalSeconds, 0);
      const categoryTotals = new Map<ActivityCategory, number>();
      const appTotals = new Map<string, number>();
      const identityTotals = new Map<string, WeekCalendarEventIdentity>();
      const productivityTotals = new Map<ProductivityLabel, number>();
      const sourceTotals = new Map<ClassificationSource, number>();
      let aiSeconds = 0;
      const segmentIds = new Set<string>();
      for (const entry of group) {
        for (const [category, seconds] of entry.categoryTotals) categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + seconds);
        for (const [appName, seconds] of entry.appTotals) appTotals.set(appName, (appTotals.get(appName) ?? 0) + seconds);
        for (const [id, identityEntry] of entry.identityTotals) {
          const currentIdentity = identityTotals.get(id);
          if (currentIdentity) {
            currentIdentity.seconds += identityEntry.seconds;
            currentIdentity.firstStartMinute = Math.min(currentIdentity.firstStartMinute, identityEntry.firstStartMinute);
          } else {
            identityTotals.set(id, { ...identityEntry });
          }
        }
        for (const [productivity, seconds] of entry.productivityTotals) productivityTotals.set(productivity, (productivityTotals.get(productivity) ?? 0) + seconds);
        for (const [source, seconds] of entry.sourceTotals) sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + seconds);
        aiSeconds += entry.aiSeconds;
        for (const segmentId of entry.segmentIds) segmentIds.add(segmentId);
      }
      const topApps = Array.from(appTotals.entries()).sort((left, right) => right[1] - left[1]);
      const orderedIdentities = Array.from(identityTotals.values()).sort((left, right) =>
        right.seconds - left.seconds || left.firstStartMinute - right.firstStartMinute || left.label.localeCompare(right.label),
      );
      const visibleIdentities = orderedIdentities.slice(0, maxVisibleIdentities);
      const topCategory = topEntry(categoryTotals);
      const dominantCategory = topCategory?.[0] ?? first.category;
      const topProductivity = topEntry(productivityTotals);
      const dominantProductivity = topProductivity?.[0] ?? first.productivity;
      const dominantSource = topEntry(sourceTotals)?.[0] ?? first.classificationSource ?? "unknown";
      const topApp = topApps[0] ?? null;
      const meaningfulMixedCategory = topCategory ? isMeaningfulRemainder(totalSeconds, topCategory[1]) : false;
      const meaningfulMixedProductivity = topProductivity ? isMeaningfulRemainder(totalSeconds, topProductivity[1]) : false;
      const meaningfulMixedApp = topApp ? isMeaningfulRemainder(totalSeconds, topApp[1]) : false;
      const isMixed = meaningfulMixedCategory || meaningfulMixedProductivity || meaningfulMixedApp;
      const startLabel = formatCalendarMinuteLabel(day, startMinute, startOfDayMinutes);
      const endLabel = formatCalendarMinuteLabel(day, endMinute, startOfDayMinutes);
      const categoryName = categoryLabel(dominantCategory);
      const topAppName = topApp?.[0] ?? categoryName;
      const sessionCount = segmentIds.size;
      const segmentLabel = capturedSegmentLabel(sessionCount);
      const detailSummary = isMixed ? segmentLabel : sessionCount <= 1 ? categoryName : segmentLabel;
      const displayAppName = isMixed ? topAppNamesLabel(topApps, topAppName || categoryName) : topAppName;
      const detailTitle = [
        `${startLabel}–${endLabel} · ${isMixed ? "Mixed activity" : categoryName}`,
        `${formatCompactDurationFromSeconds(totalSeconds)} across ${segmentLabel}`,
        ...topApps.slice(0, 3).map(([appName, seconds]) => `${appName} · ${formatCompactDurationFromSeconds(seconds)}`),
      ].join("\n");

      eventsByDay.get(day)!.push({
        id: `${day}-${dominantCategory}-${dominantProductivity}-${startMinute}-${endMinute}`,
        appName: displayAppName,
        category: dominantCategory,
        productivity: dominantProductivity,
        startLabel,
        endLabel,
        detailSummary,
        detailTitle,
        sessionCount,
        identities: visibleIdentities,
        hiddenIdentityCount: Math.max(0, orderedIdentities.length - visibleIdentities.length),
        isGroupedCluster: group.length > 1 || orderedIdentities.length > 1,
        classificationSource: dominantSource,
        aiClassification: aiSeconds > totalSeconds / 2,
        topMinutes: startMinute - minMinute,
        durationMinutes: Math.max(1, endMinute - startMinute),
        isShort: endMinute - startMinute <= bucketMinutes,
        lane: 0,
        laneCount: 1,
      });
      group = [];
    };

    const visuallyCollidesWithGroup = (entry: WeekCalendarBucketComponent): boolean => {
      if (group.length === 0) return false;
      const groupStartMinute = Math.min(...group.map((component) => component.coveredStartMinute));
      const groupEndMinute = Math.max(...group.map((component) => component.coveredEndMinute));
      const groupVisualEndMinute = groupStartMinute + Math.max(groupEndMinute - groupStartMinute, visualMergeWindowMinutes);
      return entry.coveredStartMinute < groupVisualEndMinute;
    };

    for (const entry of dominantBuckets) {
      if (group.length > 0) {
        const previous = group[group.length - 1];
        const hasMeaningfulGap = entry.coveredStartMinute - previous.coveredEndMinute >= meaningfulGapMinutes;
        const dominantChanged = previous.category !== entry.category || previous.productivity !== entry.productivity;
        if ((hasMeaningfulGap || dominantChanged) && !visuallyCollidesWithGroup(entry)) flushGroup();
      }
      group.push(entry);
    }
    flushGroup();
  }

  for (const events of eventsByDay.values()) {
    events.sort((left, right) => left.topMinutes - right.topMinutes || right.durationMinutes - left.durationMinutes);
  }

  return eventsByDay;
}

function formatCalendarMinuteLabel(day: string, minuteOfDay: number, startOfDayMinutes = 0): string {
  return formatTimeLabel(new Date(logicalDayStartMs(day, startOfDayMinutes) + minuteOfDay * 60 * 1000));
}

function assignWeekCalendarEventLanes(events: WeekCalendarEvent[]): void {
  let cluster: WeekCalendarEvent[] = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    for (const event of cluster) {
      const lane = laneEnds.findIndex((end) => end <= event.topMinutes);
      const assignedLane = lane === -1 ? laneEnds.length : lane;
      event.lane = assignedLane;
      laneEnds[assignedLane] = event.topMinutes + event.durationMinutes;
    }
    for (const event of cluster) event.laneCount = laneEnds.length;
    cluster = [];
  };

  for (const event of events) {
    const eventEnd = event.topMinutes + event.durationMinutes;
    if (cluster.length > 0 && event.topMinutes >= clusterEnd) flushCluster();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, eventEnd);
  }
  flushCluster();
}

function getCalendarWeekStartDay(selectedDay: string, startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK): string {
  const selectedWeekday = new Date(`${selectedDay}T12:00:00`).getDay();
  const weekStarts: Record<StartOfWeek, number> = { sunday: 0, monday: 1, saturday: 6 };
  const startWeekday = weekStarts[startOfWeek];
  const offset = (selectedWeekday - startWeekday + 7) % 7;
  return shiftIsoDate(selectedDay, -offset);
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function buildMonthV2Overview(segments: ActivitySegment[], selectedDay: string, classificationOptions?: ClassificationOptions, startOfDayMinutes = 0): MonthOverview {
  const monthKey = selectedDay.slice(0, 7);
  const [yearValue, monthValue] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(yearValue, monthValue, 0).getDate();
  const today = todayIsoDate();
  const cells: MonthOverviewCell[] = [];
  const firstWeekday = new Date(`${monthKey}-01T12:00:00`).getDay();

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ id: `month-v2-blank-${monthKey}-${index}`, isoDay: "", totalSeconds: 0, focusSeconds: 0, driftSeconds: 0, isBlank: true, isFuture: false, isToday: false, isSelected: false });
  }

  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
    const isoDay = `${monthKey}-${String(dayNumber).padStart(2, "0")}`;
    const daySegments = segments.filter((segment) => logicalDayIsoDateForDate(new Date(segment.startedAt), startOfDayMinutes) === isoDay);
    const totalSeconds = daySegments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    const focusSeconds = daySegments.reduce((sum, segment) => sum + (classifyActivity(segment, classificationOptions).productivity === "focus" ? segment.durationSeconds : 0), 0);
    const driftSeconds = daySegments.reduce((sum, segment) => sum + (classifyActivity(segment, classificationOptions).productivity === "drift" ? segment.durationSeconds : 0), 0);
    cells.push({
      id: `month-v2-${isoDay}`,
      isoDay,
      dayNumber,
      totalSeconds,
      focusSeconds,
      driftSeconds,
      isBlank: false,
      isFuture: isoDay > today,
      isToday: isoDay === today,
      isSelected: isoDay === selectedDay,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ id: `month-v2-tail-${cells.length}`, isoDay: "", totalSeconds: 0, focusSeconds: 0, driftSeconds: 0, isBlank: true, isFuture: false, isToday: false, isSelected: false });
  }

  const realCells = cells.filter((cell) => !cell.isBlank && !cell.isFuture);
  const activeCells = realCells.filter((cell) => cell.totalSeconds > 0);
  const focusCells = realCells.filter((cell) => cell.focusSeconds > 0);
  let streakDays = 0;
  let currentStreak = 0;
  for (const cell of realCells) {
    if (cell.focusSeconds > 0) {
      currentStreak += 1;
      streakDays = Math.max(streakDays, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const monthSegments = segments.filter((segment) => {
    const logicalDay = logicalDayIsoDateForDate(new Date(segment.startedAt), startOfDayMinutes);
    return logicalDay.slice(0, 7) === monthKey && logicalDay <= today;
  });
  const weekdayBuckets = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const cell of focusCells) {
    const weekday = new Date(`${cell.isoDay}T12:00:00`).getDay();
    weekdayBuckets[weekday].total += cell.focusSeconds;
    weekdayBuckets[weekday].count += 1;
  }
  const weekdayFocusAverages = weekdayBuckets.map((bucket) => bucket.count > 0 ? Math.round(bucket.total / bucket.count) : 0);
  const productivityEntries = buildProductivityDurations(monthSegments, classificationOptions);
  const activeProductivityEntries = productivityEntries.filter((entry) => entry.totalSeconds > 0).slice().sort((left, right) => right.totalSeconds - left.totalSeconds);
  const bestDay = realCells.reduce<MonthOverviewCell | null>((current, cell) => (!current || cell.focusSeconds > current.focusSeconds ? cell : current), null);

  return {
    monthLabel: formatHistoryMonthLabel(monthKey),
    weeks: chunk(cells, 7),
    activeDays: activeCells.length,
    focusDays: focusCells.length,
    streakDays,
    bestDay: bestDay && bestDay.focusSeconds > 0 ? bestDay : null,
    totalFocusSeconds: realCells.reduce((sum, cell) => sum + cell.focusSeconds, 0),
    totalDriftSeconds: realCells.reduce((sum, cell) => sum + cell.driftSeconds, 0),
    totalTrackedSeconds: realCells.reduce((sum, cell) => sum + cell.totalSeconds, 0),
    averageFocusPerActiveDay: activeCells.length > 0 ? Math.round(focusCells.reduce((sum, cell) => sum + cell.focusSeconds, 0) / activeCells.length) : 0,
    peakActivitySeconds: realCells.reduce((peak, cell) => Math.max(peak, cell.totalSeconds), 0),
    weekdayFocusAverages,
    maxWeekdayFocusAverage: Math.max(...weekdayFocusAverages, 1),
    categoryEntries: buildCategoryDurations(monthSegments, classificationOptions).filter((entry) => entry.totalSeconds > 0).slice(0, 4),
    productivityEntries,
    primaryProductivity: activeProductivityEntries[0] ?? productivityEntries[0] ?? null,
  };
}


function getDashboardPeriodRange(selectedDay: string, period: DashboardPeriod, startOfDayMinutes = 0, startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK) {
  if (period === "Today") {
    return {
      startDay: selectedDay,
      endDay: selectedDay,
      ...getLogicalDayRange(selectedDay, selectedDay, startOfDayMinutes),
    };
  }

  const startDay = period === "Week" ? getCalendarWeekStartDay(selectedDay, startOfWeek) : shiftIsoDate(selectedDay, -29);
  const endDay = period === "Week" ? shiftIsoDate(startDay, 6) : selectedDay;
  return {
    startDay,
    endDay,
    ...getLogicalDayRange(startDay, endDay, startOfDayMinutes),
  };
}

function getLeaderboardWindowStartDay(endDay: string, period: LeaderboardPeriod) {
  if (period === "daily") return endDay;
  return shiftIsoDate(endDay, period === "weekly" ? -6 : -29);
}

function getLeaderboardPeriodFocusLabel(period: LeaderboardPeriod) {
  if (period === "daily") return "Daily focus total";
  if (period === "monthly") return "Rolling 30-day focus total";
  return "Rolling 7-day focus total";
}

function getDashboardCurrentPeriodLabel(period: DashboardPeriod): string {
  if (period === "Week") return "This Week";
  if (period === "Month") return "This Month";
  return "Today";
}

function shiftDashboardPeriodDay(day: string, period: DashboardPeriod, direction: -1 | 1): string {
  if (period === "Week") return shiftIsoDate(day, direction * 7);
  if (period === "Month") return shiftIsoMonth(day, direction);
  return shiftIsoDate(day, direction);
}

function getSafeClassificationNavigationDay(
  day: string,
  range: ClassificationRange,
  direction: -1 | 0 | 1,
  todayDay: string,
  startOfDayMinutes = 0,
  startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK,
): string {
  if (direction === 0) return todayDay;

  const targetDay = shiftIsoDate(day, range === "Week" ? direction * 7 : direction);
  if (direction < 0) return targetDay;
  if (range === "Day") return targetDay <= todayDay ? targetDay : todayDay;

  const targetWeekRange = getDashboardPeriodRange(targetDay, "Week", startOfDayMinutes, startOfWeek);
  return targetWeekRange.startDay <= todayDay && todayDay <= targetWeekRange.endDay ? todayDay : targetDay;
}

function shiftIsoMonth(day: string, direction: -1 | 1): string {
  const [yearValue, monthValue, dayValue] = day.split("-").map(Number);
  const targetMonthIndex = monthValue - 1 + direction;
  const targetYear = yearValue + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();
  const targetDay = Math.min(dayValue, daysInTargetMonth);
  return `${targetYear}-${String(normalizedMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

function getLogicalDayRange(startDay: string, endDay: string, startOfDayMinutes = 0): { start: string; end: string } {
  return {
    start: formatLocalDateTime(logicalDayStartMs(startDay, startOfDayMinutes)),
    end: formatLocalDateTime(logicalDayEndExclusiveMs(endDay, startOfDayMinutes) - 1),
  };
}

function formatLocalDateTime(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function logicalTodayIsoDate(startOfDayMinutes = 0): string {
  return logicalDayIsoDateForDate(new Date(), startOfDayMinutes);
}

function clockHourForLogicalHour(logicalHour: number, startOfDayMinutes = 0): number {
  return Math.floor((logicalHour * 60 + startOfDayMinutes) / 60) % 24;
}

function formatStartOfDayOptionLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${period}`;
}

function getInsightPeriodRange(selectedDay: string, startOfDayMinutes = 0) {
  const days = 90;
  const startDay = shiftIsoDate(selectedDay, -(days - 1));
  return {
    startDay,
    endDay: selectedDay,
    ...getLogicalDayRange(startDay, selectedDay, startOfDayMinutes),
  };
}

function filterSegmentsForRange(segments: ActivitySegment[], start: string, end: string): ActivitySegment[] {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  return segments.filter((segment) => {
    const segmentStart = new Date(segment.startedAt).getTime();
    const segmentEnd = new Date(segment.endedAt).getTime();
    return segmentEnd >= startMs && segmentStart <= endMs;
  });
}

function buildMockEndOfDayReviewSegments(day: string): ActivitySegment[] {
  const start = new Date(`${day}T09:00:00`);
  const focusEnd = new Date(start.getTime() + 95 * 60 * 1000);
  const driftStart = new Date(`${day}T14:15:00`);
  const driftEnd = new Date(driftStart.getTime() + 35 * 60 * 1000);

  return [
    {
      id: "end-of-day-review-preview-focus",
      startedAt: start.toISOString(),
      endedAt: focusEnd.toISOString(),
      durationSeconds: 95 * 60,
      appName: "Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "Planning tomorrow",
      platform: "macos",
      source: "nsworkspace",
      classification: {
        category: "workspace",
        productivity: "focus",
        source: "manual",
        confidence: 1,
        reason: "Deterministic end-of-day review preview",
      },
    },
    {
      id: "end-of-day-review-preview-drift",
      startedAt: driftStart.toISOString(),
      endedAt: driftEnd.toISOString(),
      durationSeconds: 35 * 60,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Google Chrome",
      siteDomain: "youtube.com",
      siteTitle: "Design rabbit hole",
      siteUrl: "https://youtube.com/watch?v=preview",
      windowTitle: "Design rabbit hole",
      platform: "macos",
      source: "nsworkspace",
      classification: {
        category: "entertainment",
        productivity: "drift",
        source: "manual",
        confidence: 1,
        reason: "Deterministic end-of-day review preview",
      },
    },
  ];
}

function formatDashboardPeriodLabel(period: DashboardPeriod, startDay: string, endDay: string): string {
  if (period === "Today") return formatDayLabel(endDay);
  return `${period} · ${formatDayLabel(startDay)}–${formatDayLabel(endDay)}`;
}

function formatDateRangeLabel(startDay: string, endDay: string): string {
  if (startDay === endDay) return formatDayLabel(endDay);
  return `${formatDayLabel(startDay)}–${formatDayLabel(endDay)}`;
}

function getAccountDisplayName(email: string | null): string {
  if (!email) return "Account";
  const name = email.split("@")[0]?.trim();
  return name || "Account";
}


function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

function snapStartOfDayMinutes(minutes: number): number {
  return Math.min(23 * 60, Math.max(0, Math.round(minutes / 60) * 60));
}

function minutesToHourlyStartOfDayValue(minutes: number): string {
  const hours = snapStartOfDayMinutes(minutes) / 60;
  return `${String(hours).padStart(2, "0")}:00`;
}

function hourlyStartOfDayValueToMinutes(value: string): number {
  return START_OF_DAY_OPTIONS.find((option) => option.value === value)?.minutes ?? DEFAULT_START_OF_DAY_MINUTES;
}

function resolveInitialStartOfDayMinutes(): number {
  if (typeof window === "undefined") return DEFAULT_START_OF_DAY_MINUTES;
  const savedValue = window.localStorage.getItem(START_OF_DAY_STORAGE_KEY);
  if (!savedValue) return DEFAULT_START_OF_DAY_MINUTES;
  const parsedValue = Number(savedValue);
  if (!Number.isFinite(parsedValue)) return DEFAULT_START_OF_DAY_MINUTES;
  return snapStartOfDayMinutes(parsedValue);
}

function isStartOfWeek(value: string | null): value is StartOfWeek {
  return START_OF_WEEK_OPTIONS.some((option) => option.value === value);
}

function resolveInitialStartOfWeek(): StartOfWeek {
  if (typeof window === "undefined") return DEFAULT_START_OF_WEEK;
  const savedValue = window.localStorage.getItem(START_OF_WEEK_STORAGE_KEY);
  return isStartOfWeek(savedValue) ? savedValue : DEFAULT_START_OF_WEEK;
}

function readColorOverrideMap<T extends string>(storageKey: string, allowedKeys: readonly T[]): Partial<Record<T, string>> {
  if (typeof window === "undefined") return {};
  try {
    const savedValue = window.localStorage.getItem(storageKey);
    if (!savedValue) return {};
    const parsedValue: unknown = JSON.parse(savedValue);
    if (!parsedValue || typeof parsedValue !== "object") return {};
    const record = parsedValue as Record<string, unknown>;
    const next: Partial<Record<T, string>> = {};
    for (const key of allowedKeys) {
      const value = record[key];
      if (typeof value === "string" && isHexColor(value)) next[key] = value;
    }
    return next;
  } catch {
    return {};
  }
}

function resolveInitialCategoryColorOverrides(): CategoryColorOverrides {
  return readColorOverrideMap(CATEGORY_COLOR_STORAGE_KEY, CATEGORY_COLOR_OPTIONS.map((option) => option.key));
}

function resolveInitialAppThemeColorOverrides(): AppThemeColorOverrides {
  return readColorOverrideMap(APP_THEME_COLOR_STORAGE_KEY, APP_THEME_COLOR_OPTIONS.map((option) => option.key));
}

function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const saved = readMigratedLocalStorageValue(THEME_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") { applyThemeToDocument(saved); return saved; }
  applyThemeToDocument(DEFAULT_THEME);
  return DEFAULT_THEME;
}

function resolveInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  const savedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (savedValue !== null) return savedValue === "1";

  const legacyValue = window.localStorage.getItem(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (legacyValue !== null) {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, legacyValue);
    return legacyValue === "1";
  }

  return false;
}

function resolveInitialDriftAlertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return readMigratedLocalStorageValue(DRIFT_ALERTS_STORAGE_KEY, LEGACY_DRIFT_ALERTS_STORAGE_KEY) === "1";
}

function readMigratedLocalStorageValue(storageKey: string, legacyStorageKey: string): string | null {
  const savedValue = window.localStorage.getItem(storageKey);
  if (savedValue !== null) return savedValue;

  const legacyValue = window.localStorage.getItem(legacyStorageKey);
  if (legacyValue !== null) window.localStorage.setItem(storageKey, legacyValue);
  return legacyValue;
}

function resolveInitialWatcherPeekEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const savedValue = readMigratedLocalStorageValue(WATCHER_PEEK_STORAGE_KEY, LEGACY_WATCHER_PEEK_STORAGE_KEY);
  if (savedValue === null) return false;
  return savedValue === "1";
}

function resolveInitialWatcherMode(): WatcherMode {
  if (typeof window === "undefined") return "periodic";
  return readMigratedLocalStorageValue(WATCHER_MODE_STORAGE_KEY, LEGACY_WATCHER_MODE_STORAGE_KEY) === "drift_only" ? "drift_only" : "periodic";
}

function resolveInitialAiClassificationVisibility(): boolean {
  if (typeof window === "undefined") return true;
  return readMigratedLocalStorageValue(AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY, LEGACY_AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY) !== "0";
}

function toPersistedLocalAiSetup(setup: LocalAiSetupState): PersistedLocalAiSetupState {
  return {
    provider: setup.provider,
    openRouterModel: setup.openRouterModel,
    selfHostedBaseUrl: setup.selfHostedBaseUrl,
    selfHostedModel: setup.selfHostedModel,
  };
}

function resolveInitialLocalAiSetup(): LocalAiSetupState {
  if (typeof window === "undefined") return DEFAULT_LOCAL_AI_SETUP;
  try {
    const savedValue = window.localStorage.getItem(LOCAL_AI_SETUP_STORAGE_KEY);
    if (!savedValue) return DEFAULT_LOCAL_AI_SETUP;
    const parsedValue: unknown = JSON.parse(savedValue);
    if (!parsedValue || typeof parsedValue !== "object") return DEFAULT_LOCAL_AI_SETUP;
    const record = parsedValue as Record<string, unknown>;
    const provider: LocalAiProvider = record.provider === "self_hosted" ? "self_hosted" : "openrouter_byok";
    return {
      provider,
      openRouterApiKey: "",
      openRouterModel: typeof record.openRouterModel === "string" && record.openRouterModel.trim() ? record.openRouterModel : DEFAULT_LOCAL_AI_SETUP.openRouterModel,
      selfHostedBaseUrl: typeof record.selfHostedBaseUrl === "string" && record.selfHostedBaseUrl.trim() ? record.selfHostedBaseUrl : DEFAULT_LOCAL_AI_SETUP.selfHostedBaseUrl,
      selfHostedModel: typeof record.selfHostedModel === "string" ? record.selfHostedModel : "",
    };
  } catch {
    return DEFAULT_LOCAL_AI_SETUP;
  }
}


function resolveInitialWatcherPeriodicMinutes(boundary: "min" | "max"): number {
  if (typeof window === "undefined") return DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES[boundary];
  const key = boundary === "min" ? WATCHER_PERIODIC_MIN_STORAGE_KEY : WATCHER_PERIODIC_MAX_STORAGE_KEY;
  const legacyKey = boundary === "min" ? LEGACY_WATCHER_PERIODIC_MIN_STORAGE_KEY : LEGACY_WATCHER_PERIODIC_MAX_STORAGE_KEY;
  return normalizeWatcherPeriodicMinutes(readMigratedLocalStorageValue(key, legacyKey), DEFAULT_WATCHER_PERIODIC_RANGE_MINUTES[boundary]);
}

function normalizeWatcherPeriodicMinutes(value: string | null, fallback: number): number {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return fallback;
  if (parsedValue < WATCHER_PERIODIC_MIN_LIMIT_MINUTES) return fallback;
  return Math.min(WATCHER_PERIODIC_MAX_LIMIT_MINUTES, Math.max(WATCHER_PERIODIC_MIN_LIMIT_MINUTES, Math.round(parsedValue)));
}

async function sendDriftNotification(segment: ActivitySegment) {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (getCurrentWindow().label !== "main") return;

    const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
    let hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      const permission = await requestPermission();
      hasPermission = permission === "granted";
    }

    if (!hasPermission) return;

    const place = segment.siteDomain ?? segment.appName;
    sendNotification({
      title: "Drift detected",
      body: `${formatCompactDurationFromSeconds(segment.durationSeconds)} on ${place}. Take a breath and choose the next action.`,
    });
  } catch {
    // Notifications are a convenience; tracking should continue even if macOS denies permission.
  }
}

function applyThemeToDocument(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Unknown error"; }
}

function formatDayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  return uiDayFormatter.format(parsed);
}

function formatHistoryMonthLabel(month: string): string {
  const parsed = new Date(`${month}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return month;
  return new Intl.DateTimeFormat(UI_LOCALE, { month: "long", year: "numeric" }).format(parsed);
}

function isoDateFromTimestamp(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${`${parsed.getMonth() + 1}`.padStart(2, "0")}-${`${parsed.getDate()}`.padStart(2, "0")}`;
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildQuarterHourDayField(segments: ActivitySegment[], day: string, startOfDayMinutes = 0): DayFieldSlot[] {
  const slotDur = 15 * 60;
  const dayStartMs = logicalDayStartMs(day, startOfDayMinutes);
  const slots = Array.from({ length: 96 }, (_, index) => {
    const slotStartMs = dayStartMs + index * slotDur * 1000;
    const slotEndMs = slotStartMs + slotDur * 1000;
    let totalSeconds = 0;
    for (const seg of segments) {
      const overlapMs = Math.min(new Date(seg.endedAt).getTime(), slotEndMs) - Math.max(new Date(seg.startedAt).getTime(), slotStartMs);
      if (overlapMs > 0) totalSeconds += Math.round(overlapMs / 1000);
    }
    const minuteOfDay = (startOfDayMinutes + index * 15) % (24 * 60);
    return { index, minuteOfDay, hour: Math.floor(minuteOfDay / 60), quarter: Math.floor((minuteOfDay % 60) / 15), totalSeconds, ratio: 0 };
  });
  const peak = Math.max(...slots.map((s) => s.totalSeconds), 1);
  return slots.map((s) => ({ ...s, ratio: s.totalSeconds === 0 ? 0.04 : Math.max(s.totalSeconds / peak, 0.1) }));
}

const UI_LOCALE = "en-US";
const uiDayFormatter = new Intl.DateTimeFormat(UI_LOCALE, { weekday: "short", month: "short", day: "numeric" });
const uiTimeFormatter = new Intl.DateTimeFormat(UI_LOCALE, { hour: "numeric", minute: "2-digit" });
