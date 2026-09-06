export const PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY = "drifty.privacy.productAnalytics.v1";
export const PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT = "drifty:product-analytics-preference-changed";

type AnalyticsPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

let preferenceRevision = 0;
let failClosedForSession = false;
let preferenceListenersInstalled = false;

function notePreferenceChange(): void {
  preferenceRevision += 1;
}

function installPreferenceListeners(): void {
  if (preferenceListenersInstalled || typeof window === "undefined") return;
  preferenceListenersInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY) {
      notePreferenceChange();
    }
  });
}

export function readProductAnalyticsEnabled(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): boolean {
  installPreferenceListeners();
  if (failClosedForSession || !storage) return false;
  try {
    return storage.getItem(PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY) !== "0";
  } catch {
    return false;
  }
}

export function writeProductAnalyticsEnabled(
  enabled: boolean,
  storage: AnalyticsPreferenceStorage | null = safeStorage(),
): boolean {
  installPreferenceListeners();
  try {
    if (!storage) throw new Error("Product analytics preference storage is unavailable.");
    const storedValue = enabled ? "1" : "0";
    storage.setItem(PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY, storedValue);
    if (storage.getItem(PRODUCT_ANALYTICS_PREFERENCE_STORAGE_KEY) !== storedValue) {
      throw new Error("Product analytics preference was not persisted.");
    }
    failClosedForSession = false;
  } catch {
    failClosedForSession = true;
    announcePreferenceChange(false);
    return false;
  }

  announcePreferenceChange(enabled);
  return enabled;
}

/**
 * Captures both the enabled state and its revision. A delivery started before
 * an opt-out stays revoked even if analytics is enabled again before sending.
 */
export function createProductAnalyticsDeliveryGuard(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): () => boolean {
  installPreferenceListeners();
  const enabledAtCreation = readProductAnalyticsEnabled(storage);
  const revisionAtCreation = preferenceRevision;
  return () => enabledAtCreation
    && preferenceRevision === revisionAtCreation
    && readProductAnalyticsEnabled(storage);
}

/** Local revocation epoch; never persisted or transmitted. */
export function readProductAnalyticsRevision(): number {
  installPreferenceListeners();
  return preferenceRevision;
}

function announcePreferenceChange(enabled: boolean): void {
  // Invalidate existing delivery guards before any consumer handles the
  // notification. Event-listener registration order must not decide whether a
  // newly enabled client can create a valid guard during this dispatch.
  notePreferenceChange();
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, { detail: enabled }));
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
