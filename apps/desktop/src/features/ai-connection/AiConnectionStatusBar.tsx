export type AiConnectionTone = "ok" | "error" | "neutral";

export type AiConnectionStatus = {
  readonly tone: AiConnectionTone;
  readonly label: string;
  readonly providerLabel: string;
};

export type AiConnectionStatusInput = {
  readonly canUseCloudAi: boolean;
  readonly hasLocalAiProvider: boolean;
  readonly localProviderLabel: "BYOK AI" | "Local AI" | null;
  readonly classificationRunning: boolean;
  readonly classificationError: string | null;
  readonly cloudError: string | null;
};

export function resolveAiConnectionStatus(input: AiConnectionStatusInput): AiConnectionStatus {
  if (input.classificationError) {
    return {
      tone: "error",
      label: "Issue",
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

  if (input.hasLocalAiProvider) {
    return {
      tone: "ok",
      label: "Connected",
      providerLabel: input.localProviderLabel ?? "Local AI",
    };
  }

  if (input.canUseCloudAi) {
    return {
      tone: "ok",
      label: "Connected",
      providerLabel: "Cloud AI",
    };
  }

  if (input.cloudError) {
    return {
      tone: "error",
      label: "Issue",
      providerLabel: "Cloud AI",
    };
  }

  return {
    tone: "neutral",
    label: "Disconnected",
    providerLabel: "Setup needed",
  };
}

export function AiConnectionStatusBar({ status }: { readonly status: AiConnectionStatus }) {
  return (
    <div className="ai-connection-status" role="group" aria-label="AI connection" data-tone={status.tone}>
      <span className="ai-connection-status__dot" aria-hidden="true" />
      <span className="ai-connection-status__label">{status.label}</span>
      <span className="ai-connection-status__provider">{status.providerLabel}</span>
    </div>
  );
}
