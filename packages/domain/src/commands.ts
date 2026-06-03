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
  saveClassifications(classifications: ActivityClassificationRecord[]): Promise<{ saved: number }>;
  refreshNonAiClassifications(query: ClassificationQuery): Promise<{ deleted: number }>;
  getClassificationMetrics(query: ClassificationQuery): Promise<ClassificationMetrics>;
  updateTrayProductivityIcon(mix: ProductivityShareMix): Promise<void>;
}
