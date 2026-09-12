export type CloudAiBackoffStatus = 402 | 429;

export type CloudAiRequestBackoff = {
  readonly status: CloudAiBackoffStatus;
  readonly message: string;
  readonly retryAtMs: number;
};

const PAYMENT_REQUIRED_BACKOFF_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 2 * 60 * 1000;
const MINUTE_RATE_LIMIT_BACKOFF_MS = 60 * 1000;
const HOUR_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export class CloudAiRequestBackoffRegistry {
  readonly #entries = new Map<string, CloudAiRequestBackoff>();
  readonly #revisions = new Map<string, number>();

  current(key: string, nowMs = Date.now()): CloudAiRequestBackoff | null {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.retryAtMs > nowMs) return entry;
    this.#entries.delete(key);
    return null;
  }

  nextExpiryMs(nowMs = Date.now()): number | null {
    let next: number | null = null;
    for (const [key, entry] of [...this.#entries.entries()]) {
      if (entry.retryAtMs <= nowMs) {
        this.#entries.delete(key);
        continue;
      }
      if (next === null || entry.retryAtMs < next) next = entry.retryAtMs;
    }
    return next;
  }

  record(input: {
    readonly key: string;
    readonly status: CloudAiBackoffStatus;
    readonly message: string;
    readonly retryAfter?: string | null;
    readonly nowMs?: number;
  }): CloudAiRequestBackoff {
    const nowMs = input.nowMs ?? Date.now();
    const semanticRetryAtMs = semanticRetryAt(input.status, input.message, nowMs);
    const headerRetryAtMs = retryAfterAt(input.retryAfter, nowMs);
    const proposed = {
      status: input.status,
      message: input.message,
      retryAtMs: Math.max(semanticRetryAtMs, headerRetryAtMs ?? 0),
    } satisfies CloudAiRequestBackoff;
    const existing = this.current(input.key, nowMs);
    const entry = existing && existing.retryAtMs > proposed.retryAtMs ? existing : proposed;
    this.#entries.set(input.key, entry);
    this.#revisions.set(input.key, this.revision(input.key) + 1);
    return entry;
  }

  revision(key: string): number {
    return this.#revisions.get(key) ?? 0;
  }

  clear(key?: string, expectedRevision?: number): boolean {
    if (key === undefined) {
      const hadEntries = this.#entries.size > 0;
      this.#entries.clear();
      this.#revisions.clear();
      return hadEntries;
    }
    if (expectedRevision !== undefined && this.revision(key) !== expectedRevision) return false;
    const deleted = this.#entries.delete(key);
    this.#revisions.set(key, this.revision(key) + 1);
    return deleted;
  }
}

export const cloudAiRequestBackoffs = new CloudAiRequestBackoffRegistry();

export function cloudAiBackoffMessage(entry: CloudAiRequestBackoff, nowMs = Date.now()): string {
  const remainingMinutes = Math.max(1, Math.ceil((entry.retryAtMs - nowMs) / 60_000));
  return `Cloud AI classification is paused after HTTP ${entry.status}. Automatic requests resume in about ${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}. ${entry.message}`;
}

function semanticRetryAt(status: CloudAiBackoffStatus, message: string, nowMs: number): number {
  if (status === 402) return nowMs + PAYMENT_REQUIRED_BACKOFF_MS;

  const normalized = message.toLowerCase();
  if (normalized.includes("daily") || normalized.includes("tomorrow")) {
    const nextUtcDay = new Date(nowMs);
    nextUtcDay.setUTCHours(24, 1, 0, 0);
    return nextUtcDay.getTime();
  }
  if (normalized.includes("hourly")) return nowMs + HOUR_RATE_LIMIT_BACKOFF_MS;
  if (normalized.includes("minute")) return nowMs + MINUTE_RATE_LIMIT_BACKOFF_MS;
  return nowMs + DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

function retryAfterAt(value: string | null | undefined, nowMs: number): number | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    if (Number.isSafeInteger(seconds)) {
      return nowMs + Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }
  }

  const parsedDate = Date.parse(normalized);
  if (!Number.isFinite(parsedDate) || parsedDate <= nowMs) return null;
  return Math.min(parsedDate, nowMs + MAX_RETRY_AFTER_MS);
}

export function isDailyCloudQuotaBackoff(entry: CloudAiRequestBackoff): boolean {
  if (entry.status !== 429) return false;
  const normalized = entry.message.toLowerCase();
  return normalized.includes("daily") || normalized.includes("tomorrow");
}
