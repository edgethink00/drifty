import type { ActivityCategory, ActivitySegment, CurrentActivitySnapshot, HourBucket, ProductivityLabel, SiteDuration, StoredClassificationSource, TrackerStatus } from "./activity";
import type { AdaptiveContextSourceFamily } from "./adaptiveContentContext";

export type TrackerCommand =
  | "tracker_get_status"
  | "tracker_start"
  | "tracker_stop"
  | "tracker_get_timeline"
  | "tracker_get_timeline_page"
  | "tracker_search_timeline"
  | "tracker_get_dashboard_week_timeline"
  | "tracker_get_live_tail"
  | "tracker_get_current_snapshot"
  | "tracker_get_hourly_summary"
  | "tracker_get_raw_events"
  | "tracker_get_top_sites"
  | "tracker_set_developer_diagnostics"
  | "tracker_get_app_icons"
  | "tracker_get_unclassified_segments"
  | "tracker_get_reusable_ai_classifications"
  | "tracker_get_classification_rules"
  | "tracker_save_classification_rule"
  | "tracker_delete_classification_rule"
  | "tracker_delete_activity_segments"
  | "tracker_delete_history_range"
  | "tracker_search_classification_rule_candidates"
  | "tracker_apply_classification_rules"
  | "tracker_save_classifications"
  | "tracker_refresh_non_ai_classifications"
  | "tracker_get_classification_metrics"
  | "tracker_get_projects"
  | "tracker_save_project"
  | "tracker_delete_project"
  | "tracker_save_project_anchors"
  | "tracker_delete_project_anchor"
  | "tracker_save_project_exemplar"
  | "tracker_save_project_assignments"
  | "tracker_get_project_assignments"
  | "tracker_record_project_pass"
  | "tracker_get_project_pass_runs"
  | "tracker_save_ai_review_events"
  | "tracker_get_ai_review_events"
  | "tracker_revert_ai_review_event"
  | "tracker_preview_browser_history_import"
  | "tracker_import_browser_history"
  | "tray_update_productivity_icon"
  | "tray_update_icon_style"
  | "tray_update_drift_alarm_status";

export interface DayQuery {
  day: string;
}

export interface DateRangeQuery {
  start: string;
  end: string;
}

export type TimelineQuery = DayQuery | DateRangeQuery;

export interface TimelinePageCursor {
  beforeEndedAt: string;
  beforeSegmentId: string;
}

export interface TimelinePageQuery extends Partial<DayQuery>, Partial<DateRangeQuery> {
  beforeEndedAt?: string | null;
  beforeSegmentId?: string | null;
  limit?: number;
}

export interface TimelineSearchQuery extends TimelinePageQuery {
  readonly query: string;
}

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
}

export interface ClassificationRuleInput {
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
  /**
   * Optional allow-list of segment ids to prioritize. When present, classification selection
   * is restricted to these segments (applied client-side over the fetched unclassified pool);
   * unknown to the tracker backend, which safely ignores the extra field. Additive: callers
   * that omit it keep the previous whole-range selection behavior.
   */
  segmentIds?: readonly string[];
}

export interface ProductivityShareMix {
  focus: number;
  neutral: number;
  drift: number;
}

export type TrayIconStyle = "compact" | "expanded";

export interface DriftAlarmTrayStatus {
  readonly enabled: boolean;
  readonly statusLabel: string;
  readonly lastCheckedAt: string | null;
  readonly lastCheckedLabel: string;
  readonly resultLabel: string;
  readonly detailLabel: string | null;
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
}

export type ProjectExemplarSource = "user_confirmed" | "user_corrected";

export interface ProjectExemplar {
  id: number;
  projectId: string;
  runSummary: string;
  source: ProjectExemplarSource;
  createdAt: string;
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

export interface ProjectAssignmentsSaveResult {
  saved: number;
  skippedManual: number;
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

export interface TrackerApi {
  getStatus(): Promise<TrackerStatus>;
  start(): Promise<TrackerStatus>;
  stop(): Promise<TrackerStatus>;
  getTimeline(query: TimelineQuery): Promise<ActivitySegment[]>;
  getTimelinePage(query: TimelinePageQuery): Promise<TimelinePage>;
  searchTimeline(query: TimelineSearchQuery): Promise<TimelinePage>;
  getDashboardWeekTimeline(query: DateRangeQuery): Promise<ActivitySegment[]>;
  getLiveTail(query: LiveTailQuery): Promise<TrackerLiveTail>;
  getCurrentSnapshot(): Promise<CurrentActivitySnapshot | null>;
  getHourlySummary(query: TimelineQuery): Promise<HourBucket[]>;
  getRawEvents(query: RawEventsQuery): Promise<ActivitySegment[]>;
  getTopSites(query: TopSitesQuery): Promise<SiteDuration[]>;
  setDeveloperDiagnostics(settings: DeveloperDiagnosticsSettings): Promise<void>;
  getAppIcons(apps: AppIdentity[]): Promise<AppIconMap>;
  getUnclassifiedSegments(query: ClassificationQuery): Promise<ActivitySegment[]>;
  getReusableAiClassifications(inputFingerprints: string[]): Promise<Record<string, ActivityClassificationRecord>>;
  getClassificationRules(): Promise<ClassificationRule[]>;
  saveClassificationRule(input: ClassificationRuleInput): Promise<ClassificationRule>;
  deleteClassificationRule(id: string): Promise<{ deleted: number }>;
  deleteActivitySegments(ids: readonly string[]): Promise<{ deleted: number }>;
  deleteHistoryRange(query: DeleteHistoryRangeQuery): Promise<DeleteHistoryRangeResult>;
  searchClassificationRuleCandidates(query: ClassificationRuleCandidateQuery): Promise<ClassificationRuleCandidate[]>;
  applyClassificationRules(query?: ClassificationQuery): Promise<ClassificationRuleApplyResult>;
  saveClassifications(classifications: ActivityClassificationRecord[]): Promise<{ saved: number }>;
  refreshNonAiClassifications(query: ClassificationQuery): Promise<{ deleted: number }>;
  getClassificationMetrics(query: ClassificationQuery): Promise<ClassificationMetrics>;
  getProjects(): Promise<Project[]>;
  saveProject(input: ProjectInput): Promise<Project>;
  deleteProject(id: string): Promise<{ deleted: number }>;
  saveProjectAnchors(projectId: string, anchors: ProjectAnchor[]): Promise<ProjectAnchor[]>;
  deleteProjectAnchor(projectId: string, kind: ProjectAnchorKind, value: string): Promise<{ deleted: number }>;
  saveProjectExemplar(projectId: string, runSummary: string, source: ProjectExemplarSource): Promise<ProjectExemplar>;
  saveProjectAssignments(assignments: ProjectAssignmentRecord[]): Promise<ProjectAssignmentsSaveResult>;
  getProjectAssignments(query: TimelineQuery): Promise<ProjectAssignmentRecord[]>;
  recordProjectPass(input: ProjectPassRunInput): Promise<ProjectPassRunRecord>;
  getProjectPassRuns(query: TimelineQuery): Promise<ProjectPassRun[]>;
  saveAiReviewEvents(events: AiReviewEventInput[]): Promise<{ saved: number }>;
  getAiReviewEvents(query: TimelineQuery): Promise<AiReviewEvent[]>;
  revertAiReviewEvent(id: number): Promise<AiReviewEventRevertResult>;
  previewBrowserHistoryImport(query?: BrowserHistoryImportQuery): Promise<BrowserHistoryImportPreview>;
  importBrowserHistory(query?: BrowserHistoryImportQuery): Promise<BrowserHistoryImportResult>;
  getBrowserHistoryEnvironment(): Promise<BrowserHistoryEnvironment>;
  updateTrayProductivityIcon(mix: ProductivityShareMix): Promise<void>;
  updateTrayIconStyle(style: TrayIconStyle): Promise<void>;
  updateTrayDriftAlarmStatus(status: DriftAlarmTrayStatus): Promise<void>;
}

export interface DeveloperDiagnosticsSettings {
  forceChromiumAxCapture: boolean;
  forceFrontmostFallbackCapture: boolean;
  forceBrowserHistoryUrlFallback: boolean;
  readonly enhancedContextEnabled: boolean;
  readonly enhancedContextCaptureLocal: boolean;
  readonly enhancedContextSourceFamilies: readonly AdaptiveContextSourceFamily[];
}
