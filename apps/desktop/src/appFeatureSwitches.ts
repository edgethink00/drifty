declare const __DRIFTY_DEV_SKIP_ONBOARDING__: boolean;
declare const __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__: boolean;
declare const __DRIFTY_DEV_FORCE_ONBOARDING__: boolean;
declare const __DRIFTY_DEV_ALLOW_ONBOARDING_AUTH_SKIP__: boolean;

export const AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED = true;
export const DEV_SETTINGS_ENABLED = true;
export const DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED = true;
export const DEVELOPER_PRE_RELEASE_UPDATES_ENABLED = true;
export const REPLAY_ONBOARDING_DEV_TOOL_ENABLED = true;
export const END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED = true;
export const END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED = true;
export const END_OF_DAY_REVIEW_NOTIFICATIONS_ENABLED = END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED;

const RAW_DEV_SKIP_ONBOARDING = typeof __DRIFTY_DEV_SKIP_ONBOARDING__ === "boolean" ? __DRIFTY_DEV_SKIP_ONBOARDING__ : false;
const RAW_DEV_SKIP_ONBOARDING_AUTH = typeof __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__ === "boolean" ? __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__ : false;
const RAW_DEV_FORCE_ONBOARDING = typeof __DRIFTY_DEV_FORCE_ONBOARDING__ === "boolean" ? __DRIFTY_DEV_FORCE_ONBOARDING__ : false;
const RAW_DEV_ALLOW_ONBOARDING_AUTH_SKIP = typeof __DRIFTY_DEV_ALLOW_ONBOARDING_AUTH_SKIP__ === "boolean" ? __DRIFTY_DEV_ALLOW_ONBOARDING_AUTH_SKIP__ : false;

export function resolveDevOnboardingBypass(rawSkipOnboarding: boolean): boolean {
  return rawSkipOnboarding;
}

export function resolveDevOnboardingAuthBypass(rawSkipOnboardingAuth: boolean): boolean {
  return rawSkipOnboardingAuth;
}

export function resolveDevOnboardingForceOpen(rawForceOnboarding: boolean): boolean {
  return rawForceOnboarding;
}

export function resolveDevOnboardingAuthSkip(rawAllowOnboardingAuthSkip: boolean): boolean {
  return rawAllowOnboardingAuthSkip;
}

export const DEV_ONBOARDING_BYPASS_ENABLED = resolveDevOnboardingBypass(RAW_DEV_SKIP_ONBOARDING);
export const DEV_ONBOARDING_AUTH_BYPASS_ENABLED = resolveDevOnboardingAuthBypass(RAW_DEV_SKIP_ONBOARDING_AUTH);
export const DEV_ONBOARDING_FORCE_OPEN_ENABLED = resolveDevOnboardingForceOpen(RAW_DEV_FORCE_ONBOARDING);
export const DEV_ONBOARDING_AUTH_SKIP_ENABLED = resolveDevOnboardingAuthSkip(RAW_DEV_ALLOW_ONBOARDING_AUTH_SKIP);

export function isDevOnboardingBypassEnabled(): boolean {
  return DEV_ONBOARDING_BYPASS_ENABLED;
}

export function isDevOnboardingForceOpenEnabled(): boolean {
  return DEV_ONBOARDING_FORCE_OPEN_ENABLED;
}
