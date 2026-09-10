import type {
  ACCOUNT_KINDS,
  APP_ACTIVE_TRIGGERS,
  AI_PROVIDER_KINDS,
  AI_SETUP_ACTIONS,
  AI_ISSUE_KINDS,
  APP_ERROR_ACTIONS,
  APP_SURFACES,
  AUTH_STATES,
  BILLING_ACTIONS,
  BILLING_INTERVALS,
  CLASSIFICATION_RANGES,
  CLASSIFICATION_FAILURE_KINDS,
  CLASSIFICATION_TRIGGERS,
  CLOUD_AUTH_ACTIONS,
  CLOUD_AUTH_METHODS,
  COUNT_BUCKETS,
  DASHBOARD_PERIODS,
  ENTITLEMENT_STATUSES,
  ERROR_KINDS,
  FIRST_DAY_PREPARATION_DURATION_BUCKETS,
  FIRST_DAY_PREPARATION_OUTCOMES,
  FIRST_DAY_PREPARATION_QUOTA_WINDOWS,
  FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS,
  INSTALL_LOCATIONS,
  LEADERBOARD_ACTIONS,
  LEADERBOARD_PERIODS,
  LOCAL_MODEL_FITS,
  LOCAL_MODEL_SETUP_PHASES,
  LOCKED_REASONS,
  MANAGED_MODEL_TIERS,
  ONBOARDING_SOURCES,
  ONBOARDING_STEPS,
  OPEN_AT_LOGIN_STATUSES,
  PERMISSION_ACTIONS,
  PERMISSIONS,
  PROJECT_CLASSIFICATION_TRIGGERS,
  PROJECT_CLASSIFICATION_SKIP_REASONS,
  RESULT_VALUES,
  SETTINGS_SECTIONS,
  SETUP_CHOICES,
  STARTUP_BACKENDS,
  STARTUP_REGISTRATION_PHASES,
  TRACKER_ACTIONS,
  TRACKER_MODES,
  PostHogEventName,
} from "./eventTaxonomy";

type EmptyPostHogProperties = Record<never, never>;

export type PostHogEventPropertiesByName = {
  readonly pro_funnel_step:
    | { readonly step: "classified_result_viewed"; readonly dashboard_period: "day" | "week" }
    | { readonly step: "pro_offer_viewed"; readonly offer_surface: "sidebar" | "upgrade_modal" | "recovery_overlay"; readonly offer_context: "trial_active" | "trial_ended" | "upgrade" | "upgrade_local" }
    | { readonly step: "checkout_opened"; readonly billing_interval: (typeof BILLING_INTERVALS)[number] };
  readonly app_opened: EmptyPostHogProperties;
  readonly app_active: {
    readonly active_trigger: (typeof APP_ACTIVE_TRIGGERS)[number];
  };
  readonly app_surface_opened: {
    readonly surface: (typeof APP_SURFACES)[number];
    readonly dashboard_period?: (typeof DASHBOARD_PERIODS)[number];
    readonly settings_section?: (typeof SETTINGS_SECTIONS)[number];
  };
  readonly app_launch_environment: {
    readonly install_location: (typeof INSTALL_LOCATIONS)[number];
    readonly open_at_login_status: (typeof OPEN_AT_LOGIN_STATUSES)[number];
    readonly startup_backend: (typeof STARTUP_BACKENDS)[number];
  };
  readonly startup_registration: {
    readonly phase: (typeof STARTUP_REGISTRATION_PHASES)[number];
    readonly requested_enabled: boolean;
    readonly result: (typeof RESULT_VALUES)[number];
    readonly open_at_login_status: (typeof OPEN_AT_LOGIN_STATUSES)[number];
    readonly startup_backend: (typeof STARTUP_BACKENDS)[number];
    readonly install_location?: (typeof INSTALL_LOCATIONS)[number];
  };
  readonly local_model_setup: {
    readonly phase: (typeof LOCAL_MODEL_SETUP_PHASES)[number];
    readonly any_installable: boolean;
    readonly recommended_fit: (typeof LOCAL_MODEL_FITS)[number];
    readonly model_tier?: (typeof MANAGED_MODEL_TIERS)[number];
  };
  readonly onboarding_opened: {
    readonly source?: (typeof ONBOARDING_SOURCES)[number];
  };
  readonly onboarding_step_viewed: {
    readonly step: (typeof ONBOARDING_STEPS)[number];
  };
  readonly onboarding_completed: {
    readonly setup_choice?: (typeof SETUP_CHOICES)[number];
    readonly accessibility_granted?: boolean;
    readonly notifications_granted?: boolean;
    readonly account_connected?: boolean;
    readonly drift_alarm_enabled?: boolean;
    readonly extreme_nudge_enabled?: boolean;
    readonly pet_enabled?: boolean;
  };
  readonly first_day_preparation: {
    readonly provider_kind: (typeof AI_PROVIDER_KINDS)[number];
    readonly outcome: (typeof FIRST_DAY_PREPARATION_OUTCOMES)[number];
    readonly quota_window?: (typeof FIRST_DAY_PREPARATION_QUOTA_WINDOWS)[number];
    readonly quota_wait_count_bucket: (typeof COUNT_BUCKETS)[number];
    readonly duration_bucket: (typeof FIRST_DAY_PREPARATION_DURATION_BUCKETS)[number];
    readonly initial_segment_count_bucket?: (typeof FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS)[number];
    readonly remaining_segment_count_bucket?: (typeof FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS)[number];
  };
  readonly permission_action: {
    readonly permission: (typeof PERMISSIONS)[number];
    readonly action: (typeof PERMISSION_ACTIONS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly accessibility_granted?: boolean;
    readonly notifications_granted?: boolean;
    readonly error_kind?: (typeof ERROR_KINDS)[number];
  };
  readonly tracker_action: {
    readonly action: (typeof TRACKER_ACTIONS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly tracker_mode?: (typeof TRACKER_MODES)[number];
    readonly running?: boolean;
    readonly error_kind?: (typeof ERROR_KINDS)[number];
  };
  readonly auth_state_changed: {
    readonly auth_state: (typeof AUTH_STATES)[number];
    readonly account_kind: (typeof ACCOUNT_KINDS)[number];
  };
  readonly cloud_auth_action: {
    readonly action: (typeof CLOUD_AUTH_ACTIONS)[number];
    readonly method?: (typeof CLOUD_AUTH_METHODS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly error_kind?: (typeof ERROR_KINDS)[number];
  };
  readonly billing_action: {
    readonly action: (typeof BILLING_ACTIONS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly billing_interval?: (typeof BILLING_INTERVALS)[number];
    readonly entitlement_status?: (typeof ENTITLEMENT_STATUSES)[number];
    readonly locked_reason?: (typeof LOCKED_REASONS)[number];
    readonly error_kind?: (typeof ERROR_KINDS)[number];
  };
  readonly leaderboard_action: {
    readonly action: (typeof LEADERBOARD_ACTIONS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly period?: (typeof LEADERBOARD_PERIODS)[number];
    readonly row_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly segment_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly error_kind?: (typeof ERROR_KINDS)[number];
  };
  readonly ai_setup_action: {
    readonly action: (typeof AI_SETUP_ACTIONS)[number];
    readonly provider_kind?: (typeof AI_PROVIDER_KINDS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly error_kind?: (typeof ERROR_KINDS)[number];
  };
  readonly ai_classification_run: {
    readonly trigger: (typeof CLASSIFICATION_TRIGGERS)[number];
    readonly provider_kind: (typeof AI_PROVIDER_KINDS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly selected_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly saved_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly range?: (typeof CLASSIFICATION_RANGES)[number];
    readonly error_kind?: (typeof ERROR_KINDS)[number];
    readonly failure_kind?: (typeof CLASSIFICATION_FAILURE_KINDS)[number];
    // The structured cause the transport already computed. Present alongside
    // error_kind so the two can be compared while error_kind still re-derives
    // its value from prose; see lib/analytics/eventHelpers.test.ts.
    readonly ai_issue_kind?: (typeof AI_ISSUE_KINDS)[number];
  };
  readonly project_classification_run: {
    readonly trigger: (typeof PROJECT_CLASSIFICATION_TRIGGERS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly skip_reason?: (typeof PROJECT_CLASSIFICATION_SKIP_REASONS)[number];
    readonly assignment_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly correction_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly error_kind?: (typeof ERROR_KINDS)[number];
  };
  readonly app_error: {
    readonly surface?: (typeof APP_SURFACES)[number];
    readonly action?: (typeof APP_ERROR_ACTIONS)[number];
    readonly error_kind: (typeof ERROR_KINDS)[number];
  };
};

export type PostHogEventPropertiesArgument<Event extends PostHogEventName> =
  keyof PostHogEventPropertiesByName[Event] extends never
    ? readonly [properties?: undefined]
    : readonly [properties: PostHogEventPropertiesByName[Event]];
