declare const __DRIFTY_DEV_SKIP_ONBOARDING__: boolean;
declare const __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__: boolean;

export const DRIFT_ALARM_PANEL_PREVIEWS_ENABLED = true;
export const AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED = true;
export const DEV_SETTINGS_ENABLED = true;
export const DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED = true;
export const DEVELOPER_PRE_RELEASE_UPDATES_ENABLED = true;
export const REPLAY_ONBOARDING_DEV_TOOL_ENABLED = true;
export const END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED = false;
export const END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED = true;
export const END_OF_DAY_REVIEW_NOTIFICATIONS_ENABLED = END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED;
const SENTRY_SMOKE_CHANNELS = new Set(["development", "dev", "internal", "staging", "preview"]);

export function resolveSentrySmokeDiagnosticsEnabled(channel: string | undefined, devBuild: boolean): boolean {
  const normalizedChannel = channel?.trim().toLowerCase();
  if (normalizedChannel === "production") return false;
  return devBuild || (normalizedChannel !== undefined && SENTRY_SMOKE_CHANNELS.has(normalizedChannel));
}

export const SENTRY_SMOKE_DIAGNOSTICS_ENABLED = resolveSentrySmokeDiagnosticsEnabled(
  import.meta.env.VITE_DRIFTY_CHANNEL,
  import.meta.env.DEV,
);

const RAW_DEV_SKIP_ONBOARDING = typeof __DRIFTY_DEV_SKIP_ONBOARDING__ === "boolean" ? __DRIFTY_DEV_SKIP_ONBOARDING__ : false;
const RAW_DEV_SKIP_ONBOARDING_AUTH = typeof __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__ === "boolean" ? __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__ : false;

export function resolveDevOnboardingBypass(rawSkipOnboarding: boolean): boolean {
  return rawSkipOnboarding;
}

export function resolveDevOnboardingAuthBypass(rawSkipOnboardingAuth: boolean): boolean {
  return rawSkipOnboardingAuth;
}

export const DEV_ONBOARDING_BYPASS_ENABLED = resolveDevOnboardingBypass(RAW_DEV_SKIP_ONBOARDING);
export const DEV_ONBOARDING_AUTH_BYPASS_ENABLED = resolveDevOnboardingAuthBypass(RAW_DEV_SKIP_ONBOARDING_AUTH);

export function isDevOnboardingBypassEnabled(): boolean {
  return DEV_ONBOARDING_BYPASS_ENABLED;
}
