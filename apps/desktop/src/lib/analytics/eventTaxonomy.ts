export const POSTHOG_EVENT_NAMES = [
  "app_opened",
  "app_surface_opened",
  "onboarding_opened",
  "onboarding_step_viewed",
  "onboarding_completed",
  "permission_action",
  "tracker_action",
  "auth_state_changed",
  "cloud_auth_action",
  "billing_action",
  "leaderboard_action",
  "ai_setup_action",
  "ai_classification_run",
  "app_error",
] as const;

export type PostHogEventName = (typeof POSTHOG_EVENT_NAMES)[number];

export const APP_SURFACES = ["dashboard", "classification", "history", "trends", "leaderboard", "settings", "onboarding", "billing", "auth"] as const;
export const DASHBOARD_PERIODS = ["day", "week", "month"] as const;
export const SETTINGS_SECTIONS = [
  "general",
  "account",
  "appearance",
  "classification",
  "aiSetup",
  "notifications",
  "privacy",
  "data",
  "dev",
] as const;
export const ONBOARDING_SOURCES = ["first_run", "settings", "manual"] as const;
export const ONBOARDING_STEPS = [
  "welcome",
  "choose_setup",
  "account",
  "job",
  "data_review",
  "permissions",
  "nudges",
  "ready",
  "connect_server",
  "test_connection",
  "self_data_review",
  "privacy",
  "work_profile",
  "accessibility",
  "notifications",
] as const;
export const SETUP_CHOICES = ["simple", "local_ai", "byok", "custom_endpoint"] as const;
export const PERMISSIONS = ["accessibility", "notifications"] as const;
export const PERMISSION_ACTIONS = ["check", "request", "open_settings"] as const;
export const TRACKER_ACTIONS = ["refresh", "start", "stop", "status_check"] as const;
export const TRACKER_MODES = ["tracking", "idle", "unavailable", "preview", "demo", "unknown"] as const;
export const RESULT_VALUES = ["success", "error", "cancelled", "skipped", "unavailable", "disabled"] as const;
export const AUTH_STATES = ["signed_in", "signed_out"] as const;
export const ACCOUNT_KINDS = ["anonymous_account", "account", "none"] as const;
export const CLOUD_AUTH_ACTIONS = ["sign_in_started", "sign_in_completed", "sign_out", "sign_up_completed"] as const;
export const CLOUD_AUTH_METHODS = ["oauth", "email", "anonymous", "website", "unknown"] as const;
export const BILLING_ACTIONS = [
  "entitlement_check",
  "checkout_created",
  "checkout_opened",
  "portal_created",
  "portal_opened",
] as const;
export const BILLING_INTERVALS = ["monthly", "quarterly", "yearly", "unknown"] as const;
export const ENTITLEMENT_STATUSES = ["active", "trialing", "locked", "unknown"] as const;
export const LOCKED_REASONS = ["trial_expired", "payment_required", "billing_missing", "device_limit_reached", "unavailable", "unknown"] as const;
export const LEADERBOARD_ACTIONS = ["load", "publish", "opt_out"] as const;
export const LEADERBOARD_PERIODS = ["daily", "weekly", "monthly"] as const;
export const AI_SETUP_ACTIONS = ["open", "test_connection", "save_provider", "disable"] as const;
export const AI_PROVIDER_KINDS = ["cloud", "local", "custom", "none"] as const;
export const CLASSIFICATION_TRIGGERS = ["manual", "background_threshold", "focused_idle", "live", "drift_alarm"] as const;
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
  app_surface_opened: {
    surface: APP_SURFACES,
    dashboard_period: DASHBOARD_PERIODS,
    settings_section: SETTINGS_SECTIONS,
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
  leaderboard_action: {
    action: LEADERBOARD_ACTIONS,
    result: RESULT_VALUES,
    period: LEADERBOARD_PERIODS,
    row_count_bucket: COUNT_BUCKETS,
    segment_count_bucket: COUNT_BUCKETS,
    error_kind: ERROR_KINDS,
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
  },
  app_error: {
    surface: APP_SURFACES,
    action: APP_ERROR_ACTIONS,
    error_kind: ERROR_KINDS,
  },
} as const;
