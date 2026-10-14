import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AnchoredPresence } from "../../components/AnchoredPresence";
import type { RecordingHealth, RecordingRecoveryAction } from "./recordingHealth";
import { aiFailureGuidance } from "./aiFailureGuidance";
import "./ai-connection-recovery.css";
import type { AiConnectionIssueKind } from "./aiConnectionHealth";
import { aiFailureGuidanceKeys } from "./aiFailureGuidance";
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
  ariaLabel,
  settingsOpen = false,
  recordingHealth = { kind: "unknown", action: null },
  onCheckRecordingStatus,
  onRecordingAction,
  navigationKey,
}: {
  readonly status: AiConnectionStatus;
  readonly onOpenSettings: () => void;
  readonly ariaLabel?: string;
  readonly settingsOpen?: boolean;
  readonly recordingHealth?: RecordingHealth;
  readonly onCheckRecordingStatus?: () => Promise<void>;
  readonly onRecordingAction?: (action: RecordingRecoveryAction) => void | Promise<void>;
  readonly navigationKey?: string;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const checkGeneration = useRef(0);
  const titleId = useId();
  const panelId = useId();
  const statusLabel = localizeAiStatusLabel(status.label, t);
  const providerLabel = localizeAiStatusLabel(status.providerLabel, t);
  const hideProvider = settingsOpen && status.providerLabel === "Open settings";
  const memoryAria = status.memoryLabel ? t("ai.connection.memoryAria", { memory: status.memoryLabel }) : "";
  const failureExplanation = status.issueKind
    ? aiFailureGuidanceKeys(status.issueKind).map((key) => t(key)).join(" ")
    : undefined;
  const guidance = status.issueKind ? aiFailureGuidance(status.issueKind) : null;
  const recordingLabel = t(`ai.recovery.recording.${recordingHealth.kind}`);
  const close = useCallback((restoreFocus = false) => {
    checkGeneration.current += 1;
    setOpen(false);
    setChecking(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const checkRecording = () => {
    if (!onCheckRecordingStatus) return;
    const generation = ++checkGeneration.current;
    if (panelRef.current?.contains(document.activeElement)) panelRef.current.focus();
    setChecking(true);
    void onCheckRecordingStatus().catch(() => undefined).finally(() => {
      if (generation === checkGeneration.current) setChecking(false);
    });
  };

  // A recovered issue, provider switch, or navigation dismisses the old diagnosis.
  useEffect(() => {
    close(Boolean(panelRef.current?.contains(document.activeElement)));
  }, [status.issueKind, status.providerLabel, navigationKey, close]);
  useEffect(() => () => { checkGeneration.current += 1; }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const pad = 12;
      const width = Math.min(336, window.innerWidth - pad * 2);
      const top = Math.max(pad, Math.min(anchor.bottom + 8, window.innerHeight - pad - panel.offsetHeight));
      setPosition({ top, left: Math.max(pad, Math.min(anchor.right - width, window.innerWidth - width - pad)), width });
    };
    place();
    const focusFrame = window.requestAnimationFrame(() => panelRef.current?.focus());
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) => target instanceof Node
      && (triggerRef.current?.contains(target) || panelRef.current?.contains(target));
    const pointerDown = (event: PointerEvent) => { if (!isInside(event.target)) close(); };
    const focusIn = (event: FocusEvent) => { if (!isInside(event.target)) close(); };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("keydown", keyDown, true);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("keydown", keyDown, true);
    };
  }, [open, close]);

  return (
    <>
      {status.memoryLabel ? (
        <span className="ai-connection-status__memory ai-connection-status__memory--outside" title={t("ai.connection.memoryTitle", { memory: status.memoryLabel })}>
          {status.memoryLabel}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className="ai-connection-status"
        aria-label={hideProvider ? statusLabel : ariaLabel ?? t(status.issueKind ? "ai.connection.recoveryAria" : "ai.connection.aria", { status: statusLabel, provider: providerLabel, memory: memoryAria })}
        aria-haspopup={status.issueKind ? "dialog" : undefined}
        aria-expanded={status.issueKind ? open : undefined}
        aria-controls={open ? panelId : undefined}
        title={failureExplanation}
        data-tone={status.tone}
        data-activity={status.activity ?? undefined}
        onClick={() => {
          if (!status.issueKind) { onOpenSettings(); return; }
          if (open) { close(); return; }
          setOpen(true);
          checkRecording();
        }}
      >
        <span className="ai-connection-status__dot" aria-hidden="true" />
        <span className="ai-connection-status__label">{statusLabel}</span>
        {hideProvider ? null : <span className="ai-connection-status__provider">{providerLabel}</span>}
      </button>
      {createPortal(<AnchoredPresence>{open && guidance ? (
        <div ref={panelRef} id={panelId} role="dialog" aria-labelledby={titleId} tabIndex={-1} className="ai-connection-recovery" style={position}>
          <h2 id={titleId}>{t("ai.recovery.title")}</h2>
          <section aria-label={t("ai.recovery.recording")}>
            <h3>{t("ai.recovery.recording")}</h3>
            <p role="status">{checking ? t("ai.recovery.checking") : recordingLabel}</p>
            {!checking && recordingHealth.action && (onRecordingAction || recordingHealth.action === "check" && onCheckRecordingStatus) ? (
              <button type="button" className="ai-connection-recovery__action" onClick={() => {
                const action = recordingHealth.action;
                if (!action) return;
                if (action === "check") { checkRecording(); return; }
                if (action === "settings") { close(); void onRecordingAction?.(action); return; }
                panelRef.current?.focus();
                const generation = ++checkGeneration.current;
                setChecking(true);
                void Promise.resolve(onRecordingAction?.(action)).catch(() => undefined).finally(() => {
                  if (generation === checkGeneration.current) setChecking(false);
                });
              }}>{t(`ai.recovery.action.${recordingHealth.action}`)}</button>
            ) : null}
          </section>
          <section aria-label={t("ai.recovery.analysis")}>
            <h3>{t("ai.recovery.analysis")}</h3>
            {status.issueKind && status.label !== labelForIssueKind(status.issueKind) ? <p>{statusLabel}</p> : null}
            <p className="ai-connection-recovery__detail">{t(guidance.headlineKey)}</p>
            {guidance.needsUserAction ? (
              <button type="button" className="ai-connection-recovery__action" onClick={() => { close(); onOpenSettings(); }}>{t("ai.recovery.settings")}</button>
            ) : null}
          </section>
        </div>
      ) : null}</AnchoredPresence>, document.body)}
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
    case "entitlement":
    case "authentication":
    case "credits":
    case "access":
    case "model_unavailable":
    // Also the catch-all for HTTP statuses we have not mapped, so an unfamiliar
    // failure stays visible rather than degrading into a quiet warning.
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
    case "entitlement":
      return "Plan check failed";
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
      return "Provider error";
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
