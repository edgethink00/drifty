import { useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ModalPresence } from "../../components/ModalPresence";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { formatLocalizedDuration } from "../../lib/formatting";
import type { ProOfferContext } from "../../lib/analytics/proFunnel";
import { useProFunnelExposure } from "../../lib/analytics/useProFunnelExposure";
import { useLocalization } from "../localization/LocalizationContext";
import { trialDaysRemaining } from "../sidebar/SidebarCtaSlot";
import type { BillingInterval, CheckoutFailureCode } from "./billingService";
import {
  STANDARD_INDIVIDUAL_PRICING_QUOTE,
  formatIndividualPrice,
  individualMonthlyDisplayAmount,
  individualYearlyDisplayAmount,
  individualYearlySavingsPercent,
  type IndividualPricingQuote,
} from "./individualPricing";
import { ProSheetValue } from "./ProSheetValue";
import "./ProDecisionSheet.css";

/** The account state the sheet is shown for; only the header changes with it. */
export type ProSheetContext = "trial-ended" | "trial-active" | "upgrade" | "upgrade-local";

type ProDecisionSheetProps = {
  readonly open: boolean;
  readonly context: ProSheetContext;
  readonly funnelEnabled: boolean;
  readonly trialEndsAt: string | null;
  /**
   * Whether the trial ended within today's logical day. Only then can the end
   * time be named as the start of today's unclassified time.
   */
  readonly trialEndedToday?: boolean;
  /** Seconds left unclassified today, when the dashboard knows it. */
  readonly unclassifiedSeconds: number | null;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  readonly billingPlansDisabled?: boolean;
  readonly individualPricingQuote?: IndividualPricingQuote | null;
  readonly billingActionError?: string | null;
  readonly billingActionErrorCode?: CheckoutFailureCode | null;
  readonly onCheckForUpdates?: () => void;
  readonly onSelectBillingPlan: (interval: BillingInterval) => void;
  readonly onDismiss: () => void;
};

/** The sheet offers the two individual cadences. */
type Cadence = Extract<BillingInterval, "monthly" | "yearly">;
const CADENCES: readonly Cadence[] = ["monthly", "yearly"];
/** Monthly starts selected (owner decision 2026-10-10): the smaller first charge. */
const DEFAULT_CADENCE: Cadence = "monthly";

const OFFER_CONTEXT: Readonly<Record<ProSheetContext, ProOfferContext>> = {
  "trial-ended": "trial_ended",
  "trial-active": "trial_active",
  upgrade: "upgrade",
  "upgrade-local": "upgrade_local",
};

/**
 * The one sheet for buying Pro: two equal plan cards (pick one), what Pro adds,
 * and one checkout action. Every "Upgrade to Pro" and "View plans" entry opens
 * it; only the header follows the account state.
 */
export function ProDecisionSheet({ open, ...props }: ProDecisionSheetProps) {
  return createPortal(
    <ModalPresence explicitTabNavigation>
      {open ? <DecisionSheet {...props} /> : null}
    </ModalPresence>,
    document.body,
  );
}

function DecisionSheet({
  context, funnelEnabled, trialEndsAt, trialEndedToday = false, unclassifiedSeconds, billingCheckoutLoadingInterval,
  billingPlansDisabled = false, individualPricingQuote = null, billingActionError = null, billingActionErrorCode = null,
  onCheckForUpdates, onSelectBillingPlan, onDismiss,
}: Omit<ProDecisionSheetProps, "open">) {
  const { t } = useLocalization();
  const id = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cadenceRefs = useRef<Partial<Record<Cadence, HTMLButtonElement | null>>>({});
  const [cadence, setCadence] = useState<Cadence>(DEFAULT_CADENCE);
  const [checkoutRequested, setCheckoutRequested] = useState(false);
  const checkoutOpening = billingCheckoutLoadingInterval !== null;
  useModalDismiss(onDismiss, { disabled: checkoutOpening });
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".modal-x" });
  const offerRef = useProFunnelExposure<HTMLDivElement>(funnelEnabled, {
    step: "pro_offer_viewed", offer_surface: "upgrade_modal", offer_context: OFFER_CONTEXT[context],
  });

  const quote = individualPricingQuote ?? STANDARD_INDIVIDUAL_PRICING_QUOTE;
  const yearlyTotalAmount = individualYearlyDisplayAmount(quote);
  // The yearly saving is stated as an amount, computed from the same quote the checkout charges.
  const yearlySavingAmount = Math.max(0, individualMonthlyDisplayAmount("monthly", quote) * 12 - yearlyTotalAmount);
  const plans: Readonly<Record<Cadence, { label: string; price: string; note: string; badge: string | null }>> = {
    monthly: {
      label: t("billing.proSheet.monthly"),
      price: formatIndividualPrice(individualMonthlyDisplayAmount("monthly", quote), quote.currency),
      note: t("billing.proSheet.monthlyNote"),
      badge: null,
    },
    yearly: {
      label: t("billing.proSheet.yearly"),
      price: formatIndividualPrice(individualMonthlyDisplayAmount("yearly", quote), quote.currency),
      note: t("billing.proSheet.yearlyNote", {
        total: formatIndividualPrice(yearlyTotalAmount, quote.currency),
        amount: formatIndividualPrice(yearlySavingAmount, quote.currency),
      }),
      badge: t("billing.plan.intervalSavings", { percent: individualYearlySavingsPercent(quote) }),
    },
  };

  const { title, fact } = useSheetHeader(context, trialEndsAt, trialEndedToday, unclassifiedSeconds);
  const checkoutLabel = checkoutOpening
    ? t("billing.plan.openingCheckout")
    : t(cadence === "yearly" ? "billing.proSheet.startYearly" : "billing.proSheet.startMonthly");

  const choose = (next: Cadence) => {
    setCadence(next);
    cadenceRefs.current[next]?.focus();
  };
  // One radio group: arrow keys move the selection, Tab leaves the group.
  const onCadenceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    choose(CADENCES[(CADENCES.indexOf(cadence) + step + CADENCES.length) % CADENCES.length]);
  };
  const dismiss = () => onDismiss();
  // A press that began on a card and was released outside the panel is not an outside click.
  const overlayDismiss = useOverlayDismiss(dismiss, { disabled: checkoutOpening });
  const startCheckout = () => {
    setCheckoutRequested(true);
    onSelectBillingPlan(cadence);
  };
  const showError = checkoutRequested && !checkoutOpening && (Boolean(billingActionError) || billingActionErrorCode === "pricing_revision_mismatch");

  return (
    <div className="pro-sheet" {...overlayDismiss}>
      <section
        ref={dialogRef}
        className="pro-sheet__panel modal-shell"
        data-modal-variant="workspace"
        data-sheet-context={context}
        role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-fact`}
        tabIndex={-1}
      >
        <ModalCloseButton disabled={checkoutOpening} label={t("billing.proSheet.dismiss")} onClick={dismiss} />
        <header className="modal-head">
          <div className="modal-head__copy">
            <h2 id={`${id}-title`}>{title}</h2>
            <p id={`${id}-fact`}>{fact}</p>
          </div>
        </header>
        <div
          ref={offerRef}
          className="pro-sheet__cadences"
          role="radiogroup"
          aria-label={t("billing.plan.intervalAria")}
          aria-busy={checkoutOpening}
          onKeyDown={onCadenceKeyDown}
        >
          {CADENCES.map((option) => {
            const plan = plans[option];
            const selected = cadence === option;
            return (
              <button
                key={option}
                ref={(node) => { cadenceRefs.current[option] = node; }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className={`pro-sheet__cadence${selected ? " is-selected" : ""}`}
                disabled={checkoutOpening}
                onClick={() => setCadence(option)}
              >
                <span className="pro-sheet__cadence-top">
                  <span className="pro-sheet__label">{plan.label}</span>
                  {plan.badge ? <span className="pro-sheet__badge">{plan.badge}</span> : null}
                </span>
                <span className="pro-sheet__price">
                  <strong>{plan.price}</strong>
                  <small>{t("billing.proSheet.perMonth")}</small>
                </span>
                <span className="pro-sheet__note">{plan.note}</span>
              </button>
            );
          })}
        </div>
        {quote.variant === "regional" ? (
          <p className="pro-sheet__regional">{t("billing.plan.regionalPrice", { currency: quote.currency })}</p>
        ) : null}
        <ProSheetValue />
        {showError ? (
          <div className="pro-sheet__error" role="alert">
            <span>{billingActionError ?? t("billing.checkout.updateRequired")}</span>
            {billingActionErrorCode === "pricing_revision_mismatch" && onCheckForUpdates ? (
              <button type="button" className="pro-sheet__error-action" onClick={onCheckForUpdates}>{t("billing.checkout.checkForUpdates")}</button>
            ) : null}
          </div>
        ) : null}
        <footer className="modal-foot pro-sheet__foot">
          <p className="modal-foot__note">{t("billing.proSheet.footNoteShort")}</p>
          <button type="button" className="modal-btn modal-btn--ghost" disabled={checkoutOpening} onClick={dismiss}>{t("billing.proSheet.later")}</button>
          <button type="button" className="modal-btn modal-btn--primary" disabled={billingPlansDisabled || checkoutOpening} onClick={startCheckout}>
            {checkoutLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Title and one fact line for the account state the sheet is shown for. */
function useSheetHeader(
  context: ProSheetContext,
  trialEndsAt: string | null,
  trialEndedToday: boolean,
  unclassifiedSeconds: number | null,
): { title: string; fact: string } {
  const { t, effectiveLanguage } = useLocalization();
  if (context === "trial-active") {
    const days = trialDaysRemaining(trialEndsAt, Date.now());
    return {
      title: days === null || days < 1
        ? t("billing.proSheet.activeTitlePlain")
        : t(days === 1 ? "billing.proSheet.activeTitleOne" : "billing.proSheet.activeTitle", { days }),
      fact: t("billing.proSheet.activeFact"),
    };
  }
  if (context === "upgrade" || context === "upgrade-local") {
    return {
      title: t("billing.proSheet.upgradeTitle"),
      fact: t(context === "upgrade-local" ? "billing.proSheet.upgradeLocalFact" : "billing.proSheet.upgradeFact"),
    };
  }
  const end = trialEndsAt ? new Date(trialEndsAt) : null;
  const endTime = end && Number.isFinite(end.getTime())
    ? new Intl.DateTimeFormat(effectiveLanguage === "ko" ? "ko-KR" : "en-US", { hour: "numeric", minute: "2-digit" }).format(end)
    : null;
  const title = t("billing.proSheet.endedTitle");
  if (unclassifiedSeconds === null || unclassifiedSeconds < 60) return { title, fact: t("billing.proSheet.factPlain") };
  const duration = formatLocalizedDuration(unclassifiedSeconds, effectiveLanguage);
  // On a later day the end time would misdate today's total, so it is stated for today alone.
  return {
    title,
    fact: endTime && trialEndedToday
      ? t("billing.proSheet.factWithUnclassified", { time: endTime, duration })
      : t("billing.proSheet.factTodayUnclassified", { duration }),
  };
}

