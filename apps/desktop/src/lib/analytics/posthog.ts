import { isTauri } from "@tauri-apps/api/core";
import { BUILD_INFO } from "../../buildInfo";
import { detectHostPlatform, type HostPlatform } from "../api/accessibilityClient";
import { readProductAnalyticsEnabled, createProductAnalyticsDeliveryGuard } from "./productAnalyticsPreference";
import {
  createPostHogIdentifyPayload,
  createPostHogPlanPayload,
  type PostHogAccountProfileUser,
  type PostHogPersonPayload,
  type PostHogPersonPlan,
} from "./accountProfile";
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
  toFirstDayPreparationStageDurationBucket,
  toFirstDayPreparationSegmentCountBucket,
  type PostHogEventName,
  type PostHogEventPropertiesByName,
} from "./events";

type PostHogUser = {
  readonly id: string;
  readonly is_anonymous?: boolean | null;
} & PostHogAccountProfileUser;

export type PostHogIdentityScope = "install" | "account";

export type PostHogIdentity = {
  readonly distinctId: string;
  readonly scope: PostHogIdentityScope;
};

type PostHogDefaultProperties = {
  // Kept as "mac_app" on every host so existing desktop funnels still include
  // Windows events; app_platform carries the actual host.
  readonly event_source: "mac_app";
  readonly event_surface: "desktop_app";
  readonly app_platform: HostPlatform;
  readonly runtime: "tauri" | "web";
  readonly channel: string;
  readonly analytics_schema_version: "v3";
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
/** `<account distinct id>:<plan>` last delivered, so a plan is sent once per change. */
const POSTHOG_ACCOUNT_PLAN_STORAGE_KEY = "drifty.posthog.accountPlan.v1";
const POSTHOG_DAILY_ACTIVE_STORAGE_PREFIX = "drifty.posthog.dailyActive.v2";
/**
 * One record holds the whole day's already-sent keys.
 *
 * A key-per-combination scheme would have been simpler, but nothing in this app
 * ever removes a storage entry, so every combination an install ever produced
 * would keep its own entry for the life of the install. `localStorage` is a
 * single quota shared with the rest of the app, so an analytics record that only
 * grows would eventually break unrelated features. Keying the record by date
 * instead means yesterday's keys are discarded the first time today needs it.
 */
const POSTHOG_DAILY_EVENT_LEDGER_STORAGE_KEY = "drifty.posthog.dailyEventLedger.v1";
/**
 * A hard per-install daily ceiling, far above the couple of dozen combinations a
 * real day produces. Reaching it means something is generating keys it should
 * not, and the point of this whole mechanism is that such a bug cannot turn into
 * unbounded ingestion. It stops sending instead of growing.
 */
const POSTHOG_DAILY_EVENT_LEDGER_LIMIT = 500;
const POSTHOG_REPORTING_TIME_ZONE = "Asia/Seoul";
const POSTHOG_DAILY_ACTIVE_INTERVAL_MS = 15 * 60 * 1000;
const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
const posthogHost = (import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/$/, "");
const posthogChannel = String(import.meta.env.VITE_DRIFTY_CHANNEL ?? "development");

let isPostHogReady = false;
let installIdentity: PostHogIdentity | null = null;
let accountIdentity: PostHogIdentity | null = null;
let accountUserId: string | null = null;
let accountProfileUser: PostHogAccountProfileUser | null = null;
let accountPlan: PostHogPersonPlan | null = null;
let lastRequestedAuthKey: string | null = null;
let dailyActiveIntervalId: number | null = null;
const personDeliveryByAccount = new Map<string, Promise<void>>();

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

function getPostHogStorage(): Storage | null {
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
    app_platform: detectHostPlatform(),
    runtime: isTauriRuntime() ? "tauri" : "web",
    channel: posthogChannel,
    // v3 is the cutover where machine-driven events became at-most-once-per-day.
    // Counting a v2 series and a v3 series together shows a cliff that looks
    // exactly like a broken feature, so the version has to separate them.
    analytics_schema_version: "v3",
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

async function deliverPostHogPersonPayload(payload: PostHogPersonPayload): Promise<boolean> {
  if (!readProductAnalyticsEnabled()) return false;
  try {
    const response = await fetch(`${posthogHost}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (!response.ok) warnPostHog(`Unable to send ${payload.event}: HTTP ${response.status}.`);
    return response.ok;
  } catch (error) {
    warnPostHog(`Unable to send ${payload.event}.`, error);
    return false;
  }
}

/** Order person writes per account so an older plan cannot land after a newer
 * one. Re-check consent and account ownership when queued work actually runs. */
function enqueuePostHogPersonDelivery(
  identity: PostHogIdentity,
  deliver: (canDeliver: () => boolean) => Promise<boolean>,
): Promise<boolean> {
  const hasConsent = createProductAnalyticsDeliveryGuard();
  const canDeliver = () => accountIdentity === identity && hasConsent();
  const previous = personDeliveryByAccount.get(identity.distinctId) ?? Promise.resolve();
  const delivery = previous.then(() => canDeliver() ? deliver(canDeliver) : false);
  const settled = delivery.then(() => {}, () => {});
  personDeliveryByAccount.set(identity.distinctId, settled);
  void settled.then(() => {
    if (personDeliveryByAccount.get(identity.distinctId) === settled) personDeliveryByAccount.delete(identity.distinctId);
  });
  return delivery;
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

export type PostHogDailyEventLedger = {
  readonly date: string;
  readonly keys: readonly string[];
};

/** Any unreadable or stale record is replaced by an empty one for today, which
    is what keeps the stored size bounded to a single day. */
export function parsePostHogDailyEventLedger(
  raw: string | null,
  reportingDate: string,
): PostHogDailyEventLedger {
  const emptyLedger = { date: reportingDate, keys: [] } as const;
  if (!raw) return emptyLedger;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyLedger;
    const record = parsed as { readonly date?: unknown; readonly keys?: unknown };
    if (record.date !== reportingDate || !Array.isArray(record.keys)) return emptyLedger;
    return {
      date: reportingDate,
      keys: record.keys.filter((key): key is string => typeof key === "string"),
    };
  } catch {
    return emptyLedger;
  }
}

export type PostHogDailyEventAdmission = "send" | "already_sent" | "ceiling_reached";

export function resolvePostHogDailyEventAdmission(
  ledger: PostHogDailyEventLedger,
  dedupKey: string,
  limit: number = POSTHOG_DAILY_EVENT_LEDGER_LIMIT,
): PostHogDailyEventAdmission {
  if (ledger.keys.includes(dedupKey)) return "already_sent";
  if (ledger.keys.length >= limit) return "ceiling_reached";
  return "send";
}

type PostHogDailyEventRecorderInput = {
  readonly dedupKey: string;
  readonly reportingDate: string;
  readonly storage: PostHogStorage | null;
  readonly deliver: () => Promise<boolean>;
};

/** Marks the day only after delivery succeeds, so a transient network failure
    does not silently drop the whole day's single observation. */
export function createPostHogDailyEventRecorder(
  limit: number = POSTHOG_DAILY_EVENT_LEDGER_LIMIT,
): (input: PostHogDailyEventRecorderInput) => Promise<boolean> {
  const recordedDateByDedupKey = new Map<string, string>();
  const inFlightKeys = new Set<string>();

  return async ({ dedupKey, reportingDate, storage, deliver }) => {
    if (recordedDateByDedupKey.get(dedupKey) === reportingDate) return false;

    const readLedger = () => parsePostHogDailyEventLedger(
      readPostHogStorageItem(storage, POSTHOG_DAILY_EVENT_LEDGER_STORAGE_KEY),
      reportingDate,
    );
    const admission = resolvePostHogDailyEventAdmission(readLedger(), dedupKey, limit);
    if (admission === "already_sent") {
      recordedDateByDedupKey.set(dedupKey, reportingDate);
      return false;
    }
    if (admission === "ceiling_reached") {
      warnPostHog(`Reached the daily event ceiling of ${limit}; dropping ${dedupKey}.`);
      return false;
    }

    const inFlightKey = `${dedupKey}.${reportingDate}`;
    if (inFlightKeys.has(inFlightKey)) return false;
    inFlightKeys.add(inFlightKey);

    try {
      const delivered = await deliver();
      if (!delivered) return false;
      recordedDateByDedupKey.set(dedupKey, reportingDate);
      // Re-read before writing: another key can land while this request is in
      // flight, and a stale copy would drop it.
      const latest = readLedger();
      const keys = latest.keys.includes(dedupKey) ? latest.keys : [...latest.keys, dedupKey];
      writePostHogStorageItem(
        storage,
        POSTHOG_DAILY_EVENT_LEDGER_STORAGE_KEY,
        JSON.stringify({ date: reportingDate, keys }),
      );
      return true;
    } finally {
      inFlightKeys.delete(inFlightKey);
    }
  };
}

const recordPostHogDailyActiveOnce = createPostHogDailyActiveRecorder();
const recordPostHogDailyEventOnce = createPostHogDailyEventRecorder();

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
    void syncPostHogAccountProfile();
  }, POSTHOG_DAILY_ACTIVE_INTERVAL_MS);
  window.addEventListener("focus", () => {
    void recordPostHogDailyActive("foreground");
    void syncPostHogAccountProfile();
  });
}

/**
 * Links this install to the signed-in account and refreshes the person
 * profile (email, name, platform, plan, last_active_at) at most once per
 * reporting day. The install identity merges into the account person on the
 * first call; PostHog ignores the merge once that install belongs to another
 * identified account.
 */
async function syncPostHogAccountProfile(): Promise<void> {
  const identity = accountIdentity;
  const install = installIdentity;
  if (!isPostHogReady || !posthogKey || !identity || !install || !accountProfileUser || !readProductAnalyticsEnabled()) return;
  const apiKey = posthogKey;
  await recordPostHogDailyEventOnce({
    dedupKey: `$identify.${identity.distinctId}`,
    reportingDate: getPostHogReportingDateKey(new Date()),
    storage: getPostHogStorage(),
    deliver: () => enqueuePostHogPersonDelivery(identity, async (canDeliver) => {
      const user = accountProfileUser;
      if (!user) return false;
      const plan = accountPlan;
      const payload = createPostHogIdentifyPayload({
        apiKey,
        accountDistinctId: identity.distinctId,
        installDistinctId: install.distinctId,
        user,
        platform: detectHostPlatform(),
        plan,
        appVersion: BUILD_INFO.version,
        now: new Date(),
      });
      if (!payload) return false;
      if (plan) forgetDeliveredPlan();
      const delivered = await deliverPostHogPersonPayload(payload);
      if (!delivered || !canDeliver()) return false;
      // Remember what the server received, even if entitlement changed while
      // sending. The next queued update must compare against that actual plan.
      if (plan) rememberDeliveredPlan(identity, plan);
      return true;
    }),
  });
}

function deliveredPlanKey(identity: PostHogIdentity, plan: PostHogPersonPlan): string {
  return `${identity.distinctId}:${plan}`;
}

function rememberDeliveredPlan(identity: PostHogIdentity, plan: PostHogPersonPlan): void {
  writePostHogStorageItem(getPostHogStorage(), POSTHOG_ACCOUNT_PLAN_STORAGE_KEY, deliveredPlanKey(identity, plan));
}

function forgetDeliveredPlan(): void {
  try {
    // Once a new write starts, a failed response cannot establish that the
    // server still has the previous plan. Do not let its cache suppress repair.
    getPostHogStorage()?.removeItem(POSTHOG_ACCOUNT_PLAN_STORAGE_KEY);
  } catch {
    // Analytics storage is optional.
  }
}

async function syncPostHogAccountPlan(): Promise<void> {
  const identity = accountIdentity;
  if (!isPostHogReady || !posthogKey || !identity || !accountPlan || !readProductAnalyticsEnabled()) return;
  const apiKey = posthogKey;
  await enqueuePostHogPersonDelivery(identity, async (canDeliver) => {
    const plan = accountPlan;
    if (!plan) return false;
    const storage = getPostHogStorage();
    if (readPostHogStorageItem(storage, POSTHOG_ACCOUNT_PLAN_STORAGE_KEY) === deliveredPlanKey(identity, plan)) return false;
    forgetDeliveredPlan();
    const delivered = await deliverPostHogPersonPayload(createPostHogPlanPayload({
      apiKey,
      accountDistinctId: identity.distinctId,
      plan,
    }));
    if (!delivered || !canDeliver()) return false;
    rememberDeliveredPlan(identity, plan);
    return true;
  });
}

/** Records the signed-in account's plan from its billing entitlement. */
export function recordPostHogAccountPlan(userId: string, plan: PostHogPersonPlan): void {
  if (!isPostHogReady || userId !== accountUserId) return;
  accountPlan = plan;
  void syncPostHogAccountPlan();
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
  const isFullAccount = accountKind === "account" && Boolean(user);
  accountProfileUser = isFullAccount && user
    ? { email: user.email ?? null, created_at: user.created_at ?? null, user_metadata: user.user_metadata ?? null }
    : null;
  if (authKey === lastRequestedAuthKey) {
    // Auth refreshes can bring new contact fields without changing identity.
    // Keep the existing daily budget when retrying or refreshing the profile.
    void syncPostHogAccountProfile();
    return;
  }

  lastRequestedAuthKey = authKey;
  accountIdentity = null;
  if (!isFullAccount || accountUserId !== user?.id) accountPlan = null;
  accountUserId = isFullAccount && user ? user.id : null;
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
      void syncPostHogAccountProfile();
      void syncPostHogAccountPlan();
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

/**
 * Sends at most one event per reporting day for each (event, dedupKey) pair.
 *
 * Use this for anything a background loop or a repeated navigation can trigger.
 * `dedupKey` must carry every property dimension the analysis needs to keep
 * separate, because only the first delivery of each key survives the day.
 */
export function capturePostHogDailyEvent<Event extends PostHogEventName>(
  event: Event,
  dedupKey: string,
  ...[properties]: PostHogEventPropertiesArgument<Event>
): void {
  if (!isPostHogReady || !readProductAnalyticsEnabled()) return;
  const identity = resolvePostHogEventIdentity(event, installIdentity, accountIdentity);
  if (!identity) return;
  void recordPostHogDailyEventOnce({
    dedupKey: `${event}.${dedupKey}`,
    reportingDate: getPostHogReportingDateKey(new Date()),
    storage: getPostHogStorage(),
    deliver: () => deliverPostHogEvent(identity, event, properties),
  });
}
