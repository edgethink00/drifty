import type { AdaptiveContextItem, AdaptiveSensitivityFlag } from "@drifty/domain";
import type { ContentContextDropReason } from "./contentContextEgressPolicy";

export type SanitizedValues = {
  readonly values: readonly string[];
  readonly reasons: readonly ContentContextDropReason[];
  readonly redactionCount: number;
};

const MAX_VALUES_PER_ITEM = 5;
const MAX_METADATA_VALUE_CHARS = 80;
const MAX_LABEL_VALUE_CHARS = 40;
const MAX_SHORT_HINT_CHARS = 240;

const BLOCKING_SENSITIVITY_FLAGS: ReadonlySet<AdaptiveSensitivityFlag> = new Set([
  "auth",
  "password",
  "payment",
  "message_body",
  "secret_like",
  "personal_identifier",
]);
const LOCAL_ONLY_SENSITIVITY_FLAGS: ReadonlySet<AdaptiveSensitivityFlag> = new Set(["health", "legal", "hr", "finance"]);
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PASSWORD_KEY_VALUE_PATTERN = /\b(?:password|pwd|passcode|credentials?)\b(?:\s*[:=]\s*|\s+)(?!reset\b|change\b|manager\b|policy\b|help\b|guidance\b|field\b|form\b|prompt\b|screen\b|page\b|required\b)["']?[A-Za-z0-9._/+=-]{4,32}["']?/gi;
const SHORT_SECRET_KEY_VALUE_PATTERN = /\b(?:pass|token|api[_ -]?key|secret|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token)\b(?:\s*[:=]\s*|\s+)(?!reset\b|change\b|manager\b|management\b|policy\b|help\b|guidance\b|field\b|form\b|prompt\b|screen\b|page\b|required\b|bucket\b|algorithm\b)["']?[A-Za-z0-9._/+=-]{4,32}["']?/gi;
const SECRET_PATTERN = /\b(?:api[_ -]?key|authorization|bearer|secret|token)\b\s*[:=]?\s*["']?[A-Za-z0-9._/+=-]{12,}/gi;
const KNOWN_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const ONE_TIME_CODE_PATTERN = /\b(?:otp|one[- ]?time code|2fa|mfa|verification code)\s*[:#-]?\s*\d{4,8}\b/gi;
const LONG_IDENTIFIER_PATTERN = /\b[A-Za-z0-9_-]{48,}\b|\b[A-Fa-f0-9]{32,}\b/g;
const CREDIT_CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const EMBEDDED_HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_URL_PUNCTUATION_PATTERN = /[),.;!?]+$/;

type SanitizedValue = {
  readonly value: string | null;
  readonly reasons: readonly ContentContextDropReason[];
  readonly redactionCount: number;
};

type SanitizedUrlText = {
  readonly value: string;
  readonly reason: ContentContextDropReason | null;
  readonly redacted: boolean;
};

export function sanitizeValues(item: AdaptiveContextItem): SanitizedValues {
  const values: string[] = [];
  const reasons: ContentContextDropReason[] = [];
  let redactionCount = 0;

  for (const [index, value] of item.values.entries()) {
    if (index >= MAX_VALUES_PER_ITEM) {
      reasons.push("max_values_exceeded");
      continue;
    }
    const sanitized = sanitizeValue(value, item);
    redactionCount += sanitized.redactionCount;
    reasons.push(...sanitized.reasons);
    if (sanitized.value) values.push(sanitized.value);
  }
  return { values, reasons, redactionCount };
}

export function sensitivityReasons(item: AdaptiveContextItem): readonly ContentContextDropReason[] {
  const reasons: ContentContextDropReason[] = [];
  if (item.kind === "messageBody" || item.values.some((value) => value.includes("document.body.innerText"))) {
    reasons.push("raw_collector_output");
  }
  if (item.sourceFamily === "communication_metadata"
    || item.sensitivity.some((flag) => BLOCKING_SENSITIVITY_FLAGS.has(flag) || LOCAL_ONLY_SENSITIVITY_FLAGS.has(flag))) {
    reasons.push("sensitive_surface");
  }
  return reasons;
}

export function sensitiveDecision(item: AdaptiveContextItem): "local_only" | "blocked" {
  return item.sensitivity.some((flag) => BLOCKING_SENSITIVITY_FLAGS.has(flag)) ? "blocked" : "local_only";
}

function sanitizeValue(value: string, item: AdaptiveContextItem): SanitizedValue {
  const reasons: ContentContextDropReason[] = [];
  const normalized = normalizeWhitespace(value);
  if (!normalized) return { value: null, reasons: ["empty_after_redaction"], redactionCount: 0 };
  if (PRIVATE_KEY_PATTERN.test(normalized)) return { value: null, reasons: ["private_key"], redactionCount: 1 };

  const urlValue = sanitizeEmbeddedUrls(normalized);
  const urlReasons = urlValue.reason ? [urlValue.reason] : [];
  reasons.push(...urlReasons);
  let redactionCount = urlValue.redacted ? 1 : 0;
  let redacted = urlValue.value.replace(PASSWORD_KEY_VALUE_PATTERN, () => {
    redactionCount += 1;
    reasons.push("secret_like_value");
    return "[redacted]";
  });
  redacted = redacted.replace(SHORT_SECRET_KEY_VALUE_PATTERN, () => {
    redactionCount += 1;
    reasons.push("secret_like_value");
    return "[redacted]";
  });
  redacted = redacted.replace(SECRET_PATTERN, () => {
    redactionCount += 1;
    reasons.push("secret_like_value");
    return "[redacted]";
  });
  redacted = redacted.replace(KNOWN_TOKEN_PATTERN, () => {
    redactionCount += 1;
    reasons.push("secret_like_value");
    return "[redacted]";
  });
  redacted = redacted.replace(SSN_PATTERN, () => {
    redactionCount += 1;
    reasons.push("ssn");
    return "[redacted]";
  });
  redacted = redacted.replace(ONE_TIME_CODE_PATTERN, () => {
    redactionCount += 1;
    reasons.push("one_time_code");
    return "[redacted]";
  });
  redacted = redactCreditCards(redacted, reasons, () => {
    redactionCount += 1;
  });
  redacted = redacted.replace(LONG_IDENTIFIER_PATTERN, () => {
    redactionCount += 1;
    reasons.push("long_identifier");
    return "[redacted]";
  });

  const truncated = truncateValue(normalizeWhitespace(redacted), maxCharsForItem(item));
  if (!truncated.value || truncated.value === "[redacted]") {
    return { value: null, reasons: [...reasons, "empty_after_redaction"], redactionCount };
  }
  return {
    value: truncated.value,
    reasons: truncated.truncated ? [...reasons, "text_truncated"] : reasons,
    redactionCount,
  };
}

function sanitizeEmbeddedUrls(value: string): SanitizedUrlText {
  let reason: ContentContextDropReason | null = null;
  let redacted = false;
  const sanitized = value.replace(EMBEDDED_HTTP_URL_PATTERN, (candidate) => {
    const sanitizedUrl = sanitizeUrlCandidate(candidate);
    if (sanitizedUrl.reason) reason = sanitizedUrl.reason;
    redacted = redacted || sanitizedUrl.redacted;
    return sanitizedUrl.value;
  });
  return { value: sanitized, reason, redacted };
}

function sanitizeUrlCandidate(candidate: string): SanitizedUrlText {
  const { urlText, trailingText } = splitTrailingUrlPunctuation(candidate);
  try {
    const url = new URL(urlText);
    const redacted = Boolean(url.username || url.password || url.search || url.hash);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return {
      value: `${url.protocol}//${url.host}${url.pathname}${trailingText}`,
      reason: redacted ? "secret_like_value" : null,
      redacted,
    };
  } catch (error) {
    if (error instanceof TypeError) return { value: trailingText, reason: "invalid_url", redacted: true };
    throw error;
  }
}

function splitTrailingUrlPunctuation(candidate: string): { readonly urlText: string; readonly trailingText: string } {
  const match = candidate.match(TRAILING_URL_PUNCTUATION_PATTERN);
  if (!match) return { urlText: candidate, trailingText: "" };
  const trailingText = match[0];
  return { urlText: candidate.slice(0, -trailingText.length), trailingText };
}

function redactCreditCards(value: string, reasons: ContentContextDropReason[], onRedact: () => void): string {
  return value.replace(CREDIT_CARD_PATTERN, (candidate) => {
    if (!isLikelyCreditCard(candidate)) return candidate;
    reasons.push("credit_card");
    onRedact();
    return "[redacted]";
  });
}

function isLikelyCreditCard(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = Number(digits[index]);
    if (!Number.isInteger(digit)) return false;
    const addend = shouldDouble ? digit * 2 : digit;
    sum += addend > 9 ? addend - 9 : addend;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function maxCharsForItem(item: AdaptiveContextItem): number {
  if (item.depth === 3) return MAX_SHORT_HINT_CHARS;
  return item.kind === "tag" || item.kind === "label" || item.kind === "status"
    ? MAX_LABEL_VALUE_CHARS
    : MAX_METADATA_VALUE_CHARS;
}

function truncateValue(value: string, maxChars: number): { readonly value: string; readonly truncated: boolean } {
  if (value.length <= maxChars) return { value, truncated: false };
  return { value: value.slice(0, maxChars).trim(), truncated: true };
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
