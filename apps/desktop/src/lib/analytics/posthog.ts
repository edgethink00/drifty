import { isTauri } from "@tauri-apps/api/core";
import { BUILD_INFO } from "../../buildInfo";
import { readProductAnalyticsEnabled, createProductAnalyticsDeliveryGuard } from "./productAnalyticsPreference";
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
  toFirstDayPreparationDurationBucket,
  toFirstDayPreparationSegmentCountBucket,
  type PostHogEventName,
  type PostHogEventPropertiesByName,
} from "./events";

type PostHogUser = {
  readonly id: string;
  readonly is_anonymous?: boolean | null;
};

export type PostHogIdentityScope = "install" | "account";

export type PostHogIdentity = {
  readonly distinctId: string;
  readonly scope: PostHogIdentityScope;
};

type PostHogDefaultProperties = {
  readonly event_source: "mac_app";
  readonly event_surface: "desktop_app";
  readonly app_platform: "macos";
  readonly runtime: "tauri" | "web";
  readonly channel: string;
  readonly analytics_schema_version: "v2";
  readonly app_version: string;
  readonly build_commit: string;
  readonly identity_scope: PostHogIdentityScope;
  readonly reporting_time_zone: "Asia/Seoul";
};

type PostHogPayloadProperties = PostHogDefaultProperties &
  SanitizedPostHogProperties & {
    readonly "$geoip_disable": true;
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
  readonly identityScope: PostHogIdentityScope;
  readonly event: Event;
  readonly properties?: PostHogEventPropertiesByName[Event] | SanitizedPostHogProperties | undefined;
};

type PostHogRuntimeConfiguration = {
  readonly hasProjectKey: boolean;
  readonly mode: string;
  readonly channel: string;
  readonly hasWindow: boolean;
  readonly isTauri: boolean;
};

type PostHogStorage = Pick<Storage, "getItem" | "setItem">;

const POSTHOG_INSTALL_ID_STORAGE_KEY = "drifty.posthog.installDistinctId.v2";
const POSTHOG_ACCOUNT_ID_NAMESPACE = "drifty-posthog-account-v2:";
const POSTHOG_DAILY_ACTIVE_STORAGE_PREFIX = "drifty.posthog.dailyActive.v2";
const POSTHOG_REPORTING_TIME_ZONE = "Asia/Seoul";
const POSTHOG_DAILY_ACTIVE_INTERVAL_MS = 15 * 60 * 1000;
const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
const posthogHost = (import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/$/, "");
const posthogChannel = String(import.meta.env.VITE_DRIFTY_CHANNEL ?? "development");

let isPostHogReady = false;
let installIdentity: PostHogIdentity | null = null;
let accountIdentity: PostHogIdentity | null = null;
let lastRequestedAuthKey: string | null = null;
let dailyActiveIntervalId: number | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && isTauri();
}

export function shouldEnablePostHog(configuration: PostHogRuntimeConfiguration): boolean {
  return configuration.hasProjectKey
    && configuration.mode !== "test"
    && configuration.channel === "production"
    && configuration.hasWindow
    && configuration.isTauri;
}

function isPostHogConfigured(): boolean {
  const hasWindow = typeof window !== "undefined";
  return shouldEnablePostHog({
    hasProjectKey: Boolean(posthogKey),
    mode: import.meta.env.MODE,
    channel: posthogChannel,
    hasWindow,
    isTauri: hasWindow && isTauriRuntime(),
  });
}

function createRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `drifty-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getPostHogStorage(): PostHogStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readPostHogStorageItem(storage: PostHogStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writePostHogStorageItem(storage: PostHogStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Analytics storage is optional and must never block the local-first app.
  }
}

function isValidInstallDistinctId(value: string | null): value is string {
  return Boolean(value?.startsWith("install_") && value.length > "install_".length);
}

export function getOrCreatePostHogInstallDistinctId(
  storage: PostHogStorage | null,
  createId: () => string = createRandomId,
): string {
  const storedId = readPostHogStorageItem(storage, POSTHOG_INSTALL_ID_STORAGE_KEY);
  if (isValidInstallDistinctId(storedId)) return storedId;

  const nextId = `install_${createId()}`;
  writePostHogStorageItem(storage, POSTHOG_INSTALL_ID_STORAGE_KEY, nextId);
  return nextId;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function derivePostHogAccountDistinctId(userId: string): Promise<string> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error("A non-empty account id is required for analytics identity.");
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Secure account analytics hashing is unavailable.");
  }

  const input = new TextEncoder().encode(`${POSTHOG_ACCOUNT_ID_NAMESPACE}${normalizedUserId}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return `account_${bytesToHex(new Uint8Array(digest))}`;
}

export type PostHogAccountIdentityResolver = {
  readonly clear: () => void;
  readonly resolve: (userId: string) => Promise<PostHogIdentity | null>;
};

export function createPostHogAccountIdentityResolver(
  deriveDistinctId: (userId: string) => Promise<string> = derivePostHogAccountDistinctId,
): PostHogAccountIdentityResolver {
  let resolutionSequence = 0;

  return {
    clear: () => {
      resolutionSequence += 1;
    },
    resolve: async (userId) => {
      const requestSequence = resolutionSequence + 1;
      resolutionSequence = requestSequence;
      const distinctId = await deriveDistinctId(userId);
      if (requestSequence !== resolutionSequence) return null;
      return { distinctId, scope: "account" };
    },
  };
}

const postHogAccountIdentityResolver = createPostHogAccountIdentityResolver();

export function getPostHogReportingDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: POSTHOG_REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getDefaultProperties(identityScope: PostHogIdentityScope): PostHogDefaultProperties {
  return {
    event_source: "mac_app",
    event_surface: "desktop_app",
    app_platform: "macos",
    runtime: isTauriRuntime() ? "tauri" : "web",
    channel: posthogChannel,
    analytics_schema_version: "v2",
    app_version: BUILD_INFO.version,
    build_commit: BUILD_INFO.commit,
    identity_scope: identityScope,
    reporting_time_zone: POSTHOG_REPORTING_TIME_ZONE,
  };
}

export function createPostHogEventPayload<Event extends PostHogEventName>({
  apiKey,
  distinctId,
  identityScope,
  event,
  properties,
}: PostHogEventPayloadInput<Event>): PostHogEventPayload {
  const sanitizedProperties = sanitizePostHogEventProperties(event, properties);

  return {
    api_key: apiKey,
    event,
    distinct_id: distinctId,
    properties: {
      ...getDefaultProperties(identityScope),
      ...sanitizedProperties,
      "$geoip_disable": true,
      "$process_person_profile": false,
    },
  };
}

function warnPostHog(message: string, error?: unknown): void {
  if (!import.meta.env.DEV) return;
  if (error === undefined) console.warn(`[PostHog] ${message}`);
  else console.warn(`[PostHog] ${message}`, error);
}

async function deliverPostHogEvent(
  identity: PostHogIdentity,
  event: PostHogEventName,
  properties?: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  if (!posthogKey || !readProductAnalyticsEnabled()) return false;

  const payload = createPostHogEventPayload({
    apiKey: posthogKey,
    distinctId: identity.distinctId,
    identityScope: identity.scope,
    event,
    properties: sanitizePostHogEventProperties(event, properties),
  });

  try {
    const response = await fetch(`${posthogHost}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (!response.ok) warnPostHog(`Unable to capture ${event}: HTTP ${response.status}.`);
    return response.ok;
  } catch (error) {
    warnPostHog(`Unable to capture ${event}.`, error);
    return false;
  }
}

function sendPostHogEvent(
  identity: PostHogIdentity,
  event: PostHogEventName,
  properties?: Readonly<Record<string, unknown>>,
): void {
  void deliverPostHogEvent(identity, event, properties);
}

export function resolvePostHogEventIdentity(
  event: PostHogEventName,
  install: PostHogIdentity | null,
  account: PostHogIdentity | null,
): PostHogIdentity | null {
  return event === "app_active" && account ? account : install;
}

/** Pro events always use the existing install identity, including when signed in. */
export async function capturePostHogInstallFunnelStep(
  properties: PostHogEventPropertiesByName["pro_funnel_step"],
): Promise<boolean> {
  if (!initializePostHog() || !installIdentity) return false;
  return deliverPostHogEvent(installIdentity, "pro_funnel_step", properties);
}

function dailyActiveStorageKey(identity: PostHogIdentity): string {
  return `${POSTHOG_DAILY_ACTIVE_STORAGE_PREFIX}.${identity.scope}.${identity.distinctId}`;
}

type PostHogDailyActiveRecorderInput = {
  readonly identity: PostHogIdentity;
  readonly reportingDate: string;
  readonly storage: PostHogStorage | null;
  readonly deliver: () => Promise<boolean>;
};

export function createPostHogDailyActiveRecorder(): (
  input: PostHogDailyActiveRecorderInput,
) => Promise<boolean> {
  const recordedDateByStorageKey = new Map<string, string>();
  const inFlightKeys = new Set<string>();

  return async ({ identity, reportingDate, storage, deliver }) => {
    const storageKey = dailyActiveStorageKey(identity);
    if (recordedDateByStorageKey.get(storageKey) === reportingDate) return false;
    if (readPostHogStorageItem(storage, storageKey) === reportingDate) {
      recordedDateByStorageKey.set(storageKey, reportingDate);
      return false;
    }

    const inFlightKey = `${storageKey}.${reportingDate}`;
    if (inFlightKeys.has(inFlightKey)) return false;
    inFlightKeys.add(inFlightKey);

    try {
      const delivered = await deliver();
      if (!delivered) return false;
      recordedDateByStorageKey.set(storageKey, reportingDate);
      writePostHogStorageItem(storage, storageKey, reportingDate);
      return true;
    } finally {
      inFlightKeys.delete(inFlightKey);
    }
  };
}

const recordPostHogDailyActiveOnce = createPostHogDailyActiveRecorder();

async function recordPostHogDailyActive(
  trigger: PostHogEventPropertiesByName["app_active"]["active_trigger"],
  identity: PostHogIdentity | null = resolvePostHogEventIdentity("app_active", installIdentity, accountIdentity),
): Promise<void> {
  if (!isPostHogReady || !identity || !readProductAnalyticsEnabled()) return;
  const storage = getPostHogStorage();
  const reportingDate = getPostHogReportingDateKey(new Date());
  await recordPostHogDailyActiveOnce({
    identity,
    reportingDate,
    storage,
    deliver: () => deliverPostHogEvent(identity, "app_active", { active_trigger: trigger }),
  });
}

function startDailyActiveTracking(): void {
  if (typeof window === "undefined" || dailyActiveIntervalId !== null) return;
  dailyActiveIntervalId = window.setInterval(() => {
    void recordPostHogDailyActive("day_rollover");
  }, POSTHOG_DAILY_ACTIVE_INTERVAL_MS);
  window.addEventListener("focus", () => {
    void recordPostHogDailyActive("foreground");
  });
}

export function initializePostHog(): boolean {
  if (!readProductAnalyticsEnabled()) return false;
  if (isPostHogReady || !isPostHogConfigured()) return isPostHogReady;

  installIdentity = {
    distinctId: getOrCreatePostHogInstallDistinctId(getPostHogStorage()),
    scope: "install",
  };
  accountIdentity = null;
  isPostHogReady = true;
  sendPostHogEvent(installIdentity, "app_opened");
  void recordPostHogDailyActive("launch", installIdentity);
  startDailyActiveTracking();
  return true;
}

export function recordPostHogAuthState(user: PostHogUser | null): void {
  if (!isPostHogReady || !installIdentity || !readProductAnalyticsEnabled()) return;
  const canDeliver = createProductAnalyticsDeliveryGuard();
  const fallbackIdentity = installIdentity;

  const accountKind = user?.is_anonymous === true ? "anonymous_account" : user ? "account" : "none";
  const authKey = user ? `${accountKind}:${user.id}` : "none";
  if (authKey === lastRequestedAuthKey) return;

  lastRequestedAuthKey = authKey;
  accountIdentity = null;
  sendPostHogEvent(fallbackIdentity, "auth_state_changed", {
    auth_state: user ? "signed_in" : "signed_out",
    account_kind: accountKind,
  });

  if (accountKind !== "account" || !user) {
    postHogAccountIdentityResolver.clear();
    void recordPostHogDailyActive("auth_resolved", fallbackIdentity);
    return;
  }

  void postHogAccountIdentityResolver.resolve(user.id)
    .then((identity) => {
      if (!identity || !canDeliver()) {
        if (authKey === lastRequestedAuthKey) lastRequestedAuthKey = null;
        return;
      }
      accountIdentity = identity;
      void recordPostHogDailyActive("auth_resolved", accountIdentity);
    })
    .catch((error) => {
      if (authKey !== lastRequestedAuthKey) return;
      lastRequestedAuthKey = null;
      warnPostHog("Unable to derive the account analytics identity; install-scoped events will continue.", error);
    });
}

export function capturePostHogEvent<Event extends PostHogEventName>(
  event: Event,
  ...[properties]: PostHogEventPropertiesArgument<Event>
): void {
  if (!isPostHogReady || !readProductAnalyticsEnabled()) return;
  const identity = resolvePostHogEventIdentity(event, installIdentity, accountIdentity);
  if (!identity) return;
  sendPostHogEvent(identity, event, properties);
}
