import type {
  ACCOUNT_KINDS,
  ACHIEVEMENT_ACTIONS,
  ACHIEVEMENT_CARD_KINDS,
  ACHIEVEMENT_RARITY_BANDS,
  ONBOARDING_INTRO_ACTIONS,
  ONBOARDING_INTRO_SEQUENCES,
  ONBOARDING_INTRO_STEPS,
  MEMORY_PATTERN_FEEDBACK_ACTIONS,
  MEMORY_PATTERN_KINDS,
  MEMORY_PATTERN_ORIGINS,
  MEMORY_SUGGESTION_ACTIONS,
  MEMORY_SUGGESTION_KINDS,
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
  FIRST_DAY_BACKLOG_SOURCES,
  USAGE_MILESTONE_DAY_BUCKETS,
  GITHUB_STAR_PROMPT_ACTIONS,
  GITHUB_STAR_PROMPT_METHODS,
  GITHUB_STAR_PROMPT_PLACEMENTS,
  USAGE_MILESTONE_IDS,
  CLOUD_AUTH_ACTIONS,
  CLOUD_AUTH_METHODS,
  COUNT_BUCKETS,
  DASHBOARD_PERIODS,
  DASHBOARD_LAYOUTS,
  ENTITLEMENT_STATUSES,
  ERROR_KINDS,
  FIRST_DAY_PREPARATION_DURATION_BUCKETS,
  FIRST_DAY_CLOUD_ERROR_TYPES,
  FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS,
  FIRST_DAY_PREPARATION_FAILURE_KINDS,
  FIRST_DAY_PREPARATION_OUTCOMES,
  FIRST_DAY_PREPARATION_PHASES,
  FIRST_DAY_PREPARATION_PRESENTATIONS,
  FIRST_DAY_PREPARATION_QUOTA_WINDOWS,
  FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS,
  INSTALL_LOCATIONS,
  LEADERBOARD_ACTIONS,
  LEADERBOARD_PERIODS,
  LOCAL_MODEL_FITS,
  LOCAL_MODEL_SETUP_PHASES,
  LOCKED_REASONS,
  MANAGED_MODEL_TIERS,
  ENTRY_ACTIONS,
  ENTRY_CONNECTION_STATES,
  ONBOARDING_NAVIGATION,
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
  UPDATE_SOURCES,
  UPDATE_STEPS,
  PostHogEventName,
} from "./eventTaxonomy";

type EmptyPostHogProperties = Record<never, never>;

type ProOfferSurface = "sidebar" | "upgrade_modal" | "recovery_overlay" | "trial_end_sheet" | "trial_end_notice" | "plan_end_sheet" | "plan_end_notice" | "status_pill";
type ProOfferContextValue = "trial_active" | "trial_ended" | "plan_inactive" | "upgrade" | "upgrade_local";

export type PostHogEventPropertiesByName = {
  readonly pro_funnel_step:
    | { readonly step: "classified_result_viewed"; readonly dashboard_period: "day" | "week"; readonly observation_cadence?: "local_day_v1" }
    | { readonly step: "pro_offer_viewed"; readonly offer_surface: Exclude<ProOfferSurface, "status_pill">; readonly offer_context: ProOfferContextValue }
    | { readonly step: "pro_offer_acted"; readonly offer_surface: "trial_end_sheet" | "trial_end_notice" | "plan_end_sheet" | "plan_end_notice" | "status_pill"; readonly offer_context: "trial_ended" | "plan_inactive"; readonly offer_action: "view_plans" | "dismiss" }
    | { readonly step: "checkout_opened"; readonly billing_interval: (typeof BILLING_INTERVALS)[number] };
  readonly app_opened: EmptyPostHogProperties;
  readonly app_active: {
    readonly active_trigger: (typeof APP_ACTIVE_TRIGGERS)[number];
  };
  readonly app_surface_opened: {
    readonly surface: (typeof APP_SURFACES)[number];
    readonly dashboard_period?: (typeof DASHBOARD_PERIODS)[number];
    readonly dashboard_layout?: (typeof DASHBOARD_LAYOUTS)[number];
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
  readonly onboarding_entry_action: {
    readonly action: (typeof ENTRY_ACTIONS)[number];
    readonly connection_state?: (typeof ENTRY_CONNECTION_STATES)[number];
    readonly wait_bucket?: (typeof FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS)[number];
  };
  readonly onboarding_step_viewed: {
    readonly step: (typeof ONBOARDING_STEPS)[number];
    readonly navigation?: (typeof ONBOARDING_NAVIGATION)[number];
    readonly previous_step?: (typeof ONBOARDING_STEPS)[number];
  };
  readonly onboarding_completed: {
    readonly setup_choice?: (typeof SETUP_CHOICES)[number];
    readonly accessibility_granted?: boolean;
    readonly notifications_granted?: boolean;
    readonly account_connected?: boolean;
  };
  /**
   * The post-setup introduction. The focus-support choices that onboarding_completed used to carry
   * (drift alerts, Automatic close, desktop cat) are reported here, on completion or dismissal.
   */
  readonly onboarding_intro: {
    readonly action: (typeof ONBOARDING_INTRO_ACTIONS)[number];
    readonly step: (typeof ONBOARDING_INTRO_STEPS)[number];
    readonly sequence: (typeof ONBOARDING_INTRO_SEQUENCES)[number];
    readonly decision_reason?: import("./eventTaxonomy").OnboardingIntroDecisionReason;
    readonly story_day?: (typeof import("./eventTaxonomy").ONBOARDING_INTRO_STORY_DAYS)[number];
    readonly drift_alarm_enabled?: boolean;
    readonly extreme_nudge_enabled?: boolean;
    readonly pet_enabled?: boolean;
    /** Whether the desktop cat has a name when the intro ends. The name itself is never sent. */
    readonly pet_named?: boolean;
  };
  readonly first_day_preparation: {
    readonly provider_kind: (typeof AI_PROVIDER_KINDS)[number];
    readonly outcome: (typeof FIRST_DAY_PREPARATION_OUTCOMES)[number];
    readonly presentation: (typeof FIRST_DAY_PREPARATION_PRESENTATIONS)[number];
    readonly failure_kind?: (typeof FIRST_DAY_PREPARATION_FAILURE_KINDS)[number];
    readonly error_kind?: (typeof ERROR_KINDS)[number];
    readonly cloud_error_type?: (typeof FIRST_DAY_CLOUD_ERROR_TYPES)[number];
    readonly phase?: (typeof FIRST_DAY_PREPARATION_PHASES)[number];
    readonly quota_window?: (typeof FIRST_DAY_PREPARATION_QUOTA_WINDOWS)[number];
    readonly quota_wait_count_bucket: (typeof COUNT_BUCKETS)[number];
    readonly duration_bucket: (typeof FIRST_DAY_PREPARATION_DURATION_BUCKETS)[number];
    readonly import_duration_bucket?: (typeof FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS)[number];
    readonly time_to_first_cloud_request_bucket?: (typeof FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS)[number];
    readonly cloud_request_duration_bucket?: (typeof FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS)[number];
    readonly cloud_request_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly classification_batch_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly initial_segment_count_bucket?: (typeof FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS)[number];
    readonly remaining_segment_count_bucket?: (typeof FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS)[number];
  };
  readonly first_day_backlog: {
    readonly source: (typeof FIRST_DAY_BACKLOG_SOURCES)[number];
  };
  readonly github_star_prompt: {
    readonly action: (typeof GITHUB_STAR_PROMPT_ACTIONS)[number];
    readonly placement: (typeof GITHUB_STAR_PROMPT_PLACEMENTS)[number];
    readonly method: (typeof GITHUB_STAR_PROMPT_METHODS)[number];
  };
  readonly achievement_action: {
    readonly action: (typeof ACHIEVEMENT_ACTIONS)[number];
    readonly card_kind?: (typeof ACHIEVEMENT_CARD_KINDS)[number];
    readonly rarity_band?: (typeof ACHIEVEMENT_RARITY_BANDS)[number];
  };
  readonly usage_milestone: {
    readonly milestone: (typeof USAGE_MILESTONE_IDS)[number];
    readonly days_since_start_bucket: (typeof USAGE_MILESTONE_DAY_BUCKETS)[number];
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
    readonly profile_made_private?: boolean;
  };
  readonly ai_setup_action: {
    readonly action: (typeof AI_SETUP_ACTIONS)[number];
    readonly provider_kind?: (typeof AI_PROVIDER_KINDS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly error_kind?: (typeof ERROR_KINDS)[number];
    /** Plan state when the provider changed, to tell trial-time CLI switches from post-trial ones. */
    readonly entitlement_status?: (typeof ENTITLEMENT_STATUSES)[number];
    readonly locked_reason?: (typeof LOCKED_REASONS)[number];
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
  readonly memory_suggestion_run: {
    readonly provider_kind: (typeof AI_PROVIDER_KINDS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly candidate_count_bucket?: (typeof COUNT_BUCKETS)[number];
    readonly added_count_bucket?: (typeof COUNT_BUCKETS)[number];
  };
  readonly memory_suggestion_action: {
    readonly action: (typeof MEMORY_SUGGESTION_ACTIONS)[number];
    readonly kind: (typeof MEMORY_SUGGESTION_KINDS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
    readonly has_examples?: boolean;
  };
  readonly memory_pattern_feedback: {
    readonly action: (typeof MEMORY_PATTERN_FEEDBACK_ACTIONS)[number];
    readonly kind: (typeof MEMORY_PATTERN_KINDS)[number];
    readonly origin: (typeof MEMORY_PATTERN_ORIGINS)[number];
    readonly result: (typeof RESULT_VALUES)[number];
  };
  readonly app_error: {
    readonly surface?: (typeof APP_SURFACES)[number];
    readonly action?: (typeof APP_ERROR_ACTIONS)[number];
    readonly error_kind: (typeof ERROR_KINDS)[number];
  };
  readonly app_update: {
    readonly update_step: (typeof UPDATE_STEPS)[number];
    readonly update_source?: (typeof UPDATE_SOURCES)[number];
    readonly background_updates_enabled?: boolean;
    readonly background_eligible?: boolean;
    readonly error_kind?: (typeof ERROR_KINDS)[number];
  };
};

export type PostHogEventPropertiesArgument<Event extends PostHogEventName> =
  keyof PostHogEventPropertiesByName[Event] extends never
    ? readonly [properties?: undefined]
    : readonly [properties: PostHogEventPropertiesByName[Event]];
