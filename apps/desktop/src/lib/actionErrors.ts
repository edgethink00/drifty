import type { Translate } from "../features/localization/translate";
import type { TranslationKey } from "../features/localization/translations";

/**
 * A failed request, ready to show. `message` is the line the person reads in
 * the app language; `detail` is the original wording (tracker, database or
 * network), kept for hover, assistive technology and support, never as the
 * visible line. The tracker and the network report in English, so showing them
 * raw put "database is locked" or "Failed to fetch" on a Korean screen.
 */
export type DescribedActionError = {
  readonly message: string;
  readonly detail: string | null;
};

export function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object" && typeof (error as { readonly message?: unknown }).message === "string") {
    return ((error as { readonly message: string }).message).trim();
  }
  return "";
}

/** An action-specific failure line (what did not happen) with the original wording as detail. */
export function describeActionError(error: unknown, failedLine: string): DescribedActionError {
  const raw = rawErrorMessage(error);
  return { message: failedLine, detail: raw && raw !== failedLine ? raw : null };
}

export type BackgroundErrorKind = "storageBusy" | "timeout" | "network" | "trackerUnavailable";

const BACKGROUND_KEYS: Readonly<Record<BackgroundErrorKind | "generic", TranslationKey>> = {
  storageBusy: "shell.error.storageBusy",
  timeout: "shell.error.timeout",
  network: "shell.error.network",
  trackerUnavailable: "shell.error.trackerUnavailable",
  generic: "shell.error.generic",
};

/** Recognizes the causes a person can act on when no action-specific line exists. */
export function classifyBackgroundError(error: unknown): BackgroundErrorKind | null {
  const message = rawErrorMessage(error);
  if (!message) return null;
  if (/database (table )?is (locked|busy)|sqlite_busy/i.test(message)) return "storageBusy";
  if (/timed? ?out|timeout/i.test(message)) return "timeout";
  if (/failed to fetch|load failed|network ?error|network request failed|fetch failed|is offline|econnrefused|enotfound/i.test(message)) return "network";
  if (/tracker is not available|tracker (is )?not running|run the desktop app/i.test(message)) return "trackerUnavailable";
  return null;
}

/** For the app-wide notice, which only knows that something in the background failed. */
export function describeBackgroundError(error: unknown, t: Translate): DescribedActionError {
  const kind = classifyBackgroundError(error);
  return describeActionError(error, t(BACKGROUND_KEYS[kind ?? "generic"]));
}
