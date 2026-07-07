export type ReleaseChannel = "dev" | "production";

declare const __DRIFTY_DEV_SKIP_ONBOARDING__: boolean;
declare const __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__: boolean;

function resolveReleaseChannel(): ReleaseChannel {
  const raw = String(import.meta.env.VITE_DRIFTY_CHANNEL ?? "").trim().toLowerCase();
  if (raw === "production" || raw === "dev") return raw;
  return "dev";
}

export const RELEASE_CHANNEL: ReleaseChannel = resolveReleaseChannel();
export const IS_PRODUCTION_BUILD = RELEASE_CHANNEL === "production";

export const TEAMS_BETA_ENABLED = !IS_PRODUCTION_BUILD;
export const WATCHER_PEEK_PROTOTYPE_ENABLED = !IS_PRODUCTION_BUILD;
export const DRIFT_ALARM_PANEL_PREVIEWS_ENABLED = true;
export const AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED = true;
export const DEV_SETTINGS_ENABLED = true;
export const DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED = true;
export const DEVELOPER_PRE_RELEASE_UPDATES_ENABLED = true;
export const REPLAY_ONBOARDING_DEV_TOOL_ENABLED = true;
export const ONBOARDING_V2_2_PREVIEW_ENABLED = !IS_PRODUCTION_BUILD;
// Project classification (heavy analysis pass, Intelligence AI-setup tab, Projects
// tab) is a developer-only preview: it only exists in non-production builds and is
// further gated behind a runtime toggle in Dev settings.
export const PROJECT_CLASSIFICATION_PREVIEW_ENABLED = !IS_PRODUCTION_BUILD;
export const END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED = false;
export const END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED = true;
export const END_OF_DAY_REVIEW_NOTIFICATIONS_ENABLED = END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED;

const RAW_DEV_SKIP_ONBOARDING = typeof __DRIFTY_DEV_SKIP_ONBOARDING__ === "boolean" ? __DRIFTY_DEV_SKIP_ONBOARDING__ : false;
const RAW_DEV_SKIP_ONBOARDING_AUTH = typeof __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__ === "boolean" ? __DRIFTY_DEV_SKIP_ONBOARDING_AUTH__ : false;

export function resolveDevOnboardingBypass(releaseChannel: ReleaseChannel, rawSkipOnboarding: boolean): boolean {
  return releaseChannel !== "production" && rawSkipOnboarding;
}

export function resolveDevOnboardingAuthBypass(releaseChannel: ReleaseChannel, rawSkipOnboardingAuth: boolean): boolean {
  return releaseChannel !== "production" && rawSkipOnboardingAuth;
}

export const DEV_ONBOARDING_BYPASS_ENABLED = resolveDevOnboardingBypass(RELEASE_CHANNEL, RAW_DEV_SKIP_ONBOARDING);
export const DEV_ONBOARDING_AUTH_BYPASS_ENABLED = resolveDevOnboardingAuthBypass(RELEASE_CHANNEL, RAW_DEV_SKIP_ONBOARDING_AUTH);

export function isDevOnboardingBypassEnabled(): boolean {
  return DEV_ONBOARDING_BYPASS_ENABLED;
}
