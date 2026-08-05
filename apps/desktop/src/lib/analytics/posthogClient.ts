import {
  type PostHogEventName,
  type PostHogEventPropertiesArgument,
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
  readonly id: string;
  readonly is_anonymous?: boolean | null;
};

export type PostHogClientRuntime = Pick<
  typeof import("./posthog"),
  "capturePostHogEvent" | "initializePostHog" | "recordPostHogAuthState"
>;

type PendingPostHogOperation = (runtime: PostHogClientRuntime) => void;

const MAX_PENDING_OPERATIONS = 100;
const POSTHOG_IDLE_TIMEOUT_MS = 1_500;

export function createDeferredPostHogClient(maxPendingOperations = MAX_PENDING_OPERATIONS) {
  let runtime: PostHogClientRuntime | null = null;
  const pendingOperations: PendingPostHogOperation[] = [];

  const enqueue = (operation: PendingPostHogOperation) => {
    if (runtime) {
      operation(runtime);
      return;
    }

    if (pendingOperations.length >= maxPendingOperations) pendingOperations.shift();
    pendingOperations.push(operation);
  };

  return {
    connect(nextRuntime: PostHogClientRuntime): boolean {
      const enabled = nextRuntime.initializePostHog();
      runtime = nextRuntime;
      pendingOperations.splice(0).forEach((operation) => operation(nextRuntime));
      return enabled;
    },
    clearPending(): void {
      pendingOperations.splice(0);
    },
    capturePostHogEvent<Event extends PostHogEventName>(
      event: Event,
      ...properties: PostHogEventPropertiesArgument<Event>
    ): void {
      enqueue((nextRuntime) => {
        nextRuntime.capturePostHogEvent(event, ...properties);
      });
    },
    recordPostHogAuthState(user: PostHogUser | null): void {
      const userSnapshot = user
        ? { id: user.id, is_anonymous: user.is_anonymous }
        : null;
      enqueue((nextRuntime) => {
        nextRuntime.recordPostHogAuthState(userSnapshot);
      });
    },
  };
}

const client = createDeferredPostHogClient();
let initializationPromise: Promise<boolean> | null = null;
let initializationScheduled = false;

export function initializePostHogClient(): Promise<boolean> {
  if (initializationPromise) return initializationPromise;

  initializationPromise = import("./posthog")
    .then((runtime) => client.connect(runtime))
    .catch((error) => {
      client.clearPending();
      if (import.meta.env.DEV) {
        console.warn(
          "[PostHog] Unable to load analytics runtime.",
          error instanceof Error ? error.message : String(error),
        );
      }
      return false;
    });

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
  client.capturePostHogEvent(event, ...properties);
}

export function recordPostHogAuthState(user: PostHogUser | null): void {
  client.recordPostHogAuthState(user);
}
