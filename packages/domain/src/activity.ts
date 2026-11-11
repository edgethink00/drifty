import type { BrowserContentContext } from "./browserContentContext";
import type { AdaptiveContentContext } from "./adaptiveContentContext";
import { isLiveCustomActivityCategory, type LiveCustomActivityCategory } from "./liveClassificationPolicy";

export type TrackerSource = "nsworkspace" | "accessibility" | "win32-foreground" | "win32-foreground-untitled" | "manual" | "browser-history-import" | "unknown";
export type SiteSource = "applescript" | "applescript-front-window" | "accessibility-address-bar" | "browser-history-title" | "browser-history-import" | "windows-uia-document" | "browser-extension" | "window-title" | "unknown" | null;
export type BrowserAutomationStatus = "granted" | "denied" | "unavailable" | "stale" | "empty_result" | "not_applicable";
export type BrowserHistoryStatus = "unsupported" | "no_profile_root" | "no_readable_database" | "no_match" | "matched";
export type SystemTransientActivity = "mission_control" | "app_switcher" | "launchpad" | "spotlight" | "system_overlay" | null;
export type FrontmostCaptureSource = "system-events" | "lsappinfo" | "nsworkspace" | "win32-foreground" | "uwp-frame-host" | "unavailable";
// Which mechanism produced windowTitle: the frontmost System Events pass, or
// the browser automation pass that reads the tab and its window title
// together. Absent when the capture never got a title.
export type WindowTitleSource = "system-events" | "browser-accessibility";
export const FLOW_INTERVAL_OPTIONS = [3, 4, 5, 6] as const;
export type FlowIntervalMinutes = typeof FLOW_INTERVAL_OPTIONS[number];
export type ProductivityLabel = "focus" | "neutral" | "drift";
export type ProductivityBasis = "direct" | "contextual";
/** Drifty's own categories; their keys never change. */
export type BuiltInActivityCategory =
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

/** A category the user added in the category editor; its id never changes once created. */
export type CustomActivityCategory = LiveCustomActivityCategory;

export type ActivityCategory = BuiltInActivityCategory | CustomActivityCategory;

export function isCustomActivityCategory(value: unknown): value is CustomActivityCategory {
  return isLiveCustomActivityCategory(value);
}

/**
 * The category as the shared classification policy knows it. A user-added
 * category has no built-in meaning there (no shopping or drift heuristics), so
 * policy guards, learning feedback, and evidence see it as unknown.
 */
export function builtInCategoryOrUnknown(category: ActivityCategory): BuiltInActivityCategory {
  return isCustomActivityCategory(category) ? "unknown" : category;
}

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
  /** Local DTO meaning for a rule snapshot received from another device; not proof of user authorship. */
  ruleSnapshotKind?: "synced-rule" | null;
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
  /**
   * Controls built-in app/domain/YouTube semantic heuristics for activity that
   * does not already have an authoritative stored or user-rule result.
   */
  includeBuiltInHeuristics?: boolean;
  /**
   * When set, built-in heuristics remain available for earlier history but are
   * disabled for activity captured at or after this availability cutoff.
   */
  builtInHeuristicsUnavailableSince?: string | null;
  rules?: ClassificationRuleOption[];
  /**
   * Productivity the user fixed for a category in Settings. It applies to AI,
   * stored, and built-in results but never overrides a manual correction or a
   * user rule, which already carry the user's explicit productivity.
   */
  categoryProductivity?: Readonly<Partial<Record<ActivityCategory, ProductivityLabel>>>;
  /**
   * Categories the user deleted, with the time each was deleted. Activity that
   * starts at or after that time is not filed under it (it resolves as
   * unclassified so the classifier picks another category), while earlier
   * records keep it. A manual correction still wins.
   */
  deletedCategories?: Readonly<Partial<Record<ActivityCategory, string>>>;
}

export interface ActivitySegment {
  id: string;
  /** Monotonic local row revision. Absent on preview, legacy, and non-tracker payloads. */
  revision?: number;
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
  adaptiveContentContext?: AdaptiveContentContext | null;
  browserContentContext?: BrowserContentContext | null;
  frontmostCaptureSource?: FrontmostCaptureSource | null;
  frontmostCaptureError?: string | null;
  frontmostFallbackError?: string | null;
  windowTitleSource?: WindowTitleSource | null;
  platform: "macos" | "windows" | "android" | "ios";
  source: TrackerSource;
  /** Local capture support only; foreground audio never proves productivity or attention. */
  engagementEvidence?: "foreground-audio" | null;
  confidence?: number | null;
  exclusionSource?: ExclusionSource | null;
  /** cloud_devices.id of the originating Mac; null/absent = recorded on this Mac. */
  deviceId?: string | null;
  classification?: StoredActivityClassification | null;
}

/** Older Windows builds persisted failed foreground or process-identity reads as activity. */
export function isFailedForegroundCaptureSegment(
  segment: Pick<ActivitySegment, "platform" | "appName" | "bundleId" | "source">,
): boolean {
  return segment.platform === "windows"
    && segment.appName === "Unavailable"
    && !segment.bundleId
    && (segment.source === "unknown"
      || segment.source === "win32-foreground"
      || segment.source === "win32-foreground-untitled");
}

export function isBrowserHistoryImportSegment(segment: Pick<ActivitySegment, "siteSource" | "source">): boolean {
  return segment.source === "browser-history-import" || segment.siteSource === "browser-history-import";
}

export function isPassiveSupportedSegment(segment: Pick<ActivitySegment, "engagementEvidence">): boolean {
  return segment.engagementEvidence === "foreground-audio";
}

/**
 * Segments pulled from another synced Mac. They render in the merged timeline
 * but stay out of anything this device publishes (leaderboard, focus card) —
 * the originating device publishes its own segments.
 */
export function isRemoteDeviceSegment(segment: Pick<ActivitySegment, "deviceId">): boolean {
  return segment.deviceId != null && segment.deviceId !== "";
}

export type ExclusionSource = "default" | "user";

export const REDACTED_APP_NAME = "[Redacted]";

export interface ExcludedAppRule {
  readonly id: string;
  readonly name: string;
  readonly bundleId?: string | null;
  readonly source: ExclusionSource;
  readonly tombstone?: boolean;
  readonly updatedAt?: string;
  readonly createdAt?: string;
  /** "site" for a site rule, whose id is `site:<domain>`; older trackers omit it. */
  readonly kind?: "app" | "site";
}

/**
 * A site the user keeps out of history shares the excluded-app list (and its
 * account sync) under this id prefix, e.g. "site:kbstar.com".
 */
export const EXCLUDED_SITE_RULE_PREFIX = "site:";

export function isExcludedSiteRule(rule: Pick<ExcludedAppRule, "id" | "kind">): boolean {
  return rule.kind === "site" || rule.id.startsWith(EXCLUDED_SITE_RULE_PREFIX);
}

const EXCLUDED_SITE_LABEL = /^[a-z0-9\u00a1-\uffff](?:[a-z0-9\u00a1-\uffff-]*[a-z0-9\u00a1-\uffff])?$/u;

/**
 * The bare host a site rule stores: lowercased, without scheme, path, port or a
 * leading "www.", with a non-ASCII host in punycode. Null when the text cannot
 * name a site. Mirrors the tracker's normalize_excluded_site so the settings
 * list shows what is saved.
 */
export function normalizeExcludedSite(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return null;
  let host: string;
  try {
    host = new URL(text.includes("://") ? text : `http://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^\.+|\.+$/gu, "");
  if (host.startsWith("www.")) host = host.slice(4);
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => EXCLUDED_SITE_LABEL.test(label))) return null;
  return host;
}

/** Second-level labels that, under a two-letter country code, name a registry rather than a site: co.kr, go.kr, co.uk, com.au. */
const COUNTRY_SECOND_LEVEL_LABELS = new Set(["ac", "co", "com", "edu", "go", "gov", "ne", "net", "or", "org", "re", "pe", "mil", "ltd", "plc", "nhs", "gen", "biz", "info", "sch", "police"]);

/** Shared hosts where each subdomain is a different owner's site, so the subdomain itself is the site. */
const SHARED_HOST_SUFFIXES = ["github.io", "gitlab.io", "pages.dev", "vercel.app", "netlify.app", "web.app", "firebaseapp.com", "herokuapp.com", "blogspot.com", "notion.site", "tistory.com", "wordpress.com"];

/**
 * The site that "don't record this site" saves for a recorded host. A bank
 * visited at obank.kbstar.com is kbstar.com, so the rule also covers its other
 * addresses (www.kbstar.com, banking.kbstar.com). Keeps one more label under
 * a country registry (hometax.go.kr, bbc.co.uk) and on shared hosts where each
 * subdomain is someone else's site (me.github.io). Null when the host names no
 * site.
 */
export function suggestedExcludedSite(host: string | null | undefined): string | null {
  const normalized = normalizeExcludedSite(host);
  if (!normalized) return null;
  const shared = SHARED_HOST_SUFFIXES.find((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
  if (shared) {
    if (normalized === shared) return normalized;
    const extra = normalized.slice(0, -(shared.length + 1)).split(".");
    return `${extra[extra.length - 1]}.${shared}`;
  }
  const labels = normalized.split(".");
  if (labels.length <= 2) return normalized;
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const keep = tld.length === 2 && COUNTRY_SECOND_LEVEL_LABELS.has(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export const DEFAULT_EXCLUDED_APPS: readonly ExcludedAppRule[] = [
  { id: "com.1password.1password", name: "1Password", bundleId: "com.1password.1password", source: "default" },
  { id: "com.authy.authy-mac", name: "Authy", bundleId: "com.authy.authy-mac", source: "default" },
  { id: "com.bitwarden.desktop", name: "Bitwarden", bundleId: "com.bitwarden.desktop", source: "default" },
  { id: "com.dashlane.dashlanephone6", name: "Dashlane", bundleId: "com.dashlane.dashlanephone6", source: "default" },
  { id: "in.sinew.Enpass-Desktop", name: "Enpass", bundleId: "in.sinew.Enpass-Desktop", source: "default" },
  { id: "com.keepersecurity.passwordmanager", name: "Keeper", bundleId: "com.keepersecurity.passwordmanager", source: "default" },
  { id: "org.keepassxc.keepassxc", name: "KeePassXC", bundleId: "org.keepassxc.keepassxc", source: "default" },
  { id: "com.apple.keychainaccess", name: "Keychain Access", bundleId: "com.apple.keychainaccess", source: "default" },
  { id: "com.lastpass.LastPass", name: "LastPass", bundleId: "com.lastpass.LastPass", source: "default" },
  { id: "com.ledger.live", name: "Ledger Live", bundleId: "com.ledger.live", source: "default" },
  { id: "com.nordpass.osx", name: "NordPass", bundleId: "com.nordpass.osx", source: "default" },
  { id: "com.apple.Passwords", name: "Passwords", bundleId: "com.apple.Passwords", source: "default" },
  { id: "ch.protonpass.mac", name: "Proton Pass", bundleId: "ch.protonpass.mac", source: "default" },
  { id: "com.outercorner.Secrets2", name: "Secrets", bundleId: "com.outercorner.Secrets2", source: "default" },
  { id: "io.trezor.suite", name: "Trezor Suite", bundleId: "io.trezor.suite", source: "default" },
  { id: "com.yubico.authenticator", name: "Yubico Authenticator", bundleId: "com.yubico.authenticator", source: "default" },
];

export function isExcludedSegment(
  segment: { readonly exclusionSource?: ExclusionSource | null; readonly appName?: string | null }
): boolean {
  return segment.exclusionSource != null || segment.appName === REDACTED_APP_NAME;
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
  windowTitleSource?: WindowTitleSource | null;
  source: TrackerSource;
}

export interface TrackerStatus {
  running?: boolean;
  isRunning?: boolean;
  trackingPaused?: boolean;
  accessibilityGranted: boolean;
  lastEventAt?: string | null;
  databasePath?: string | null;
  dbPath?: string | null;
  trackerMode?: string | null;
  idleSeconds?: number | null;
  idleDetectionAvailable?: boolean | null;
  /** Bytes available on the tracker database's volume; null when unknown. */
  storageFreeBytes?: number | null;
  /** The expected local database could not be verified; worker activity is unknown. */
  statusIssue?: "databaseUnavailable";
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
  /** Full captured records contributing to the winning visual bucket. The same
   *  record can contribute to adjacent buckets, so grouped UI must de-duplicate. */
  sourceSegmentIds?: readonly string[];
  /** Every app/site that contributed tracked seconds to this bucket, winner first
   *  and then by descending seconds. The cell only paints the winner, so grouped UI
   *  uses this to explain what else filled the cell (and what would surface if the
   *  winner's records were removed). */
  composition?: readonly FlowBlockContribution[];
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

/** One app/site's accumulated share of a single flow-chart bucket. */
export interface FlowBlockContribution {
  /** `siteDomain || appName` — the same key the bucket winner rule groups by. */
  colorKey: string;
  appName: string;
  bundleId: string | null;
  browserName: string | null;
  siteDomain: string | null;
  siteTitle: string | null;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  durationSeconds: number;
  /** Captured records behind this contribution within the bucket. */
  sourceSegmentIds: readonly string[];
}

export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
