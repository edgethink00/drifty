import type { ActivityCategory, ActivitySegment, CurrentActivitySnapshot, ExcludedAppRule, HourBucket, ProductivityLabel, SiteDuration, StoredClassificationSource, TrackerStatus } from "./activity";
import type { AdaptiveContextSourceFamily } from "./adaptiveContentContext";
import type { ProjectPassWindowSegmentOverlap } from "./projectPassWindow";
import type { ActivityBlockLabelRecord, ActivityBlockUserLabelInput } from "./activityBlockLabels";
import type { ActivityTimelineWindowRecord, ActivityTimelineWindowSaveInput, ActivityTimelineWindowSaveResult } from "./activityTimelineCards";

export const trackerInvokeCommands = [
  "tracker_get_status",
  "tracker_start",
  "tracker_stop",
  "tracker_get_timeline",
  "tracker_get_timeline_page",
  "tracker_search_timeline",
  "tracker_get_dashboard_week_timeline",
  "tracker_get_project_trend_timeline",
  "tracker_get_live_tail",
  "tracker_get_current_snapshot",
  "tracker_get_hourly_summary",
  "tracker_get_raw_events",
  "tracker_get_top_sites",
  "tracker_set_developer_diagnostics",
  "tracker_set_capture_policy",
  "tracker_get_app_icons",
  "tracker_get_site_icons",
  "tracker_clear_icon_caches",
  "tracker_get_unclassified_segments",
  "tracker_get_reusable_ai_classifications",
  "tracker_get_classification_rules",
  "tracker_save_classification_rule",
  "tracker_delete_classification_rule",
  "tracker_get_excluded_apps",
  "tracker_save_excluded_app",
  "tracker_delete_excluded_app",
  "tracker_get_excluded_app_history_count",
  "tracker_delete_excluded_app_history",
  "tracker_get_recent_apps",
  "tracker_delete_activity_segments",
  "tracker_delete_history_range",
  "tracker_search_classification_rule_candidates",
  "tracker_preview_classification_rule",
  "tracker_apply_classification_rules",
  "tracker_save_classifications",
  "tracker_refresh_non_ai_classifications",
  "tracker_get_classification_metrics",
  "tracker_get_projects",
  "tracker_get_dev_signals",
  "tracker_get_agent_concurrency_peak",
  "tracker_get_dev_repos",
  "tracker_sync_dev_signals",
  "tracker_list_ssh_agent_sources",
  "tracker_test_ssh_agent_source",
  "tracker_collect_ssh_agent_source",
  "tracker_save_project",
  "tracker_delete_project",
  "tracker_save_project_anchors",
  "tracker_delete_project_anchor",
  "tracker_save_project_assignments",
  "tracker_get_project_assignments",
  "tracker_save_project_window_assignments",
  "tracker_get_project_window_assignments",
  "tracker_get_activity_block_labels",
  "tracker_get_activity_timeline_cards",
  "tracker_save_activity_timeline_window",
  "tracker_save_activity_block_user_label",
  "tracker_delete_activity_block_user_label",
  "tracker_get_team_projects",
  "tracker_upsert_team_projects",
  "tracker_save_team_project_assignments",
  "tracker_get_team_project_assignments",
  "tracker_record_project_pass",
  "tracker_get_project_pass_runs",
  "tracker_save_ai_review_events",
  "tracker_get_ai_review_events",
  "tracker_revert_ai_review_event",
  "tracker_preview_browser_history_import",
  "tracker_import_browser_history",
  "tracker_get_browser_history_environment",
  "tracker_get_sync_outbox",
  "tracker_get_sync_state",
  "tracker_set_sync_state",
  "tracker_set_team_pause_lock",
  "tracker_apply_synced_definition",
  "tracker_apply_synced_segments",
  "tracker_get_pending_sync_deletions",
  "tracker_mark_sync_deletions_pushed",
  "tracker_apply_synced_deletions",
  "tracker_purge_remote_segments",
] as const;
export const trayInvokeCommands = [
  "tray_update_productivity_icon",
  "tray_update_icon_style",
  "tray_update_display_mode",
  "tray_update_drift_alarm_status",
  "tray_set_language",
  "tray_update_trial_status",
] as const;

export const trackerClientInvokeCommands = [
  ...trackerInvokeCommands,
  ...trayInvokeCommands,
] as const;


export type TrackerCommandMap = {
  tracker_get_status: { args: undefined; result: Record<string, unknown> };
  tracker_start: { args: { resumePaused?: boolean } | undefined; result: Record<string, unknown> };
  tracker_stop: { args: undefined; result: Record<string, unknown> };
  tracker_get_timeline: { args: { query: TimelineQuery }; result: ActivitySegment[] };
  tracker_get_timeline_page: { args: { query: TimelinePageQuery }; result: TimelinePage };
  tracker_search_timeline: { args: { query: TimelineSearchQuery }; result: TimelinePage };
  tracker_get_dashboard_week_timeline: { args: { query: DateRangeQuery }; result: ActivitySegment[] };
  tracker_get_project_trend_timeline: { args: { query: DateRangeQuery }; result: ActivitySegment[] };
  tracker_get_live_tail: { args: { query: LiveTailQuery }; result: TrackerLiveTail };
  tracker_get_current_snapshot: { args: undefined; result: CurrentActivitySnapshot | null };
  tracker_get_hourly_summary: { args: { query: TimelineQuery }; result: HourlySummaryWireBucket[] };
  tracker_get_raw_events: { args: { query: RawEventsQuery }; result: ActivitySegment[] };
  tracker_get_top_sites: { args: { query: TopSitesQuery }; result: SiteDuration[] };
  tracker_set_developer_diagnostics: { args: { query: DeveloperDiagnosticsSettings }; result: unknown };
  tracker_set_capture_policy: { args: { query: CapturePolicyPayload }; result: unknown };
  tracker_get_app_icons: { args: { query: { apps: AppIdentity[] } }; result: AppIconMap };
  tracker_get_site_icons: {
    args: { query: { domains: string[]; cachedOnly?: boolean } };
    result: Readonly<Record<string, string | null>>;
  };
  tracker_clear_icon_caches: { args: undefined; result: { reclaimedBytes: number } };
  tracker_get_unclassified_segments: { args: { query: UnclassifiedSegmentsQuery }; result: ActivitySegment[] };
  tracker_get_reusable_ai_classifications: {
    args: { query: { inputFingerprints: string[] } };
    result: Record<string, ActivityClassificationRecord>;
  };
  tracker_get_classification_rules: { args: undefined; result: ClassificationRule[] };
  tracker_save_classification_rule: { args: { query: { input: ClassificationRuleInput } }; result: ClassificationRule };
  tracker_delete_classification_rule: { args: { query: { id: string } }; result: { deleted: number } };
  tracker_get_excluded_apps: { args: { query?: { includeTombstones?: boolean } }; result: ExcludedAppRule[] };
  tracker_save_excluded_app: { args: { query: ExcludedAppRule }; result: ExcludedAppRule };
  tracker_delete_excluded_app: { args: { query: { id: string } }; result: { deleted: boolean } };
  tracker_get_excluded_app_history_count: { args: { query: { name: string; bundleId?: string | null; siteDomain?: string | null } }; result: { count: number } };
  tracker_delete_excluded_app_history: { args: { query: { name: string; bundleId?: string | null; siteDomain?: string | null } }; result: { deleted: number } };
  tracker_get_recent_apps: { args: { query?: { limit?: number } }; result: Array<{ name: string; bundleId: string | null; lastSeenAt: string; totalSeconds: number }> };
  tracker_delete_activity_segments: { args: { query: { ids: readonly string[] } }; result: { deleted: number } };
  tracker_delete_history_range: { args: { query: DeleteHistoryRangeQuery }; result: DeleteHistoryRangeResult };
  tracker_search_classification_rule_candidates: {
    args: { query: ClassificationRuleCandidateQuery };
    result: ClassificationRuleCandidate[];
  };
  tracker_preview_classification_rule: {
    args: { query: { input: ClassificationRuleInput } };
    result: ClassificationRulePreview;
  };
  tracker_apply_classification_rules: {
    args: { query: ClassificationQuery | undefined };
    result: ClassificationRuleApplyResult;
  };
  tracker_save_classifications: {
    args: { query: { classifications: ActivityClassificationRecord[] } };
    result: { saved: number };
  };
  tracker_refresh_non_ai_classifications: { args: { query: ClassificationQuery }; result: { deleted: number } };
  tracker_get_classification_metrics: { args: { query: ClassificationQuery }; result: ClassificationMetrics };
  tracker_get_projects: { args: undefined; result: Project[] };
  tracker_get_dev_signals: { args: DevSignalsQueryArgs; result: DevSignalsDayPayload };
  tracker_get_agent_concurrency_peak: { args: DevSignalsQueryArgs; result: AgentConcurrencyPeakPayload };
  tracker_get_dev_repos: { args: undefined; result: { repos: DevRepoRecord[] } };
  tracker_sync_dev_signals: { args: DevSignalsSyncArgs; result: DevSignalsSyncResult };
  tracker_list_ssh_agent_sources: { args: undefined; result: SshAgentSourceListResult };
  tracker_test_ssh_agent_source: { args: SshAgentSourceTestArgs; result: SshAgentSourceTestResult };
  tracker_collect_ssh_agent_source: { args: SshAgentSourceCollectArgs; result: SshAgentSourceCollectResult };
  tracker_save_project: { args: { query: { input: ProjectInput } }; result: Project };
  tracker_delete_project: { args: { query: { id: string } }; result: { deleted: number } };
  tracker_save_project_anchors: {
    args: { query: { projectId: string; anchors: ProjectAnchor[] } };
    result: ProjectAnchor[];
  };
  tracker_delete_project_anchor: {
    args: { query: { projectId: string; kind: ProjectAnchorKind; value: string } };
    result: { deleted: number };
  };
  tracker_save_project_assignments: {
    args: { query: { assignments: ProjectAssignmentRecord[] } };
    result: ProjectAssignmentsSaveResult;
  };
  tracker_get_project_assignments: { args: { query: TimelineQuery }; result: ProjectAssignmentRecord[] };
  tracker_save_project_window_assignments: {
    args: { query: { assignments: ProjectWindowAssignmentRecord[] } };
    result: ProjectAssignmentsSaveResult;
  };
  tracker_get_project_window_assignments: { args: { query: TimelineQuery }; result: ProjectWindowAssignmentRecord[] };
  tracker_get_activity_block_labels: { args: { query: TimelineQuery }; result: ActivityBlockLabelRecord[] };
  tracker_get_activity_timeline_cards: { args: { query: TimelineQuery }; result: ActivityTimelineWindowRecord[] };
  tracker_save_activity_timeline_window: {
    args: { query: { window: ActivityTimelineWindowSaveInput } };
    result: ActivityTimelineWindowSaveResult;
  };
  tracker_save_activity_block_user_label: {
    args: { query: { label: ActivityBlockUserLabelInput; previousBlockKey?: string | null } };
    result: ActivityBlockLabelRecord;
  };
  tracker_delete_activity_block_user_label: { args: { query: { blockKey: string } }; result: { deleted: number } };
  tracker_get_team_projects: { args: undefined; result: TeamProject[] };
  tracker_upsert_team_projects: {
    args: { query: { organizationId: string; projects: TeamProjectInput[] } };
    result: TeamProject[];
  };
  tracker_save_team_project_assignments: {
    args: { query: { assignments: TeamProjectAssignmentRecord[] } };
    result: ProjectAssignmentsSaveResult;
  };
  tracker_get_team_project_assignments: { args: { query: TimelineQuery }; result: TeamProjectAssignmentRecord[] };
  tracker_record_project_pass: { args: { query: { input: ProjectPassRunInput } }; result: ProjectPassRunRecord };
  tracker_get_project_pass_runs: { args: { query: TimelineQuery }; result: ProjectPassRun[] };
  tracker_save_ai_review_events: { args: { query: { events: AiReviewEventInput[] } }; result: { saved: number } };
  tracker_get_ai_review_events: { args: { query: TimelineQuery }; result: AiReviewEvent[] };
  tracker_revert_ai_review_event: { args: { query: { id: number } }; result: AiReviewEventRevertResult };
  tracker_preview_browser_history_import: {
    args: { query: BrowserHistoryImportQuery };
    result: BrowserHistoryImportPreview;
  };
  tracker_import_browser_history: { args: { query: BrowserHistoryImportQuery }; result: BrowserHistoryImportResult };
  tracker_get_browser_history_environment: { args: undefined; result: BrowserHistoryEnvironment };
  tracker_get_sync_outbox: { args: { query: SyncOutboxQuery }; result: SyncOutboxPage };
  tracker_get_sync_state: { args: undefined; result: SyncStateSnapshot };
  tracker_set_sync_state: { args: { query: { entries: Record<string, string | null> } }; result: { written: number } };
  /** Spans (Unix seconds) when a managed team keeps its member from pausing; an empty list lifts the lock. */
  tracker_set_team_pause_lock: { args: { spans: readonly { readonly teamName: string; readonly startsAt: number; readonly endsAt: number }[] }; result: null };
  tracker_apply_synced_definition: { args: { query: { input: SyncedDefinitionInput } }; result: SyncedDefinitionResult };
  tracker_apply_synced_segments: { args: { query: { segments: SyncedSegmentInput[] } }; result: SyncApplyResult };
  tracker_get_pending_sync_deletions: {
    args: { query: { limit?: number } };
    result: SyncDeletionRecord[];
  };
  tracker_mark_sync_deletions_pushed: {
    args: { query: { deletionUids: readonly string[] } };
    result: { marked: number };
  };
  tracker_apply_synced_deletions: {
    args: { query: { deletions: SyncDeletionRecord[] } };
    result: SyncDeletionsApplyResult;
  };
  tracker_purge_remote_segments: { args: undefined; result: { purged: number } };
};

export type TrayCommandMap = {
  tray_update_productivity_icon: {
    args: { focus: number; drift: number; neutral: number };
    result: void;
  };
  tray_update_icon_style: { args: { style: TrayIconStyle }; result: void };
  tray_update_display_mode: {
    args: { mode: TrayDisplayMode; focusSeconds: number };
    result: void;
  };
  tray_update_drift_alarm_status: { args: { status: DriftAlarmTrayStatus }; result: void };
  tray_set_language: { args: { language: string }; result: void };
  tray_update_trial_status: { args: { trialEndsAt: string | null; trialExpired: boolean }; result: void };
};

export type TrackerCommand = keyof TrackerCommandMap;
export type TrayCommand = keyof TrayCommandMap;
export type TrackerClientCommandMap = TrackerCommandMap & TrayCommandMap;
export type TrackerClientCommand = keyof TrackerClientCommandMap;

export type TrackerCommandArgs<C extends TrackerCommand> = TrackerCommandMap[C]["args"];
export type TrackerCommandResult<C extends TrackerCommand> = TrackerCommandMap[C]["result"];
export type TrayCommandArgs<C extends TrayCommand> = TrayCommandMap[C]["args"];
export type TrayCommandResult<C extends TrayCommand> = TrayCommandMap[C]["result"];
export type TrackerClientCommandArgs<C extends TrackerClientCommand> = TrackerClientCommandMap[C]["args"];
export type TrackerClientCommandResult<C extends TrackerClientCommand> = TrackerClientCommandMap[C]["result"];
export type TrackerClientInvoke = <C extends TrackerClientCommand>(
  command: C,
  ...args: TrackerClientCommandArgs<C> extends undefined ? [] : [args: TrackerClientCommandArgs<C>]
) => Promise<TrackerClientCommandResult<C> | null>;

type ExactCommandRegistry<Commands extends readonly string[], CommandMap> =
  Exclude<Commands[number], keyof CommandMap> extends never
    ? Exclude<keyof CommandMap, Commands[number]> extends never
      ? true
      : false
    : false;

type Assert<T extends true> = T;

type TrackerCommandRegistryIsExact = Assert<ExactCommandRegistry<typeof trackerInvokeCommands, TrackerCommandMap>>;
type TrayCommandRegistryIsExact = Assert<ExactCommandRegistry<typeof trayInvokeCommands, TrayCommandMap>>;
type TrackerClientCommandRegistryIsExact = Assert<
  ExactCommandRegistry<typeof trackerClientInvokeCommands, TrackerClientCommandMap>
>;

export interface DayQuery {
  day: string;
}

export interface DateRangeQuery {
  start: string;
  end: string;
}

export type TimelineQuery = DayQuery | DateRangeQuery;

/** Flat args for tracker_get_dev_signals: the Rust command takes day/start/end directly. */
export type DevSignalsQueryArgs = {
  day?: string;
  start?: string;
  end?: string;
};

export type DevSignalsSyncArgs = {
  backfillDays?: number;
};

export interface AgentConcurrencyPeakPayload {
  peak: number;
}

export interface DevCommitEvent {
  repoKey: string;
  commitSha: string;
  authoredAt: string;
  insertions: number;
  deletions: number;
  filesChanged: number;
}

export interface AgentSessionTurnEvent {
  provider: string;
  sessionKey: string;
  turnIndex: number;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  cwdKey: string | null;
  model: string | null;
  totalTokens: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  tokensCacheRead?: number | null;
  tokensCacheWrite?: number | null;
  costUsd?: number | null;
}

export interface AgentTimeSummaryPayload {
  /** Real time with at least one agent working. Comparable to attention time. */
  wallClockSeconds: number;
  /** Sum across concurrent sessions. Never compared to attention time. */
  cumulativeSeconds: number;
  concurrencyPeak: number;
  parallelFactor: number;
  spans: { start: string; end: string }[];
}

export interface DevSignalsDayPayload {
  commits: DevCommitEvent[];
  agentTurns: AgentSessionTurnEvent[];
  agentSummary: AgentTimeSummaryPayload;
}

export interface DevSignalsSyncResult {
  commitsIngested: number;
  agentTurnsIngested: number;
  filesScanned: number;
  skippedFiles: number;
}

export interface SshAgentSourceTestArgs {
  host: string;
}

export interface SshAgentSourceListResult {
  ok: boolean;
  code: string;
  message: string;
  aliases: string[];
}

export interface SshAgentSourceCollectArgs extends SshAgentSourceTestArgs {
  backfillDays?: number;
}

export interface SshAgentSourceTestResult {
  ok: boolean;
  code: string;
  message: string;
  host: string;
}

export interface SshAgentSourceCollectResult extends SshAgentSourceTestResult {
  providers: string[];
  turnsFound: number;
  turnsIngested: number;
  commitsFound: number;
  commitsIngested: number;
  filesScanned: number;
  truncated: boolean;
}

export interface DevRepoRecord {
  repo_key: string;
  repo_path: string;
  author_email: string | null;
  created_at: string;
}

export interface TimelinePageCursor {
  beforeEndedAt: string;
  beforeSegmentId: string;
}

export type TimelinePageSelector =
  | (DayQuery & { start?: never; end?: never })
  | (DateRangeQuery & { day?: never });

export type TimelinePageQuery = TimelinePageSelector & {
  beforeEndedAt?: string | null;
  beforeSegmentId?: string | null;
  limit?: number;
};

export type TimelineSearchQuery = TimelinePageQuery & {
  readonly query: string;
};

export interface TimelinePage {
  items: ActivitySegment[];
  hasMore: boolean;
  nextCursor: TimelinePageCursor | null;
}

export interface LiveTailQuery extends Partial<DateRangeQuery> {
  afterSegmentId?: string | null;
  afterEndedAt?: string | null;
  limit?: number;
}

export type RawEventsQuery = (DayQuery | DateRangeQuery) & {
  limit?: number;
  appName?: string;
};

export type TopSitesQuery = (DayQuery | DateRangeQuery) & {
  limit?: number;
};
export type HourlySummaryWireBucket = {
  hour?: string;
  hourLabel?: string;
  totalSeconds?: number;
  durationSeconds?: number;
  appBreakdown?: Array<{ appName: string; totalSeconds: number }>;
  topApps?: Array<{ appName: string; durationSeconds: number }>;
};

export interface AppIdentity {
  appName: string;
  bundleId?: string | null;
}

export type ClassificationRuleTargetKind = "app" | "site";
export type ClassificationRuleMatchScope = "surface" | "detail";
export type ClassificationRuleDetailKind = "title" | "windowTitle" | "siteTitle" | "youtubeTitle" | "siteUrl";

export interface ClassificationRule {
  id: string;
  targetKind: ClassificationRuleTargetKind;
  targetValue: string;
  matchScope: ClassificationRuleMatchScope;
  detailKind?: ClassificationRuleDetailKind | null;
  detailValue?: string | null;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  enabled: boolean;
  confidence?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** The rule's unique app or site key as a hash; device sync keys the account's copy by it. */
  syncKey?: string | null;
}

export interface ClassificationRuleInput {
  /** Preserve a saved rule's identity when toggling or explicitly repairing it. */
  id?: string;
  targetKind: ClassificationRuleTargetKind;
  targetValue: string;
  matchScope?: ClassificationRuleMatchScope;
  detailKind?: ClassificationRuleDetailKind | null;
  detailValue?: string | null;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  enabled?: boolean;
  confidence?: number | null;
}

export interface ClassificationRuleCandidate {
  id: string;
  targetKind: ClassificationRuleTargetKind;
  targetValue: string;
  displayName: string;
  appName?: string | null;
  bundleId?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  browserName?: string | null;
  category?: ActivityCategory | null;
  productivity?: ProductivityLabel | null;
  segmentCount: number;
  totalSeconds: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

export interface ClassificationRuleCandidateQuery {
  readonly query: string;
  readonly targetKind?: ClassificationRuleTargetKind;
}

export type DeleteHistoryRangeScopes = {
  readonly activity: boolean;
  readonly aiClassifications: boolean;
  readonly youtubeMetadata: boolean;
};

export type DeleteHistoryRangeQuery = {
  readonly start?: string;
  readonly end?: string;
  readonly scopes: DeleteHistoryRangeScopes;
  readonly dryRun?: boolean;
};

export type DeleteHistoryRangeResult = {
  readonly activitySegments: number;
  readonly classifications: number;
  readonly youtubeMetadata: number;
  readonly dryRun: boolean;
};

export interface ClassificationRuleApplyResult {
  matchedCount: number;
  appliedCount: number;
  skippedCount: number;
}

/**
 * How many records already captured on this computer a classification rule
 * would apply to, before anything is written. matchedCount equals the
 * appliedCount that saving and applying the rule produces; manual
 * classifications stay and are counted apart.
 */
export interface ClassificationRulePreview {
  matchedCount: number;
  matchedSeconds: number;
  manualCount: number;
}

export interface ActivityClassificationRecord {
  segmentId: string;
  category: ActivityCategory;
  productivity: ProductivityLabel;
  source: StoredClassificationSource;
  confidence: number;
  reason?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  taxonomyVersion?: string | null;
  inputFingerprint: string;
  requestId?: string | null;
  latencyMs?: number | null;
  aiResult?: boolean | null;
  stale?: boolean | null;
  classifiedAt?: string | null;
  /** Project review: atomically record accepted correction history and pass count. */
  reviewPassId?: number | null;
}

export interface ClassificationMetrics {
  totalSegments: number;
  classifiedSegments: number;
  unclassifiedSegments: number;
  aiClassifiedSegments: number;
  staleClassifications: number;
}

export type BrowserHistoryImportQuery = { readonly lookbackDays?: number };

export interface BrowserHistoryImportPreview {
  readonly lookbackDays: number;
  readonly candidateCount: number;
  readonly segmentCount: number;
  readonly estimatedSeconds: number;
  readonly browserCount: number;
  readonly profileCount: number;
  readonly databaseCount: number;
  readonly errorCount: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface BrowserHistoryImportResult extends BrowserHistoryImportPreview {
  readonly insertedCount: number;
  readonly skippedDuplicateCount: number;
}

/**
 * Minimized environment info for the Safari onboarding Full Disk Access row.
 * Booleans only — never carries paths, URLs, or titles (privacy rule).
 */
export interface BrowserHistoryEnvironment {
  /** True once Safari's History.db is readable (Full Disk Access granted). */
  readonly safariHistoryReadable: boolean;
  /** True when Safari is (or is the system fallback for) the default browser. */
  readonly defaultBrowserIsSafari: boolean;
}

export interface ClassificationQuery extends Partial<DateRangeQuery>, Partial<DayQuery> {
  limit?: number;
}

export interface UnclassifiedSegmentsQuery extends ClassificationQuery {
  /**
   * Optional allow-list of segment ids. When present, tracker selection is restricted to these
   * segments; an empty list returns no segments. Omitting it keeps whole-range selection behavior.
   */
  segmentIds?: readonly string[];
}

export interface ProductivityShareMix {
  focus: number;
  neutral: number;
  drift: number;
}

export type TrayIconStyle = "compact" | "expanded";
export type TrayDisplayMode = "donut" | "focusTime" | "donutFocusTime";

export interface DriftAlarmTrayStatus {
  readonly enabled: boolean;
  readonly statusLabel: string;
  readonly lastCheckedAt: string | null;
  readonly lastCheckedLabel: string;
  readonly resultLabel: string;
  readonly detailLabel: string | null;
  readonly developerDetailsEnabled?: boolean;
  readonly trackerRunning?: boolean | null;
}

export type AppIconMap = Record<string, string | null>;

export interface TrackerLiveTail {
  running: boolean;
  trackerMode?: string | null;
  lastEventAt?: string | null;
  segments: ActivitySegment[];
}

export type ProjectStatus = "active" | "archived";
export type ProjectAnchorKind = "app" | "domain" | "keyword";
export type ProjectAnchorSource = "harvested" | "manual";

export interface ProjectAnchor {
  kind: ProjectAnchorKind;
  value: string;
  source: ProjectAnchorSource;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  status: ProjectStatus;
  anchors: ProjectAnchor[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  id?: string;
  name: string;
  description: string;
  color?: string;
  status?: ProjectStatus;
  /** A project another device made keeps its creation time (device sync); ignored for an existing one. */
  createdAt?: string;
}

export type ProjectAssignmentSource = "ai" | "manual";

export interface ProjectAssignmentRecord {
  segmentId: string;
  projectId: string | null;
  source: ProjectAssignmentSource;
  confidence?: number | null;
  reason?: string | null;
  passId?: number | null;
  chunkFingerprint?: string | null;
  assignedAt?: string | null;
  stale?: boolean | null;
}

/**
 * AI project attribution at the fixed analysis-window grain. Raw activity stays
 * in activity_segments; this row stores only the local window boundary, the
 * segment overlap weights needed for projection, and the model decision.
 */
export interface ProjectWindowAssignmentRecord {
  windowId: string;
  windowStartedAt: string;
  windowEndedAt: string;
  durationSeconds: number;
  segmentOverlaps: ProjectPassWindowSegmentOverlap[];
  projectId: string | null;
  teamProjectId: string | null;
  source: "ai";
  confidence?: number | null;
  reason?: string | null;
  passId?: number | null;
  chunkFingerprint?: string | null;
  assignedAt?: string | null;
  stale?: boolean | null;
}

export interface ProjectAssignmentsSaveResult {
  saved: number;
  skippedManual: number;
}

export interface TeamProject {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  color: string;
  status: ProjectStatus;
  anchors: ProjectAnchor[];
  createdAt: string;
  updatedAt: string;
}

export interface TeamProjectInput {
  id: string;
  name: string;
  description: string;
  color?: string;
  status?: ProjectStatus;
  anchors?: ProjectAnchor[];
}

export interface TeamProjectAssignmentRecord {
  segmentId: string;
  teamProjectId: string | null;
  source: ProjectAssignmentSource;
  confidence?: number | null;
  passId?: number | null;
  chunkFingerprint?: string | null;
  assignedAt?: string | null;
  stale?: boolean | null;
}

export type ProjectPassTrigger = "schedule" | "open" | "eod" | "manual" | "backfill" | "discovery";

export interface ProjectPassRunInput {
  rangeStart: string;
  rangeEnd: string;
  trigger: ProjectPassTrigger;
  model?: string | null;
  provider?: string | null;
  runsCount?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
  assignmentsCount?: number | null;
  correctionsCount?: number | null;
  promptVersion: string;
}

export interface ProjectPassRunRecord {
  id: number;
  ranAt: string;
}

export interface ProjectPassRun {
  id: number;
  ranAt: string;
  rangeStart: string;
  rangeEnd: string;
  trigger: ProjectPassTrigger;
  model?: string | null;
  provider?: string | null;
  runsCount?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  latencyMs?: number | null;
  assignmentsCount?: number | null;
  correctionsCount?: number | null;
  promptVersion: string;
}

export interface AiReviewEventInput {
  segmentId: string;
  passId: number;
  prevCategory?: ActivityCategory | null;
  prevProductivity?: ProductivityLabel | null;
  prevSource?: StoredClassificationSource | null;
  newCategory?: ActivityCategory | null;
  newProductivity?: ProductivityLabel | null;
  confidence?: number | null;
  reason?: string | null;
}

export interface AiReviewEvent {
  id: number;
  segmentId: string;
  passId: number;
  prevCategory?: ActivityCategory | null;
  prevProductivity?: ProductivityLabel | null;
  prevSource?: StoredClassificationSource | null;
  newCategory?: ActivityCategory | null;
  newProductivity?: ProductivityLabel | null;
  confidence?: number | null;
  reason?: string | null;
  createdAt: string;
  revertedAt?: string | null;
}

export interface AiReviewEventRevertResult {
  reverted: boolean;
  restored: boolean;
}

export interface SyncOutboxClassification {
  category: string;
  productivity: string;
  source: string;
  confidence?: number | null;
  reason?: string | null;
  classifiedAt?: string | null;
}

export interface SyncOutboxSegment {
  segmentUid: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  appName: string;
  bundleId?: string | null;
  windowTitle?: string | null;
  siteDomain?: string | null;
  siteTitle?: string | null;
  siteUrl?: string | null;
  youtubeVideoId?: string | null;
  youtubePlaylistId?: string | null;
  youtubeIsShorts?: boolean | null;
  browserName?: string | null;
  siteSource?: string | null;
  platform: string;
  source: string;
  confidence?: number | null;
  syncSeq: number;
  classification?: SyncOutboxClassification | null;
  exclusionSource?: "default" | "user" | null;
}

export interface SyncOutboxPage {
  items: SyncOutboxSegment[];
  /** Highest syncSeq actually returned; the push cursor advances to this, not counterSeq. */
  batchMaxSeq: number;
  counterSeq: number;
  pendingCount: number;
}

export interface SyncStateSnapshot {
  state: Record<string, string>;
  counterSeq: number;
  pendingDeletions: number;
}

export interface SyncedSegmentInput extends Omit<SyncOutboxSegment, "syncSeq"> {
  originDeviceId: string;
}

export interface SyncApplyResult {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface SyncDeletionRecord {
  deletionUid: string;
  kind: "range" | "uids";
  rangeStart?: string | null;
  rangeEnd?: string | null;
  segmentUids?: string[] | null;
  createdAt: string;
}

export interface SyncDeletionsApplyResult {
  applied: number;
  skipped: number;
}

export interface SyncOutboxQuery {
  afterSeq: number;
  limit?: number;
  hotGraceSeconds?: number;
}

export interface TrackerApi {
  getStatus(): Promise<TrackerStatus>;
  /** Pass resumePaused only for a user action that should clear a saved pause. */
  start(options?: { resumePaused?: boolean }): Promise<TrackerStatus>;
  stop(): Promise<TrackerStatus>;
  getTimeline(query: TimelineQuery): Promise<ActivitySegment[]>;
  getTimelinePage(query: TimelinePageQuery): Promise<TimelinePage>;
  searchTimeline(query: TimelineSearchQuery): Promise<TimelinePage>;
  getDashboardWeekTimeline(query: DateRangeQuery): Promise<ActivitySegment[]>;
  /**
   * Slim multi-day segment view for the Projects tab trend chart: identity,
   * timing, and app/site labels only (attribution happens client-side against
   * project assignments). Optional so partial implementations can fall back to
   * the full getTimeline.
   */
  getProjectTrendTimeline?(query: DateRangeQuery): Promise<ActivitySegment[]>;
  getLiveTail(query: LiveTailQuery): Promise<TrackerLiveTail>;
  getCurrentSnapshot(): Promise<CurrentActivitySnapshot | null>;
  getHourlySummary(query: TimelineQuery): Promise<HourBucket[]>;
  getRawEvents(query: RawEventsQuery): Promise<ActivitySegment[]>;
  getTopSites(query: TopSitesQuery): Promise<SiteDuration[]>;
  setDeveloperDiagnostics(settings: DeveloperDiagnosticsSettings): Promise<void>;
  /** Private-window and recording-hours choices for the tracker. */
  setCapturePolicy?(policy: CapturePolicyPayload): Promise<void>;
  getAppIcons(apps: AppIdentity[]): Promise<AppIconMap>;
  /**
   * Domains the native layer did not settle are omitted from the result.
   * With `cachedOnly`, only on-disk cache entries are settled and nothing is
   * fetched from the network.
   */
  getSiteIcons(domains: string[], options?: { cachedOnly?: boolean }): Promise<Readonly<Record<string, string | null>>>;
  clearIconCaches(): Promise<{ reclaimedBytes: number }>;
  getUnclassifiedSegments(query: UnclassifiedSegmentsQuery): Promise<ActivitySegment[]>;
  getReusableAiClassifications(inputFingerprints: string[]): Promise<Record<string, ActivityClassificationRecord>>;
  getClassificationRules(): Promise<ClassificationRule[]>;
  saveClassificationRule(input: ClassificationRuleInput): Promise<ClassificationRule>;
  deleteClassificationRule(id: string): Promise<{ deleted: number }>;
  getExcludedApps(query?: { includeTombstones?: boolean }): Promise<ExcludedAppRule[]>;
  saveExcludedApp(rule: ExcludedAppRule): Promise<ExcludedAppRule>;
  deleteExcludedApp(id: string): Promise<{ deleted: boolean }>;
  getExcludedAppHistoryCount(query: { name: string; bundleId?: string | null }): Promise<{ count: number }>;
  deleteExcludedAppHistory(query: { name: string; bundleId?: string | null }): Promise<{ deleted: number }>;
  getRecentApps(query?: { limit?: number }): Promise<Array<{ name: string; bundleId: string | null; lastSeenAt: string; totalSeconds: number }>>;
  deleteActivitySegments(ids: readonly string[]): Promise<{ deleted: number }>;
  deleteHistoryRange(query: DeleteHistoryRangeQuery): Promise<DeleteHistoryRangeResult>;
  searchClassificationRuleCandidates(query: ClassificationRuleCandidateQuery): Promise<ClassificationRuleCandidate[]>;
  previewClassificationRule(input: ClassificationRuleInput): Promise<ClassificationRulePreview>;
  applyClassificationRules(query?: ClassificationQuery): Promise<ClassificationRuleApplyResult>;
  saveClassifications(classifications: ActivityClassificationRecord[]): Promise<{ saved: number }>;
  refreshNonAiClassifications(query: ClassificationQuery): Promise<{ deleted: number }>;
  getClassificationMetrics(query: ClassificationQuery): Promise<ClassificationMetrics>;
  getProjects(): Promise<Project[]>;
  getDevSignals(query: TimelineQuery): Promise<DevSignalsDayPayload | null>;
  getAgentConcurrencyPeak(query: TimelineQuery): Promise<AgentConcurrencyPeakPayload | null>;
  getDevRepos(): Promise<DevRepoRecord[]>;
  syncDevSignals(backfillDays?: number): Promise<DevSignalsSyncResult | null>;
  listSshAgentSources(): Promise<SshAgentSourceListResult>;
  testSshAgentSource(host: string): Promise<SshAgentSourceTestResult>;
  collectSshAgentSource(host: string, backfillDays?: number): Promise<SshAgentSourceCollectResult>;
  saveProject(input: ProjectInput): Promise<Project>;
  deleteProject(id: string): Promise<{ deleted: number }>;
  saveProjectAnchors(projectId: string, anchors: ProjectAnchor[]): Promise<ProjectAnchor[]>;
  deleteProjectAnchor(projectId: string, kind: ProjectAnchorKind, value: string): Promise<{ deleted: number }>;
  saveProjectAssignments(assignments: ProjectAssignmentRecord[]): Promise<ProjectAssignmentsSaveResult>;
  getProjectAssignments(query: TimelineQuery): Promise<ProjectAssignmentRecord[]>;
  saveProjectWindowAssignments(assignments: ProjectWindowAssignmentRecord[]): Promise<ProjectAssignmentsSaveResult>;
  getProjectWindowAssignments(query: TimelineQuery): Promise<ProjectWindowAssignmentRecord[]>;
  /** The user's local choices for blocks (hide a name). Optional so partial tracker implementations keep the existing display. */
  getActivityBlockLabels?(query: TimelineQuery): Promise<ActivityBlockLabelRecord[]>;
  saveActivityBlockUserLabel?(label: ActivityBlockUserLabelInput, previousBlockKey?: string | null): Promise<ActivityBlockLabelRecord>;
  deleteActivityBlockUserLabel?(blockKey: string): Promise<{ deleted: number }>;
  /** Local timeline cards: described windows with their cards. */
  getActivityTimelineCards?(query: TimelineQuery): Promise<ActivityTimelineWindowRecord[]>;
  saveActivityTimelineWindow?(window: ActivityTimelineWindowSaveInput): Promise<ActivityTimelineWindowSaveResult>;
  getTeamProjects(): Promise<TeamProject[]>;
  upsertTeamProjects(organizationId: string, projects: TeamProjectInput[]): Promise<TeamProject[]>;
  saveTeamProjectAssignments(assignments: TeamProjectAssignmentRecord[]): Promise<ProjectAssignmentsSaveResult>;
  getTeamProjectAssignments(query: TimelineQuery): Promise<TeamProjectAssignmentRecord[]>;
  recordProjectPass(input: ProjectPassRunInput): Promise<ProjectPassRunRecord>;
  getProjectPassRuns(query: TimelineQuery): Promise<ProjectPassRun[]>;
  saveAiReviewEvents(events: AiReviewEventInput[]): Promise<{ saved: number }>;
  getAiReviewEvents(query: TimelineQuery): Promise<AiReviewEvent[]>;
  revertAiReviewEvent(id: number): Promise<AiReviewEventRevertResult>;
  previewBrowserHistoryImport(query?: BrowserHistoryImportQuery): Promise<BrowserHistoryImportPreview>;
  importBrowserHistory(query?: BrowserHistoryImportQuery): Promise<BrowserHistoryImportResult>;
  getBrowserHistoryEnvironment(): Promise<BrowserHistoryEnvironment>;
  getSyncOutbox(query: SyncOutboxQuery): Promise<SyncOutboxPage>;
  getSyncState(): Promise<SyncStateSnapshot>;
  setSyncState(entries: Record<string, string | null>): Promise<{ written: number }>;
  setTeamPauseLock(spans: readonly { readonly teamName: string; readonly startsAt: number; readonly endsAt: number }[]): Promise<void>;
  applySyncedDefinition(input: SyncedDefinitionInput): Promise<SyncedDefinitionResult>;
  applySyncedSegments(segments: SyncedSegmentInput[]): Promise<SyncApplyResult>;
  getPendingSyncDeletions(limit?: number): Promise<SyncDeletionRecord[]>;
  markSyncDeletionsPushed(deletionUids: readonly string[]): Promise<{ marked: number }>;
  applySyncedDeletions(deletions: SyncDeletionRecord[]): Promise<SyncDeletionsApplyResult>;
  purgeRemoteSegments(): Promise<{ purged: number }>;
  updateTrayProductivityIcon(mix: ProductivityShareMix): Promise<void>;
  updateTrayIconStyle(style: TrayIconStyle): Promise<void>;
  updateTrayDisplayMode(mode: TrayDisplayMode, focusSeconds: number): Promise<void>;
  updateTrayDriftAlarmStatus(status: DriftAlarmTrayStatus): Promise<void>;
  updateTrayLanguage(language: string): Promise<void>;
}

export interface SyncedDefinitionInput {
  readonly accountId: string;
  readonly kind: "project" | "rule";
  readonly key: string;
  readonly value: Record<string, unknown> | null;
  readonly updatedAt: string;
  readonly expected: Project | ClassificationRule | null;
}

export interface SyncedDefinitionResult {
  readonly applied: boolean;
  readonly value: Project | ClassificationRule | null;
  readonly ledger: string;
  readonly reason?: "local_changed" | "account_changed";
}

export interface DeveloperDiagnosticsSettings {
  forceChromiumAxCapture: boolean;
  forceFrontmostFallbackCapture: boolean;
  forceBrowserHistoryUrlFallback: boolean;
  readonly browserContentContextEnabled?: boolean;
  readonly enhancedContextEnabled: boolean;
  readonly enhancedContextCaptureLocal: boolean;
  readonly enhancedContextSourceFamilies: readonly AdaptiveContextSourceFamily[];
}

/**
 * What the tracker leaves out (2026-10-25): confirmed private windows ("skip"
 * leaves no row; "record" treats them like any window) and the hours outside
 * an optional recording schedule. Days are ISO weekdays (Mon 1 … Sun 7).
 */
export interface CapturePolicyPayload {
  readonly privateWindows: "skip" | "record";
  readonly recordingSchedule: {
    readonly enabled: true;
    readonly mode: "pause-within" | "record-within";
    readonly days?: readonly number[];
    readonly startMinute: number;
    readonly endMinute: number;
  } | null;
}
