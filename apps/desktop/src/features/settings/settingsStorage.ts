import type { AppThemeColorKey, ColorOption } from "./SettingsColorControls";
import type { ActivityCategory, AdaptiveContextSourceFamily, ProductivityLabel, TrayIconStyle } from "@drifty/domain";
import { formatStartOfDayOptionLabel } from "../../lib/formatting";

export type ThemeMode = "light" | "dark";

export type StartOfWeek = "sunday" | "monday" | "saturday";

export type CategoryColorOverrides = Partial<Record<ActivityCategory, string>>;

export type AppThemeColorOverrides = Partial<Record<AppThemeColorKey, string>>;

export const THEME_STORAGE_KEY = "drifty.theme";

export const MENU_BAR_ICON_STYLE_STORAGE_KEY = "drifty.appearance.menuBarIconStyle";

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "drifty.sidebar.collapsed";

export const DASHBOARD_BREAKDOWN_OPEN_STORAGE_KEY = "drifty.dashboard.breakdownOpen";

export const AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY = "drifty.dev.showAiClassificationImpact";

export const DEV_MODE_STORAGE_KEY = "drifty.dev.mode";
export const DEVICE_SYNC_ENABLED_STORAGE_KEY = "drifty.deviceSync.enabled";
export const DEVICE_SYNC_PREVIEW_STORAGE_KEY = "drifty.dev.deviceSyncPreview";
export const WEB_ACCOUNT_PREVIEW_STORAGE_KEY = "drifty.dev.webAccountPreview";

export const TEAMS_BETA_STORAGE_KEY = "drifty.dev.teamsBeta";
export const PROFILE_BETA_STORAGE_KEY = "drifty.dev.profileBeta";
export const FLOATING_COMPANION_DEV_STORAGE_KEY = "drifty.dev.floatingCompanion";
/** Dev-only before/after switch for the shell glass: "1" restores the
 * previous CSS backdrop-filter implementation (the one that flickered) so it
 * can be compared against the new native under-window blur. Default off
 * (= native blur, the production behavior). */
export const LEGACY_SHELL_BLUR_PREVIEW_STORAGE_KEY = "drifty.dev.legacyShellBlurPreview";

export const ENHANCED_CONTEXT_ENABLED_STORAGE_KEY = "drifty.dev.enhancedContext.enabled";
export const ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY = "drifty.dev.enhancedContext.captureLocal";
export const ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY = "drifty.dev.enhancedContext.retryLowConfidence";
export const ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY = "drifty.dev.enhancedContext.debugLogging";

export const FORCE_CHROMIUM_AX_CAPTURE_STORAGE_KEY = "drifty.dev.forceChromiumAxCapture";

export const FORCE_FRONTMOST_FALLBACK_CAPTURE_STORAGE_KEY = "drifty.dev.forceFrontmostFallbackCapture";

export const FORCE_BROWSER_HISTORY_URL_FALLBACK_STORAGE_KEY = "drifty.dev.forceBrowserHistoryUrlFallback";

export const FORCE_CHROMIUM_AX_EXTREME_NUDGE_STORAGE_KEY = "drifty.dev.forceChromiumAxExtremeNudge";

export const DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY = "drifty.dev.dashboardReplay.preRollSeconds";

export const DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY = "drifty.dev.dashboardReplay.durationSeconds";

export const START_OF_DAY_STORAGE_KEY = "drifty.general.startOfDayMinutes";

export const START_OF_WEEK_STORAGE_KEY = "drifty.general.startOfWeek";

export const CATEGORY_COLOR_STORAGE_KEY = "drifty.theme.categoryColors.v1";

export const APP_THEME_COLOR_STORAGE_KEY = "drifty.theme.appColors.v1";

export const DEFAULT_START_OF_DAY_MINUTES = 4 * 60;

export const DEFAULT_START_OF_WEEK: StartOfWeek = "monday";

export const DEMO_DASHBOARD_REPLAY_PRE_ROLL_DEFAULT_SECONDS = 5;

export const DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS = 0;

export const DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS = 15;

export const DEMO_DASHBOARD_REPLAY_DURATION_DEFAULT_SECONDS = 45;

export const DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS = 15;

export const DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS = 180;

export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export type DemoDashboardReplaySettings = {
  readonly preRollSeconds: number;
  readonly durationSeconds: number;
};

export type EnhancedContextSourceFamily = Exclude<AdaptiveContextSourceFamily, "surface_metadata">;

export type EnhancedContextSourceFamilyOption = {
  readonly family: EnhancedContextSourceFamily;
  readonly label: string;
  readonly description: string;
};

export type EnhancedContextSourceFamilySettings = Readonly<Record<EnhancedContextSourceFamily, boolean>>;

export type EnhancedContextSettings = {
  readonly enabled: boolean;
  readonly captureLocal: boolean;
  readonly retryLowConfidence: boolean;
  readonly debugLogging: boolean;
  readonly sourceFamilies: EnhancedContextSourceFamilySettings;
};

export const ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS = [
  {
    family: "document_knowledge",
    label: "Document / knowledge",
    description: "Notion, Confluence, Google Docs, Coda-style page metadata.",
  },
  {
    family: "local_notes_markdown",
    label: "Local notes / markdown",
    description: "Obsidian, Markdown, and exposed local note structure.",
  },
  {
    family: "work_tracker_dev_platform",
    label: "Work trackers / dev platforms",
    description: "Linear, Jira, GitHub, GitLab, Sentry-style issue metadata.",
  },
  {
    family: "design_dev_tool",
    label: "Design / dev tools",
    description: "Figma, IDE, editor, repo, project, and selected-page metadata.",
  },
  {
    family: "calendar_meeting",
    label: "Calendar / meeting metadata",
    description: "Meeting type, calendar workspace, and non-identifying counts.",
  },
  {
    family: "communication_metadata",
    label: "Communication metadata",
    description: "Workspace, channel, and thread metadata only; no message bodies.",
  },
] satisfies readonly EnhancedContextSourceFamilyOption[];

export const ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS: Readonly<Record<EnhancedContextSourceFamily, string>> = {
  document_knowledge: "drifty.dev.enhancedContext.source.documentKnowledge",
  local_notes_markdown: "drifty.dev.enhancedContext.source.localNotesMarkdown",
  work_tracker_dev_platform: "drifty.dev.enhancedContext.source.workTrackerDevPlatform",
  design_dev_tool: "drifty.dev.enhancedContext.source.designDevTool",
  calendar_meeting: "drifty.dev.enhancedContext.source.calendarMeeting",
  communication_metadata: "drifty.dev.enhancedContext.source.communicationMetadata",
};

export const DEFAULT_ENHANCED_CONTEXT_SOURCE_FAMILIES: EnhancedContextSourceFamilySettings = {
  document_knowledge: false,
  local_notes_markdown: false,
  work_tracker_dev_platform: false,
  design_dev_tool: false,
  calendar_meeting: false,
  communication_metadata: false,
};

export const DEFAULT_ENHANCED_CONTEXT_SETTINGS: EnhancedContextSettings = {
  enabled: false,
  captureLocal: false,
  retryLowConfidence: false,
  debugLogging: false,
  sourceFamilies: DEFAULT_ENHANCED_CONTEXT_SOURCE_FAMILIES,
};

type DemoDashboardReplaySettingsInput = {
  readonly preRollSeconds?: string | number | null;
  readonly durationSeconds?: string | number | null;
};

export const START_OF_DAY_OPTIONS: Array<{ value: string; label: string; minutes: number }> = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  return { value, label: formatStartOfDayOptionLabel(hour * 60), minutes: hour * 60 };
});

export const START_OF_WEEK_OPTIONS = [
  { value: "monday", label: "Monday" },
  { value: "sunday", label: "Sunday" },
  { value: "saturday", label: "Saturday" },
] satisfies ReadonlyArray<{ value: StartOfWeek; label: string }>;

export const APP_THEME_COLOR_OPTIONS = [
  { key: "accent", label: "Accent", cssVariable: "--accent", defaultColor: "#5f7f31" },
  { key: "productivityFocus", label: "Focus", cssVariable: "--productivity-focus", defaultColor: "#4f751e" },
  { key: "productivityDrift", label: "Drift", cssVariable: "--productivity-drift", defaultColor: "#a34139" },
  { key: "productivityNeutral", label: "Neutral", cssVariable: "--productivity-neutral", defaultColor: "#9b968b" },
] satisfies ReadonlyArray<ColorOption<AppThemeColorKey>>;

export const APP_THEME_ACCENT_COLOR_OPTIONS = APP_THEME_COLOR_OPTIONS.filter((option) => option.key === "accent");

export const APP_THEME_PRODUCTIVITY_COLOR_OPTIONS = APP_THEME_COLOR_OPTIONS.filter((option) => option.key !== "accent");

export const CATEGORY_COLOR_OPTIONS = [
  { key: "workspace", label: "Workspace", cssVariable: "--category-workspace", defaultColor: "#5f7f31" },
  { key: "learning", label: "Learning", cssVariable: "--category-learning", defaultColor: "#2f7f78" },
  { key: "communication", label: "Communication", cssVariable: "--category-communication", defaultColor: "#476f8f" },
  { key: "music", label: "Music", cssVariable: "--category-music", defaultColor: "#7b5ea7" },
  { key: "game", label: "Game", cssVariable: "--category-game", defaultColor: "#9a6530" },
  { key: "social_media", label: "Social media", cssVariable: "--category-social-media", defaultColor: "#b9565b" },
  { key: "entertainment", label: "Entertainment", cssVariable: "--category-entertainment", defaultColor: "#c05d48" },
  { key: "shopping", label: "Shopping", cssVariable: "--category-shopping", defaultColor: "#a1792f" },
  { key: "utility", label: "Utility", cssVariable: "--category-utility", defaultColor: "#66707a" },
  { key: "unknown", label: "Unknown", cssVariable: "--category-unknown", defaultColor: "#4d4b45" },
] satisfies ReadonlyArray<ColorOption<ActivityCategory>>;

export function categoryControlColor(category: ActivityCategory, overrides: CategoryColorOverrides): string {
  return overrides[category] ?? CATEGORY_COLOR_OPTIONS.find((option) => option.key === category)?.defaultColor ?? "#66707a";
}

export function productivityControlColor(productivity: ProductivityLabel, overrides: AppThemeColorOverrides): string {
  switch (productivity) {
    case "focus": return overrides.productivityFocus ?? "#4f751e";
    case "drift": return overrides.productivityDrift ?? "#a34139";
    case "neutral": return overrides.productivityNeutral ?? "#9b968b";
  }
}

export const DEFAULT_THEME: ThemeMode = "light";

export const DEFAULT_MENU_BAR_ICON_STYLE: TrayIconStyle = "compact";

export const MENU_BAR_ICON_STYLE_OPTIONS = [
  { value: "compact", label: "Ring only" },
  { value: "expanded", label: "Logo + ring" },
] satisfies ReadonlyArray<{ readonly value: TrayIconStyle; readonly label: string }>;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

export function isMenuBarIconStyle(value: string | null): value is TrayIconStyle {
  return MENU_BAR_ICON_STYLE_OPTIONS.some((option) => option.value === value);
}

export function snapStartOfDayMinutes(minutes: number): number {
  return Math.min(23 * 60, Math.max(0, Math.round(minutes / 60) * 60));
}

export function minutesToHourlyStartOfDayValue(minutes: number): string {
  const hours = snapStartOfDayMinutes(minutes) / 60;
  return `${String(hours).padStart(2, "0")}:00`;
}

export function hourlyStartOfDayValueToMinutes(value: string): number {
  return START_OF_DAY_OPTIONS.find((option) => option.value === value)?.minutes ?? DEFAULT_START_OF_DAY_MINUTES;
}

function parseDemoDashboardReplaySeconds(value: string | number | null | undefined, defaultValue: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : defaultValue;
  if (typeof value !== "string") return defaultValue;
  const trimmedValue = value.trim();
  if (!trimmedValue) return defaultValue;
  const parsedValue = Number(trimmedValue);
  return Number.isFinite(parsedValue) ? parsedValue : defaultValue;
}

function clampSeconds(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampDemoDashboardReplaySettings(settings: DemoDashboardReplaySettingsInput): DemoDashboardReplaySettings {
  const preRollSeconds = parseDemoDashboardReplaySeconds(
    settings.preRollSeconds,
    DEMO_DASHBOARD_REPLAY_PRE_ROLL_DEFAULT_SECONDS,
  );
  const durationSeconds = parseDemoDashboardReplaySeconds(
    settings.durationSeconds,
    DEMO_DASHBOARD_REPLAY_DURATION_DEFAULT_SECONDS,
  );
  return {
    preRollSeconds: clampSeconds(
      preRollSeconds,
      DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS,
      DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS,
    ),
    durationSeconds: clampSeconds(
      durationSeconds,
      DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS,
      DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS,
    ),
  };
}

export function resolveInitialDemoDashboardReplaySettings(): DemoDashboardReplaySettings {
  if (typeof window === "undefined") return clampDemoDashboardReplaySettings({});
  return clampDemoDashboardReplaySettings({
    preRollSeconds: window.localStorage.getItem(DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY),
    durationSeconds: window.localStorage.getItem(DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY),
  });
}

export function persistDemoDashboardReplaySettings(settings: DemoDashboardReplaySettingsInput): DemoDashboardReplaySettings {
  const clampedSettings = clampDemoDashboardReplaySettings(settings);
  if (typeof window === "undefined") return clampedSettings;
  window.localStorage.setItem(
    DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY,
    String(clampedSettings.preRollSeconds),
  );
  window.localStorage.setItem(
    DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY,
    String(clampedSettings.durationSeconds),
  );
  return clampedSettings;
}

export function resetDemoDashboardReplaySettings(): DemoDashboardReplaySettings {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY);
    window.localStorage.removeItem(DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY);
  }
  return clampDemoDashboardReplaySettings({});
}

export function resolveInitialStartOfDayMinutes(): number {
  if (typeof window === "undefined") return DEFAULT_START_OF_DAY_MINUTES;
  const savedValue = window.localStorage.getItem(START_OF_DAY_STORAGE_KEY);
  if (!savedValue) return DEFAULT_START_OF_DAY_MINUTES;
  const parsedValue = Number(savedValue);
  if (!Number.isFinite(parsedValue)) return DEFAULT_START_OF_DAY_MINUTES;
  return snapStartOfDayMinutes(parsedValue);
}

export function isStartOfWeek(value: string | null): value is StartOfWeek {
  return START_OF_WEEK_OPTIONS.some((option) => option.value === value);
}

export function resolveInitialStartOfWeek(): StartOfWeek {
  if (typeof window === "undefined") return DEFAULT_START_OF_WEEK;
  const savedValue = window.localStorage.getItem(START_OF_WEEK_STORAGE_KEY);
  return isStartOfWeek(savedValue) ? savedValue : DEFAULT_START_OF_WEEK;
}

export function readColorOverrideMap<T extends string>(storageKey: string, allowedKeys: readonly T[]): Partial<Record<T, string>> {
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

export function resolveInitialCategoryColorOverrides(): CategoryColorOverrides {
  return readColorOverrideMap(CATEGORY_COLOR_STORAGE_KEY, CATEGORY_COLOR_OPTIONS.map((option) => option.key));
}

export function resolveInitialAppThemeColorOverrides(): AppThemeColorOverrides {
  return readColorOverrideMap(APP_THEME_COLOR_STORAGE_KEY, APP_THEME_COLOR_OPTIONS.map((option) => option.key));
}

export function resolveInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") { applyThemeToDocument(saved); return saved; }
  applyThemeToDocument(DEFAULT_THEME);
  return DEFAULT_THEME;
}

export function resolveInitialMenuBarIconStyle(): TrayIconStyle {
  if (typeof window === "undefined") return DEFAULT_MENU_BAR_ICON_STYLE;
  const saved = window.localStorage.getItem(MENU_BAR_ICON_STYLE_STORAGE_KEY);
  return isMenuBarIconStyle(saved) ? saved : DEFAULT_MENU_BAR_ICON_STYLE;
}

export function resolveInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
}

// One preference shared by Your Day and Your Week: the Breakdown side panel
// reads as a single surface across both dashboards, so collapsing it anywhere
// collapses it everywhere, including across relaunches. Open by default.
export function resolveInitialDashboardBreakdownOpen(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(DASHBOARD_BREAKDOWN_OPEN_STORAGE_KEY) !== "0";
}

export function persistDashboardBreakdownOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DASHBOARD_BREAKDOWN_OPEN_STORAGE_KEY, open ? "1" : "0");
}

export function resolveInitialAiClassificationVisibility(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(AI_CLASSIFICATION_VISIBILITY_STORAGE_KEY) !== "0";
}

export function resolveInitialDevModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1";
}

// Off by default (opt-in): the Dev-settings toggle is the sole gate for the
// project-classification preview, so the Projects/Intelligence surfaces stay hidden
// in every build until a developer explicitly enables them in Dev mode.
// Off by default (explicit opt-in): device sync uploads raw activity segments to the
// user's private cloud space, so each Mac must be enabled deliberately — never by a
// build default or a remote flag.
export function resolveInitialDeviceSyncEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEVICE_SYNC_ENABLED_STORAGE_KEY) === "1";
}

// Off by default (opt-in): the Dev-settings toggle is the sole gate for the device-sync
// preview surface — without it the Account-settings section is hidden and sync stays
// inert even if a per-Mac opt-in was flipped earlier.
export function resolveInitialDeviceSyncPreviewEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEVICE_SYNC_PREVIEW_STORAGE_KEY) === "1";
}

// Off by default (opt-in): the Dev-settings toggle is the sole gate for the web account
// preview — it gates both the Profile tab's embed detail-share toggles and the background
// publisher that mirrors an aggregate-only activity summary to the drifty.so account
// dashboard. Nothing extra is published until a developer turns this on in Dev mode.
export function resolveInitialWebAccountPreviewEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WEB_ACCOUNT_PREVIEW_STORAGE_KEY) === "1";
}

export function resolveInitialTeamsBetaEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TEAMS_BETA_STORAGE_KEY) === "1";
}

export function resolveInitialProfileBetaEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PROFILE_BETA_STORAGE_KEY) === "1";
}

export function resolveInitialLegacyShellBlurPreviewEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LEGACY_SHELL_BLUR_PREVIEW_STORAGE_KEY) === "1";
}

/** Floating remains a Dev-only preview while the menu-bar Companion ships. */
export function resolveInitialFloatingCompanionDevEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FLOATING_COMPANION_DEV_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function resolveInitialEnhancedContextSettings(): EnhancedContextSettings {
  if (typeof window === "undefined") return DEFAULT_ENHANCED_CONTEXT_SETTINGS;
  return {
    enabled: readStoredBoolean(ENHANCED_CONTEXT_ENABLED_STORAGE_KEY),
    captureLocal: readStoredBoolean(ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY),
    retryLowConfidence: readStoredBoolean(ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY),
    debugLogging: readStoredBoolean(ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY),
    sourceFamilies: {
      document_knowledge: readStoredBoolean(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.document_knowledge),
      local_notes_markdown: readStoredBoolean(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.local_notes_markdown),
      work_tracker_dev_platform: readStoredBoolean(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.work_tracker_dev_platform),
      design_dev_tool: readStoredBoolean(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.design_dev_tool),
      calendar_meeting: readStoredBoolean(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.calendar_meeting),
      communication_metadata: readStoredBoolean(ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS.communication_metadata),
    },
  };
}

export function resolveEffectiveEnhancedContextSettings(
  devModeEnabled: boolean,
  settings: EnhancedContextSettings,
): EnhancedContextSettings {
  if (!devModeEnabled || !settings.enabled) return DEFAULT_ENHANCED_CONTEXT_SETTINGS;
  return settings;
}

export function persistEnhancedContextSettings(
  settings: EnhancedContextSettings,
  devModeEnabled: boolean,
): EnhancedContextSettings {
  const effectiveSettings = resolveEffectiveEnhancedContextSettings(devModeEnabled, settings);
  if (typeof window === "undefined") return effectiveSettings;
  writeStoredBoolean(ENHANCED_CONTEXT_ENABLED_STORAGE_KEY, effectiveSettings.enabled);
  writeStoredBoolean(ENHANCED_CONTEXT_CAPTURE_LOCAL_STORAGE_KEY, effectiveSettings.captureLocal);
  writeStoredBoolean(ENHANCED_CONTEXT_RETRY_LOW_CONFIDENCE_STORAGE_KEY, effectiveSettings.retryLowConfidence);
  writeStoredBoolean(ENHANCED_CONTEXT_DEBUG_LOGGING_STORAGE_KEY, effectiveSettings.debugLogging);
  for (const option of ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS) {
    writeStoredBoolean(
      ENHANCED_CONTEXT_SOURCE_FAMILY_STORAGE_KEYS[option.family],
      effectiveSettings.sourceFamilies[option.family],
    );
  }
  return effectiveSettings;
}

export function hasEnabledEnhancedContextSetting(settings: EnhancedContextSettings): boolean {
  return settings.enabled
    || settings.captureLocal
    || settings.retryLowConfidence
    || settings.debugLogging
    || ENHANCED_CONTEXT_SOURCE_FAMILY_OPTIONS.some((option) => settings.sourceFamilies[option.family]);
}

export function resolveInitialForceChromiumAxCaptureEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FORCE_CHROMIUM_AX_CAPTURE_STORAGE_KEY) === "1";
}

export function resolveInitialForceFrontmostFallbackCaptureEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FORCE_FRONTMOST_FALLBACK_CAPTURE_STORAGE_KEY) === "1";
}

export function resolveInitialForceBrowserHistoryUrlFallbackEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FORCE_BROWSER_HISTORY_URL_FALLBACK_STORAGE_KEY) === "1";
}

export function resolveInitialForceChromiumAxExtremeNudgeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FORCE_CHROMIUM_AX_EXTREME_NUDGE_STORAGE_KEY) === "1";
}

export function applyThemeToDocument(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function readStoredBoolean(storageKey: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(storageKey) === "1";
}

function writeStoredBoolean(storageKey: string, enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, enabled ? "1" : "0");
}
