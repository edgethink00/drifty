import type { DisplayLanguage } from "../localization/languageCatalog";
import { ExternalLinkIcon } from "../../components/ExternalLinkIcon";
import { useProFunnelExposure } from "../../lib/analytics/useProFunnelExposure";
import { localeForDisplayLanguage } from "../../lib/formatting";
import type { CSSProperties } from "react";
import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
import { aiFailureResolvesWithoutUser } from "../ai-connection/aiFailureGuidance";
import { canStartCloudTrial } from "../billing/billingEligibility";
import type { BillingEntitlement } from "../billing/billingService";
import { isQuietCloudPause, type ClassificationAvailability } from "../classification/classificationAvailability";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import {
  MANAGED_LOCAL_AI_FALLBACK_CATALOG,
  type ManagedLocalAiStatus,
} from "../settings/managedLocalAiClient";
import { managedLocalAiProgressText, managedLocalAiProgressValue } from "../settings/managedLocalAiProgressText";
import { remainingLabelText } from "../loading/remainingEstimateCopy";
import { useRemainingEstimate } from "../loading/useRemainingEstimate";
import type { LocalAiProvider } from "../settings/localAiSetup";

import "./SidebarCtaSlot.css";

/**
 * "Pro" is the customer-facing name for the paid plan. The billing wire format
 * still uses `plan: "individual"` and `create-polar-checkout` rejects anything
 * else with a 400, so the rename stays in display copy only.
 */
export type SidebarCtaSlotKind = "ai" | "upgrade" | "trial" | "trial-ended" | "billing" | "device-limit" | "download" | "preparing" | "tracker";

/** Drives the tinted drop shadow: red for "act now", gold for "handle soon". */
export type SidebarCtaSlotAlert = "critical" | "warn";

export type SidebarCtaSlotTone = "ai" | "upgrade" | "trial" | "ended" | "billing" | "device" | "download" | "tracker" | "paused";

type SidebarCtaActionState = {
  readonly actionLabelKey: TranslationKey;
  readonly alert: SidebarCtaSlotAlert | null;
  readonly copyKey: TranslationKey;
  readonly direction: "forward" | "external";
  readonly disabled: boolean;
  readonly kind: Exclude<SidebarCtaSlotKind, "download" | "preparing">;
  readonly titleKey: TranslationKey;
  /** Rendered after the title in the accent colour; only the trial countdown uses it. */
  readonly titleEmphasisCount: number | null;
  readonly tone: SidebarCtaSlotTone;
};

type SidebarCtaAiState = SidebarCtaActionState & {
  readonly kind: "ai";
  readonly providerLabel: string;
  readonly requiredResourceBytes: number | null;
  readonly availableResourceBytes: number | null;
};

type SidebarCtaNonAiActionState = SidebarCtaActionState & {
  readonly kind: Exclude<SidebarCtaActionState["kind"], "ai">;
};

type SidebarCtaDownloadState = {
  readonly alert: null;
  readonly downloadSizeLabel: string | null;
  readonly kind: "download";
  readonly modelLabel: string | null;
  readonly progressPercent: number;
  /** 0..1 completion from bytes, for the remaining-time read. */
  readonly progressValue: number | null;
  readonly progressText: string;
  readonly titleKey: TranslationKey;
  readonly tone: "download";
};

type SidebarCtaPreparingState = {
  readonly alert: null;
  readonly detailKey: TranslationKey;
  readonly kind: "preparing";
  readonly modelLabel: string | null;
  readonly titleKey: TranslationKey;
  readonly tone: "download";
};

export type SidebarCtaSlotState = SidebarCtaAiState | SidebarCtaNonAiActionState | SidebarCtaDownloadState | SidebarCtaPreparingState;

type ResolveSidebarCtaSlotInput = {
  readonly aiStatus: Pick<AiConnectionStatus, "issueKind" | "label" | "providerLabel" | "tone">;
  readonly billingCheckoutLoading: boolean;
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly localAiProvider: LocalAiProvider;
  readonly localAiConfigured: boolean;
  /** True only after the configured provider has failed consecutive health checks. */
  readonly localAiDisconnectConfirmed: boolean;
  readonly managedLocalAiStatus?: ManagedLocalAiStatus | null;
  readonly classificationAvailability?: ClassificationAvailability;
  readonly now?: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days left, rounded up so the final partial day still reads as "1 day".
 * Returns 0 once the end date has passed and null when there is no trial date.
 */
export function trialDaysRemaining(trialEndsAt: string | null, now: number): number | null {
  if (!trialEndsAt) return null;
  const endsAt = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(endsAt)) return null;
  return Math.max(0, Math.ceil((endsAt - now) / MS_PER_DAY));
}

function trialAlert(days: number): SidebarCtaSlotAlert | null {
  if (days <= 1) return "critical";
  if (days <= 2) return "warn";
  return null;
}

export function resolveSidebarCtaSlot({
  aiStatus,
  billingCheckoutLoading,
  billingEntitlement,
  billingEntitlementError,
  billingEntitlementLoading,
  localAiProvider,
  localAiConfigured,
  localAiDisconnectConfirmed,
  managedLocalAiStatus = null,
  classificationAvailability,
  now = Date.now(),
}: ResolveSidebarCtaSlotInput): SidebarCtaSlotState | null {
  const managedDownload = managedLocalDownloadState(managedLocalAiStatus);
  if (managedDownload) return managedDownload;
  const managedError = localAiProvider === "managed_local"
    ? managedLocalErrorState(managedLocalAiStatus)
    : null;
  if (managedError) return managedError;

  const aiDisconnected = aiStatus.issueKind !== null
    && (aiStatus.tone === "error" || aiStatus.tone === "warning");
  const sidebarRecoveryNeeded = aiDisconnected && isSidebarRecoveryIssue(aiStatus.issueKind);
  const usesExternalProvider = localAiProvider === "openrouter_byok" || localAiProvider === "openai" || localAiProvider === "anthropic" || localAiProvider === "self_hosted";

  // BYOK and self-hosted users have deliberately chosen inference outside
  // Drifty Cloud. Keep every Cloud monetization state out of their sidebar,
  // while still giving a broken provider a direct recovery path.
  if (usesExternalProvider) {
    return localAiConfigured
      && sidebarRecoveryNeeded
      && (aiStatus.issueKind !== "network" || localAiDisconnectConfirmed)
      ? aiDisconnectedState(
        aiStatus.issueKind,
        aiRecoveryProviderLabel(localAiProvider, localAiConfigured),
        true,
      )
      : null;
  }

  if (classificationAvailability?.route === "local") {
    if (classificationAvailability.state === "checking" || classificationAvailability.state === "retrying") return null;
    if (classificationAvailability.state === "ready") {
      if (billingEntitlementLoading || billingEntitlementError) return null;
      return billingEntitlement?.status === "active" ? null : localModelUpgradeState(billingCheckoutLoading);
    }
    if (classificationAvailability.state === "unavailable" || classificationAvailability.state === "degraded") {
      return aiDisconnectedState(
        classificationAvailability.issueKind ?? "provider",
        aiRecoveryProviderLabel(localAiProvider, localAiConfigured),
        localAiConfigured,
      );
    }
  }

  if (billingEntitlementLoading) return null;
  if (classificationAvailability && isQuietCloudPause(classificationAvailability)) return null;
  if (billingEntitlementError && !localAiConfigured) return null;

  if (canStartCloudTrial(billingEntitlement)) return {
    actionLabelKey: "sidebar.cta.ai.action", alert: null,
    copyKey: "billing.trialActivation.availableBody", direction: "forward", disabled: billingCheckoutLoading,
    kind: "upgrade", titleKey: "billing.trialActivation.available", titleEmphasisCount: null, tone: "trial",
  };
  if (billingEntitlement?.status === "locked") {
    if (billingEntitlement.lockedReason === "device_limit_reached") {
      return {
        actionLabelKey: "sidebar.cta.device.action",
        alert: "warn",
        copyKey: "sidebar.cta.device.detail",
        direction: "forward",
        disabled: false,
        kind: "device-limit",
        titleKey: "sidebar.cta.device.title",
        titleEmphasisCount: null,
        tone: "device",
      };
    }

    if (billingEntitlement.lockedReason === "trial_expired") {
      return trialEndedState(billingCheckoutLoading);
    }

    if (billingEntitlement.lockedReason === "payment_required") return {
      actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingBilling" : "sidebar.cta.billing.action",
      alert: "critical",
      copyKey: billingCheckoutLoading ? "sidebar.cta.openingBilling" : "sidebar.cta.billing.detail",
      direction: "external",
      disabled: billingCheckoutLoading,
      kind: "billing",
      titleKey: "sidebar.cta.billing.title",
      titleEmphasisCount: null,
      tone: "billing",
    };

    // No recoverable subscription exists. Route to Account plan selection,
    // never to the customer portal that requires an existing Polar customer.
    return {
      actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.action",
      alert: null,
      copyKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.noAiDetail",
      direction: "forward",
      disabled: billingCheckoutLoading,
      kind: "upgrade",
      titleKey: "sidebar.cta.upgrade.noAiTitle",
      titleEmphasisCount: null,
      tone: "upgrade",
    };
  }

  const confirmedAiDisconnection = sidebarRecoveryNeeded
    && (!localAiConfigured || aiStatus.issueKind !== "network" || localAiDisconnectConfirmed);
  if (confirmedAiDisconnection) {
    return aiDisconnectedState(
      aiStatus.issueKind,
      aiRecoveryProviderLabel(localAiProvider, localAiConfigured),
      localAiConfigured,
    );
  }
  if (billingEntitlementLoading || (billingEntitlement === null && billingEntitlementError !== null)) return null;

  if (billingEntitlement?.status === "trialing") {
    const days = trialDaysRemaining(billingEntitlement.trialEndsAt, now);
    if (days !== null && days > 0) {
      return {
        actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.action",
        alert: trialAlert(days),
        copyKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.trial.detail",
        direction: "forward",
        disabled: billingCheckoutLoading,
        kind: "trial",
        titleKey: "sidebar.cta.trial.title",
        titleEmphasisCount: days,
        tone: "trial",
      };
    }
    if (days === 0) return trialEndedState(billingCheckoutLoading);
  }

  const isFreeAccount = billingEntitlement === null || billingEntitlement.status === "trialing";
  if (isFreeAccount) {
    const runsLocalModel = localAiConfigured;
    return {
      actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.action",
      alert: null,
      copyKey: billingCheckoutLoading
        ? "sidebar.cta.openingCheckout"
        : runsLocalModel
          ? "sidebar.cta.upgrade.localDetail"
          : "sidebar.cta.upgrade.noAiDetail",
      direction: "forward",
      disabled: billingCheckoutLoading,
      kind: "upgrade",
      titleKey: runsLocalModel ? "sidebar.cta.upgrade.localTitle" : "sidebar.cta.upgrade.noAiTitle",
      titleEmphasisCount: null,
      tone: "upgrade",
    };
  }

  return null;
}

function managedLocalErrorState(status: ManagedLocalAiStatus | null): SidebarCtaAiState | null {
  if (status?.state !== "error") return null;

  switch (status.errorKind) {
    case "download_failed":
      return managedLocalRecoveryState(
        "sidebar.cta.ai.localDownloadFailedTitle",
        "sidebar.cta.ai.localDownloadFailedDetail",
      );
    case "model_artifact_missing":
      return managedLocalRecoveryState(
        "sidebar.cta.ai.localModelMissingTitle",
        "sidebar.cta.ai.localModelMissingDetail",
      );
    case "insufficient_memory":
      return hasResourceSnapshot(status)
        ? managedLocalRecoveryState(
          "sidebar.cta.ai.localMemoryMeasuredTitle",
          "sidebar.cta.ai.localMemoryMeasuredDetail",
          status.requiredResourceBytes,
          status.availableResourceBytes,
        )
        : managedLocalRecoveryState(
          "sidebar.cta.ai.localMemoryTitle",
          "sidebar.cta.ai.localMemoryDetail",
        );
    case "insufficient_storage":
      return hasResourceSnapshot(status)
        ? managedLocalRecoveryState(
          "sidebar.cta.ai.localStorageMeasuredTitle",
          "sidebar.cta.ai.localStorageMeasuredDetail",
          status.requiredResourceBytes,
          status.availableResourceBytes,
        )
        : managedLocalRecoveryState(
          "sidebar.cta.ai.localStorageTitle",
          "sidebar.cta.ai.localStorageDetail",
        );
    case "runtime_missing":
      return managedLocalRecoveryState(
        "sidebar.cta.ai.localRuntimeMissingTitle",
        "sidebar.cta.ai.localRuntimeMissingDetail",
      );
    case "runtime_download_failed":
      return managedLocalRecoveryState(
        "sidebar.cta.ai.localRuntimeDownloadFailedTitle",
        "sidebar.cta.ai.localRuntimeDownloadFailedDetail",
      );
    case "runtime_port_conflict":
      return managedLocalRecoveryState(
        "sidebar.cta.ai.localRuntimePortConflictTitle",
        "sidebar.cta.ai.localRuntimePortConflictDetail",
      );
    case "runtime_failed":
      return managedLocalRecoveryState(
        "sidebar.cta.ai.localRuntimeFailedTitle",
        "sidebar.cta.ai.localRuntimeFailedDetail",
      );
    case null:
      return null;
    default:
      return assertNever(status.errorKind);
  }
}

function hasResourceSnapshot(status: ManagedLocalAiStatus): status is ManagedLocalAiStatus & {
  readonly requiredResourceBytes: number;
  readonly availableResourceBytes: number;
} {
  return typeof status.requiredResourceBytes === "number"
    && typeof status.availableResourceBytes === "number";
}

function managedLocalRecoveryState(
  titleKey: TranslationKey,
  copyKey: TranslationKey,
  requiredResourceBytes: number | null = null,
  availableResourceBytes: number | null = null,
): SidebarCtaAiState {
  return {
    actionLabelKey: "sidebar.cta.ai.action",
    alert: "critical",
    copyKey,
    direction: "forward",
    disabled: false,
    kind: "ai",
    providerLabel: "Local AI",
    requiredResourceBytes,
    availableResourceBytes,
    titleKey,
    titleEmphasisCount: null,
    tone: "ai",
  };
}

function managedLocalDownloadState(status: ManagedLocalAiStatus | null): SidebarCtaDownloadState | SidebarCtaPreparingState | null {
  if (status?.state !== "installing") return null;
  const model = MANAGED_LOCAL_AI_FALLBACK_CATALOG.find((candidate) => candidate.id === status.selectedModelId) ?? null;
  if (status.artifactDir && status.progress === null) {
    return {
      alert: null,
      detailKey: "sidebar.cta.download.preparingDetail",
      kind: "preparing",
      modelLabel: model?.label ?? null,
      titleKey: "sidebar.cta.download.preparingTitle",
      tone: "download",
    };
  }
  const progressPercent = Math.min(Math.max(Math.round(status.progress?.percent ?? 0), 0), 100);
  const fallbackTotal = model?.downloadSize.replace(/^~/, "") ?? null;
  return {
    alert: null,
    downloadSizeLabel: model?.downloadSize ?? null,
    kind: "download",
    modelLabel: model?.label ?? null,
    progressPercent,
    progressValue: managedLocalAiProgressValue(status.progress),
    progressText: managedLocalAiProgressText(status.progress) ?? (fallbackTotal ? `0.0/${fallbackTotal}` : "0%"),
    titleKey: "sidebar.cta.download.title",
    tone: "download",
  };
}

function aiDisconnectedState(
  issueKind: NonNullable<AiConnectionStatus["issueKind"]>,
  providerLabel: string,
  automaticRetry: boolean,
): SidebarCtaAiState {
  const copy = aiRecoveryCopy(issueKind, automaticRetry);
  return {
    actionLabelKey: "sidebar.cta.ai.action",
    alert: "critical",
    copyKey: copy.detail,
    direction: "forward",
    disabled: false,
    kind: "ai",
    providerLabel,
    requiredResourceBytes: null,
    availableResourceBytes: null,
    titleKey: copy.title,
    titleEmphasisCount: null,
    tone: "ai",
  };
}

function isSidebarRecoveryIssue(issueKind: AiConnectionStatus["issueKind"]): boolean {
  // Single source with the status pill: a card here and a tooltip there must
  // not disagree about whether the same failure needs the user.
  return issueKind !== null && !aiFailureResolvesWithoutUser(issueKind);
}

function aiRecoveryCopy(
  issueKind: NonNullable<AiConnectionStatus["issueKind"]>,
  automaticRetry: boolean,
): { readonly title: TranslationKey; readonly detail: TranslationKey } {
  switch (issueKind) {
    case "network":
      return {
        title: "sidebar.cta.ai.networkTitle",
        detail: automaticRetry ? "sidebar.cta.ai.networkRetryDetail" : "sidebar.cta.ai.networkDetail",
      };
    case "entitlement":
      return { title: "settings.ai.status.planCheckFailed", detail: "settings.ai.failure.entitlement.nextStep" };
    case "authentication":
      return { title: "sidebar.cta.ai.authenticationTitle", detail: "sidebar.cta.ai.authenticationDetail" };
    case "credits":
      return { title: "sidebar.cta.ai.creditsTitle", detail: "sidebar.cta.ai.creditsDetail" };
    case "access":
      return { title: "sidebar.cta.ai.accessTitle", detail: "sidebar.cta.ai.accessDetail" };
    case "model_unavailable":
      return { title: "sidebar.cta.ai.modelUnavailableTitle", detail: "sidebar.cta.ai.modelUnavailableDetail" };
    case "provider":
      return { title: "sidebar.cta.ai.providerTitle", detail: "sidebar.cta.ai.providerDetail" };
    case "rate_limited":
    case "unavailable":
      throw new SidebarCtaSlotError(`Transient issue cannot create a sidebar recovery: ${issueKind}`);
    default:
      return assertNever(issueKind);
  }
}

function aiRecoveryProviderLabel(
  localAiProvider: LocalAiProvider,
  localAiConfigured: boolean,
): string {
  if (!localAiConfigured) return "Drifty Cloud";
  switch (localAiProvider) {
    case "openrouter_byok":
      return "OpenRouter";
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "managed_local":
    case "self_hosted":
      return "Local AI";
    default:
      return assertNever(localAiProvider);
  }
}

function trialEndedState(billingCheckoutLoading: boolean): SidebarCtaSlotState {
  return {
    actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.action",
    alert: "critical",
    copyKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.trialEnded.detail",
    direction: "forward",
    disabled: billingCheckoutLoading,
    kind: "trial-ended",
    titleKey: "sidebar.cta.trialEnded.title",
    titleEmphasisCount: null,
    tone: "ended",
  };
}

function localModelUpgradeState(billingCheckoutLoading: boolean): SidebarCtaSlotState {
  return {
    actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.action",
    alert: null,
    copyKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.localDetail",
    direction: "forward",
    disabled: billingCheckoutLoading,
    kind: "upgrade",
    titleKey: "sidebar.cta.upgrade.localTitle",
    titleEmphasisCount: null,
    tone: "upgrade",
  };
}

function assertNever(value: never): never {
  throw new SidebarCtaSlotError(String(value));
}

class SidebarCtaSlotError extends Error {
  constructor(value: string) {
    super(`Unhandled sidebar AI provider: ${value}`);
    this.name = "SidebarCtaSlotError";
  }
}

export function SidebarCtaSlot({
  funnelEnabled = false,
  onDismiss,
  onAction,
  state,
}: {
  readonly funnelEnabled?: boolean;
  readonly onDismiss?: () => void;
  readonly onAction: () => void;
  readonly state: SidebarCtaSlotState;
}) {
  const { effectiveLanguage, t } = useLocalization();
  // Held above the branch because hooks cannot follow the slot's kind. The
  // download is the app's longest wait, and the sidebar is the one place it
  // stays visible no matter where it was started.
  const downloadRemaining = useRemainingEstimate({
    enabled: state.kind === "download",
    resetKey: state.kind === "download" ? state.modelLabel ?? "download" : "idle",
    value: state.kind === "download" ? state.progressValue : null,
  });
  const offerRef = useProFunnelExposure<HTMLDivElement>(funnelEnabled,
    state.kind === "upgrade" || state.kind === "trial" || state.kind === "trial-ended"
      ? { step: "pro_offer_viewed", offer_surface: "sidebar",
        offer_context: state.kind === "trial" ? "trial_active" : state.kind === "trial-ended" ? "trial_ended"
          : state.titleKey === "sidebar.cta.upgrade.localTitle" ? "upgrade_local" : "upgrade" }
      : null,
  );
  if (state.kind === "preparing") {
    const title = t(state.titleKey);
    const modelLabel = state.modelLabel ?? t("sidebar.cta.download.modelFallback");
    const detail = `${modelLabel} · ${t(state.detailKey)}`;
    return (
      <div className="sidebar-cta-slot-wrap">
        <div
          className="sidebar-cta-slot sidebar-cta-slot--download"
          data-kind={state.kind}
          data-tone={state.tone}
          role="status"
          aria-label={`${title} · ${detail}`}
        >
          <span className="sidebar-cta-slot__copy sidebar-cta-slot__download-copy">
            <strong className="sidebar-cta-slot__title sidebar-cta-slot__download-title">{title}</strong>
            <span className="sidebar-cta-slot__detail sidebar-cta-slot__download-detail">{detail}</span>
          </span>
        </div>
      </div>
    );
  }
  if (state.kind === "download") {
    const title = t(state.titleKey);
    const modelLabel = state.modelLabel ?? t("sidebar.cta.download.modelFallback");
    // The meta row below already reports the transferred size against the total,
    // so this line spends its second slot on the one thing nothing else says:
    // how much longer. The static size stays as the fallback until the transfer
    // rate is measurable.
    const remainingCopy = remainingLabelText(downloadRemaining, t);
    const detailSuffix = remainingCopy ?? state.downloadSizeLabel;
    const detail = detailSuffix ? `${modelLabel} · ${detailSuffix}` : modelLabel;
    const style = { "--sidebar-download-progress": `${state.progressPercent}%` } as CSSProperties;
    return (
      <div className="sidebar-cta-slot-wrap">
        <div
          className="sidebar-cta-slot sidebar-cta-slot--download"
          data-kind={state.kind}
          data-tone={state.tone}
          role="status"
          aria-label={`${title} · ${detail} · ${state.progressText} · ${state.progressPercent}%`}
          style={style}
        >
          <span className="sidebar-cta-slot__copy sidebar-cta-slot__download-copy">
            <strong className="sidebar-cta-slot__title sidebar-cta-slot__download-title">{title}</strong>
            <span className="sidebar-cta-slot__detail sidebar-cta-slot__download-detail">{detail}</span>
            <span className="sidebar-cta-slot__download-progress">
              <span className="sidebar-cta-slot__download-meta">
                <span>{state.progressText}</span>
                <span className="sidebar-cta-slot__download-percent">{state.progressPercent}%</span>
              </span>
              <span
                className="sidebar-cta-slot__download-track"
                role="progressbar"
                aria-label={title}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={state.progressPercent}
              >
                <span className="sidebar-cta-slot__download-fill" />
              </span>
            </span>
          </span>
        </div>
      </div>
    );
  }

  const actionLabel = t(state.actionLabelKey);
  const interpolationParams = state.kind === "ai"
    ? {
      provider: state.providerLabel,
      ...(state.requiredResourceBytes !== null
        ? { required: formatResourceCapacity(state.requiredResourceBytes, effectiveLanguage) }
        : {}),
      ...(state.availableResourceBytes !== null
        ? { available: formatResourceCapacity(state.availableResourceBytes, effectiveLanguage) }
        : {}),
    }
    : undefined;
  const copy = t(state.copyKey, interpolationParams);
  const title = t(state.titleKey, interpolationParams);
  const titleEmphasis = state.titleEmphasisCount === null
    ? null
    : t(state.titleEmphasisCount === 1 ? "sidebar.cta.trial.day" : "sidebar.cta.trial.days", { count: state.titleEmphasisCount });

  return (
    <div className="sidebar-cta-slot-wrap" data-dismissible={onDismiss ? "true" : undefined}>
      <div
        className="sidebar-cta-slot"
        ref={offerRef}
        data-kind={state.kind}
        data-tone={state.tone}
        data-alert={state.alert ?? undefined}
      >
        <span className="sidebar-cta-slot__copy">
          <strong className="sidebar-cta-slot__title">
            {title}
            {titleEmphasis ? (
              <>
                {" "}
                <span className="sidebar-cta-slot__emphasis">{titleEmphasis}</span>
              </>
            ) : null}
          </strong>
          <span className="sidebar-cta-slot__detail">{copy}</span>
        </span>
        <button
          type="button"
          className="sidebar-cta-slot__action"
          data-kind={state.kind}
          data-tone={state.tone}
          data-alert={state.alert ?? undefined}
          data-direction={state.direction}
          disabled={state.disabled}
          aria-busy={state.disabled || undefined}
          aria-label={[titleEmphasis ? `${title} ${titleEmphasis}` : title, copy, actionLabel].filter(Boolean).join(" · ")}
          onClick={onAction}
        >
          <span className="sidebar-cta-slot__action-label">{actionLabel}</span>
          {state.direction === "external" ? (
            <ExternalLinkIcon className="sidebar-cta-slot__arrow" />
          ) : (
            <svg
              className="sidebar-cta-slot__arrow"
              data-direction="forward"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.4 6h7.2" />
              <path d="M6.6 3 9.6 6l-3 3" />
            </svg>
          )}
        </button>
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="sidebar-cta-slot__dismiss"
          aria-label={t("sidebar.cta.upgrade.dismiss")}
          title={t("sidebar.cta.upgrade.dismiss")}
          disabled={state.disabled}
          onClick={onDismiss}
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="m3 3 6 6M9 3 3 9" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function formatResourceCapacity(bytes: number, language: DisplayLanguage): string {
  const gibibytes = bytes / (1024 ** 3);
  const rounded = Math.round(gibibytes * 10) / 10;
  const locale = localeForDisplayLanguage(language);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(rounded)} GB`;
}
