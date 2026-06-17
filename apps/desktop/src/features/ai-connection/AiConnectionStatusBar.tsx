import type { AiConnectionIssueKind } from "./aiConnectionHealth";

export type AiConnectionTone = "ok" | "warning" | "error" | "neutral";

export type AiConnectionStatus = {
  readonly tone: AiConnectionTone;
  readonly label: string;
  readonly providerLabel: string;
};

export type AiConnectionStatusInput = {
  readonly canUseCloudAi: boolean;
  readonly localProviderStatus: LocalAiProviderStatus;
  readonly localProviderLabel: "BYOK AI" | "Local AI" | null;
  readonly classificationRunning: boolean;
  readonly classificationIssueKind: AiConnectionIssueKind | null;
  readonly cloudIssueKind: AiConnectionIssueKind | null;
};

export type LocalAiProviderStatus =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "test_needed" }
  | { readonly kind: "connected" }
  | { readonly kind: "failed"; readonly issueKind: AiConnectionIssueKind };

export function resolveAiConnectionStatus(input: AiConnectionStatusInput): AiConnectionStatus {
  if (input.classificationIssueKind) {
    return {
      tone: toneForIssueKind(input.classificationIssueKind),
      label: labelForIssueKind(input.classificationIssueKind),
      providerLabel: input.localProviderLabel ?? "Cloud AI",
    };
  }

  if (input.classificationRunning) {
    return {
      tone: "ok",
      label: "Running",
      providerLabel: input.localProviderLabel ?? "Cloud AI",
    };
  }

  switch (input.localProviderStatus.kind) {
    case "connected":
      return {
        tone: "ok",
        label: "Connected",
        providerLabel: input.localProviderLabel ?? "Local AI",
      };
    case "failed":
      return {
        tone: toneForIssueKind(input.localProviderStatus.issueKind),
        label: labelForIssueKind(input.localProviderStatus.issueKind),
        providerLabel: input.localProviderLabel ?? "Local AI",
      };
    case "test_needed":
      return {
        tone: "neutral",
        label: "Test needed",
        providerLabel: input.localProviderLabel ?? "Local AI",
      };
    case "unconfigured":
      break;
    default:
      return assertNever(input.localProviderStatus);
  }

  if (input.canUseCloudAi) {
    return {
      tone: "ok",
      label: "Connected",
      providerLabel: "Cloud AI",
    };
  }

  if (input.cloudIssueKind) {
    return {
      tone: toneForIssueKind(input.cloudIssueKind),
      label: labelForIssueKind(input.cloudIssueKind),
      providerLabel: "Cloud AI",
    };
  }

  return {
    tone: "error",
    label: "Disconnected",
    providerLabel: "Setup needed",
  };
}

export function AiConnectionStatusBar({
  status,
  onOpenSettings,
}: {
  readonly status: AiConnectionStatus;
  readonly onOpenSettings: () => void;
}) {
  return (
    <button
      type="button"
      className="ai-connection-status"
      aria-label={`AI connection: ${status.label}, ${status.providerLabel}. Open AI settings`}
      data-tone={status.tone}
      onClick={onOpenSettings}
    >
      <span className="ai-connection-status__dot" aria-hidden="true" />
      <span className="ai-connection-status__label">{status.label}</span>
      <span className="ai-connection-status__provider">{status.providerLabel}</span>
    </button>
  );
}

function toneForIssueKind(issueKind: AiConnectionIssueKind): AiConnectionTone {
  switch (issueKind) {
    case "network":
      return "warning";
    case "provider":
      return "error";
    default:
      return assertNever(issueKind);
  }
}

function labelForIssueKind(issueKind: AiConnectionIssueKind): string {
  switch (issueKind) {
    case "network":
      return "Network issue";
    case "provider":
      return "Issue";
    default:
      return assertNever(issueKind);
  }
}

class AiConnectionStatusError extends Error {
  constructor(readonly value: string) {
    super(`Unhandled AI connection status: ${value}`);
    this.name = "AiConnectionStatusError";
  }
}

function assertNever(value: never): never {
  throw new AiConnectionStatusError(String(value));
}
