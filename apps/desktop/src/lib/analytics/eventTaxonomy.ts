export const POSTHOG_EVENT_NAMES = [
  "app_opened",
  "app_active",
  "app_surface_opened",
  "app_launch_environment",
  "startup_registration",
  "local_model_setup",
  "onboarding_opened",
  "onboarding_step_viewed",
  "onboarding_completed",
  "onboarding_intro",
  "first_day_preparation",
  "first_day_backlog",
  "usage_milestone",
  "permission_action",
  "tracker_action",
  "auth_state_changed",
  "cloud_auth_action",
  "billing_action",
  "pro_funnel_step",
  "leaderboard_action",
  "ai_setup_action",
  "ai_classification_run",
  "project_classification_run",
  "memory_suggestion_run",
  "memory_suggestion_action",
  "memory_pattern_feedback",
  "app_error",
  "app_update",
] as const;

export type PostHogEventName = (typeof POSTHOG_EVENT_NAMES)[number];

export const APP_SURFACES = ["dashboard", "agents", "classification", "projects", "history", "trends", "leaderboard", "profile", "team", "settings", "onboarding", "billing", "auth"] as const;
export const DASHBOARD_PERIODS = ["day", "week", "month"] as const;
export const DASHBOARD_LAYOUTS = ["hours_down", "previous"] as const;
export const SETTINGS_SECTIONS = [
  "general",
  "permissions",
  "account",
  "sync",
  "appearance",
  "pet",
  "classification",
  "aiSetup",
  "intelligence",
  "memory",
  "notifications",
  "privacy",
  "developer",
  "data",
  "dev",
] as const;
export const ONBOARDING_SOURCES = ["first_run", "settings", "manual"] as const;
export const ONBOARDING_STEPS = [
  "welcome",
  "choose_setup",
  "account",
  "job",
  "permissions",
  "nudges",
  "ready",
  "connect_server",
  "test_connection",
  "self_data_review",
] as const;
export const SETUP_CHOICES = ["simple", "local_ai", "byok", "custom_endpoint"] as const;
/** The post-setup introduction: its cards, which sequence it opened on, and what happened to it. */
export const ONBOARDING_INTRO_STEPS = ["welcome", "day", "recap", "drift", "account", "activity", "tracking", "handoff"] as const;
export const ONBOARDING_INTRO_SEQUENCES = ["story", "sample"] as const;
/** The day a story intro tells, relative to the install day. */
export const ONBOARDING_INTRO_STORY_DAYS = ["yesterday", "today", "day_before"] as const;
export const ONBOARDING_INTRO_ACTIONS = ["step_viewed", "completed", "dismissed"] as const;
/** First matching decision, in the same order as the local introduction rules. */
export const ONBOARDING_INTRO_DECISION_REASONS = [
  "story_ready", "story_low_focus", "prepared_today", "prepared_other_day", "no_usable_history",
  "below_classified_minimum", "below_focus_minimum", "no_chart",
  "history_read_failed", "history_wait_timed_out",
] as const;
export type OnboardingIntroDecisionReason = (typeof ONBOARDING_INTRO_DECISION_REASONS)[number];
/** Memory: background suggestion runs, what people do with a suggestion, and feedback on kept patterns. No sentence or title is sent. */
export const MEMORY_SUGGESTION_KINDS = ["work", "drift", "ambiguous"] as const;
export const MEMORY_SUGGESTION_ACTIONS = ["accepted", "dismissed", "details_opened"] as const;
export const MEMORY_PATTERN_FEEDBACK_ACTIONS = ["confirm", "unconfirm", "reject", "restore"] as const;
export const MEMORY_PATTERN_KINDS = ["workSupport", "drift", "ambiguities"] as const;
export const MEMORY_PATTERN_ORIGINS = ["suggestion", "correction", "user", "legacy"] as const;
export const PERMISSIONS = ["accessibility", "notifications"] as const;
export const PERMISSION_ACTIONS = ["check", "request", "open_settings"] as const;
// Only start/stop are ever sent. `refresh` and `status_check` were declared but
// never emitted, which made analysis queries look for rows that cannot exist.
export const TRACKER_ACTIONS = ["start", "stop"] as const;
export const TRACKER_MODES = ["tracking", "idle", "degraded", "unavailable", "preview", "demo", "unknown"] as const;
export const RESULT_VALUES = ["success", "error", "cancelled", "skipped", "unavailable", "disabled"] as const;
export const AUTH_STATES = ["signed_in", "signed_out"] as const;
export const ACCOUNT_KINDS = ["anonymous_account", "account", "none"] as const;
export const APP_ACTIVE_TRIGGERS = ["launch", "auth_resolved", "foreground", "day_rollover"] as const;
/** Where the running bundle lives. Translocated and removable installs cannot survive a restart. */
export const INSTALL_LOCATIONS = [
  "applications",
  "user_applications",
  "translocated",
  "removable_volume",
  "other",
  "unknown",
] as const;
export const OPEN_AT_LOGIN_STATUSES = [
  "enabled",
  "not_registered",
  "requires_approval",
  "not_found",
  "unsupported",
  "unknown",
] as const;
export const STARTUP_BACKENDS = ["sm_app_service", "registry_run_key", "unsupported", "unknown"] as const;
export const STARTUP_REGISTRATION_PHASES = ["onboarding", "settings"] as const;
/** Local model download is the only onboarding step a machine can be unable to pass. */
export const LOCAL_MODEL_SETUP_PHASES = ["viewed", "download_started", "download_failed", "model_ready", "switched_to_cloud"] as const;
export const LOCAL_MODEL_FITS = ["good", "tight", "insufficient", "unknown"] as const;
export const MANAGED_MODEL_TIERS = ["economy", "default", "gemma", "smart", "unknown"] as const;
export const CLOUD_AUTH_ACTIONS = ["sign_in_started", "sign_in_completed", "sign_out", "sign_up_completed"] as const;
export const CLOUD_AUTH_METHODS = ["oauth", "email", "anonymous", "website", "unknown"] as const;
export const BILLING_ACTIONS = [
  "entitlement_check",
  "checkout_created",
  "checkout_opened",
  "portal_created",
  "portal_opened",
  "coupon_redeemed",
  "friend_invite_copied",
  "friend_invite_menu_opened",
] as const;
export const BILLING_INTERVALS = ["monthly", "quarterly", "yearly", "unknown"] as const;
export const ENTITLEMENT_STATUSES = ["active", "trialing", "locked", "unknown"] as const;
export const LOCKED_REASONS = ["trial_expired", "payment_required", "billing_missing", "device_limit_reached", "unavailable", "unknown"] as const;
export const LEADERBOARD_ACTIONS = ["load", "publish", "opt_out"] as const;
export const LEADERBOARD_PERIODS = ["daily", "weekly", "monthly"] as const;
export const AI_SETUP_ACTIONS = ["open", "test_connection", "save_provider", "disable"] as const;
export const AI_PROVIDER_KINDS = ["cloud", "local", "custom", "none"] as const;
export const FIRST_DAY_PREPARATION_OUTCOMES = ["success", "cloud_not_ready", "classification_incomplete", "preparation_timed_out"] as const;
export const FIRST_DAY_PREPARATION_PRESENTATIONS = ["dashboard_complete", "dashboard_partial", "retry_screen"] as const;
export const FIRST_DAY_PREPARATION_FAILURE_KINDS = ["quota", "transient", "content"] as const;
export const FIRST_DAY_CLOUD_ERROR_TYPES = ["quota", "config", "request", "parse", "schema"] as const;
export const FIRST_DAY_PREPARATION_PHASES = ["importing", "downloading", "classifying"] as const;
export const FIRST_DAY_PREPARATION_QUOTA_WINDOWS = ["minute", "hour", "day", "unknown"] as const;
export const FIRST_DAY_PREPARATION_DURATION_BUCKETS = ["under_30s", "30_90s", "90_180s", "180_300s", "300s_plus"] as const;
export const FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS = ["under_5s", "5_15s", "15_30s", "30_60s", "60s_plus"] as const;
export const FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS = ["none", "1_20", "21_50", "51_100", "100_plus"] as const;
export const FIRST_DAY_BACKLOG_SOURCES = ["foreground", "background", "resume"] as const;
/** Once per new install: how many days it took to reach 10 and 30 tracked hours. */
export const USAGE_MILESTONE_IDS = ["tracked_10h", "tracked_30h"] as const;
export const USAGE_MILESTONE_DAY_BUCKETS = ["0_7", "8_14", "15_30", "31_60", "61_90"] as const;
export const CLASSIFICATION_TRIGGERS = ["manual", "background_threshold", "focused_idle", "first_day_resume", "live", "drift_alarm"] as const;
export const CLASSIFICATION_FAILURE_KINDS = ["transport", "quota", "content"] as const;
// Mirrors AiConnectionIssueKind. Kept as a local literal list so the analytics
// taxonomy stays free of feature imports; aiFailureGuidance.test.ts pins the
// two lists to the same members.
export const AI_ISSUE_KINDS = [
  "entitlement",
  "network",
  "provider",
  "authentication",
  "credits",
  "access",
  "model_unavailable",
  "rate_limited",
  "unavailable",
] as const;
export const PROJECT_CLASSIFICATION_TRIGGERS = ["schedule", "open", "eod"] as const;
export const PROJECT_CLASSIFICATION_SKIP_REASONS = ["analysis_disconnected", "no_work"] as const;
export const CLASSIFICATION_RANGES = ["current_day", "recent", "unknown"] as const;
export const COUNT_BUCKETS = ["none", "1", "2_5", "6_20", "21_50", "50_plus"] as const;
export const ERROR_KINDS = [
  "unknown",
  "network",
  "timeout",
  "permission_denied",
  "configuration",
  "validation",
  "rate_limited",
  "provider_error",
  "supabase_error",
  "tracker_unavailable",
  "not_authenticated",
  "not_found",
  "unavailable",
] as const;

export const UPDATE_STEPS = [
  "detected",
  "prepared",
  "prepare_failed",
  "prompt_shown",
  "prompt_later",
  "install_requested",
  "install_failed",
  "applied",
] as const;
export const UPDATE_SOURCES = ["automatic", "manual"] as const;

export type PostHogPropertyRule = readonly string[] | "boolean";

export const APP_ERROR_ACTIONS = [
  ...PERMISSION_ACTIONS,
  ...TRACKER_ACTIONS,
  ...CLOUD_AUTH_ACTIONS,
  ...BILLING_ACTIONS,
  ...LEADERBOARD_ACTIONS,
  ...AI_SETUP_ACTIONS,
] as const;

export const POSTHOG_EVENT_PROPERTY_ALLOWLIST: {
  readonly [Event in PostHogEventName]: Readonly<Record<string, PostHogPropertyRule>>;
} = {
  app_opened: {},
  app_active: {
    active_trigger: APP_ACTIVE_TRIGGERS,
  },
  app_surface_opened: {
    surface: APP_SURFACES,
    dashboard_period: DASHBOARD_PERIODS,
    dashboard_layout: DASHBOARD_LAYOUTS,
    settings_section: SETTINGS_SECTIONS,
  },
  app_launch_environment: {
    install_location: INSTALL_LOCATIONS,
    open_at_login_status: OPEN_AT_LOGIN_STATUSES,
    startup_backend: STARTUP_BACKENDS,
  },
  startup_registration: {
    phase: STARTUP_REGISTRATION_PHASES,
    requested_enabled: "boolean",
    result: RESULT_VALUES,
    open_at_login_status: OPEN_AT_LOGIN_STATUSES,
    startup_backend: STARTUP_BACKENDS,
    install_location: INSTALL_LOCATIONS,
  },
  local_model_setup: {
    phase: LOCAL_MODEL_SETUP_PHASES,
    any_installable: "boolean",
    recommended_fit: LOCAL_MODEL_FITS,
    model_tier: MANAGED_MODEL_TIERS,
  },
  onboarding_opened: {
    source: ONBOARDING_SOURCES,
  },
  onboarding_step_viewed: {
    step: ONBOARDING_STEPS,
  },
  onboarding_completed: {
    setup_choice: SETUP_CHOICES,
    accessibility_granted: "boolean",
    notifications_granted: "boolean",
    account_connected: "boolean",
  },
  onboarding_intro: {
    action: ONBOARDING_INTRO_ACTIONS,
    step: ONBOARDING_INTRO_STEPS,
    sequence: ONBOARDING_INTRO_SEQUENCES,
    decision_reason: ONBOARDING_INTRO_DECISION_REASONS,
    story_day: ONBOARDING_INTRO_STORY_DAYS,
    drift_alarm_enabled: "boolean",
    extreme_nudge_enabled: "boolean",
    pet_enabled: "boolean",
  },
  first_day_preparation: {
    provider_kind: AI_PROVIDER_KINDS,
    outcome: FIRST_DAY_PREPARATION_OUTCOMES,
    presentation: FIRST_DAY_PREPARATION_PRESENTATIONS,
    failure_kind: FIRST_DAY_PREPARATION_FAILURE_KINDS,
    error_kind: ERROR_KINDS,
    cloud_error_type: FIRST_DAY_CLOUD_ERROR_TYPES,
    phase: FIRST_DAY_PREPARATION_PHASES,
    quota_window: FIRST_DAY_PREPARATION_QUOTA_WINDOWS,
    quota_wait_count_bucket: COUNT_BUCKETS,
    duration_bucket: FIRST_DAY_PREPARATION_DURATION_BUCKETS,
    import_duration_bucket: FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS,
    time_to_first_cloud_request_bucket: FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS,
    cloud_request_duration_bucket: FIRST_DAY_PREPARATION_STAGE_DURATION_BUCKETS,
    cloud_request_count_bucket: COUNT_BUCKETS,
    classification_batch_count_bucket: COUNT_BUCKETS,
    initial_segment_count_bucket: FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS,
    remaining_segment_count_bucket: FIRST_DAY_PREPARATION_SEGMENT_COUNT_BUCKETS,
  },
  first_day_backlog: {
    source: FIRST_DAY_BACKLOG_SOURCES,
  },
  usage_milestone: {
    milestone: USAGE_MILESTONE_IDS,
    days_since_start_bucket: USAGE_MILESTONE_DAY_BUCKETS,
  },
  permission_action: {
    permission: PERMISSIONS,
    action: PERMISSION_ACTIONS,
    result: RESULT_VALUES,
    accessibility_granted: "boolean",
    notifications_granted: "boolean",
    error_kind: ERROR_KINDS,
  },
  tracker_action: {
    action: TRACKER_ACTIONS,
    result: RESULT_VALUES,
    tracker_mode: TRACKER_MODES,
    running: "boolean",
    error_kind: ERROR_KINDS,
  },
  auth_state_changed: {
    auth_state: AUTH_STATES,
    account_kind: ACCOUNT_KINDS,
  },
  cloud_auth_action: {
    action: CLOUD_AUTH_ACTIONS,
    method: CLOUD_AUTH_METHODS,
    result: RESULT_VALUES,
    error_kind: ERROR_KINDS,
  },
  billing_action: {
    action: BILLING_ACTIONS,
    result: RESULT_VALUES,
    billing_interval: BILLING_INTERVALS,
    entitlement_status: ENTITLEMENT_STATUSES,
    locked_reason: LOCKED_REASONS,
    error_kind: ERROR_KINDS,
  },
  pro_funnel_step: {
    step: ["classified_result_viewed", "pro_offer_viewed", "pro_offer_acted", "checkout_opened"],
    dashboard_period: ["day", "week"],
    observation_cadence: ["local_day_v1"],
    offer_surface: ["sidebar", "upgrade_modal", "recovery_overlay", "trial_end_sheet", "trial_end_notice", "plan_end_sheet", "plan_end_notice", "status_pill"],
    offer_context: ["trial_active", "trial_ended", "plan_inactive", "upgrade", "upgrade_local"],
    offer_action: ["view_plans", "dismiss"],
    billing_interval: BILLING_INTERVALS,
  },
  leaderboard_action: {
    action: LEADERBOARD_ACTIONS,
    result: RESULT_VALUES,
    period: LEADERBOARD_PERIODS,
    row_count_bucket: COUNT_BUCKETS,
    segment_count_bucket: COUNT_BUCKETS,
    error_kind: ERROR_KINDS,
    profile_made_private: "boolean",
  },
  ai_setup_action: {
    action: AI_SETUP_ACTIONS,
    provider_kind: AI_PROVIDER_KINDS,
    result: RESULT_VALUES,
    error_kind: ERROR_KINDS,
  },
  ai_classification_run: {
    trigger: CLASSIFICATION_TRIGGERS,
    provider_kind: AI_PROVIDER_KINDS,
    result: RESULT_VALUES,
    selected_count_bucket: COUNT_BUCKETS,
    saved_count_bucket: COUNT_BUCKETS,
    range: CLASSIFICATION_RANGES,
    error_kind: ERROR_KINDS,
    failure_kind: CLASSIFICATION_FAILURE_KINDS,
    ai_issue_kind: AI_ISSUE_KINDS,
  },
  project_classification_run: {
    trigger: PROJECT_CLASSIFICATION_TRIGGERS,
    result: RESULT_VALUES,
    skip_reason: PROJECT_CLASSIFICATION_SKIP_REASONS,
    assignment_count_bucket: COUNT_BUCKETS,
    correction_count_bucket: COUNT_BUCKETS,
    error_kind: ERROR_KINDS,
  },
  memory_suggestion_run: {
    provider_kind: AI_PROVIDER_KINDS,
    result: RESULT_VALUES,
    candidate_count_bucket: COUNT_BUCKETS,
    added_count_bucket: COUNT_BUCKETS,
  },
  memory_suggestion_action: {
    action: MEMORY_SUGGESTION_ACTIONS,
    kind: MEMORY_SUGGESTION_KINDS,
    result: RESULT_VALUES,
    has_examples: "boolean",
  },
  memory_pattern_feedback: {
    action: MEMORY_PATTERN_FEEDBACK_ACTIONS,
    kind: MEMORY_PATTERN_KINDS,
    origin: MEMORY_PATTERN_ORIGINS,
    result: RESULT_VALUES,
  },
  app_error: {
    surface: APP_SURFACES,
    action: APP_ERROR_ACTIONS,
    error_kind: ERROR_KINDS,
  },
  app_update: {
    update_step: UPDATE_STEPS,
    update_source: UPDATE_SOURCES,
    background_updates_enabled: "boolean",
    background_eligible: "boolean",
    error_kind: ERROR_KINDS,
  },
} as const;
