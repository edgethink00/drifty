import type { AiConnectionIssueKind } from "../ai-connection/aiConnectionHealth";

export type LocalAiClassificationFailure = {
  readonly message: string;
  readonly failureKind: "transport" | "content";
  readonly usedAiProvider: boolean;
  // Keep classification semantics separate from connection-health evidence:
  // a 2xx response with malformed content proves reachability, while an HTTP
  // authentication/model/provider rejection still means the configured route
  // is unusable even though the provider answered.
  readonly connectionEvidence: "reachable" | "failure" | "none";
  // The structured cause, when the provider gave us one. Carried on the error
  // so telemetry does not have to re-derive it by matching the message text.
  readonly issueKind?: AiConnectionIssueKind;
};

export class LocalAiClassificationError extends Error {
  readonly localAiClassificationFailure = true;
  readonly failureKind: LocalAiClassificationFailure["failureKind"];
  readonly usedAiProvider: boolean;
  readonly connectionEvidence: LocalAiClassificationFailure["connectionEvidence"];
  readonly retryWithSmallerBatch: boolean;
  readonly issueKind?: AiConnectionIssueKind;
  /** Set only for the managed runtime's pre-generation context budget refusal. */
  contextBudgetExceeded = false;

  constructor(failure: LocalAiClassificationFailure, retryWithSmallerBatch = false) {
    super(failure.message);
    this.name = "LocalAiClassificationError";
    this.failureKind = failure.failureKind;
    this.usedAiProvider = failure.usedAiProvider;
    this.connectionEvidence = failure.connectionEvidence;
    this.retryWithSmallerBatch = retryWithSmallerBatch;
    this.issueKind = failure.issueKind;
  }
}

export function localAiTransportError(error: unknown): LocalAiClassificationError {
  return new LocalAiClassificationError({
    message: messageFromUnknownError(error, "Local AI classification could not reach the provider."),
    failureKind: "transport",
    usedAiProvider: false,
    connectionEvidence: "failure",
  });
}

export function localAiProviderResponseError(
  message: string,
  issueKind?: AiConnectionIssueKind,
): LocalAiClassificationError {
  return new LocalAiClassificationError({
    message,
    failureKind: "content",
    usedAiProvider: true,
    connectionEvidence: "failure",
    issueKind,
  });
}

export function localAiContextBudgetResponseError(
  response: { readonly status?: unknown; readonly body?: unknown },
): LocalAiClassificationError | null {
  if (response.status !== 400 || typeof response.body !== "string") return null;
  try {
    const body: unknown = JSON.parse(response.body);
    if (!body || typeof body !== "object" || !("error" in body)) return null;
    const error = body.error;
    if (!error || typeof error !== "object" || !("code" in error)
      || error.code !== "drifty_context_budget_exceeded") return null;
    const budgetError = new LocalAiClassificationError({
      message: "Local AI request exceeds its context window, including the output token budget.",
      failureKind: "content",
      usedAiProvider: true,
      connectionEvidence: "reachable",
    }, true);
    budgetError.contextBudgetExceeded = true;
    return budgetError;
  } catch {
    return null;
  }
}

export function isLocalAiContextBudgetError(error: unknown): error is LocalAiClassificationError {
  return isLocalAiClassificationError(error) && error.contextBudgetExceeded === true;
}

/** Shown (translated) when one activity still exceeds the window after shortening category descriptions. */
export const LOCAL_AI_SINGLE_ITEM_CONTEXT_BUDGET_MESSAGE = "Local AI request exceeds its context window, including the output token budget, even after shortening category descriptions. Remove some custom categories or shorten their descriptions, or turn off optional AI data sharing in Privacy & Data, then try again.";

/** A single activity that still exceeds the window after shortening category descriptions. */
export function localAiSingleItemContextBudgetError(): LocalAiClassificationError {
  const error = new LocalAiClassificationError({
    message: LOCAL_AI_SINGLE_ITEM_CONTEXT_BUDGET_MESSAGE,
    failureKind: "content",
    usedAiProvider: true,
    connectionEvidence: "reachable",
  });
  error.contextBudgetExceeded = true;
  return error;
}

export function localAiInvalidResponseError(error: unknown): LocalAiClassificationError {
  const detail = messageFromUnknownError(error, "The response was not valid JSON.");
  return new LocalAiClassificationError({
    message: `Local AI returned an invalid or incomplete response. ${detail}`,
    failureKind: "content",
    usedAiProvider: true,
    connectionEvidence: "reachable",
  }, true);
}

export function shouldRetryLocalAiWithSmallerBatch(error: unknown): boolean {
  return isLocalAiClassificationError(error) && error.retryWithSmallerBatch === true;
}

export function describeLocalAiClassificationFailure(error: unknown): LocalAiClassificationFailure {
  if (isLocalAiClassificationError(error)) {
    return {
      message: error.message,
      failureKind: error.failureKind,
      usedAiProvider: error.usedAiProvider,
      connectionEvidence: error.connectionEvidence,
      ...(error.issueKind ? { issueKind: error.issueKind } : {}),
    };
  }

  // Unknown application/tracker failures are not evidence that the provider
  // disconnected. Keep the user-facing error, but leave connection health
  // unchanged until typed connection evidence or a direct probe says otherwise.
  return {
    message: messageFromUnknownError(error, "Local AI classification failed."),
    failureKind: "content",
    usedAiProvider: false,
    connectionEvidence: "none",
  };
}

function isLocalAiClassificationError(error: unknown): error is LocalAiClassificationError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<LocalAiClassificationError>;
  return candidate.localAiClassificationFailure === true
    && (candidate.failureKind === "transport" || candidate.failureKind === "content")
    && typeof candidate.usedAiProvider === "boolean"
    && (candidate.connectionEvidence === "reachable" || candidate.connectionEvidence === "failure" || candidate.connectionEvidence === "none")
    && typeof candidate.retryWithSmallerBatch === "boolean"
    && typeof candidate.message === "string";
}

function messageFromUnknownError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}
