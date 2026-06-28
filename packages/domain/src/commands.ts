import type { ActivityCategory, ActivitySegment, CurrentActivitySnapshot, HourBucket, ProductivityLabel, SiteDuration, StoredClassificationSource, TrackerStatus } from "./activity";

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
  | "tracker_search_classification_rule_candidates"
  | "tracker_apply_classification_rules"
  | "tracker_save_classifications"
  | "tracker_refresh_non_ai_classifications"
  | "tracker_get_classification_metrics"
  | "tray_update_productivity_icon"
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

export interface ClassificationQuery extends Partial<DateRangeQuery>, Partial<DayQuery> {
  limit?: number;
}

export interface ProductivityShareMix {
  focus: number;
  neutral: number;
  drift: number;
}

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
  searchClassificationRuleCandidates(query: ClassificationRuleCandidateQuery): Promise<ClassificationRuleCandidate[]>;
  applyClassificationRules(query?: ClassificationQuery): Promise<ClassificationRuleApplyResult>;
  saveClassifications(classifications: ActivityClassificationRecord[]): Promise<{ saved: number }>;
  refreshNonAiClassifications(query: ClassificationQuery): Promise<{ deleted: number }>;
  getClassificationMetrics(query: ClassificationQuery): Promise<ClassificationMetrics>;
  updateTrayProductivityIcon(mix: ProductivityShareMix): Promise<void>;
  updateTrayDriftAlarmStatus(status: DriftAlarmTrayStatus): Promise<void>;
}

export interface DeveloperDiagnosticsSettings {
  forceChromiumAxCapture: boolean;
  forceFrontmostFallbackCapture: boolean;
  forceBrowserHistoryUrlFallback: boolean;
}
