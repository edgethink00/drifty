/**
 * Why a request through the person's own Claude Code or Codex CLI failed.
 *
 * Each reason has exactly one message. Connection health, analytics and the
 * recovery copy read the reason back from that message, so a CLI that has
 * signed out is never reported as a network problem or a usage limit.
 */
export type CliAiFailureReason =
  | "not_installed"
  | "authentication"
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "unavailable"
  | "cancelled";

export const CLI_FAILURE_MESSAGES: Readonly<Record<CliAiFailureReason, string>> = {
  not_installed: "The CLI is not installed on this computer.",
  authentication: "Sign in to your CLI and retry.",
  rate_limited: "The CLI usage limit was reached. Retry when your provider allows it.",
  timeout: "CLI analysis timed out. Try again.",
  invalid_response: "The CLI did not return usable JSON. Try again.",
  unavailable: "The CLI could not finish. Check its sign-in and usage limit, then retry.",
  cancelled: "AI request cancelled.",
};

/** The connection test's own wording for a probe that answered with the wrong shape. */
export const CLI_INVALID_PROBE_MESSAGE = "The CLI did not return a usable classification. Try again.";

/** The native runner's message when the CLI executable cannot be found. */
const NOT_INSTALLED_PATTERN = /\bis not installed or not on this computer's PATH\b/u;

/**
 * The CLI failure a message reports, or null for any other provider's message.
 * Cancellation shares its wording with other providers, so it is not read back.
 */
export function cliFailureReasonFromMessage(message: string | null | undefined): CliAiFailureReason | null {
  const value = message?.trim() ?? "";
  if (!value) return null;
  if (value === CLI_INVALID_PROBE_MESSAGE) return "invalid_response";
  if (NOT_INSTALLED_PATTERN.test(value)) return "not_installed";
  for (const reason of ["not_installed", "authentication", "rate_limited", "timeout", "invalid_response", "unavailable"] as const) {
    if (value === CLI_FAILURE_MESSAGES[reason]) return reason;
  }
  return null;
}

/** Whether an error thrown by the native runner means the CLI is missing. */
export function isCliNotInstalledMessage(message: string): boolean {
  return NOT_INSTALLED_PATTERN.test(message);
}

