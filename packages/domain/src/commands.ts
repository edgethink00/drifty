import type { ActivityCategory, ActivitySegment, CurrentActivitySnapshot, HourBucket, ProductivityLabel, SiteDuration, StoredClassificationSource, TrackerStatus } from "./activity";

export type TrackerCommand =
  | "tracker_get_status"
  | "tracker_start"
  | "tracker_stop"
  | "tracker_get_timeline"
  | "tracker_get_current_snapshot"
  | "tracker_get_hourly_summary"
  | "tracker_get_raw_events"
  | "tracker_get_top_sites"
  | "tracker_get_app_icons"
  | "tracker_get_unclassified_segments"
  | "tracker_get_reusable_ai_classifications"
  | "tracker_get_classification_rules"
  | "tracker_save_classification_rule"
  | "tracker_delete_classification_rule"
  | "tracker_search_classification_rule_candidates"
  | "tracker_apply_classification_rules"
  | "tracker_save_classifications"
  | "tracker_refresh_non_ai_classifications"
  | "tracker_get_classification_metrics"
  | "tray_update_productivity_icon";

export interface DayQuery {
  day: string;
}

export interface DateRangeQuery {
  start: string;
  end: string;
}

export type TimelineQuery = DayQuery | DateRangeQuery;

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

export interface ClassificationRule {
  id: string;
  targetKind: ClassificationRuleTargetKind;
  targetValue: string;
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

export type AppIconMap = Record<string, string | null>;

export interface TrackerApi {
  getStatus(): Promise<TrackerStatus>;
  start(): Promise<TrackerStatus>;
  stop(): Promise<TrackerStatus>;
  getTimeline(query: TimelineQuery): Promise<ActivitySegment[]>;
  getCurrentSnapshot(): Promise<CurrentActivitySnapshot | null>;
  getHourlySummary(query: TimelineQuery): Promise<HourBucket[]>;
  getRawEvents(query: RawEventsQuery): Promise<ActivitySegment[]>;
  getTopSites(query: TopSitesQuery): Promise<SiteDuration[]>;
  getAppIcons(apps: AppIdentity[]): Promise<AppIconMap>;
  getUnclassifiedSegments(query: ClassificationQuery): Promise<ActivitySegment[]>;
  getReusableAiClassifications(inputFingerprints: string[]): Promise<Record<string, ActivityClassificationRecord>>;
  getClassificationRules(): Promise<ClassificationRule[]>;
  saveClassificationRule(input: ClassificationRuleInput): Promise<ClassificationRule>;
  deleteClassificationRule(id: string): Promise<{ deleted: number }>;
  searchClassificationRuleCandidates(query: string): Promise<ClassificationRuleCandidate[]>;
  applyClassificationRules(query?: ClassificationQuery): Promise<ClassificationRuleApplyResult>;
  saveClassifications(classifications: ActivityClassificationRecord[]): Promise<{ saved: number }>;
  refreshNonAiClassifications(query: ClassificationQuery): Promise<{ deleted: number }>;
  getClassificationMetrics(query: ClassificationQuery): Promise<ClassificationMetrics>;
  updateTrayProductivityIcon(mix: ProductivityShareMix): Promise<void>;
}
