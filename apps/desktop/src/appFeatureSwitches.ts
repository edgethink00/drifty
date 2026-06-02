export type ReleaseChannel = "dev" | "beta" | "production";

function resolveReleaseChannel(): ReleaseChannel {
  const raw = String(import.meta.env.VITE_DRIFTY_CHANNEL ?? "").trim().toLowerCase();
  if (raw === "production" || raw === "beta" || raw === "dev") return raw;
  return "dev";
}

export const RELEASE_CHANNEL: ReleaseChannel = resolveReleaseChannel();
export const IS_PRODUCTION_BUILD = RELEASE_CHANNEL === "production";

export const WATCHER_PEEK_PROTOTYPE_ENABLED = !IS_PRODUCTION_BUILD;
