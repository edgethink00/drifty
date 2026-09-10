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
