import type { AiConnectionStatus } from "../ai-connection/AiConnectionStatusBar";
import type { BillingEntitlement } from "../billing/billingService";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import type { LocalAiProvider } from "../settings/localAiSetup";

import "./SidebarCtaSlot.css";

/**
 * "Pro" is the customer-facing name for the paid plan. The billing wire format
 * still uses `plan: "individual"` and `create-polar-checkout` rejects anything
 * else with a 400, so the rename stays in display copy only.
 */
export type SidebarCtaSlotKind = "ai" | "upgrade" | "trial" | "trial-ended" | "billing" | "device-limit";

/** Drives the tinted drop shadow: red for "act now", gold for "handle soon". */
export type SidebarCtaSlotAlert = "critical" | "warn";

export type SidebarCtaSlotTone = "ai" | "upgrade" | "trial" | "ended" | "billing" | "device";

export type SidebarCtaSlotState = {
  readonly actionLabelKey: TranslationKey;
  readonly alert: SidebarCtaSlotAlert | null;
  readonly copyKey: TranslationKey;
  readonly direction: "forward" | "external";
  readonly disabled: boolean;
  readonly kind: SidebarCtaSlotKind;
  readonly titleKey: TranslationKey;
  /** Rendered after the title in the accent colour; only the trial countdown uses it. */
  readonly titleEmphasisCount: number | null;
  readonly tone: SidebarCtaSlotTone;
};

type ResolveSidebarCtaSlotInput = {
  readonly aiStatus: Pick<AiConnectionStatus, "label" | "tone">;
  readonly billingCheckoutLoading: boolean;
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementError: string | null;
  readonly billingEntitlementLoading: boolean;
  readonly localAiProvider: LocalAiProvider;
  readonly localAiConfigured: boolean;
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
  now = Date.now(),
}: ResolveSidebarCtaSlotInput): SidebarCtaSlotState | null {
  const aiDisconnected = aiStatus.label !== "AI setup needed"
    && (aiStatus.tone === "error" || aiStatus.tone === "warning");
  const usesExternalProvider = localAiProvider === "openrouter_byok" || localAiProvider === "self_hosted";

  // BYOK and self-hosted users have deliberately chosen inference outside
  // Drifty Cloud. Keep every Cloud monetization state out of their sidebar,
  // while still giving a broken provider a direct recovery path.
  if (usesExternalProvider) {
    return localAiConfigured && aiDisconnected ? aiDisconnectedState() : null;
  }

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

    return {
      actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.action",
      alert: "critical",
      copyKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.billing.detail",
      direction: "external",
      disabled: billingCheckoutLoading,
      kind: "billing",
      titleKey: "sidebar.cta.billing.title",
      titleEmphasisCount: null,
      tone: "billing",
    };
  }

  // An entitlement request failure is not evidence that a signed-in user is
  // free. When the warning came only from that failed request, avoid sending
  // them to AI settings or selling a plan they may already own.
  const unresolvedBillingFailure = billingEntitlement === null
    && billingEntitlementError !== null
    && !localAiConfigured;
  if (aiDisconnected && !unresolvedBillingFailure) return aiDisconnectedState();
  if (billingEntitlementLoading || (billingEntitlement === null && billingEntitlementError !== null)) return null;

  if (billingEntitlement?.status === "trialing") {
    const days = trialDaysRemaining(billingEntitlement.trialEndsAt, now);
    if (days !== null && days > 0) {
      return {
        actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.action",
        alert: trialAlert(days),
        copyKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.trial.detail",
        direction: "external",
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
      direction: "external",
      disabled: billingCheckoutLoading,
      kind: "upgrade",
      titleKey: runsLocalModel ? "sidebar.cta.upgrade.localTitle" : "sidebar.cta.upgrade.noAiTitle",
      titleEmphasisCount: null,
      tone: "upgrade",
    };
  }

  return null;
}

function aiDisconnectedState(): SidebarCtaSlotState {
  return {
    actionLabelKey: "sidebar.cta.ai.action",
    alert: "critical",
    copyKey: "sidebar.cta.ai.detail",
    direction: "forward",
    disabled: false,
    kind: "ai",
    titleKey: "sidebar.cta.ai.title",
    titleEmphasisCount: null,
    tone: "ai",
  };
}

function trialEndedState(billingCheckoutLoading: boolean): SidebarCtaSlotState {
  return {
    actionLabelKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.upgrade.action",
    alert: "critical",
    copyKey: billingCheckoutLoading ? "sidebar.cta.openingCheckout" : "sidebar.cta.trialEnded.detail",
    direction: "external",
    disabled: billingCheckoutLoading,
    kind: "trial-ended",
    titleKey: "sidebar.cta.trialEnded.title",
    titleEmphasisCount: null,
    tone: "ended",
  };
}

export function SidebarCtaSlot({
  onDismiss,
  onAction,
  state,
}: {
  readonly onDismiss?: () => void;
  readonly onAction: () => void;
  readonly state: SidebarCtaSlotState;
}) {
  const { t } = useLocalization();
  const actionLabel = t(state.actionLabelKey);
  const copy = t(state.copyKey);
  const title = t(state.titleKey);
  const titleEmphasis = state.titleEmphasisCount === null
    ? null
    : t(state.titleEmphasisCount === 1 ? "sidebar.cta.trial.day" : "sidebar.cta.trial.days", { count: state.titleEmphasisCount });

  return (
    <div className="sidebar-cta-slot-wrap" data-dismissible={onDismiss ? "true" : undefined}>
      <button
        type="button"
        className="sidebar-cta-slot"
        data-kind={state.kind}
        data-tone={state.tone}
        data-alert={state.alert ?? undefined}
        disabled={state.disabled}
        aria-busy={state.disabled || undefined}
        onClick={onAction}
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
        <span className="sidebar-cta-slot__action">
          <span className="sidebar-cta-slot__action-label">{actionLabel}</span>
          <svg
            className="sidebar-cta-slot__arrow"
            data-direction={state.direction}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {state.direction === "external" ? (
              <>
                <path d="M3.6 8.4 8.4 3.6" />
                <path d="M4.6 3.6h3.8v3.8" />
              </>
            ) : (
              <>
                <path d="M2.4 6h7.2" />
                <path d="M6.6 3 9.6 6l-3 3" />
              </>
            )}
          </svg>
        </span>
      </button>
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
