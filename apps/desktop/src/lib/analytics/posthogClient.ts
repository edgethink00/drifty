import {
  type PostHogEventName,
  type PostHogEventPropertiesArgument,
  sanitizePostHogEventProperties,
} from "./events";
import { recordSupportJournalEvent } from "../diagnostics/supportJournal";
import type { PostHogAccountProfileUser, PostHogPersonPlan } from "./accountProfile";
import {
  PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT,
  PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY,
  createProductAnalyticsDeliveryGuard,
  readProductAnalyticsEnabled,
} from "./productAnalyticsPreference";

export {
  POSTHOG_EVENT_NAMES,
  POSTHOG_EVENT_PROPERTY_ALLOWLIST,
  sanitizePostHogEventProperties,
  toAnalyticsErrorKind,
  toCountBucket,
  toDailyDedupKey,
  type PostHogEventName,
  type PostHogEventPropertiesByName,
} from "./events";

type PostHogUser = {
  readonly id: string;
  readonly is_anonymous?: boolean | null;
} & PostHogAccountProfileUser;

export type PostHogClientRuntime = Pick<
  typeof import("./posthog"),
  | "capturePostHogEvent"
  | "capturePostHogDailyEvent"
  | "initializePostHog"
  | "recordPostHogAuthState"
  | "recordPostHogAccountPlan"
>;

type PendingPostHogOperation = {
  readonly kind: "auth" | "event";
  readonly run: (runtime: PostHogClientRuntime) => void;
};

const MAX_PENDING_OPERATIONS = 100;
const POSTHOG_IDLE_TIMEOUT_MS = 1_500;

export function createDeferredPostHogClient(
  maxPendingOperations = MAX_PENDING_OPERATIONS,
  isAnalyticsEnabled: () => boolean = readProductAnalyticsEnabled,
) {
  let runtime: PostHogClientRuntime | null = null;
  let latestAuthState: PostHogUser | null | undefined;
  const pendingOperations: PendingPostHogOperation[] = [];

  const enqueue = (operation: PendingPostHogOperation) => {
    if (!isAnalyticsEnabled()) return;
    if (runtime) {
      operation.run(runtime);
      return;
    }

    if (pendingOperations.length >= maxPendingOperations) pendingOperations.shift();
    pendingOperations.push(operation);
  };

  return {
    connect(nextRuntime: PostHogClientRuntime): boolean {
      if (!isAnalyticsEnabled()) {
        runtime = null;
        pendingOperations.splice(0);
        return false;
      }
      const enabled = nextRuntime.initializePostHog();
      if (!enabled) {
        runtime = null;
        pendingOperations.splice(0);
        return false;
      }

      runtime = nextRuntime;
      const pending = pendingOperations.splice(0);
      pending.forEach((operation) => operation.run(nextRuntime));
      if (latestAuthState !== undefined && !pending.some((operation) => operation.kind === "auth")) {
        nextRuntime.recordPostHogAuthState(latestAuthState);
      }
      return enabled;
    },
    clearPending(): void {
      pendingOperations.splice(0);
    },
    handlePreferenceChange(enabled: boolean): void {
      if (enabled) return;
      runtime = null;
      pendingOperations.splice(0);
    },
    capturePostHogEvent<Event extends PostHogEventName>(
      event: Event,
      ...properties: PostHogEventPropertiesArgument<Event>
    ): void {
      enqueue({
        kind: "event",
        run: (nextRuntime) => {
          nextRuntime.capturePostHogEvent(event, ...properties);
        },
      });
    },
    capturePostHogDailyEvent<Event extends PostHogEventName>(
      event: Event,
      dedupKey: string,
      ...properties: PostHogEventPropertiesArgument<Event>
    ): void {
      enqueue({
        kind: "event",
        run: (nextRuntime) => {
          nextRuntime.capturePostHogDailyEvent(event, dedupKey, ...properties);
        },
      });
    },
    recordPostHogAuthState(user: PostHogUser | null): void {
      const userSnapshot = user
        ? {
          id: user.id,
          is_anonymous: user.is_anonymous,
          email: user.email ?? null,
          created_at: user.created_at ?? null,
          user_metadata: user.user_metadata ?? null,
        }
        : null;
      latestAuthState = userSnapshot;
      enqueue({
        kind: "auth",
        run: (nextRuntime) => {
          nextRuntime.recordPostHogAuthState(userSnapshot);
        },
      });
    },
    recordPostHogAccountPlan(userId: string, plan: PostHogPersonPlan): void {
      enqueue({
        kind: "event",
        run: (nextRuntime) => {
          nextRuntime.recordPostHogAccountPlan(userId, plan);
        },
      });
    },
  };
}

const client = createDeferredPostHogClient();
let initializationPromise: Promise<boolean> | null = null;
let initializationScheduled = false;
let preferenceChangeSequence = 0;

export function initializePostHogClient(): Promise<boolean> {
  if (!readProductAnalyticsEnabled()) return Promise.resolve(false);
  if (initializationPromise) return initializationPromise;

  const mayInitialize = createProductAnalyticsDeliveryGuard();
  let nextInitializationPromise!: Promise<boolean>;
  nextInitializationPromise = import("./posthog")
    .then((runtime) => mayInitialize() ? client.connect(runtime) : false)
    .catch((error) => {
      if (initializationPromise === nextInitializationPromise) client.clearPending();
      if (import.meta.env.DEV) {
        console.warn(
          "[PostHog] Unable to load analytics runtime.",
          error instanceof Error ? error.message : String(error),
        );
      }
      return false;
    })
    .then((enabled) => {
      if (!enabled && initializationPromise === nextInitializationPromise) {
        initializationPromise = null;
      }
      return enabled;
    });
  initializationPromise = nextInitializationPromise;

  return initializationPromise;
}

export function schedulePostHogInitialization(): boolean {
  if (initializationScheduled || initializationPromise) return false;
  initializationScheduled = true;

  const initialize = () => {
    void initializePostHogClient();
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(initialize, { timeout: POSTHOG_IDLE_TIMEOUT_MS });
  } else {
    window.setTimeout(initialize, 0);
  }
  return true;
}

export function capturePostHogEvent<Event extends PostHogEventName>(
  event: Event,
  ...properties: PostHogEventPropertiesArgument<Event>
): void {
  journalSupportEvent(event, properties[0]);
  client.capturePostHogEvent(event, ...properties);
}

/** One delivery per reporting day for each (event, dedupKey) pair. */
export function capturePostHogDailyEvent<Event extends PostHogEventName>(
  event: Event,
  dedupKey: string,
  ...properties: PostHogEventPropertiesArgument<Event>
): void {
  journalSupportEvent(event, properties[0]);
  client.capturePostHogDailyEvent(event, dedupKey, ...properties);
}

/**
 * Keeps the sanitized outcome in the local support journal before the
 * analytics preference is consulted; the journal only leaves the device with a
 * feedback report the person chose to send with diagnostics.
 */
function journalSupportEvent(event: PostHogEventName, properties: unknown): void {
  const record = properties && typeof properties === "object" ? properties as Readonly<Record<string, unknown>> : undefined;
  recordSupportJournalEvent(event, sanitizePostHogEventProperties(event, record));
}

export function recordPostHogAuthState(user: PostHogUser | null): void {
  client.recordPostHogAuthState(user);
}

/** Keeps the signed-in account's plan on its PostHog person for update email targeting. */
export function recordPostHogAccountPlan(userId: string, plan: PostHogPersonPlan): void {
  client.recordPostHogAccountPlan(userId, plan);
}

function synchronizeProductAnalyticsPreference(): void {
  const changeSequence = preferenceChangeSequence + 1;
  preferenceChangeSequence = changeSequence;
  const enabled = readProductAnalyticsEnabled();
  client.handlePreferenceChange(enabled);
  initializationPromise = null;
  initializationScheduled = false;
  if (enabled) {
    // Finish the current event dispatch before creating the guard. This keeps
    // recovery correct even if another bundle registered its revision listener
    // after this client handler, and coalesces rapid off/on changes.
    queueMicrotask(() => {
      if (changeSequence !== preferenceChangeSequence || !readProductAnalyticsEnabled()) return;
      void initializePostHogClient();
    });
  }
}

if (typeof window !== "undefined") {
  // Register the preference module's revision listeners first. Otherwise this
  // handler can create a guard during an enable event, only for the later
  // preference listener to invalidate that guard in the same dispatch.
  readProductAnalyticsEnabled();
  window.addEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, synchronizeProductAnalyticsPreference);
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY) {
      synchronizeProductAnalyticsPreference();
    }
  });
}
