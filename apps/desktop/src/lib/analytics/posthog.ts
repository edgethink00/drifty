type PostHogUser = {
  id: string;
  email?: string | null;
  is_anonymous?: boolean | null;
};

type EventProperties = Record<string, unknown>;

const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
const posthogHost = (import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/$/, "");
const distinctIdStorageKey = "drifty.posthog.distinctId.v1";

let isPostHogReady = false;
let identifiedDistinctId: string | null = null;

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isPostHogConfigured() {
  return Boolean(posthogKey) && import.meta.env.MODE !== "test" && typeof window !== "undefined";
}

function createDistinctId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `drifty-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getAnonymousDistinctId() {
  const storedId = window.localStorage.getItem(distinctIdStorageKey);
  if (storedId) return storedId;

  const nextId = createDistinctId();
  window.localStorage.setItem(distinctIdStorageKey, nextId);
  return nextId;
}

function resetAnonymousDistinctId() {
  const nextId = createDistinctId();
  window.localStorage.setItem(distinctIdStorageKey, nextId);
  return nextId;
}

function getCurrentDistinctId() {
  return identifiedDistinctId ?? getAnonymousDistinctId();
}

function getDefaultProperties(): EventProperties {
  return {
    event_source: "mac_app",
    event_surface: "desktop_app",
    app_platform: "macos",
    runtime: isTauriRuntime() ? "tauri" : "web",
    channel: String(import.meta.env.VITE_DRIFTY_CHANNEL ?? "development"),
  };
}

function sendPostHogEvent(event: string, distinctId: string, properties?: EventProperties) {
  if (!posthogKey) return;

  const payload = {
    api_key: posthogKey,
    event,
    distinct_id: distinctId,
    properties: {
      ...getDefaultProperties(),
      ...properties,
    },
  };

  void fetch(`${posthogHost}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((error) => {
    if (import.meta.env.DEV) {
      console.warn("[PostHog] Unable to capture event.", error);
    }
  });
}

export function initializePostHog() {
  if (isPostHogReady || !isPostHogConfigured()) {
    return isPostHogReady;
  }

  isPostHogReady = true;
  sendPostHogEvent("app_opened", getCurrentDistinctId());
  return true;
}

export function identifyPostHogUser(user: PostHogUser | null) {
  if (!isPostHogReady) return;

  if (!user) {
    identifiedDistinctId = null;
    resetAnonymousDistinctId();
    return;
  }

  const anonymousDistinctId = getAnonymousDistinctId();
  identifiedDistinctId = user.id;
  sendPostHogEvent("$identify", user.id, {
    "$anon_distinct_id": anonymousDistinctId,
    "$set": {
      email: user.email ?? undefined,
      is_anonymous: user.is_anonymous === true,
    },
  });
}

export function capturePostHogEvent(event: string, properties?: EventProperties) {
  if (!isPostHogReady) return;
  sendPostHogEvent(event, getCurrentDistinctId(), properties);
}
