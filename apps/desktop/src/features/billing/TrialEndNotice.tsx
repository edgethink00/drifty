import { useEffect, useRef, useState, type AnimationEvent } from "react";
import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import { formatLocalizedDuration, localeForDisplayLanguage } from "../../lib/formatting";
import { recordProFunnelStep } from "../../lib/analytics/proFunnel";
import { useProFunnelExposure } from "../../lib/analytics/useProFunnelExposure";
import { useLocalization } from "../localization/LocalizationContext";
import type { FirstYearOffer } from "./billingService";
import { firstYearOfferAmounts, firstYearOfferLastDay } from "./firstYearOffer";
import "./TrialEndNotice.css";

type TrialEndNoticeProps = {
  readonly funnelEnabled: boolean;
  readonly planInactive?: boolean;
  /** Today's unclassified time; the notice only appears once it is worth naming. */
  readonly unclassifiedSeconds: number;
  readonly onViewPlans: () => void;
  readonly onDismiss: () => void;
  /** The server's first-year offer: the notice names its price once, in place of today's time. */
  readonly firstYearOffer?: FirstYearOffer | null;
};

const LEAVE_FALLBACK_MS = 260;

function CloseGlyph() {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" /></svg>;
}

/**
 * The daily two-line notice after a Pro trial ended: today's unclassified time,
 * why, and one View plans action that opens the Pro sheet. It sits in the
 * trial-start notice's lane and form, never auto-dismisses, and has no entry
 * animation (a paused entry in a background window would hold it invisible).
 */
export function TrialEndNotice({ planInactive = false, funnelEnabled, unclassifiedSeconds, onViewPlans, onDismiss, firstYearOffer = null }: TrialEndNoticeProps) {
  const { t, effectiveLanguage } = useLocalization();
  const offerSurface = planInactive ? "plan_end_notice" as const : "trial_end_notice" as const;
  const offerContext = planInactive ? "plan_inactive" as const : "trial_ended" as const;
  const priceOffer = firstYearOffer ? { price_offer: firstYearOffer.kind } : {};
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const actedRef = useRef(false);
  const finishedRef = useRef(false);
  const offerRef = useProFunnelExposure<HTMLElement>(funnelEnabled, {
    step: "pro_offer_viewed", offer_surface: offerSurface, offer_context: offerContext, ...priceOffer,
  });

  const finish = (then: () => void) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    then();
  };
  const leave = (action: "view_plans" | "dismiss", then: () => void) => {
    if (actedRef.current) return;
    actedRef.current = true;
    if (funnelEnabled) {
      void recordProFunnelStep({ step: "pro_offer_acted", offer_surface: offerSurface, offer_context: offerContext, offer_action: action, ...priceOffer });
    }
    const reduced = typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    if (reduced) { finish(then); return; }
    setLeaving(() => then);
  };
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => finish(leaving), LEAVE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const onAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && event.animationName === "floating-notice-leave" && leaving) finish(leaving);
  };

  const amounts = firstYearOffer ? firstYearOfferAmounts(firstYearOffer) : null;
  const title = firstYearOffer && amounts
    ? t("billing.firstYearOffer.title", { percent: amounts.percent })
    : t("billing.trialEndNotice.title", { duration: formatLocalizedDuration(unclassifiedSeconds, effectiveLanguage) });
  const detail = firstYearOffer && amounts
    ? t("billing.firstYearOffer.noticeDetail", {
      monthlyYear: amounts.monthlyYear,
      total: amounts.total,
      regular: amounts.regular,
      date: new Intl.DateTimeFormat(localeForDisplayLanguage(effectiveLanguage), { month: "long", day: "numeric" })
        .format(firstYearOfferLastDay(firstYearOffer)),
    })
    : t(planInactive ? "billing.planEndNotice.detail" : "billing.trialEndNotice.detail");
  return (
    <FloatingNoticePortal>
      <section
        ref={offerRef}
        className={`trial-end-notice${firstYearOffer ? " is-offer" : ""}${leaving ? " is-leaving" : ""}`}
        role="status"
        aria-label={title}
        onAnimationEnd={onAnimationEnd}
      >
        <span className="trial-end-notice__copy">
          <strong>{title}</strong>
          <span>{detail}</span>
        </span>
        <button
          type="button"
          className="trial-end-notice__dismiss"
          aria-label={t(planInactive ? "billing.planEndNotice.dismiss" : "billing.trialEndNotice.dismiss")}
          onClick={() => leave("dismiss", onDismiss)}
        >
          <CloseGlyph />
        </button>
        <span className="trial-end-notice__actions">
          <button type="button" className="app-btn app-btn--primary" onClick={() => leave("view_plans", onViewPlans)}>
            {t(firstYearOffer ? "billing.firstYearOffer.action" : "billing.trialEndNotice.viewPlans")}
          </button>
        </span>
      </section>
    </FloatingNoticePortal>
  );
}
