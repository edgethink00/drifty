import type { Translate } from "../localization/translate";
import type { TranslationKey } from "../localization/translations";
import { AUTH_PASSWORD_POLICY } from "./authPasswordPolicy";

export type AuthErrorKind =
  | "network"
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "userExists"
  | "weakPassword"
  | "rateLimited"
  | "unavailable"
  | "expired";

const MESSAGE_KEYS: Readonly<Record<AuthErrorKind, TranslationKey>> = {
  network: "auth.modal.error.network",
  invalidCredentials: "auth.modal.error.invalidCredentials",
  emailNotConfirmed: "auth.modal.error.emailNotConfirmed",
  userExists: "auth.modal.error.userExists",
  weakPassword: "auth.modal.error.weakPassword",
  rateLimited: "auth.modal.error.rateLimited",
  unavailable: "auth.modal.error.unavailable",
  expired: "auth.modal.error.expired",
};

/**
 * Recognizes the sign-in failures a person can act on. Supabase reports them
 * with an English message and, on newer servers, a stable code; the client
 * adds its own English messages for offline and unconfigured states.
 */
export function classifyAuthError(error: unknown): AuthErrorKind | null {
  if (!error) return null;
  const fields = error as { readonly message?: unknown; readonly code?: unknown; readonly status?: unknown; readonly name?: unknown };
  const message = typeof fields.message === "string" ? fields.message : typeof error === "string" ? error : "";
  const code = typeof fields.code === "string" ? fields.code.toLowerCase() : "";
  const status = typeof fields.status === "number" ? fields.status : null;
  const name = typeof fields.name === "string" ? fields.name : "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) return "invalidCredentials";
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) return "emailNotConfirmed";
  if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered|user already exists/i.test(message)) return "userExists";
  if (code === "weak_password" || /weak password|password should be|password.+least|at least \d+ characters/i.test(message)) return "weakPassword";
  if (status === 429 || code.includes("rate_limit") || /rate limit|too many requests/i.test(message)) return "rateLimited";
  if (/expired/i.test(message)) return "expired";
  if (name === "AuthRetryableFetchError" || /failed to fetch|load failed|networkerror|network request failed|fetch failed|is offline|timed out/i.test(message)) return "network";
  if (/supabase is not configured/i.test(message)) return "unavailable";
  return null;
}

export type DescribedAuthError = {
  /** The line the person reads, in the app language. */
  readonly message: string;
  /** The original wording when it was not recognized, kept for hover and assistive technology. */
  readonly detail: string | null;
};

export function describeAuthError(error: unknown, t: Translate, fallback: string): DescribedAuthError {
  const kind = classifyAuthError(error);
  if (kind) {
    return {
      message: t(MESSAGE_KEYS[kind], kind === "weakPassword" ? { count: AUTH_PASSWORD_POLICY.minLength } : undefined),
      detail: null,
    };
  }
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return { message: fallback, detail: raw && raw !== fallback ? raw : null };
}

