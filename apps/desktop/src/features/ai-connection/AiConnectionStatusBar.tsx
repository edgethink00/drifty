import type { AiConnectionIssueKind } from "./aiConnectionHealth";

export type AiConnectionTone = "ok" | "warning" | "error" | "neutral";

export type AiConnectionStatus = {
  readonly tone: AiConnectionTone;
  readonly label: string;
  readonly providerLabel: string;
  readonly memoryLabel: string | null;
};

export type AiConnectionStatusInput = {
  readonly canUseCloudAi: boolean;
  readonly localProviderStatus: LocalAiProviderStatus;
  readonly localProviderLabel: string | null;
  readonly localMemoryLabel: string | null;
  readonly classificationRunning: boolean;
  readonly classificationIssueKind: AiConnectionIssueKind | null;
  readonly cloudIssueKind: AiConnectionIssueKind | null;
};

export type LocalAiProviderStatus =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "checking" }
  | { readonly kind: "connected" }
  | { readonly kind: "failed"; readonly issueKind: AiConnectionIssueKind };

export function resolveAiConnectionStatus(input: AiConnectionStatusInput): AiConnectionStatus {
  if (input.classificationIssueKind) {
    return {
      tone: toneForIssueKind(input.classificationIssueKind),
      label: labelForIssueKind(input.classificationIssueKind),
      providerLabel: input.localProviderLabel ?? "Drifty Cloud",
      memoryLabel: memoryLabelForLocalProvider(input),
    };
  }

  if (input.classificationRunning) {
    return {
      tone: "ok",
      label: "Running",
      providerLabel: input.localProviderLabel ?? "Drifty Cloud",
      memoryLabel: memoryLabelForLocalProvider(input),
    };
  }

  switch (input.localProviderStatus.kind) {
    case "connected":
      return {
        tone: "ok",
        label: "Connected",
        providerLabel: input.localProviderLabel ?? "Local AI",
        memoryLabel: memoryLabelForLocalProvider(input),
      };
    case "failed":
      return {
        tone: toneForIssueKind(input.localProviderStatus.issueKind),
        label: labelForIssueKind(input.localProviderStatus.issueKind),
        providerLabel: input.localProviderLabel ?? "Local AI",
        memoryLabel: memoryLabelForLocalProvider(input),
      };
    case "checking":
      return {
        tone: "neutral",
        label: "Checking",
        providerLabel: input.localProviderLabel ?? "Local AI",
        memoryLabel: memoryLabelForLocalProvider(input),
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
      providerLabel: "Drifty Cloud",
      memoryLabel: null,
    };
  }

  if (input.cloudIssueKind) {
    return {
      tone: toneForIssueKind(input.cloudIssueKind),
      label: labelForIssueKind(input.cloudIssueKind),
      providerLabel: "Drifty Cloud",
      memoryLabel: null,
    };
  }

  return {
    tone: "error",
    label: "Disconnected",
    providerLabel: "Setup needed",
    memoryLabel: null,
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
      aria-label={`AI connection: ${status.label}, ${status.providerLabel}${status.memoryLabel ? `, memory ${status.memoryLabel}` : ""}. Open AI settings`}
      data-tone={status.tone}
      onClick={onOpenSettings}
    >
      <span className="ai-connection-status__dot" aria-hidden="true" />
      <span className="ai-connection-status__label">{status.label}</span>
      <span className="ai-connection-status__provider">{status.providerLabel}</span>
      {status.memoryLabel ? <span className="ai-connection-status__memory" title={`Memory ${status.memoryLabel}`}>{status.memoryLabel}</span> : null}
    </button>
  );
}

function memoryLabelForLocalProvider(input: AiConnectionStatusInput): string | null {
  if (!input.localProviderLabel) return null;
  const trimmedLabel = input.localMemoryLabel?.trim() ?? "";
  return formatMemoryLabel(trimmedLabel);
}

function formatMemoryLabel(label: string): string | null {
  if (!label) return null;
  const match = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(label);
  if (!match) return label;
  const numericValue = Number(match[1]);
  if (!Number.isFinite(numericValue)) return label;
  const unitLabel = match[2]?.trim() ?? "";
  return unitLabel ? `${numericValue.toFixed(1)} ${unitLabel}` : numericValue.toFixed(1);
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
      return "Connection issue";
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
