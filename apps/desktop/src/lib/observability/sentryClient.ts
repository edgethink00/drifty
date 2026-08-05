export type SentryCaptureContext = {
  readonly tags?: Record<string, string>;
  readonly extra?: Record<string, unknown>;
};

type SentryRuntime = Pick<
  typeof import("./sentry"),
  "captureSentryException" | "initializeSentry"
>;

type PendingSentryException = {
  readonly error: unknown;
  readonly context?: SentryCaptureContext;
};

const MAX_PENDING_EXCEPTIONS = 20;
const SENTRY_IDLE_TIMEOUT_MS = 1_500;

let runtime: SentryRuntime | null = null;
let initializationPromise: Promise<boolean> | null = null;
let initializationScheduled = false;
const pendingExceptions: PendingSentryException[] = [];

function isSentryConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SENTRY_DSN?.trim())
    && import.meta.env.MODE !== "test"
    && typeof window !== "undefined";
}

export async function initializeSentryClient(): Promise<boolean> {
  if (runtime) return true;
  if (!isSentryConfigured()) return false;
  if (initializationPromise) return initializationPromise;

  initializationPromise = import("./sentry")
    .then((nextRuntime) => {
      if (!nextRuntime.initializeSentry()) {
        pendingExceptions.splice(0);
        return false;
      }

      runtime = nextRuntime;
      const queuedExceptions = pendingExceptions.splice(0);
      queuedExceptions.forEach(({ error, context }) => {
        nextRuntime.captureSentryException(error, context);
      });
      return true;
    })
    .catch((error) => {
      pendingExceptions.splice(0);
      if (import.meta.env.DEV) {
        console.warn(
          "[Sentry] Unable to load browser SDK.",
          error instanceof Error ? error.message : String(error),
        );
      }
      return false;
    });

  return initializationPromise;
}

export function scheduleSentryInitialization(): boolean {
  if (runtime || initializationScheduled || !isSentryConfigured()) return false;
  initializationScheduled = true;

  const initialize = () => {
    void initializeSentryClient();
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(initialize, { timeout: SENTRY_IDLE_TIMEOUT_MS });
  } else {
    window.setTimeout(initialize, 0);
  }
  return true;
}

export function captureSentryException(
  error: unknown,
  context?: SentryCaptureContext,
): boolean {
  if (runtime) return runtime.captureSentryException(error, context);
  if (!isSentryConfigured()) return false;

  if (pendingExceptions.length >= MAX_PENDING_EXCEPTIONS) pendingExceptions.shift();
  pendingExceptions.push({ error, context });

  // A startup failure cannot wait for the normal post-bootstrap idle callback.
  // Begin loading immediately and flush the bounded queue once the SDK is ready.
  void initializeSentryClient();
  return false;
}
