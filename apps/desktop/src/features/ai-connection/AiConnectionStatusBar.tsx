import type { AiConnectionIssueKind } from "./aiConnectionHealth";
import { localizeAiStatusLabel } from "../localization/aiStatusTranslations";
import { useLocalization } from "../localization/LocalizationContext";

export type AiConnectionTone = "ok" | "warning" | "error" | "neutral";

/** Ambient activity accent for the pill; "classifying" drives the pulsing dot. */
export type AiConnectionActivity = "classifying";

export type AiConnectionStatus = {
  readonly tone: AiConnectionTone;
  readonly label: string;
  readonly providerLabel: string;
  readonly memoryLabel: string | null;
  /** Machine-readable cause for recovery copy; null for healthy/setup states. */
  readonly issueKind: AiConnectionIssueKind | null;
  readonly activity?: AiConnectionActivity;
};

export type AiConnectionStatusInput = {
  readonly canUseCloudAi: boolean;
  readonly localProviderStatus: LocalAiProviderStatus;
  readonly localProviderLabel: string | null;
  readonly localMemoryUsageBytes: number | null;
  readonly classificationRunning: boolean;
  /** Best-effort count of segments still to classify for the active run; null if unknown. */
  readonly classificationRemaining?: number | null;
  readonly classificationIssueKind: AiConnectionIssueKind | null;
  readonly cloudIssueKind: AiConnectionIssueKind | null;
};

const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 * BYTES_PER_MIB;

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
      issueKind: input.classificationIssueKind,
    };
  }

  if (input.classificationRunning) {
    const remaining = input.classificationRemaining;
    const remainingLabel = typeof remaining === "number" && Number.isFinite(remaining) && remaining > 0
      ? `${remaining.toLocaleString()} left`
      : null;
    return {
      tone: "ok",
      label: "Classifying…",
      providerLabel: remainingLabel ?? input.localProviderLabel ?? "Drifty Cloud",
      memoryLabel: memoryLabelForLocalProvider(input),
      issueKind: null,
      activity: "classifying",
    };
  }

  switch (input.localProviderStatus.kind) {
    case "connected":
      return {
        tone: "ok",
        label: "Connected",
        providerLabel: input.localProviderLabel ?? "Local AI",
        memoryLabel: memoryLabelForLocalProvider(input),
        issueKind: null,
      };
    case "failed":
      return {
        tone: toneForIssueKind(input.localProviderStatus.issueKind),
        label: labelForIssueKind(input.localProviderStatus.issueKind),
        providerLabel: input.localProviderLabel ?? "Local AI",
        memoryLabel: memoryLabelForLocalProvider(input),
        issueKind: input.localProviderStatus.issueKind,
      };
    case "checking":
      return {
        tone: "neutral",
        label: "Checking",
        providerLabel: input.localProviderLabel ?? "Local AI",
        memoryLabel: memoryLabelForLocalProvider(input),
        issueKind: null,
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
      issueKind: null,
    };
  }

  if (input.cloudIssueKind) {
    return {
      tone: toneForIssueKind(input.cloudIssueKind),
      label: labelForIssueKind(input.cloudIssueKind),
      providerLabel: "Drifty Cloud",
      memoryLabel: null,
      issueKind: input.cloudIssueKind,
    };
  }

  return {
    tone: "error",
    label: "AI setup needed",
    providerLabel: "Open settings",
    memoryLabel: null,
    issueKind: null,
  };
}

export function AiConnectionStatusBar({
  status,
  onOpenSettings,
}: {
  readonly status: AiConnectionStatus;
  readonly onOpenSettings: () => void;
}) {
  const { t } = useLocalization();
  const statusLabel = localizeAiStatusLabel(status.label, t);
  const providerLabel = localizeAiStatusLabel(status.providerLabel, t);
  const memoryAria = status.memoryLabel ? t("ai.connection.memoryAria", { memory: status.memoryLabel }) : "";

  return (
    <>
      {status.memoryLabel ? (
        <span className="ai-connection-status__memory ai-connection-status__memory--outside" title={t("ai.connection.memoryTitle", { memory: status.memoryLabel })}>
          {status.memoryLabel}
        </span>
      ) : null}
      <button
        type="button"
        className="ai-connection-status"
        aria-label={t("ai.connection.aria", { status: statusLabel, provider: providerLabel, memory: memoryAria })}
        data-tone={status.tone}
        data-activity={status.activity ?? undefined}
        onClick={onOpenSettings}
      >
        <span className="ai-connection-status__dot" aria-hidden="true" />
        <span className="ai-connection-status__label">{statusLabel}</span>
        <span className="ai-connection-status__provider">{providerLabel}</span>
      </button>
    </>
  );
}

function memoryLabelForLocalProvider(input: AiConnectionStatusInput): string | null {
  if (!input.localProviderLabel) return null;
  return formatMemoryUsageLabel(input.localMemoryUsageBytes);
}

function formatMemoryUsageLabel(memoryUsageBytes: number | null): string | null {
  if (memoryUsageBytes === null || !Number.isFinite(memoryUsageBytes) || memoryUsageBytes <= 0) return null;
  if (memoryUsageBytes >= BYTES_PER_GIB) return `${(memoryUsageBytes / BYTES_PER_GIB).toFixed(1)} GB RAM`;
  return `${Math.max(1, Math.round(memoryUsageBytes / BYTES_PER_MIB))} MB RAM`;
}

function toneForIssueKind(issueKind: AiConnectionIssueKind): AiConnectionTone {
  switch (issueKind) {
    case "network":
    case "rate_limited":
    case "unavailable":
      return "warning";
    case "authentication":
    case "credits":
    case "access":
    case "model_unavailable":
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
    case "authentication":
      return "Key issue";
    case "credits":
      return "Credits needed";
    case "access":
      return "Access blocked";
    case "model_unavailable":
      return "Model unavailable";
    case "rate_limited":
      return "Rate limited";
    case "unavailable":
      return "Provider unavailable";
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
