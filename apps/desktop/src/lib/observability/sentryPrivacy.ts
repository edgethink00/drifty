import type { Breadcrumb } from "@sentry/react";
import type { ErrorEvent, SpanJSON, TransactionEvent } from "@sentry/core";

export const FILTERED_VALUE = "[Filtered]";

const REDACTED_EMAIL = "[Email]";
const REDACTED_ID = "[Id]";
const REDACTED_SECRET = "[Secret]";
const MAX_RECURSION_DEPTH = 6;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const USER_PATH_PATTERN = /\/Users\/[^/\s)]+/g;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const SENSITIVE_QUERY_KEY_PATTERN = /(access_token|refresh_token|token|apikey|api_key|key|secret|code|state|session|password)/i;
const SENSITIVE_FIELD_PATTERN =
  /(authorization|cookie|password|secret|token|api[_-]?key|apikey|email|user[_-]?id|supabase[_-]?user|access[_-]?token|refresh[_-]?token|window[_-]?title|title|site[_-]?url|url[_-]?host|domain|app[_-]?name|bundle[_-]?id|timeline|segment|segments|activity|activities|payload|prompt|provider[_-]?response|request[_-]?body|response[_-]?body)/i;

export function redactSentryText(value: string): string {
  return value
    .replace(URL_PATTERN, (url) => sanitizeUrl(url))
    .replace(EMAIL_PATTERN, REDACTED_EMAIL)
    .replace(UUID_PATTERN, REDACTED_ID)
    .replace(USER_PATH_PATTERN, "/Users/[user]");
}

export function sanitizeSentryValue(value: unknown, key = "", depth = 0): unknown {
  if (isSensitiveFieldName(key)) return FILTERED_VALUE;
  if (depth > MAX_RECURSION_DEPTH) return FILTERED_VALUE;
  if (typeof value === "string") return redactSentryText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSentryValue(item, key, depth + 1));
  }
  if (isRecord(value)) {
    return sanitizeSentryRecord(value, depth + 1);
  }
  return FILTERED_VALUE;
}

export function sanitizeSentryEvent<EventType extends ErrorEvent | TransactionEvent>(event: EventType): EventType {
  event.user = undefined;
  event.request = undefined;
  event.contexts = undefined;
  event.message = sanitizeOptionalText(event.message);
  if (event.logentry?.message) {
    event.logentry = {
      ...event.logentry,
      message: redactSentryText(event.logentry.message),
    };
  }
  if (event.transaction) {
    event.transaction = redactSentryText(event.transaction);
  }
  if (event.exception?.values) {
    event.exception = {
      ...event.exception,
      values: event.exception.values.map((value) => {
        const stacktrace = value.stacktrace;
        return {
          ...value,
          type: sanitizeOptionalText(value.type),
          value: sanitizeOptionalText(value.value),
          stacktrace: stacktrace
            ? {
                ...stacktrace,
                frames: stacktrace.frames?.map((frame) => ({
                  ...frame,
                  filename: sanitizeOptionalText(frame.filename),
                  abs_path: sanitizeOptionalText(frame.abs_path),
                  function: sanitizeOptionalText(frame.function),
                })),
              }
            : stacktrace,
        };
      }),
    };
  }
  if (event.extra) {
    event.extra = sanitizeSentryRecord(event.extra);
  }
  if (event.tags) {
    event.tags = sanitizeSentryTags(event.tags);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(sanitizeSentryBreadcrumb).filter(isBreadcrumb);
  }
  return event;
}

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const category = breadcrumb.category ?? "";
  if (category === "ui.input" || category.includes("replay")) return null;
  return {
    ...breadcrumb,
    message: sanitizeOptionalText(breadcrumb.message),
    data: isRecord(breadcrumb.data) ? sanitizeSentryRecord(breadcrumb.data) : undefined,
  };
}

export function sanitizeSentrySpan(span: SpanJSON): SpanJSON {
  const data = { ...span.data };
  for (const key of Object.keys(data)) {
    data[key] = sanitizeSpanDataValue(data[key], key);
  }
  return {
    ...span,
    description: sanitizeOptionalText(span.description),
    op: sanitizeOptionalText(span.op),
    data,
  };
}

export function sanitizeSentryRecord(record: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    sanitized[key] = sanitizeSentryValue(value, key, depth + 1);
  }
  return sanitized;
}

export function sanitizeSentryTags(tags: Record<string, unknown>): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value === null || value === undefined) continue;
    if (isSensitiveFieldName(key)) {
      sanitized[key] = FILTERED_VALUE;
      continue;
    }
    if (typeof value === "string") {
      sanitized[key] = redactSentryText(value);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
      continue;
    }
    sanitized[key] = FILTERED_VALUE;
  }
  return sanitized;
}

function sanitizeUrl(rawUrl: string): string {
  const trailingPunctuation = rawUrl.match(/[),.;]+$/)?.[0] ?? "";
  const candidate = trailingPunctuation ? rawUrl.slice(0, -trailingPunctuation.length) : rawUrl;
  try {
    const url = new URL(candidate);
    const protocol = url.protocol;
    const origin =
      protocol === "file:"
        ? `${protocol}//[path]`
        : url.origin === "null"
          ? `${protocol}//${url.host}`
          : url.origin;
    return `${origin}${url.pathname}${trailingPunctuation}`;
  } catch {
    return REDACTED_SECRET;
  }
}

function sanitizeOptionalText(value: string | undefined): string | undefined {
  return typeof value === "string" ? redactSentryText(value) : value;
}

function sanitizeSpanDataValue(value: SpanJSON["data"][string], key: string): SpanJSON["data"][string] {
  if (isSensitiveFieldName(key)) return FILTERED_VALUE;
  if (typeof value === "string") return redactSentryText(value);
  if (Array.isArray(value)) {
    if (isNullableStringArray(value)) {
      return value.map((item) => (typeof item === "string" ? redactSentryText(item) : item));
    }
    if (isNullableNumberArray(value) || isNullableBooleanArray(value)) {
      return value;
    }
    return FILTERED_VALUE;
  }
  return value;
}

function isBreadcrumb(value: Breadcrumb | null): value is Breadcrumb {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveFieldName(key: string): boolean {
  return SENSITIVE_FIELD_PATTERN.test(key) || SENSITIVE_QUERY_KEY_PATTERN.test(key);
}

function isNullableStringArray(value: readonly unknown[]): value is Array<string | null | undefined> {
  return value.every((item) => typeof item === "string" || item === null || item === undefined);
}

function isNullableNumberArray(value: readonly unknown[]): value is Array<number | null | undefined> {
  return value.every((item) => typeof item === "number" || item === null || item === undefined);
}

function isNullableBooleanArray(value: readonly unknown[]): value is Array<boolean | null | undefined> {
  return value.every((item) => typeof item === "boolean" || item === null || item === undefined);
}
