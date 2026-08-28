const PROMO_HANDOFF_STORAGE_KEY = "drifty:billing:promo-handoff:v1";
const PROMO_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;

type StoredPromoHandoff = {
  readonly receivedAt: number;
};

export type BillingSuccessSource = "promo" | null;

export function storePendingPromoHandoff(receivedAt = Date.now()): void {
  try {
    window.localStorage.setItem(PROMO_HANDOFF_STORAGE_KEY, JSON.stringify({ receivedAt } satisfies StoredPromoHandoff));
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}

export function hasPendingPromoHandoff(now = Date.now()): boolean {
  try {
    const stored = window.localStorage.getItem(PROMO_HANDOFF_STORAGE_KEY);
    if (!stored) return false;
    const parsed: unknown = JSON.parse(stored);
    if (!isStoredPromoHandoff(parsed) || now - parsed.receivedAt > PROMO_HANDOFF_TTL_MS || parsed.receivedAt > now + 60_000) {
      window.localStorage.removeItem(PROMO_HANDOFF_STORAGE_KEY);
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

export function clearPendingPromoHandoff(): void {
  try {
    window.localStorage.removeItem(PROMO_HANDOFF_STORAGE_KEY);
  } catch (error) {
    if (error instanceof Error) return;
    throw error;
  }
}

export function readBillingSuccessDeepLink(value: string): { readonly source: BillingSuccessSource } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "drifty:" || url.hostname !== "billing" || !["/success", "/success/"].includes(url.pathname)) {
      return null;
    }
    return { source: url.searchParams.get("source") === "promo" ? "promo" : null };
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function isStoredPromoHandoff(value: unknown): value is StoredPromoHandoff {
  return typeof value === "object"
    && value !== null
    && typeof (value as Partial<StoredPromoHandoff>).receivedAt === "number"
    && Number.isFinite((value as Partial<StoredPromoHandoff>).receivedAt);
}
