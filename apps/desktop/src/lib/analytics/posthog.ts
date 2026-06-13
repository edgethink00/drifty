type PostHogUser = {
  readonly id: string;
  readonly email?: string | null;
  readonly is_anonymous?: boolean | null;
};

type EventProperties = Record<string, unknown>;

const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
const posthogHost = (import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/$/, "");

let isPostHogReady = false;

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

const anonymousSessionDistinctId = createDistinctId();

function getDefaultProperties(): EventProperties {
  return {
    event_source: "mac_app",
    event_surface: "desktop_app",
    app_platform: "macos",
    runtime: isTauriRuntime() ? "tauri" : "web",
    channel: String(import.meta.env.VITE_DRIFTY_CHANNEL ?? "development"),
  };
}

function sendPostHogEvent(event: string, properties?: EventProperties) {
  if (!posthogKey) return;

  const payload = {
    api_key: posthogKey,
    event,
    distinct_id: anonymousSessionDistinctId,
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
  sendPostHogEvent("app_opened");
  return true;
}

export function recordPostHogAuthState(user: PostHogUser | null) {
  if (!isPostHogReady) return;

  sendPostHogEvent("auth_state_changed", {
    auth_state: user ? "signed_in" : "signed_out",
    account_kind: user?.is_anonymous === true ? "anonymous_account" : user ? "account" : "none",
  });
}

export function capturePostHogEvent(event: string, properties?: EventProperties) {
  if (!isPostHogReady) return;
  sendPostHogEvent(event, properties);
}
