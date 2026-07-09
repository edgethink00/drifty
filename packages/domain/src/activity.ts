export type TrackerSource = "nsworkspace" | "accessibility" | "manual" | "browser-history-import" | "unknown";
export type SiteSource = "applescript" | "applescript-front-window" | "accessibility-address-bar" | "browser-history-title" | "browser-history-import" | "window-title" | "unknown" | null;
export type BrowserAutomationStatus = "granted" | "denied" | "unavailable" | "stale" | "empty_result" | "not_applicable";
export type BrowserHistoryStatus = "unsupported" | "no_profile_root" | "no_readable_database" | "no_match" | "matched";
export type SystemTransientActivity = "mission_control" | "app_switcher" | "launchpad" | "spotlight" | "system_overlay" | null;
export type FrontmostCaptureSource = "system-events" | "lsappinfo" | "unavailable";
export const FLOW_INTERVAL_OPTIONS = [3, 4, 5] as const;
export type FlowIntervalMinutes = typeof FLOW_INTERVAL_OPTIONS[number];
export type ProductivityLabel = "focus" | "neutral" | "drift";
export type ProductivityBasis = "direct" | "contextual";
export type ActivityCategory =
  | "workspace"
  | "learning"
  | "communication"
  | "music"
  | "game"
  | "social_media"
  | "entertainment"
  | "shopping"
  | "utility"
  | "unknown";

export interface ActivityClassification {
  category: ActivityCategory;
  productivity: ProductivityLabel;
}

export type StoredClassificationSource = "llm" | "manual" | "rule" | "fallback" | "system" | "unknown" | "app-db" | "domain-db" | "youtube" | "ai_review";

export interface StoredActivityClassification extends ActivityClassification {
  source: StoredClassificationSource;
  confidence: number;
  reason?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  taxonomyVersion?: string | null;
  inputFingerprint?: string | null;
  classifiedAt?: string | null;
  aiResult?: boolean | null;
  stale?: boolean | null;
  reusedAiResult?: boolean | null;
  classificationRuleId?: string | null;
}

export interface ClassificationRuleOption {
  targetKind: "app" | "site";
  targetValue: string;
  matchScope?: "surface" | "detail";
  detailKind?: "title" | "windowTitle" | "siteTitle" | "youtubeTitle" | "siteUrl" | null;
  detailValue?: string | null;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  enabled?: boolean;
  confidence?: number | null;
}

export interface ClassificationOptions {
  fallbackCandidates?: ActivitySegment[];
  includeAiClassifications?: boolean;
  rules?: ClassificationRuleOption[];
}

export interface ActivitySegment {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  appName: string;
  bundleId?: string | null;
  windowTitle?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  siteUrl?: string | null;
  youtubeVideoId?: string | null;
  youtubePlaylistId?: string | null;
  youtubeIsShorts?: boolean | null;
  youtubeCategory?: string | null;
  youtubeChannelId?: string | null;
  youtubeChannelName?: string | null;
  youtubeTitle?: string | null;
  youtubeDescription?: string | null;
  youtubeKeywords?: string[] | null;
  youtubeDurationSeconds?: number | null;
  youtubeViewCount?: number | null;
  youtubeIsLive?: boolean | null;
  youtubeIsUnlisted?: boolean | null;
  youtubePublishDate?: string | null;
  youtubeUploadDate?: string | null;
  siteSource?: SiteSource;
  browserAutomationStatus?: BrowserAutomationStatus | null;
  browserAutomationError?: string | null;
  browserHistoryStatus?: BrowserHistoryStatus | null;
  browserHistoryReason?: string | null;
  browserHistoryDatabaseFound?: boolean | null;
  browserHistoryProfileCount?: number | null;
  browserHistoryCandidateCount?: number | null;
  browserHistoryErrorCount?: number | null;
  frontmostCaptureSource?: FrontmostCaptureSource | null;
  frontmostCaptureError?: string | null;
  frontmostFallbackError?: string | null;
  platform: "macos" | "windows" | "android" | "ios";
  source: TrackerSource;
  confidence?: number | null;
  /** cloud_devices.id of the originating Mac; null/absent = recorded on this Mac. */
  deviceId?: string | null;
  classification?: StoredActivityClassification | null;
}

export function isBrowserHistoryImportSegment(segment: Pick<ActivitySegment, "siteSource" | "source">): boolean {
  return segment.source === "browser-history-import" || segment.siteSource === "browser-history-import";
}

/**
 * Segments pulled from another synced Mac. They render in the merged timeline
 * but stay out of anything this device publishes (leaderboard, focus card) —
 * the originating device publishes its own segments.
 */
export function isRemoteDeviceSegment(segment: Pick<ActivitySegment, "deviceId">): boolean {
  return segment.deviceId != null && segment.deviceId !== "";
}

/** "all" = merged timeline, "local" = this Mac only, otherwise a cloud device id. */
export type DeviceTimelineFilter = "all" | "local" | (string & {});

export function filterSegmentsByDevice<T extends Pick<ActivitySegment, "deviceId">>(
  segments: readonly T[],
  filter: DeviceTimelineFilter,
): T[] {
  if (filter === "all") return segments.slice();
  if (filter === "local") return segments.filter((segment) => !isRemoteDeviceSegment(segment));
  return segments.filter((segment) => segment.deviceId === filter);
}

export interface CurrentActivitySnapshot {
  observedAt: string;
  appName: string;
  bundleId?: string | null;
  windowTitle?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  siteUrl?: string | null;
  youtubeVideoId?: string | null;
  youtubePlaylistId?: string | null;
  youtubeIsShorts?: boolean | null;
  siteSource?: SiteSource;
  captureConfidence?: number | null;
  browserAutomationStatus?: BrowserAutomationStatus | null;
  browserAutomationError?: string | null;
  browserHistoryStatus?: BrowserHistoryStatus | null;
  browserHistoryReason?: string | null;
  browserHistoryDatabaseFound?: boolean | null;
  browserHistoryProfileCount?: number | null;
  browserHistoryCandidateCount?: number | null;
  browserHistoryErrorCount?: number | null;
  systemTransientActivity?: SystemTransientActivity;
  frontmostCaptureSource?: FrontmostCaptureSource | null;
  frontmostCaptureError?: string | null;
  frontmostFallbackError?: string | null;
  source: TrackerSource;
}

export interface TrackerStatus {
  running?: boolean;
  isRunning?: boolean;
  accessibilityGranted: boolean;
  lastEventAt?: string | null;
  databasePath?: string | null;
  dbPath?: string | null;
  trackerMode?: string | null;
  idleSeconds?: number | null;
  idleDetectionAvailable?: boolean | null;
  message?: string | null;
}

export interface HourBucket {
  hour: string;
  totalSeconds: number;
  appBreakdown: Array<{
    appName: string;
    totalSeconds: number;
  }>;
}

export interface HourlyBucket {
  hourLabel: string;
  durationSeconds: number;
  topApps?: Array<{
    appName: string;
    durationSeconds: number;
  }>;
}

export interface SiteDuration {
  siteDomain: string;
  totalSeconds: number;
  visits: number;
  browserName?: string | null;
  siteTitle?: string | null;
}

export interface FlowBlock {
  id: string;
  day: string;
  hour: number;
  quarter: number;
  minuteOfDay: number;
  appName: string;
  bundleId?: string | null;
  windowTitle?: string | null;
  browserName?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  siteUrl?: string | null;
  youtubeVideoId?: string | null;
  youtubePlaylistId?: string | null;
  youtubeIsShorts?: boolean | null;
  youtubeCategory?: string | null;
  youtubeChannelId?: string | null;
  youtubeChannelName?: string | null;
  youtubeTitle?: string | null;
  youtubeDescription?: string | null;
  youtubeKeywords?: string[] | null;
  youtubeDurationSeconds?: number | null;
  youtubeViewCount?: number | null;
  youtubeIsLive?: boolean | null;
  youtubeIsUnlisted?: boolean | null;
  youtubePublishDate?: string | null;
  youtubeUploadDate?: string | null;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  sourceProductivity?: ProductivityLabel | null;
  productivityBasis?: ProductivityBasis | null;
  classificationSource?: string | null;
  aiClassification?: boolean | null;
  aiCachedClassification?: boolean | null;
  classificationReason?: string | null;
  projectId?: string | null;
  projectColor?: string | null;
  /** Originating cloud device id when the winning segment came from another synced Mac. */
  deviceId?: string | null;
  colorKey: string;
  durationSeconds: number;
}

export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
