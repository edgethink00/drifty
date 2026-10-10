import type { PostHogEventPropertiesByName } from "./events";
import { createProductAnalyticsDeliveryGuard, readProductAnalyticsRevision } from "./productAnalyticsPreference";

export type ProFunnelStep = PostHogEventPropertiesByName["pro_funnel_step"];
export type ProOfferContext = Extract<ProFunnelStep, { step: "pro_offer_viewed" }>["offer_context"];
export type ProOfferSurface = Extract<ProFunnelStep, { step: "pro_offer_viewed" }>["offer_surface"];

type Deliver = (properties: ProFunnelStep) => Promise<boolean>;

/** Impressions: once per period or offer/context in this renderer session.
 * Successful delivery consumes the key; a failed delivery can be retried on re-exposure.
 * Checkout attempts and trial-end actions remain individual events; billing guards
 * duplicate checkout clicks, and each trial-end surface acts at most once before it leaves.
 * No raw identity or activity data is persisted by this recorder.
 */
export function createProFunnelRecorder(deliver: Deliver, getDeliveryRevision: () => number = () => 0) {
  const recorded = new Set<string>();
  const inFlight = new Map<string, Promise<boolean>>();
  return (properties: ProFunnelStep): Promise<boolean> => {
    if (properties.step === "checkout_opened" || properties.step === "pro_offer_acted") return deliver(properties).catch(() => false);
    const detail = properties.step === "classified_result_viewed"
      ? properties.dashboard_period
      : `${properties.offer_surface}:${properties.offer_context}`;
    const key = JSON.stringify([properties.step, detail]);
    if (recorded.has(key)) return Promise.resolve(true);
    // A newly enabled exposure must not join a revoked lazy-load request.
    const pendingKey = JSON.stringify([getDeliveryRevision(), key]);
    const pending = inFlight.get(pendingKey);
    if (pending) return pending;
    const attempt = deliver(properties)
      .then((ok) => {
        if (ok) recorded.add(key);
        return ok;
      })
      .catch(() => false)
      .finally(() => inFlight.delete(pendingKey));
    inFlight.set(pendingKey, attempt);
    return attempt;
  };
}

export const recordProFunnelStep = createProFunnelRecorder(async (properties) => {
  const canDeliver = createProductAnalyticsDeliveryGuard();
  if (!canDeliver()) return false;
  const runtime = await import("./posthog");
  return canDeliver() && runtime.capturePostHogInstallFunnelStep(properties);
}, readProductAnalyticsRevision);
