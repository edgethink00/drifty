export type ReleaseChannel = "dev" | "production";

declare const __DRIFTY_DEV_SKIP_ONBOARDING__: boolean;

function resolveReleaseChannel(): ReleaseChannel {
  const raw = String(import.meta.env.VITE_DRIFTY_CHANNEL ?? "").trim().toLowerCase();
  if (raw === "production" || raw === "dev") return raw;
  return "dev";
}

export const RELEASE_CHANNEL: ReleaseChannel = resolveReleaseChannel();
export const IS_PRODUCTION_BUILD = RELEASE_CHANNEL === "production";

export const WATCHER_PEEK_PROTOTYPE_ENABLED = !IS_PRODUCTION_BUILD;
export const DRIFT_ALARM_PANEL_PREVIEWS_ENABLED = !IS_PRODUCTION_BUILD;
export const AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED = !IS_PRODUCTION_BUILD;

const RAW_DEV_SKIP_ONBOARDING = typeof __DRIFTY_DEV_SKIP_ONBOARDING__ === "boolean" ? __DRIFTY_DEV_SKIP_ONBOARDING__ : false;

export function resolveDevOnboardingBypass(releaseChannel: ReleaseChannel, rawSkipOnboarding: boolean): boolean {
  return releaseChannel !== "production" && rawSkipOnboarding;
}

export const DEV_ONBOARDING_BYPASS_ENABLED = resolveDevOnboardingBypass(RELEASE_CHANNEL, RAW_DEV_SKIP_ONBOARDING);

export function isDevOnboardingBypassEnabled(): boolean {
  return DEV_ONBOARDING_BYPASS_ENABLED;
}
