import {
  sanitizePostHogEventProperties,
  type PostHogEventName,
  type PostHogEventPropertiesArgument,
  type PostHogEventPropertiesByName,
  type SanitizedPostHogProperties,
} from "./events";

export {
  POSTHOG_EVENT_NAMES,
  POSTHOG_EVENT_PROPERTY_ALLOWLIST,
  sanitizePostHogEventProperties,
  toAnalyticsErrorKind,
  toCountBucket,
  type PostHogEventName,
  type PostHogEventPropertiesByName,
} from "./events";

type PostHogUser = {
  readonly is_anonymous?: boolean | null;
};

type PostHogDefaultProperties = {
  readonly event_source: "mac_app";
  readonly event_surface: "desktop_app";
  readonly app_platform: "macos";
  readonly runtime: "tauri" | "web";
  readonly channel: string;
};

type PostHogPayloadProperties = PostHogDefaultProperties &
  SanitizedPostHogProperties & {
    readonly "$process_person_profile": false;
  };

export type PostHogEventPayload = {
  readonly api_key: string;
  readonly event: PostHogEventName;
  readonly distinct_id: string;
  readonly properties: PostHogPayloadProperties;
};

type PostHogEventPayloadInput<Event extends PostHogEventName> = {
  readonly apiKey: string;
  readonly distinctId: string;
  readonly event: Event;
  readonly properties?: PostHogEventPropertiesByName[Event] | SanitizedPostHogProperties | undefined;
};

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

function getDefaultProperties(): PostHogDefaultProperties {
  return {
    event_source: "mac_app",
    event_surface: "desktop_app",
    app_platform: "macos",
    runtime: isTauriRuntime() ? "tauri" : "web",
    channel: String(import.meta.env.VITE_DRIFTY_CHANNEL ?? "development"),
  };
}

export function createPostHogEventPayload<Event extends PostHogEventName>({
  apiKey,
  distinctId,
  event,
  properties,
}: PostHogEventPayloadInput<Event>): PostHogEventPayload {
  const sanitizedProperties = sanitizePostHogEventProperties(event, properties);

  return {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: {
      ...getDefaultProperties(),
      ...sanitizedProperties,
      "$process_person_profile": false,
    },
  };
}

function sendPostHogEvent<Event extends PostHogEventName>(
  event: Event,
  properties?: PostHogEventPropertiesByName[Event],
) {
  if (!posthogKey) return;

  const payload = createPostHogEventPayload({
    apiKey: posthogKey,
    distinctId: anonymousSessionDistinctId,
    event,
    properties,
  });

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

export function capturePostHogEvent<Event extends PostHogEventName>(
  event: Event,
  ...[properties]: PostHogEventPropertiesArgument<Event>
) {
  if (!isPostHogReady) return;
  sendPostHogEvent(event, properties);
}
