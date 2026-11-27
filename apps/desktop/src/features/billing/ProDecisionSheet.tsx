import { localeForDisplayLanguage } from "../../lib/formatting";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ActionLabel } from "../../components/ActionLabel";
import { KeyHint } from "../../components/KeyHint";
import { createPortal } from "react-dom";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { ModalPresence } from "../../components/ModalPresence";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import { formatLocalizedDuration } from "../../lib/formatting";
import type { ProOfferContext, ProOfferSurface } from "../../lib/analytics/proFunnel";
import { useProFunnelExposure } from "../../lib/analytics/useProFunnelExposure";
import { useLocalization } from "../localization/LocalizationContext";
import { ProLookThumbnail, proLookTitle } from "../pro-looks/ProLookViews";
import type { ProLook } from "../pro-looks/proLooks";
import { trialDaysRemaining } from "../sidebar/SidebarCtaSlot";
import type { BillingInterval, CheckoutFailureCode, FirstYearOffer } from "./billingService";
import { firstYearOfferAmounts, firstYearOfferLastDay } from "./firstYearOffer";
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
export type ProSheetContext = "trial-ended" | "plan-inactive" | "trial-active" | "upgrade" | "upgrade-local";

type ProDecisionSheetProps = {
  readonly open: boolean;
  readonly context: ProSheetContext;
  readonly funnelEnabled: boolean;
  /** "trial_end_sheet" when the sheet opened on its own after a trial ended; user-opened sheets report "upgrade_modal". */
  readonly offerSurface?: Extract<ProOfferSurface, "upgrade_modal" | "trial_end_sheet" | "plan_end_sheet">;
  readonly trialEndsAt: string | null;
  /**
   * Whether the trial ended within today's logical day. Only then can the end
   * time be named as the start of today's unclassified time.
   */
  readonly trialEndedToday?: boolean;
  /** Seconds left unclassified today, when the dashboard knows it. */
  readonly unclassifiedSeconds: number | null;
  readonly billingCheckoutLoadingInterval: BillingInterval | null;
  /** True while a checkout opened in the browser and Drifty waits for its result. */
  readonly billingCheckoutAwaitingConfirmation?: boolean;
  readonly billingPlansDisabled?: boolean;
  readonly individualPricingQuote?: IndividualPricingQuote | null;
  readonly billingActionError?: string | null;
  readonly billingActionErrorCode?: CheckoutFailureCode | null;
  readonly onCheckForUpdates?: () => void;
  readonly onSelectBillingPlan: (interval: BillingInterval) => void;
  readonly onDismiss: () => void;
  /**
   * The locked Pro look (cat icon or coat) the sheet was opened from. The
   * header then names that look beside its picture; plans and benefits stay.
   */
  readonly look?: ProLook | null;
  /** macOS: the benefit line includes the Dock icons as well as the coats. */
  readonly looksIncludeAppIcons?: boolean;
  /**
   * The server's first-year offer, when it applies to this account now. The
   * yearly card then shows its price and starts selected; checkout sends it.
   */
  readonly firstYearOffer?: FirstYearOffer | null;
};

/** The sheet offers the two individual cadences. */
type Cadence = Extract<BillingInterval, "monthly" | "yearly">;
const CADENCES: readonly Cadence[] = ["monthly", "yearly"];
/** Monthly starts selected (owner decision 2026-10-10): the smaller first charge. */
const DEFAULT_CADENCE: Cadence = "monthly";

const OFFER_CONTEXT: Readonly<Record<ProSheetContext, ProOfferContext>> = {
  "trial-ended": "trial_ended",
  "plan-inactive": "plan_inactive",
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
  context, funnelEnabled, offerSurface = "upgrade_modal", trialEndsAt, trialEndedToday = false, unclassifiedSeconds, billingCheckoutLoadingInterval,
  billingCheckoutAwaitingConfirmation = false,
  billingPlansDisabled = false, individualPricingQuote = null, billingActionError = null, billingActionErrorCode = null,
  onCheckForUpdates, onSelectBillingPlan, onDismiss, look = null, looksIncludeAppIcons = false,
  firstYearOffer = null,
}: Omit<ProDecisionSheetProps, "open">) {
  const { t, effectiveLanguage } = useLocalization();
  const id = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cadenceRefs = useRef<Partial<Record<Cadence, HTMLButtonElement | null>>>({});
  // The offer is a first-year price on the yearly plan, so that card starts selected.
  const [cadence, setCadence] = useState<Cadence>(firstYearOffer ? "yearly" : DEFAULT_CADENCE);
  const [checkoutRequested, setCheckoutRequested] = useState(false);
  const checkoutOpening = billingCheckoutLoadingInterval !== null;
  useModalDismiss(onDismiss, { disabled: checkoutOpening });
  useModalFocusTrap(dialogRef, { initialFocusSelector: ".modal-x" });
  useAnchoredDialog(dialogRef);
  const offerRef = useProFunnelExposure<HTMLDivElement>(funnelEnabled, {
    step: "pro_offer_viewed", offer_surface: offerSurface, offer_context: OFFER_CONTEXT[context],
    ...(firstYearOffer ? { price_offer: firstYearOffer.kind } : {}),
  });

  const quote = individualPricingQuote ?? STANDARD_INDIVIDUAL_PRICING_QUOTE;
  const yearlyTotalAmount = individualYearlyDisplayAmount(quote);
  // The yearly saving is stated as an amount, computed from the same quote the checkout charges.
  const yearlySavingAmount = Math.max(0, individualMonthlyDisplayAmount("monthly", quote) * 12 - yearlyTotalAmount);
  const offerAmounts = firstYearOffer ? firstYearOfferAmounts(firstYearOffer) : null;
  const regularPlans: Readonly<Record<Cadence, { label: string; price: string; note: string; badge: string | null; offer?: boolean }>> = {
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
  // The offer's badge compares with a year of monthly, like the regular yearly
  // badge, so the card states one saving and strikes no other price.
  const plans = offerAmounts
    ? {
      ...regularPlans,
      yearly: {
        ...regularPlans.yearly,
        price: offerAmounts.perMonth,
        note: t("billing.firstYearOffer.yearNote", { total: offerAmounts.total, regular: offerAmounts.regular }),
        badge: t("billing.firstYearOffer.badge", { percent: offerAmounts.percent }),
        offer: true,
      },
    }
    : regularPlans;

  const stateHeader = useSheetHeader(context, trialEndsAt, trialEndedToday, unclassifiedSeconds);
  const { title, fact } = look
    ? {
      title: proLookTitle(look, t),
      fact: t(look.kind === "icon" ? "billing.proSheet.lookIconFact" : look.kind === "accent" ? "billing.proSheet.lookAccentFact" : "billing.proSheet.lookCoatFact"),
    }
    : firstYearOffer && offerAmounts
      ? {
        title: t("billing.firstYearOffer.title", { percent: offerAmounts.percent }),
        fact: t("billing.firstYearOffer.sheetFact", {
          monthlyYear: offerAmounts.monthlyYear,
          total: offerAmounts.total,
          regular: offerAmounts.regular,
          date: new Intl.DateTimeFormat(localeForDisplayLanguage(effectiveLanguage), { month: "long", day: "numeric" })
            .format(firstYearOfferLastDay(firstYearOffer)),
        }),
      }
      : stateHeader;
  // Both cadence labels and the opening label share the button's width, so
  // neither choosing a cadence nor starting checkout moves Not now beside it.
  const cadenceLabels: Readonly<Record<Cadence, string>> = {
    monthly: t("billing.proSheet.startMonthly"),
    yearly: t("billing.proSheet.startYearly"),
  };
  const checkoutLabel = cadenceLabels[cadence];
  const updateLabel = t("billing.checkout.checkForUpdates");
  const otherCadenceLabels = CADENCES.map((option) => cadenceLabels[option]).filter((label) => label !== checkoutLabel);

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
  const errorText = billingActionError ?? t("billing.checkout.updateRequired");
  const updateRequired = showError && billingActionErrorCode === "pricing_revision_mismatch" && onCheckForUpdates !== undefined;
  // A checkout refused because this version's prices are out of date can only
  // go forward through an update, so that becomes the primary action. The
  // update label is not reserved ahead of time: in French and German it would
  // widen checkout in every state and squeeze the note beside it, for a
  // failure few people see. Once it shows, it keeps the cadence labels' room.
  const reservedLabels = updateRequired ? CADENCES.map((option) => cadenceLabels[option]) : otherCadenceLabels;
  const waitingText = t("settings.account.checkoutPending");
  const footNote = showError
    ? { text: errorText, title: errorText, className: "modal-foot__note modal-foot__note--error" }
    : billingCheckoutAwaitingConfirmation
      ? { text: waitingText, title: waitingText, className: "modal-foot__note pro-sheet__note-wait" }
      : { text: t("billing.proSheet.footNoteShort"), title: undefined, className: "modal-foot__note" };

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
        <header className={look ? "modal-head pro-sheet__head--look" : "modal-head"}>
          {look ? <ProLookThumbnail look={look} /> : null}
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
                  {plan.badge ? <span className={plan.offer ? "pro-sheet__badge is-offer" : "pro-sheet__badge"}>{plan.badge}</span> : null}
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
        <ProSheetValue looksLineKey={looksIncludeAppIcons ? "billing.proSheet.plus.looks" : "billing.proSheet.plus.coats"} />
        <footer className="modal-foot pro-sheet__foot">
          {/* A failed checkout, or one still open in the browser, reports in
              the note's place beside the checkout button instead of inserting
              a block above the footer. The note stays one live region whose
              text changes, so a screen reader hears each change. */}
          <p className={footNote.className} role="status" title={footNote.title}>
            {footNote.text}
          </p>
          <button type="button" className="modal-btn modal-btn--ghost" disabled={checkoutOpening} onClick={dismiss}>{t("billing.proSheet.later")}<KeyHint shortcut="escape" /></button>
          <button type="button" className="modal-btn modal-btn--primary" disabled={updateRequired ? false : billingPlansDisabled || checkoutOpening} aria-busy={checkoutOpening}
            onClick={updateRequired ? onCheckForUpdates : startCheckout}>
            <ActionLabel busy={checkoutOpening} busyLabel={t("billing.plan.opening")} reserve={reservedLabels}>
              {updateRequired ? updateLabel : checkoutLabel}
            </ActionLabel>
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
  if (context === "plan-inactive") return {
    title: t("billing.proSheet.inactiveTitle"),
    fact: unclassifiedSeconds !== null && unclassifiedSeconds >= 60
      ? t("billing.proSheet.factTodayUnclassified", { duration: formatLocalizedDuration(unclassifiedSeconds, effectiveLanguage) })
      : t("billing.proSheet.factPlain"),
  };
  const end = trialEndsAt ? new Date(trialEndsAt) : null;
  const endTime = end && Number.isFinite(end.getTime())
    ? new Intl.DateTimeFormat(localeForDisplayLanguage(effectiveLanguage), { hour: "numeric", minute: "2-digit" }).format(end)
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
