import type { AnalysisProvider } from "../settings/analysisModelSetup";

export const ACTIVITY_LABEL_REQUEST_BUDGET_STORAGE_KEY = "drifty.activityBlockLabels.dailyRequests.v1";

/**
 * Labels are a convenience, so they get their own small daily request budget.
 * Drifty Cloud counts card requests in their own server pool (up to 72 a day
 * across devices); the lower per-device cap keeps Cloud spending small.
 * Windows of 30 to 60 minutes (2026-10-29) take about 16 requests on a 7.5-hour
 * day and 22 on the busiest of four weeks of the owner's records, so a device
 * gets 36.
 */
export const ACTIVITY_LABEL_DAILY_REQUEST_LIMIT: Readonly<Record<"cloud" | "other", number>> = {
  cloud: 36,
  other: 80,
};

type BudgetRecord = { readonly day: string; readonly requests: number };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRecord(store: Storage, day: string): BudgetRecord {
  try {
    const parsed: unknown = JSON.parse(store.getItem(ACTIVITY_LABEL_REQUEST_BUDGET_STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed === "object" && "day" in parsed && "requests" in parsed) {
      const record = parsed as { day: unknown; requests: unknown };
      if (record.day === day && typeof record.requests === "number" && Number.isFinite(record.requests)) {
        return { day, requests: Math.max(0, record.requests) };
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return { day, requests: 0 };
}

/** Reserves one provider request for today; false when today's budget is spent. */
export function consumeActivityLabelRequest(provider: AnalysisProvider, day: string, store: Storage | null = storage()): boolean {
  if (!store) return false;
  const limit = provider === "cloud" ? ACTIVITY_LABEL_DAILY_REQUEST_LIMIT.cloud : ACTIVITY_LABEL_DAILY_REQUEST_LIMIT.other;
  const record = readRecord(store, day);
  if (record.requests >= limit) return false;
  store.setItem(ACTIVITY_LABEL_REQUEST_BUDGET_STORAGE_KEY, JSON.stringify({ day, requests: record.requests + 1 }));
  return true;
}

